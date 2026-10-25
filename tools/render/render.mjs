import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {execFileSync,execSync} from 'node:child_process';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {serve} from '../local-server.mjs';
import {cameraTransform,worldToImage} from './coordinates.mjs';
const root=process.cwd(),out=path.join(root,'outputs');fs.mkdirSync(out,{recursive:true});
execFileSync('.venv/bin/python',['tools/render/prepare_scene.py'],{stdio:'inherit'});
const config=JSON.parse(fs.readFileSync('config/pilot.json')),data=JSON.parse(fs.readFileSync('data/processed/pilot.json'));
const args=process.argv.slice(2),angleIndex=args.indexOf('--angle');
if(angleIndex>=0)config.camera.azimuth=Number(args[angleIndex+1]);
if(args.includes('--preview')){config.width=1536;config.height=1296;}
if(config.width*config.height>config.maxOutputPixels)throw new Error('Configured render exceeds maxOutputPixels');
const transform=cameraTransform(data.bounds.world,config);
const conf={...config,transform};fs.writeFileSync(path.join(out,'render-config.json'),JSON.stringify(conf,null,2));
const inputs=crypto.createHash('sha256').update(JSON.stringify(conf)).update(fs.readFileSync('outputs/scene.json')).update(fs.readFileSync('tools/render/scene.mjs')).digest('hex');
const directory=path.join(out,args.includes('--preview')?`preview-${config.camera.azimuth}`:'render');fs.mkdirSync(directory,{recursive:true});
const stateFile=path.join(directory,'job.json');
let state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile)):null;
if(state&&state.inputs!==inputs&&!args.includes('--fresh'))throw new Error('Render inputs changed. Use --fresh to explicitly start a new render; old chunks will not be reused.');
if(!state||state.inputs!==inputs||args.includes('--fresh'))state={inputs,createdAt:new Date().toISOString(),completed:{},timings:[],config:conf};
function save(){fs.writeFileSync(stateFile+'.tmp',JSON.stringify(state,null,2));fs.renameSync(stateFile+'.tmp',stateFile);}
save();
const {server,url}=await serve(root);let browser;const start=performance.now();let peakProcessTreeRssBytes=0;
const sampler=setInterval(()=>{try{const rows=execFileSync('ps',['-axo','pid=,ppid=,rss='],{encoding:'utf8'}).trim().split('\n').map(s=>s.trim().split(/\s+/).map(Number));const ids=new Set([process.pid]);let changed=true;while(changed){changed=false;for(const [pid,ppid] of rows)if(ids.has(ppid)&&!ids.has(pid)){ids.add(pid);changed=true;}}peakProcessTreeRssBytes=Math.max(peakProcessTreeRssBytes,rows.filter(r=>ids.has(r[0])).reduce((s,r)=>s+r[2]*1024,0));}catch{}},500);
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-background-networking','--disable-component-update','--no-first-run']});
 const page=await browser.newPage({viewport:{width:1200,height:1000}});page.on('pageerror',err=>console.error('RENDER',err.message));
 await page.goto(url+'/tools/render/index.html');await page.waitForFunction(()=>window.renderReady,{timeout:120000});
 console.log(JSON.stringify(await page.evaluate(()=>window.renderReady)));
 const chunk=config.chunkSize,pad=config.padding;
 for(let y=0;y<config.height;y+=chunk){for(let x=0;x<config.width;x+=chunk){
   const w=Math.min(chunk,config.width-x),h=Math.min(chunk,config.height-y),key=`${x}-${y}`,file=path.join(directory,key+'.png');
   if(state.completed[key]&&fs.existsSync(file)&&crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')===state.completed[key]){console.log('resume',key);continue;}
   const tick=performance.now(),encoded=await page.evaluate(async({x,y,w,h,pad})=>window.renderChunk(x,y,w,h,pad),{x,y,w,h,pad});
   await sharp(Buffer.from(encoded.split(',')[1],'base64')).extract({left:pad,top:pad,width:w,height:h}).png().toFile(file);
   state.completed[key]=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');state.timings.push({key,seconds:(performance.now()-tick)/1000});save();console.log('rendered',key,w,h);
 }}
 // Direct larger render across the first internal seam proves global camera/padding alignment.
 const qaX=Math.min(512,config.width-1536),qaY=Math.min(512,config.height-1024),qaW=Math.min(1536,config.width),qaH=Math.min(1024,config.height);
 const reference=await page.evaluate(async(a)=>window.renderChunk(...a),[qaX,qaY,qaW,qaH,pad]);
 await sharp(Buffer.from(reference.split(',')[1],'base64')).extract({left:pad,top:pad,width:qaW,height:qaH}).png().toFile(path.join(directory,'seam-reference.png'));
 state.seamReference={x:qaX,y:qaY,width:qaW,height:qaH};
 state.browser=await page.evaluate(()=>window.renderReady);state.seconds=(performance.now()-start)/1000;state.nodePeakRssBytes=process.resourceUsage().maxRSS*1024;state.peakProcessTreeRssBytes=peakProcessTreeRssBytes;state.memoryMeasurement='Summed RSS of Node and Chrome descendants sampled every 500 ms; shared pages may be double counted; separate GPU allocation unavailable on Apple unified memory.';
 const composites=[];for(let y=0;y<config.height;y+=chunk)for(let x=0;x<config.width;x+=chunk)composites.push({input:path.join(directory,`${x}-${y}.png`),left:x,top:y});
 await sharp({create:{width:config.width,height:config.height,channels:3,background:config.background}}).composite(composites).png().toFile(path.join(directory,'pilot.png'));
 const crop=await sharp(path.join(directory,'pilot.png')).extract({left:qaX,top:qaY,width:qaW,height:qaH}).removeAlpha().raw().toBuffer();
 const ref=await sharp(path.join(directory,'seam-reference.png')).removeAlpha().raw().toBuffer();
 let diff=0,max=0;for(let i=0;i<crop.length;i++){const d=Math.abs(crop[i]-ref[i]);diff+=d;max=Math.max(d,max);}state.seamComparison={meanAbsoluteChannelDifference:diff/crop.length,maxChannelDifference:max};
 state.outputBytes=fs.statSync(path.join(directory,'pilot.png')).size;state.complete=true;save();
 await sharp(path.join(directory,'pilot.png')).resize(1536).toFile(path.join(directory,'overview.png'));
 const coverage=data.bounds.world;const poly=[[coverage[0],coverage[1],0],[coverage[2],coverage[1],0],[coverage[2],coverage[3],0],[coverage[0],coverage[3],0]].map(p=>worldToImage(p,transform));
 const auditPath='data/processed/audit.json';const audit=fs.existsSync(auditPath)?JSON.parse(fs.readFileSync(auditPath)):{};
 const metadata={version:config.version,width:config.width,height:config.height,dzi:'pilot.dzi',mode:'deterministic',artAvailable:false,coverage:{polygon:poly,bbox:config.bbox},pois:data.pois.map(p=>({...p,image:worldToImage([p.x,p.y,0],transform)})),transform:{...transform,origin:data.origin},audit,sourceHash:data.sourceHash,styleVersion:config.styleVersion,terrain:config.terrain,attribution:'© OpenStreetMap contributors · ODbL 1.0',geometryNote:'Flat ground. Building heights include estimates. Landmark details are artistic reconstructions. Unmapped buildings are left absent.'};
 fs.writeFileSync(path.join(directory,'metadata.json'),JSON.stringify(metadata,null,2));
 console.log(JSON.stringify({output:path.join(directory,'pilot.png'),seconds:state.seconds,seams:state.seamComparison,bytes:state.outputBytes},null,2));
}finally{clearInterval(sampler);await browser?.close();server.close();}
