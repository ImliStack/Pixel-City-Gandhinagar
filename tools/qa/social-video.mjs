// Record a ~45 s 16:9 social video (X/Twitter) of the real viewer with burned-in captions (feeds autoplay muted).
// The tour plays twice in one page so the second, kept pass has warm tiles. Output: docs/social/pixel-city-x.mp4
import fs from 'node:fs';
import {spawn, execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
const mapId = 'gandhinagar-city', out = 'outputs/social', size = {width: 1280, height: 720};
fs.rmSync(out, {recursive: true, force: true}); fs.mkdirSync(out, {recursive: true}); fs.mkdirSync('docs/social', {recursive: true});
const port = 5195, base = `http://127.0.0.1:${port}`;
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'apps/viewer/vite.config.ts', '--host', '127.0.0.1', '--port', String(port)], {stdio: ['ignore', 'pipe', 'inherit']});
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('vite did not start')), 30000); vite.stdout.on('data', d => { if (String(d).includes('Local')) { clearTimeout(t); res(); } }); });
const meta = JSON.parse(fs.readFileSync(`outputs/maps/${mapId}/metadata.json`)), poi = id => meta.pois.find(p => p.id === id).image;
const browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: [`--window-size=${size.width},${size.height}`]}); // window = video size, else frames get a grey band
const context = await browser.newContext({viewport: size, screen: size, deviceScaleFactor: 1, recordVideo: {dir: out, size}});
await context.route('**/*', r => { const u = r.request().url(); return u.startsWith(base) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
const page = await context.newPage(), t0 = Date.now();
const wait = ms => page.waitForTimeout(ms);
const caption = (text, sub = '') => page.evaluate(([text, sub]) => {
  let el = document.getElementById('social-caption');
  if (!el) { el = document.createElement('div'); el.id = 'social-caption'; document.body.append(el); const b = document.createElement('div'); b.id = 'social-brand'; b.innerHTML = '<span>Imli</span>Stack · imlistack.com'; document.body.append(b);
    const s = document.createElement('style'); s.textContent = '#social-caption{position:fixed;z-index:99;left:50%;bottom:54px;transform:translateX(-50%);padding:12px 22px;border-radius:14px;background:rgba(18,20,19,.82);color:#fff;font:650 26px/1.25 "DM Sans Variable",system-ui;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.35);transition:opacity .35s;max-width:1000px}#social-caption small{display:block;font-weight:500;font-size:17px;color:#d6d8cf;margin-top:3px}#social-caption.hide{opacity:0}#social-brand{position:fixed;z-index:99;right:18px;top:16px;padding:7px 12px;border-radius:10px;background:rgba(18,20,19,.82);color:#fff;font:650 15px/1 "DM Sans Variable",system-ui;letter-spacing:.2px}#social-brand span{color:#9fd36b}'; document.head.append(s); }
  el.classList.toggle('hide', !text); if (text) el.innerHTML = text + (sub ? `<small>${sub}</small>` : '');
}, [text, sub]);
const go = (xy, z, layer = 'A') => page.evaluate(([x, y, z, l]) => { location.hash = `#v=2&m=gandhinagar-city&l=${l}&cx=${x}&cy=${y}&z=${z}`; }, [xy[0], xy[1], z, layer]);
const wheel = async (n, dy = -100, gap = 120) => { await page.mouse.move(640, 360); for (let i = 0; i < n; i++) { await page.mouse.wheel(0, dy); await wait(gap); } };
const layerTo = async name => { await page.click('[aria-label="Map layers"]'); await wait(250); await page.click(`.layer-menu button:has-text("${name}")`); await wait(150); if (await page.locator('.layer-menu').count()) await page.click('[aria-label="Map layers"]'); };

async function tour() {
  await page.keyboard.press('Escape'); await caption('');
  await go([meta.width / 2, meta.height / 2], 0.01); await wait(2500);
  await caption('Gandhinagar, India — as a pixel city', 'Every building and road from OpenStreetMap · 61 km²'); await wait(3200);
  await wheel(10, -100, 170); await wait(1400);
  await caption('25,969 real buildings, drawn where they stand'); await wait(1500);
  await page.click('.search input'); await page.keyboard.type('akshardham', {delay: 70}); await wait(500); await page.keyboard.press('Enter'); await wait(3600);
  await page.keyboard.press('Escape');
  await caption('Night falls…', 'Traffic on real roads · metro on Line 2 · lit windows');
  await go(poi('akshardham'), 0.16); await wait(1500);
  await layerTo('Night'); await wait(5200);
  await go(poi('vidhan-sabha'), 0.3, 'night'); await wait(3200);
  await caption('Monsoon, winter, summer — same city, different light'); await layerTo('Monsoon'); await go([meta.width / 2, meta.height / 2], 0.03, 'monsoon'); await wait(2600);
  await layerTo('Summer day'); await wait(900);
  await caption('Find every temple, hospital, metro stop…'); await page.click('.places-toggle'); await wait(300);
  await page.click('.places-grid button:has-text("Temples")'); await page.keyboard.press('Escape'); await wait(1500);
  await page.locator('.place-list li button', {hasText: 'Ambe Mata Mandir'}).first().click(); await wait(4200);
  await page.click('.places-clear'); await page.keyboard.press('Escape');
  await caption('Daily game: find the landmark', 'Same 3 places for everyone · see other players live'); await page.keyboard.press('d'); await wait(2400);
  await page.click('[data-testid="guess"]'); await wait(3200);
  await page.keyboard.press('Escape');
  await caption('Explore it yourself 👇', 'pixel-city-gandhinagar.imlistack.workers.dev'); await go([meta.width / 2, meta.height / 2], 0.012); await wait(3000);
  await caption('Built by ImliStack', 'imlistack.com · open source on GitHub'); await wait(2600);
}
try {
  await page.goto(`${base}/?map=${mapId}`); await page.waitForSelector('.minimap-view'); await wait(2500);
  await tour(); // warm-up pass: loads every tile the tour needs
  // Fresh game for the kept pass: forget today's local progress for this tab.
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('pc-daily-')) localStorage.removeItem(k); });
  await page.reload(); await page.waitForSelector('.minimap-view'); await wait(2500);
  var keepFrom = (Date.now() - t0) / 1000;
  await tour();
} finally {
  const video = page.video(); await context.close(); await browser.close(); vite.kill();
  const webm = await video.path();
  // H.264 High, yuv420p, 30 fps, faststart: X's recommended upload format.
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(keepFrom + 0.3), '-i', webm, '-r', '30', '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'slow', '-movflags', '+faststart', '-an', 'docs/social/pixel-city-x.mp4']);
  const d = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', 'docs/social/pixel-city-x.mp4'], {encoding: 'utf8'}).trim();
  console.log(JSON.stringify({file: 'docs/social/pixel-city-x.mp4', seconds: Number(d), mb: +(fs.statSync('docs/social/pixel-city-x.mp4').size / 1e6).toFixed(1)}));
}
