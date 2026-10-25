// Record the README night clip: summer day cross-fades to night, then traffic, metro, windows and
// lamps animate. Own Vite server, zero external requests. Output: docs/night.gif (+ docs/screenshots/night-motion.jpg).
import fs from 'node:fs';
import {spawn, execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
const mapId = process.argv[2] || 'gandhinagar-city', meta = JSON.parse(fs.readFileSync(`outputs/maps/${mapId}/metadata.json`));
const port = 5196, base = `http://127.0.0.1:${port}`, dir = 'outputs/qa/night-gif';
fs.rmSync(dir, {recursive: true, force: true}); fs.mkdirSync(dir, {recursive: true});
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'apps/viewer/vite.config.ts', '--host', '127.0.0.1', '--port', String(port)], {stdio: ['ignore', 'pipe', 'inherit']});
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('vite did not start')), 30000); vite.stdout.on('data', d => { if (String(d).includes('Local')) { clearTimeout(t); res(); } }); });
const p = meta.pois.find(x => x.id === 'akshardham');
const browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try {
  const ctx = await browser.newContext({viewport: {width: 960, height: 600}, recordVideo: {dir, size: {width: 960, height: 600}}});
  await ctx.route('**/*', r => { const u = r.request().url(); return u.startsWith(base) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
  const page = await ctx.newPage();
  await page.goto(`${base}/?map=${mapId}#v=2&m=${mapId}&l=A&cx=${p.image[0]}&cy=${p.image[1]}&z=0.16`);
  await page.waitForSelector('.minimap-view'); await page.waitForTimeout(3500);
  await page.addStyleTag({content: '.presence,.search,.places,.controls,.minimap,.attribution,.brand-chip{display:none!important}'});
  await page.waitForTimeout(1200);
  await page.evaluate(() => { document.querySelector('[aria-label="Map layers"]').click(); });
  await page.waitForTimeout(150);
  await page.evaluate(() => { [...document.querySelectorAll('.layer-menu button')].find(b => b.textContent === 'Night').click(); });
  await page.waitForTimeout(7000);
  await page.screenshot({path: 'docs/screenshots/night-motion.jpg', type: 'jpeg', quality: 86});
  await ctx.close();
  const webm = fs.readdirSync(dir).find(f => f.endsWith('.webm'));
  // Skip the loading seconds; keep fade + night motion.
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '4.2', '-i', `${dir}/${webm}`, '-t', '6.5', '-vf', 'fps=10,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle', 'docs/night.gif']);
  console.log('docs/night.gif', (fs.statSync('docs/night.gif').size / 1e6).toFixed(2), 'MB');
} finally { await browser.close(); vite.kill(); }
