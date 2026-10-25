// Daily "Find the landmark" puzzle: pure, deterministic logic shared by the viewer, the
// local dev server and tests. Everyone gets the same places on the same (India) day.

export const ROUNDS = 3;
export const MAX_SCORE = 5000;
const POOL_KINDS = new Set(['landmark', 'park', 'site', 'building', 'place_of_worship', 'college', 'university', 'attraction', 'railway', 'water', 'cinema', 'theatre']);

// Calendar day in Asia/Kolkata (UTC+05:30, no DST) so the puzzle flips at local midnight.
export function istDay(now = Date.now()) {
  return new Date(now + 5.5 * 3600e3).toISOString().slice(0, 10);
}

export function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Named, findable places: curated landmarks first-class, plus named parks/sites/buildings with a category.
export function puzzlePool(pois) {
  return pois.filter((p) => Array.isArray(p.image) && !p.unnamed && p.name && p.name.length > 3 && POOL_KINDS.has(p.kind)
    && (p.curated || p.kind === 'landmark' || p.category))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function dailyPuzzle(pois, day, rounds = ROUNDS) {
  const pool = puzzlePool(pois);
  if (!pool.length) return [];
  const curated = pool.filter((p) => p.curated || p.kind === 'landmark');
  const rand = rng(hash32(`gandhinagar-daily:${day}`));
  const picks = [];
  // Round 1 is a well-known landmark; later rounds draw from the whole pool.
  const sources = [curated.length ? curated : pool, ...Array(rounds - 1).fill(pool)];
  for (const source of sources) {
    for (let tries = 0; tries < 50; tries++) {
      const p = source[Math.floor(rand() * source.length)];
      if (!picks.includes(p)) { picks.push(p); break; }
    }
  }
  return picks;
}

// Approximate ground metres between two image points on flat ground: image x is metres × scale,
// image y is foreshortened by the camera's elevation (|up| projected on the ground plane).
export function groundMeters(a, b, transform) {
  const scale = transform?.scale || 5;
  const up = transform?.up || [0, 0.8192];
  const fore = Math.hypot(up[0], up[1]) || 1;
  return Math.hypot((a[0] - b[0]) / scale, (a[1] - b[1]) / (scale * fore));
}

export function scoreFor(meters) {
  if (!Number.isFinite(meters) || meters < 0) return 0;
  if (meters <= 25) return MAX_SCORE;
  return Math.max(0, Math.round(MAX_SCORE * Math.exp(-meters / 800)));
}

export function scoreEmoji(score) {
  return score >= 4500 ? '🟩' : score >= 2500 ? '🟨' : score >= 800 ? '🟧' : '🟥';
}

export function formatDistance(meters) {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
}

// DZI tiles covering a square crop of `size` screen px centred on an image point at `level`.
export function clueTiles({ width, height, tileSize, overlap }, point, level, size) {
  const maxLevel = Math.ceil(Math.log2(Math.max(width, height)));
  const f = 2 ** (level - maxLevel);
  const lw = Math.ceil(width * f), lh = Math.ceil(height * f);
  const cx = point[0] * f, cy = point[1] * f;
  const x0 = cx - size / 2, y0 = cy - size / 2;
  const tiles = [];
  const c0 = Math.max(0, Math.floor(x0 / tileSize)), c1 = Math.min(Math.ceil(lw / tileSize) - 1, Math.floor((x0 + size) / tileSize));
  const r0 = Math.max(0, Math.floor(y0 / tileSize)), r1 = Math.min(Math.ceil(lh / tileSize) - 1, Math.floor((y0 + size) / tileSize));
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    // With overlap, every tile but the first in a row/column starts `overlap` px early.
    tiles.push({ file: `${level}/${c}_${r}`, left: c * tileSize - (c ? overlap : 0) - x0, top: r * tileSize - (r ? overlap : 0) - y0 });
  }
  return tiles;
}
