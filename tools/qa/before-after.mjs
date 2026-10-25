// Side-by-side crops of two renders that share camera, light, centre and resolution.
// Usage: node tools/qa/before-after.mjs before.png after.png outDir [x,y,w,h ...]
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const [before,after,out,...crops]=process.argv.slice(2);fs.mkdirSync(out,{recursive:true});
const label=(t,w)=>Buffer.from(`<svg width="${w}" height="44"><rect width="100%" height="100%" fill="#f6f1e4"/><text x="14" y="29" font-family="Helvetica" font-size="20" fill="#333">${t}</text></svg>`);
const regions=[['full',0,0,2048,2048],...crops.map((c,i)=>[`crop-${i+1}`,...c.split(',').map(Number)])];
for(const [name,x,y,w,h] of regions){const W=Math.min(960,w),H=Math.round(h*W/w);
 const tiles=await Promise.all([before,after].map(f=>sharp(f).extract({left:x,top:y,width:w,height:h}).resize(W,H,{kernel:w>W?'lanczos3':'nearest'}).png().toBuffer()));
 await sharp({create:{width:W*2+12,height:H+44,channels:3,background:'#f6f1e4'}}).composite([{input:label(`Before · ${path.basename(before)} · ${w}×${h}px region at (${x},${y})`,W),left:0,top:0},{input:label(`After · capital renderer · identical camera/light/resolution`,W),left:W+12,top:0},{input:tiles[0],left:0,top:44},{input:tiles[1],left:W+12,top:44}]).png().toFile(path.join(out,`before-after-${name}.png`));console.log(name);}
