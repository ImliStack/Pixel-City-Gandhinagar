#!/usr/bin/env python3
"""Prepare real OSM/GeoJSON geometry, preserving courtyards and provenance."""
import argparse
import hashlib
import html
import json
import pathlib
import re
import shutil
import subprocess
import tempfile
from collections import Counter

from pyproj import Transformer
from shapely import make_valid, normalize
from shapely.errors import GEOSException
from shapely.geometry import (GeometryCollection, LineString, MultiLineString,
                              MultiPolygon, Point, Polygon, box, mapping, shape)
from shapely.ops import polygonize, transform, unary_union
from shapely.strtree import STRtree

ROOT = pathlib.Path(__file__).resolve().parents[2]


def classify(tags, geom=None):
    if tags.get('building') not in (None, 'no') or tags.get('building:part') not in (None, 'no'):
        return 'building'
    if tags.get('highway'):
        return 'road'
    if tags.get('natural') == 'water' or tags.get('water') or tags.get('waterway'):
        return 'water'
    if tags.get('leisure') in ('park', 'garden', 'recreation_ground', 'playground', 'pitch') or tags.get('landuse') in ('forest', 'grass', 'meadow', 'orchard'):
        return 'park'
    if tags.get('natural') == 'tree':
        return 'tree'
    if tags.get('railway'):
        return 'railway'
    if tags.get('landuse'):
        return 'landuse'
    return 'site' if geom is not None and geom.geom_type in ('Polygon', 'MultiPolygon') else 'poi'


def height_for(tags, floor_height=3.2):
    raw = str(tags.get('height', '')).strip().lower()
    match = re.fullmatch(r'([0-9]+(?:\.[0-9]+)?)\s*(m|metres|meters|ft|feet|\')?', raw)
    if match:
        height = float(match[1]) * (0.3048 if match[2] in ('ft', 'feet', "'") else 1)
        if 0 < height < 500:
            return round(height, 3), 'height-tag'
    try:
        levels = float(tags.get('building:levels', ''))
        if 0 < levels < 100:
            return round(levels*floor_height, 3), 'levels-estimate'
    except (ValueError, TypeError):
        pass
    typology = tags.get('building', 'yes')
    estimate = {'house': 6.4, 'detached': 6.4, 'hut': 3.2, 'shed': 3.2,
                'roof': 3.2, 'apartments': 12.8, 'commercial': 9.6,
                'retail': 6.4, 'industrial': 6.4, 'temple': 9.6}.get(typology, 9.6)
    return estimate, 'typology-estimate'


def render_visible(tags, kind):
    """In the flat pilot, explicitly lower-layer buildings are not surface solids."""
    if kind != 'building':
        return True
    if tags.get('location') == 'underground':
        return False
    try:
        return float(tags.get('layer', 0)) >= 0
    except (TypeError, ValueError):
        return True


def geometry_points(obj, nodes):
    if obj.get('geometry'):
        if any(n is None or 'lon' not in n or 'lat' not in n for n in obj['geometry']):
            return []
        return [(n['lon'], n['lat']) for n in obj['geometry']]
    ids = obj.get('nodes', [])
    return [nodes[n] for n in ids] if all(n in nodes for n in ids) else []


def area_geometry(geometry):
    if geometry.geom_type in ('Polygon', 'MultiPolygon'):
        return geometry
    if hasattr(geometry, 'geoms'):
        polygons = []
        for part in geometry.geoms:
            candidate = area_geometry(part)
            if not candidate.is_empty:
                polygons.extend(list(candidate.geoms) if candidate.geom_type == 'MultiPolygon' else [candidate])
        return unary_union(polygons) if polygons else Polygon()
    return Polygon()


def relation_geometry(element, elements, nodes):
    outers, inners, member_ids = [], [], []
    for member in element.get('members', []):
        if member.get('type') != 'way':
            continue
        way = elements.get(('way', member['ref']), {})
        points = geometry_points(member, nodes) or geometry_points(way, nodes)
        if len(points) < 2:
            # A missing inner ring must never turn a courtyard into a filled roof.
            return Polygon(), []
        (inners if member.get('role') == 'inner' else outers).append(LineString(points))
        member_ids.append('way/'+str(member['ref']))
    outer = unary_union(list(polygonize(unary_union(outers)))) if outers else Polygon()
    inner = unary_union(list(polygonize(unary_union(inners)))) if inners else Polygon()
    return area_geometry(outer.difference(inner)), member_ids


