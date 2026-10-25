import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

const data=await(await fetch('/outputs/scene.json')).json();
const cfg=await(await fetch('/outputs/render-config.json')).json();
const t=cfg.transform;
const renderer=new THREE.WebGLRenderer({antialias:false,alpha:false,preserveDrawingBuffer:true,powerPreference:'low-power'});
renderer.setPixelRatio(1);renderer.setClearColor(cfg.background);renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color(cfg.background);
const sky=new THREE.HemisphereLight(0xf5f7ee,0x647877,1.6);sky.position.set(0,0,1);scene.add(sky);
const sun=new THREE.DirectionalLight(0xfff0d6,2.0);sun.position.set(cfg.light.east,cfg.light.north,cfg.light.up);sun.castShadow=true;
sun.shadow.mapSize.set(4096,4096);sun.shadow.camera.left=-1850;sun.shadow.camera.right=1850;sun.shadow.camera.top=1850;sun.shadow.camera.bottom=-1850;sun.shadow.camera.near=100;sun.shadow.camera.far=5000;sun.shadow.bias=-0.0002;sun.shadow.normalBias=0.15;scene.add(sun);
const camera=new THREE.OrthographicCamera(t.minU,t.minU+t.width/t.scale,t.maxV,t.maxV-t.height/t.scale,1,10000);
camera.up.set(...t.up);camera.position.set(...t.eye.map(v=>v*4000));camera.lookAt(0,0,0);
const mats=new Map(), batches=new Map();
function mat(color){if(!mats.has(color))mats.set(color,new THREE.MeshLambertMaterial({color,flatShading:true,side:THREE.DoubleSide}));return mats.get(color);}
function batch(geometry,color){if(!batches.has(color))batches.set(color,[]);batches.get(color).push(geometry.toNonIndexed? (geometry.index?geometry.toNonIndexed():geometry):geometry);}
const v=new THREE.Vector3(),q=new THREE.Quaternion(),m=new THREE.Matrix4();
function box(x,y,z,w,d,h,color,rotation=0){if(!(w>0&&d>0&&h>0))return;const g=new THREE.BoxGeometry(w,d,h);q.setFromAxisAngle(new THREE.Vector3(0,0,1),rotation);m.compose(v.set(x,y,z+h/2),q,new THREE.Vector3(1,1,1));g.applyMatrix4(m);batch(g,color);}
function cylinder(x,y,z,r,h,color,vertices=8,rTop=r){const g=new THREE.CylinderGeometry(rTop,r,h,vertices,1);g.rotateX(Math.PI/2);g.translate(x,y,z+h/2);batch(g,color);}
function line(a,b,width,z,height,color){const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);if(len<.01)return;box((a[0]+b[0])/2,(a[1]+b[1])/2,z,len,width,height,color,Math.atan2(dy,dx));}
function hash(s){let h=2166136261;for(const c of String(s)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
function rng(seed){let a=seed>>>0;return()=>{a+=0x6D2B79F5;let n=a;n=Math.imul(n^n>>>15,n|1);n^=n+Math.imul(n^n>>>7,n|61);return((n^n>>>14)>>>0)/4294967296;};}
function polygons(g){return g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];}
function shape(rings){const s=new THREE.Shape(rings[0].map(p=>new THREE.Vector2(p[0],p[1])));for(const ring of rings.slice(1))s.holes.push(new THREE.Path(ring.map(p=>new THREE.Vector2(p[0],p[1]))));return s;}
function surface(rings,color,z=.1){const g=new THREE.ShapeGeometry(shape(rings));g.translate(0,0,z);batch(g,color);}
function inside(p,ring){let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
function tree(x,y,r,seed){const rand=rng(seed);cylinder(x,y,.2,.45,r*1.5,'#796b49',5);for(let i=0;i<4;i++){const g=new THREE.IcosahedronGeometry(r*(.7+rand()*.35),0);g.scale(1,1,.85);g.translate(x+(rand()-.5)*r,y+(rand()-.5)*r,r*(1.8+rand()*.5));batch(g,['#738b4f','#8e9f59','#617c49','#a3ac62'][i]);}}
const bounds=data.bounds.world;
const [xmin,ymin,xmax,ymax]=bounds;surface([[[xmin,ymin],[xmax,ymin],[xmax,ymax],[xmin,ymax],[xmin,ymin]]],'#e2d6bf',0);
renderer.clippingPlanes=[new THREE.Plane(new THREE.Vector3(1,0,0),-xmin),new THREE.Plane(new THREE.Vector3(-1,0,0),xmax),new THREE.Plane(new THREE.Vector3(0,1,0),-ymin),new THREE.Plane(new THREE.Vector3(0,-1,0),ymax)];
let stats={buildings:0,trees:0,roads:0,landmarks:0};
const greens=data.features.filter(f=>['park','green','landuse'].includes(f.kind));
for(const f of data.features){const tags=f.tags||{};for(const poly of polygons(f.geometry)){
 if(f.kind==='water')surface(poly,'#83a7a3',.18);
 else if(['park','green'].includes(f.kind)||(f.kind==='landuse'&&/grass|garden|forest|meadow|recreation_ground|orchard/.test(tags.landuse||tags.leisure||'')))surface(poly,'#b4ba80',.12);
 else if(f.kind==='landuse')surface(poly,tags.landuse==='residential'?'#d4c6af':'#ded3ba',.08);
}}
for(const f of data.features){if(!['road','railway'].includes(f.kind))continue;const tags=f.tags||{}, lines=f.geometry.type==='LineString'?[f.geometry.coordinates]:f.geometry.type==='MultiLineString'?f.geometry.coordinates:[];
 const type=tags.highway||'residential', widths={primary:14,secondary:11,tertiary:9,residential:6,service:3.6,footway:1.8,path:1.4,pedestrian:7,trunk:18};
 const width=parseFloat(tags.width)||widths[type]||5,z=tags.bridge==='yes'?5:.25;
 if(tags.tunnel==='yes')continue;
 for(const pts of lines){for(let i=1;i<pts.length;i++){line(pts[i-1],pts[i],width+1.5,z,.12,'#e6d9bf');line(pts[i-1],pts[i],width,z+.13,.1,f.kind==='railway'?'#8f8474':/footway|path|pedestrian/.test(type)?'#c5b296':'#858984');if(f.kind==='railway'){line(pts[i-1],pts[i],.3,z+.3,.15,'#575e59');}}
 for(const p of pts)cylinder(p[0],p[1],z+.12,width/2,.13,/footway|path|pedestrian/.test(type)?'#c5b296':'#858984',8);}
 stats.roads++;
}
const walls=['#cf9b81','#d9b496','#c5af99','#d8c4a8','#dfbf9c','#d3ae95','#d9c9b1'];
const roofs=['#dfd1b6','#c5bcaa','#e8d9bd','#cfc9b7','#bdb8aa','#dfc7ab'];
const landmarkFeatures=[];
for(const f of data.features){if(f.kind!=='building'||f.renderVisible===false||Number(f.tags?.layer||0)<0)continue;const name=((f.tags?.name||'')+' '+(f.tags?.['name:en']||'')).toLowerCase();
 const isHawa=/hawa mahal|palace of winds/.test(name),isJantar=/samrat yantra|jai prakash|ram yantra/.test(name);
 if(isHawa){landmarkFeatures.push(f);continue;}if(isJantar)continue;
 const rand=rng(hash(f.id)),h=Math.max(2,Math.min(f.height||7,70)),wall=walls[Math.floor(rand()*walls.length)],roof=roofs[Math.floor(rand()*roofs.length)];
 for(const poly of polygons(f.geometry)){const s=shape(poly),g=new THREE.ExtrudeGeometry(s,{depth:h,bevelEnabled:false,steps:1,curveSegments:1});batch(g,wall);surface(poly,roof,h+.04);
 for(const ring of poly){for(let j=1;j<ring.length;j++){const a=ring[j-1],b=ring[j],len=Math.hypot(b[0]-a[0],b[1]-a[1]);line(a,b,.42,h,.65,wall);
 if(len>4&&len<130){for(let k=2;k<len-1.5;k+=3.4){const p=[a[0]+(b[0]-a[0])*k/len,a[1]+(b[1]-a[1])*k/len];for(let level=2.4;level<h-1;level+=3.2)box(p[0],p[1],level,.65,.18,1.05,'#8d8074',Math.atan2(b[1]-a[1],b[0]-a[0]));}}
 }}
 // Rooftop accents are attached details only; never new footprint structures.
 const ring=poly[0],cx=ring.reduce((s,p)=>s+p[0],0)/ring.length,cy=ring.reduce((s,p)=>s+p[1],0)/ring.length;
 if(inside([cx,cy],ring)&&!poly.slice(1).some(r=>inside([cx,cy],r))&&rand()>.45)cylinder(cx,cy,h+.1,.8,1.1,'#aba99b',8);
 }stats.buildings++;
}
for(const f of greens){const tag=f.tags||{};if(f.kind==='landuse'&&!/grass|garden|forest|meadow|recreation_ground|orchard/.test(tag.landuse||tag.leisure||''))continue;
 for(const poly of polygons(f.geometry)){const ring=poly[0],xs=ring.map(p=>p[0]),ys=ring.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys),rand=rng(hash(f.id));
 const n=Math.min(900,Math.floor((maxX-minX)*(maxY-minY)/160));for(let i=0;i<n;i++){const x=minX+rand()*(maxX-minX),y=minY+rand()*(maxY-minY);if(inside([x,y],ring)&&!poly.slice(1).some(r=>inside([x,y],r))){tree(x,y,2+rand()*2.5,hash(f.id)+i);stats.trees++;}}
 }}
for(const f of data.features){if(f.kind==='tree'&&f.geometry.type==='Point'){tree(...f.geometry.coordinates,3.2,hash(f.id));stats.trees++;}}
// Artistic reconstruction: narrow five-tier facade at verified OSM point, aligned with existing edge.
const hawa=data.authoredLandmarks['hawa-mahal'];
if(hawa){const {center,axis,normal,length,depth}=hawa,rotation=Math.atan2(normal[1],normal[0]);
 const at=(along,across)=>[center[0]+axis[0]*along+normal[0]*across,center[1]+axis[1]*along+normal[1]*across];
 for(let tier=0;tier<5;tier++){const span=length*(1-tier*.11),z=tier*3.2,count=Math.max(7,Math.round(span/3));const [bx,by]=at(0,-tier*.45);box(bx,by,z,depth-tier*.55,span,3.2,'#c77f69',rotation);
 for(let j=0;j<count;j++){const along=-span/2+(j+.5)*span/count,[x,y]=at(along,depth/2-tier*.55);box(x,y,z+.15,.7,2.5,2.7,'#d48b72',rotation);box(x+normal[0]*.4,y+normal[1]*.4,z+.8,.16,1.1,1.3,'#795b56',rotation);box(x+normal[0]*.55,y+normal[1]*.55,z+1.4,.16,1.15,.15,'#e1b08b',rotation);cylinder(x,y,z+2.85,1.4,.4,'#dfac86',6,.8);if(tier===4)cylinder(x,y,z+3.25,.8,.8,'#d69b77',6,0);}
 }stats.landmarks++;
}
// Artistic reconstructions are georeferenced to OSM footprints/POIs, never moved for composition.
for(const f of landmarkFeatures){for(const poly of polygons(f.geometry)){
 const ring=poly[0],xs=ring.map(p=>p[0]),ys=ring.map(p=>p[1]);const cx=(Math.max(...xs)+Math.min(...xs))/2,cy=(Math.max(...ys)+Math.min(...ys))/2;
 const base=new THREE.ExtrudeGeometry(shape(poly),{depth:8,bevelEnabled:false});batch(base,'#c57861');surface(poly,'#e6b28a',8.1);
 const east=Math.max(...xs),south=Math.min(...ys),north=Math.max(...ys),len=Math.min(58,north-south);
 for(let tier=0;tier<5;tier++){const z=3+tier*3.4,span=len*(1-tier*.08),count=Math.max(5,Math.floor(span/3.1));
 for(let j=0;j<count;j++){const y=cy-span/2+(j+.5)*span/count,x=east-tier*.95;box(x,y,z,2.4,2.6,3.1,'#ce826b');box(x+1.25,y,z+.7,.14,1.1,1.5,'#805c50');cylinder(x,y,z+3.1,1.5,.5,'#e6aa80',6,.9);if(tier===4)cylinder(x,y,z+3.6,.9,1.3,'#dca17c',6,0);}}
 stats.landmarks++;
}}
// Jantar Mantar instruments: authored only on named mapped instrument footprints.
for(const f of data.features){const name=f.tags?.name||f.tags?.['name:en']||'';if(!/samrat yantra|ram yantra/i.test(name))continue;const ps=polygons(f.geometry);if(!ps.length)continue;const ring=ps[0][0],xs=ring.map(p=>p[0]),ys=ring.map(p=>p[1]),cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2;
 if(/ram yantra/i.test(name)){const r=(Math.max(...xs)-Math.min(...xs))/2;surface(ps[0],'#d1ba99',.4);for(let j=0;j<16;j++){const a=j*Math.PI/8;cylinder(cx+Math.cos(a)*(r-.35),cy+Math.sin(a)*(r-.35),.4,.4,r*.85,'#d5ba91',4);}cylinder(cx,cy,.4,.3,r*.95,'#ba9678',8);stats.landmarks++;continue;}
 const south=Math.min(...ys)+.5,north=Math.max(...ys)-.5,height=22.6;
 const g=new THREE.BufferGeometry();const a=[cx-1.8,south,1],b=[cx-1.8,north,1],c=[cx-1.8,north,height],d=[cx+1.8,south,1],e=[cx+1.8,north,1],ff=[cx+1.8,north,height];g.setAttribute('position',new THREE.Float32BufferAttribute([...a,...b,...c,...d,...ff,...e,...a,...c,...ff,...a,...ff,...d,...b,...e,...ff,...b,...ff,...c],3));g.computeVertexNormals();batch(g,'#dfca9e');
 for(let step=0;step<48;step++){const y=south+(north-south)*step/48;box(cx,y,1+(height-1)*step/48,3.7,(north-south)/48,.25,'#f0dfb7');}
 // Two quarter-circle masonry quadrants stay within the mapped instrument footprint.
 const radius=Math.min((Math.max(...xs)-Math.min(...xs))/2-3,17);
 for(const side of [-1,1])for(let j=0;j<32;j++){const theta=j*Math.PI/64,x=cx+side*(2+Math.sin(theta)*radius),z=1+radius*(1-Math.cos(theta));box(x,cy+1,z,.8,3.8,1,'#e2cfa5');}
 box(cx,north,height,5.4,4.3,.7,'#e8d6ac');for(const x of [-2,2])for(const y of [-1.5,1.5])box(cx+x,north+y,height+.7,.4,.4,2.4,'#c3a580');box(cx,north,height+3.1,5.8,4.6,.6,'#dec79f');stats.landmarks++;
}
for(const [color,geometries] of batches){const merged=mergeGeometries(geometries,false);if(!merged)throw new Error('Merge failed '+color);const mesh=new THREE.Mesh(merged,mat(color));mesh.castShadow=true;mesh.receiveShadow=true;scene.add(mesh);for(const g of geometries)g.dispose();}
window.renderChunk=async(x,y,w,h,padding=0)=>{const fullW=w+padding*2,fullH=h+padding*2;renderer.setSize(fullW,fullH);camera.setViewOffset(t.width,t.height,x-padding,y-padding,fullW,fullH);camera.updateProjectionMatrix();renderer.render(scene,camera);return renderer.domElement.toDataURL('image/png');};
window.renderReady={stats,renderer:renderer.getContext().getParameter(renderer.getContext().RENDERER),drawCalls:renderer.info.render.calls};
