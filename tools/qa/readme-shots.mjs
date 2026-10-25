// Capture README screenshots from the real local viewer (own Vite server, zero external requests).
// Usage: node tools/qa/readme-shots.mjs [mapId]
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
const mapId = process.argv[2] || 'gandhinagar-city', meta = JSON.parse(fs.readFileSync(`outputs/maps/${mapId}/metadata.json`));
const out = 'docs/screenshots'; fs.mkdirSync(out, {recursive: true});
const port = 5197, base = `http://127.0.0.1:${port}`;
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'apps/viewer/vite.config.ts', '--host', '127.0.0.1', '--port', String(port)], {stdio: ['ignore', 'pipe', 'inherit']});
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('vite did not start')), 30000); vite.stdout.on('data', d => { if (String(d).includes('Local')) { clearTimeout(t); res(); } }); });
const poi = id => meta.pois.find(p => p.id === id);
const at = (id, z, layer = 'A', extra = '') => { const p = poi(id); return p ? `#v=2&m=${mapId}&l=${layer}&cx=${p.image[0].toFixed(1)}&cy=${p.image[1].toFixed(1)}&z=${z}${extra}` : null; };
const layers = Object.keys(meta.layers);
const shots = [
  ['overview', `#v=2&m=${mapId}&l=A&cx=${meta.width / 2}&cy=${meta.height / 2}&z=0.0175`],
  ['capital-complex', at('vidhan-sabha', 0.45)],
  ['akshardham', at('akshardham', 1.1, 'A', '&poi=akshardham')],
  ['dandi-kutir', at('dandi-kutir', 0.7)],
  ['sector-housing', at('sector-17', 0.6) || at('sector-18', 0.6)],
  ['metro', at('metro-line-2', 0.9)],
  ['places', `#v=2&m=${mapId}&l=A&cx=${meta.width / 2}&cy=${meta.height / 2}&z=0.03&f=hospital,fuel,school,bank`, 'places'],
  ['daily-game', at('vidhan-sabha', 0.02), 'daily'],
  ['presence', at('vidhan-sabha', 0.3), 'presence'],
  ...['night', 'monsoon', 'winter'].filter(l => layers.includes(l)).map(l => [l, at('vidhan-sabha', 0.55, l)]),
].filter(s => s[1]);
const external = [];
const browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try {
  for (const [ctxName, opts] of [['desktop', {viewport: {width: 1440, height: 900}, deviceScaleFactor: 1}], ['mobile', {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 2}]]) {
    const ctx = await browser.newContext(opts);
    await ctx.route('**/*', r => { const u = r.request().url(); if (u.startsWith(base) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue(); external.push(u); return r.abort(); });
    for (const [name, hash, action] of ctxName === 'desktop' ? shots : [['mobile', shots[1][1]]]) {
      const page = await ctx.newPage(); // fresh page: a hash-only change would keep the previous layer and panels
      await page.goto(`${base}/?map=${mapId}${hash}`); await page.waitForSelector('.minimap-view', {timeout: 30000}); await page.waitForTimeout(3500);
      if (action === 'places') { await page.click('.places-toggle'); await page.waitForTimeout(500); }
      // Social shots: two extra tabs act as other visitors (same local in-memory server).
      if (action === 'daily' || action === 'presence') {
        const friends = [];
        for (let i = 0; i < (action === 'presence' ? 3 : 2); i++) { const f = await ctx.newPage(); await f.goto(`${base}/?map=${mapId}${hash}`); await f.waitForSelector('.presence'); friends.push(f); }
        if (action === 'daily') for (const [i, f] of friends.entries()) { await f.keyboard.press('d'); await f.waitForSelector('[data-testid="guess"]'); await f.mouse.move(700, 450); await f.mouse.down(); await f.mouse.move(700 + 60 * (i + 1), 450 - 40 * i, {steps: 4}); await f.mouse.up(); await f.waitForTimeout(800); await f.click('[data-testid="guess"]'); await f.waitForTimeout(600); }
        await page.waitForFunction((n) => Number(document.querySelector('[data-testid="online"]')?.textContent) > n, friends.length, {timeout: 12000});
        if (action === 'daily') { await page.keyboard.press('d'); await page.waitForSelector('[data-testid="guess"]'); await page.click('[data-testid="guess"]'); await page.waitForSelector('.game-mark.other', {timeout: 12000}); await page.waitForTimeout(2500); }
        page.on('close', () => friends.forEach(f => f.close().catch(() => {})));
      }
      await page.screenshot({path: `${out}/${name}.jpg`, type: 'jpeg', quality: 86}); console.log('shot', name); await page.close();
    }
    await ctx.close();
  }
} finally { await browser.close(); vite.kill(); }
console.log(JSON.stringify({shots: shots.length + 1, externalRequests: external.length}));
