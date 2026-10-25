// Capital-area renderer. One global orthographic camera; chunks are view offsets of it.
// Geometry is real OSM footprints/roads/greens; facade, roof, ground texture and planting outside
// mapped parks are authored illustration (see scene.json assumptions).
import * as T from 'three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPixelatedPass} from 'three/addons/postprocessing/RenderPixelatedPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {GTAOPass} from 'three/addons/postprocessing/GTAOPass.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
const q=new URLSearchParams(location.search),stage=s=>console.log('[scene]',s,Math.round(performance.now()));
const data=await(await fetch(q.get('scene')||'/outputs/capital/scene.json')).json(),cfg=data.config;
const mode=q.get('mode')||'A',detail=mode!=='source',treatment=mode==='B';
// Time/climate variants share every footprint, tree position and roof object; only light, palette and emissive parts change.
const variant=['night','monsoon','winter'].includes(mode)?mode:'summer',night=variant==='night';
const SUMMER_GROUND=['#cdbb8c','#c39b6c','#a3a865','#8d9f55'];
const LOOK={
 summer:{clear:'#d9cfae',sky:[0xa9c6e4,0x7a7556,1.35],sun:[0xfff0d2,3.2],light:cfg.light,ground:SUMMER_GROUND,grassBias:0,road:'#6b7480',water:'#4f9fae',park:'#7f9d48',shadowRadius:2,
  greens:['#3d8230','#56962e','#6fa833','#2f7330','#86b23e'],dark:['#2c6a33','#3a7d33','#24592d','#4b8a35'],tips:['#9cc252','#7bb03c','#b0c95c'],core:['#2a6531','#21522a']},
 monsoon:{clear:'#9fb0a8',sky:[0xc7d3da,0x56684e,1.95],sun:[0xe8eef2,1.45],light:cfg.light,ground:['#8f9c62','#7e7a58','#6c9845','#5a8e3a'],grassBias:.24,road:'#4b535d',water:'#4a8c93',park:'#5d9038',shadowRadius:7,
  greens:['#2f7a2c','#3f8e2a','#56a12f','#2a6d2b','#6fb33a'],dark:['#1f5a2a','#2a6c2c','#1c4d27','#357a2e'],tips:['#86c146','#6db03a','#9fd056'],core:['#235d2b','#1b4a25'],clouds:true,puddles:true},
 winter:{clear:'#e0d6bd',sky:[0xcbd8e8,0x8c8366,1.2],sun:[0xffe0b4,3.4],light:{east:-300,north:-330,up:330},ground:['#dac89c','#caa97c','#b7ad74','#a6a466'],grassBias:-.1,road:'#717a85',water:'#5ca0b2',park:'#8b9c52',shadowRadius:2,
  greens:['#5c8034','#6f8b3b','#879b46','#4f7431','#a29b4e'],dark:['#3f6530','#4c7334','#36592c','#5a7c38'],tips:['#b6b55f','#c6b465','#9eab53'],core:['#3c5f2e','#334f29'],autumn:['#b8893a','#a5793a','#c9a04a','#93702f','#d0aa55']},
 night:{clear:'#0b111d',sky:[0x34496f,0x111419,.48],sun:[0x9db4e6,.48],light:{east:120,north:-260,up:420},ground:SUMMER_GROUND,grassBias:0,road:'#454c57',water:'#21465a',park:'#62813f',shadowRadius:3,
  greens:['#3d8230','#56962e','#6fa833','#2f7330','#86b23e'],dark:['#2c6a33','#3a7d33','#24592d','#4b8a35'],tips:['#9cc252','#7bb03c','#b0c95c'],core:['#2a6531','#21522a']},
}[variant];
// Night emissive colours: these keys get an emissive term, so they glow regardless of scene lighting.
const EMISSIVE=new Set(['#ffd27a','#ffe3a8','#d6ecff','#ffb85c','#ffe9c2','#9fd3ff']);
const renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true,powerPreference:'high-performance'});renderer.setPixelRatio(1);renderer.outputColorSpace=T.SRGBColorSpace;renderer.setClearColor(detail?LOOK.clear:'#d9cfae');renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;document.body.append(renderer.domElement);
const scene=new T.Scene();
scene.add(new T.HemisphereLight(detail?LOOK.sky[0]:0xa9c6e4,detail?LOOK.sky[1]:0x7a7556,detail?LOOK.sky[2]:1.6));
const sun=new T.DirectionalLight(detail?LOOK.sun[0]:0xfff0d2,detail?LOOK.sun[1]:2.0);scene.add(sun,sun.target);sun.castShadow=true;
const lightDir=detail?LOOK.light:cfg.light,L=new T.Vector3(lightDir.east,lightDir.north,lightDir.up).normalize();
const shadowHalf=cfg.chunkShadowHalfExtent||300,shadowSize=cfg.shadowMapSize||4096,texel=shadowHalf*2/shadowSize;
sun.shadow.mapSize.setScalar(shadowSize);Object.assign(sun.shadow.camera,{left:-shadowHalf,right:shadowHalf,top:shadowHalf,bottom:-shadowHalf,near:1,far:3000});sun.shadow.camera.updateProjectionMatrix();sun.shadow.bias=-.0002;sun.shadow.normalBias=.06;sun.shadow.radius=detail?LOOK.shadowRadius:2;
// Light-space basis matching DirectionalLightShadow (camera.up = +Y) so shadow texels form one global lattice.
const lz=L.clone(),lx=new T.Vector3(0,1,0).cross(lz).normalize(),ly=lz.clone().cross(lx);
const a=cfg.camera.azimuth*Math.PI/180,e=cfg.camera.elevation*Math.PI/180,right=[Math.cos(a),Math.sin(a),0],up=[-Math.sin(a)*Math.sin(e),Math.cos(a)*Math.sin(e),Math.cos(e)],eye=[Math.sin(a)*Math.cos(e),-Math.cos(a)*Math.cos(e),Math.sin(e)],dot=(p,b)=>p.reduce((s,v,i)=>s+v*b[i],0);
const center=[...cfg.centerWorld,0],midU=dot(center,right),midV=dot(center,up),scale=cfg.pixelsPerMetre,minU=midU-cfg.width/scale/2,maxV=midV+cfg.height/scale/2;
// The camera sits 1500 m up the view axis from the region's ground centre (g), not the world origin, so near/far
// (1–3000 m) brackets the region at any distance across a city. eye ⟂ right, up, so the frustum just shifts by g's (u, v).
const [gx0,gy0,gw,gh]=cfg.region||[0,0,cfg.width,cfg.height],gU=minU+(gx0+gw/2)/scale,gV=maxV-(gy0+gh/2)/scale,gdet=right[0]*up[1]-right[1]*up[0],g=[(gU*up[1]-gV*right[1])/gdet,(gV*right[0]-gU*up[0])/gdet,0];
const camera=new T.OrthographicCamera(minU-gU,minU+cfg.width/scale-gU,maxV-gV,maxV-cfg.height/scale-gV,1,3000);camera.up.set(...up);camera.position.set(...g.map((v,i)=>v+eye[i]*1500));camera.lookAt(...g);
const transform={right,up,eye,scale,minU,maxV,width:cfg.width,height:cfg.height,groundZ:0,origin:data.origin,crs:data.crs.projected,azimuth:cfg.camera.azimuth,elevation:cfg.camera.elevation,pixelOrigin:'top-left; continuous image-edge coordinates'};
function imageToGround(px,py){const u=px/scale+minU,v=maxV-py/scale,det=right[0]*up[1]-right[1]*up[0];return [(u*up[1]-v*right[1])/det,(v*right[0]-u*up[0])/det];}
// A region renders a sub-rectangle of the one global image; its scene covers that rectangle plus a ground margin
// (shadow casters, occluders, neighbouring plots and tree candidates).
const [rx0,ry0,rw,rh]=cfg.region||[0,0,cfg.width,cfg.height];
const corners=[[rx0,ry0],[rx0+rw,ry0],[rx0,ry0+rh],[rx0+rw,ry0+rh]].map(p=>imageToGround(...p)),margin=cfg.regionMargin||140;
const view={minX:Math.min(...corners.map(p=>p[0]))-margin,maxX:Math.max(...corners.map(p=>p[0]))+margin,minY:Math.min(...corners.map(p=>p[1]))-margin,maxY:Math.max(...corners.map(p=>p[1]))+margin};
const inView=(x,y)=>x>=view.minX&&x<=view.maxX&&y>=view.minY&&y<=view.maxY;

const batches=new Map(),materials=new Map();
function batch(g,color,cast=true){if(g.index)g=g.toNonIndexed();g.deleteAttribute('uv');const key=color+'|'+cast;if(!batches.has(key))batches.set(key,{color,cast,parts:[]});batches.get(key).parts.push(g);}
function material(color){if(!materials.has(color))materials.set(color,EMISSIVE.has(color)?new T.MeshLambertMaterial({color:'#1a1a1a',emissive:color,emissiveIntensity:1.15,flatShading:true,side:T.DoubleSide}):new T.MeshLambertMaterial({color,flatShading:true,side:T.DoubleSide}));return materials.get(color);}
function box(x,y,z,w,d,h,color,rotation=0){if(w<=0||d<=0||h<=0)return;const g=new T.BoxGeometry(w,d,h);g.rotateZ(rotation);g.translate(x,y,z+h/2);batch(g,color);}
function cyl(x,y,z,r,h,color,vertices=10,rTop=r){const g=new T.CylinderGeometry(rTop,r,h,vertices);g.rotateX(Math.PI/2);g.translate(x,y,z+h/2);batch(g,color);}
function line(a,b,width,z,height,color){const dx=b[0]-a[0],dy=b[1]-a[1];box((a[0]+b[0])/2,(a[1]+b[1])/2,z,Math.hypot(dx,dy),width,height,color,Math.atan2(dy,dx));}
// Night light pools: radial discs, bright centre fading to black at the rim, drawn with additive blending.
const glowParts=[];
function glow(x,y,r,rgb,strength){if(!night)return;const g=new T.CircleGeometry(r,20).toNonIndexed(),pos=g.attributes.position,col=new Float32Array(pos.count*3);
 for(let i=0;i<pos.count;i++){const d=Math.hypot(pos.getX(i),pos.getY(i))/r,k=strength*(1-d)*(1-d);col.set([rgb[0]*k,rgb[1]*k,rgb[2]*k],i*3);}
 g.setAttribute('color',new T.BufferAttribute(col,3));g.deleteAttribute('uv');g.deleteAttribute('normal');g.translate(x,y,.22);glowParts.push(g);}
