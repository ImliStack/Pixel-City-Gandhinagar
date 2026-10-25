// Full-city (region-streamed) render and export checks. Skipped until the city layer A export exists.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {imageToGround, worldToImage} from '../tools/render/coordinates.mjs';
const cfgPath = 'config/cities/gandhinagar-city.json', cfg = JSON.parse(fs.readFileSync(cfgPath));
const mapDir = `outputs/maps/${cfg.mapId}`, ready = fs.existsSync(`${mapDir}/metadata.json`);
const opts = {skip: ready ? false : 'city export not built yet'};
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const load = f => JSON.parse(fs.readFileSync(f));

test('Tiled OSM acquisition: every tile and the merge match recorded hashes', opts, () => {
  const prov = load(cfg.raw.replace('.json', '.provenance.json'));
  assert.equal(sha(fs.readFileSync(cfg.raw)), prov.sha256);
  const dir = cfg.raw.replace('.json', '-tiles');
  for (const t of prov.tiles) assert.equal(sha(fs.readFileSync(`${dir}/${t.tile}.overpass.json`)), t.sha256, t.tile);
  assert.equal(load(cfg.input).sourceHash, prov.sha256);
});

test('Global lattice: chunk-aligned size, centre and the city outline inside the image', opts, () => {
  const L = load(`${cfg.output}/layout.json`), meta = load(`${mapDir}/metadata.json`), t = meta.transform;
  assert.equal(L.width % cfg.chunkSize, 0); assert.equal(L.height % cfg.chunkSize, 0);
  const c = worldToImage([...L.centerWorld, 0], t); assert.ok(Math.hypot(c[0] - L.width / 2, c[1] - L.height / 2) < 1e-6);
  for (const p of [[0, 0], [L.width, L.height], [12345.5, 23456.25]]) { const q = worldToImage(imageToGround(p, t), t); assert.ok(Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-6); }
  const ext = load(cfg.input).features.find(f => f.id === cfg.extentFeature);
  for (const p of ext.geometry.coordinates[0]) { const [x, y] = worldToImage([...p, 0], t); assert.ok(x > 0 && y > 0 && x < L.width && y < L.height); }
  // Regions tile the image exactly once.
  let area = 0; for (const r of L.regions) area += r.rect[2] * r.rect[3]; assert.equal(area, L.width * L.height);
});

test('Every chunk is rendered and hash-verified, or explicitly empty outside the OSM extract', opts, () => {
  const L = load(`${cfg.output}/layout.json`);
  for (const mode of Object.keys(load(`${mapDir}/metadata.json`).layers)) {
    const job = load(`${cfg.output}/render-${mode}/job.json`); assert.equal(job.complete, true, mode); assert.deepEqual(job.externalRequests, []);
    for (const r of L.regions) for (let y = r.rect[1]; y < r.rect[1] + r.rect[3]; y += cfg.chunkSize) for (let x = r.rect[0]; x < r.rect[0] + r.rect[2]; x += cfg.chunkSize) {
      const c = job.chunks[`${x}-${y}`]; assert.ok(c, `${mode} ${x}-${y}`);
      if (!r.scene) { assert.equal(c.empty, true); continue; }
      if (mode === 'A') assert.equal(sha(fs.readFileSync(`${cfg.output}/render-${mode}/${x}-${y}.png`)), c.hash, `${x}-${y}`);
    }
  }
});

test('Region-boundary continuity stays within disclosed limits (layer A)', opts, () => {
  const s = load(`${cfg.output}/render-A/job.json`).seamComparison;
  assert.ok(s, 'seam comparison recorded');
  assert.ok(s.core512.meanAbsoluteChannelDifference < 0.05, `core mean ${s.core512.meanAbsoluteChannelDifference}`);
  assert.ok(s.seamBandMeanAbsoluteDifference < 0.1, `seam band ${s.seamBandMeanAbsoluteDifference}`);
  assert.ok(s.core512.changedChannelFraction < 0.03, `core changed ${s.core512.changedChannelFraction}`);
});

