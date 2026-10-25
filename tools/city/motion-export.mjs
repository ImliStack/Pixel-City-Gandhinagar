// Export the compact data the viewer's motion overlay animates: road polylines (traffic), the metro
// Line-2 viaduct and its stations, street-lamp heads, facade window spots, park points (fireflies),
// busy-area glow centres and the layout regions that were never rendered (blank ground).
// All positions are image pixels on the map lattice. Usage: node tools/city/motion-export.mjs [mapId]
import fs from 'node:fs';
import { hash32, rng } from '../../apps/viewer/shared/daily.mjs';

const mapId = process.argv[2] || 'gandhinagar-city';
const out = `outputs/maps/${mapId}`;
const meta = JSON.parse(fs.readFileSync(`${out}/metadata.json`));
const data = JSON.parse(fs.readFileSync('data/processed/city/pilot.json'));
const layout = JSON.parse(fs.readFileSync('outputs/city/layout.json'));
const t = meta.transform;
const project = (x, y, z = 0) => [(t.right[0] * x + t.right[1] * y - t.minU) * t.scale, (t.maxV - (t.up[0] * x + t.up[1] * y + t.up[2] * z)) * t.scale];
const r1 = (v) => Math.round(v);
const rand = rng(hash32(`motion:${mapId}`));

// Ramer–Douglas–Peucker in image px.
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let best = -1, dist = tol;
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs(dy * (pts[i][0] - ax) - dx * (pts[i][1] - ay)) / l; if (d > dist) { dist = d; best = i; } }
    if (best > 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const flat = (pts) => pts.flatMap(([x, y]) => [r1(x), r1(y)]);
const lines = (g) => (g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []);

// Traffic weight per car-carrying highway class; paths, footways and service lanes carry none.
const WEIGHT = { motorway: 8, trunk: 7, primary: 6, secondary: 5, tertiary: 3, motorway_link: 3, trunk_link: 3, primary_link: 3, secondary_link: 2, tertiary_link: 2, unclassified: 1.5, residential: 1 };
const roads = [];
for (const f of data.features) {
  if (f.kind !== 'road') continue;
  const w = WEIGHT[f.tags.highway];
  if (!w || f.tags.tunnel) continue;
  for (const pts of lines(f.geometry)) {
    const img = simplify(pts.map(([x, y]) => project(x, y)), 1.5);
    if (img.length >= 2) roads.push({ w, oneway: f.tags.oneway === 'yes' ? 1 : 0, p: flat(img) });
  }
}

// Metro: join Line-2 viaduct ways into the longest chain; the train runs it end to end and back.
const deck = 11;
const viaduct = data.features.filter((f) => f.kind === 'railway' && f.tags.bridge === 'viaduct' && f.geometry.type === 'LineString' && f.tags.railway === 'subway');
// One direction of the twin tracks plus the unnamed single-track viaduct sections.
const segs = viaduct.filter((f) => !/Mahatma Mandir -Motera/.test(f.tags.name || '')).map((f) => f.geometry.coordinates);
const pool = segs.length ? segs : viaduct.map((f) => f.geometry.coordinates);
const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 8;
const used = new Set();
const metro = [];
while (used.size < pool.length) {
  let chain = pool.filter((s) => !used.has(s)).sort((a, b) => b.length - a.length)[0];
  used.add(chain);
  for (let grew = true; grew;) {
    grew = false;
    for (const s of pool) {
      if (used.has(s)) continue;
      if (near(chain.at(-1), s[0])) chain = [...chain, ...s.slice(1)];
      else if (near(chain.at(-1), s.at(-1))) chain = [...chain, ...s.slice(0, -1).reverse()];
      else if (near(chain[0], s.at(-1))) chain = [...s.slice(0, -1), ...chain];
      else if (near(chain[0], s[0])) chain = [...s.slice(1).reverse(), ...chain];
      else continue;
      used.add(s); grew = true;
    }
  }
  const line = chain.map(([x, y]) => project(x, y, deck));
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  if (cum.at(-1) < 3000) continue; // stubs and sidings
  // Stations: metro-category POIs within ~120 m of this section, as distance along it.
  const stations = meta.pois.filter((p) => p.category === 'metro' && p.image).map((p) => {
    let best = Infinity, at = 0;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i], vx = b[0] - a[0], vy = b[1] - a[1], l2 = vx * vx + vy * vy || 1;
      const u = Math.max(0, Math.min(1, ((p.image[0] - a[0]) * vx + (p.image[1] - a[1]) * vy) / l2));
      const d = Math.hypot(p.image[0] - a[0] - vx * u, p.image[1] - a[1] - vy * u);
      if (d < best) { best = d; at = cum[i - 1] + u * Math.sqrt(l2); }
    }
    return best < 600 ? { name: p.name, at: r1(at) } : null;
  }).filter(Boolean).sort((a, b) => a.at - b.at);
  metro.push({ line: flat(line), stations });
}

