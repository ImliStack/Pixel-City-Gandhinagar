// Overview / neighbourhood / close-up / chunk-boundary diagnostics for the active city render.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {worldToImage} from '../render/coordinates.mjs';
const cfg=JSON.parse(fs.readFileSync(process.argv[2]||'config/cities/gandhinagar.json')),root=cfg.output,out=path.join(root,'diagnostics');fs.mkdirSync(out,{recursive:true});
const job=JSON.parse(fs.readFileSync(path.join(root,'render-A/job.json'))),t=job.scene.transform,scene=JSON.parse(fs.readFileSync(path.join(root,'scene.json')));
const modes=['source','A','B'].filter(m=>fs.existsSync(path.join(root,`render-${m}/map.png`)));
const at=id=>{const b=scene.buildings.find(b=>b.id===id||b.id.startsWith(id+'/'));return worldToImage([...b.centroid,b.height*.5],t).map(Math.round);};
const vpix=scene.sourceFeatures.filter(f=>f.tags?.bridge==='viaduct').flatMap(f=>f.geometry.coordinates.map(p=>worldToImage([...p,11],t))).filter(([x,y])=>x>=0&&y>=0&&x<cfg.width&&y<cfg.height);const vimg=vpix.length>1?[vpix[0][0]*.55+vpix[1][0]*.45,vpix[0][1]*.55+vpix[1][1]*.45]:[cfg.width/2,cfg.height/2];
const clamp=(x,y,w,h)=>[Math.max(0,Math.min(cfg.width-w,Math.round(x-w/2))),Math.max(0,Math.min(cfg.height-h,Math.round(y-h/2))),w,h];
const views={
 'neighbourhood-housing':clamp(...worldToImage([-650,1250,0],t),1536,1024),
 'closeup-assembly':clamp(...at(cfg.focalAsset.sourceId),640,480),
 'closeup-housing':clamp(...worldToImage([-520,1300,0],t),480,360),
 'closeup-metro':clamp(...vimg,640,480),
 'boundary-3072-3072':[3072-320,3072-240,640,480],
};
const label=(s,w)=>Buffer.from(`<svg width="${w}" height="34"><rect width="100%" height="100%" fill="#f6f1e4"/><text x="10" y="23" font-family="Helvetica" font-size="16" fill="#333">${s}</text></svg>`);
const report={views,modes,files:[]};
for(const [name,[x,y,w,h]] of Object.entries(views)){
 const scaleUp=w<=640?2:1,W=w*scaleUp,H=h*scaleUp,parts=[];let left=0;
 for(const m of modes){let img=sharp(path.join(root,`render-${m}/map.png`),{limitInputPixels:false}).extract({left:x,top:y,width:w,height:h}).resize(W,H,{kernel:'nearest'});
  if(name.startsWith('boundary'))img=sharp(await img.png().toBuffer()).composite([{input:Buffer.from(`<svg width="${W}" height="${H}"><path d="M${(3072-x)*scaleUp} 0V${H}M0 ${(3072-y)*scaleUp}H${W}" stroke="#f4506c" stroke-width="1" stroke-dasharray="6 6" opacity=".7"/></svg>`)}]);
  parts.push({input:label(`${m==='source'?'Source geometry':m==='A'?'A · stylised render':'B · restrained pixel/edge'} · ${name} · (${x},${y}) ${w}×${h}px ×${scaleUp}`,W),left,top:0},{input:await img.png().toBuffer(),left,top:34});left+=W+10;}
 const file=path.join(out,`${name}.png`);await sharp({create:{width:left-10,height:H+34,channels:3,background:'#f6f1e4'}}).composite(parts).png().toFile(file);report.files.push(file);console.log(file);}
await sharp(path.join(root,'render-A/map.png'),{limitInputPixels:false}).resize(1536).png().toFile(path.join(out,'overview-A.png'));
fs.writeFileSync(path.join(out,'diagnostics.json'),JSON.stringify(report,null,2));