test('Chunk-built DZI: geometry, addressing and pixels match the chunks', opts, async () => {
  const L = load(`${cfg.output}/layout.json`), xml = fs.readFileSync(`${mapDir}/A.dzi`, 'utf8'), max = Math.ceil(Math.log2(Math.max(L.width, L.height)));
  assert.match(xml, new RegExp(`Width="${L.width}"`)); assert.match(xml, new RegExp(`Height="${L.height}"`)); assert.ok(!fs.existsSync(`${mapDir}/A.dzi.dzi`));
  assert.equal(fs.readdirSync(`${mapDir}/A_files/${max}`).length, Math.ceil(L.width / 512) * Math.ceil(L.height / 512));
  assert.equal(fs.readdirSync(`${mapDir}/A_files/0`).length, 1);
  // Interior tile straddling four chunks.
  const r = L.regions.find(q => q.scene && q.rect[0] > 0 && q.rect[1] > 0), col = (r.rect[0] + 1024) / 512 - 1, row = (r.rect[1] + 1024) / 512 - 1;
  const tile = await sharp(`${mapDir}/A_files/${max}/${col}_${row}.webp`).removeAlpha().raw().toBuffer({resolveWithObject: true});
  assert.deepEqual([tile.info.width, tile.info.height], [514, 514]);
  const x0 = col * 512 - 1, y0 = row * 512 - 1, parts = [];
  for (const [cx, cy] of [[x0 - x0 % 1024, y0 - y0 % 1024], [x0 - x0 % 1024 + 1024, y0 - y0 % 1024], [x0 - x0 % 1024, y0 - y0 % 1024 + 1024], [x0 - x0 % 1024 + 1024, y0 - y0 % 1024 + 1024]]) parts.push({input: `${cfg.output}/render-A/${cx}-${cy}.png`, left: cx - (x0 - x0 % 1024), top: cy - (y0 - y0 % 1024)});
  const big = await sharp({create: {width: 2048, height: 2048, channels: 3, background: '#000'}}).composite(parts).png().toBuffer();
  // Exact checks: the tile is the WebP encoding of exactly these source pixels, and no ±1 px shift fits better.
  const crop = sharp(big).extract({left: x0 % 1024, top: y0 % 1024, width: 514, height: 514}).removeAlpha();
  const fresh = await sharp(await crop.clone().webp({quality: 88, effort: 4, smartSubsample: true}).toBuffer()).removeAlpha().raw().toBuffer();
  assert.ok(fresh.equals(tile.data), 'tile equals a fresh WebP encode of the chunk pixels');
  const raw = await sharp(big).removeAlpha().raw().toBuffer(), err = (sx, sy) => { let d = 0; for (let y = 1; y < 513; y++) for (let x = 1; x < 513; x++) for (let c = 0; c < 3; c++) d += Math.abs(raw[((y0 % 1024 + y + sy) * 2048 + (x0 % 1024 + x + sx)) * 3 + c] - tile.data[(y * 514 + x) * 3 + c]); return d; };
  const e0 = err(0, 0); for (const [sx, sy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) assert.ok(e0 < err(sx, sy), `shift ${sx},${sy}`);
});

test('City metadata: categories, landmarks and POIs inside the image', opts, () => {
  const meta = load(`${mapDir}/metadata.json`);
  for (const p of meta.pois) assert.ok(p.image[0] >= 0 && p.image[1] >= 0 && p.image[0] <= meta.width && p.image[1] <= meta.height, p.id);
  const ids = meta.categories.map(c => c.id);
  for (const want of ['fuel', 'hospital', 'school', 'bank', 'worship']) assert.ok(ids.includes(want), want);
  for (const id of ['akshardham', 'dandi-kutir', 'mahatma-mandir', 'vidhan-sabha']) assert.ok(meta.pois.some(p => p.id === id), id);
  const job = load(`${cfg.output}/render-A/job.json`), counts = Object.values(job.regions).map(r => r.counts);
  assert.ok(counts.reduce((a, c) => a + (c.landmarks || 0), 0) >= 2, 'authored landmarks built');
  assert.equal(meta.artAvailable, false);
});
