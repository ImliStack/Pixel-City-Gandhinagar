// Export rendered modes of the active city to local Deep Zoom (WebP, 512px, overlap 1) plus viewer metadata.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import proj4 from 'proj4';
import {CATEGORIES,categoryOf} from './categories.mjs';
import {worldToImage,project,UTM} from '../render/coordinates.mjs';
import {buildPyramid} from '../city/pyramid.mjs';
// --config/--data override config/active.json, e.g. to re-export the capital pilot while the city is active.
const argOf=k=>{const i=process.argv.indexOf(k);return i>=0?process.argv[i+1]:null;},active=JSON.parse(fs.readFileSync('config/active.json'));
const cfg=JSON.parse(fs.readFileSync(argOf('--config')||active.cityConfig)),data=JSON.parse(fs.readFileSync(argOf('--data')||active.dataConfig));
const root=cfg.output,out=path.join('outputs/maps',cfg.mapId);fs.mkdirSync(out,{recursive:true});
sharp.cache({memory:64,files:20,items:50});sharp.concurrency(2);
// City mode (cfg.regionChunks): chunks of one global lattice rendered region by region; tiles come straight from chunks.
const city=!!cfg.regionChunks,layout=city?JSON.parse(fs.readFileSync(path.join(root,'layout.json'))):null;
if(city){cfg.width=layout.width;cfg.height=layout.height;}
const job=JSON.parse(fs.readFileSync(path.join(root,'render-A/job.json')));if(!job.complete)throw new Error('render-A incomplete; run npm run render-pilot');
const pilot=JSON.parse(fs.readFileSync(cfg.input));
const cameraTransform=()=>{const a=cfg.camera.azimuth*Math.PI/180,e=cfg.camera.elevation*Math.PI/180;return{right:[Math.cos(a),Math.sin(a),0],up:[-Math.sin(a)*Math.sin(e),Math.cos(a)*Math.sin(e),Math.cos(e)],eye:[Math.sin(a)*Math.cos(e),-Math.cos(a)*Math.cos(e),Math.sin(e)],scale:cfg.pixelsPerMetre,minU:layout.minU,maxV:layout.maxV,width:layout.width,height:layout.height,groundZ:0,origin:pilot.origin,crs:'EPSG:32643',azimuth:cfg.camera.azimuth,elevation:cfg.camera.elevation,pixelOrigin:'top-left; continuous image-edge coordinates'};};
const t=city?cameraTransform():job.scene.transform;
const LAYER_LABELS={A:'Summer day',night:'Night',monsoon:'Monsoon',winter:'Winter morning',B:'Pixel edge',source:'Source geometry'};
const version=`${cfg.version}-${job.inputs.slice(0,10)}`,layers={};
const only=process.argv.includes('--layers')?process.argv[process.argv.indexOf('--layers')+1].split(','):null;
for(const mode of ['A','B','source','night','monsoon','winter']){const src=path.join(root,`render-${mode}/map.png`),j=path.join(root,`render-${mode}/job.json`);if(!fs.existsSync(j)||!JSON.parse(fs.readFileSync(j)).complete||(!city&&!fs.existsSync(src)))continue;
 const base=path.join(out,mode);
 if(city){if(!only||only.includes(mode)){const t0=Date.now();const r=await buildPyramid({chunkDir:path.join(root,`render-${mode}`),width:cfg.width,height:cfg.height,chunk:cfg.chunkSize,tileSize:cfg.tileSize,overlap:cfg.tileOverlap,out:base,workDir:path.join(root,'pyramid-work',mode),quality:88,log:m=>console.log(mode,m)});console.log('exported',mode,r,(Date.now()-t0)/1000+'s');}
  if(fs.existsSync(base+'.dzi'))layers[mode]={dzi:`${mode}.dzi`,label:LAYER_LABELS[mode],group:['A','night','monsoon','winter'].includes(mode)?'scene':'style',renderInputs:JSON.parse(fs.readFileSync(j)).inputs};continue;}
 fs.rmSync(base+'_files',{recursive:true,force:true});
 // Sharp appends .dzi itself; the basename must not include it.
 await sharp(src,{limitInputPixels:cfg.maxOutputPixels}).webp({quality:90,effort:4,smartSubsample:true}).tile({size:cfg.tileSize,overlap:cfg.tileOverlap,layout:'dz',container:'fs',depth:'onepixel'}).toFile(base);
 layers[mode]={dzi:`${mode}.dzi`,label:LAYER_LABELS[mode],group:['A','night','monsoon','winter'].includes(mode)?'scene':'style',renderInputs:JSON.parse(fs.readFileSync(j)).inputs};console.log('exported',mode);}
