import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {cameraTransform,worldToImage,imageToGround,project} from '../tools/render/coordinates.mjs';
const config=JSON.parse(fs.readFileSync('config/pilot.json'));
test('orthographic ground round trips and known basis',()=>{
 const t=cameraTransform([-1000,-1100,1000,1100],config);
 for(const p of [[0,0,0],[800,-500,0],[-900,1000,0],[100,200,25]]){
  const restored=imageToGround(worldToImage(p,t),t,p[2]);p.forEach((v,i)=>assert.ok(Math.abs(v-restored[i])<1e-9));
 }
 assert.ok(worldToImage([100,0,0],t)[0]>worldToImage([0,0,0],t)[0]);
 assert.ok(worldToImage([0,100,0],t)[1]<worldToImage([0,0,0],t)[1]);
 assert.notDeepEqual(imageToGround(worldToImage([0,0,25],t),t),[0,0,25]);
});
test('Python pyproj agrees with JS proj4 on landmark and bounding points',()=>{
 const points=[[75.825,26.925],[75.8267,26.9239],[75.8237,26.9248],[75.815,26.915],[75.835,26.935]];
 const py=JSON.parse(execFileSync('.venv/bin/python',['-c',`import json;from pyproj import Transformer;t=Transformer.from_crs(4326,32643,always_xy=True);print(json.dumps([t.transform(*p) for p in ${JSON.stringify(points)}]))`],{encoding:'utf8'}));
 for(let i=0;i<points.length;i++){const js=project(...points[i],{easting:0,northing:0});js.forEach((v,k)=>assert.ok(Math.abs(v-py[i][k])<0.001));}
});
test('POI image positions use shared transform and remain in generated coverage',()=>{
 if(!fs.existsSync('outputs/render/metadata.json'))return;
 const m=JSON.parse(fs.readFileSync('outputs/render/metadata.json'));
 for(const poi of m.pois){const p=project(poi.lon,poi.lat,m.transform.origin),im=worldToImage([...p,0],m.transform);assert.ok(Math.hypot(im[0]-poi.image[0],im[1]-poi.image[1])<.01);assert.ok(im[0]>=0&&im[0]<=m.width&&im[1]>=0&&im[1]<=m.height);}
});