function polygons(g){return g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];}
function shape(rings){const s=new T.Shape(rings[0].map(p=>new T.Vector2(...p)));for(const r of rings.slice(1))s.holes.push(new T.Path(r.map(p=>new T.Vector2(...p))));return s;}
function surface(g,color,z=0){for(const p of polygons(g)){const geom=new T.ShapeGeometry(shape(p));geom.translate(0,0,z);batch(geom,color,false);}}
function hash(s){let h=(2166136261^cfg.seed)>>>0;for(const v of String(s)){h^=v.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
function random(seed){let s=seed>>>0;return()=>{s+=0x6D2B79F5;let t=s;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
function inside(p,ring){let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
function inGeometry(p,g){return polygons(g).some(poly=>poly[0]?.length>2&&inside(p,poly[0])&&!poly.slice(1).some(r=>inside(p,r)));}
function bbox(g){let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;for(const p of polygons(g))for(const [x,y]of p[0]||[]){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}return [x0,y0,x1,y1];}
// Uniform grid index for point queries against polygons and road segments.
function grid(cell=40){const m=new Map(),k=(i,j)=>i+','+j;return{add(b,item){for(let i=Math.floor(b[0]/cell);i<=Math.floor(b[2]/cell);i++)for(let j=Math.floor(b[1]/cell);j<=Math.floor(b[3]/cell);j++){const key=k(i,j);if(!m.has(key))m.set(key,[]);m.get(key).push(item);}},near(x,y){return m.get(k(Math.floor(x/cell),Math.floor(y/cell)))||[];}};}
const counts={buildings:0,windows:0,roofDetails:0,trees:0,parkTrees:0,streetTrees:0,yardTrees:0,mappedTrees:0,focalAssets:0};

// Ground: world-anchored value noise baked into vertex colours, so every chunk samples the same field.
function lattice(i,j,salt){let h=Math.imul(i,374761393)^Math.imul(j,668265263)^Math.imul(salt+cfg.seed,2246822519);h=Math.imul(h^h>>>13,1274126177);return((h^h>>>16)>>>0)/4294967296;}
function noise(x,y,f,salt){x*=f;y*=f;const i=Math.floor(x),j=Math.floor(y),u=x-i,v=y-j,s=t=>t*t*(3-2*t),a=lattice(i,j,salt),b=lattice(i+1,j,salt),c=lattice(i,j+1,salt),d=lattice(i+1,j+1,salt);return a+(b-a)*s(u)+(c-a)*s(v)+(a-b-c+d)*s(u)*s(v);}
{const step=detail?3:8,gx0=Math.floor(view.minX/step)*step,gy0=Math.floor(view.minY/step)*step,nx=Math.ceil((view.maxX-gx0)/step),ny=Math.ceil((view.maxY-gy0)/step),g=new T.PlaneGeometry(nx*step,ny*step,nx,ny);g.translate(gx0+nx*step/2,gy0+ny*step/2,0); // vertices on a global lattice
 const pos=g.attributes.position,col=new Float32Array(pos.count*3),dry=new T.Color(LOOK.ground[0]),earth=new T.Color(LOOK.ground[1]),grass=new T.Color(LOOK.ground[2]),lush=new T.Color(LOOK.ground[3]),gb=LOOK.grassBias,flat=new T.Color('#d8ccb2'),c=new T.Color();
 for(let i=0;i<pos.count;i++){const x=pos.getX(i),y=pos.getY(i);if(!detail)c.copy(flat);else{const n1=noise(x,y,1/55,1),n2=noise(x,y,1/13,2),n3=noise(x,y,1/4,3);c.copy(dry).lerp(earth,T.MathUtils.smoothstep(n2*.7+n3*.3,.55,.8)*.7).lerp(grass,T.MathUtils.smoothstep(n1*.75+n3*.25,.34-gb,.62-gb)*.9).lerp(lush,T.MathUtils.smoothstep(n1,.66-gb,.85-gb)*.6);c.multiplyScalar(.96+n3*.08);if(LOOK.clouds)c.multiplyScalar(1-.22*T.MathUtils.smoothstep(noise(x,y,1/240,9),.55,.78));}col.set([c.r,c.g,c.b],i*3);}
 g.setAttribute('color',new T.BufferAttribute(col,3));const mesh=new T.Mesh(g,new T.MeshLambertMaterial({vertexColors:true}));mesh.receiveShadow=true;mesh.position.z=-.02;scene.add(mesh);}

stage('ground');
for(const f of data.sourceFeatures){if(f.kind!=='landuse')continue;const lu=f.tags.landuse;if(!detail&&['residential','commercial','retail'].includes(lu))surface(f.geometry,'#d8ccb2',.01);}
for(const f of data.sourceFeatures){if(f.kind==='water')surface(f.geometry,detail?LOOK.water:'#4f9fae',.11);if(f.tags.amenity==='parking')surface(f.geometry,detail?'#a9a69a':'#b1afa2',.1);if(f.tags.leisure==='pitch')surface(f.geometry,detail?'#8fa85a':'#9aa965',.1);}
// Parking bays: authored stall stripes aligned to the lot's longest edge, clipped to the mapped OSM polygon.
if(detail)for(const f of data.sourceFeatures){if(f.tags.amenity!=='parking'||!['Polygon','MultiPolygon'].includes(f.geometry.type))continue;const ring=polygons(f.geometry)[0]?.[0];if(!ring)continue;
 let best=0,ang=0;for(let j=1;j<ring.length;j++){const l=Math.hypot(ring[j][0]-ring[j-1][0],ring[j][1]-ring[j-1][1]);if(l>best){best=l;ang=Math.atan2(ring[j][1]-ring[j-1][1],ring[j][0]-ring[j-1][0]);}}
 const [x0,y0,x1,y1]=bbox(f.geometry),cx0=(x0+x1)/2,cy0=(y0+y1)/2,R=Math.hypot(x1-x0,y1-y0)/2,c=Math.cos(ang),sn=Math.sin(ang),at=(u,v)=>[cx0+c*u-sn*v,cy0+sn*u+c*v];
 for(let v=-R;v<R;v+=16)for(const row of [0,5])for(let u=-R;u<R;u+=2.6){const a=at(u,v+row),b=at(u,v+row+4.8);if(inGeometry(a,f.geometry)&&inGeometry(b,f.geometry)){line(a,b,.12,.11,.02,'#e9e4d2');counts.parkingStalls=(counts.parkingStalls||0)+1;}}}
surface(data.sidewalkSurface,detail?'#e2d6b9':'#d4c7ab',.08);surface(data.roadSurface,detail?LOOK.road:'#92948b',.12);
if(detail)for(const poly of polygons(data.roadSurface))for(const ring of poly)for(let j=1;j<ring.length;j++)line(ring[j-1],ring[j],.22,.13,.12,'#ece4cc');
for(const f of data.greens){surface(f.geometry,detail?LOOK.park:'#a5ad74',.09);if(detail)for(const poly of polygons(f.geometry))for(let i=1;i<poly[0].length;i++)line(poly[0][i-1],poly[0][i],.35,.1,.25,'#ded4b5');}
const roadIndex=grid(30),obstacleIndex=grid(30);
for(const r of data.roads){const lines=r.geometry.type==='LineString'?[r.geometry.coordinates]:r.geometry.coordinates;
 for(const pts of lines){for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len<.01)continue;const dx=(b[0]-a[0])/len,dy=(b[1]-a[1])/len,hw=r.width/2+1.8;
  roadIndex.add([Math.min(a[0],b[0])-hw,Math.min(a[1],b[1])-hw,Math.max(a[0],b[0])+hw,Math.max(a[1],b[1])+hw],{a,b,half:r.footway?r.width/2+.6:r.width/2+1.2});
  if(r.footway){line(a,b,r.width,.14,.04,detail?'#cbbd9c':'#b9b09a');continue;}
  if(detail&&r.width>=10){for(let k=2;k<len-2;k+=7){const p=[a[0]+dx*k,a[1]+dy*k],q2=[a[0]+dx*Math.min(k+3,len),a[1]+dy*Math.min(k+3,len)];line(p,q2,.18,.15,.02,'#f1ecd6');}}
 }}
}
// Elevated metro: OSM railway ways tagged bridge=viaduct. Deck height and pier spacing are inferred.
for(const f of data.sourceFeatures){if(f.kind!=='railway'||f.tags.bridge!=='viaduct'||f.geometry.type!=='LineString')continue;const pts=f.geometry.coordinates,deck=10.5+(Number(f.tags.layer)||1)*.5;counts.viaductWays=(counts.viaductWays||0)+1;let carry=0;
 for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len<.01)continue;const dx=(b[0]-a[0])/len,dy=(b[1]-a[1])/len,hw=5;
  roadIndex.add([Math.min(a[0],b[0])-hw,Math.min(a[1],b[1])-hw,Math.max(a[0],b[0])+hw,Math.max(a[1],b[1])+hw],{a,b,half:4.5});
  if(!detail){line(a,b,4.6,deck,1.6,'#c9c3b4');continue;}
  line(a,b,4.4,deck-1.6,1.6,'#cfc8b8');line(a,b,4.8,deck,.25,'#e2dccb');for(const side of [-1,1])line([a[0]-dy*2.25*side,a[1]+dx*2.25*side],[b[0]-dy*2.25*side,b[1]+dx*2.25*side],.18,deck+.25,.9,'#ece6d6');
  line(a,b,.12,deck+.25,.05,'#6d6f6a');if(night)for(const side of [-1,1])line([a[0]-dy*2.3*side,a[1]+dx*2.3*side],[b[0]-dy*2.3*side,b[1]+dx*2.3*side],.1,deck+1.1,.06,'#9fd3ff');
  for(let k=carry;k<len;k+=28){const x=a[0]+dx*k,y=a[1]+dy*k;cyl(x,y,0,.85,deck-2.2,'#bdb6a6',10);box(x,y,deck-2.4,1.6,4.2,.8,'#c7c0b0',Math.atan2(dy,dx));counts.viaductPiers=(counts.viaductPiers||0)+1;}
  carry=((carry-len)%28+28)%28;}}
function nearRoad(x,y,extra=0){for(const s of roadIndex.near(x,y)){const vx=s.b[0]-s.a[0],vy=s.b[1]-s.a[1],l2=vx*vx+vy*vy,t=Math.max(0,Math.min(1,((x-s.a[0])*vx+(y-s.a[1])*vy)/l2));if(Math.hypot(x-s.a[0]-vx*t,y-s.a[1]-vy*t)<s.half+extra)return true;}return false;}
for(const f of data.sourceFeatures)if(f.kind==='water'||f.tags.amenity==='parking'||f.tags.leisure==='pitch')obstacleIndex.add(bbox(f.geometry),{geometry:f.geometry,pad:0});
for(const b of data.buildings)obstacleIndex.add(bbox(b.geometry).map((v,i)=>v+(i<2?-4:4)),{geometry:b.geometry,building:true});
function blocked(x,y,clearance){for(const o of obstacleIndex.near(x,y)){if(inGeometry([x,y],o.geometry))return true;if(o.building&&clearance>0){for(const poly of polygons(o.geometry))for(const ring of poly)for(let j=1;j<ring.length;j++){const a=ring[j-1],b=ring[j],vx=b[0]-a[0],vy=b[1]-a[1],l2=vx*vx+vy*vy||1,t=Math.max(0,Math.min(1,((x-a[0])*vx+(y-a[1])*vy)/l2));if(Math.hypot(x-a[0]-vx*t,y-a[1]-vy*t)<clearance)return true;}}}return false;}

// Street lamps (authored; OSM has no lamp nodes here): poles on alternating verges every 26 m, kept off junction ends and footprints.
if(detail)for(const r of data.roads){if(r.footway||r.width<5.5)continue;const lines=r.geometry.type==='LineString'?[r.geometry.coordinates]:r.geometry.coordinates;let n=0;
 for(const pts of lines){let walked=0;const total=pts.slice(1).reduce((s2,p,i)=>s2+Math.hypot(p[0]-pts[i][0],p[1]-pts[i][1]),0);
  for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len<.01)continue;const dx=(b[0]-a[0])/len,dy=(b[1]-a[1])/len;
   for(let k=(13-walked%26+26)%26;k<len;k+=26){const along=walked+k;if(along<9||total-along<9)continue;const side=n++%2?1:-1,off=r.width/2+.9,x=a[0]+dx*k-dy*off*side,y=a[1]+dy*k+dx*off*side;if(!inView(x,y)||blocked(x,y,.4))continue;
    cyl(x,y,0,.09,6.8,'#5b6064',6);const hx=x+dy*side*1.1,hy=y-dx*side*1.1;line([x,y],[hx,hy],.08,6.7,.08,'#5b6064');box(hx,hy,6.5,.55,.25,.18,night?'#ffb85c':'#8c9294',Math.atan2(dy,dx));glow(hx,hy,8,[1,.6,.26],.45);counts.streetLamps=(counts.streetLamps||0)+1;}
   walked+=len;}}}
