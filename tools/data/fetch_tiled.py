#!/usr/bin/env python3
"""City-scale OSM acquisition: split the configured bbox into Overpass-sized tiles, fetch each with
tools/data/fetch.py (cached, hashed, provenance per tile), then merge elements by (type, id)."""
import argparse
import copy
import hashlib
import json
import math
import pathlib
import time
from datetime import datetime, timezone

import fetch as single

ROOT = pathlib.Path(__file__).resolve().parents[2]


def tiles(bbox, max_sq):
    west, south, east, north = bbox
    n = math.ceil(math.sqrt((east-west)*(north-south)/max_sq/0.85))
    cols = rows = max(1, n)
    while ((east-west)/cols)*((north-south)/rows) > max_sq:
        cols += 1
    for r in range(rows):
        for c in range(cols):
            yield r, c, [round(west+(east-west)*c/cols, 6), round(south+(north-south)*r/rows, 6),
                         round(west+(east-west)*(c+1)/cols, 6), round(south+(north-south)*(r+1)/rows, 6)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=pathlib.Path, required=True)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    parser.add_argument('--refresh', action='store_true')
    parser.add_argument('--pause', type=float, default=8.0, help='seconds between live tile requests')
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    tile_dir = args.output.with_suffix('')
    tile_dir = tile_dir.parent/(tile_dir.name+'-tiles')
    tile_dir.mkdir(parents=True, exist_ok=True)
    merged, parts = {}, []
    for r, c, bbox in tiles(config['bbox'], config['maxBboxSquareDegrees']):
        cfg = copy.deepcopy(config)
        cfg['bbox'] = bbox
        dest = tile_dir/f'r{r}-c{c}.overpass.json'
        cached = dest.exists() and not args.refresh
        single.fetch(cfg, dest, refresh=args.refresh)
        meta = json.loads(dest.with_suffix('.provenance.json').read_text())
        parts.append({'tile': f'r{r}-c{c}', 'bbox': bbox, 'sha256': meta['sha256'], 'bytes': meta['bytes'], 'elements': meta['elements'], 'osmTimestamp': meta.get('osmTimestamp'), 'downloadedAt': meta['downloadedAt']})
        for element in json.loads(dest.read_text())['elements']:
            merged.setdefault((element['type'], element['id']), element)
        if not cached:
            time.sleep(args.pause)
    out = {'version': 0.6, 'generator': 'Pixel City tiled merge', 'elements': [merged[k] for k in sorted(merged)]}
    raw = json.dumps(out, separators=(',', ':')).encode()
    args.output.write_bytes(raw)
    provenance = {'source': 'OpenStreetMap contributors', 'license': 'ODbL-1.0', 'licenseUrl': 'https://www.openstreetmap.org/copyright',
                  'endpoint': config['overpassEndpoint'], 'bbox': config['bbox'], 'query': single.query_for_bbox(['{west}', '{south}', '{east}', '{north}']),
                  'tiles': parts, 'elements': len(out['elements']), 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
                  'mergedAt': datetime.now(timezone.utc).isoformat(), 'merge': 'union of tile responses keyed by (type, id); first occurrence kept'}
    args.output.with_suffix('.provenance.json').write_text(json.dumps(provenance, indent=2)+'\n')
    print(json.dumps({k: provenance[k] for k in ('elements', 'bytes', 'sha256')} | {'tiles': len(parts)}, indent=2))


if __name__ == '__main__':
    main()
