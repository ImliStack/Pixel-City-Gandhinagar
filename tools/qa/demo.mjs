// Record a ~35 s local navigation demo (overview → neighbourhood → close-up) with Playwright, then encode MP4 via ffmpeg.
import fs from 'node:fs';
import path from 'node:path';
import {spawn, execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
const mapId = process.argv[2] || 'gandhinagar-city', out = 'outputs/demo'; fs.mkdirSync(out, {recursive: true});
const port = 5198, base = `http://127.0.0.1:${port}`, size = {width: 1440, height: 900};
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'apps/viewer/vite.config.ts', '--host', '127.0.0.1', '--port', String(port)], {stdio: ['ignore', 'pipe', 'inherit']});
await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('vite did not start')), 30000); vite.stdout.on('data', d => { if (String(d).includes('Local')) { clearTimeout(t); resolve(); } }); });
const browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const external = [];
const context = await browser.newContext({viewport: size, recordVideo: {dir: out, size}});
await context.route('**/*', r => { const u = r.request().url(); if (u.startsWith(base) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue(); external.push(u); return r.abort(); });
const page = await context.newPage();
const start = Date.now(), marks = [];
const mark = label => marks.push({t: (Date.now() - start) / 1000, label});
const wheel = async (x, y, n, dy = -100, gap = 140) => { await page.mouse.move(x, y); for (let i = 0; i < n; i++) { await page.mouse.wheel(0, dy); await page.waitForTimeout(gap); } };
const drag = async (x0, y0, x1, y1, steps = 40) => { await page.mouse.move(x0, y0); await page.mouse.down(); for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await page.waitForTimeout(25); } await page.mouse.up(); };
const search = async (text) => { await page.click('.search input'); await page.keyboard.type(text, {delay: 80}); await page.waitForTimeout(600); await page.keyboard.press('Enter'); await page.waitForTimeout(2800); };
try {
  await page.goto(`${base}/?map=${mapId}`); await page.waitForSelector('.minimap-view'); await page.waitForTimeout(3000);
  mark('city overview');
  await drag(900, 500, 760, 420); await page.waitForTimeout(1000);
  mark('zoom into sectors');
  await wheel(720, 420, 9, -100, 160); await page.waitForTimeout(1500);
  await drag(900, 450, 560, 520, 60); await page.waitForTimeout(1200);
  mark('search → Akshardham close-up');
  await search('akshardham');
  await drag(600, 500, 820, 420, 50); await page.waitForTimeout(1000);
  mark('search → capital complex');
  await search('vidhan');
  await wheel(720, 450, 3, 100); await page.waitForTimeout(1500);
  mark('night layer');
  await page.click('[aria-label="Map layers"]'); await page.waitForTimeout(300);
  if (await page.locator('.layer-menu button:has-text("Night"):not([disabled])').count()) { await page.click('.layer-menu button:has-text("Night")'); await page.waitForTimeout(3200); await page.click('[aria-label="Map layers"]'); await page.click('.layer-menu button:has-text("Summer day")'); await page.waitForTimeout(2000); } else await page.keyboard.press('Escape');
  mark('places filter');
  await page.keyboard.press('0'); await page.waitForTimeout(2200);
  await page.click('.places-toggle'); await page.waitForTimeout(500);
  for (const name of ['Hospitals', 'Petrol', 'Schools']) { await page.click(`.places-grid button:has-text("${name}")`); await page.waitForTimeout(500); }
  await page.waitForTimeout(1200); await page.keyboard.press('Escape'); await page.waitForTimeout(1500);
  mark('minimap jump');
  const mm = await page.locator('.minimap-frame').boundingBox();
  await page.mouse.click(mm.x + mm.width * 0.62, mm.y + mm.height * 0.48); await page.waitForTimeout(1500);
  await wheel(720, 450, 5); await page.waitForTimeout(2200);
  mark('end');
} finally {
  const video = page.video(); await context.close(); await browser.close(); vite.kill();
  const webm = await video.path(), mp4 = path.join(out, 'navigation-demo.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '27', '-preset', 'slow', '-movflags', '+faststart', mp4]);
  fs.renameSync(webm, path.join(out, 'navigation-demo.webm'));
  // README GIF: the first 24 s highlight at 560 px, 8 fps, palette per clip (keeps it under ~10 MB).
  fs.mkdirSync('docs', {recursive: true}); fs.copyFileSync(mp4, 'docs/demo.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-t', '24', '-vf', 'fps=8,scale=560:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle', 'docs/demo.gif']);
  const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4], {encoding: 'utf8'}));
  fs.writeFileSync(path.join(out, 'demo.json'), JSON.stringify({file: mp4, durationSeconds: duration, viewport: size, chapters: marks, externalRequests: external, recordedWith: 'Playwright recordVideo, headless Chrome, local Vite dev server'}, null, 2));
  console.log(JSON.stringify({mp4, duration, chapters: marks.length, external: external.length}));
}
