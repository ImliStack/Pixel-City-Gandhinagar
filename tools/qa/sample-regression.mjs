// Re-render the historical 2048px sample (revision 3) into a scratch path and compare it with the stored candidate.
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {serve} from '../local-server.mjs';
const out=process.argv[2]||'outputs/qa/sample-regression';fs.mkdirSync(out,{recursive:true});
const {server,url}=await serve(process.cwd());let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-background-networking','--no-first-run']});
 const page=await browser.newPage();const external=[];await page.route('**/*',r=>{if(r.request().url().startsWith(url))return r.continue();external.push(r.request().url());return r.abort();});
 page.on('pageerror',e=>console.error(e.message));
 await page.goto(`${url}/tools/sample/index.html?mode=detail&revision=3`);await page.waitForFunction(()=>window.sampleReady,undefined,{timeout:180000});
 const enc=await page.evaluate(()=>window.renderSample());const file=path.join(out,'artwork-candidate-v3-rerender.png');
 await sharp(Buffer.from(enc.split(',')[1],'base64')).png().toFile(file);
 const a=await sharp('outputs/visual-milestone/artwork-candidate-v3.png').removeAlpha().raw().toBuffer(),b=await sharp(file).removeAlpha().raw().toBuffer();
 let total=0,max=0,changed=0;const diff=Buffer.alloc(a.length);for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);total+=d;if(d>max)max=d;if(d>8)changed++;diff[i]=Math.min(255,d*10);}
 await sharp(diff,{raw:{width:2048,height:2048,channels:3}}).png().toFile(path.join(out,'difference-x10.png'));
 const result={comparedWith:'outputs/visual-milestone/artwork-candidate-v3.png',meanAbsoluteChannelDifference:total/a.length,maxChannelDifference:max,channelsDifferingBy8OrMore:changed/a.length,externalRequests:external,counts:(await page.evaluate(()=>window.sampleReady)).counts};
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser?.close();server.close();}