def overpass_features(data, audit):
    elements = {(e['type'], e['id']): e for e in data['elements']}
    nodes = {e['id']: (e['lon'], e['lat']) for e in data['elements'] if e['type'] == 'node'}
    features, represented = [], set()
    ordered = sorted(data['elements'], key=lambda e: (e['type'] != 'relation', e['type'], e['id']))
    for e in ordered:
        tags = e.get('tags', {})
        if not tags:
            continue
        feature_id = e['type']+'/'+str(e['id'])
        if feature_id in represented:
            audit['relationMemberDuplicatesSuppressed'] += 1
            continue
        geom = None
        try:
            if e['type'] == 'relation':
                if tags.get('type') not in ('multipolygon', 'boundary'):
                    continue
                geom, members = relation_geometry(e, elements, nodes)
                if not geom.is_empty:
                    # Only suppress members with the same geometric meaning. A park
                    # boundary can legitimately coincide with a separately tagged road.
                    for member_id in members:
                        member = elements.get(('way', int(member_id.split('/')[1])), {})
                        if not member.get('tags') or classify(member['tags']) == classify(tags):
                            represented.add(member_id)
            elif e['type'] == 'way':
                points = geometry_points(e, nodes)
                if len(points) >= 4 and points[0] == points[-1] and (not tags.get('highway') or tags.get('area') == 'yes') and not tags.get('railway'):
                    geom = Polygon(points)
                elif len(points) >= 2:
                    geom = LineString(points)
            else:
                geom = Point(e['lon'], e['lat'])
        except (ValueError, KeyError, GEOSException) as error:
            audit['geometryErrors'].append({'id': feature_id, 'error': str(error)})
        if geom is None or geom.is_empty:
            audit['missingGeometries'] += 1
            continue
        features.append((feature_id, tags, geom))
    return features


def geojson_features(data, audit):
    if data.get('type') != 'FeatureCollection':
        raise ValueError('Local GeoJSON must be a WGS84 FeatureCollection')
    crs = data.get('crs', {}).get('properties', {}).get('name', 'EPSG:4326')
    if crs not in ('EPSG:4326', 'urn:ogc:def:crs:OGC:1.3:CRS84', 'urn:ogc:def:crs:EPSG::4326'):
        raise ValueError('Local GeoJSON must use lon/lat WGS84; reproject before import')
    features = []
    for i, item in enumerate(data['features']):
        if not item.get('geometry'):
            audit['missingGeometries'] += 1
            continue
        properties = item.get('properties') or {}
        tags = properties.get('tags', properties)
        if properties.get('@type') in ('node', 'way', 'relation') and '@id' in properties:
            feature_id = str(properties['@type'])+'/'+str(properties['@id'])
        else:
            feature_id = str(item.get('id') or properties.get('@id') or 'local/'+str(i))
        try:
            features.append((feature_id, tags, shape(item['geometry'])))
        except (ValueError, KeyError, GEOSException) as error:
            audit['geometryErrors'].append({'id': feature_id, 'error': str(error)})
    return features


def read_source(path, bbox, audit):
    if path.name.endswith('.osm.pbf') or path.suffix == '.pbf':
        if not shutil.which('osmium'):
            raise RuntimeError('PBF input requires optional osmium-tool (macOS: brew install osmium-tool). No full-country download is performed.')
        with tempfile.TemporaryDirectory(prefix='jaipur-pbf-') as tmp:
            clipped = pathlib.Path(tmp)/'pilot.osm.pbf'
            exported = pathlib.Path(tmp)/'pilot.geojson'
            subprocess.run(['osmium', 'extract', '-b', ','.join(map(str, bbox)), '-s', 'smart', str(path), '-o', str(clipped)], check=True)
            subprocess.run(['osmium', 'export', str(clipped), '--attributes=type,id', '--stop-on-error', '-f', 'geojson', '-o', str(exported)], check=True)
            return geojson_features(json.loads(exported.read_text()), audit)
    data = json.loads(path.read_text())
    return overpass_features(data, audit) if 'elements' in data else geojson_features(data, audit)