// Buildings. Footprints and heights from scene.json; facade/roof elements are authored.
const palette=['#f1e2bb','#efd69a','#e9a982','#efcbbb','#f3eedf','#cdd7ae','#e4c596','#cf8763'];
const colorTags={white:'#ece9dc',beige:'#ddc9a6',grey:'#c5c8c6',gray:'#c5c8c6',orange:'#dfa679',red:'#bd7a5f',yellow:'#e6d29a',pink:'#e8b9ad'};
const trims=['#7b9a95','#a5684d','#8d9c7c','#f3eee0','#c2765a'];
const roofs=['#d9d5c6','#ece6d4','#b9bdb8','#c88d68','#d0b796','#a9aea6','#e2d1b6'];
// Typology from OSM tags and footprint size. Visual vocabulary per type is authored; footprints and heights are not.
function typeOf(f){const t=f.tags,b=t.building||t['building:part']||'yes';
 if(b==='construction')return 'construction';if(['roof','carport','canopy'].includes(b))return 'canopy';if(b==='water_tower'||t.man_made==='water_tower')return 'watertower';
 if(['temple','mosque','church','chapel','shrine'].includes(b)||t.amenity==='place_of_worship')return 'worship';
 if(['industrial','warehouse','factory','manufacture','hangar','storage_tank'].includes(b)||(b==='yes'&&f.area>2200&&f.height<=9.6))return 'industrial';
 if(['school','university','college','kindergarten'].includes(b)||['school','university','college'].includes(t.amenity))return 'education';
 if(b==='hospital'||t.amenity==='hospital'||t.healthcare==='hospital')return 'hospital';
 if(['retail','commercial','supermarket','kiosk','shop'].includes(b)||t.shop)return 'commercial';
 if(f.height>=36)return 'tower';
 if(['office','government','public','civic','train_station','transportation'].includes(b)||t.office)return 'civic';
 if(['house','detached','bungalow','hut','semidetached_house','terrace','shed'].includes(b)||(f.area<170&&f.height<=6.4))return 'house';
 return 'block';}
const TYPE={
 house:{walls:['#f0d9c4','#efc9b5','#f2e6c8','#e5d2a8','#d9e2c8','#f4efe3','#e9b99a','#cfe0dc'],roofs:['#d8d2c2','#c98d68','#e6dfcc','#b9b3a5'],bay:3.4,win:1.1,trim:['#8b5e3c','#3f6f8a','#9a3f2f','#f3eee0']},
 block:{walls:palette,roofs,bay:2.8,win:1.3,trim:trims},
 civic:{walls:['#efe6d2','#e8dcc0','#f2efe6','#dcd6c6'],roofs:['#d3cdbd','#e2dccb','#bdb9ad'],bay:3.0,win:1.9,trim:['#8b6d4c','#5d7d80','#a8573b']},
 education:{walls:['#e9cf8f','#efdca8','#e6c38d','#f1e2bd'],roofs:['#d6cdb8','#c9b48f'],bay:3.2,win:1.7,trim:['#9a4b32','#7a6a3a']},
 hospital:{walls:['#f3f2ec','#eef0ee','#e8ecea'],roofs:['#e1e1dc','#cfd3d1'],bay:2.9,win:2.0,trim:['#3c8f8c','#5c85a8']},
 commercial:{walls:['#e7dccb','#d9d3c8','#efe1cf','#d2c4b4','#e9cfb6'],roofs:['#cbc5b8','#b8b4aa'],bay:3.6,win:2.2,trim:['#2f5e8a','#b73a32','#d68a1c','#2f7a52']},
 industrial:{walls:['#c9ccc7','#c3cdd2','#d3cfc4'],roofs:['#aab5bd','#b7bec0','#9eaab3'],bay:6,win:2.4,trim:['#5f6f7a','#7d6a50']},
 tower:{walls:['#7fa7bd','#8fb3c5','#6f97ae'],roofs:['#c9cfd1','#b8c0c4'],bay:1.6,win:1.45,trim:['#d8e2e6']},
 construction:{walls:['#b9b5aa'],roofs:['#aaa69b'],bay:5,win:0,trim:['#8a867c']},
 canopy:{walls:['#b8c0c4'],roofs:['#c4ccd0','#d0c8b8'],bay:6,win:0,trim:['#7b8287']},
 watertower:{walls:['#d8d2c4'],roofs:['#cfc9bb'],bay:0,win:0,trim:['#8e8778']},
 worship:{walls:['#f3ead6','#f1e1c2','#efe7dc'],roofs:['#e9dcc0'],bay:3.2,win:1.0,trim:['#c8622a','#a84a2a']},
};
// building:colour / roof:colour: OSM names, CSS names or hex; anything unparsable falls back to the typology palette.
function tagColor(v){if(!v)return null;if(colorTags[v])return colorTags[v];try{const c=new T.Color();c.setStyle(String(v).replace(/_/g,''));return '#'+c.getHexString();}catch{return null;}}
// Oriented bounding box along the longest edge; fill = footprint area / OBB area.
function obb(poly){let best=0,rot=0;for(let j=1;j<poly[0].length;j++){const a=poly[0][j-1],b=poly[0][j],l=Math.hypot(b[0]-a[0],b[1]-a[1]);if(l>best){best=l;rot=Math.atan2(b[1]-a[1],b[0]-a[0]);}}
 const c=Math.cos(rot),s2=Math.sin(rot),pts=poly[0].map(([x,y])=>[x*c+y*s2,-x*s2+y*c]),u0=Math.min(...pts.map(p=>p[0])),u1=Math.max(...pts.map(p=>p[0])),v0=Math.min(...pts.map(p=>p[1])),v1=Math.max(...pts.map(p=>p[1]));
 const cu=(u0+u1)/2,cv=(v0+v1)/2;return{rot,L:u1-u0,W:v1-v0,cx:cu*c-cv*s2,cy:cu*s2+cv*c};}
