import fs from 'node:fs';
import sharp from 'sharp';
import {worldToImage} from '../render/coordinates.mjs';
const out='outputs/qa';fs.mkdirSync(out,{recursive:true});
const m=JSON.parse(fs.readFileSync('outputs/render/metadata.json')),data=JSON.parse(fs.readFileSync('data/processed/pilot.json'));
const image='outputs/render/pilot.png',width=640,height=460,pad=24,heading=68;
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;');
const label=(title,sub)=>Buffer.from(`<svg width="${width}" height="${heading}"><rect width="100%" height="100%" fill="#f9f5eb"/><text x="18" y="28" font-family="sans-serif" font-size="20" fill="#423e35">${esc(title)}</text><text x="18" y="50" font-family="sans-serif" font-size="12" fill="#74695e">${esc(sub)}</text></svg>`);
const tiles=[];
async function tile(title,sub,content){const body=await sharp(content).resize(width,height,{fit:'contain',background:'#e8dfc9',kernel:'nearest'}).png().toBuffer();tiles.push(await sharp({create:{width,height:height+heading,channels:3,background:'#f9f5eb'}}).composite([{input:label(title,sub),left:0,top:0},{input:body,left:0,top:heading}]).png().toBuffer());}
async function crop(cx,cy,w,h=w){const left=Math.max(0,Math.min(m.width-w,Math.round(cx-w/2))),top=Math.max(0,Math.min(m.height-h,Math.round(cy-h/2)));return sharp(image).extract({left,top,width:w,height:h}).png().toBuffer();}
await tile('01 / Source coverage','North-up OSM geometry; gaps remain unfilled',fs.readFileSync('data/processed/coverage.svg'));
await tile('02 / Deterministic pilot · mode A','Fixed orthographic camera; © OpenStreetMap contributors',fs.readFileSync(image));
const absent=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="460"><rect width="100%" height="100%" fill="#ebe5d6"/><text x="38" y="180" font-family="sans-serif" font-size="30" fill="#846c59">Mode B not generated</text><text x="38" y="220" font-family="sans-serif" font-size="18" fill="#846c59">8 GiB unified memory cannot fit the</text><text x="38" y="250" font-family="sans-serif" font-size="18" fill="#846c59">inspected 20B Qwen image-edit checkpoint.</text><text x="38" y="300" font-family="sans-serif" font-size="16" fill="#846c59">No placeholder is presented as final artwork.</text></svg>');
await tile('03 / Polished art target · unavailable','No generated blocks; generation-block seams not applicable',absent);
for(const id of ['hawa-mahal','city-palace','jantar-mantar']){const p=m.pois.find(p=>p.id===id);await tile(p.name,id==='hawa-mahal'?'Approximate facade at mapped point; source name conflict retained':'Original detail on mapped geometry; dimensions approximate',await crop(...p.image,id==='city-palace'?660:390));}
const badi=m.pois.find(p=>p.id==='badi-chaupar');await tile('Road junction / Badi Chaupar','Real road alignments; road widths may be estimated',await crop(...badi.image,570));
const dense=worldToImage([-550,-400,0],m.transform);await tile('Dense block / courtyard audit','Mapped roofs and polygon holes; seeded details',await crop(...dense,680));
const trees=worldToImage([-40,650,0],m.transform);await tile('Vegetation / mapped park','Procedural canopy placement inside mapped green polygons',await crop(...trees,740));
const sparse=worldToImage([-700,650,0],m.transform);await tile('Questionable area / missing coverage','Few mapped footprints; no claim that this land is empty',await crop(...sparse,720));
const seamX=3072,seamY=2048,seam=await crop(seamX,seamY,700);
await tile('Delivery + render boundary / clean','512 px delivery tiles; 1024 px render chunks',seam);
const guide=Buffer.from('<svg width="700" height="700"><path d="M350 0V700M0 350H700" stroke="#ff4272" stroke-width="3" stroke-dasharray="10 7"/><text x="15" y="28" fill="#ad1645" font-family="sans-serif" font-size="18">Shared lattice boundary</text></svg>');
await tile('Same boundary / guides','Delivery overlap 1 px; rendering padding 192 px',await sharp(seam).composite([{input:guide}]).png().toBuffer());
const cols=3,rows=Math.ceil(tiles.length/cols),H=rows*(height+heading+pad)+pad+38,W=cols*(width+pad)+pad;
const composite=tiles.map((input,i)=>({input,left:pad+(i%cols)*(width+pad),top:pad+Math.floor(i/cols)*(height+heading+pad)}));
composite.push({input:Buffer.from(`<svg width="${W}" height="38"><text x="24" y="25" font-family="sans-serif" font-size="16" fill="#635747">Jaipur Pixel City · © OpenStreetMap contributors · ODbL 1.0 · Flat ground; estimated geometry; artistic landmark reconstructions</text></svg>`),left:0,top:H-38});
await sharp({create:{width:W,height:H,channels:3,background:'#e3dbcc'}}).composite(composite).png().toFile(`${out}/contact-sheet.png`);
for(const id of ['hawa-mahal','city-palace','jantar-mantar']){const p=m.pois.find(p=>p.id===id);await sharp(await crop(...p.image,id==='city-palace'?660:390)).resize(1000,1000,{kernel:'nearest'}).png().toFile(`${out}/${id}-detail.png`);}
// Ground-plane structural masks retain exact original feature IDs via RGB values.
// These are masks of source ground geometry, explicitly not visibility/roof segmentation.
const paths=[],ids={};let index=1;
const xy=p=>worldToImage([p[0],p[1],0],m.transform).map(v=>v.toFixed(3)).join(',');
for(const f of data.features){if(!['building','road','water'].includes(f.kind))continue;const color='#'+index.toString(16).padStart(6,'0');ids[index]={id:f.id,kind:f.kind};index++;
 const g=f.geometry;let polygons=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];
 for(const rings of polygons){const d=rings.map(r=>'M'+r.map(xy).join(' L')+' Z').join(' ');paths.push(`<path d="${d}" fill="${color}" fill-rule="evenodd"/>`);}
 const lines=g.type==='LineString'?[g.coordinates]:g.type==='MultiLineString'?g.coordinates:[];for(const line of lines)paths.push(`<polyline points="${line.map(xy).join(' ')}" stroke="${color}" stroke-width="${(Number(f.tags.width)||5)*m.transform.scale}" fill="none"/>`);
}
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${m.width}" height="${m.height}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#000"/>${paths.join('')}</svg>`;
fs.mkdirSync('outputs/masks',{recursive:true});fs.writeFileSync('outputs/masks/source-ground-ids.svg',svg);await sharp(Buffer.from(svg)).png().toFile('outputs/masks/source-ground-ids.png');
fs.writeFileSync('outputs/masks/ids.json',JSON.stringify({convention:'24-bit RGB integer, 0 background; ground z=0 only, no roof/occlusion inference. SVG retained for exact boundaries. Source geometry retained beyond bbox for context.',sourceHash:data.sourceHash,transform:m.transform,landmarks:m.pois.slice(0,4),ids},null,2));
console.log('Wrote outputs/qa/contact-sheet.png, landmark crops and source-ground masks.');