def curated_pois(features, inverse, coverage):
    """Anchor search results inside coverage, without truncating scene geometry."""
    known = [
        ('hawa-mahal', ['hawa mahal', 'palace of winds'], 'हवा महल', ['Palace of Winds'], 'Hawa Mahal', 'Heritage facade. Any authored 3D detail is an artistic reconstruction with approximate dimensions.'),
        ('city-palace', ['city palace'], 'सिटी पैलेस', ['Chandra Mahal', 'City Palace Jaipur'], 'City Palace', 'Historic palace complex with mapped courtyards; individual building detail is incomplete in the source.'),
        ('jantar-mantar', ['jantar mantar'], 'जंतर मंतर', ['Jaipur Observatory'], 'Jantar Mantar', 'Historic observatory; parametric instruments are artistic reconstructions, not a survey.'),
        ('badi-chaupar', ['badi chaupar', 'badi chopar', 'bari chaupar', 'badi chowpar', 'badi choupad'], 'बड़ी चौपड़', ['Badi Chopar', 'Bari Chaupar'], 'Badi Chaupar', 'Old City square and road junction. Position is derived from the downloaded OSM feature.'),
    ]
    pois, used, names = [], set(), set()
    named = [f for f in features if f['tags'].get('name') or f['tags'].get('name:en')]
    for slug, patterns, hindi, aliases, display, description in known:
        matches = [f for f in named if any(p in str(f['tags'].get('name:en', f['tags'].get('name', ''))).lower() for p in patterns)]
        if not matches:
            continue
        # Prefer the attraction/heritage site to metro stations and unrelated shops.
        matches.sort(key=lambda f: (f['tags'].get('tourism') not in ('attraction', 'museum'), f['kind'] == 'road', 'station' in str(f['tags']).lower(), len(f['tags'].get('name', '')), f['id']))
        f = matches[0]
        g = shape(f['geometry']).intersection(coverage)
        if g.is_empty:
            continue
        p = g.representative_point()
        lon, lat = inverse(p.x, p.y)
        pois.append({'id': slug, 'sourceId': f['id'], 'name': display, 'sourceName': f['tags'].get('name'), 'hindi': f['tags'].get('name:hi', hindi), 'aliases': aliases, 'lon': lon, 'lat': lat, 'x': p.x, 'y': p.y, 'kind': 'landmark', 'description': description})
        used.add(f['id'])
        names.add(display.lower())
    for f in named:
        name = f['tags'].get('name:en', f['tags'].get('name'))
        if f['id'] in used or name.lower() in names:
            continue
        if f['kind'] != 'road' and not (f['tags'].get('tourism') in ('attraction', 'museum') or f['tags'].get('historic')):
            continue
        g = shape(f['geometry']).intersection(coverage)
        if g.is_empty:
            continue
        if f['kind'] == 'road' and g.geom_type not in ('LineString', 'MultiLineString'):
            continue
        p = g.interpolate(0.5, normalized=True) if g.geom_type in ('LineString', 'MultiLineString') else g.representative_point()
        lon, lat = inverse(p.x, p.y)
        pois.append({'id': f['id'].replace('/', '-'), 'sourceId': f['id'], 'name': name, 'hindi': f['tags'].get('name:hi', ''), 'aliases': [str(f['tags'][k]) for k in ('alt_name', 'old_name', 'name:en') if f['tags'].get(k) and f['tags'][k] != name], 'lon': lon, 'lat': lat, 'x': p.x, 'y': p.y, 'kind': 'street' if f['kind'] == 'road' else 'landmark', 'description': 'Named feature from OpenStreetMap. Ground position assumes flat terrain.'})
        names.add(name.lower())
    return pois