if(city){const lvl=Math.ceil(Math.log2(Math.max(cfg.width,cfg.height)))-Math.ceil(Math.log2(Math.max(cfg.width,cfg.height)/1024));await sharp(path.join(root,'pyramid-work/A',String(lvl),'0-0.png')).resize(512).webp({quality:85}).toFile(path.join(out,'minimap.webp'));}
else await sharp(path.join(root,'render-A/map.png'),{limitInputPixels:false}).resize(512).webp({quality:85}).toFile(path.join(out,'minimap.webp'));
// Coverage: acquisition bbox projected to the ground plane, and the rendered extent.
// Coverage: the four acquisition-bbox corners projected (UTM 43N) onto the ground plane.
const [w,so,e,n]=data.bbox,coverage=[[w,so],[e,so],[e,n],[w,n]].map(([lon,lat])=>worldToImage([...project(lon,lat,pilot.origin),0],t));
const feature=id=>pilot.features.find(f=>f.id===id),centroid=g=>{const pts=g.type==='Point'?[g.coordinates]:g.type==='LineString'?g.coordinates:(g.type==='Polygon'?g.coordinates[0]:g.coordinates[0][0]);return [pts.reduce((a,p)=>a+p[0],0)/pts.length,pts.reduce((a,p)=>a+p[1],0)/pts.length];};
const inImage=p=>p[0]>=0&&p[1]>=0&&p[0]<=cfg.width&&p[1]<=cfg.height;
const toLonLat=(x,y)=>proj4(UTM,'EPSG:4326',[x+pilot.origin.easting,y+pilot.origin.northing]);
// Anchor: centroid (at roof height for buildings); for areas whose centroid falls outside the render, the mean of their in-image vertices.
const place=f=>{const [x,y]=centroid(f.geometry),z=f.kind==='building'?(f.height||0):0,image=worldToImage([x,y,z],t);if(inImage(image))return{x,y,z,image};
 if(!['Polygon','MultiPolygon'].includes(f.geometry.type))return null;const ring=(f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates).flatMap(p=>p[0]).filter(q=>inImage(worldToImage([...q,0],t)));if(ring.length<3)return null;
 const m=[ring.reduce((a,q)=>a+q[0],0)/ring.length,ring.reduce((a,q)=>a+q[1],0)/ring.length];return{x:m[0],y:m[1],z:0,image:worldToImage([...m,0],t),partial:true};};
const pois=[];
for(const c of cfg.curated||[]){const f=feature(c.sourceId);if(!f)continue;c.category??=categoryOf(f.tags);let g=f.geometry;if(c.kind==='infrastructure'&&g.type==='LineString'){const pts=g.coordinates.map(p=>worldToImage([...p,11],t)).filter(inImage);if(!pts.length)continue;const m=pts[Math.floor(pts.length/2)];pois.push({...c,image:m,curated:true});continue;}
 const anchor=place(f);if(!anchor)continue;const [lon,lat]=toLonLat(anchor.x,anchor.y);pois.push({...c,...anchor,lon,lat,curated:true});}
// Every named feature, plus every unnamed feature that falls into a viewer category (labelled generically).
// Metro stations are railway features; other railway geometry and roads are skipped.
for(const f of pilot.features){const tags=f.tags||{},category=categoryOf(tags),name=tags.name||(category&&CATEGORIES.find(c=>c.id===category).singular);
 // Roads only as bus stops; railway geometry only as stations. Same-named stops of one station collapse to one pin.
 if(!name||(f.kind==='road'&&category!=='bus')||(f.kind==='railway'&&!['metro','rail'].includes(category))||pois.some(p=>p.sourceId===f.id))continue;
 const anchor=place(f);if(!anchor)continue;
 const [lon,lat]=toLonLat(anchor.x,anchor.y);pois.push({...anchor,id:f.id.replace('/','-'),sourceId:f.id,lon,lat,name,gujarati:tags['name:gu'],hindi:tags['name:hi'],category,unnamed:!tags.name||undefined,kind:f.kind==='poi'?(tags.amenity||tags.shop||tags.healthcare||tags.tourism||tags.place||'place'):f.kind});}
