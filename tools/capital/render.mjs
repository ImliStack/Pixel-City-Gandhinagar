// Resumable padded-chunk renderer for the active city.
// Usage: node tools/capital/render.mjs [--config path] [--mode source|A|B] [--fresh] [--stop-after N] [--only x-y,...] [--no-stitch]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {serve} from '../local-server.mjs';
const args=process.argv.slice(2),opt=(k,d)=>{const i=args.indexOf(k);return i>=0?args[i+1]:d;};
const active=JSON.parse(fs.readFileSync('config/active.json')),cfg=JSON.parse(fs.readFileSync(opt('--config',active.cityConfig)));
const mode=opt('--mode','A'),sceneFile=path.join(cfg.output,'scene.json'),dir=path.join(cfg.output,`render-${mode}`);fs.mkdirSync(dir,{recursive:true});
if(!fs.existsSync(sceneFile))throw new Error(`Missing ${sceneFile}; run npm run build-scene first`);
if(cfg.width*cfg.height>cfg.maxOutputPixels)throw new Error('Configured render exceeds maxOutputPixels');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const hashes={config:sha(JSON.stringify(cfg)),scene:sha(fs.readFileSync(sceneFile)),code:sha(Buffer.concat(['tools/capital/scene.mjs','tools/capital/render.mjs','package-lock.json'].map(f=>fs.readFileSync(f)))),mode};
const inputs=sha(JSON.stringify(hashes)),stateFile=path.join(dir,'job.json');
let state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile)):null;
if(state&&state.inputs!==inputs&&!args.includes('--fresh'))throw new Error(`Render inputs changed since ${state.createdAt}. Re-run with --fresh; stale chunks are not reused.`);
if(!state||state.inputs!==inputs||args.includes('--fresh')){for(const f of fs.readdirSync(dir))if(/^\d+-\d+\.png$/.test(f))fs.unlinkSync(path.join(dir,f));state={inputs,hashes,createdAt:new Date().toISOString(),completed:{},timings:[],sessions:[]};}
const save=()=>{fs.writeFileSync(stateFile+'.tmp',JSON.stringify(state,null,2));fs.renameSync(stateFile+'.tmp',stateFile);};
const session={startedAt:new Date().toISOString(),rendered:0,resumed:0};state.sessions.push(session);save();
let peak=0;const sampler=setInterval(()=>{try{const rows=execFileSync('ps',['-axo','pid=,ppid=,rss='],{encoding:'utf8'}).trim().split('\n').map(s=>s.trim().split(/\s+/).map(Number)),ids=new Set([process.pid]);let ch=true;while(ch){ch=false;for(const [p,pp]of rows)if(ids.has(pp)&&!ids.has(p)){ids.add(p);ch=true;}}peak=Math.max(peak,rows.filter(r=>ids.has(r[0])).reduce((s,r)=>s+r[2]*1024,0));}catch{}},500);
const {server,url}=await serve(process.cwd());let browser;const start=performance.now();
const chunk=cfg.chunkSize,pad=cfg.renderPadding,only=opt('--only',null)?.split(','),stopAfter=Number(opt('--stop-after',Infinity));
async function grab(page,x,y,w,h){const b64=await page.evaluate(a=>window.renderChunk(...a),[x,y,w,h,pad]);return sharp(Buffer.from(b64,'base64')).extract({left:pad,top:pad,width:w,height:h}).removeAlpha().png({compressionLevel:6});}
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-background-networking','--disable-component-update','--no-first-run','--use-angle=metal','--enable-gpu']});
 const page=await browser.newPage({viewport:{width:800,height:600}});const external=[];
 await page.route('**/*',r=>{if(r.request().url().startsWith(url))return r.continue();external.push(r.request().url());return r.abort();});
 page.on('crash',()=>console.error('PAGE CRASHED'));let pageError;page.on('pageerror',e=>{pageError=e;console.error('PAGE',e.stack||e.message);});page.on('console',m=>{if(m.type()==='error')console.error('CONSOLE',m.text());else if(m.text().startsWith('[scene]'))console.log(m.text());});
 const t0=performance.now();await page.goto(`${url}/tools/capital/index.html?mode=${mode}&scene=/${sceneFile}`);await Promise.race([page.waitForFunction(()=>window.sceneReady,undefined,{timeout:600000}),new Promise((_,rej)=>{const t=setInterval(()=>{if(pageError){clearInterval(t);rej(pageError);}},250);page.once('load',()=>{});})]);
 session.sceneBuildSeconds=(performance.now()-t0)/1000;state.scene=await page.evaluate(()=>window.sceneReady);state.chromeVersion=browser.version();save();
 console.log('scene',session.sceneBuildSeconds.toFixed(1)+'s',JSON.stringify(state.scene.counts));
 let n=0;
 for(let y=0;y<cfg.height;y+=chunk)for(let x=0;x<cfg.width;x+=chunk){
  const key=`${x}-${y}`,file=path.join(dir,key+'.png');if(only&&!only.includes(key))continue;
  if(state.completed[key]&&fs.existsSync(file)&&sha(fs.readFileSync(file))===state.completed[key]){session.resumed++;continue;}
  if(n>=stopAfter){session.stoppedEarly=true;save();console.log('stopping early (simulated interruption) after',n);process.exitCode=3;throw new Error('STOP');}
  const tick=performance.now(),w=Math.min(chunk,cfg.width-x),h=Math.min(chunk,cfg.height-y);
  await (await grab(page,x,y,w,h)).toFile(file+'.tmp');fs.renameSync(file+'.tmp',file);
  state.completed[key]=sha(fs.readFileSync(file));state.timings.push({key,seconds:(performance.now()-tick)/1000,triangles:(await page.evaluate(()=>window.sceneReady.triangles))});session.rendered++;n++;save();console.log('chunk',key,((performance.now()-tick)/1000).toFixed(2)+'s');
 }
 const all=[];for(let y=0;y<cfg.height;y+=chunk)for(let x=0;x<cfg.width;x+=chunk)all.push(`${x}-${y}`);
 if(!only&&!args.includes('--no-stitch')&&all.every(k=>state.completed[k])){
  // Direct larger render spanning an internal chunk corner, compared with stitched chunks.
  const sx=Math.max(0,Math.min(cfg.width-2048,chunk*2-1024)),sy=Math.max(0,Math.min(cfg.height-2048,chunk*2-1024)),sw=Math.min(2048,cfg.width),sh=Math.min(2048,cfg.height);
  await (await grab(page,sx,sy,sw,sh)).toFile(path.join(dir,'seam-reference.png'));
  const composites=all.map(k=>{const [x,y]=k.split('-').map(Number);return{input:path.join(dir,k+'.png'),left:x,top:y};});
  sharp.cache(false);await sharp({create:{width:cfg.width,height:cfg.height,channels:3,background:'#d9cfae'},limitInputPixels:cfg.maxOutputPixels}).composite(composites).png({compressionLevel:6}).toBuffer().then(b=>sharp(b,{limitInputPixels:false}).removeAlpha().png({compressionLevel:6}).toFile(path.join(dir,'map.png')));
  const A=await sharp(path.join(dir,'map.png'),{limitInputPixels:false}).extract({left:sx,top:sy,width:sw,height:sh}).removeAlpha().raw().toBuffer(),B=await sharp(path.join(dir,'seam-reference.png')).removeAlpha().raw().toBuffer();if(A.length!==B.length)throw new Error('seam buffers differ in size');
  let tot=0,max=0,diffN=0,seam=0,seamN=0;const vis=Buffer.alloc(A.length);for(let i=0;i<A.length;i++){const d=Math.abs(A[i]-B[i]);tot+=d;if(d>max)max=d;if(d)diffN++;vis[i]=Math.min(255,d*10);const p=i/3|0,px=sx+p%sw,py=sy+(p/sw|0);if(Math.abs(px%chunk)<4||chunk-px%chunk<4||py%chunk<4||chunk-py%chunk<4){seam+=d;seamN++;}}
  await sharp(vis,{raw:{width:sw,height:sh,channels:3}}).png().toFile(path.join(dir,'seam-difference-x10.png'));
  state.seamComparison={region:[sx,sy,sw,sh],meanAbsoluteChannelDifference:tot/A.length,maxChannelDifference:max,changedChannelFraction:diffN/A.length,seamBandMeanAbsoluteDifference:seam/seamN,note:'Deterministic WebGL raster; no generative model. Differences come from per-chunk shadow-camera placement and post-process neighbourhoods.'};
  await sharp(path.join(dir,'map.png'),{limitInputPixels:false}).resize(1536).png().toFile(path.join(dir,'overview.png'));
  state.complete=true;state.outputBytes=fs.statSync(path.join(dir,'map.png')).size;
 }
 state.externalRequests=external;
}catch(e){if(e.message!=='STOP')throw e;}
finally{clearInterval(sampler);session.seconds=(performance.now()-start)/1000;session.peakProcessTreeRssBytes=peak;session.nodeMaxRssBytes=process.resourceUsage().maxRSS*1024;
 state.hardware='Apple M3, 8 GiB unified memory, Chrome WebGL via ANGLE/Metal';state.memoryMeasurement='Summed RSS of Node + Chrome descendants every 500 ms; shared pages may be double-counted; GPU memory is unified and not separately measurable.';
 save();await Promise.race([browser?.close(),new Promise(r=>setTimeout(r,5000))]);server.close();console.log(JSON.stringify({mode,dir,session,seam:state.seamComparison},null,1));setTimeout(()=>process.exit(),200);}
