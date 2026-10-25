// Visitor presence, visit counter and the shared daily-game board.
// One plain-JS room used by the Vite dev middleware (in memory) and by the Cloudflare
// Durable Object (persisted with toJSON/fromJSON). Privacy: only random anonymous ids from the
// browser are kept; no IP, user agent or location is read or stored.
import { istDay, MAX_SCORE, ROUNDS } from './daily.mjs';

export const BEAT_MS = 4000;
const ID = /^[a-z0-9]{8,32}$/;
const MAX_PLAYERS = 2000;
const MAX_ONLINE_LISTED = 12;

export function createRoom({ ttl = 15000, now = Date.now, state } = {}) {
  let visits = state?.visits || 0;
  const seen = new Map(); // session id -> last beat ms (not persisted)
  let day = state?.day || istDay(now());
  let players = new Map(Object.entries(state?.players || {})); // id -> [{x,y,score}|null × ROUNDS]

  const prune = () => {
    const t = now();
    for (const [id, last] of seen) if (t - last > ttl) seen.delete(id);
    const today = istDay(t);
    if (today !== day) { day = today; players = new Map(); }
  };

  function beat(body) {
    if (!body || typeof body !== 'object' || !ID.test(body.id)) return { status: 400, json: { error: 'bad id' } };
    prune();
    const changed = { dirty: false };
    if (body.hello === true) { visits++; changed.dirty = true; }
    if (body.bye === true) seen.delete(body.id); else seen.set(body.id, now());
    const g = body.guess;
    if (g && typeof g === 'object' && g.day === day && Number.isInteger(g.round) && g.round >= 0 && g.round < ROUNDS
      && [g.x, g.y, g.score].every(Number.isFinite)) {
      let rounds = players.get(body.id);
      if (!rounds && players.size < MAX_PLAYERS) { rounds = Array(ROUNDS).fill(null); players.set(body.id, rounds); }
      // First guess per round wins: no retries after seeing the answer.
      if (rounds && !rounds[g.round]) {
        rounds[g.round] = { x: Math.round(Math.max(-1e6, Math.min(1e6, g.x))), y: Math.round(Math.max(-1e6, Math.min(1e6, g.y))), score: Math.round(Math.max(0, Math.min(MAX_SCORE, g.score))) };
        changed.dirty = true;
      }
    }
    return { status: 200, json: snapshot(body.id), dirty: changed.dirty };
  }

  function snapshot(viewer) {
    const online = [...seen.keys()];
    online.sort((a, b) => (a === viewer ? -1 : b === viewer ? 1 : seen.get(b) - seen.get(a)));
    const mine = players.get(viewer) || [];
    const board = [...players].map(([id, rounds]) => ({ id, total: rounds.reduce((s, r) => s + (r?.score || 0), 0), played: rounds.filter(Boolean).length }))
      .sort((a, b) => b.total - a.total || b.played - a.played).slice(0, 10);
    // Other players' guesses for a round are revealed only once the viewer has guessed it.
    const guesses = Array.from({ length: ROUNDS }, (_, r) => mine[r] ? [...players].filter(([id, rounds]) => id !== viewer && rounds[r]).slice(0, 40).map(([id, rounds]) => ({ id, ...rounds[r] })) : []);
    return { online: online.slice(0, MAX_ONLINE_LISTED), onlineCount: online.length, visits, game: { day, players: players.size, board, guesses, mine } };
  }

  const toJSON = () => ({ visits, day, players: Object.fromEntries(players) });
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
