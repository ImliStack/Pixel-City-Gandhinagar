// Mobile launch video + screenshots: records the real viewer at phone size (390×844, touch), then
// composites it into a generic phone frame (drawn here, no device-maker artwork) on a 1080×1920
// vertical canvas for Reels/Shorts/X/LinkedIn. Outputs:
//   docs/social/pixel-city-mobile.mp4          vertical 1080×1920, captions, ImliStack branding
//   docs/screenshots/mobile-*.jpg              framed phone screenshots for the README
import fs from 'node:fs';
import {spawn, execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import sharp from 'sharp';
const mapId = 'gandhinagar-city', out = 'outputs/social-mobile', phone = {width: 390, height: 844}, scale = 2;
fs.rmSync(out, {recursive: true, force: true}); fs.mkdirSync(out, {recursive: true});
const port = 5194, base = `http://127.0.0.1:${port}`;
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'apps/viewer/vite.config.ts', '--host', '127.0.0.1', '--port', String(port)], {stdio: ['ignore', 'pipe', 'inherit']});
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('vite did not start')), 30000); vite.stdout.on('data', d => { if (String(d).includes('Local')) { clearTimeout(t); res(); } }); });
const meta = JSON.parse(fs.readFileSync(`outputs/maps/${mapId}/metadata.json`)), poi = id => meta.pois.find(p => p.id === id).image;

// ---- Phone frame (1080×1920 canvas): background, then video in the screen hole, then bezel on top.
const W = 1080, H = 1920, SW = 758, SH = Math.round(SW * phone.height / phone.width), SX = (W - SW) / 2, SY = 150, R = 64, B = 24;
const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1d2a22"/><stop offset="1" stop-color="#0f1512"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <text x="${W / 2}" y="${SY + SH + B + 110}" font-family="Helvetica, Arial" font-size="40" font-weight="700" fill="#f2f1ea" text-anchor="middle">Pixel City Gandhinagar</text>
  <text x="${W / 2}" y="${SY + SH + B + 160}" font-family="Helvetica, Arial" font-size="28" fill="#a9ada4" text-anchor="middle">pixel-city-gandhinagar.imlistack.workers.dev</text>
  <text x="${W / 2}" y="${H - 40}" font-family="Helvetica, Arial" font-size="30" font-weight="700" fill="#9fd36b" text-anchor="middle">Imli<tspan fill="#f2f1ea">Stack</tspan></text></svg>`;
const bezel = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><mask id="m"><rect width="${W}" height="${H}" fill="#fff"/><rect x="${SX}" y="${SY}" width="${SW}" height="${SH}" rx="${R}" fill="#000"/></mask></defs>
  <g mask="url(#m)"><rect x="${SX - B}" y="${SY - B}" width="${SW + 2 * B}" height="${SH + 2 * B}" rx="${R + B}" fill="#16181a"/><rect x="${SX - B + 3}" y="${SY - B + 3}" width="${SW + 2 * B - 6}" height="${SH + 2 * B - 6}" rx="${R + B - 3}" fill="none" stroke="#3a3e42" stroke-width="3"/></g>
  <rect x="${W / 2 - 62}" y="${SY + 18}" width="124" height="36" rx="18" fill="#050505"/>
  <rect x="${SX - B - 5}" y="${SY + 210}" width="5" height="90" rx="2" fill="#2a2d30"/><rect x="${SX + SW + B}" y="${SY + 260}" width="5" height="140" rx="2" fill="#2a2d30"/></svg>`;
await sharp(Buffer.from(bg)).png().toFile(`${out}/bg.png`);
await sharp(Buffer.from(bezel)).png().toFile(`${out}/bezel.png`);
const framed = async (shot, file) => sharp(`${out}/bg.png`).composite([{input: await sharp(shot).resize(SW, SH).png().toBuffer(), left: SX, top: SY}, {input: `${out}/bezel.png`, left: 0, top: 0}]).jpeg({quality: 88}).toFile(file);

const browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: [`--window-size=${phone.width},${phone.height}`]});
const context = await browser.newContext({viewport: phone, screen: phone, isMobile: true, hasTouch: true, deviceScaleFactor: scale, recordVideo: {dir: out, size: {width: phone.width * scale, height: phone.height * scale}}});
await context.route('**/*', r => { const u = r.request().url(); return u.startsWith(base) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
const page = await context.newPage(), t0 = Date.now(), wait = ms => page.waitForTimeout(ms);
const caption = text => page.evaluate(text => {
  let el = document.getElementById('m-cap');
  if (!el) { el = document.createElement('div'); el.id = 'm-cap'; document.body.append(el); const s = document.createElement('style'); s.textContent = '#m-cap{position:fixed;z-index:99;left:12px;right:12px;bottom:118px;padding:10px 14px;border-radius:14px;background:rgba(18,20,19,.86);color:#fff;font:650 17px/1.3 "DM Sans Variable",system-ui;text-align:center;transition:opacity .3s}#m-cap.hide{opacity:0}'; document.head.append(s); }
  el.classList.toggle('hide', !text); if (text) el.textContent = text;
}, text);
const go = (xy, z) => page.evaluate(([x, y, z]) => { location.hash = `#v=2&m=gandhinagar-city&l=${new URLSearchParams(location.hash.slice(1)).get('l') || 'A'}&cx=${x}&cy=${y}&z=${z}`; }, [xy[0], xy[1], z]);
const tap = sel => page.locator(sel).first().tap();
const shots = [];
const snap = async name => { const f = `${out}/${name}.png`; await page.screenshot({path: f}); shots.push([f, `docs/screenshots/mobile-${name}.jpg`]); };
async function tour(record) {
  await caption(''); await go([meta.width / 2, meta.height / 2], 0.012); await wait(2200);
  await caption('Gandhinagar as a pixel city, in your pocket'); await wait(2600);
  await go(poi('akshardham'), 0.5); await wait(3400); if (record) await snap('akshardham');
  await caption('Night: live traffic, metro and lit windows');
  await tap('[aria-label="Map layers"]'); await wait(300); await tap('.layer-menu button:has-text("Night")'); await go(poi('vidhan-sabha'), 0.18); await wait(5200); if (record) await snap('night');
  await tap('[aria-label="Map layers"]'); await wait(300); await tap('.layer-menu button:has-text("Summer day")'); await wait(900);
  await caption('Find every temple, hospital, metro stop'); await tap('.places-toggle'); await wait(400); await tap('.places-grid button:has-text("Temples")'); await tap('.places-toggle'); await wait(1600); if (record) await snap('places');
  await tap('.place-list li button'); await wait(3600); if (record) await snap('place-card');
  await tap('.places-clear'); await wait(400);
  await caption('Scavenger hunts: zoom in to stamp places'); await tap('[aria-label="Scavenger hunts"]'); await wait(600); await tap('[data-testid="hunt-metro"]'); await wait(700);
  await go(meta.pois.find(p => p.category === 'metro' && p.name === 'Akshardham').image, 0.3); await wait(3800); if (record) await snap('hunt');
  await tap('[aria-label="Close hunts"]');
  await caption('Daily game: find the landmark'); await tap('[aria-label="Daily landmark game"]'); await wait(2600); if (record) await snap('game');
  await tap('[data-testid="guess"]'); await wait(3000); await tap('[aria-label="Close game"]');
  await caption('Explore it yourself · built by ImliStack'); await go([meta.width / 2, meta.height / 2], 0.012); await wait(3200);
}
let keepFrom = 0;
try {
  await page.goto(`${base}/?map=${mapId}`); await page.waitForSelector('.minimap-view'); await wait(2000);
  await tour(false); // warm-up pass so the kept pass has sharp tiles
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('pc-daily-') || k.startsWith('pc-hunt')) localStorage.removeItem(k); });
  await page.reload(); await page.waitForSelector('.minimap-view'); await wait(2000);
  keepFrom = (Date.now() - t0) / 1000;
  await tour(true);
} finally {
  const video = page.video(); await context.close(); await browser.close(); vite.kill();
  const webm = await video.path();
  for (const [src, dst] of shots) await framed(src, dst);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(keepFrom + 0.3), '-i', webm, '-loop', '1', '-i', `${out}/bg.png`, '-loop', '1', '-i', `${out}/bezel.png`,
    '-filter_complex', `[0:v]scale=${SW}:${SH}:flags=lanczos[s];[1:v][s]overlay=${SX}:${SY}:shortest=1[a];[a][2:v]overlay=0:0:shortest=1,format=yuv420p[v]`,
    '-map', '[v]', '-r', '30', '-c:v', 'libx264', '-profile:v', 'high', '-crf', '21', '-preset', 'slow', '-movflags', '+faststart', '-an', 'docs/social/pixel-city-mobile.mp4']);
  const d = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', 'docs/social/pixel-city-mobile.mp4'], {encoding: 'utf8'}).trim();
  console.log(JSON.stringify({video: 'docs/social/pixel-city-mobile.mp4', seconds: Number(d), mb: +(fs.statSync('docs/social/pixel-city-mobile.mp4').size / 1e6).toFixed(1), screenshots: shots.map(s => s[1])}));
}