def coverage_svg(features, bounds, pois, audit):
    x0, y0, x1, y1 = bounds
    width, height = 1000, round(1000*(y1-y0)/(x1-x0))
    def xy(x, y):
        return ((x-x0)/(x1-x0)*width, (y1-y)/(y1-y0)*height)
    result = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height+110}" viewBox="0 0 {width} {height+110}">', '<rect width="100%" height="100%" fill="#fff8eb"/>', f'<defs><clipPath id="coverage"><rect width="{width}" height="{height}"/></clipPath></defs><g clip-path="url(#coverage)">']
    colors = {'park': '#9dbb79', 'water': '#7aa8be', 'landuse': '#eee7d7', 'building': '#c07e64', 'site': '#e8dfce', 'road': '#53636a', 'railway': '#444444', 'tree': '#44764d'}
    for f in sorted(features, key=lambda f: {'landuse': 0, 'site': 1, 'park': 2, 'water': 3, 'building': 4, 'road': 5}.get(f['kind'], 6)):
        g = shape(f['geometry'])
        parts = list(g.geoms) if hasattr(g, 'geoms') else [g]
        for part in parts:
            if part.geom_type == 'Polygon':
                rings = [part.exterior]+list(part.interiors)
                d = ' '.join('M'+' L'.join(f'{px:.2f},{py:.2f}' for px, py in [xy(*c[:2]) for c in ring.coords])+' Z' for ring in rings)
                result.append(f'<path d="{d}" fill="{colors.get(f["kind"], "none")}" fill-rule="evenodd" stroke="#fff8eb" stroke-width=".35"/>')
            elif part.geom_type == 'LineString':
                points = ' '.join(f'{px:.2f},{py:.2f}' for px, py in [xy(*c[:2]) for c in part.coords])
                result.append(f'<polyline points="{points}" stroke="{colors.get(f["kind"], "#888")}" stroke-width="1.7" fill="none"/>')
            elif part.geom_type == 'Point' and f['kind'] == 'tree':
                px, py = xy(part.x, part.y)
                result.append(f'<circle cx="{px:.2f}" cy="{py:.2f}" r="2" fill="#44764d"/>')
    result.append(f'</g><rect x="1" y="1" width="{width-2}" height="{height-2}" fill="none" stroke="#ab572f" stroke-width="3" stroke-dasharray="12 7"/>')
    for p in pois[:4]:
        px, py = xy(p['x'], p['y'])
        result.append(f'<circle cx="{px:.2f}" cy="{py:.2f}" r="5" fill="#142f37"/><text x="{px+9:.2f}" y="{py-8:.2f}" font-family="sans-serif" font-size="17" fill="#142f37" paint-order="stroke" stroke="#fff8eb" stroke-width="4">{html.escape(p["name"])}</text>')
    result.append(f'<text x="20" y="{height+28}" font-family="sans-serif" font-size="17">OSM pilot coverage: {audit["counts"].get("building", 0)} building features · blank areas are unmapped or unclassified.</text>')
    result.append(f'<text x="20" y="{height+54}" font-family="sans-serif" font-size="15">No completeness denominator. Flat terrain; heights are mostly estimates. North is up.</text>')
    attribution = '© OpenStreetMap contributors · ODbL · https://www.openstreetmap.org/copyright' if any(f['source'] == 'OpenStreetMap' for f in features) else 'Local input · retain and verify the original source license'
    result.append(f'<text x="20" y="{height+82}" font-family="sans-serif" font-size="15">{html.escape(attribution)}</text></svg>')
    return '\n'.join(result)


