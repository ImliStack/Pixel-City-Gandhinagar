"""Geometry integrity, height provenance and bounded cached data ingestion."""
import contextlib
import hashlib
import io
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

from pyproj import Transformer
from shapely.geometry import Point, box, shape
from shapely.ops import transform

from tools.data.fetch import fetch, query_for_bbox
from tools.data.prepare import geometry_points, height_for, overpass_features, prepare, relation_geometry, render_visible

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONFIG = json.loads((ROOT/'config/data.json').read_text())


class GeographicDataTests(unittest.TestCase):
    def test_local_geometry_preserves_holes_multipart_and_repairs(self):
        with tempfile.TemporaryDirectory() as tmp, contextlib.redirect_stdout(io.StringIO()):
            data = prepare(ROOT/'tests/fixtures/geometry.geojson', CONFIG, pathlib.Path(tmp))
        features = {f['id']: f for f in data['features']}
        courtyard = shape(features['fixture/courtyard']['geometry'])
        self.assertEqual(len(courtyard.interiors), 1)
        self.assertFalse(courtyard.contains(courtyard.centroid))
        self.assertEqual(len(shape(features['fixture/multipart']['geometry']).geoms), 2)
        repaired = shape(features['fixture/bowtie']['geometry'])
        self.assertTrue(repaired.is_valid)
        self.assertGreater(repaired.area, 0)
        self.assertEqual(data['audit']['invalidGeometries'], 1)
        self.assertEqual(data['audit']['repairedGeometries'], 1)
        self.assertEqual(data['audit']['exactDuplicatesSuppressed'], 1)
        self.assertEqual(data['audit']['missingGeometries'], 1)
        self.assertEqual(data['audit']['outsidePilotSkipped'], 1)
        self.assertNotIn('fixture/duplicate', features)
        self.assertNotIn('fixture/outside', features)
        self.assertEqual(len(features), 4)
        self.assertNotIn('OpenStreetMap', data['attribution'])

    def test_projection_is_metres_with_explicit_longitude_first(self):
        with tempfile.TemporaryDirectory() as tmp, contextlib.redirect_stdout(io.StringIO()):
            data = prepare(ROOT/'tests/fixtures/geometry.geojson', CONFIG, pathlib.Path(tmp))
        origin = next(f for f in data['features'] if f['id'] == 'fixture/origin')
        self.assertEqual(origin['geometry']['coordinates'], (0.0, 0.0))
        self.assertAlmostEqual(data['origin']['easting'], 581908.4443302605, places=4)
        self.assertAlmostEqual(data['origin']['northing'], 2978395.388423073, places=4)
        forward = Transformer.from_crs(4326, 32643, always_xy=True)
        reverse = Transformer.from_crs(32643, 4326, always_xy=True)
        x, y = forward.transform(75.8268652, 26.923932)
        self.assertAlmostEqual(x-data['origin']['easting'], 185.963314677, places=4)
        self.assertAlmostEqual(y-data['origin']['northing'], -117.087950154, places=4)
        lon, lat = reverse.transform(x, y)
        self.assertAlmostEqual(lon, 75.8268652, places=10)
        self.assertAlmostEqual(lat, 26.923932, places=10)

    def test_height_priority_units_and_estimate_flags(self):
        self.assertEqual(height_for({'height': '12 m', 'building:levels': '9'}), (12, 'height-tag'))
        self.assertEqual(height_for({'height': '20 ft'}), (6.096, 'height-tag'))
        self.assertEqual(height_for({'height': 'unknown', 'building:levels': '2.5'}), (8, 'levels-estimate'))
        self.assertEqual(height_for({'building': 'hut'}), (3.2, 'typology-estimate'))
        self.assertEqual(height_for({'building:levels': '-3'}), (9.6, 'typology-estimate'))

    def test_relation_members_do_not_double_buildings_or_fill_courtyard(self):
        def geom(coords):
            return [{'lon': x, 'lat': y} for x, y in coords]
        outer = [(0, 0), (10, 0), (10, 10), (0, 10), (0, 0)]
        inner = [(2, 2), (2, 8), (8, 8), (8, 2), (2, 2)]
        second = [(20, 0), (24, 0), (24, 4), (20, 4), (20, 0)]
        elements = [
            {'type': 'way', 'id': 1, 'tags': {'building': 'yes'}, 'geometry': geom(outer)},
            {'type': 'way', 'id': 2, 'tags': {'building': 'yes'}, 'geometry': geom(inner)},
            {'type': 'way', 'id': 3, 'tags': {'building': 'yes'}, 'geometry': geom(second)},
            {'type': 'relation', 'id': 4, 'tags': {'type': 'multipolygon', 'building': 'yes'}, 'members': [
                {'type': 'way', 'ref': 1, 'role': 'outer'}, {'type': 'way', 'ref': 2, 'role': 'inner'}, {'type': 'way', 'ref': 3, 'role': 'outer'}]},
        ]
        audit = {'relationMemberDuplicatesSuppressed': 0, 'missingGeometries': 0, 'geometryErrors': []}
        output = overpass_features({'elements': elements}, audit)
        self.assertEqual(len(output), 1)
        self.assertEqual(output[0][2].area, 80)
        self.assertEqual(output[0][2].geom_type, 'MultiPolygon')
        self.assertFalse(output[0][2].covers(Point(5, 5)))
        self.assertEqual(audit['relationMemberDuplicatesSuppressed'], 3)

    def test_negative_layer_is_retained_but_not_surface_solid(self):
        self.assertFalse(render_visible({'building': 'yes', 'layer': '-1'}, 'building'))
        self.assertFalse(render_visible({'building': 'yes', 'location': 'underground'}, 'building'))
        self.assertTrue(render_visible({'building': 'yes'}, 'building'))
        self.assertTrue(render_visible({'highway': 'primary', 'layer': '-1'}, 'road'))

    def test_missing_coordinates_do_not_invent_a_segment_or_fill_a_hole(self):
        self.assertEqual(geometry_points({'nodes': [1, 2, 3]}, {1: (0, 0), 3: (1, 1)}), [])
        self.assertEqual(geometry_points({'geometry': [{'lon': 0, 'lat': 0}, None, {'lon': 1, 'lat': 1}]}, {}), [])
        relation = {'members': [
            {'type': 'way', 'ref': 1, 'role': 'outer', 'geometry': [{'lon': x, 'lat': y} for x, y in [(0, 0), (10, 0), (10, 10), (0, 10), (0, 0)]]},
            {'type': 'way', 'ref': 2, 'role': 'inner'},
        ]}
        geom, members = relation_geometry(relation, {}, {})
        self.assertTrue(geom.is_empty)
        self.assertEqual(members, [])

    def test_search_anchors_clip_to_coverage_but_features_stay_whole(self):
        # Both full-feature representative points lie outside the east coverage
        # boundary. Search must use just the covered part of each source feature.
        fixture = {'type': 'FeatureCollection', 'features': [
            {'type': 'Feature', 'id': 'fixture/long-road', 'properties': {'highway': 'primary', 'name': 'Crossing road'}, 'geometry': {'type': 'LineString', 'coordinates': [[75.825, 26.925], [76.025, 26.925]]}},
            {'type': 'Feature', 'id': 'fixture/large-site', 'properties': {'tourism': 'attraction', 'name': 'City Palace'}, 'geometry': {'type': 'Polygon', 'coordinates': [[[75.83, 26.92], [76.03, 26.92], [76.03, 26.93], [75.83, 26.93], [75.83, 26.92]]]}},
        ]}
        with tempfile.TemporaryDirectory() as tmp, contextlib.redirect_stdout(io.StringIO()):
            source = pathlib.Path(tmp)/'source.geojson'
            source.write_text(json.dumps(fixture))
            data = prepare(source, CONFIG, pathlib.Path(tmp)/'prepared')
        self.assertEqual(len(data['pois']), 2)
        forward = Transformer.from_crs(4326, 32643, always_xy=True)
        def local(x, y, z=None):
            e, n = forward.transform(x, y)
            return e-data['origin']['easting'], n-data['origin']['northing']
        coverage = transform(local, box(*CONFIG['bbox']))
        for poi in data['pois']:
            self.assertTrue(coverage.covers(Point(poi['x'], poi['y'])), poi)
            self.assertGreaterEqual(poi['lon'], CONFIG['bbox'][0])
            self.assertLessEqual(poi['lon'], CONFIG['bbox'][2])
            self.assertGreaterEqual(poi['lat'], CONFIG['bbox'][1])
            self.assertLessEqual(poi['lat'], CONFIG['bbox'][3])
        for feature in data['features']:
            self.assertGreater(shape(feature['geometry']).bounds[2], data['bounds']['world'][2])

    def test_cache_is_offline_and_rejects_changed_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp)/'pilot.json'
            path.write_text('{"elements":[{"id":1}]}')
            provenance = path.with_suffix('.provenance.json')
            provenance.write_text(json.dumps({'queryHash': hashlib.sha256(query_for_bbox(CONFIG['bbox']).encode()).hexdigest(), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}))
            with patch('tools.data.fetch.download', side_effect=AssertionError('Unexpected network')), contextlib.redirect_stdout(io.StringIO()):
                fetch(CONFIG, path)
            path.write_text('{"changed":true}')
            with self.assertRaisesRegex(ValueError, 'hash'):
                fetch(CONFIG, path)

    def test_public_query_cannot_expand_to_whole_city(self):
        expanded = dict(CONFIG, bbox=[75.7, 26.8, 76, 27.1])
        with tempfile.TemporaryDirectory() as tmp, self.assertRaisesRegex(ValueError, 'local PBF'):
            fetch(expanded, pathlib.Path(tmp)/'pilot.json')


if __name__ == '__main__':
    unittest.main()
