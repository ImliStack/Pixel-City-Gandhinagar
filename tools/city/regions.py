#!/usr/bin/env python3
"""City layout: one global orthographic image lattice sized to the city extent, split into regions of
regionChunks × regionChunks chunks. Writes outputs/<city>/layout.json and one scene file per region that
contains the region's ground footprint plus a margin (shadow casters, occluders, tree candidates)."""
import argparse, json, math, sys, time
from pathlib import Path
from shapely.geometry import shape, Polygon, box
from shapely.strtree import STRtree
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'sample'))
from prepare import build  # noqa: E402

def camera(c):
    a, e = math.radians(c['camera']['azimuth']), math.radians(c['camera']['elevation'])
    return [math.cos(a), math.sin(a), 0], [-math.sin(a)*math.sin(e), math.cos(a)*math.sin(e), math.cos(e)]

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--config', required=True); ap.add_argument('--only', help='comma list r-c'); args = ap.parse_args()
    c = json.loads(Path(args.config).read_text()); p = json.loads(Path(c['input']).read_text())
    right, up = camera(c); s = c['pixelsPerMetre']; chunk = c['chunkSize']; R = c['regionChunks']
    ext = next(f for f in p['features'] if f['id'] == c['extentFeature'])
    area = shape(ext['geometry']).buffer(c['extentBufferMetres'])
    us = [x*right[0]+y*right[1] for x, y in area.exterior.coords]; vs = [x*up[0]+y*up[1] for x, y in area.exterior.coords]
    W = math.ceil((max(us)-min(us))*s/chunk)*chunk; H = math.ceil((max(vs)-min(vs))*s/chunk)*chunk
    mu, mv = (max(us)+min(us))/2, (max(vs)+min(vs))/2
    det = right[0]*up[1]-right[1]*up[0]
    cx, cy = (mu*up[1]-mv*right[1])/det, (mv*right[0]-mu*up[0])/det  # ground point projecting to the image centre
    minU, maxV = mu-W/s/2, mv+H/s/2
    to_ground = lambda px, py: (((px/s+minU)*up[1]-(maxV-py/s)*right[1])/det, ((maxV-py/s)*right[0]-(px/s+minU)*up[0])/det)
    bounds = p['bounds']['world']; coverage = box(*bounds)
    feats = p['features']; geoms = [shape(f['geometry']) for f in feats]; tree = STRtree(geoms)
    out = Path(c['output']); (out/'scenes').mkdir(parents=True, exist_ok=True)
    regions = []; only = set(args.only.split(',')) if args.only else None
    for ry in range(math.ceil(H/chunk/R)):
        for rx in range(math.ceil(W/chunk/R)):
            x0, y0 = rx*R*chunk, ry*R*chunk; w, h = min(R*chunk, W-x0), min(R*chunk, H-y0)
            ground = Polygon([to_ground(x0, y0), to_ground(x0+w, y0), to_ground(x0+w, y0+h), to_ground(x0, y0+h)])
            key = f'{ry}-{rx}'; inside = ground.intersects(coverage)
            regions.append({'key': key, 'rect': [x0, y0, w, h], 'ground': list(ground.exterior.coords), 'coverage': inside, 'scene': f'scenes/{key}.json' if inside else None})
            if not inside or (only and key not in only):
                continue
            t = time.time(); clip = ground.buffer(c['regionMargin'])
            idx = tree.query(clip, predicate='intersects')
            rc = {**c, 'width': W, 'height': H, 'centerWorld': [cx, cy], 'region': [x0, y0, w, h], 'contextRadius': None, 'output': str(out)}
            result = build(rc, p, [feats[i] for i in sorted(idx)])
            (out/'scenes'/f'{key}.json').write_text(json.dumps(result, separators=(',', ':')))
            print(f'region {key}: {len(result["buildings"])} buildings, {len(result["roads"])} roads, {time.time()-t:.1f}s', flush=True)
    layout = {'width': W, 'height': H, 'centerWorld': [cx, cy], 'minU': minU, 'maxV': maxV, 'pixelsPerMetre': s, 'chunk': chunk, 'regionChunks': R,
              'regions': regions, 'extentFeature': c['extentFeature'], 'coverageWorld': bounds}
    (out/'layout.json').write_text(json.dumps(layout, indent=1))
    print(json.dumps({'width': W, 'height': H, 'megapixels': W*H/1e6, 'regions': len(regions), 'covered': sum(r['coverage'] for r in regions)}))

if __name__ == '__main__':
    main()
