import * as T from 'three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPixelatedPass} from 'three/addons/postprocessing/RenderPixelatedPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
const data=await(await fetch(new URLSearchParams(location.search).get('scene')||'/outputs/visual-milestone/scene.json')).json(),cfg=data.config;
const mode=new URLSearchParams(location.search).get('mode')||'detail',detail=mode==='detail',revision=Number(new URLSearchParams(location.search).get('revision')||2);
const renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true,powerPreference:'low-power'});renderer.setPixelRatio(1);renderer.outputColorSpace=T.SRGBColorSpace;renderer.setClearColor('#dfd8bf');renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;document.body.append(renderer.domElement);
const scene=new T.Scene();
const sky=new T.HemisphereLight(revision>=3?0x8db4d7:0xc8e1ff,0x637965,detail?(revision>=3?1.05:1.7):1.6);sky.position.set(0,0,1);scene.add(sky);
const sun=new T.DirectionalLight(0xfff2d5,detail?(revision>=3?3.5:3.1):2.0);sun.position.set(cfg.centerWorld[0]+cfg.light.east,cfg.centerWorld[1]+cfg.light.north,cfg.light.up);sun.target.position.set(...cfg.centerWorld,0);scene.add(sun.target);scene.add(sun);sun.castShadow=true;sun.shadow.mapSize.setScalar(cfg.shadowMapSize);Object.assign(sun.shadow.camera,{left:-(cfg.shadowExtent||450),right:cfg.shadowExtent||450,top:cfg.shadowExtent||450,bottom:-(cfg.shadowExtent||450),near:-2500,far:3500});sun.shadow.bias=-.00012;sun.shadow.normalBias=.18;
const a=cfg.camera.azimuth*Math.PI/180,e=cfg.camera.elevation*Math.PI/180,right=[Math.cos(a),Math.sin(a),0],up=[-Math.sin(a)*Math.sin(e),Math.cos(a)*Math.sin(e),Math.cos(e)],eye=[Math.sin(a)*Math.cos(e),-Math.cos(a)*Math.cos(e),Math.sin(e)],dot=(p,b)=>p.reduce((s,v,i)=>s+v*b[i],0);
const center=[...cfg.centerWorld,0],midU=dot(center,right),midV=dot(center,up),scale=cfg.pixelsPerMetre,minU=midU-cfg.width/scale/2,maxV=midV+cfg.height/scale/2;
const camera=new T.OrthographicCamera(minU,minU+cfg.width/scale,maxV,maxV-cfg.height/scale,1,3000);camera.up.set(...up);camera.position.set(...eye.map(v=>v*1500));camera.lookAt(0,0,0);
const transform={right,up,eye,scale,minU,maxV,width:cfg.width,height:cfg.height,groundZ:0,origin:data.origin,crs:data.crs.projected};
const batches=new Map(),materials=new Map();
function batch(g,color,cast=true){if(g.index)g=g.toNonIndexed();const key=color+'|'+cast;if(!batches.has(key))batches.set(key,{color,cast,parts:[]});batches.get(key).parts.push(g);}
function material(color){if(!materials.has(color))materials.set(color,new T.MeshLambertMaterial({color,flatShading:true,side:T.DoubleSide}));return materials.get(color);}
function box(x,y,z,w,d,h,color,rotation=0){if(w<=0||d<=0||h<=0)return;const g=new T.BoxGeometry(w,d,h);g.rotateZ(rotation);g.translate(x,y,z+h/2);batch(g,color);}
function cyl(x,y,z,r,h,color,vertices=10,rTop=r){const g=new T.CylinderGeometry(rTop,r,h,vertices);g.rotateX(Math.PI/2);g.translate(x,y,z+h/2);batch(g,color);}
function line(a,b,width,z,height,color){const dx=b[0]-a[0],dy=b[1]-a[1];box((a[0]+b[0])/2,(a[1]+b[1])/2,z,Math.hypot(dx,dy),width,height,color,Math.atan2(dy,dx));}
function polygons(g){return g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];}
function shape(rings){const s=new T.Shape(rings[0].map(p=>new T.Vector2(...p)));for(const r of rings.slice(1))s.holes.push(new T.Path(r.map(p=>new T.Vector2(...p))));return s;}
function surface(g,color,z=0){for(const p of polygons(g)){const geom=new T.ShapeGeometry(shape(p));geom.translate(0,0,z);batch(geom,color,false);}}
function hash(s){let h=(2166136261^cfg.seed)>>>0;for(const v of String(s)){h^=v.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
function random(seed){let s=seed>>>0;return()=>{s+=0x6D2B79F5;let t=s;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
function inside(p,ring){let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
function inGeometry(p,g){return polygons(g).some(poly=>inside(p,poly[0])&&!poly.slice(1).some(r=>inside(p,r)));}
const [cx,cy]=cfg.centerWorld;box(cx,cy,-.3,cfg.groundSize||1800,cfg.groundSize||1800,.3,detail?'#d5ccae':'#d8ccb2');
for(const f of data.sourceFeatures){if(f.kind==='landuse'&&f.tags.landuse==='residential')surface(f.geometry,detail?'#dbd4bd':'#d8ccb2',.01);}
for(const f of data.sourceFeatures){if(f.kind==='water')surface(f.geometry,'#5da7ae',.11);if(f.tags.amenity==='parking')surface(f.geometry,'#b1afa2',.1);if(f.tags.leisure==='pitch')surface(f.geometry,'#9aa965',.1);}
surface(data.sidewalkSurface,detail?'#e4d5b7':'#d4c7ab',.08);surface(data.roadSurface,detail?'#637383':'#92948b',.12);
if(detail&&revision>=3)for(const poly of polygons(data.roadSurface))for(const ring of poly)for(let j=1;j<ring.length;j++)line(ring[j-1],ring[j],.14,.13,.06,'#e7e0c9');
for(const f of data.greens){surface(f.geometry,detail?'#8faa54':'#a5ad74',.09);if(detail)for(const poly of polygons(f.geometry))for(let i=1;i<poly[0].length;i++)line(poly[0][i-1],poly[0][i],.35,.1,.18,'#ded4b5');}
for(const r of data.roads){const lines=r.geometry.type==='LineString'?[r.geometry.coordinates]:r.geometry.coordinates;
 for(const pts of lines){for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]),dx=(b[0]-a[0])/len,dy=(b[1]-a[1])/len;
 if(r.footway){line(a,b,r.width,.14,.04,detail?'#c9bda0':'#b9b09a');continue;}
 if(detail&&r.width>=10){for(let k=2;k<len-2;k+=7){const p=[a[0]+dx*k,a[1]+dy*k],q=[a[0]+dx*Math.min(k+3,len),a[1]+dy*Math.min(k+3,len)];line(p,q,.14,.15,.015,'#dfdfcc');}}
 }}
}
const palette=revision>=3?['#ede6cf','#d6d9c5','#88aaa8','#e3bd91','#eddbb9','#dcb8a2','#bdc7b3']:['#e4e3d6','#eee7d4','#c9d4d3','#d6c5aa','#ddd9c7','#d8cfb7','#c1c9c7'];
const colorTags={white:'#e9e8db',beige:'#d6c5aa',grey:'#c2c7c8',gray:'#c2c7c8',orange:'#d8ac80',red:'#b67f65',yellow:'#ddd2a5'};
const roofs=revision>=3?['#d6d4c5','#ede5cf','#a7b5b7','#ccb599','#a8aca0','#d6c3a9']:['#c0c9c7','#dfded0','#b0bdbd','#d5d3bd','#b6bfba','#dddccc'];
let counts={buildings:0,windows:0,roofDetails:0,trees:0,canopyLobes:0};
for(const f of data.buildings){const rand=random(hash(f.id)),color=detail?(colorTags[f.tags['building:colour']]||palette[Math.floor(rand()*palette.length)]):'#d5c2a5',roof=detail?roofs[Math.floor(rand()*roofs.length)]:'#d6c9b2',h=f.height,poly=polygons(f.geometry)[0];if(!poly)continue;
 if(detail&&cfg.focalAsset?.sourceId===f.id){assembly(f,poly);counts.buildings++;continue;}
 const g=new T.ExtrudeGeometry(shape(poly),{depth:h,bevelEnabled:false});batch(g,color);surface(f.geometry,roof,h+.025);counts.buildings++;
 if(!detail)continue;
 // Real footprint perimeter, openings and storey bands. Decoration is authored, not surveyed.
 for(let ri=0;ri<poly.length;ri++){const ring=poly[ri];for(let j=1;j<ring.length;j++){const a=ring[j-1],b=ring[j],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy),theta=Math.atan2(dy,dx),nx=dy/len,ny=-dx/len;
 line(a,b,.20,h,.7,color);line(a,b,.31,h+.7,.12,'#edf0df');line(a,b,.18,.15,.3,'#a2aa9e');
 if(revision>=3)line(a,b,.23,h-.28,.22,['#608c8f','#a78166','#7f8f80','#d7d1b7'][hash(f.id)%4]);
 for(let z=3.2;z<h-.2;z+=3.2)line(a,b,.21,z-.16,.16,'#e3e2d4');
 if(len<2)continue;
 const bays=Math.max(1,Math.floor((len-1)/2.65));for(let k=0;k<bays;k++){const t=(k+.5)/bays,x=a[0]+dx*t+nx*.07,y=a[1]+dy*t+ny*.07;for(let z=.9;z<h-1;z+=3.2){
  const w=Math.min(1.25,(len-1)/bays*.65);box(x,y,z,w+.2,.18,1.65,'#e9e9d9',theta);box(x+nx*.105,y+ny*.105,z+.12,w,.045,1.39,rand()>.6?'#38637a':'#294d63',theta);
  box(x+nx*.15,y+ny*.15,z+.14,.065,.06,1.35,'#b8d0cf',theta);box(x+nx*.15,y+ny*.15,z+.78,w,.06,.06,'#c9d9cf',theta);
  box(x+nx*.24,y+ny*.24,z-.06,w+.35,.55,.12,'#ebe5cd',theta);box(x+nx*.22,y+ny*.22,z+1.7,w+.5,.65,.12,color,theta);counts.windows++;
 }}
 if(j-1===f.entryEdge&&ri===0){const x=(a[0]+b[0])/2+nx*.12,y=(a[1]+b[1])/2+ny*.12;box(x,y,.15,1.15,.12,2.25,'#566e71',theta);box(x+nx*.4,y+ny*.4,.05,1.65,.85,.15,'#eee6ce',theta);box(x+nx*.5,y+ny*.5,2.5,2.1,1.1,.15,'#c2b898',theta);}
 }}
 // Roof service equipment stays within an inward-buffered source polygon.
 const [rx,ry]=f.center,rotation=Math.atan2(poly[0][1][1]-poly[0][0][1],poly[0][1][0]-poly[0][0][0]);
 const local=(u,v)=>[rx+Math.cos(rotation)*u-Math.sin(rotation)*v,ry+Math.sin(rotation)*u+Math.cos(rotation)*v];
 if(inGeometry([rx,ry],(f.roofEquipmentSafe||f.roofSafe))){
  const flip=revision>=3?(rand()>.5?1:-1):1;
  if(revision>1&&(revision<3||rand()>.3)){const p=local(-1.7*flip,-1.2);if(inGeometry(p,(f.roofEquipmentSafe||f.roofSafe))){box(...p,h+.03,2.2,2.5,revision>=3?1.2:1.6,color,rotation);box(...p,h+(revision>=3?1.23:1.63),2.45,2.75,.15,'#e8e5d2',rotation);counts.roofDetails++;}}
  const tank=local(1.2*flip,1.5);if(inGeometry(tank,(f.roofEquipmentSafe||f.roofSafe))&&(revision<3||rand()>.2)){cyl(...tank,h+.12,.55,1.1,'#657e86',12);cyl(...tank,h+1.22,.58,.1,'#a8bcba',12);counts.roofDetails++;}
  if(revision>1){const ac=local(-1.6*flip,1.2);if(inGeometry(ac,(f.roofEquipmentSafe||f.roofSafe))&&(revision<3||rand()>.4)){box(...ac,h+.08,1.2,.8,.55,'#c3ceca',rotation);cyl(...ac,h+.64,.26,.02,'#728d93',12);counts.roofDetails++;}
  for(let k=0;k<3;k++){const a=local(-2+k*1.6,-3),b=local(-2+k*1.6,3);if(inGeometry(a,(f.roofEquipmentSafe||f.roofSafe))&&inGeometry(b,(f.roofEquipmentSafe||f.roofSafe)))line(a,b,.035,h+.04,.01,'#a8b4af');}}
 }
}

function assembly(f,poly){
 const [x,y]=f.centroid,h=f.height;const g=new T.ExtrudeGeometry(shape(poly),{depth:h,bevelEnabled:false});batch(g,'#e6d2ac');surface(f.geometry,'#dfd4bb',h+.03);
 for(const ring of poly)for(let j=1;j<ring.length;j++){const a=ring[j-1],b=ring[j],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy),angle=Math.atan2(dy,dx);if(len<.5)continue;const nx=dy/len,ny=-dx/len;
  line(a,b,.7,h,.8,'#f2e4c9');for(let z=3;z<h;z+=3.2){line(a,b,.65,z,.25,'#cfb58d');const n=Math.floor(len/3);for(let k=0;k<n;k++){const u=(k+.5)/n;box(a[0]+dx*u+nx*.1,a[1]+dy*u+ny*.1,z-2.2,1.5,.2,1.65,'#466771',angle);counts.windows++;}}
  for(let k=2;k<len-1;k+=6)cyl(a[0]+dx*k/len+nx*.35,a[1]+dy*k/len+ny*.35,.2,.38,h,'#efdfbf',8);
 }
 const r=cfg.focalAsset.domeRadius;const footprintOK=Array.from({length:32},(_,i)=>[x+Math.cos(i*Math.PI/16)*r,y+Math.sin(i*Math.PI/16)*r]).every(p=>inGeometry(p,f.geometry));
 if(footprintOK){cyl(x,y,h,r,1.6,'#c5ae82',8);cyl(x,y,h+1.6,r,8,'#e8d7b2',8,r*.64);cyl(x,y,h+9.6,r*.64,3,'#eedfc2',8,r*.16);cyl(x,y,h+12.6,1.1,2,'#b9a269',8);cyl(x,y,h+14.6,.12,4,'#666f68',8);counts.focalAssets=(counts.focalAssets||0)+1;}
}

