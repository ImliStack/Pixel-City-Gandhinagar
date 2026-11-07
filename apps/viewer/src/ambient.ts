// Ambient life drawn by the motion layer (image-pixel space, same canvas and frame budget):
// water shimmer, trains, illustrative planes, daytime traffic (cars, auto-rickshaws, buses), the odd cow,
// and festival modes. Everything here is decoration on top of the real map: positions come from OSM
// geometry (water, rail, roads), but individual vehicles, planes, kites and lamps are invented.
import type { MotionData } from './motion';
import { Vehicles } from './vehicles';

export type Festival = 'uttarayan' | 'diwali' | 'navratri' | null;
type Hash = (n: number) => number;
type At = (line: { pts: Float32Array; cum: Float32Array }, s: number) => [number, number, number, number];
type Poly = { pts: Float32Array; cum: Float32Array; len: number };
export type Frame = { ctx: CanvasRenderingContext2D; t: number; z: number; night: number; sun: string; x0: number; y0: number; x1: number; y1: number; onScreen: (x: number, y: number) => boolean };

// Festival dates (India time). Uttarayan is solar (14–15 January). Navratri and Diwali follow the lunar
// calendar, so the table needs a yearly check; dates here are the commonly published ones.
const LUNAR: Record<number, { navratri: [string, string]; diwali: [string, string] }> = {
  2026: { navratri: ['2026-10-11', '2026-10-20'], diwali: ['2026-11-06', '2026-11-10'] },
  2027: { navratri: ['2027-09-30', '2027-10-09'], diwali: ['2027-10-27', '2027-10-31'] },
  2028: { navratri: ['2028-09-19', '2028-09-28'], diwali: ['2028-10-15', '2028-10-19'] },
};
export function festivalFor(now = Date.now()): Festival {
  const day = new Date(now + 5.5 * 3600e3).toISOString().slice(0, 10), year = Number(day.slice(0, 4)), md = day.slice(5);
  if (md === '01-14' || md === '01-15') return 'uttarayan';
  const y = LUNAR[year];
  if (y && day >= y.navratri[0] && day <= y.navratri[1]) return 'navratri';
  if (y && day >= y.diwali[0] && day <= y.diwali[1]) return 'diwali';
  return null;
}

const KITE_COLOURS = ['#e8413a', '#f2c230', '#e0418f', '#2fa3d8', '#3fae4a', '#f08a24', '#8e5bd8'];
// Deep teal-green like real lakes (and Pixel Singapore's river), laid over the bright rendered cyan.
export const WATER_TINT = '34,88,88', WATER_ALPHA = 0.6;
const PLANE_SPEED = 1100, // ~3× a real approach speed: the city is 12 km across, so real speed would mean one plane every few minutes
  TRAIN_SPEED = 140, TRAIN_LEN = 650;

export class Ambient {
  private rail: Poly[];
  private trains: { line: number; s: number; dir: 1 | -1; wait: number }[] = [];
  private planes: { x: number; y: number; dx: number; dy: number; alt: number; left: number; delay: number; seed: number }[] = [];
  private waterPath: Path2D | null = null;
  private cows: { road: number; s: number; seed: number }[] = [];
  private bursts: { x: number; y: number; t0: number; hue: number; seed: number }[] = [];
  private nextBurst = 0;
  private vehicles: Vehicles | null = null;
  stats = { pitches: 0, parked: 0, water: 0, trains: 0, planes: 0, dayVehicles: 0, cows: 0, kites: 0, festival: '' as string };

  constructor(private data: MotionData, private hash: Hash, private at: At, prepare: (p: number[]) => Poly, private width: number, private height: number,
    private roads: { pts: Float32Array; cum: Float32Array; len: number; bbox: [number, number, number, number] }[], roadWeight: number[], transform?: { right: number[]; up: number[]; scale: number; eye?: number[] }) {
    if (transform && typeof document !== 'undefined') this.vehicles = new Vehicles(transform, roads, roadWeight, hash);
    this.rail = (data.rail || []).map(prepare).filter((r) => r.len > 0);
    this.rail.forEach((r, i) => { this.trains.push({ line: i, s: r.len * 0.3, dir: 1, wait: 0 }, { line: i, s: r.len * 0.8, dir: -1, wait: 0 }); });
    for (let i = 0; i < 3; i++) this.planes.push(this.newFlight(i, i * 20, i === 0 ? 0.45 : 0)); // the first is already over the city
    // Cows live on residential streets (weight 1), a few dozen across the city.
    for (let i = 0, k = 0; i < roads.length && this.cows.length < 160; i++) if (roadWeight[i] === 1 && hash(i * 17 + 3) < 0.03) this.cows.push({ road: i, s: hash(k++ * 7) * roads[i].len, seed: i });
    if (data.water?.rings?.length) { const p = new Path2D(); for (const r of data.water.rings) { p.moveTo(r[0], r[1]); for (let i = 2; i < r.length; i += 2) p.lineTo(r[i], r[i + 1]); p.closePath(); } this.waterPath = p; }
  }

