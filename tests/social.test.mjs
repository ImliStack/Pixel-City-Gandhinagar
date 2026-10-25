import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { clueTiles, dailyPuzzle, groundMeters, istDay, puzzlePool, scoreFor, MAX_SCORE } from '../apps/viewer/shared/daily.mjs';
import { avatarFor } from '../apps/viewer/shared/avatar.mjs';
import { createRoom, handle } from '../apps/viewer/shared/social-core.mjs';
import worker, { CityRoom } from '../deploy/cloudflare/worker.mjs';

const metaPath = 'outputs/maps/gandhinagar-city/metadata.json';
const fixture = [
  { id: 'a', name: 'Akshardham', kind: 'landmark', curated: true, image: [100, 100] },
  { id: 'b', name: 'Sarita Udyan', kind: 'park', category: 'park', image: [900, 400] },
  { id: 'c', name: 'Mahatma Mandir', kind: 'building', category: 'attraction', image: [300, 700] },
  { id: 'd', name: 'Unnamed hall', kind: 'building', unnamed: true, image: [1, 1] },
  { id: 'e', name: 'Sector 7 Road', kind: 'street', image: [5, 5] },
];

test('daily puzzle is deterministic per IST day and uses named places', () => {
  assert.equal(istDay(Date.UTC(2026, 9, 25, 18, 29)), '2026-10-25');
  assert.equal(istDay(Date.UTC(2026, 9, 25, 18, 31)), '2026-10-26'); // 00:01 IST
  assert.deepEqual(puzzlePool(fixture).map((p) => p.id), ['a', 'b', 'c']);
  const one = dailyPuzzle(fixture, '2026-10-26'), two = dailyPuzzle(fixture, '2026-10-26');
  assert.deepEqual(one.map((p) => p.id), two.map((p) => p.id));
  assert.equal(one[0].id, 'a', 'round 1 is a curated landmark');
  assert.equal(new Set(one.map((p) => p.id)).size, 3);
});

test('daily puzzle varies across days on the real map', { skip: !fs.existsSync(metaPath) }, () => {
  const meta = JSON.parse(fs.readFileSync(metaPath));
  const days = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29'].map((d) => dailyPuzzle(meta.pois, d).map((p) => p.id).join());
  assert.ok(new Set(days).size >= 3);
  assert.ok(puzzlePool(meta.pois).length > 100);
});

test('ground distance and score', () => {
  const t = { scale: 5, up: [-0.346, 0.742, 0.574] };
  assert.equal(Math.round(groundMeters([0, 0], [500, 0], t)), 100);
  assert.ok(Math.abs(groundMeters([0, 0], [0, 409.6], t) - 100) < 1, 'y is foreshortened by the camera elevation');
  assert.equal(scoreFor(10), MAX_SCORE);
  assert.ok(scoreFor(500) > scoreFor(2000));
  assert.equal(scoreFor(NaN), 0);
});

test('clue tiles cover the crop with DZI overlap', () => {
  const tiles = clueTiles({ width: 4096, height: 4096, tileSize: 512, overlap: 1 }, [2048, 2048], 12, 200);
  assert.deepEqual(tiles.map((t) => t.file).sort(), ['12/3_3', '12/3_4', '12/4_3', '12/4_4']);
  const t = tiles.find((x) => x.file === '12/4_4');
  assert.equal(t.left, 4 * 512 - 1 - (2048 - 100));
});

test('avatars are deterministic 12×12, symmetric and varied', () => {
  const a = avatarFor('abc12345'), b = avatarFor('abc12345');
  assert.deepEqual(a, b);
  assert.equal(a.rows.length, 12);
  for (const row of a.rows) { assert.equal(row.length, 12); assert.equal(row, [...row].reverse().join('')); }
  const unique = new Set(Array.from({ length: 40 }, (_, i) => JSON.stringify(avatarFor(`visitor${i}x`))));
  assert.ok(unique.size > 30);
});

test('room tracks presence, visits and expiry without storing anything identifying', () => {
  let t = 1_800_000_000_000;
  const room = createRoom({ ttl: 10_000, now: () => t });
  assert.equal(room.beat({ id: 'BAD' }).status, 400);
  room.beat({ id: 'aaaaaaaa', hello: true });
  const s = room.beat({ id: 'bbbbbbbb', hello: true }).json;
  assert.equal(s.onlineCount, 2); assert.equal(s.visits, 2); assert.equal(s.online[0], 'bbbbbbbb', 'viewer first');
  room.beat({ id: 'bbbbbbbb' });
  assert.equal(room.snapshot('x').visits, 2, 'only hello counts a visit');
  t += 11_000;
  assert.equal(room.beat({ id: 'bbbbbbbb' }).json.onlineCount, 1, 'silent tab expires');
  assert.equal(room.beat({ id: 'bbbbbbbb', bye: true }).json.onlineCount, 0);
  assert.deepEqual(Object.keys(room.toJSON()).sort(), ['day', 'players', 'visits']);
});

