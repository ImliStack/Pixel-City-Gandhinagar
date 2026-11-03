import test from 'node:test';
import assert from 'node:assert/strict';
import { describe, fromOpenMeteo, isWet, pickLayer, weatherUrl } from '../apps/viewer/shared/weather.mjs';
import worker from '../deploy/cloudflare/worker.mjs';

const sample = (over = {}) => ({ current: { time: '2026-07-14T15:00', temperature_2m: 29.6, precipitation: 2.1, weather_code: 63, cloud_cover: 96, is_day: 1, wind_speed_10m: 18.2, ...over } });

test('weather codes map to labels and the matching layer', () => {
  assert.equal(describe(0).label, 'Clear');
  assert.equal(describe(95).label, 'Thunderstorm');
  assert.ok(isWet(61) && isWet(81) && isWet(95) && !isWet(3));
  assert.equal(pickLayer({ code: 63, isDay: true, cloud: 90 }, 7), 'monsoon', 'rain → monsoon');
  assert.equal(pickLayer({ code: 3, isDay: true, cloud: 95 }, 8), 'monsoon', 'heavy overcast in the monsoon season');
  assert.equal(pickLayer({ code: 3, isDay: true, cloud: 95 }, 4), 'A', 'overcast in April stays summer');
  assert.equal(pickLayer({ code: 0, isDay: true, cloud: 0 }, 1), 'winter');
  assert.equal(pickLayer({ code: 61, isDay: false, cloud: 90 }, 7), 'night', 'dark wins');
  assert.match(weatherUrl(), /latitude=23\.2156&longitude=72\.6369/);
});

test('Open-Meteo response is reduced to a small, source-labelled record', () => {
  const w = fromOpenMeteo(sample(), Date.UTC(2026, 6, 14, 9, 30));
  assert.deepEqual([w.layer, w.temp, w.label, w.isDay, w.wind], ['monsoon', 30, 'Rain', true, 18]);
  assert.match(w.source, /Open-Meteo/);
  assert.throws(() => fromOpenMeteo({}));
});

test('Worker /api/weather calls upstream once and serves the cached copy after', async () => {
  const store = new Map(); let calls = 0;
  globalThis.caches = { default: { match: async (r) => store.get(r.url)?.clone(), put: async (r, res) => { store.set(r.url, res); } } };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { calls++; assert.match(String(url), /api\.open-meteo\.com/); return new Response(JSON.stringify(sample()), { status: 200 }); };
  try {
    const ctx = { waitUntil: (p) => p };
    const a = await worker.fetch(new Request('https://x.dev/api/weather'), {}, ctx);
    assert.equal(a.status, 200); assert.equal((await a.json()).layer, 'monsoon');
    assert.match(a.headers.get('cache-control'), /max-age=600/);
    await worker.fetch(new Request('https://x.dev/api/weather?x=1'), {}, ctx);
    assert.equal(calls, 1, 'second request is served from cache');
    globalThis.fetch = async () => new Response('down', { status: 500 }); store.clear();
    assert.equal((await worker.fetch(new Request('https://x.dev/api/weather'), {}, ctx)).status, 503);
  } finally { globalThis.fetch = realFetch; delete globalThis.caches; }
});
