// Active-city (Gandhinagar capital) render, export and viewer-state checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import sharp from 'sharp';
import ts from 'typescript';
import {imageToGround, worldToImage, project} from '../tools/render/coordinates.mjs';
// Pinned to the capital pilot; the full city has its own suite (tests/city.test.mjs).
const active = {cityConfig: 'config/cities/gandhinagar.json', dataConfig: 'config/cities/gandhinagar-data.json'};
const cfg = JSON.parse(fs.readFileSync(active.cityConfig)), dataCfg = JSON.parse(fs.readFileSync(active.dataConfig));
const job = mode => JSON.parse(fs.readFileSync(`${cfg.output}/render-${mode}/job.json`));
const A = job('A'), t = A.scene.transform, scene = JSON.parse(fs.readFileSync(`${cfg.output}/scene.json`));
const mapDir = `outputs/maps/${cfg.mapId}`, meta = JSON.parse(fs.readFileSync(`${mapDir}/metadata.json`));
const pilot = JSON.parse(fs.readFileSync(cfg.input));

test('Cached OSM extract matches recorded provenance hash', () => {
  const prov = JSON.parse(fs.readFileSync(cfg.raw.replace('.json', '.provenance.json')));
  const hash = crypto.createHash('sha256').update(fs.readFileSync(cfg.raw)).digest('hex');
  assert.equal(hash, prov.sha256);
  assert.equal(pilot.sourceHash, hash);
  assert.deepEqual(prov.bbox, dataCfg.bbox);
});

test('Camera transform: centre, round trip and real landmark position', () => {
  const c = worldToImage([...cfg.centerWorld, 0], t);
  assert.ok(Math.hypot(c[0] - cfg.width / 2, c[1] - cfg.height / 2) < 1e-6);
  for (const p of [[0, 0], [cfg.width, cfg.height], [1234.5, 4321.25]]) {
    const g = imageToGround(p, t), q = worldToImage(g, t);
    assert.ok(Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-8);
  }
  // A ground point raised by z moves straight up the image by z·cos(elevation)·scale pixels.
  const lo = worldToImage([100, 200, 0], t), hi = worldToImage([100, 200, 10], t);
  assert.ok(Math.abs(lo[0] - hi[0]) < 1e-9);
  assert.ok(Math.abs((lo[1] - hi[1]) - 10 * Math.cos(cfg.camera.elevation * Math.PI / 180) * cfg.pixelsPerMetre) < 1e-9);
  // Vithalbhai Patel Bhavan anchor stays at its OSM footprint centroid (≈23.2192 N, 72.6569 E, Sector 10).
  const poi = meta.pois.find(p => p.id === 'vidhan-sabha');
  assert.ok(Math.abs(poi.lat - 23.2192) < 0.002 && Math.abs(poi.lon - 72.6569) < 0.002);
  const ground = project(poi.lon, poi.lat, pilot.origin);
  assert.ok(Math.hypot(ground[0] - poi.x, ground[1] - poi.y) < 0.01);
});

test('Rendered ground extent stays inside the acquired OSM bbox', () => {
  const bounds = pilot.bounds.world;
  for (const p of [[0, 0], [cfg.width, 0], [0, cfg.height], [cfg.width, cfg.height]]) {
    const [x, y] = imageToGround(p, t);
    assert.ok(x > bounds[0] && x < bounds[2] && y > bounds[1] && y < bounds[3], `corner ${p} -> ${x},${y}`);
  }
});

test('Geometry: holes kept, no duplicate footprints, focal part replacement disclosed', () => {
  assert.ok(scene.buildings.some(b => b.geometry.coordinates.length > 1), 'at least one courtyard hole survives');
  const keys = scene.buildings.map(b => JSON.stringify(b.geometry.coordinates));
  assert.equal(new Set(keys).size, keys.length);
  const audit = JSON.parse(fs.readFileSync(`${cfg.processed}/audit.json`));
  const part = audit.overlaps.find(o => o.ids.includes(cfg.focalAsset.sourceId));
  assert.ok(part?.includesBuildingPart);
  assert.ok(A.scene.counts.replacedParts.every(id => part.ids.includes(id)));
});

test('Chunk jobs complete, offline, model-free, and seams within disclosed limits', () => {
  for (const mode of ['A', 'B', 'source']) {
    const j = job(mode);
    assert.equal(j.complete, true);
    assert.equal(Object.keys(j.completed).length, (cfg.width / cfg.chunkSize) * (cfg.height / cfg.chunkSize));
    assert.deepEqual(j.externalRequests, []);
    assert.equal(j.scene.model, null);
    assert.ok(j.seamComparison.meanAbsoluteChannelDifference < 0.05);
    assert.ok(j.seamComparison.changedChannelFraction < 0.005);
    for (const [key, hash] of Object.entries(j.completed))
      assert.equal(crypto.createHash('sha256').update(fs.readFileSync(`${cfg.output}/render-${mode}/${key}.png`)).digest('hex'), hash);
  }
});

