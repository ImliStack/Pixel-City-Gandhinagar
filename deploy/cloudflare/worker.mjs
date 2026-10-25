// Cloudflare deployment: one Worker serves
//   /api/social/*        → Durable Object "city" (presence, visits, daily-game board)
//   /maps/*, /map/*      → R2 bucket TILES (Deep Zoom tiles, metadata.json, motion.json, minimap)
//   everything else      → static viewer build (ASSETS, from npm run build:deploy)
// The DO keeps live presence in memory and persists visits + today's board in DO storage, and
// mirrors the visit total to KV (optional VISITS binding) for cheap reads by other tools.
import { createRoom, handle } from '../../apps/viewer/shared/social-core.mjs';

export class CityRoom {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.room = null;
    ctx.blockConcurrencyWhile(async () => { this.room = createRoom({ state: await ctx.storage.get('room') }); });
  }
  async fetch(request) {
    const url = new URL(request.url);
    const result = await handle(this.room, request.method, url.pathname, () => request.text());
    if (result.dirty) {
      await this.ctx.storage.put('room', this.room.toJSON());
      if (this.env.VISITS) this.ctx.waitUntil(this.env.VISITS.put('total', String(this.room.visits)));
    }
    return json(result.status, result.json);
  }
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const TYPES = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', json: 'application/json', dzi: 'application/xml', txt: 'text/plain; charset=utf-8' };

// Tiles are content-addressed by map version, so they cache for a year; metadata/motion/index revalidate hourly.
async function tile(request, env, ctx, key) {
  if (!env.TILES) return json(404, { error: 'tiles not configured' });
  if (key.includes('..')) return json(400, { error: 'bad path' });
  const cache = caches.default, hit = await cache.match(request);
  if (hit) return hit;
  const object = await env.TILES.get(key);
  if (!object) return new Response('not found', { status: 404 });
  const ext = key.split('.').pop().toLowerCase(), immutable = /_files\//.test(key) || ext === 'webp';
  const response = new Response(object.body, { headers: {
    'content-type': TYPES[ext] || 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
    etag: object.httpEtag,
  } });
  ctx.waitUntil(cache.put(request, response.clone()));
  return response;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url), path = decodeURIComponent(url.pathname);
    if (path.startsWith('/api/social/')) return env.CITY_ROOM.get(env.CITY_ROOM.idFromName('gandhinagar-city')).fetch(request);
    if ((path.startsWith('/maps/') || path.startsWith('/map/')) && (request.method === 'GET' || request.method === 'HEAD')) return tile(request, env, ctx, path.slice(1));
    return env.ASSETS ? env.ASSETS.fetch(request) : json(404, { error: 'not found' });
  },
};
