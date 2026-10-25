// Cloudflare deployment of the presence + daily-game channel.
// Worker routes /api/social/* to one Durable Object ("city"); everything else is served by Pages/R2.
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/social/')) return env.ASSETS ? env.ASSETS.fetch(request) : json(404, { error: 'not found' });
    // Same-origin only: the viewer and API share a host, so no CORS is offered.
    const stub = env.CITY_ROOM.get(env.CITY_ROOM.idFromName('gandhinagar-city'));
    return stub.fetch(request);
  },
};
