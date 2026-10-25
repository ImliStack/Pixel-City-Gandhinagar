import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {imageToGround,worldToImage,project} from '../tools/render/coordinates.mjs';
const dir='outputs/visual-milestone',report=JSON.parse(fs.readFileSync(`${dir}/render-report.json`)),t=JSON.parse(fs.readFileSync(`${dir}/transform.json`));
test('Source, baseline and candidate are distinct real 2048px images',async()=>{
 const hashes=[];for(const name of ['source-geometry','baseline','artwork-candidate-v3']){const p=`${dir}/${name}.png`,m=await sharp(p).metadata();assert.equal(m.width,2048);assert.equal(m.height,2048);hashes.push(crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'));}assert.equal(new Set(hashes).size,3);
});
test('Gandhinagar geographic center and ground projection agree',()=>{
 const p=project(...report.centerLonLat,t.origin),im=worldToImage([...p,0],t);assert.ok(Math.abs(im[0]-1024)<.001);assert.ok(Math.abs(im[1]-1024)<.001);
 for(const xy of [[0,0],[2048,2048],[1024,1024],[70,1980]]){const g=imageToGround(xy,t);const q=worldToImage(g,t);assert.ok(Math.hypot(q[0]-xy[0],q[1]-xy[1])<1e-8);}
 assert.ok(report.centerLonLat[0]>72.63&&report.centerLonLat[0]<72.65);assert.ok(report.centerLonLat[1]>23.22&&report.centerLonLat[1]<23.24);
});
test('Cached geographic inputs and render provenance match',()=>{
 const hash=crypto.createHash('sha256').update(fs.readFileSync('data/raw/gandhinagar.overpass.json')).digest('hex');assert.equal(report.sourceHash,hash);assert.equal(report.model,null);assert.equal(report.checkpoint,null);assert.equal(report.milestonePassed,false);for(const run of report.runs)assert.deepEqual(run.externalRequests,[]);
});
test('Adjacent padded regions remain continuous, with numerical limits disclosed',()=>{
 assert.ok(report.continuity.meanAbsoluteChannelDifference<.05);assert.ok(report.continuity.seamBandMeanAbsoluteDifference<.05);assert.ok(report.continuity.changedChannelFraction<.005);assert.match(report.continuity.generationRegions,/not tested/);
});
test('Three requested video-frame comparisons exist with explicit crop scales',async()=>{
 const c=JSON.parse(fs.readFileSync(`${dir}/comparison-settings.json`));assert.deepEqual(c.comparisons.map(v=>v.time),['00','04','38']);for(const v of c.comparisons){const m=await sharp(`${dir}/comparison-${v.time}.png`).metadata();assert.equal(m.width,1536);assert.equal(m.height,848);assert.ok(v.referenceDisplayScale>0&&v.candidateDisplayScale>0);}
});