  // Illustrative flights: straight lines across the city at 700–1,100 m, one every minute or so per slot.
  private newFlight(seed: number, delay: number, progress = 0) {
    const h = this.hash, a = h(seed * 13 + 1) * Math.PI * 2, cx = this.width * (0.3 + 0.4 * h(seed * 13 + 2)), cy = this.height * (0.3 + 0.4 * h(seed * 13 + 3));
    // Start just outside the city (not at the far edge of a huge square) so a plane shows up within seconds.
    const reach = Math.hypot(this.width, this.height) * 0.5, dx = Math.cos(a), dy = Math.sin(a);
    const done = reach * 2 * progress;
    return { x: cx - dx * (reach - done), y: cy - dy * (reach - done), dx, dy, alt: 700 + h(seed * 13 + 4) * 400, left: reach * 2 - done, delay, seed };
  }

  step(dt: number) {
    for (const tr of this.trains) {
      const l = this.rail[tr.line]; if (!l) continue;
      if (tr.wait > 0) { tr.wait -= dt; continue; }
      tr.s += TRAIN_SPEED * tr.dir * dt;
      if (tr.s >= l.len || tr.s <= 0) { tr.s = Math.max(0, Math.min(l.len, tr.s)); tr.dir = tr.dir > 0 ? -1 : 1; tr.wait = 30 + this.hash(tr.line + tr.s) * 40; }
    }
    this.planes = this.planes.map((p) => {
      if (p.delay > 0) return { ...p, delay: p.delay - dt };
      const d = PLANE_SPEED * dt; p.x += p.dx * d; p.y += p.dy * d; p.left -= d;
      return p.left > 0 ? p : this.newFlight(p.seed + 101, 10 + this.hash(p.seed) * 25);
    });
  }