function pitchedRoof(f,poly,h,shapeName,color){const o=obb(poly);if(f.area/(o.L*o.W)<.8||o.W<3)return false;const rise=Math.min(4,o.W*.32);
 if(shapeName==='gabled'){const tri=new T.Shape([new T.Vector2(-o.W/2-.35,0),new T.Vector2(o.W/2+.35,0),new T.Vector2(0,rise)]);const g=new T.ExtrudeGeometry(tri,{depth:o.L+.5,bevelEnabled:false});g.rotateX(Math.PI/2);g.rotateZ(Math.PI/2);g.translate(-(o.L+.5)/2,0,0);g.rotateZ(o.rot); // extrusion now spans the long axis, centredg.translate(o.cx,o.cy,h);batch(g,color);
  line([o.cx-Math.cos(o.rot)*(o.L/2+.25),o.cy-Math.sin(o.rot)*(o.L/2+.25)],[o.cx+Math.cos(o.rot)*(o.L/2+.25),o.cy+Math.sin(o.rot)*(o.L/2+.25)],.25,h+rise-.05,.12,'#8a4a32');
  // Wide sheds: corrugation stripes parallel to the ridge, following the roof slope.
  if(o.W>10){const c=Math.cos(o.rot),s2=Math.sin(o.rot),shade='#'+new T.Color(color).multiplyScalar(.86).getHexString();for(let v=-o.W/2+.6;v<o.W/2-.3;v+=1.2){const z=h+rise*(1-Math.abs(v)/(o.W/2+.35));line([o.cx-o.L/2*c-v*s2,o.cy-o.L/2*s2+v*c],[o.cx+o.L/2*c-v*s2,o.cy+o.L/2*s2+v*c],.14,z,.05,shade);}}}
 else{const g=new T.CylinderGeometry(.12,1,rise,4,1);g.rotateY(Math.PI/4);g.rotateX(Math.PI/2);g.scale((o.L+.6)/Math.SQRT2,(o.W+.6)/Math.SQRT2,1);g.translate(0,0,rise/2);g.rotateZ(o.rot);g.translate(o.cx,o.cy,h);batch(g,color);}
 counts.pitchedRoofs=(counts.pitchedRoofs||0)+1;return true;}
function building(f){const rand=random(hash(f.id)),poly=polygons(f.geometry)[0];if(!poly)return;const base=Number(f.tags.min_height)>0&&Number(f.tags.min_height)<f.height?Number(f.tags.min_height):0,h=f.height;
 const type=detail?typeOf(f):'block',S=TYPE[type];
 const color=detail?(tagColor(f.tags['building:colour'])||S.walls[Math.floor(rand()*S.walls.length)]):'#d5c2a5',roof=detail?(tagColor(f.tags['roof:colour'])||S.roofs[Math.floor(rand()*S.roofs.length)]):'#d6c9b2',trim=S.trim[hash(f.id)%S.trim.length];
 if(detail&&cfg.focalAsset?.sourceId===f.id){assembly(f,poly);counts.buildings++;return;}
 if(detail&&landmarkFor(f)){landmark(f,poly,landmarkFor(f));counts.buildings++;return;}
 counts.buildings++;(counts.types||={})[type]=(counts.types[type]||0)+1;
 if(type==='canopy'&&detail){const ch=Math.min(h,4.5);for(const ring of poly.slice(0,1))for(let j=1;j<ring.length;j++){const a=ring[j-1],b=ring[j],len=Math.hypot(b[0]-a[0],b[1]-a[1]);for(let k=0;k<len;k+=6)cyl(a[0]+(b[0]-a[0])*k/len,a[1]+(b[1]-a[1])*k/len,0,.12,ch,'#6f777c',6);}
  batch(new T.ExtrudeGeometry(shape(poly),{depth:.25,bevelEnabled:false}).translate(0,0,ch),roof);return;}
 if(type==='watertower'&&detail){const [x,y]=f.centroid,r=Math.max(2.5,Math.sqrt(f.area/Math.PI));for(let i=0;i<8;i++){const t=i*Math.PI/4;cyl(x+Math.cos(t)*r*.7,y+Math.sin(t)*r*.7,0,.3,h*.72,'#cfc8b8',6);}cyl(x,y,0,r*.25,h*.72,'#d8d2c4',10);
  cyl(x,y,h*.72,r,h*.22,'#e2dccd',16,r*1.08);cyl(x,y,h*.94,r*1.08,h*.06,'#c9c1b0',16,r*.3);return;}
 if(type==='construction'&&detail){const floors=Math.max(1,Math.round(h/3.2)),o=obb(poly),c=Math.cos(o.rot),s2=Math.sin(o.rot);
  for(let fl=1;fl<=floors;fl++){const z=fl*3.2;if(fl<floors||rand()>.4)batch(new T.ExtrudeGeometry(shape(poly),{depth:.22,bevelEnabled:false}).translate(0,0,z-.22),'#b9b5aa');}
  for(let u=-o.L/2+.6;u<=o.L/2-.6;u+=4.5)for(let v=-o.W/2+.6;v<=o.W/2-.6;v+=4.5){const x=o.cx+u*c-v*s2,y=o.cy+u*s2+v*c;if(inGeometry([x,y],f.geometry))box(x,y,0,.4,.4,floors*3.2,'#a9a59a',o.rot);}
  batch(new T.ExtrudeGeometry(shape(poly),{depth:.3,bevelEnabled:false}),'#a29e92');return;}
 const g0=new T.ExtrudeGeometry(shape(poly),{depth:h-base,bevelEnabled:false});g0.translate(0,0,base);batch(g0,color);
 const roofShape=f.tags['roof:shape'];const pitched=detail&&['gabled','hipped','pyramidal'].includes(roofShape)&&pitchedRoof(f,poly,h,roofShape,tagColor(f.tags['roof:colour'])||['#b9603f','#c4744f','#9a5a42','#8f8f88'][hash(f.id)%4]);
 if(!pitched)surface(f.geometry,roof,h+.025);
 if(!detail)return;
 // Night lighting uses its own RNG so day and night share every other random choice.
 const lrand=random(hash(f.id)+777),litShare={civic:.2,education:.12,commercial:.45,industrial:.08,tower:.5,hospital:.6}[type]??.38;
 const storey=type==='industrial'?h:type==='tower'?3.6:3.2,floors=Math.max(1,Math.round((h-base)/storey)),pitch=(h-base)/floors;
 const glassA=type==='tower'?'#4f7f9c':type==='hospital'?'#3f7f88':'#3d6a80',glassB=type==='tower'?'#3d6a85':'#2b4c61';
 for(let ri=0;ri<poly.length;ri++){const ring=poly[ri];for(let j=1;j<ring.length;j++){const a=ring[j-1],b=ring[j],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);if(len<.3)continue;const theta=Math.atan2(dy,dx),nx=dy/len,ny=-dx/len,out=ri===0?1:-1,ox=nx*out,oy=ny*out,street=ri===0&&j-1===f.entryEdge;
  if(!pitched){const par=type==='house'?.6:type==='industrial'?.4:.85;line(a,b,.24,h,par,color);line(a,b,.34,h+par,.12,type==='tower'?'#dfe6e8':'#f4f0e2');}
  line(a,b,.2,base+.12,.45,'#9c9888');
  if(type!=='tower')line(a,b,.25,h-.3,.24,trim);
  for(let k=1;k<floors;k++)line(a,b,type==='tower'?.3:.24,base+k*pitch-.14,type==='tower'?.28:.18,type==='tower'?'#dfe6e8':'#ebe5d2');
  // Education: continuous verandah slab and parapet rail on long faces; commercial: shutters + signboards on the street face.
  if(type==='education'&&len>12)for(let k=1;k<=floors;k++){line([a[0]+ox*.9,a[1]+oy*.9],[b[0]+ox*.9,b[1]+oy*.9],1.6,base+k*pitch-.2,.18,'#e9dfc6');for(let u=2;u<len-1;u+=4)box(a[0]+dx*u/len+ox*1.6,a[1]+dy*u/len+oy*1.6,base+(k-1)*pitch,.28,.28,pitch-.2,'#efe6cf',theta);}
  if(type==='commercial'&&street&&len>4){const bays=Math.max(1,Math.floor(len/3.6));for(let k=0;k<bays;k++){const t=(k+.5)/bays,x=a[0]+dx*t+ox*.1,y=a[1]+dy*t+oy*.1,w=len/bays*.86;box(x,y,base+.15,w,.08,2.6,night&&lrand()<.6?'#ffe3a8':'#6d7276',theta);box(x+ox*.12,y+oy*.12,base+2.85,w,.12,.75,['#2f5e8a','#b73a32','#d68a1c','#2f7a52','#e2c13a','#7a3d8f'][hash(f.id+k)%6],theta);if(night)glow(x+ox*2,y+oy*2,2.6,[1,.85,.6],.22);}}
  if(len<2.2||!S.win)continue;
  const bays=Math.max(1,Math.floor((len-.8)/S.bay)),groundShop=type==='commercial'&&street;
  for(let k=0;k<bays;k++){const t=(k+.5)/bays,x=a[0]+dx*t+ox*.08,y=a[1]+dy*t+oy*.08,w=Math.min(S.win,(len-.8)/bays*(type==='tower'?.92:.62));
   for(let fl=groundShop?1:0;fl<floors;fl++){const z=base+fl*pitch+(type==='industrial'?h*.55:type==='tower'?.4:.85),wh=type==='industrial'?1.2:type==='tower'?pitch-.75:1.38;if(z+wh+.1>h)break;
    const glass=rand()>.55?glassA:glassB,lit=night&&lrand()<litShare;
    if(type!=='tower'&&type!=='industrial')box(x,y,z,w+.22,.18,wh+.22,'#efeadb',theta);
    box(x+ox*.1,y+oy*.1,z+.1,w,.05,wh,lit?['#ffd27a','#ffe3a8','#d6ecff'][Math.floor(lrand()*3)]:glass,theta);if(lit)counts.litWindows=(counts.litWindows||0)+1;
    if(type==='block'||type==='house'||type==='worship'){box(x+ox*.15,y+oy*.15,z+.76,w,.06,.07,'#c5d6cf',theta);box(x+ox*.24,y+oy*.24,z-.08,w+.32,.5,.12,'#efe8d0',theta);box(x+ox*.3,y+oy*.3,z+1.66,w+.5,.75,.13,color,theta);}
    else if(type==='civic'||type==='hospital'||type==='education')box(x+ox*.3,y+oy*.3,z+wh+.05,w+.4,.55,.12,trim,theta);
    else if(type==='tower')box(x+ox*.13,y+oy*.13,z,.08,.08,wh,'#d8e2e6',theta);
    counts.windows++;}}
  if(street){const x=(a[0]+b[0])/2+nx*.12,y=(a[1]+b[1])/2+ny*.12;if(night){box(x+nx*.2,y+ny*.2,2.45,.5,.12,.22,'#ffe9c2',theta);glow(x+nx*1.4,y+ny*1.4,3,[1,.7,.4],.25);}
   if(type==='industrial'){box(x,y,.12,Math.min(5,len*.5),.14,4.2,'#7d878e',theta);for(let r2=.5;r2<4.2;r2+=.35)box(x+nx*.09,y+ny*.09,r2,Math.min(5,len*.5),.04,.05,'#9aa3a9',theta);}
   else{box(x,y,base+.12,1.2,.14,2.3,'#5a6f6d',theta);box(x+nx*.45,y+ny*.45,.05,1.8,.9,.15,'#efe6cc',theta);box(x+nx*.55,y+ny*.55,2.55,2.2,1.2,.16,trim,theta);}}
 }}
 if(pitched)return;
 const safe=f.roofSafe||f.roofEquipmentSafe,[rx,ry]=f.center,rotation=Math.atan2(poly[0][1][1]-poly[0][0][1],poly[0][1][0]-poly[0][0][0]);
 const local=(u,v)=>[rx+Math.cos(rotation)*u-Math.sin(rotation)*v,ry+Math.sin(rotation)*u+Math.cos(rotation)*v];
 // Every corner of each roof object must sit inside the footprint buffered inward by 1.1 m (parapet).
 const fits=(u,v,hw,hd)=>[[u-hw,v-hd],[u+hw,v-hd],[u+hw,v+hd],[u-hw,v+hd],[u,v]].every(p=>inGeometry(local(...p),safe));
 if(type==='industrial'){const o=obb(poly),c=Math.cos(o.rot),s2=Math.sin(o.rot);for(let v=-o.W/2+.8;v<o.W/2-.8;v+=1.1){const p=[o.cx-o.L/2*c-v*s2,o.cy-o.L/2*s2+v*c],q2=[o.cx+o.L/2*c-v*s2,o.cy+o.L/2*s2+v*c];if(inGeometry(p,safe)&&inGeometry(q2,safe))line(p,q2,.12,h+.03,.07,'#97a3ab');}
  for(let k=0;k<Math.floor(f.area/500);k++){const u=(rand()-.5)*o.L*.8,v=(rand()-.5)*o.W*.8;if(fits(u,v,.6,.6))cyl(...local(u,v),h+.05,.45,.9,'#c3c9cc',10);}return;}
 if(type==='worship'){temple(f,poly,h,color,rand);return;}
 // Large flat roofs: expansion-joint / waterproofing grid, segments kept inside the parapet-safe polygon.
 if(f.area>900){const half=Math.sqrt(f.area)*.9,step=f.area>5000?7:5;for(let g=-half;g<=half;g+=step)for(let k=-half;k<half;k+=step){for(const [p,q2] of [[local(g,k),local(g,k+step)],[local(k,g),local(k+step,g)]])if(inGeometry(p,safe)&&inGeometry(q2,safe))line(p,q2,.12,h+.03,.04,'#c9bfa8');}}
 const flip=rand()>.5?1:-1;let placedRoof=0;
 if(fits(-1.7*flip,-1.2,1.3,1.45)&&rand()>.2){box(...local(-1.7*flip,-1.2),h+.03,2.3,2.6,2.1,color,rotation);box(...local(-1.7*flip,-1.2),h+2.13,2.6,2.9,.16,'#ece7d4',rotation);box(...local(-1.7*flip,-.05),h+.1,.9,.06,1.9,'#6d6152',rotation);counts.roofDetails++;placedRoof++;}
 // Stair cabins, black polyethylene water tanks, AC units and solar rows on a footprint-aligned grid; towers get plant rooms.
 const items=type==='tower'?3:Math.min(16,Math.max(type==='house'?1:2,Math.floor(f.area/60)));for(let k=0;k<items*10&&placedRoof<items+1;k++){const u=(rand()-.5)*Math.sqrt(f.area)*1.1,v=(rand()-.5)*Math.sqrt(f.area)*1.1,kind=rand();
  if(type==='tower'){if(fits(u,v,3,3)){box(...local(u,v),h+.05,6,6,3,'#c9cfd1',rotation);placedRoof++;}continue;}
  if(kind<.45&&fits(u,v,.7,.7)){cyl(...local(u,v),h+.1,.62,1.2,rand()>.35?'#2f3537':'#d8d0b8',12);cyl(...local(u,v),h+1.3,.3,.12,'#555c5c',10);placedRoof++;}
  else if(kind<.7&&fits(u,v,.7,.5)){box(...local(u,v),h+.08,1.2,.8,.6,'#d3d9d4',rotation);placedRoof++;}
  else if(kind<.85&&fits(u,v,2.4,1.3)){for(let i=0;i<3;i++)box(...local(u+(i-1)*1.55,v),h+.35,1.35,2.4,.08,'#3f5b78',rotation);placedRoof++;}
  else if(fits(u,v,1.6,1.6)){box(...local(u,v),h+.03,3,3,2.4,color,rotation);box(...local(u,v),h+2.43,3.2,3.2,.14,'#ece7d4',rotation);placedRoof++;}}
 counts.roofDetails+=placedRoof;
 if(type!=='tower'&&fits(1.3*flip,1.5,.7,.7)&&rand()>.15){cyl(...local(1.3*flip,1.5),h+.12,.62,1.2,'#2f3537',12);counts.roofDetails++;}
}
// Generic place-of-worship crown: stepped shikhara (Hindu/Jain), dome + minarets (Muslim), gable + bell tower (Christian). Authored.
function temple(f,poly,h,color,rand){const [x,y]=f.center,rel=f.tags.religion||'hindu',o=obb(poly),r=Math.min(o.L,o.W)*.32;if(!inGeometry([x,y],f.roofSafe||f.geometry)||r<1.2)return;
 if(rel==='muslim'){cyl(x,y,h,r*.9,1,'#eee6d4',12);const g=new T.SphereGeometry(r*.85,14,8,0,Math.PI*2,0,Math.PI/2);g.rotateX(Math.PI/2);g.translate(x,y,h+1);batch(g,'#f2ede1');cyl(x,y,h+1+r*.85,.12,1.2,'#c9a64a',6);
  for(const sg of [-1,1]){const c=Math.cos(o.rot),s2=Math.sin(o.rot),mx=x+sg*(o.L/2-.8)*c,my=y+sg*(o.L/2-.8)*s2;if(inGeometry([mx,my],f.geometry)){cyl(mx,my,h,.5,8,'#eee6d4',8);cyl(mx,my,h+8,.65,.5,'#e3d8bf',8,.1);}}counts.domes=(counts.domes||0)+1;return;}
 if(rel==='christian'){cyl(x,y,h,1,6,'#eee6d4',4);cyl(x,y,h+6,1.1,3,'#b9603f',4,.05);return;}
 for(let i=0;i<5;i++){const k=1-i*.17;box(x,y,h+i*r*.38,r*2*k,r*2*k,r*.38,i%2?'#f3e9d0':color,o.rot);}
 cyl(x,y,h+5*r*.38,r*.5,r*.9,'#efdfba',8,.15);cyl(x,y,h+5*r*.38+r*.9,.25,.6,'#d4a334',8,.08);line([x,y],[x+.01,y],.05,h+5*r*.38+r*.9,2.2,'#7a6a5a');box(x+.5,y,h+5*r*.38+r*.9+1.6,.9,.04,.6,'#e86d1f',0);counts.shikharas=(counts.shikharas||0)+1;}