// Street-lamp heads: same rule as the renderer (wide roads, alternating verges every 26 m, head at 6.5 m),
// without the footprint test, then thinned so the overlay stays cheap.
const lamps = [];
for (const name of fs.readdirSync('outputs/city/scenes')) {
  const scene = JSON.parse(fs.readFileSync(`outputs/city/scenes/${name}`));
  for (const r of scene.roads || []) {
    if (r.footway || r.width < 5.5) continue;
    for (const pts of lines(r.geometry)) {
      let walked = 0, n = 0;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 0.01) continue;
        const dx = (b[0] - a[0]) / len, dy = (b[1] - a[1]) / len;
        for (let k = (13 - (walked % 26) + 26) % 26; k < len; k += 26) {
          const side = n++ % 2 ? 1 : -1, off = r.width / 2 + 0.9 - 1.1;
          lamps.push(project(a[0] + dx * k - dy * off * side, a[1] + dy * k + dx * off * side, 6.5));
        }
        walked += len;
      }
    }
  }
}
const lampSet = new Map();
for (const p of lamps) lampSet.set(`${r1(p[0] / 4)},${r1(p[1] / 4)}`, p);
const inImage = ([x, y]) => x >= 0 && y >= 0 && x <= meta.width && y <= meta.height;
const lampList = [...lampSet.values()].filter((p) => inImage(p) && rand() < 0.6);

// Window spots on camera-facing facades (outward normal toward the eye), one floor band per point.
const eye = [t.eye[0], t.eye[1]];
const buildings = data.features.filter((f) => f.kind === 'building' && f.geometry.type === 'Polygon' && f.height >= 6);
const windows = [];
for (let tries = 0; windows.length < 30000 && tries < 200000; tries++) {
  const b = buildings[Math.floor(rand() * buildings.length)];
  const ring = b.geometry.coordinates[0];
  let area = 0; for (let i = 1; i < ring.length; i++) area += ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1];
  const i = 1 + Math.floor(rand() * (ring.length - 1)), a = ring[i - 1], c = ring[i];
  const ex = c[0] - a[0], ey = c[1] - a[1], len = Math.hypot(ex, ey);
  if (len < 4) continue;
  const nx = (area > 0 ? ey : -ey) / len, ny = (area > 0 ? -ex : ex) / len; // outward normal
  if (nx * eye[0] + ny * eye[1] < 0.15) continue;
  const u = 0.15 + rand() * 0.7, floors = Math.max(1, Math.floor(b.height / 3.2));
  const z = 3.2 * Math.floor(rand() * floors) + 1.4;
  windows.push(project(a[0] + ex * u + nx * 0.2, a[1] + ey * u + ny * 0.2, z));
}

// Fireflies: random points inside mapped parks and gardens.
const inside = (p, ring) => { let o = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) o = !o; } return o; };
const parks = data.features.filter((f) => f.kind === 'park' && f.geometry.type === 'Polygon');
const fireflies = [];
for (const f of parks) {
  const ring = f.geometry.coordinates[0], xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const n = Math.min(40, Math.ceil(((x1 - x0) * (y1 - y0)) / 2500));
  for (let k = 0, tries = 0; k < n && tries < n * 6; tries++) { const p = [x0 + rand() * (x1 - x0), y0 + rand() * (y1 - y0)]; if (inside(p, ring)) { fireflies.push(project(p[0], p[1], 1.5)); k++; } }
}

// Busy-area glow: 200 m grid of buildings + shops/food/offices; keep the densest cells.
const cell = 200, grid = new Map();
const add = (x, y, w) => { const k = `${Math.floor(x / cell)},${Math.floor(y / cell)}`; grid.set(k, (grid.get(k) || 0) + w); };
for (const f of data.features) {
  if (f.kind === 'building' && f.geometry.type === 'Polygon') { const p = f.geometry.coordinates[0][0]; add(p[0], p[1], 1); }
  else if (f.kind === 'poi' && f.geometry.type === 'Point' && (f.tags.shop || ['restaurant', 'cafe', 'fast_food', 'cinema', 'marketplace', 'bank'].includes(f.tags.amenity))) add(...f.geometry.coordinates, 6);
}
const cells = [...grid].sort((a, b) => b[1] - a[1]).slice(0, 160), top = cells[0]?.[1] || 1;
const glows = cells.map(([k, w]) => { const [cx, cy] = k.split(',').map(Number); const [x, y] = project((cx + 0.5) * cell, (cy + 0.5) * cell); return [r1(x), r1(y), +(w / top).toFixed(2)]; });

const blank = layout.regions.filter((r) => !r.coverage).map((r) => r.rect);
const result = {
  schema: 1, mapId, version: meta.version,
  note: 'Motion overlay data in image px. Roads and metro from OSM; lamp, window, firefly and glow positions are authored ambience derived from OSM geometry.',
  blank, roads, metro,
  lamps: flat(lampList), windows: flat(windows.filter(inImage)), fireflies: flat(fireflies.filter(inImage)), glows,
};
fs.writeFileSync(`${out}/motion.json`, JSON.stringify(result));
console.log(JSON.stringify({ roads: roads.length, roadPoints: roads.reduce((s, r) => s + r.p.length / 2, 0), metro: metro.map((m) => `${m.line.length / 2} pts, ${m.stations.map((s) => s.name).join('/')}`), lamps: lampList.length, windows: windows.length, fireflies: fireflies.length, glows: glows.length, blank: blank.length, bytes: fs.statSync(`${out}/motion.json`).size }));