test('room game: first guess per round, spoiler-free reveals, daily reset', () => {
  let t = Date.UTC(2026, 9, 26, 6);
  const room = createRoom({ now: () => t });
  const day = istDay(t);
  room.beat({ id: 'player01', guess: { day, round: 0, x: 10, y: 20, score: 4000 } });
  room.beat({ id: 'player01', guess: { day, round: 0, x: 99, y: 99, score: 5000 } });
  room.beat({ id: 'player01', guess: { day: '1999-01-01', round: 1, x: 1, y: 1, score: 5000 } });
  room.beat({ id: 'player01', guess: { day, round: 9, x: 1, y: 1, score: 5000 } });
  let s = room.beat({ id: 'player02' }).json;
  assert.equal(s.game.board[0].total, 4000);
  assert.deepEqual(s.game.guesses[0], [], 'no reveal before guessing');
  s = room.beat({ id: 'player02', guess: { day, round: 0, x: 5, y: 5, score: 99999 } }).json;
  assert.deepEqual(s.game.guesses[0], [{ id: 'player01', x: 10, y: 20, score: 4000 }]);
  assert.equal(s.game.mine[0].score, 5000, 'score clamped');
  t += 86400e3;
  assert.equal(room.beat({ id: 'player02' }).json.game.players, 0);
});

test('room state round-trips through persistence and handle() validates requests', async () => {
  const room = createRoom();
  room.beat({ id: 'persist1', hello: true });
  const copy = createRoom({ state: JSON.parse(JSON.stringify(room.toJSON())) });
  assert.equal(copy.visits, 1);
  assert.equal((await handle(copy, 'GET', '/api/social/beat', async () => '')).status, 405);
  assert.equal((await handle(copy, 'POST', '/api/social/nope', async () => '')).status, 404);
  assert.equal((await handle(copy, 'POST', '/api/social/beat', async () => '{oops')).status, 400);
  assert.equal((await handle(copy, 'POST', '/api/social/beat', async () => 'x'.repeat(5000))).status, 413);
});

test('Cloudflare worker routes to the Durable Object and persists', async () => {
  const store = new Map(), kv = new Map();
  const ctx = { storage: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); } }, blockConcurrencyWhile: async (fn) => fn(), waitUntil: () => {} };
  const env = { VISITS: { put: async (k, v) => kv.set(k, v) } };
  const object = new CityRoom(ctx, env);
  await new Promise((r) => setTimeout(r, 0));
  env.CITY_ROOM = { idFromName: (n) => n, get: () => object };
  const res = await worker.fetch(new Request('https://x.dev/api/social/beat', { method: 'POST', body: JSON.stringify({ id: 'worker01', hello: true }) }), env);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).visits, 1);
  assert.equal(store.get('room').visits, 1);
  assert.equal(kv.get('total'), '1');
  assert.equal((await worker.fetch(new Request('https://x.dev/other'), env)).status, 404);
});

test('Cloudflare worker serves tiles from R2 with cache headers and falls back to assets', async () => {
  const store = new Map();
  globalThis.caches = { default: { match: async (r) => store.get(r.url), put: async (r, res) => { store.set(r.url, res); } } };
  const objects = { 'maps/gandhinagar-city/A_files/16/3_4.webp': 'WEBP', 'maps/gandhinagar-city/metadata.json': '{}' };
  const env = {
    TILES: { get: async (k) => (k in objects ? { body: objects[k], httpEtag: '"e"' } : null) },
    ASSETS: { fetch: async () => new Response('index', { status: 200 }) },
  };
  const ctx = { waitUntil: (p) => p };
  const tile = await worker.fetch(new Request('https://x.dev/maps/gandhinagar-city/A_files/16/3_4.webp'), env, ctx);
  assert.equal(tile.status, 200);
  assert.equal(tile.headers.get('content-type'), 'image/webp');
  assert.match(tile.headers.get('cache-control'), /immutable/);
  const meta = await worker.fetch(new Request('https://x.dev/maps/gandhinagar-city/metadata.json'), env, ctx);
  assert.equal(meta.headers.get('content-type'), 'application/json');
  assert.match(meta.headers.get('cache-control'), /max-age=3600/);
  assert.equal((await worker.fetch(new Request('https://x.dev/maps/nope.webp'), env, ctx)).status, 404);
  assert.equal(await (await worker.fetch(new Request('https://x.dev/'), env, ctx)).text(), 'index');
  delete globalThis.caches;
});