// Collapse duplicates: same name and category within 400 m (station + platform nodes, building + site outlines).
{const keep=[];for(const p of pois){const twin=keep.find(q=>q.name===p.name&&(q.category||q.kind)===(p.category||p.kind)&&Math.hypot((q.x??0)-(p.x??0),(q.y??0)-(p.y??0))<400);if(!twin){keep.push(p);continue;}if(p.curated&&!twin.curated)keep[keep.indexOf(twin)]=p;}pois.length=0;pois.push(...keep);}
// Common local names not present as OSM names/aliases.
const ALIASES={'Sachivalaya':['Secretariat','New Sachivalaya'],'Vithalbhai Patel Bhavan':['Vidhan Sabha','Assembly','Gujarat Legislative Assembly'],'Civil Hospital':['GMERS Civil Hospital'],'Gandhinagar Railway Station':['Gandhinagar Capital Station','Railway station'],'Mahatma Mandir':['Convention Centre']};
for(const p of pois){const extra=ALIASES[p.name];if(extra)p.aliases=[...new Set([...(p.aliases||[]),...extra])];}
const streets=new Map();for(const f of pilot.features){const name=f.tags?.name;if(f.kind!=='road'||!name)continue;const pairs=c=>typeof c[0]==='number'?[c]:c.flatMap(pairs),pts=pairs(f.geometry.coordinates).map(p=>worldToImage([...p,0],t)).filter(inImage);if(!pts.length)continue;if(!streets.has(name))streets.set(name,[]);streets.get(name).push(...pts);}
for(const [name,pts] of streets){const m=pts[Math.floor(pts.length/2)];pois.push({id:'street-'+name.toLowerCase().replace(/[^a-z0-9]+/g,'-'),name,kind:'street',image:m});}
const categories=CATEGORIES.map(({id,label})=>({id,label,count:pois.filter(p=>p.category===id).length})).filter(c=>c.count);
const metadata={schema:2,categories,city:cfg.city,mapId:cfg.mapId,version,title:cfg.title,subtitle:cfg.subtitle,width:cfg.width,height:cfg.height,tileSize:cfg.tileSize,overlap:cfg.tileOverlap,format:'webp',layers,dzi:layers.A.dzi,mode:'deterministic WebGL render',artAvailable:false,
 artNote:'No local image-generation model was run. All layers are deterministic WebGL renders of the same geometry: summer day (A), night (emissive windows, street lamps), monsoon (overcast, wet, greener), winter morning (low sun, drier, some deciduous colour), B (A + restrained 1px edge pass) and source geometry. The reference-video artwork target is not met.',
 minimap:'minimap.webp',coverage:{polygon:coverage,bbox:data.bbox,note:'Dashed line: projected extent of the cached OSM acquisition. Blank or open ground may be missing source data.'},pois,transform:{...t,origin:pilot.origin},
 attribution:'© OpenStreetMap contributors · ODbL 1.0',geometryNote:'Flat ground. Heights from building:levels × 3.2 m or typology estimates. Facades, roof equipment, landmark roofs, ground texture and planting outside mapped parks are authored artistic approximations.',
 render:city?{hardware:job.hardware,chrome:job.chromeVersion,renderer:job.renderer,regions:Object.keys(job.regions).length,chunks:Object.values(job.chunks).filter(c=>c.hash).length,seam:job.seamComparison,seconds:job.sessions.reduce((a,x)=>a+x.seconds,0),peakProcessTreeRssBytes:Math.max(...job.sessions.map(x=>x.peakProcessTreeRssBytes||0))}:{hardware:job.hardware,chrome:job.chromeVersion,three:job.scene.three,renderer:job.scene.renderer,counts:job.scene.counts,seam:job.seamComparison,seconds:job.sessions.at(-1).seconds,peakProcessTreeRssBytes:job.sessions.at(-1).peakProcessTreeRssBytes}};
fs.writeFileSync(path.join(out,'metadata.json'),JSON.stringify(metadata,null,1));
fs.writeFileSync(path.join(out,'ATTRIBUTION.txt'),'© OpenStreetMap contributors. OpenStreetMap database licensed under ODbL 1.0. https://www.openstreetmap.org/copyright\nProduced work: original deterministic rendering by Pixel City. Estimated heights, flat ground, authored facades/roofs/planting.\n');
// Index of every exported map for the viewer's map list.
const idx=fs.readdirSync('outputs/maps',{withFileTypes:true}).filter(d=>d.isDirectory()&&fs.existsSync(path.join('outputs/maps',d.name,'metadata.json'))).map(d=>{const m=JSON.parse(fs.readFileSync(path.join('outputs/maps',d.name,'metadata.json')));return{id:d.name,title:m.title,subtitle:m.subtitle,width:m.width,height:m.height,version:m.version};});
fs.writeFileSync('outputs/maps/index.json',JSON.stringify(idx,null,1));
const publicDir='apps/viewer/public',link=path.join(publicDir,'maps');if(!fs.existsSync(link))fs.symlinkSync(path.relative(publicDir,'outputs/maps'),link,'dir');
let bytes=0,count=0;(function walk(p){for(const d of fs.readdirSync(p,{withFileTypes:true})){const q=path.join(p,d.name);if(d.isDirectory())walk(q);else{bytes+=fs.statSync(q).size;count++;}}})(out);
const report={mapId:cfg.mapId,version,layers:Object.keys(layers),files:count,bytes,pois:pois.length,peakRssBytes:process.resourceUsage().maxRSS*1024};fs.writeFileSync(path.join(out,'export-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
