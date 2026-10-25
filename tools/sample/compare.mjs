import fs from 'node:fs';
import sharp from 'sharp';
import {worldToImage} from '../render/coordinates.mjs';
const out='outputs/visual-milestone',data=JSON.parse(fs.readFileSync(`${out}/scene.json`)),t=JSON.parse(fs.readFileSync(`${out}/transform.json`));
const candidateFile='artwork-candidate-v3';
const xy=p=>worldToImage([p[0],p[1],0],t).map(n=>n.toFixed(2)).join(',');
const polygons=g=>g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];
const paths=[];function poly(g,fill,stroke='none'){for(const rings of polygons(g))paths.push(`<path d="${rings.map(r=>'M'+r.map(xy).join(' L')+' Z').join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="1" fill-rule="evenodd"/>`);}
poly(data.sidewalkSurface,'#dbd5c7');poly(data.roadSurface,'#667883');for(const f of data.greens)poly(f.geometry,'#8da96c');for(const f of data.buildings)poly(f.geometry,'#d5a67d','#8b6249');
const source=`<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="2048"><rect width="100%" height="100%" fill="#f1ecdd"/>${paths.join('')}</svg>`;fs.writeFileSync(`${out}/source-geometry.svg`,source);await sharp(Buffer.from(source)).png().toFile(`${out}/source-geometry.png`);
async function caption(image,title,subtitle,w=768,h=768){const img=await sharp(image).resize(w,h,{fit:'contain',background:'#ede8db'}).png().toBuffer();const header=Buffer.from(`<svg width="${w}" height="80"><rect width="100%" height="100%" fill="#f7f3e9"/><text x="20" y="32" font-family="sans-serif" font-size="22" fill="#333d39">${title}</text><text x="20" y="59" font-family="sans-serif" font-size="13" fill="#686c61">${subtitle}</text></svg>`);return sharp({create:{width:w,height:h+80,channels:3,background:'#f7f3e9'}}).composite([{input:header,left:0,top:0},{input:img,left:0,top:80}]).png().toBuffer();}
const stages=[['source-geometry','Source geometry','OSM ground geometry · same camera and extent'],['baseline','Baseline','Unadorned footprint extrusion · incomplete visual result'],[candidateFile,'Detailed candidate v3 · not approved','Original geometry · © OpenStreetMap contributors · ODbL 1.0']];
await sharp({create:{width:2304,height:880,channels:3,background:'#e3ddcf'}}).composite(await Promise.all(stages.map(async([file,title,sub],i)=>({input:await caption(`${out}/${file}.png`,title,sub),left:i*768,top:0})))).png().toFile(`${out}/stages.png`);
if([1,2].every(v=>fs.existsSync(`${out}/artwork-candidate-v${v}.png`)))await sharp({create:{width:1536,height:848,channels:3,background:'#e3ddcf'}}).composite(await Promise.all([1,2].map(async(v,i)=>({input:await caption(`${out}/artwork-candidate-v${v}.png`,`Candidate v${v}`,v===1?'First detail pass':'More crown lobes, leaf clusters, roof equipment and roof seams'),left:i*768,top:0})))).png().toFile(`${out}/iteration.png`);
// Full native reference frames are retained. These crops exclude most browser UI.
// Comparable visual scale uses ordinary roof widths, not a false common geographic scale across cities.
const referenceCrops=[{time:'00',left:1220,top:650,width:650,height:650,sample:{left:440,top:500,width:650,height:650},note:'Roof/crown detail; civic and residential building types differ'},
 {time:'04',left:680,top:420,width:650,height:650,sample:{left:800,top:750,width:650,height:650},note:'Crown/ground reading; reference park is much denser'},
 {time:'38',left:670,top:510,width:650,height:650,sample:{left:580,top:600,width:650,height:650},note:'Domestic roof widths approximately normalized; different cities'}];
const manifest=[];
for(const spec of referenceCrops){const ref=await sharp(`${out}/reference/frame-${spec.time}.png`).extract({left:spec.left,top:spec.top,width:spec.width,height:spec.height}).png().toBuffer(),candidate=await sharp(`${out}/${candidateFile}.png`).extract(spec.sample).png().toBuffer();
 const panels=[await caption(ref,`Video reference · 00:${spec.time}`,spec.note),await caption(candidate,'Gandhinagar candidate · not passed','Comparable apparent scale · © OpenStreetMap contributors · ODbL 1.0')];await sharp({create:{width:1536,height:848,channels:3,background:'#f7f3e9'}}).composite(panels.map((input,i)=>({input,left:i*768,top:0}))).png().toFile(`${out}/comparison-${spec.time}.png`);manifest.push({...spec,referenceDisplayScale:768/spec.width,candidateDisplayScale:768/spec.sample.width});}
fs.writeFileSync(`${out}/comparison-settings.json`,JSON.stringify({method:'Manual comparable apparent building/crown width; not a geographic registration or objective style score. Reference architecture differs. Review full-resolution sources as well.',comparisons:manifest},null,2));
const note='© OpenStreetMap contributors · ODbL 1.0. Original procedural details are inferred. Video frames supplied by user; research-only comparisons. No visual milestone pass claimed.\n';fs.writeFileSync(`${out}/ATTRIBUTION.txt`,note);
console.log('Created source geometry, stage sheet, iteration sheet and 00:00 / 00:04 / 00:38 comparisons.');
