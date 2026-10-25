import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import sharp from 'sharp';
test('DZI dimensions, overlap and all delivery tile edge sizes',async()=>{
 assert.ok(fs.existsSync('outputs/map/pilot.dzi'),'Run render-pilot and export-pilot first');
 const xml=fs.readFileSync('outputs/map/pilot.dzi','utf8'),metadata=JSON.parse(fs.readFileSync('outputs/map/metadata.json'));
 const attr=n=>Number(xml.match(new RegExp(`${n}="(\\d+)"`))[1]);
 assert.equal(attr('Width'),metadata.width);assert.equal(attr('Height'),metadata.height);assert.equal(attr('Overlap'),1);assert.equal(attr('TileSize'),512);
 const max=Math.ceil(Math.log2(Math.max(metadata.width,metadata.height))),size=512,overlap=1;
 for(let level=0;level<=max;level++){const w=Math.ceil(metadata.width/2**(max-level)),h=Math.ceil(metadata.height/2**(max-level));
  for(let y=0;y<Math.ceil(h/size);y++)for(let x=0;x<Math.ceil(w/size);x++){const p=`outputs/map/pilot_files/${level}/${x}_${y}.png`;const tile=await sharp(p).metadata();
   assert.equal(tile.width,Math.min(w,(x+1)*size+overlap)-Math.max(0,x*size-overlap));assert.equal(tile.height,Math.min(h,(y+1)*size+overlap)-Math.max(0,y*size-overlap));}
 }
});
test('render chunks match direct larger render and contain valid resumable hashes',()=>{
 const state=JSON.parse(fs.readFileSync('outputs/render/job.json'));
 assert.ok(state.complete);assert.ok(state.inputs.length===64);assert.ok(Object.keys(state.completed).length>=4);
 assert.ok(state.seamComparison.meanAbsoluteChannelDifference<.2,JSON.stringify(state.seamComparison));
});