// Configured landmarks (cfg.landmarks: [{sourceId,type}]): authored models fitted to the OSM footprint.
const LANDMARKS=new Map((cfg.landmarks||[]).map(l=>[l.sourceId,l]));
function landmarkFor(f){return LANDMARKS.get(f.id)||LANDMARKS.get(f.id.split('/').slice(0,2).join('/'));}
function dome(x,y,z,r,rise,color,finial='#d4a334'){const g=new T.SphereGeometry(r,16,8,0,Math.PI*2,0,Math.PI/2);g.rotateX(Math.PI/2);g.scale(1,1,rise/r);g.translate(x,y,z);batch(g,color);cyl(x,y,z+rise,.14*r+.1,.5+r*.25,finial,8,.04);}
function landmark(f,poly,spec){const o=obb(poly),c=Math.cos(o.rot),s2=Math.sin(o.rot),at=(u,v)=>[o.cx+u*c-v*s2,o.cy+u*s2+v*c];counts.landmarks=(counts.landmarks||0)+1;
 if(spec.type==='akshardham'){ // published: ~108 ft (33 m) high, 240 ft long, 131 ft wide, pink sandstone
  const stone='#e3a98a',light='#eec0a3',dark='#c98f70',plinth=2.6,body=14.5;
  batch(new T.ExtrudeGeometry(shape(poly),{depth:plinth,bevelEnabled:false}),'#d79d7f');surface(f.geometry,'#e8b99b',plinth+.02);
  for(const ring of poly)for(let j=1;j<ring.length;j++){const a=ring[j-1],b=ring[j];line(a,b,.5,.6,.35,dark);line(a,b,.5,plinth-.4,.3,dark);}
  const inner=poly[0].map(([x,y])=>[o.cx+(x-o.cx)*.9,o.cy+(y-o.cy)*.9]);batch(new T.ExtrudeGeometry(shape([inner]),{depth:body,bevelEnabled:false}).translate(0,0,plinth),stone);surface({type:'Polygon',coordinates:[inner]},light,plinth+body+.02);
  for(let j=1;j<inner.length;j++){const a=inner[j-1],b=inner[j],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);if(len<1)continue;const nx=dy/len,ny=-dx/len;
   for(let z=plinth+1.6;z<plinth+body;z+=1.6)line([a[0]+nx*.06,a[1]+ny*.06],[b[0]+nx*.06,b[1]+ny*.06],.25,z,.22,dark);
   for(let u=1;u<len-.5;u+=2.2)cyl(a[0]+dx*u/len+nx*.5,a[1]+dy*u/len+ny*.5,plinth,.36,body-.4,light,8);
   line([a[0]+nx*.6,a[1]+ny*.6],[b[0]+nx*.6,b[1]+ny*.6],1.3,plinth+body-.5,.6,light);}
  const top=plinth+body,R=Math.min(o.W,o.L)*.27;cyl(o.cx,o.cy,top,R*1.05,3.2,light,16);for(let i=0;i<16;i++){const t=i*Math.PI/8;cyl(o.cx+Math.cos(t)*R,o.cy+Math.sin(t)*R,top,.3,3.2,stone,6);}
  dome(o.cx,o.cy,top+3.2,R,33-top-3.2-1.2,'#f0c8ad');
  for(const [su,sv] of [[1,1],[1,-1],[-1,1],[-1,-1]]){const [x,y]=at(su*o.L*.33,sv*o.W*.28);cyl(x,y,top,R*.45,1.8,light,12);dome(x,y,top+1.8,R*.42,R*.5,'#edc2a6');}
  for(const su of [-.62,-.18,.18,.62])for(const sv of [1,-1]){const [x,y]=at(su*o.L/1.6,sv*o.W*.4);dome(x,y,top+.4,R*.2,R*.26,'#edc2a6');}
  return;}
 if(spec.type==='saltmound'){ // Dandi Kutir: ~41 m conical salt-mound shell (published), fitted to the footprint
  const r=Math.min(o.L,o.W)/2,H=spec.height||41,pts=[];for(let i=0;i<=14;i++){const t=i/14;pts.push(new T.Vector2(r*(1-t)**1.15+.01,H*(1-(1-t)**1.8)));}
  const g=new T.LatheGeometry(pts,40);g.rotateX(Math.PI/2);g.translate(o.cx,o.cy,0);batch(g,'#f1eee6');
  for(let i=1;i<9;i++){const t=i/9,rr=r*(1-t)**1.15,z=H*(1-(1-t)**1.8);const ring=new T.TorusGeometry(rr+.05,.12,4,40);ring.translate(o.cx,o.cy,z);batch(ring,'#d9d4c8');}
  return;}
}
function assembly(f,poly){
 const [x,y]=f.centroid,h=f.height;const wall=f.tags['building:colour']==='white'?'#efeadc':'#e8d3a8';batch(new T.ExtrudeGeometry(shape(poly),{depth:h,bevelEnabled:false}),wall);surface(f.geometry,'#e4dccb',h+.03);
 for(const ring of poly)for(let j=1;j<ring.length;j++){const a=ring[j-1],b=ring[j],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy),angle=Math.atan2(dy,dx);if(len<.5)continue;const nx=dy/len,ny=-dx/len;
  line(a,b,.8,h,.9,'#f4e6ca');line(a,b,.9,h+.9,.15,'#b98e5c');for(let z=3;z<h;z+=3.2){line(a,b,.7,z,.28,'#cfb48a');const n=Math.floor(len/3);for(let k=0;k<n;k++){const u=(k+.5)/n;box(a[0]+dx*u+nx*.1,a[1]+dy*u+ny*.1,z-2.2,1.5,.2,1.7,night&&hash(f.id+k+'/'+z+'/'+j)%3!==0?'#ffe3a8':'#456571',angle);counts.windows++;}}
  for(let k=2;k<len-1;k+=6)cyl(a[0]+dx*k/len+nx*.4,a[1]+dy*k/len+ny*.4,.2,.4,h,'#f2e3c4',8);
 }
 // Authored stepped roof: footprint scaled about the centroid, used only where every vertex stays inside the source footprint.
 let top=h;for(const [k,dz,col] of [[.78,2.4,'#e9d8b4'],[.56,4.6,'#efe1c2']]){const ring=poly[0].map(([px,py])=>[x+(px-x)*k,y+(py-y)*k]);if(!ring.every(p=>inGeometry(p,f.geometry)))continue;
  batch(new T.ExtrudeGeometry(shape([ring]),{depth:dz,bevelEnabled:false}).translate(0,0,h),col);surface({type:'Polygon',coordinates:[ring]},'#e6d6b6',h+dz+.03);
  for(let j=1;j<ring.length;j++){const a=ring[j-1],b=ring[j],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);if(len<1)continue;const ang=Math.atan2(dy,dx),nx=dy/len,ny=-dx/len;line(a,b,.5,h+dz,.5,'#c7a674');
   for(let u=1.5;u<len-1;u+=2.6)box(a[0]+dx*u/len+nx*.1,a[1]+dy*u/len+ny*.1,h+.5,1.1,.2,dz-1.1,'#55707a',ang);}top=h+dz;}
 const r=cfg.focalAsset.domeRadius;const ok=Array.from({length:32},(_,i)=>[x+Math.cos(i*Math.PI/16)*r,y+Math.sin(i*Math.PI/16)*r]).every(p=>inGeometry(p,f.geometry));
 if(ok){cyl(x,y,top,r+1.5,1.2,'#c9ad7f',8);cyl(x,y,top+1.2,r,2.4,'#efe1c2',8);for(let i=0;i<8;i++){const t=(i+.5)*Math.PI/4;cyl(x+Math.cos(t)*r*.97,y+Math.sin(t)*r*.97,top+1.2,.45,2.4,'#b98e5c',6);}
  cyl(x,y,h+3.6,r,cfg.focalAsset.domeRise*.55,'#e7d0a2',8,r*.72);cyl(x,y,h+3.6+cfg.focalAsset.domeRise*.55,r*.72,cfg.focalAsset.domeRise*.45,'#eddcb6',8,r*.18);cyl(x,y,h+3.6+cfg.focalAsset.domeRise,1.3,2.2,'#bf9f62',8);cyl(x,y,h+5.8+cfg.focalAsset.domeRise,.14,4,'#5d655e',8);counts.focalAssets++;}
}
stage('roads');
// The authored focal model replaces its source outline; building:part ways wholly inside it are not built separately.
const focal=detail&&cfg.focalAsset?data.buildings.find(b=>b.id===cfg.focalAsset.sourceId):null;
const replaced=f=>focal&&f!==focal&&f.tags['building:part']&&polygons(f.geometry).every(p=>p[0].every(q=>inGeometry(q,focal.geometry)));
for(const f of data.buildings){const [x0,y0,x1,y1]=bbox(f.geometry);if(x1<view.minX||x0>view.maxX||y1<view.minY||y0>view.maxY)continue;if(replaced(f)){(counts.replacedParts||=[]).push(f.id);continue;}building(f);}

