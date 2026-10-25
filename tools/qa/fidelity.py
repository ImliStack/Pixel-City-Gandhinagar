#!/usr/bin/env python3
"""How closely the rendered city follows real Gandhinagar, measured against what can be checked locally:
the OSM source (what was drawn) and the independent VEDAS LoD1 footprint set (what OSM may be missing).
VEDAS is research-only here: used for comparison counts, never rendered."""
import json, sys
from pathlib import Path
import pyarrow.parquet as pq
from shapely import wkb
from shapely.geometry import shape, Polygon
from shapely.strtree import STRtree
from pyproj import Transformer

cfg = json.loads(Path(sys.argv[1] if len(sys.argv) > 1 else 'config/cities/gandhinagar-city.json').read_text())
p = json.loads(Path(cfg['input']).read_text()); L = json.loads(Path(cfg['output'], 'layout.json').read_text())
o = p['origin']; to_utm = Transformer.from_crs('EPSG:4326', p['crs']['projected'], always_xy=True)
ext = shape(next(f for f in p['features'] if f['id'] == cfg['extentFeature'])['geometry'])  # the city polygon itself
osm_b = [f for f in p['features'] if f['kind'] == 'building']
osm_in = [f for f in osm_b if shape(f['geometry']).representative_point().within(ext)]
underground = [f['id'] for f in osm_in if f.get('renderVisible') is False]  # layer<0 etc.: intentionally not drawn
osm_in = [f for f in osm_in if f.get('renderVisible') is not False]
roads_in = [f for f in p['features'] if f['kind'] == 'road' and f['tags'].get('tunnel') != 'yes' and shape(f['geometry']).intersects(ext)]
# What the renderer actually received: union of building/road ids over every region scene.
drawn_b, drawn_r = set(), set()
for r in L['regions']:
    if not r['scene']: continue
    s = json.loads(Path(cfg['output'], r['scene']).read_text())
    drawn_b |= {b['id'].split('/')[0] + '/' + b['id'].split('/')[1] for b in s['buildings']}; drawn_r |= {x['id'] for x in s['roads']}
replaced = {'way/338492244'}
b_ok = sum(f['id'] in drawn_b or f['id'] in replaced for f in osm_in); r_ok = sum(f['id'] in drawn_r for f in roads_in)
heights = sum(f['heightSource'] in ('height-tag', 'levels-estimate') for f in osm_in)
# Independent completeness check against VEDAS footprints inside the same city polygon.
t = pq.read_table('data/research/Vedas_Gandhinagar_Buildings.parquet', columns=['geometry'])
def local(g):
    from shapely.ops import transform
    return transform(lambda x, y, z=None: tuple(v - w for v, w in zip(to_utm.transform(x, y), (o['easting'], o['northing']))), g)
ved = [local(wkb.loads(bytes(b))) for b in t.column('geometry').to_pylist()]
ved = [g for g in ved if g.is_valid and g.representative_point().within(ext)]
osm_geoms = [shape(f['geometry']) for f in osm_in]; tree = STRtree(osm_geoms)
hit, offsets, overlap = 0, [], 0.0
for g in ved:
    idx = tree.query(g, predicate='intersects')
    if len(idx):
        hit += 1; areas = [osm_geoms[i].intersection(g).area for i in idx]; overlap += min(g.area, sum(areas)); best = idx[areas.index(max(areas))]; offsets.append(osm_geoms[best].centroid.distance(g.centroid))
offsets.sort()
ved_area, osm_area = sum(g.area for g in ved), sum(g.area for g in osm_geoms)
named = json.loads(Path('outputs/maps', cfg['mapId'], 'metadata.json').read_text())['pois']
seam = json.loads(Path(cfg['output'], 'render-A/job.json').read_text()).get('seamComparison', {})
res = {
 'cityPolygon': {'id': cfg['extentFeature'], 'areaKm2': round(ext.area / 1e6, 2)},
 'osmBuildingsSkippedUnderground': underground, 'osmBuildingsDrawnPct': round(100 * b_ok / len(osm_in), 2), 'osmBuildings': len(osm_in),
 'osmRoadsDrawnPct': round(100 * r_ok / len(roads_in), 2), 'osmRoads': len(roads_in), 'osmRoadsDrawn': r_ok, 'osmBuildingsDrawn': b_ok,
 'heightFromDataPct': round(100 * heights / len(osm_in), 1),
 'vedasBuildings': len(ved), 'vedasMatchedByOsmPct': round(100 * hit / len(ved), 1),
 'vedasFootprintAreaOverlappedPct': round(100 * overlap / ved_area, 1) if ved_area else None,
 'vedasMatchedByOsmPctLargerThan100m2': round(100 * sum(1 for g in ved if g.area >= 100 and len(tree.query(g, predicate='intersects'))) / max(1, sum(1 for g in ved if g.area >= 100)), 1),
 'matchedCentroidOffsetMetres': {'median': round(offsets[len(offsets) // 2], 2), 'p90': round(offsets[int(len(offsets) * .9)], 2)} if offsets else None,
 'searchablePlaces': len(named),
 'regionSeamIdenticalChannelsPct': round(100 * (1 - seam['core512']['changedChannelFraction']), 2) if seam.get('core512') else None,
 'notes': ['Percentages compare the render with OpenStreetMap (what was drawn) and with VEDAS LoD1 footprints (independent completeness check, research-only).',
           'Facades, roof objects, trees outside mapped parks and most heights are authored or estimated, so they are not counted as matches.'],
}
Path(cfg['output'], 'fidelity.json').write_text(json.dumps(res, indent=2)); print(json.dumps(res, indent=2))
