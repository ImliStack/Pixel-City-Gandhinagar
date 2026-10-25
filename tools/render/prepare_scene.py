#!/usr/bin/env python3
"""Create explicit authored landmark substitutions; retain original geographic data."""
import json, math
from pathlib import Path
from shapely.geometry import shape, mapping, Polygon

def prepare():
    data=json.loads(Path('data/processed/pilot.json').read_text())
    assets=json.loads(Path('assets/landmarks/jaipur.json').read_text())
    h=assets['hawa-mahal'];p=next(p for p in data['pois'] if p['id']=='hawa-mahal')
    a,b=h['axisEndpointsWorld'];dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy)
    axis=[dx/length,dy/length];normal=[axis[1],-axis[0]]
    # Footprint uses POI as center, with street-facing surface on the east/southeast side.
    center=[p['x']-normal[0]*1.5,p['y']-normal[1]*1.5]
    half=h['approximateLengthMetres']/2;depth=h['approximateDepthMetres']/2
    ring=[[center[0]+axis[0]*s*half+normal[0]*d*depth,center[1]+axis[1]*s*half+normal[1]*d*depth] for s,d in [(-1,-1),(-1,1),(1,1),(1,-1)]]
    corridor=Polygon(ring);replacements=[]
    for f in data['features']:
        if f['kind']!='building':continue
        geometry=shape(f['geometry'])
        if not geometry.intersects(corridor):continue
        overlap=geometry.intersection(corridor).area
        if overlap<=.01:continue
        difference=geometry.difference(corridor)
        f['geometry']=mapping(difference);f['authoredCutout']='hawa-mahal facade corridor'
        replacements.append({'id':f['id'],'removedAreaM2':round(overlap,2)})
    data['authoredLandmarks']={'hawa-mahal':{'center':center,'axis':axis,'normal':normal,'polygon':ring,'length':half*2,'depth':depth*2,'height':h['approximateHeightMetres'],'approximate':True,'replaced':replacements}}
    data['landmarkAssetVersion']=assets['version']
    Path('outputs').mkdir(exist_ok=True)
    Path('outputs/scene.json').write_text(json.dumps(data,separators=(',',':')))
    Path('outputs/landmark-substitutions.json').write_text(json.dumps(data['authoredLandmarks'],indent=2))
    print('Prepared authored scene; Hawa Mahal generic intersections:', replacements)

if __name__=='__main__':prepare()