stage('buildings');
// Plot detail (authored): OSM has no plot boundaries, so each residential building inside mapped residential landuse
// gets an inferred plot = its footprint-aligned rectangle grown by a few metres. Walls are drawn only where they stay
// inside the landuse polygon, clear of roads, water/parking and other footprints; shared edges inside a cluster drop out.
const residentialLand=data.sourceFeatures.filter(f=>f.kind==='landuse'&&f.tags.landuse==='residential'&&['Polygon','MultiPolygon'].includes(f.geometry.type));
const homeTypes=new Set(['residential','apartments','house','detached','terrace','yes','semidetached_house','bungalow']);
const plots=[],plotIndex=grid(30),plotTrees=[];
if(detail)for(const f of data.buildings){const poly=polygons(f.geometry)[0];if(!poly||f.area>2500||!homeTypes.has(f.tags.building)||f.tags['building:part'])continue;if(f===focal||!inView(...f.center))continue;
 const land=residentialLand.find(l=>inGeometry(f.center,l.geometry));if(!land)continue;
 let best=0,rot=0;for(let j=1;j<poly[0].length;j++){const a=poly[0][j-1],b=poly[0][j],l=Math.hypot(b[0]-a[0],b[1]-a[1]);if(l>best){best=l;rot=Math.atan2(b[1]-a[1],b[0]-a[0]);}}
 const c=Math.cos(rot),sn=Math.sin(rot),[ox,oy]=f.center,toL=([x,y])=>[(x-ox)*c+(y-oy)*sn,-(x-ox)*sn+(y-oy)*c],toW=(u,v)=>[ox+u*c-v*sn,oy+u*sn+v*c];
 const loc=poly[0].map(toL),m=f.area<220?2.6:f.area<700?3.6:4.6,rand=random(hash(f.id)+41);
 const r={f,land,toW,u0:Math.min(...loc.map(p=>p[0]))-m,u1:Math.max(...loc.map(p=>p[0]))+m,v0:Math.min(...loc.map(p=>p[1]))-m,v1:Math.max(...loc.map(p=>p[1]))+m,rot,rand};
 r.corners=[toW(r.u0,r.v0),toW(r.u1,r.v0),toW(r.u1,r.v1),toW(r.u0,r.v1)];r.ring=[...r.corners,r.corners[0]];r.geometry={type:'Polygon',coordinates:[r.ring]};
 plots.push(r);plotIndex.add(bbox(r.geometry),r);}