function tree(x,y,r,seed){const rand=random(seed),base=2.6+r*.45;cyl(x,y,.1,.18,base+1,'#806b45',7);
 if(!detail){const g=new T.IcosahedronGeometry(r,0);g.translate(x,y,base+r*.4);batch(g,'#7f9653');counts.trees++;return;}
 if(revision>=3){const g=new T.IcosahedronGeometry(r*.83,1);g.scale(1,1,.65);g.translate(x,y,base+r*.15);batch(g,'#295e38');}
 const lobes=revision>1?18:5;
 for(let j=0;j<lobes;j++){const angle=j*2.39996,rad=r*Math.sqrt((j+.5)/lobes)*.75,lx=x+Math.cos(angle)*rad,ly=y+Math.sin(angle)*rad,lz=base+r*.45+(1-rad/r)*r*.6+(rand()-.5)*r*.35,rr=r*(.32+rand()*.22);
 const g=new T.IcosahedronGeometry(rr,revision>1?1:0);g.scale(1,1,.85);g.translate(lx,ly,lz);batch(g,(revision>=3?['#2f7831','#4c9129','#6b9d2a','#34832b','#80aa35']:['#477e27','#5e932c','#74a538','#40812d','#8bb642'])[Math.floor(rand()*5)]);counts.canopyLobes++;
 if(revision>1)for(let k=0;k<4;k++){const q=new T.IcosahedronGeometry(rr*(.22+rand()*.18),0);q.scale(1.2,1,.7);q.translate(lx+(rand()-.5)*rr*1.6,ly+(rand()-.5)*rr*1.6,lz+rr*.65);batch(q,['#89b646','#6ca133','#a0bc4f'][Math.floor(rand()*3)]);}
 }counts.trees++;
}
for(const f of data.greens){const rand=random(hash(f.id));for(const poly of polygons(f.geometry)){const ring=poly[0],xs=ring.map(p=>p[0]),ys=ring.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys),placed=[];
 const attempts=Math.min(6000,Math.ceil((maxX-minX)*(maxY-minY)/4));for(let i=0;i<attempts;i++){const x=minX+rand()*(maxX-minX),y=minY+rand()*(maxY-minY),r=2.3+rand()*1.3;if(Math.hypot(x-cx,y-cy)>(cfg.treeRadius||340)||!inside([x,y],ring)||poly.slice(1).some(h=>inside([x,y],h))||placed.some(p=>Math.hypot(x-p[0],y-p[1])<(cfg.contextRadius?9:5.3))||inGeometry([x,y],data.sidewalkSurface)||data.buildings.some(b=>inGeometry([x,y],b.geometry)))continue;
 placed.push([x,y]);tree(x,y,r,hash(f.id)+i);}
}}
for(const f of data.sourceFeatures)if(f.kind==='tree'&&f.geometry.type==='Point')tree(...f.geometry.coordinates,3,hash(f.id));
for(const {color,parts,cast}of batches.values()){const geom=mergeGeometries(parts,false),mesh=new T.Mesh(geom,material(color));mesh.castShadow=cast;mesh.receiveShadow=true;scene.add(mesh);for(const g of parts)g.dispose();}
const ext=renderer.getContext().getExtension('WEBGL_debug_renderer_info');
window.sampleReady={mode,revision,counts,transform,sourceHash:data.sourceHash,renderer:ext?renderer.getContext().getParameter(ext.UNMASKED_RENDERER_WEBGL):'WebGL',model:null};
let composer;const styled=new URLSearchParams(location.search).get('treatment')==='B';if(styled){composer=new EffectComposer(renderer);composer.addPass(new RenderPixelatedPass(1,scene,camera,{normalEdgeStrength:.16,depthEdgeStrength:.20}));composer.addPass(new OutputPass());}
window.renderSample=async(x=0,y=0,w=cfg.width,h=cfg.height,padding=0)=>{renderer.setSize(w+padding*2,h+padding*2);camera.setViewOffset(cfg.width,cfg.height,x-padding,y-padding,w+padding*2,h+padding*2);camera.updateProjectionMatrix();if(composer){composer.setSize(w+padding*2,h+padding*2);composer.render();}else renderer.render(scene,camera);window.sampleReady.drawCalls=renderer.info.render.calls;window.sampleReady.triangles=renderer.info.render.triangles;return renderer.domElement.toDataURL('image/png');};
