import fs from 'node:fs';
import crypto from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {serve} from '../local-server.mjs';
const out='outputs/visual-milestone';fs.mkdirSync(out,{recursive:true});
execFileSync('.venv/bin/python',['tools/sample/prepare.py'],{stdio:'inherit'});
const data=JSON.parse(fs.readFileSync(`${out}/scene.json`)),cfg=data.config;
const hash=crypto.createHash('sha256').update(fs.readFileSync(`${out}/scene.json`)).update(fs.readFileSync('tools/sample/scene.mjs')).update(fs.readFileSync('package-lock.json')).digest('hex');
const report={inputHash:hash,createdAt:new Date().toISOString(),hardware:'Apple M3, 8 GiB unified memory, Metal via Chrome/ANGLE',model:null,checkpoint:null,mode:'original detailed geometry, no image-edit model',milestonePassed:false,settings:cfg,runs:[],memoryNote:'Peak sum of Node and Chrome descendant RSS sampled every 500ms; shared pages may be double counted. Dedicated VRAM unavailable on unified memory.'};
let peak=0;const start=performance.now();
const sample=setInterval(()=>{try{const rows=execFileSync('ps',['-axo','pid=,ppid=,rss='],{encoding:'utf8'}).trim().split('\n').map(s=>s.trim().split(/\s+/).map(Number)),ids=new Set([process.pid]);let changed=true;while(changed){changed=false;for(const [pid,ppid]of rows)if(ids.has(ppid)&&!ids.has(pid)){ids.add(pid);changed=true;}}peak=Math.max(peak,rows.filter(r=>ids.has(r[0])).reduce((s,r)=>s+r[2]*1024,0));}catch{}},500);
const {server,url}=await serve(process.cwd());let browser;
try{
browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-background-networking','--disable-component-update','--no-first-run']});report.chromeVersion=browser.version();
const specs=process.argv.includes('--revision3')?[{mode:'baseline',rev:1,name:'baseline'},{mode:'detail',rev:3,name:'artwork-candidate-v3'}]:[{mode:'baseline',rev:1,name:'baseline'},{mode:'detail',rev:1,name:'artwork-candidate-v1'},{mode:'detail',rev:2,name:'artwork-candidate-v2'}];
for(const spec of specs){
 const page=await browser.newPage();const external=[];await page.route('**/*',route=>{if(route.request().url().startsWith(url))return route.continue();external.push(route.request().url());return route.abort();});page.on('pageerror',e=>console.error(e));const tick=performance.now();
 await page.goto(`${url}/tools/sample/index.html?mode=${spec.mode}&revision=${spec.rev}`);await page.waitForFunction(()=>window.sampleReady,undefined,{timeout:120000});
 const encoded=await page.evaluate(()=>window.renderSample());await sharp(Buffer.from(encoded.split(',')[1],'base64')).png().toFile(`${out}/${spec.name}.png`);
 const info=await page.evaluate(()=>window.sampleReady);report.runs.push({...info,file:`${spec.name}.png`,seconds:(performance.now()-tick)/1000,bytes:fs.statSync(`${out}/${spec.name}.png`).size,externalRequests:external});
 console.log(spec.name,JSON.stringify(info.counts),report.runs.at(-1).seconds.toFixed(2)+'s');
 if(spec.rev>=2){
  fs.writeFileSync(`${out}/transform.json`,JSON.stringify(info.transform,null,2));
  const composites=[];for(let y=0;y<2048;y+=1024)for(let x=0;x<2048;x+=1024){const pad=cfg.renderPadding;const encoded=await page.evaluate(args=>window.renderSample(...args),[x,y,1024,1024,pad]);const buffer=await sharp(Buffer.from(encoded.split(',')[1],'base64')).extract({left:pad,top:pad,width:1024,height:1024}).png().toBuffer();fs.writeFileSync(`${out}/region-${x}-${y}.png`,buffer);composites.push({input:buffer,left:x,top:y});}
  await sharp({create:{width:2048,height:2048,channels:3,background:'#ddd'}}).composite(composites).png().toFile(`${out}/adjacent-regions.png`);
  const a=await sharp(`${out}/${spec.name}.png`).removeAlpha().raw().toBuffer(),b=await sharp(`${out}/adjacent-regions.png`).removeAlpha().raw().toBuffer();let total=0,max=0,changed=0,seamTotal=0,seamN=0;
  for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);total+=d;max=Math.max(max,d);if(d>0)changed++;const pix=Math.floor(i/3),x=pix%2048,y=Math.floor(pix/2048);if(Math.abs(x-1024)<8||Math.abs(y-1024)<8){seamTotal+=d;seamN++;}}
  report.continuity={singleRenderComparedWith:'four adjacent 1024px regions, same global camera/noise-free meshes, 160px padding',meanAbsoluteChannelDifference:total/a.length,maxChannelDifference:max,changedChannelFraction:changed/a.length,seamBandMeanAbsoluteDifference:seamTotal/seamN,generationRegions:'No image-model regions exist; generative continuity not tested.'};
  await sharp(`${out}/adjacent-regions.png`).composite([{input:Buffer.from('<svg width="2048" height="2048"><path d="M1024 0V2048M0 1024H2048" stroke="#f4506c" stroke-width="3" stroke-dasharray="12 8"/></svg>')}]).png().toFile(`${out}/adjacent-regions-guides.png`);
 }
 await page.close();
}
report.seconds=(performance.now()-start)/1000;report.peakProcessTreeRssBytes=peak;report.sourceHash=data.sourceHash;report.centerLonLat=data.centerLonLat;report.assumptions=data.assumptions;
fs.writeFileSync(`${out}/render-report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report.continuity));
}finally{clearInterval(sample);await browser?.close();server.close();}