test('Interrupted render resumed to chunks identical to an uninterrupted run', () => {
  const r = JSON.parse(fs.readFileSync(`${cfg.output}/resume-test.json`));
  assert.equal(r.sessions[0].stoppedEarly, true);
  assert.equal(r.sessions[1].resumed, r.interruptedAfterChunks);
  assert.equal(r.chunksBitIdenticalToPreviousUninterruptedRun, r.totalChunks);
});

test('DZI pyramid: metadata, level count, tile addressing and pixel content', async () => {
  for (const layer of Object.values(meta.layers)) {
    const xml = fs.readFileSync(`${mapDir}/${layer.dzi}`, 'utf8');
    assert.match(xml, /Format="webp"/); assert.match(xml, /Overlap="1"/); assert.match(xml, /TileSize="512"/);
    assert.match(xml, new RegExp(`Width="${cfg.width}"`)); assert.ok(!fs.existsSync(`${mapDir}/${layer.dzi}.dzi`));
    const files = `${mapDir}/${layer.dzi.replace('.dzi', '_files')}`, max = Math.ceil(Math.log2(Math.max(cfg.width, cfg.height)));
    assert.ok(fs.existsSync(`${files}/${max}`) && !fs.existsSync(`${files}/${max + 1}`));
    const n = Math.ceil(cfg.width / 512);
    assert.equal(fs.readdirSync(`${files}/${max}`).filter(f => f.endsWith('.webp')).length, n * n);
    assert.equal(fs.readdirSync(`${files}/0`).length, 1);
  }
  // Interior tile (col 5, row 7) holds pixels [5·512−1, 7·512−1] .. +514 of the stitched render.
  const tile = await sharp(`${mapDir}/A_files/13/5_7.webp`).removeAlpha().raw().toBuffer({resolveWithObject: true});
  assert.deepEqual([tile.info.width, tile.info.height], [514, 514]);
  const ref = await sharp(`${cfg.output}/render-A/map.png`, {limitInputPixels: false}).extract({left: 5 * 512 - 1, top: 7 * 512 - 1, width: 514, height: 514}).removeAlpha().raw().toBuffer();
  let diff = 0; for (let i = 0; i < ref.length; i++) diff += Math.abs(ref[i] - tile.data[i]);
  assert.ok(diff / ref.length < 4, `mean WebP error ${diff / ref.length}`);
  const edge = await sharp(`${mapDir}/A_files/13/0_0.webp`).metadata();
  assert.deepEqual([edge.width, edge.height], [513, 513]);
});

test('Viewer metadata: POIs inside image, coverage polygon, honest art status', () => {
  assert.equal(meta.artAvailable, false);
  assert.match(meta.artNote, /not met/);
  assert.equal(meta.coverage.polygon.length, 4);
  for (const p of meta.pois) assert.ok(p.image[0] >= 0 && p.image[1] >= 0 && p.image[0] <= cfg.width && p.image[1] <= cfg.height, p.id);
  assert.ok(meta.pois.filter(p => p.curated).length >= 5);
  assert.match(meta.attribution, /OpenStreetMap/);
});

test('URL view state: v2 round trip and v1 legacy restore', async () => {
  const src = ts.transpileModule(fs.readFileSync('apps/viewer/src/state.ts', 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
  const {readViewState, writeViewState} = await import(`data:text/javascript,${encodeURIComponent(src)}`);
  const s = {version: 2, map: cfg.mapId, imageVersion: meta.version, layer: 'night', cx: 2063.6, cy: 5074.3, zoom: 1, selected: 'vidhan-sabha', filters: ['hospital', 'fuel']};
  const back = readViewState(writeViewState(s), 'x');
  assert.deepEqual({...back, legacyViewportZoom: undefined}, {...s, legacyViewportZoom: undefined});
  assert.equal(back.legacyViewportZoom, false);
  const legacy = readViewState('#v=1&cx=10&cy=20&z=3.5&poi=hawa-mahal', 'jaipur');
  assert.equal(legacy.map, 'jaipur'); assert.equal(legacy.legacyViewportZoom, true); assert.equal(legacy.layer, 'A');
  assert.equal(readViewState('#v=2&cx=NaN&cy=1&z=1', 'x'), null);
  assert.equal(readViewState('#v=3&cx=1&cy=1&z=1', 'x'), null);
});