// Overlapping plots form one compound (union-find); a compound shares its yard colour and outer wall.
const parent=plots.map((_,i)=>i),find=i=>parent[i]===i?i:(parent[i]=find(parent[i]));plots.forEach((r,i)=>r.i=i);
for(const r of plots)for(const q of r.corners)for(const o of plotIndex.near(...q))if(o!==r&&inGeometry(q,o.geometry))parent[find(o.i)]=find(r.i);
for(const r of plots){for(const o of plotIndex.near(...r.f.center))if(o!==r&&(inGeometry(o.corners[0],r.geometry)||inGeometry(r.corners[0],o.geometry)))parent[find(o.i)]=find(r.i);}
for(const r of plots)r.cluster=plots[find(r.i)].f.id;
const inOtherPlot=(p,self)=>plotIndex.near(...p).some(o=>o!==self&&inGeometry(p,o.geometry));
const roadDist=(x,y)=>{let d=Infinity;for(const s of roadIndex.near(x,y)){const vx=s.b[0]-s.a[0],vy=s.b[1]-s.a[1],l2=vx*vx+vy*vy||1,t=Math.max(0,Math.min(1,((x-s.a[0])*vx+(y-s.a[1])*vy)/l2));d=Math.min(d,Math.hypot(x-s.a[0]-vx*t,y-s.a[1]-vy*t)-s.half);}return d;};
const wallColors=['#d8c49c','#cdb995','#d6b79a','#c9c2a4'];
for(const r of plots){const {toW,rand}=r,okPt=p=>inGeometry(p,r.land.geometry)&&!nearRoad(p[0],p[1],.4)&&!blocked(p[0],p[1],.35)&&!inOtherPlot(p,r);
 const sides=[[[r.u0,r.v0],[r.u1,r.v0]],[[r.u1,r.v0],[r.u1,r.v1]],[[r.u1,r.v1],[r.u0,r.v1]],[[r.u0,r.v1],[r.u0,r.v0]]];
 const gateSide=sides.map(([a,b])=>roadDist(...toW((a[0]+b[0])/2,(a[1]+b[1])/2))).reduce((bi,d,i,arr)=>d<arr[bi]?i:bi,0);
 const wc=wallColors[hash(r.cluster)%wallColors.length];let pieces=0;
 sides.forEach(([a,b],si)=>{const len=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.max(1,Math.round(len/1.25)),mid=len/2;
  for(let k=0;k<n;k++){const t0=k/n,t1=(k+1)/n,along=(t0+t1)/2*len;if(si===gateSide&&Math.abs(along-mid)<1.7)continue;
   const p=toW(a[0]+(b[0]-a[0])*t0,a[1]+(b[1]-a[1])*t0),q=toW(a[0]+(b[0]-a[0])*t1,a[1]+(b[1]-a[1])*t1);if(!okPt(p)||!okPt(q))continue;
   line(p,q,.26,0,1.5,wc);line(p,q,.34,1.5,.12,'#f3ecda');pieces++;}
  if(si===gateSide){for(const sg of [-1,1]){const g=toW(a[0]+(b[0]-a[0])*(mid+sg*1.75)/len,a[1]+(b[1]-a[1])*(mid+sg*1.75)/len);if(okPt(g)){box(...g,0,.45,.45,1.7,wc,r.rot);box(...g,1.7,.55,.55,.12,'#f6f1e3',r.rot);}}
   const gm=toW((a[0]+b[0])/2,(a[1]+b[1])/2),inward=toW(0,0);if(okPt(gm)){
    // paved path from gate toward the building, stopping at its footprint
    const steps=24;let last=gm;for(let i=1;i<=steps;i++){const p=[gm[0]+(inward[0]-gm[0])*i/steps,gm[1]+(inward[1]-gm[1])*i/steps];if(inGeometry(p,r.f.geometry))break;last=p;}line(gm,last,1.6,.045,.02,'#cfc4ad');}}});
 if(pieces)counts.plotWalls=(counts.plotWalls||0)+pieces;counts.plots=(counts.plots||0)+1;
 // Yard surface: lawn or paved, only when the whole rectangle is clear; footprint drawn on top by the building itself.
 if(r.corners.every(p=>inGeometry(p,r.land.geometry)&&!nearRoad(p[0],p[1],.2)&&!blocked(p[0],p[1],0))){const ch=hash(r.cluster),lawn=ch%5<3;surface(r.geometry,lawn?['#93a85a','#8aa152','#9fb062'][ch%3]:'#d3c7ab',.03+(ch%9)*.003);counts.yards=(counts.yards||0)+1;
  if(lawn&&rand()>.5){const pu=r.u0+1.3+rand()*(r.u1-r.u0-2.6),pv=r.v0+.9;const pp=toW(pu,pv);if(!inGeometry(pp,r.f.geometry))surface({type:'Polygon',coordinates:[[toW(pu-1.1,r.v0+.4),toW(pu+1.1,r.v0+.4),toW(pu+1.1,r.v0+1.6),toW(pu-1.1,r.v0+1.6),toW(pu-1.1,r.v0+.4)]]},'#c9b98f',.065);}}
 // Yard tree candidates at the free rectangle corners (placed with the other trees for consistent spacing).
 for(const [u,v] of [[r.u0+1.6,r.v0+1.6],[r.u1-1.6,r.v0+1.6],[r.u1-1.6,r.v1-1.6],[r.u0+1.6,r.v1-1.6]])if(rand()>.45)plotTrees.push({p:toW(u,v),r:1.9+rand()*1.1,seed:hash(r.f.id)+Math.round(u*7+v*13)});
}

// Monsoon standing water: small puddles where world noise peaks on open ground (authored weather effect).
if(detail&&LOOK.puddles)for(let x=Math.ceil(view.minX/11)*11;x<view.maxX;x+=11)for(let y=Math.ceil(view.minY/11)*11;y<view.maxY;y+=11){const n=noise(x,y,1/23,11);if(n<.8)continue;const jx=x+(lattice(x,y,12)-.5)*8,jy=y+(lattice(x,y,13)-.5)*8;if(nearRoad(jx,jy,1)||blocked(jx,jy,1.2)||data.greens.some(gf=>inGeometry([jx,jy],gf.geometry)))continue;
 const g=new T.CircleGeometry(1.2+(n-.8)*14,14);g.scale(1,.6+lattice(x,y,14)*.4,1);g.rotateZ(lattice(x,y,15)*Math.PI);g.translate(jx,jy,.025);batch(g,'#6f8791',false);counts.puddles=(counts.puddles||0)+1;}
// Trees: a few merged vertex-coloured variants, placed with InstancedMesh.
function colored(g,hex){g=g.index?g.toNonIndexed():g;g.deleteAttribute('uv');const c=new T.Color(hex),arr=new Float32Array(g.attributes.position.count*3);for(let i=0;i<arr.length;i+=3)arr.set([c.r,c.g,c.b],i);g.setAttribute('color',new T.BufferAttribute(arr,3));return g;}
function treeVariant(seed,kind){const rand=random(seed),parts=[],r=1,base=kind==='palm'?0:.55;
 if(kind==='palm'){parts.push(colored(Object.assign(new T.CylinderGeometry(.06,.09,2.6,6).rotateX(Math.PI/2).translate(0,0,1.3)),'#8a7550'));for(let i=0;i<7;i++){const g=new T.ConeGeometry(.16,1.2,4);g.rotateZ(Math.PI/2);g.translate(.55,0,0);g.rotateY(-.45);g.rotateZ(i*Math.PI*2/7+rand());g.translate(0,0,2.55);parts.push(colored(g,['#4f8a33','#3d7a2c','#6a9a39'][i%3]));}return mergeGeometries(parts,false);}
 parts.push(colored(new T.CylinderGeometry(.05,.08,base+.6,6).rotateX(Math.PI/2).translate(0,0,(base+.6)/2),'#7a6243'));
 const greens=kind==='autumn'?LOOK.autumn:kind==='dark'?LOOK.dark:LOOK.greens;
 const core=new T.IcosahedronGeometry(.82,1);core.scale(1,1,.72);core.translate(0,0,base+.75);parts.push(colored(core,kind==='autumn'?'#7d6430':kind==='dark'?LOOK.core[1]:LOOK.core[0]));
 const lobes=14;for(let j=0;j<lobes;j++){const ang=j*2.39996,rad=Math.sqrt((j+.5)/lobes)*.72,lx=Math.cos(ang)*rad,ly=Math.sin(ang)*rad,lzz=base+.85+(1-rad)*.55+(rand()-.5)*.3,rr=.32+rand()*.2;
  const g=new T.IcosahedronGeometry(rr,1);g.scale(1,1,.85);g.translate(lx,ly,lzz);parts.push(colored(g,greens[Math.floor(rand()*greens.length)]));
  for(let k=0;k<3;k++){const s=new T.IcosahedronGeometry(rr*(.22+rand()*.16),0);s.scale(1.2,1,.7);s.translate(lx+(rand()-.5)*rr*1.5,ly+(rand()-.5)*rr*1.5,lzz+rr*.62);parts.push(colored(s,(kind==='autumn'?['#e0bb63','#d6a94e','#ecc874']:LOOK.tips)[Math.floor(rand()*3)]));}}
 return mergeGeometries(parts,false);}
const variants=[...Array.from({length:6},(_,i)=>({kind:'round',g:treeVariant(9001+i,LOOK.autumn&&i===5?'autumn':'round')})),...Array.from({length:3},(_,i)=>({kind:'dark',g:treeVariant(9101+i,'dark')})),{kind:'palm',g:treeVariant(9201,'palm')}];
const instances=variants.map(()=>[]);
function tree(x,y,r,seed,kind='any'){if(!inView(x,y))return;const rand=random(seed),choices=variants.map((v,i)=>i).filter(i=>kind==='any'?variants[i].kind!=='palm':variants[i].kind===kind),vi=choices[Math.floor(rand()*choices.length)];
 const m=new T.Matrix4().compose(new T.Vector3(x,y,0),new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),rand()*Math.PI*2),new T.Vector3(r,r,r*(.9+rand()*.25)));instances[vi].push(m);counts.trees++;}