  // Ground level, under everything airborne: water, daytime traffic, cows, trains.
  drawGround(f: Frame, sky: NonNullable<MotionData['sky']>) {
    const { ctx, t, z, night, onScreen } = f, day = 1 - night, s = this.stats;
    s.water = s.trains = s.dayVehicles = s.cows = 0;
    // Water: a deep-teal tint over the rendered cyan (matched by the sway shader up close), then sparse
    // sun glints by day, cool specks by night, and slow ripple dashes on some points.
    if (this.waterPath) { ctx.fillStyle = `rgba(${WATER_TINT},${(WATER_ALPHA * (1 - 0.6 * night)).toFixed(3)})`; ctx.fill(this.waterPath); }
    const W = this.data.water?.points;
    if (W && z > 0.03) {
      const stride = z < 0.08 ? 3 : 1, g = Math.max(3.6 / z, 5);
      for (let i = 0; i < W.length; i += 2 * stride) {
        const x = W[i], y = W[i + 1]; if (!onScreen(x, y)) continue;
        const h = this.hash(i), tw = Math.sin(t * (1.3 + h * 2.2) + h * 60);
        if (tw > 0.82) {
          const a = Math.min(1, (tw - 0.82) * 5);
          ctx.fillStyle = night > 0.5 ? `rgba(170,200,255,${0.5 * a * night})` : `rgba(245,250,240,${0.6 * a * day})`;
          ctx.fillRect(x - g / 2, y - g / 2, g, g);
        }
        if (h < 0.35 && z > 0.08) {
          const off = ((t * 9 + h * 300) % 60) - 30, l = g * 3;
          ctx.fillStyle = night > 0.5 ? `rgba(120,160,220,${0.3 * night})` : `rgba(225,245,240,${0.2 * day})`;
          ctx.fillRect(x + off - l / 2, y, l, Math.max(1.4 / z, 2));
        }
        s.water++;
      }
      if (night > 0.3 && this.waterPath) { ctx.save(); ctx.clip(this.waterPath); ctx.fillStyle = `rgba(255,190,110,${0.05 * night * (0.9 + 0.1 * Math.sin(t))})`; ctx.fillRect(f.x0, f.y0, f.x1 - f.x0, f.y1 - f.y0); ctx.restore(); }
    }
    // Sports pitches: mowing stripes, court surfaces and white markings from OSM pitch polygons.
    s.pitches = 0;
    if (this.data.pitches && z > 0.05) {
      ctx.globalAlpha = 1 - 0.72 * night;
      for (const p of this.data.pitches) {
        const first = p.fills[0]?.[1]; if (!first || !onScreen(first[0], first[1])) { let vis = false; for (let i = 0; i < (first?.length || 0); i += 2) if (onScreen(first![i], first![i + 1])) { vis = true; break; } if (!vis) continue; }
        if (p.clip) { ctx.save(); ctx.beginPath(); for (let i = 0; i < p.clip.length; i += 2) (i ? ctx.lineTo(p.clip[i], p.clip[i + 1]) : ctx.moveTo(p.clip[i], p.clip[i + 1])); ctx.closePath(); ctx.clip(); }
        for (const [colour, poly] of p.fills) { ctx.fillStyle = colour; ctx.beginPath(); for (let i = 0; i < poly.length; i += 2) (i ? ctx.lineTo(poly[i], poly[i + 1]) : ctx.moveTo(poly[i], poly[i + 1])); ctx.closePath(); ctx.fill(); }
        if (p.clip) ctx.restore();
        ctx.strokeStyle = 'rgba(255,255,255,0.88)'; ctx.lineWidth = Math.max(0.6, 1.1 / z); ctx.lineJoin = 'round';
        for (const ln of p.lines) { ctx.beginPath(); for (let i = 0; i < ln.length; i += 2) (i ? ctx.lineTo(ln[i], ln[i + 1]) : ctx.moveTo(ln[i], ln[i + 1])); ctx.stroke(); }
        s.pitches++;
      }
      ctx.globalAlpha = 1;
    }
    // Parked cars in car parks (under the tree layer, like the rest of the ground).
    s.parked = this.vehicles && this.data.parked && z > 0.1 ? this.vehicles.drawParked(ctx, this.data.parked, f, this.hash, 1 - 0.55 * night) : 0;
    // Daytime traffic: 3D vehicle sprites in lanes (see vehicles.ts); flat fallback without a camera transform.
    if (day > 0.2 && z > 0.06 && this.vehicles) {
      this.vehicles.draw(ctx, t, f, this.at, Math.min(1, day * 1.5), z < 0.15 ? 900 : 1800);
      s.dayVehicles = this.vehicles.stats.drawn;
    }
    // Cows: amble slowly across residential streets by day.
    if (day > 0.4 && z > 0.16) for (const c of this.cows) {
      const r = this.roads[c.road], h = this.hash(c.seed), [x, y, dx, dy] = this.at(r, (c.s + Math.sin(t * 0.02 + h * 9) * 25 + r.len) % r.len);
      const across = Math.sin(t * 0.06 + h * 40) * 12, cx = x - dy * across, cy = y + dx * across; if (!onScreen(cx, cy)) continue;
      const ang = Math.atan2(dx, -dy) + (Math.cos(t * 0.06 + h * 40) > 0 ? 0 : Math.PI);
      const k = Math.max(1, 0.32 / z); // never smaller than ~4 screen px
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang); ctx.scale(k, k);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(-4, -1, 13, 6);
      ctx.fillStyle = h < 0.5 ? '#f1ece0' : '#a8754a'; ctx.fillRect(-6, -3, 12, 6); ctx.fillRect(5, -2, 4, 4);
      ctx.fillStyle = '#2b2620'; ctx.fillRect(8, -2, 1.5, 1.5); if (h < 0.5) ctx.fillRect(-2, -1, 3, 2);
      ctx.restore(); s.cows++;
    }
    // Trains: a long blue-and-cream rake along the main line, lit windows and a headlight at night.
    for (const tr of this.trains) {
      const l = this.rail[tr.line]; if (!l) continue;
      const a = Math.max(0, tr.s - TRAIN_LEN / 2), b = Math.min(l.len, tr.s + TRAIN_LEN / 2), m = this.at(l, tr.s);
      if (!onScreen(m[0], m[1]) && !onScreen(...this.at(l, a).slice(0, 2) as [number, number]) && !onScreen(...this.at(l, b).slice(0, 2) as [number, number])) continue;
      const pts: [number, number][] = []; for (let u = a; u <= b; u += 40) { const p = this.at(l, u); pts.push([p[0], p[1]]); }
      const stroke = (w: number, c: string, dx = 0, dy = 0) => { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x + dx, y + dy) : ctx.moveTo(x + dx, y + dy))); ctx.stroke(); };
      ctx.lineCap = 'butt';
      stroke(Math.max(16, 5 / z), `rgba(20,20,10,${0.25 * day})`, sky.shadowPerMetre[f.sun]?.[0] * 3.5 || 0, sky.shadowPerMetre[f.sun]?.[1] * 3.5 || 0);
      stroke(Math.max(15, 4.5 / z), night > 0.5 ? '#1c2a44' : '#2f5fa8');
      stroke(Math.max(6, 1.8 / z), night > 0.5 ? `rgba(255,226,150,${0.9 * night})` : '#e8e1c8');
      if (night > 0.3) { const head = tr.dir > 0 ? pts.at(-1)! : pts[0]; ctx.fillStyle = `rgba(255,248,220,${night})`; ctx.beginPath(); ctx.arc(head[0], head[1], Math.max(10, 3 / z), 0, Math.PI * 2); ctx.fill(); }
      s.trains++;
    }
  }

  // Airborne, above birds: planes with their ground shadows, and Uttarayan kites.
  drawAir(f: Frame, sky: NonNullable<MotionData['sky']>, festival: Festival) {
    const { ctx, t, z, night, onScreen } = f, s = this.stats, spm = sky.shadowPerMetre[f.sun] || sky.shadowPerMetre.A, lift = sky.liftPerMetre;
    s.planes = 0; s.kites = 0; s.festival = festival || '';
    const size = Math.max(34 / z, 150);
    for (const p of this.planes) {
      if (p.delay > 0) continue;
      const px = p.x + lift[0] * p.alt, py = p.y + lift[1] * p.alt, sx = px + spm[0] * p.alt, sy = py + spm[1] * p.alt, ang = Math.atan2(p.dy, p.dx);
      if (night < 0.7 && onScreen(sx, sy)) { ctx.fillStyle = `rgba(25,25,20,${0.22 * (1 - night)})`; plane(ctx, sx, sy, ang, size); }
      if (!onScreen(px, py)) continue;
      ctx.fillStyle = night > 0.5 ? '#3a4052' : '#f4f5f7'; plane(ctx, px, py, ang, size);
      ctx.fillStyle = night > 0.5 ? '#2a2f3c' : '#c9ced6'; plane(ctx, px, py, ang, size * 0.5);
      if (night > 0.2) {
        const c = Math.cos(ang), sn = Math.sin(ang), r = Math.max(5, 1.6 / z);
        dot(ctx, px - sn * size * 0.48, py + c * size * 0.48, r, `rgba(80,255,120,${night})`);
        dot(ctx, px + sn * size * 0.48, py - c * size * 0.48, r, `rgba(255,70,60,${night})`);
        if (Math.sin(t * 6 + p.seed) > 0.85) dot(ctx, px, py, r * 1.8, `rgba(255,255,255,${night})`);
      }
      s.planes++;
    }
    // Uttarayan: kites over the rooftops, each tethered by a thin string, bobbing in the wind, with shadows by day.
    if (festival === 'uttarayan' && z > 0.04) {
      const R = this.data.windows, k = Math.max(13 / z, 18);
      for (let i = 0; i < R.length && s.kites < 600; i += 2 * 5) {
        const h = this.hash(i * 5 + 1), rx = R[i], ry = R[i + 1], alt = 30 + h * 45;
        const kx = rx + Math.sin(t * (0.6 + h) + h * 30) * 40 + lift[0] * alt + 60 * (h - 0.5), ky = ry + Math.cos(t * (0.5 + h * 0.7) + h * 10) * 25 + lift[1] * alt;
        if (!onScreen(kx, ky)) continue;
        if (night < 0.6) { ctx.fillStyle = `rgba(20,20,10,${0.18 * (1 - night)})`; kite(ctx, kx + spm[0] * alt, ky + spm[1] * alt, k, Math.sin(t + h * 9) * 0.3); }
        ctx.strokeStyle = 'rgba(40,40,40,0.35)'; ctx.lineWidth = Math.max(0.8 / z, 1); ctx.beginPath(); ctx.moveTo(rx, ry); ctx.quadraticCurveTo((rx + kx) / 2 + 30, (ry + ky) / 2 + 40, kx, ky + k * 0.6); ctx.stroke();
        ctx.fillStyle = night > 0.5 ? `rgba(255,190,90,${night})` : KITE_COLOURS[Math.floor(h * KITE_COLOURS.length)];
        if (night > 0.5) dot(ctx, kx, ky, k * 0.35, ctx.fillStyle as string); else kite(ctx, kx, ky, k, Math.sin(t + h * 9) * 0.3);
        s.kites++;
      }
    }
  }

  // Night festival light (drawn with additive blending in the night pass): Diwali lamps and fireworks,
  // Navratri garba circles at parks and grounds.
  drawNight(f: Frame, festival: Festival) {
    const { ctx, t, z, night, onScreen } = f;
    if (festival === 'diwali') {
      const L = this.data.windows, r = Math.max(4 / z, 5);
      for (let i = 0; i < L.length; i += 4) { const x = L[i], y = L[i + 1]; if (!onScreen(x, y)) continue; const h = this.hash(i + 9); ctx.fillStyle = `rgba(255,${150 + Math.round(h * 60)},60,${(0.55 + 0.35 * Math.sin(t * (3 + h * 4) + h * 20)) * night})`; ctx.fillRect(x - r / 2, y - r / 2, r, r); }
      // Fireworks: a burst every second or so somewhere in view.
      if (t > this.nextBurst) { this.nextBurst = t + 0.25 + this.hash(Math.floor(t * 10)) * 0.6; const h = this.hash(Math.floor(t * 7)); this.bursts.push({ x: f.x0 + (f.x1 - f.x0) * (0.15 + 0.7 * h), y: f.y0 + (f.y1 - f.y0) * (0.1 + 0.5 * this.hash(Math.floor(t * 13))), t0: t, hue: Math.floor(h * 360), seed: Math.floor(t * 100) }); }
      this.bursts = this.bursts.filter((b) => t - b.t0 < 2.2);
      const unit = (f.x1 - f.x0) / 40;
      for (const b of this.bursts) {
        const age = t - b.t0, rad = unit * (0.3 + age * 1.1), a = Math.max(0, 1 - age / 2.2) * night;
        for (let k = 0; k < 28; k++) { const ang = (k / 28) * Math.PI * 2 + this.hash(b.seed + k) * 0.2, d = rad * (0.75 + this.hash(b.seed * 3 + k) * 0.35); ctx.fillStyle = `hsla(${(b.hue + k * 7) % 360},100%,65%,${a})`; ctx.fillRect(b.x + Math.cos(ang) * d, b.y + Math.sin(ang) * d + age * age * unit * 0.15, unit * 0.09, unit * 0.09); }
      }
    }
    if (festival === 'navratri') {
      const roosts = this.data.sky?.roosts || [], ring = Math.max(60, 14 / z);
      for (let i = 0; i < roosts.length; i++) {
        const [x, y] = roosts[i]; if (!onScreen(x, y)) continue;
        const h = this.hash(i * 3), n = 16;
        for (let k = 0; k < n; k++) { const ang = (k / n) * Math.PI * 2 + t * (0.6 + h * 0.4) * (k % 2 ? 1 : -1); ctx.fillStyle = `hsla(${(k * 360) / n + t * 40},95%,60%,${0.8 * night})`; ctx.fillRect(x + Math.cos(ang) * ring, y + Math.sin(ang) * ring * 0.6, ring * 0.08, ring * 0.08); }
        ctx.fillStyle = `rgba(255,120,200,${0.08 * night * (1 + Math.sin(t * 4 + h * 9))})`; ctx.beginPath(); ctx.ellipse(x, y, ring * 1.5, ring, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
    void z;
  }
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: string) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
// Top-down airliner silhouette (fuselage, swept wings, tailplane), `size` = length in image px.
function plane(ctx: CanvasRenderingContext2D, x: number, y: number, ang: number, size: number) {
  const L = size / 2, pts: [number, number][] = [[L, 0], [L * 0.7, 0.06 * L], [0.15 * L, 0.07 * L], [-0.2 * L, 0.95 * L], [-0.38 * L, 0.95 * L], [-0.18 * L, 0.08 * L], [-0.75 * L, 0.07 * L], [-0.95 * L, 0.38 * L], [-1.05 * L, 0.38 * L], [-0.95 * L, 0]];
  const all = [...pts, ...pts.slice(1, -1).reverse().map(([a, b]) => [a, -b] as [number, number])], c = Math.cos(ang), s = Math.sin(ang);
  ctx.beginPath(); all.forEach(([a, b], i) => { const px = x + a * c - b * s, py = y + a * s + b * c; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }); ctx.closePath(); ctx.fill();
}
function kite(ctx: CanvasRenderingContext2D, x: number, y: number, k: number, tilt: number) {
  const c = Math.cos(tilt), s = Math.sin(tilt), P = (a: number, b: number) => [x + a * c - b * s, y + a * s + b * c] as const;
  const q = [P(0, -k * 0.6), P(k * 0.45, 0), P(0, k * 0.6), P(-k * 0.45, 0)];
  ctx.beginPath(); ctx.moveTo(...q[0]); q.slice(1).forEach((p) => ctx.lineTo(...p)); ctx.closePath(); ctx.fill();
}