def prepare(source, config, output):
    audit = {'missingGeometries': 0, 'invalidGeometries': 0, 'repairedGeometries': 0, 'emptyAfterRepair': 0, 'geometryErrors': [], 'exactDuplicatesSuppressed': 0, 'relationMemberDuplicatesSuppressed': 0, 'outsidePilotSkipped': 0}
    features = read_source(source, config['bbox'], audit)
    forward = Transformer.from_crs('EPSG:4326', config['worldCrs'], always_xy=True)
    reverse = Transformer.from_crs(config['worldCrs'], 'EPSG:4326', always_xy=True)
    lon0, lat0 = config['origin']
    e0, n0 = forward.transform(lon0, lat0)
    def project(x, y, z=None):
        e, n = forward.transform(x, y)
        # Shapely may pass sequences; using scalar fallback stays version independent.
        if hasattr(e, '__iter__'):
            return ([v-e0 for v in e], [v-n0 for v in n])
        return e-e0, n-n0
    def inverse(x, y):
        return reverse.transform(x+e0, y+n0)
    bbox = box(*config['bbox'])
    world_bounds = list(transform(project, bbox).bounds)
    processed, geographic, seen = [], [], set()
    for feature_id, tags, geom in features:
        kind = classify(tags, geom)
        if not geom.is_valid:
            audit['invalidGeometries'] += 1
            geom = make_valid(geom)
            if kind in ('building', 'park', 'landuse', 'site'):
                geom = area_geometry(geom)
            if geom.is_valid and not geom.is_empty:
                audit['repairedGeometries'] += 1
        if geom.is_empty:
            audit['emptyAfterRepair'] += 1
            continue
        if not geom.intersects(bbox):
            audit['outsidePilotSkipped'] += 1
            continue
        # Do not clip at the coverage edge: whole buildings cast consistent shadows.
        projected = transform(project, geom)
        if kind == 'building' and projected.geom_type not in ('Polygon', 'MultiPolygon'):
            audit['missingGeometries'] += 1
            continue
        key = (kind, normalize(projected).wkb)
        if key in seen:
            audit['exactDuplicatesSuppressed'] += 1
            continue
        seen.add(key)
        height, height_source = height_for(tags, config['floorHeightMetres']) if kind == 'building' else (0, 'not-building')
        properties = {'id': feature_id, 'kind': kind, 'tags': tags, 'height': height, 'heightSource': height_source, 'renderVisible': render_visible(tags, kind), 'source': 'OpenStreetMap' if feature_id.startswith(('node/', 'way/', 'relation/')) else 'local-input'}
        processed.append(dict(properties, geometry=mapping(projected)))
        geographic.append({'type': 'Feature', 'id': feature_id, 'properties': properties, 'geometry': mapping(geom)})
    processed.sort(key=lambda f: f['id'])
    buildings = [f for f in processed if f['kind'] == 'building']
    audit['counts'] = dict(Counter(f['kind'] for f in processed))
    audit['heightSources'] = dict(Counter(f['heightSource'] for f in buildings))
    total = len(buildings)
    audit['heightTagFraction'] = sum('height' in f['tags'] for f in buildings)/total if total else 0
    audit['buildingLevelsTagFraction'] = sum('building:levels' in f['tags'] for f in buildings)/total if total else 0
    audit['usableExplicitHeightFraction'] = sum(f['heightSource'] == 'height-tag' for f in buildings)/total if total else 0
    geometries = [shape(f['geometry']) for f in buildings]
    overlaps = []
    if geometries:
        tree = STRtree(geometries)
        for i, geom in enumerate(geometries):
            for candidate in tree.query(geom):
                j = int(candidate)
                if j <= i:
                    continue
                overlap = geom.intersection(geometries[j]).area
                if overlap > 1:
                    different_layers = str(buildings[i]['tags'].get('layer', '0')) != str(buildings[j]['tags'].get('layer', '0'))
                    overlaps.append({'ids': [buildings[i]['id'], buildings[j]['id']], 'areaM2': round(overlap, 2), 'includesBuildingPart': any('building:part' in buildings[k]['tags'] for k in (i, j)), 'differentLayers': different_layers, 'resolution': 'Preserve separate layers; lower-layer building is excluded from flat ground surface render.' if different_layers else 'Unresolved source overlap; retained and disclosed.'})
    audit['overlappingFootprintPairs'] = len(overlaps)
    audit['overlaps'] = overlaps
    audit['sameLayerOverlappingPairs'] = sum(not pair['differentLayers'] for pair in overlaps)
    audit['nonSurfaceBuildingIds'] = [f['id'] for f in buildings if not f['renderVisible']]
    pois = curated_pois(processed, inverse, transform(project, bbox))
    named_ids = {p['id'] for p in pois}
    # Historical Jaipur landmark check by default; other cities list their own ids (or none) in landmarkAudit.
    audit['landmarkAvailability'] = {name: name in named_ids for name in config.get('landmarkAudit', ('hawa-mahal', 'city-palace', 'jantar-mantar', 'badi-chaupar'))}
    audit['namedStreets'] = sorted(p['name'] for p in pois if p['kind'] == 'street')
    audit['landmarkSourceConflicts'] = []
    for poi in pois[:4]:
        if poi['kind'] != 'landmark':
            continue
        p = Point(poi['x'], poi['y'])
        for f, geom in zip(buildings, geometries):
            name = f['tags'].get('name')
            if geom.covers(p) and name and name.lower() not in poi['name'].lower() and poi['name'].lower() not in name.lower():
                audit['landmarkSourceConflicts'].append({'poi': poi['id'], 'poiSourceId': poi['sourceId'], 'footprintId': f['id'], 'footprintName': name, 'finding': 'Named landmark point falls inside a differently named source footprint. Source data retained; authored replacement must be documented.'})
    audit['coverage'] = {'completeness': 'unknown; no independent authoritative footprint denominator', 'bboxWgs84': config['bbox'], 'areaKm2': round(transform(project, bbox).area/1e6, 3), 'terrain': config['terrain'], 'buildingFootprintAreaM2': round(unary_union(geometries).intersection(transform(project, bbox)).area if geometries else 0, 1)}
    audit['limitations'] = ['Absence of an OSM footprint does not imply empty land; no filler buildings are generated.', 'Building height tags are contributor-supplied, not verified survey measurements.', 'No authoritative completeness percentage is claimed.', 'Courtyards are only present where source polygons include holes.', 'Flat pilot ground z=0; hills and DEM are not implemented.', 'Named features are limited to this downloaded extent.', 'Whole intersecting source geometries may extend beyond coverage; renderer must clip display to coverage while retaining out-of-frame casters.', 'Negative building layers are excluded from the flat ground surface render; layer tags are relative ordering, not measured depth.']
    # List concrete small cells without mapped footprints. They are evidence of source
    # sparsity only, not a claim that each cell contains unrecorded buildings.
    sparse = []
    for ix in range(8):
        for iy in range(8):
            w, s, e, n = config['bbox']
            cell = box(w+(e-w)*ix/8, s+(n-s)*iy/8, w+(e-w)*(ix+1)/8, s+(n-s)*(iy+1)/8)
            projected_cell = transform(project, cell)
            if not any(g.intersects(projected_cell) for g in geometries):
                sparse.append({'bbox': list(cell.bounds), 'finding': 'No mapped building polygons in this cell; real-world occupancy is unverified.'})
    audit['sourceSparsityExamples'] = sparse[:12]
    source_hasher = hashlib.sha256()
    with source.open('rb') as stream:
        for block in iter(lambda: stream.read(1024*1024), b''):
            source_hasher.update(block)
    source_hash = source_hasher.hexdigest()
    config_hash = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()
    data = {'version': 1, 'features': processed, 'pois': pois,
            'origin': {'easting': e0, 'northing': n0, 'lon': lon0, 'lat': lat0},
            'bounds': {'world': world_bounds, 'wgs84': config['bbox']},
            'crs': {'geographic': 'EPSG:4326', 'projected': config['worldCrs'], 'axes': 'x=east, y=north, z=up; metres; ground z=0', 'axisOrder': 'longitude,latitude'},
            'sourceHash': source_hash, 'configHash': config_hash, 'terrain': config['terrain'],
            'attribution': '© OpenStreetMap contributors · ODbL-1.0' if any(f['source'] == 'OpenStreetMap' for f in processed) else 'Local input; verify and retain the original source license', 'audit': audit}
    output.mkdir(parents=True, exist_ok=True)
    (output/'pilot.json').write_text(json.dumps(data, separators=(',', ':'), ensure_ascii=False)+'\n')
    (output/'pilot.geojson').write_text(json.dumps({'type': 'FeatureCollection', 'features': geographic}, separators=(',', ':'), ensure_ascii=False)+'\n')
    (output/'audit.json').write_text(json.dumps(audit, indent=2, ensure_ascii=False)+'\n')
    (output/'coverage.svg').write_text(coverage_svg(processed, world_bounds, pois, audit))
    print(json.dumps({'features': len(processed), 'counts': audit['counts'], 'heightSources': audit['heightSources'], 'landmarks': audit['landmarkAvailability'], 'namedStreets': len(audit['namedStreets']), 'sourceHash': source_hash}, indent=2))
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=pathlib.Path, default=ROOT/'data/raw/pilot.overpass.json')
    parser.add_argument('--config', type=pathlib.Path, default=ROOT/'config/data.json')
    parser.add_argument('--output', type=pathlib.Path, default=ROOT/'data/processed')
    args = parser.parse_args()
    prepare(args.input, json.loads(args.config.read_text()), args.output)


if __name__ == '__main__':
    main()