const placed=grid(12);function spaced(x,y,d){for(const p of placed.near(x,y))if(Math.hypot(x-p[0],y-p[1])<d)return false;return true;}
function place(x,y){placed.add([x-12,y-12,x+12,y+12],[x,y]);}
// Two-phase planting so overlapping render regions agree:
// 1) every source feature emits candidates from its own RNG (consumed unconditionally, independent of the view);
// 2) candidates are accepted greedily in a global priority order (rank, then hash), against spacing and obstacles.
// Density follows the Gujarat Forest Department estimate of ~54 % tree cover / ~152 trees per ha in the capital area;
// positions outside mapped parks are authored (OSM maps 8 tree nodes here).
const cands=[];const cand=(x,y,r,seed,kind,rank,spacing,clearance,check)=>{if(inView(x,y))cands.push({x,y,r,seed,kind,rank,spacing,clearance,check,prio:hash(seed+'p'+rank)});};
for(const f of data.sourceFeatures)if(f.kind==='tree'&&f.geometry.type==='Point'){const [x,y]=f.geometry.coordinates;if(inView(x,y)){tree(x,y,3.4,hash(f.id));place(x,y);counts.mappedTrees++;}}
if(detail){
 for(const f of data.greens){const rand=random(hash(f.id));for(const poly of polygons(f.geometry)){const [x0,y0,x1,y1]=bbox({type:'Polygon',coordinates:poly});
  const attempts=Math.min(40000,Math.ceil((x1-x0)*(y1-y0)/3));for(let i=0;i<attempts;i++){const x=x0+rand()*(x1-x0),y=y0+rand()*(y1-y0),r=3+rand()*2,dark=rand()>.75;
   cand(x,y,r,hash(f.id)+i,dark?'dark':'any',1,6.2,1.5,()=>inside([x,y],poly[0])&&!poly.slice(1).some(hh=>inside([x,y],hh))&&!nearRoad(x,y,1));}}}
 for(const r of data.roads){if(r.footway||r.width<5.5)continue;const rand=random(hash(r.id)+7),lines=r.geometry.type==='LineString'?[r.geometry.coordinates]:r.geometry.coordinates,gap=r.width>=10?8.5:10,palm=r.width>=13&&hash(r.id)%3===0;
  for(const pts of lines){let carry=gap*rand();for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len<.01)continue;const dx=(b[0]-a[0])/len,dy=(b[1]-a[1])/len;
   for(let k=carry;k<len;k+=gap){for(const side of [-1,1]){const off=r.width/2+3.2+rand()*.8,skip=rand()<.15,rr=palm?2.2:3+rand()*1.6,x=a[0]+dx*k-dy*off*side,y=a[1]+dy*k+dx*off*side;if(skip)continue;
    cand(x,y,rr,hash(r.id)+i*977+Math.round(k*13)+side,palm?'palm':'any',2,5.8,2.2,()=>!nearRoad(x,y,.6));}}
   carry=(carry-len)%gap;if(carry<0)carry+=gap;}}}
 for(const t of plotTrees){const [x,y]=t.p;cand(x,y,t.r,t.seed,'any',3,4.2,.9+t.r*.2,()=>!nearRoad(x,y,.8));}
 for(const f of data.sourceFeatures){if(f.kind!=='landuse'||!['residential','greenfield','grass','meadow','forest'].includes(f.tags.landuse))continue;const rand=random(hash(f.id)+3),density={greenfield:1/200,grass:1/260,meadow:1/260,forest:1/45}[f.tags.landuse]||1/70;
  for(const poly of polygons(f.geometry)){const [x0,y0,x1,y1]=bbox({type:'Polygon',coordinates:poly});const n=Math.min(60000,Math.ceil((x1-x0)*(y1-y0)*density));
   for(let i=0;i<n;i++){const x=x0+rand()*(x1-x0),y=y0+rand()*(y1-y0),r=2.6+rand()*1.8,dark=rand()>.85;cand(x,y,r,hash(f.id)+i*31,dark?'dark':'any',4,4.8,1+r*.25,()=>inside([x,y],poly[0])&&!poly.slice(1).some(hh=>inside([x,y],hh))&&!nearRoad(x,y,1.5));}}}
 // Woodland mask on unmapped open ground: world-anchored noise picks ~40 % of open land; a jittered 7 m lattice seeds it.
 const W=7;for(let gx=Math.floor(view.minX/W)*W;gx<view.maxX;gx+=W)for(let gy=Math.floor(view.minY/W)*W;gy<view.maxY;gy+=W){const m=noise(gx,gy,1/110,21)*.75+noise(gx,gy,1/27,22)*.25;if(m<.56)continue;
  const i=Math.round(gx/W),j=Math.round(gy/W),x=gx+(lattice(i,j,23)-.5)*W*.9,y=gy+(lattice(i,j,24)-.5)*W*.9,r=2.4+lattice(i,j,25)*2;
  cand(x,y,r,i*73856093^j*19349663,lattice(i,j,26)>.8?'dark':'any',5,5.2,1.4+r*.2,()=>!nearRoad(x,y,2)&&!data.greens.some(gf=>inGeometry([x,y],gf.geometry))&&!residentialLand.some(l=>inGeometry([x,y],l.geometry)));}
 cands.sort((a,b)=>a.rank-b.rank||a.prio-b.prio||a.x-b.x||a.y-b.y);
 const rankName=['mapped','parkTrees','streetTrees','plotTrees','yardTrees','woodlandTrees'];
 for(const c of cands){if(!spaced(c.x,c.y,c.spacing)||blocked(c.x,c.y,c.clearance)||!c.check())continue;place(c.x,c.y);tree(c.x,c.y,c.r,c.seed,c.kind);counts[rankName[c.rank]]=(counts[rankName[c.rank]]||0)+1;}
 counts.treeCandidates=cands.length;
}
stage('trees');
variants.forEach((v,i)=>{if(!instances[i].length)return;const mesh=new T.InstancedMesh(v.g,new T.MeshLambertMaterial({vertexColors:true,flatShading:true}),instances[i].length);instances[i].forEach((m,k)=>mesh.setMatrixAt(k,m));mesh.castShadow=true;mesh.receiveShadow=true;mesh.frustumCulled=false;scene.add(mesh);});

for(const {color,parts,cast}of batches.values()){for(let i=0;i<parts.length;i+=4000){const geom=mergeGeometries(parts.slice(i,i+4000),false),mesh=new T.Mesh(geom,material(color));mesh.castShadow=cast;mesh.receiveShadow=true;scene.add(mesh);}for(const g of parts)g.dispose();}
batches.clear();
if(glowParts.length){const gm=new T.Mesh(mergeGeometries(glowParts,false),new T.MeshBasicMaterial({vertexColors:true,transparent:true,blending:T.AdditiveBlending,depthWrite:false}));gm.renderOrder=2;scene.add(gm);counts.lightPools=glowParts.length;}stage('merged');
const ext=renderer.getContext().getExtension('WEBGL_debug_renderer_info');
// Ambient occlusion (detail layers): ground-truth AO in screen space, radius in metres. Its denoise noise is
// built with Math.random, so it is seeded here: every region page must produce identical pixels.
const ao=detail&&cfg.ambientOcclusion!==false;
let composer;if(treatment||ao){composer=new EffectComposer(renderer);
 if(treatment)composer.addPass(new RenderPixelatedPass(1,scene,camera,{normalEdgeStrength:cfg.treatmentB?.normalEdgeStrength??.16,depthEdgeStrength:cfg.treatmentB?.depthEdgeStrength??.2}));else composer.addPass(new RenderPass(scene,camera));
 if(ao){const seeded=random(7331),realRandom=Math.random;Math.random=seeded;const pass=new GTAOPass(scene,camera,512,512);Math.random=realRandom;
  pass.updateGtaoMaterial({radius:12,distanceExponent:1.6,thickness:8,scale:1.6,samples:16,distanceFallOff:1,screenSpaceRadius:false});
  pass.updatePdMaterial({lumaPhi:10,depthPhi:2,normalPhi:3,radius:6,radiusExponent:1,rings:2,samples:16});
  pass.blendIntensity=night?.55:.9;if(q.get("aoDebug"))pass.output=GTAOPass.OUTPUT.AO;composer.addPass(pass);}
 composer.addPass(new OutputPass());}
window.sceneReady={mode,counts,transform,view,shadow:{halfExtent:shadowHalf,mapSize:shadowSize,texelMetres:texel,type:'PCFSoftShadowMap',lattice:'snapped to global light-space texel grid per chunk'},sourceHash:data.sourceHash,renderer:ext?renderer.getContext().getParameter(ext.UNMASKED_RENDERER_WEBGL):'WebGL',three:T.REVISION,model:null};
// Render image-space rectangle [x,y,w,h] of the global lattice with padding; shadow camera follows the chunk on a fixed texel grid.
window.renderChunk=async(x=0,y=0,w=cfg.width,h=cfg.height,padding=0)=>{
 const W=w+padding*2,H=h+padding*2,[gx,gy]=imageToGround(x+w/2,y+h/2+h*.05),p=new T.Vector3(gx,gy,0);
 const su=Math.round(p.dot(lx)/texel)*texel,sv=Math.round(p.dot(ly)/texel)*texel,target=lx.clone().multiplyScalar(su).add(ly.clone().multiplyScalar(sv));
 sun.target.position.copy(target);sun.position.copy(target).addScaledVector(L,1500);sun.target.updateMatrixWorld();sun.updateMatrixWorld();
 renderer.setSize(W,H);camera.setViewOffset(cfg.width,cfg.height,x-padding,y-padding,W,H);camera.updateProjectionMatrix();
 if(composer){composer.setSize(W,H);composer.render();}else renderer.render(scene,camera);
 window.sceneReady.drawCalls=renderer.info.render.calls;window.sceneReady.triangles=renderer.info.render.triangles;
 const blob=await new Promise(r=>renderer.domElement.toBlob(r,'image/png'));const buf=new Uint8Array(await blob.arrayBuffer());let s='';for(let i=0;i<buf.length;i+=32768)s+=String.fromCharCode(...buf.subarray(i,i+32768));return btoa(s);};
