// Active-city pipeline router. config/active.json selects the city; each step reads its city config.
// Usage: node tools/city.mjs <doctor|fetch|audit|scene|render|stylize|export|diagnostics> [extra args]
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const [step,...extra]=process.argv.slice(2);
const active=JSON.parse(fs.readFileSync('config/active.json')),cfg=JSON.parse(fs.readFileSync(active.cityConfig));
const py=fs.existsSync('.venv/bin/python')?'.venv/bin/python':'python3',node=process.execPath;
const run=(cmd,args)=>{console.log('$',cmd,args.join(' '));const r=spawnSync(cmd,args,{stdio:'inherit'});if(r.status!==0)process.exit(r.status??1);};
const steps={
 doctor:()=>run('python3',['tools/doctor.py',...extra]),
 // Uses the cached bounded extract unless --refresh is passed explicitly.
 fetch:()=>run(py,[cfg.regionChunks?'tools/data/fetch_tiled.py':'tools/data/fetch.py','--config',active.dataConfig,'--output',cfg.raw,...extra]),
 audit:()=>{run(py,['tools/data/prepare.py','--config',active.dataConfig,'--input',cfg.raw,'--output',cfg.processed,...extra]);const a=JSON.parse(fs.readFileSync(`${cfg.processed}/audit.json`));console.log(JSON.stringify(a.counts||a,null,1).slice(0,1200));},
 // City layouts (regionChunks) get one scene per region; pilots get one scene for the whole window.
 scene:()=>cfg.regionChunks?run(py,['tools/city/regions.py','--config',active.cityConfig,...extra]):run(py,['tools/sample/prepare.py','--config',active.cityConfig,...extra]),
 render:()=>{const modes=extra.includes('--mode')?[extra[extra.indexOf('--mode')+1]]:['A','B','source','night','monsoon','winter'];const rest=extra.filter((v,i)=>v!=='--mode'&&extra[i-1]!=='--mode');for(const m of modes)run(node,[cfg.regionChunks?'tools/city/render.mjs':'tools/capital/render.mjs','--config',active.cityConfig,'--mode',m,...rest]);},
 stylize:()=>run('python3',['tools/stylize/stylize.py','--input',`${cfg.output}/render-A/map.png`,'--report',`${cfg.output}/art-preflight.json`,...(extra.length?extra:['--check'])]),
 export:()=>run(node,['tools/capital/export.mjs',...extra]),
 diagnostics:()=>run(node,['tools/qa/diagnostics.mjs',...extra]),
};
if(!steps[step]){console.error(`Unknown step "${step}". Steps: ${Object.keys(steps).join(', ')}`);process.exit(2);}
console.log(`[${cfg.city} · ${cfg.mapId}] ${step}`);steps[step]();
