// Visitor presence (with live view positions), visit counter, the shared daily-game board and
// scavenger-hunt completion counts.
// One plain-JS room used by the Vite dev middleware (in memory) and by the Cloudflare
// Durable Object (persisted with toJSON/fromJSON). Privacy: only random anonymous ids from the
// browser are kept; no IP, user agent or location is read or stored. A "position" is only where on
// the map image a tab is looking, never where the visitor is.
import { istDay, MAX_SCORE, ROUNDS } from './daily.mjs';

export const BEAT_MS = 4000;
const ID = /^[a-z0-9]{8,32}$/;
const MAX_PLAYERS = 2000;
const MAX_ONLINE_LISTED = 12;
const MAX_CURSORS = 30;
const HUNT = /^[a-z0-9-]{2,24}$/;

export function createRoom({ ttl = 15000, now = Date.now, state } = {}) {
  let visits = state?.visits || 0;
  const seen = new Map(); // session id -> last beat ms (not persisted)
  let day = state?.day || istDay(now());
  let players = new Map(Object.entries(state?.players || {})); // id -> [{x,y,score}|null × ROUNDS]
  const positions = new Map(); // session id -> {x,y,z} view centre in image px (not persisted)
  const hunts = { ...(state?.hunts || {}) }; // hunt id -> completions (persisted)
  const finished = new Set(); // `${session}:${hunt}` already counted (not persisted)

  const prune = () => {
    const t = now();
    for (const [id, last] of seen) if (t - last > ttl) { seen.delete(id); positions.delete(id); }
    const today = istDay(t);
    if (today !== day) { day = today; players = new Map(); }
  };

  function beat(body) {
    if (!body || typeof body !== 'object' || !ID.test(body.id)) return { status: 400, json: { error: 'bad id' } };
    prune();
    let dirty = false;
    if (body.hello === true) { visits++; dirty = true; }
    if (body.bye === true) { seen.delete(body.id); positions.delete(body.id); } else seen.set(body.id, now());
    const p = body.pos;
    if (p && typeof p === 'object' && [p.x, p.y, p.z].every(Number.isFinite) && p.z > 0 && p.z < 100)
      positions.set(body.id, { x: Math.round(Math.max(-1e6, Math.min(1e6, p.x))), y: Math.round(Math.max(-1e6, Math.min(1e6, p.y))), z: +p.z.toFixed(4) });
    // A hunt completion counts once per session.
    if (typeof body.hunt === 'string' && HUNT.test(body.hunt) && !finished.has(`${body.id}:${body.hunt}`) && Object.keys(hunts).length < 50) {
      finished.add(`${body.id}:${body.hunt}`); hunts[body.hunt] = (hunts[body.hunt] || 0) + 1; dirty = true;
    }
    const g = body.guess;
    if (g && typeof g === 'object' && g.day === day && Number.isInteger(g.round) && g.round >= 0 && g.round < ROUNDS
      && [g.x, g.y, g.score].every(Number.isFinite)) {
      let rounds = players.get(body.id);
      if (!rounds && players.size < MAX_PLAYERS) { rounds = Array(ROUNDS).fill(null); players.set(body.id, rounds); }
      // First guess per round wins: no retries after seeing the answer.
      if (rounds && !rounds[g.round]) {
        rounds[g.round] = { x: Math.round(Math.max(-1e6, Math.min(1e6, g.x))), y: Math.round(Math.max(-1e6, Math.min(1e6, g.y))), score: Math.round(Math.max(0, Math.min(MAX_SCORE, g.score))) };
        dirty = true;
      }
    }
    return { status: 200, json: snapshot(body.id), dirty };
  }

  function snapshot(viewer) {
    const online = [...seen.keys()];
    online.sort((a, b) => (a === viewer ? -1 : b === viewer ? 1 : seen.get(b) - seen.get(a)));
    const mine = players.get(viewer) || [];
    const board = [...players].map(([id, rounds]) => ({ id, total: rounds.reduce((s, r) => s + (r?.score || 0), 0), played: rounds.filter(Boolean).length }))
      .sort((a, b) => b.total - a.total || b.played - a.played).slice(0, 10);
    // Other players' guesses for a round are revealed only once the viewer has guessed it.
    const guesses = Array.from({ length: ROUNDS }, (_, r) => mine[r] ? [...players].filter(([id, rounds]) => id !== viewer && rounds[r]).slice(0, 40).map(([id, rounds]) => ({ id, ...rounds[r] })) : []);
    const cursors = [...positions].filter(([id]) => id !== viewer && seen.has(id)).slice(0, MAX_CURSORS).map(([id, pos]) => ({ id, ...pos }));
    return { online: online.slice(0, MAX_ONLINE_LISTED), onlineCount: online.length, visits, cursors, hunts: { ...hunts }, game: { day, players: players.size, board, guesses, mine } };
  }

  const toJSON = () => ({ visits, day, players: Object.fromEntries(players), hunts: { ...hunts } });
  return { beat, snapshot, toJSON, get visits() { return visits; } };
}

// Shared request handling for Node (Vite) and Workers: POST /api/social/beat with a JSON body.
export async function handle(room, method, pathname, readBody) {
  if (pathname !== '/api/social/beat') return { status: 404, json: { error: 'not found' } };
  if (method !== 'POST') return { status: 405, json: { error: 'POST only' } };
  let body;
  try { const text = await readBody(); if (text.length > 2048) return { status: 413, json: { error: 'too large' } }; body = JSON.parse(text); } catch { return { status: 400, json: { error: 'bad json' } }; }
  return room.beat(body);
}
