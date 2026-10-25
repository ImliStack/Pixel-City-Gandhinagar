#!/usr/bin/env python3
"""Prepare local sample surfaces from cached verified OSM geometry."""
import json, math, hashlib
from pathlib import Path
from shapely.geometry import shape, mapping, Point, Polygon
from shapely.geometry.polygon import orient
from shapely.ops import unary_union
from pyproj import Transformer

import argparse


def build(c,p,features):
 """Scene for the features intersecting one camera window (or region). Shared by sample, pilot and city regions."""
 cx,cy=c['centerWorld']
 roads=[];widths={'motorway':24,'trunk':20,'primary':18,'primary_link':10,'secondary':13,'secondary_link':9,'tertiary':10,'tertiary_link':8,'residential':6,'living_street':5,'service':4,'unclassified':6,'track':3,'pedestrian':5,'footway':1.8,'path':1.5,'steps':1.8,'cycleway':2}
 for f in features:
  if f['kind']!='road' or f['geometry']['type'] not in ('LineString','MultiLineString'):continue
  if f['tags'].get('tunnel')=='yes':continue
  g=shape(f['geometry']);typ=f['tags'].get('highway','residential')
  try: width=float(f['tags'].get('width',widths.get(typ,6)))
  except ValueError:width=widths.get(typ,6)
  roads.append({'id':f['id'],'tags':f['tags'],'geometry':f['geometry'],'width':width,'widthSource':'tag' if 'width' in f['tags'] else 'typology-estimate','footway':typ in ('footway','path','steps','cycleway')})
 road_union=unary_union([shape(r['geometry']).buffer(r['width']/2,cap_style=1,join_style=1) for r in roads if not r['footway']])
 sidewalk_union=unary_union([shape(r['geometry']).buffer(r['width']/2+1.65,cap_style=1,join_style=1) for r in roads if not r['footway']])
 buildings=[]
 for f in features:
  if f['kind']!='building' or f.get('renderVisible') is False:continue
  g=shape(f['geometry']);parts=list(g.geoms) if g.geom_type=='MultiPolygon' else [g]
  for i,part in enumerate(parts):
   if part.geom_type!='Polygon':continue
   part=orient(part,sign=1.0);center=part.representative_point();roofsafe=part.buffer(-1.1)
   coords=list(part.exterior.coords);entries=[]
   for j in range(len(coords)-1):entries.append(Point((coords[j][0]+coords[j+1][0])/2,(coords[j][1]+coords[j+1][1])/2).distance(road_union))
   h=f['height'];hsource=f['heightSource']
   if f['id'] in c.get('heightOverrides',{}):h=c['heightOverrides'][f['id']]['height'];hsource='documented-override'
   # Untagged footprints: graded by area instead of one 9.6 m default (kiosk/shed, 1-storey, 2-storey, 3-storey block, large low shed).
   if hsource=='typology-estimate' and f['tags'].get('building','yes') in ('yes','residential','house','detached','hut','shed','construction'):
    a=part.area;h=3.2 if a<35 else 4.4 if a<90 else 6.4 if a<260 else 9.6 if a<1500 else (7.2 if f['tags'].get('building','yes')=='yes' else 12.8);hsource='area-graded-typology-estimate'
   if f['tags'].get('building')=='water_tower' and hsource=='typology-estimate':h=18.0;hsource='typology-estimate'
   buildings.append({'id':f['id']+(f'/{i}' if len(parts)>1 else ''),'geometry':mapping(part),'height':h,'heightSource':hsource,'tags':f['tags'],'area':part.area,'center':[center.x,center.y],'entryEdge':entries.index(min(entries)),'roofSafe':mapping(roofsafe),'roofEquipmentSafe':mapping(part.buffer(-3.0)),'centroid':[part.centroid.x,part.centroid.y]})
 greens=[f for f in features if f['kind']=='park' and f['geometry']['type'] in ('Polygon','MultiPolygon') and f['tags'].get('leisure') not in ('pitch','playground')]
 inv=Transformer.from_crs(p['crs']['projected'],'EPSG:4326',always_xy=True)
 lon,lat=inv.transform(cx+p['origin']['easting'],cy+p['origin']['northing'])
 result={'config':c,'origin':p['origin'],'crs':p['crs'],'centerLonLat':[lon,lat],'buildings':buildings,'roads':roads,'greens':greens,'roadSurface':mapping(road_union),'sidewalkSurface':mapping(sidewalk_union),'sourceHash':p['sourceHash'],'sourceFeatures':features,'assumptions':['Buildings without height or levels get an area-graded estimate (3.2–12.8 m); supplied levels use 3.2 m/floor.','Facades, roof objects, typology styling, plot walls, street lamps and all planting except OSM tree nodes are authored illustrations, not surveyed data.','Road widths without tags and adjacent sidewalk widths are inferred.','No new buildings, roads, water bodies or landmark structures are introduced.']}
 return result



if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--config',default='config/sample.json');args=parser.parse_args()
 c=json.loads(Path(args.config).read_text());p=json.loads(Path(c.get('input','data/processed/gandhinagar/pilot.json')).read_text());cx,cy=c['centerWorld']
 context=Point(cx,cy).buffer(c.get('contextRadius',420))
 result=build(c,p,[f for f in p['features'] if shape(f['geometry']).intersects(context)])
 out=Path(c.get('output','outputs/visual-milestone'));out.mkdir(exist_ok=True,parents=True)
 (out/'scene.json').write_text(json.dumps(result,separators=(',',':')))
 print(json.dumps({'centerLonLat':result['centerLonLat'],'contextBuildings':len(result['buildings']),'roads':len(result['roads']),'greenPolygons':len(result['greens']),'sourceHash':p['sourceHash']},indent=2))
