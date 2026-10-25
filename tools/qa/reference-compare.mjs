// Side-by-side crops: reference video frames vs the active-city render at an estimated comparable object scale.
// Reference px/m values are manual estimates from tree-crown and road widths, not a registration.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {worldToImage} from '../render/coordinates.mjs';
const cfg=JSON.parse(fs.readFileSync(process.argv[2]||'config/cities/gandhinagar.json'));
const job=JSON.parse(fs.readFileSync(`${cfg.output}/render-A/job.json`)),t=job.scene.transform,scene=JSON.parse(fs.readFileSync(`${cfg.output}/scene.json`));
const refDir='outputs/visual-milestone/reference',out=path.join(cfg.output,'reference-comparisons');fs.mkdirSync(out,{recursive:true});
const centroid=g=>{const r=g.type==='Polygon'?g.coordinates[0]:g.coordinates[0][0];return [r.reduce((a,p)=>a+p[0],0)/r.length,r.reduce((a,p)=>a+p[1],0)/r.length];};
const area=g=>{const r=g.type==='Polygon'?g.coordinates[0]:g.coordinates[0][0];let a=0;for(let i=1;i<r.length;i++)a+=r[i-1][0]*r[i][1]-r[i][0]*r[i-1][1];return Math.abs(a/2);};
const parking=scene.sourceFeatures.filter(f=>f.tags.amenity==='parking'&&f.geometry.type!=='Point').sort((a,b)=>area(b.geometry)-area(a.geometry)).map(f=>worldToImage([...centroid(f.geometry),0],t));
const assembly=scene.buildings.find(b=>b.id===cfg.focalAsset.sourceId);
const fountain=scene.sourceFeatures.find(f=>f.kind==='water');
const sets=[
 {time:'00',refPxPerM:4.4,ref:[380,230,1200,900],at:worldToImage([...assembly.centroid,10],t),topic:'Civic square / institutional building + trees',ours:'Vithalbhai Patel Bhavan and Swarnim Sankul'},
 {time:'04',refPxPerM:3.0,ref:[250,500,1200,900],at:worldToImage([...centroid(fountain.geometry),0],t),topic:'Park, lake, dense foliage',ours:'Swarnim Park with the mapped Musical Fountain pond'},
 {time:'10',refPxPerM:3.1,ref:[300,250,1200,900],at:parking[0],topic:'Stadium, parking, road detail',ours:'Largest mapped parking lot and adjacent roads (no stadium in coverage)'},
 {time:'26',refPxPerM:3.3,ref:[300,300,1200,900],at:[4700,3900],topic:'Complex buildings, infrastructure',ours:'Metro Line 2 viaduct over the road median'},
 {time:'38',refPxPerM:7.0,ref:[300,300,1200,900],at:[5480,520],topic:'Low-rise housing, roofs, greenery',ours:'Sector housing blocks'},
];
const W=960,H=720,label=s=>Buffer.from(`<svg width="${W*2+12}" height="40"><rect width="100%" height="100%" fill="#f6f1e4"/><text x="10" y="26" font-family="Helvetica" font-size="17" fill="#333">${s.replace(/&/g,'&amp;')}</text></svg>`);
const report=[];
for(const s of sets){const f=s.refPxPerM/cfg.pixelsPerMetre,sw=Math.round(s.ref[2]/f),sh=Math.round(s.ref[3]/f),sx=Math.max(0,Math.min(cfg.width-sw,Math.round(s.at[0]-sw/2))),sy=Math.max(0,Math.min(cfg.height-sh,Math.round(s.at[1]-sh/2)));
 const ref=await sharp(path.join(refDir,`frame-${s.time}.png`)).extract({left:s.ref[0],top:s.ref[1],width:s.ref[2],height:s.ref[3]}).resize(W,H).png().toBuffer();
 const ours=await sharp(`${cfg.output}/render-A/map.png`,{limitInputPixels:false}).extract({left:sx,top:sy,width:sw,height:sh}).resize(W,H,{kernel:'lanczos3'}).png().toBuffer();
 const file=path.join(out,`compare-${s.time}.png`);
 await sharp({create:{width:W*2+12,height:H+40,channels:3,background:'#f6f1e4'}}).composite([{input:label(`Video ${s.time}s · ${s.topic}  |  Gandhinagar A · ${s.ours} · ≈${s.refPxPerM} px/m both`),left:0,top:0},{input:ref,left:0,top:40},{input:ours,left:W+12,top:40}]).png().toFile(file);
 report.push({...s,file,oursRegion:[sx,sy,sw,sh],scaleFactorAppliedToOurs:f});console.log(file);}
fs.writeFileSync(path.join(out,'settings.json'),JSON.stringify({method:'Manual comparable object scale (crown and lane widths); different cities and architecture; not a style score.',comparisons:report},null,2));
