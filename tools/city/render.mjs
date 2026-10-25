// City-scale renderer: every region scene renders only its own chunks of the one global image lattice.
// Usage: node tools/city/render.mjs --config config/cities/gandhinagar-city.json --mode A [--fresh] [--regions 3-4,3-5] [--stop-after N] [--seam]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {serve} from '../local-server.mjs';
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const cfg = JSON.parse(fs.readFileSync(opt('--config', 'config/cities/gandhinagar-city.json')));
const mode = opt('--mode', 'A'), layout = JSON.parse(fs.readFileSync(path.join(cfg.output, 'layout.json')));
const dir = path.join(cfg.output, `render-${mode}`); fs.mkdirSync(dir, {recursive: true});
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
// Pixels depend on the scene code, dependencies and the capture protocol (padding, crop, PNG encode); bump
// RENDER_PROTOCOL whenever grab()/padding handling changes. Reporting-only edits to this file do not invalidate chunks.
const RENDER_PROTOCOL = 1;
const code = sha(Buffer.concat([...['tools/capital/scene.mjs', 'package-lock.json'].map(f => fs.readFileSync(f)), Buffer.from(`protocol ${RENDER_PROTOCOL}`)]));
// Viewer-only config fields (names, curated search entries, notes) do not change pixels and are left out of the hash.
const VIEWER_ONLY = ['title', 'subtitle', 'curated', 'location', 'referenceVideo', 'note', 'style'];
const renderConfig = Object.fromEntries(Object.entries(cfg).filter(([k]) => !VIEWER_ONLY.includes(k)));
const inputs = sha(JSON.stringify({config: renderConfig, code, mode, lattice: [layout.width, layout.height, layout.centerWorld]}));
const stateFile = path.join(dir, 'job.json');
let state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile)) : null;
if (state && state.inputs !== inputs && !args.includes('--fresh')) throw new Error(`Render inputs changed since ${state.createdAt}; re-run with --fresh. Stale chunks are never reused.`);
if (!state || state.inputs !== inputs || args.includes('--fresh')) {
  for (const f of fs.readdirSync(dir)) if (/^\d+-\d+\.png$/.test(f)) fs.unlinkSync(path.join(dir, f));
  state = {inputs, code, mode, createdAt: new Date().toISOString(), width: layout.width, height: layout.height, chunks: {}, regions: {}, sessions: []};
}
const save = () => { fs.writeFileSync(stateFile + '.tmp', JSON.stringify(state)); fs.renameSync(stateFile + '.tmp', stateFile); };
const session = {startedAt: new Date().toISOString(), rendered: 0, resumed: 0, regions: 0}; state.sessions.push(session); save();
let peak = 0; const sampler = setInterval(() => { try { const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,rss='], {encoding: 'utf8'}).trim().split('\n').map(s => s.trim().split(/\s+/).map(Number)), ids = new Set([process.pid]); let ch = true; while (ch) { ch = false; for (const [p, pp] of rows) if (ids.has(pp) && !ids.has(p)) { ids.add(p); ch = true; } } peak = Math.max(peak, rows.filter(r => ids.has(r[0])).reduce((s, r) => s + r[2] * 1024, 0)); } catch {} }, 1000);
const only = opt('--regions', null)?.split(','), stopAfter = Number(opt('--stop-after', Infinity)), pad = cfg.renderPadding, chunk = cfg.chunkSize;
const {server, url} = await serve(process.cwd()); let browser; const start = performance.now(), external = [];
async function openRegion(region) {
  const page = await browser.newPage({viewport: {width: 800, height: 600}});
  await page.route('**/*', r => { if (r.request().url().startsWith(url)) return r.continue(); external.push(r.request().url()); return r.abort(); });
  let pageError; page.on('pageerror', e => { pageError = e; console.error('PAGE', region.key, e.message); }); page.on('crash', () => { pageError = new Error('renderer crashed'); });
  await page.goto(`${url}/tools/capital/index.html?mode=${mode}&scene=/${path.join(cfg.output, region.scene)}`);
  await Promise.race([page.waitForFunction(() => window.sceneReady, undefined, {timeout: 900000}), new Promise((_, rej) => { const t = setInterval(() => { if (pageError) { clearInterval(t); rej(pageError); } }, 250); })]);
  return page;
}
async function grab(page, x, y, w, h) { const b64 = await page.evaluate(a => window.renderChunk(...a), [x, y, w, h, pad]); return sharp(Buffer.from(b64, 'base64')).extract({left: pad, top: pad, width: w, height: h}).removeAlpha().png({compressionLevel: 6}); }
let n = 0;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--disable-background-networking', '--disable-component-update', '--no-first-run', '--use-angle=metal', '--enable-gpu']});
  state.chromeVersion = browser.version();
  for (const region of layout.regions) {
    if (only && !only.includes(region.key)) continue;
    const [rx, ry, rw, rh] = region.rect, keys = [];
    for (let y = ry; y < ry + rh; y += chunk) for (let x = rx; x < rx + rw; x += chunk) keys.push([x, y]);
    if (!region.scene) { // outside the acquired OSM extent: no source data, so no artwork is drawn
      for (const [x, y] of keys) state.chunks[`${x}-${y}`] ??= {empty: true}; continue;
    }
    const sceneHash = sha(fs.readFileSync(path.join(cfg.output, region.scene)));
    const todo = keys.filter(([x, y]) => { const c = state.chunks[`${x}-${y}`], f = path.join(dir, `${x}-${y}.png`); return !(c?.hash && c.scene === sceneHash && fs.existsSync(f) && sha(fs.readFileSync(f)) === c.hash); });
    session.resumed += keys.length - todo.length;
    if (!todo.length) continue;
    if (n >= stopAfter) { session.stoppedEarly = true; console.log('stopping early (simulated interruption)'); process.exitCode = 3; break; }
    const t0 = performance.now(), page = await openRegion(region), build = (performance.now() - t0) / 1000;
    for (const [x, y] of todo) {
      const w = Math.min(chunk, layout.width - x), h = Math.min(chunk, layout.height - y), file = path.join(dir, `${x}-${y}.png`);
      await (await grab(page, x, y, w, h)).toFile(file + '.tmp'); fs.renameSync(file + '.tmp', file);
      state.chunks[`${x}-${y}`] = {hash: sha(fs.readFileSync(file)), scene: sceneHash, region: region.key}; session.rendered++;
    }
    state.regions[region.key] = {counts: (await page.evaluate(() => window.sceneReady)).counts, sceneBuildSeconds: build, seconds: (performance.now() - t0) / 1000};
    if (!state.renderer) state.renderer = await page.evaluate(() => window.sceneReady.renderer);
    await page.close(); n++; session.regions++; save();
    console.log(`region ${region.key} ${todo.length} chunks ${state.regions[region.key].seconds.toFixed(1)}s (build ${build.toFixed(1)}s) peak ${(peak / 2 ** 30).toFixed(2)} GiB`);
  }
  // Continuity across a region boundary: render a 2048² window centred on an interior region corner with the
  // scene of the region to its upper-left, then compare with the chunks the neighbouring regions produced.
  if (args.includes('--seam')) {
    const R = cfg.regionChunks * chunk, cands = layout.regions.filter(r => r.scene && r.rect[0] + R < layout.width && r.rect[1] + R < layout.height);
    const pick = cands.find(r => opt('--seam-region', null) ? r.key === opt('--seam-region') : true), cx = pick.rect[0] + R, cy = pick.rect[1] + R, x0 = cx - 1024, y0 = cy - 1024;
    const page = await openRegion(pick); await (await grab(page, x0, y0, 2048, 2048)).toFile(path.join(dir, 'seam-reference.png')); await page.close();
    const parts = []; for (let y = y0; y < y0 + 2048; y += chunk) for (let x = x0; x < x0 + 2048; x += chunk) parts.push({input: path.join(dir, `${x}-${y}.png`), left: x - x0, top: y - y0});
    const stitched = await sharp({create: {width: 2048, height: 2048, channels: 3, background: '#000'}}).composite(parts).removeAlpha().raw().toBuffer(), ref = await sharp(path.join(dir, 'seam-reference.png')).removeAlpha().raw().toBuffer();
    let tot = 0, max = 0, changed = 0, seam = 0, seamN = 0, core = 0, coreN = 0, coreChanged = 0, coreMax = 0; const vis = Buffer.alloc(ref.length);
    for (let i = 0; i < ref.length; i++) { const d = Math.abs(ref[i] - stitched[i]); tot += d; if (d > max) max = d; if (d) changed++; vis[i] = Math.min(255, d * 10); const p = i / 3 | 0, px = p % 2048, py = p / 2048 | 0; if (Math.abs(px - 1024) < 4 || Math.abs(py - 1024) < 4) { seam += d; seamN++; } if (Math.abs(px - 1024) < 512 && Math.abs(py - 1024) < 512) { core += d; coreN++; if (d) coreChanged++; if (d > coreMax) coreMax = d; } }
    await sharp(vis, {raw: {width: 2048, height: 2048, channels: 3}}).png().toFile(path.join(dir, 'seam-difference-x10.png'));
    state.seamComparison = {window: [x0, y0, 2048, 2048], regionCorner: [cx, cy], referenceScene: pick.key, meanAbsoluteChannelDifference: tot / ref.length, maxChannelDifference: max, changedChannelFraction: changed / ref.length, seamBandMeanAbsoluteDifference: seam / seamN, core512: {meanAbsoluteChannelDifference: core / coreN, changedChannelFraction: coreChanged / coreN, maxChannelDifference: coreMax}, note: 'Reference rendered from one region scene; stitched chunks come from four different region scenes. core512 = ±512 px around the region corner, inside every scene margin; the outer ring of the 2048 window lies beyond the reference scene margin and is expected to differ (no source geometry there in that scene).'};
    console.log(JSON.stringify(state.seamComparison));
  }
  const all = layout.regions.flatMap(r => { const k = []; for (let y = r.rect[1]; y < r.rect[1] + r.rect[3]; y += chunk) for (let x = r.rect[0]; x < r.rect[0] + r.rect[2]; x += chunk) k.push(`${x}-${y}`); return k; });
  state.complete = all.every(k => state.chunks[k]?.hash || state.chunks[k]?.empty);
  state.externalRequests = external;
} finally {
  clearInterval(sampler); session.seconds = (performance.now() - start) / 1000; session.peakProcessTreeRssBytes = peak;
  state.hardware = 'Apple M3, 8 GiB unified memory, Chrome WebGL via ANGLE/Metal';
  save(); await Promise.race([browser?.close(), new Promise(r => setTimeout(r, 5000))]); server.close();
  console.log(JSON.stringify({mode, rendered: session.rendered, resumed: session.resumed, regions: session.regions, seconds: session.seconds.toFixed(1), peakGiB: (peak / 2 ** 30).toFixed(2), complete: state.complete}));
  setTimeout(() => process.exit(), 200);
}
