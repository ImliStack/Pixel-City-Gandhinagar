// Browser QA for the active-city viewer: offline requests, search, share/restore, layers, minimap,
// missing tiles and mobile layout. Starts its own Vite dev server on a spare port.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
const mapId = process.argv[2] || 'gandhinagar-city', meta = JSON.parse(fs.readFileSync(`outputs/maps/${mapId}/metadata.json`));
const out = `outputs/qa/viewer/${mapId}`;
fs.mkdirSync(out, {recursive: true});
const port = 5199, base = `http://127.0.0.1:${port}`;
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'apps/viewer/vite.config.ts', '--host', '127.0.0.1', '--port', String(port)], {stdio: ['ignore', 'pipe', 'inherit']});
await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('vite did not start')), 30000); vite.stdout.on('data', d => { if (String(d).includes('Local')) { clearTimeout(t); resolve(); } }); });
const results = [], external = [];
const check = (name, ok, detail = '') => { results.push({name, ok: !!ok, detail}); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const settle = page => page.waitForTimeout(1600);
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const context = await browser.newContext({viewport: {width: 1440, height: 900}, acceptDownloads: true});
  await context.route('**/*', r => { const u = r.request().url(); if (u.startsWith(base) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue(); external.push(u); return r.abort(); });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const fonts = []; page.on('request', r => { if (/\.woff2?$/.test(r.url())) fonts.push(r.url()); });
  await page.goto(`${base}/?map=${mapId}`); await page.waitForSelector('.minimap-view'); await settle(page);
  await page.screenshot({path: path.join(out, 'desktop-overview.png')});
  check('opens with tiles and metadata', await page.locator('.map-status').count() === 0);
  const state = () => page.evaluate(() => Object.fromEntries(new URLSearchParams(location.hash.slice(1))));

  // Wheel zoom and drag pan.
  const z0 = Number((await state()).z);
  await page.mouse.move(720, 450); for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(60); } await settle(page);
  const z1 = Number((await state()).z);
  check('wheel zooms in', z1 > z0 * 1.3, `${z0} -> ${z1}`);
  const c0 = await state();
  await page.mouse.move(720, 450); await page.mouse.down(); await page.mouse.move(520, 350, {steps: 8}); await page.mouse.up(); await settle(page);
  const c1 = await state();
  check('drag pans', Math.abs(c1.cx - c0.cx) > 50 && Math.abs(c1.cy - c0.cy) > 20, `${c0.cx},${c0.cy} -> ${c1.cx},${c1.cy}`);
  await page.screenshot({path: path.join(out, 'desktop-neighbourhood.png')});

  // Search in English and Gujarati, keyboard selection, pin at centre.
  await page.keyboard.press('/');
  await page.keyboard.type('metro'); await page.waitForTimeout(300);
  check('English search finds metro viaduct', (await page.locator('.results button').first().textContent()).includes('Metro'));
  await page.fill('.search input', 'સ્વર્ણિમ'); await page.waitForTimeout(300);
  check('Gujarati search finds Swarnim Park', (await page.locator('.results button').allTextContents()).some(t => t.includes('Swarnim Park')));
  await page.fill('.search input', 'vidhan'); await page.keyboard.press('Enter'); await settle(page);
  const s = await state();
  check('search jump selects place and writes versioned hash', s.poi === 'vidhan-sabha' && s.v === '2' && !!s.iv && s.m === mapId, JSON.stringify(s));
  const pin = await page.locator('.map-pin.selected').boundingBox();
  check('selected pin sits at viewport centre', Math.abs(pin.x + pin.width / 2 - 720) < 2 && Math.abs(pin.y + pin.height - 450) < 2, `${pin.x + pin.width / 2},${pin.y + pin.height}`);
  await page.locator('.place-card').waitFor();
  await page.screenshot({path: path.join(out, 'desktop-closeup-selected.png')});

  // Share link restores the same image position, zoom and selection in a fresh page.
  const link = page.url();
  const restored = await context.newPage(); await restored.goto(link); await restored.waitForSelector('.place-card'); await settle(restored);
  const r = await restored.evaluate(() => Object.fromEntries(new URLSearchParams(location.hash.slice(1))));
  check('share link restores view', Math.abs(r.cx - s.cx) < 1 && Math.abs(r.cy - s.cy) < 1 && Math.abs(r.z - s.z) < 1e-3 && r.poi === s.poi, `${r.cx},${r.cy},${r.z}`);
  const stale = await context.newPage(); await stale.goto(link.replace(/iv=[^&]+/, 'iv=old-version')); await stale.waitForSelector('.toast.upper', {timeout: 8000}).catch(() => null);
  check('stale image version shows notice', await stale.locator('.toast.upper').count() === 1);
  await restored.close(); await stale.close();

  // Layer switch keeps the same view (layers share one pixel lattice).
  const before = await state();
  await page.click('[aria-label="Map layers"]'); await page.click('.layer-menu button:has-text("Pixel edge")'); await settle(page);
  const after = await state();
  check('layer switch keeps view', after.l === 'B' && Math.abs(after.cx - before.cx) < 1 && Math.abs(after.cy - before.cy) < 1, `${before.cx}->${after.cx}`);
  await page.click('[aria-label="Map layers"]'); await page.click('.layer-menu button:has-text("Summer day")'); await settle(page);

  // Category filter: a chip toggles pixel-icon pins and is stored in the share hash.
  await page.keyboard.press('0'); await settle(page); // whole city in view, so some category pins are on screen
  await page.click('.places-toggle');
  const chip = page.locator('.places-grid button', {hasText: 'Hospitals'}).first(), chipName = (await chip.textContent()) || '';
  await chip.click(); await page.waitForTimeout(400);
  const fState = await state();
  check('category chip filters and persists', !!fState.f && (await page.locator('.map-pin.icon-pin').count()) > 0 && (await page.locator('.map-pin.icon-pin .pixel-icon').count()) > 0, `${chipName} → f=${fState.f}`);
  await chip.click(); await page.waitForTimeout(300);
  check('clearing chip removes icon pins', !(await state()).f);
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  check('places panel collapses on Escape', (await page.locator('.places-panel').count()) === 0);
  // Filtering one category lists every matching place; a row opens a card with a pixel thumbnail and summary.
  await page.click('.places-toggle'); await page.locator('.places-grid button', {hasText: 'Temples'}).first().click(); await page.keyboard.press('Escape');
  await page.waitForSelector('.place-list li');
  const worship = meta.categories.find(c => c.id === 'worship').count, listCount = Number(await page.locator('[data-testid="list-count"]').textContent());
  check('temple filter lists every temple', listCount === worship && (await page.locator('.place-list li').count()) === worship, `${listCount} of ${worship}`);
  await page.locator('.place-list li button').first().click(); await page.waitForSelector('.place-card .place-thumb img'); await settle(page);
  const summary = await page.locator('[data-testid="place-summary"]').textContent(), thumbOk = await page.locator('.place-thumb img').evaluateAll(imgs => imgs.length > 0 && imgs.every(i => i.complete && i.naturalWidth > 0));
  check('place card shows pixel thumbnail and summary', thumbOk && /Sector|OpenStreetMap/.test(summary), summary.slice(0, 80));
  await page.screenshot({path: path.join(out, 'desktop-place-list.png')});
  await page.click('.places-clear'); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  check('clearing filter hides the list', (await page.locator('.place-list').count()) === 0);

  // Night / climate layers share the lattice: switching keeps the view.
  const pre = await state();
  await page.click('[aria-label="Map layers"]'); await page.click('.layer-menu button:has-text("Night")'); await settle(page);
  const post = await state();
  check('night layer opens at same view', post.l === 'night' && Math.abs(post.cx - pre.cx) < 1, `${pre.cx}->${post.cx}`);
  await page.screenshot({path: path.join(out, 'desktop-night.png')});
  await page.click('[aria-label="Map layers"]'); await page.click('.layer-menu button:has-text("Summer day")'); await settle(page);
  // Zoom-out never reveals blank space: the art fills the window and stays inside the image.
  await page.keyboard.press('0'); await settle(page);
  for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 240); await page.waitForTimeout(40); } await settle(page);
  const bounds = await page.evaluate(() => { const c = document.querySelector('.map-canvas').getBoundingClientRect(); return {w: c.width, h: c.height}; });
  const view = await page.evaluate(() => { const s = Object.fromEntries(new URLSearchParams(location.hash.slice(1))); return {cx: +s.cx, cy: +s.cy, z: +s.z}; });
  const halfW = bounds.w / view.z / 2, halfH = bounds.h / view.z / 2;
  const tol = meta.width / 2000; // share hash rounds zoom to 5 decimals
  check('zoom-out never shows space outside the art', view.cx - halfW >= -tol && view.cy - halfH >= -tol && view.cx + halfW <= meta.width + tol && view.cy + halfH <= meta.height + tol, `view ${Math.round(view.cx - halfW)},${Math.round(view.cy - halfH)} → ${Math.round(view.cx + halfW)},${Math.round(view.cy + halfH)}`);
  const motion = () => page.evaluate(() => ({...window.__motion?.stats}));
  check('never-rendered regions get textured ground (map + minimap)', (await motion()).blankRects > 0 && (await page.locator('.minimap-blank').count()) === 1, `${(await motion()).blankRects} blank regions in view`);

  // Daytime birds: flocks with ground shadows are drawn once zoomed in a little.
  await page.evaluate(() => { const h = Object.fromEntries(new URLSearchParams(location.hash.slice(1))); location.hash = `#v=2&m=${h.m}&l=A&cx=${h.cx}&cy=${h.cy}&z=0.05`; }); await settle(page);
  check('daytime bird flocks are drawn', (await motion()).birds > 0, `${(await motion()).birds} birds in view`);
  await page.keyboard.press('0'); await settle(page);

  // Day → night cross-fade: two images during the fade, one after.
  await page.click('[aria-label="Map layers"]'); await page.click('.layer-menu button:has-text("Night")');
  await page.waitForTimeout(350);
  const midItems = await page.evaluate(() => window.__viewer?.world.getItemCount());
  await page.waitForTimeout(1400);
  const endItems = await page.evaluate(() => window.__viewer?.world.getItemCount());
  check('day→night cross-fades through two images', midItems === 2 && endItems === 1, `${midItems} during, ${endItems} after`);

  // Night motion at full-city zoom: traffic and trains drawn, frame rate measured.
  const f0 = (await motion()).frames, t0 = Date.now(); await page.waitForTimeout(3000);
  const night = await motion(), fps = ((night.frames - f0) * 1000) / (Date.now() - t0);
  check('night motion draws traffic and metro at full-city zoom', night.carsDrawn > 200 && night.trains >= 2, `${night.carsDrawn}/${night.cars} cars, ${night.trains} trains`);
  check('night motion holds frame rate (≥ 24 of 30 fps cap)', fps >= 24, `${fps.toFixed(1)} fps`);
  await page.screenshot({path: path.join(out, 'desktop-night-motion.png')});
  // Close zoom: living windows, lamps and fireflies (Capital complex has a park beside it).
  const vs = meta.pois.find(p => p.id === 'vidhan-sabha');
  await page.evaluate(([x, y]) => { location.hash = `#v=2&m=${new URLSearchParams(location.hash.slice(1)).get('m')}&l=night&cx=${x}&cy=${y}&z=0.3`; }, vs.image); await settle(page); await page.waitForTimeout(800);
  const close = await motion();
  check('close night: lit windows, lamp glow and fireflies', close.windowsLit > 0 && close.lamps > 0 && close.fireflies > 0, `${close.windowsLit} windows, ${close.lamps} lamps, ${close.fireflies} fireflies`);
  await page.screenshot({path: path.join(out, 'desktop-night-close.png')});
  // Motion switch in the layer menu turns animation off.
  await page.click('[aria-label="Map layers"]'); await page.click('.layer-menu button:has-text("Night & weather motion")'); await page.waitForTimeout(500);
  check('motion switch turns animation off', (await motion()).carsDrawn === 0 && (await motion()).windowsLit === 0);
  await page.click('.layer-menu button:has-text("Night & weather motion")'); await page.waitForTimeout(300);
  // Monsoon: drifting cloud shadows.
  await page.click('.layer-menu button:has-text("Monsoon")'); await page.keyboard.press('0'); await settle(page); await page.waitForTimeout(1200);
  check('monsoon layer draws cloud shadows', (await motion()).clouds > 0, `${(await motion()).clouds} clouds`);
  // Live clock follows India time (day → A, dusk/night → night).
  await page.click('[aria-label="Map layers"]'); await page.click('.layer-menu button:has-text("Live India time")'); await page.waitForTimeout(1500);
  const ist = await page.evaluate(() => { const d = new Date(Date.now() + 5.5 * 3600e3); return d.getUTCHours() * 60 + d.getUTCMinutes(); });
  const wantNight = ist >= 1065 || ist < 420;
  check('live India time picks day or night', (await state()).l === (wantNight ? 'night' : 'A'), `IST ${Math.floor(ist / 60)}:${String(ist % 60).padStart(2, '0')} → ${(await state()).l}`);
  await page.click('.layer-menu button:has-text("Live India time")'); await page.click('.layer-menu button:has-text("Summer day")'); await settle(page);

  // Minimap click recentres the map at the corresponding image position.
  await page.mouse.move(720, 450); for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(60); } await settle(page);
  const mm = await page.locator('.minimap-frame').boundingBox();
  await page.mouse.click(mm.x + mm.width * 0.75, mm.y + mm.height * 0.25); await settle(page);
  const m = await state();
  check('minimap click pans to matching position', Math.abs(m.cx - meta.width * 0.75) < meta.width / 150 && Math.abs(m.cy - meta.height * 0.25) < meta.height / 150, `${m.cx},${m.cy}`);
  const rect = await page.locator('.minimap-view').boundingBox();
  check('minimap rectangle follows view', Math.abs(rect.x + rect.width / 2 - (mm.x + mm.width * 0.75)) < 4, `${rect.x + rect.width / 2}`);

  // Reset and keyboard zoom.
  await page.keyboard.press('0'); await settle(page);
  const zr = Number((await state()).z);
  check('reset returns to home overview', Math.abs(zr - z0) < 1e-3, `${zr} vs home ${z0}`);
  check('fonts are local', fonts.length > 0 && fonts.every(u => u.startsWith(base)), `${fonts.length} font requests`);

  // Random landmark (shuffle bag, R key) selects a curated place.
  await page.keyboard.press('r'); await settle(page);
  const rl = await state();
  check('random landmark selects a curated place', !!rl.poi && meta.pois.some(p => p.id === rl.poi && p.curated), rl.poi);
  await page.keyboard.press('Escape'); await page.keyboard.press('0'); await settle(page);

  // Presence: two tabs (separate anonymous ids) see each other; visits counted.
  const online = p => p.locator('[data-testid="online"]').textContent().then(Number).catch(() => 0);
  await page.waitForSelector('.presence');
  const second = await context.newPage(); await second.goto(`${base}/?map=${mapId}`); await second.waitForSelector('.presence');
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="online"]')?.textContent) >= 2, null, {timeout: 12000}).catch(() => null);
  const faces = await page.locator('.presence .pixel-face').count();
  check('presence shows both tabs with pixel faces', (await online(page)) >= 2 && (await online(second)) >= 2 && faces >= 2, `${await online(page)} online, ${faces} faces, ${await page.locator('[data-testid="visits"]').textContent()} visits`);

  // Daily game: both tabs guess round 1; the second tab sees the first tab's guess and a shared board.
  await page.keyboard.press('d'); await page.waitForSelector('.game-panel .clue img');
  check('daily game shows a tile close-up clue', (await page.locator('.game-panel .clue img').count()) >= 1);
  await page.click('[data-testid="guess"]'); await page.waitForSelector('.game-panel .answer');
  await second.keyboard.press('d'); await second.waitForSelector('[data-testid="guess"]'); await second.click('[data-testid="guess"]');
  await second.waitForSelector('.game-mark.other', {timeout: 12000}).catch(() => null);
  const rows = await second.locator('.board-row').count();
  check('multiplayer: second tab sees other guess and shared board', (await second.locator('.game-mark.other').count()) >= 1 && rows >= 2, `${rows} board rows`);
  await second.screenshot({path: path.join(out, 'desktop-daily-game.png')});
  await second.close(); await page.keyboard.press('Escape');

  // Live cursors: the second tab's view centre shows up on the first tab's map and minimap.
  const watcher = await context.newPage(), vsC = meta.pois.find(p => p.id === 'vidhan-sabha').image;
  await watcher.goto(`${base}/?map=${mapId}#v=2&m=${mapId}&l=A&cx=${vsC[0] + 300}&cy=${vsC[1] + 200}&z=0.2`); await watcher.waitForSelector('.minimap-view');
  await page.evaluate(([x, y]) => { location.hash = `#v=2&m=gandhinagar-city&l=A&cx=${x}&cy=${y}&z=0.08`; }, vsC);
  await page.waitForSelector('.cursor-mark', {timeout: 15000}).catch(() => null);
  check('live cursor of another tab on map and minimap', (await page.locator('.cursor-mark').count()) >= 1 && (await page.locator('.minimap-cursor').count()) >= 1);
  await watcher.close();

  // Scavenger hunt: zooming in on a metro station stamps it.
  await page.evaluate(() => localStorage.removeItem('pc-hunts'));
  await page.keyboard.press('h'); await page.click('[data-testid="hunt-metro"]');
  const st = meta.pois.find(p => p.category === 'metro' && p.name === 'Akshardham').image;
  await page.evaluate(([x, y]) => { location.hash = `#v=2&m=gandhinagar-city&l=A&cx=${x}&cy=${y}&z=0.3`; }, st);
  await page.waitForSelector('.hunt-toast', {timeout: 8000}).catch(() => null);
  const huntText = await page.locator('.hunt-progress span').textContent().catch(() => '');
  check('hunt stamps a place when zoomed in on it', (await page.locator('.hunt-places li.got').count()) === 1 && /1 of 12/.test(huntText), huntText);
  await page.screenshot({path: path.join(out, 'desktop-hunt.png')});
  await page.keyboard.press('Escape'); await page.keyboard.press('0'); await settle(page);

  // No social server (static hosting / offline): map still works, counter hidden, game plays solo.
  const solo = await context.newPage(); await solo.route('**/api/social/**', r => r.fulfill({status: 404, contentType: 'text/plain', body: ''}));
  await solo.goto(`${base}/?map=${mapId}`); await solo.waitForSelector('.minimap-view'); await settle(solo);
  await solo.keyboard.press('d'); await solo.waitForSelector('.game-panel');
  check('offline: no presence chip, game still playable', (await solo.locator('.presence').count()) === 0 && (await solo.locator('.board-head').textContent()).includes('solo') && (await solo.locator('[data-testid="guess"]').count()) === 1);
  await solo.close();

  // Missing tiles: drop every level-12 tile and expect a visible notice, not a crash.
  const broken = await context.newPage();
  await broken.route(`**/A_files/${Math.ceil(Math.log2(Math.max(meta.width, meta.height))) - 2}/**`, r => r.fulfill({status: 404, body: ''}));
  await broken.goto(`${base}/?map=${mapId}#v=2&m=${mapId}&l=A&cx=${meta.width / 2}&cy=${meta.height / 2}&z=0.25`); await broken.waitForSelector('.toast', {timeout: 10000}).catch(() => null);
  check('missing tiles show notice', await broken.locator('.toast').count() >= 1 && (await broken.locator('.toast').first().textContent()).includes('could not load'));
  await broken.screenshot({path: path.join(out, 'missing-tiles.png')}); await broken.close();

  // Fresh visit (no view in the URL): the map opens on the whole city, then glides in to the capital complex.
  const intro = await context.newPage(); await intro.goto(`${base}/?map=${mapId}&intro=1`); await intro.waitForSelector('.minimap-view');
  await intro.waitForTimeout(5000);
  const iz = await intro.evaluate(() => Object.fromEntries(new URLSearchParams(location.hash.slice(1))));
  const vs0 = meta.pois.find(p => p.id === 'vidhan-sabha').image;
  check('fresh visit zooms in to the capital complex', Number(iz.z) > z0 * 2.5 && Math.abs(iz.cx - vs0[0]) < 50 && Math.abs(iz.cy - vs0[1]) < 50, `z ${z0} → ${iz.z}`);
  await intro.close();

  // Ambient life: water shimmer, trains, planes, daytime traffic with autos/buses, festival modes, postcards.
  const amb = async (q, hash, ms = 3500) => { const apg = await context.newPage(); await apg.goto(`${base}/?map=${mapId}${q}${hash}`); await apg.waitForSelector('.minimap-view'); await apg.waitForTimeout(ms); const ast = await apg.evaluate(() => ({...window.__motion.stats, ...window.__motion.ambient.stats})); return [apg, ast]; };
  const mo = JSON.parse(fs.readFileSync(`outputs/maps/${mapId}/motion.json`));
  let [apg, ast] = await amb('', `#v=2&m=${mapId}&l=A&cx=${mo.water.points[0]}&cy=${mo.water.points[1]}&z=0.25`);
  check('lake and river shimmer drawn', ast.water > 0, `${ast.water} water points`); await apg.close();
  [apg, ast] = await amb('', `#v=2&m=${mapId}&l=A&cx=${meta.width / 2}&cy=${meta.height / 2}&z=0.02`);
  check('trains and planes on the move', ast.trains >= 1 && ast.planes >= 1, `${ast.trains} trains, ${ast.planes} planes`); await apg.close();
  const vsA = meta.pois.find(p => p.id === 'vidhan-sabha').image;
  [apg, ast] = await amb('', `#v=2&m=${mapId}&l=A&cx=${vsA[0]}&cy=${vsA[1]}&z=0.12`);
  check('daytime traffic with autos and buses', ast.dayVehicles > 50, `${ast.dayVehicles} vehicles`); await apg.close();
  [apg, ast] = await amb('&festival=uttarayan', `#v=2&m=${mapId}&l=A&cx=${vsA[0]}&cy=${vsA[1]}&z=0.12`);
  check('Uttarayan kites over the rooftops', ast.kites > 10 && ast.festival === 'uttarayan' && (await apg.locator('.festival-note').count()) === 1, `${ast.kites} kites`); await apg.close();
  [apg, ast] = await amb('&festival=diwali', `#v=2&m=${mapId}&l=night&cx=${vsA[0]}&cy=${vsA[1]}&z=0.1`);
  check('Diwali mode at night', ast.festival === 'diwali' && ast.fps >= 20, `${ast.fps} fps, ${ast.drawMs} ms`); await apg.close();
  [apg] = await amb('', `#v=2&m=${mapId}&l=A&cx=${vsA[0]}&cy=${vsA[1]}&z=0.4`, 2500);
  await apg.keyboard.press('p'); const [dl] = await Promise.all([apg.waitForEvent('download'), apg.click('[data-testid="postcard-save"]')]);
  const card = await dl.path().then(f => fs.statSync(f).size).catch(() => 0);
  check('photo postcard saves a JPEG', /\.jpg$/.test(dl.suggestedFilename()) && card > 50000, `${dl.suggestedFilename()} ${Math.round(card / 1024)} KB`); await apg.close();

  // Live weather (mocked rainy afternoon): the chip shows Gandhinagar's sky and can pick the monsoon layer.
  const wet = await context.newPage();
  await wet.route('**/api/weather', r => r.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({code: 63, isDay: true, cloud: 96, temp: 29, rain: 2.1, wind: 18, label: 'Rain', icon: '🌧️', layer: 'monsoon', observed: '2026-07-14T15:00', fetchedAt: new Date().toISOString(), source: 'Open-Meteo.com (CC BY 4.0)'})}));
  await wet.goto(`${base}/?map=${mapId}#v=2&m=${mapId}&l=A&cx=${meta.width / 2}&cy=${meta.height / 2}&z=0.03`); await wet.waitForSelector('[data-testid="weather"]');
  await wet.click('[data-testid="weather"]'); await wet.waitForTimeout(1500);
  const wl = await wet.evaluate(() => new URLSearchParams(location.hash.slice(1)).get('l'));
  check('live weather: rain switches to the monsoon layer', wl === 'monsoon' && (await wet.locator('.weather-chip.live').count()) === 1, `layer ${wl}`);
  await wet.close();

  // Free "Pixel Singapore" upgrades: tilt-shift blur bands, tree sway from the map's own pixels (which also
  // puts cars under crowns), and an airborne canvas above it.
  const swayPg = await context.newPage();
  await swayPg.goto(`${base}/?map=${mapId}&festival=off#v=2&m=${mapId}&l=A&cx=${vsA[0] + 300}&cy=${vsA[1] + 400}&z=0.8`); await swayPg.waitForSelector('.minimap-view'); await swayPg.waitForTimeout(4000);
  const sw = await swayPg.evaluate(async () => { const a = window.__sway?.stats.frames || 0; await new Promise(r => setTimeout(r, 1000)); return {ready: window.__sway?.ready, fps: (window.__sway?.stats.frames || 0) - a, air: !!document.querySelector('.air-canvas')}; });
  check('tree sway runs on settled close views', sw.ready && sw.fps >= 20 && sw.air, JSON.stringify(sw));
  check('tilt-shift blur bands present', (await swayPg.locator('.tilt-shift .top').count()) === 1);
  await swayPg.click('[aria-label="Map layers"]'); await swayPg.click('.layer-menu button:has-text("Tilt-shift blur")');
  check('tilt-shift can be switched off', (await swayPg.locator('.tilt-shift').count()) === 0);
  await swayPg.close();

  // prefers-reduced-motion: no animation by default, layer switches are instant.
  const calm = await browser.newContext({viewport: {width: 1200, height: 800}, reducedMotion: 'reduce'});
  await calm.route('**/*', r => { const u = r.request().url(); if (u.startsWith(base) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue(); external.push(u); return r.abort(); });
  const still = await calm.newPage(); await still.goto(`${base}/?map=${mapId}#v=2&m=${mapId}&l=night&cx=${meta.width / 2}&cy=${meta.height / 2}&z=0.03`); await still.waitForSelector('.minimap-view'); await settle(still); await still.waitForTimeout(800);
  const calmStats = await still.evaluate(() => ({...window.__motion?.stats}));
  await still.click('[aria-label="Map layers"]');
  const motionOff = await still.locator('.layer-menu [aria-checked="false"]:has-text("Night & weather motion")').count();
  await still.click('.layer-menu button:has-text("Summer day")'); await still.waitForTimeout(200);
  const calmItems = await still.evaluate(() => window.__viewer?.world.getItemCount());
  check('reduced motion: no particles, instant layer switch', calmStats.carsDrawn === 0 && !calmStats.birds && calmItems === 1 && motionOff === 1, `${calmStats.carsDrawn} cars, ${calmItems} images, switch off: ${motionOff === 1}`);
  await calm.close();

  // Mobile layout: controls, search and minimap must not overlap; touch device emulation.
  const mobile = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 2});
  await mobile.route('**/*', r => { const u = r.request().url(); if (u.startsWith(base) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue(); external.push(u); return r.abort(); });
  const phone = await mobile.newPage(); await phone.goto(`${base}/?map=${mapId}`); await phone.waitForSelector('.minimap-view'); await settle(phone);
  const boxes = await phone.evaluate(() => Object.fromEntries(['.search', '.controls', '.minimap', '.attribution'].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return [s, [r.left, r.top, r.right, r.bottom]]; })));
  const overlap = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  const keys = Object.keys(boxes), clashes = [];
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) if (overlap(boxes[keys[i]], boxes[keys[j]])) clashes.push(`${keys[i]}×${keys[j]}`);
  check('mobile chrome does not overlap', clashes.length === 0, clashes.join(', '));
  check('mobile has no horizontal scroll', await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const zoomOf = p => p.evaluate(() => Number(new URLSearchParams(location.hash.slice(1)).get('z')));
  const pz0 = await zoomOf(phone); await phone.tap('[aria-label="Zoom in"]'); await settle(phone); const pz1 = await zoomOf(phone);
  check('mobile zoom button works', pz1 > pz0 * 1.4, `${pz0} -> ${pz1}`);
  await phone.screenshot({path: path.join(out, 'mobile.png')});
  await mobile.close();

  check('no page errors', errors.length === 0, errors.join(' | '));
  check('zero external runtime requests', external.length === 0, external.slice(0, 3).join(', '));
} finally {
  await browser?.close(); vite.kill();
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({createdAt: new Date().toISOString(), results, externalRequests: external}, null, 2));
}
const failed = results.filter(r => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;
