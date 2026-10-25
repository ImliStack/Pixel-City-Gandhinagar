// Motion overlay: one canvas above OpenSeadragon, synced to the viewport each frame. Tiles stay static.
// Draws (in image-pixel space): blank-ground fill for never-rendered regions (always), and at night
// traffic on real roads, metro trains on the Line-2 viaduct, living windows, lamp flicker, busy-area
// glow and park fireflies; in the monsoon layer, slow cloud shadows. Animation runs at ≤30 fps, only
// while the tab is visible, and draws only what is on screen.

export type MotionData = {
  blank: [number, number, number, number][];
  roads: { w: number; oneway: number; p: number[] }[];
  metro: { line: number[]; stations: { name: string; at: number }[] }[];
  lamps: number[]; windows: number[]; fireflies: number[]; glows: [number, number, number][];
};
export type View = { x: number; y: number; w: number; h: number; cw: number; ch: number };
export type Scene = { night: number; monsoon: number; animate: boolean };
export type MotionStats = { fps: number; cars: number; carsDrawn: number; trains: number; windowsLit: number; lamps: number; fireflies: number; clouds: number; blankRects: number; frames: number; drawMs: number };

const MAX_CARS = 40000, DRAW_CARS = 3000, CAR_SPACING = 450, FRAME_MS = 1000 / 30, CAR_SPEED = [45, 85], TRAIN_SPEED = 160, DWELL = 12, TRAIN_LEN = 320;
const hash = (n: number) => { let h = n | 0; h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

type Road = { pts: Float32Array; cum: Float32Array; len: number; bbox: [number, number, number, number]; oneway: boolean };
type Car = { road: number; s: number; dir: 1 | -1; v: number };
type Train = { line: number; s: number; dir: 1 | -1; wait: number; next: number };
type Line = { pts: Float32Array; cum: Float32Array; len: number; stations: number[] };

function prepare(p: number[]) {
  const pts = Float32Array.from(p), n = pts.length / 2, cum = new Float32Array(n);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2], y = pts[i * 2 + 1];
    if (i) cum[i] = cum[i - 1] + Math.hypot(x - pts[i * 2 - 2], y - pts[i * 2 - 1]);
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return { pts, cum, len: cum[n - 1] || 0, bbox: [x0, y0, x1, y1] as [number, number, number, number] };
}

// Position and unit direction at distance s along a polyline (binary search on cumulative length).
function at(line: { pts: Float32Array; cum: Float32Array }, s: number): [number, number, number, number] {
  const { pts, cum } = line; let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
  const seg = cum[hi] - cum[lo] || 1, u = (s - cum[lo]) / seg;
  const dx = (pts[hi * 2] - pts[lo * 2]) / seg, dy = (pts[hi * 2 + 1] - pts[lo * 2 + 1]) / seg;
  return [pts[lo * 2] + (pts[hi * 2] - pts[lo * 2]) * u, pts[lo * 2 + 1] + (pts[hi * 2 + 1] - pts[lo * 2 + 1]) * u, dx, dy];
}

// Open ground texture for never-rendered regions: sandy fields and scrub, close to the summer palette.
function groundPattern(): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!; g.fillStyle = '#c9b47e'; g.fillRect(0, 0, 256, 256);
  const colours = ['#b9a46c', '#d3c08b', '#8f9a55', '#7d8c47', '#a8a065'];
  for (let i = 0; i < 900; i++) {
    const x = hash(i * 3) * 256, y = hash(i * 3 + 1) * 256, r = 2 + hash(i * 3 + 2) * (i < 120 ? 26 : 7);
    g.fillStyle = colours[i % colours.length]; g.globalAlpha = i < 120 ? 0.35 : 0.55;
    for (const ox of [-256, 0, 256]) for (const oy of [-256, 0, 256]) { g.beginPath(); g.arc(x + ox, y + oy, r, 0, Math.PI * 2); g.fill(); }
  }
  return c;
}

// Minimap: the same open-ground texture over never-rendered regions.
export function paintMinimapBlank(canvas: HTMLCanvasElement, blank: MotionData['blank'], scale: number) {
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const pattern = ctx.createPattern(groundPattern(), 'repeat'); if (!pattern) return;
  pattern.setTransform(new DOMMatrix().scale(0.25));
  ctx.fillStyle = pattern;
  for (const [x, y, w, h] of blank) ctx.fillRect(Math.floor(x * scale), Math.floor(y * scale), Math.ceil(w * scale) + 1, Math.ceil(h * scale) + 1);
}

// Soft round glow sprite, tinted once and scaled with drawImage (far cheaper than per-frame gradients).
function glowSprite(rgb: string): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!, grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, `rgba(${rgb},1)`); grad.addColorStop(0.45, `rgba(${rgb},0.45)`); grad.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64); return c;
}

export class MotionLayer {
  private ctx: CanvasRenderingContext2D;
  private roads: Road[] = [];
  private cars: Car[] = [];
  private lines: Line[] = [];
  private trains: Train[] = [];
  private pattern: CanvasPattern | null = null;
  private warm = glowSprite('255,170,90');
  private lampGlow = glowSprite('255,190,110');
  private raf = 0;
  private last = 0;
  private lastDraw = 0;
  private lastKey = '';
  private time = 0;
  private fpsWindow: number[] = [];
  stats: MotionStats = { fps: 0, cars: 0, carsDrawn: 0, trains: 0, windowsLit: 0, lamps: 0, fireflies: 0, clouds: 0, blankRects: 0, frames: 0, drawMs: 0 };

  constructor(private canvas: HTMLCanvasElement, private data: MotionData, private view: () => View | null, private scene: () => Scene) {
    this.ctx = canvas.getContext('2d')!;
    this.roads = data.roads.map((r) => ({ ...prepare(r.p), oneway: !!r.oneway })).filter((r) => r.len > 20);
    // Cars by road length × class weight (one per CAR_SPACING/w image px). Positions are analytic in
    // time, so only cars on visible roads cost anything; at city zoom a stride caps what is drawn.
    for (let i = 0; i < this.roads.length && this.cars.length < MAX_CARS; i++) {
      const n = Math.floor((this.roads[i].len * data.roads[i].w) / CAR_SPACING + hash(i * 7));
      for (let k = 0; k < n && this.cars.length < MAX_CARS; k++) {
        const seed = this.cars.length * 13 + 5;
        this.cars.push({ road: i, s: hash(seed) * this.roads[i].len, dir: this.roads[i].oneway || hash(seed + 1) < 0.5 ? 1 : -1, v: CAR_SPEED[0] + hash(seed + 2) * (CAR_SPEED[1] - CAR_SPEED[0]) });
      }
    }
    this.lines = data.metro.map((m) => { const p = prepare(m.line); return { pts: p.pts, cum: p.cum, len: p.len, stations: m.stations.map((s) => s.at) }; });
    // Two trains per section, running opposite ways from opposite ends.
    this.lines.forEach((l, i) => { this.trains.push({ line: i, s: 0, dir: 1, wait: 0, next: 0 }, { line: i, s: l.len, dir: -1, wait: DWELL / 2, next: l.stations.length - 1 }); });
    this.stats.cars = this.cars.length; this.stats.trains = this.trains.length;
  }

  start() { if (!this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(this.tick); } }
  stop() { cancelAnimationFrame(this.raf); this.raf = 0; }
  invalidate() { this.lastKey = ''; }

  private tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick);
    if (document.hidden) { this.last = now; return; }
    const v = this.view(); if (!v) return;
    const sc = this.scene();
    const live = sc.animate && (sc.night > 0.02 || sc.monsoon > 0.02);
    const key = `${v.x.toFixed(1)},${v.y.toFixed(1)},${v.w.toFixed(1)},${v.cw},${v.ch},${sc.night.toFixed(3)},${sc.monsoon.toFixed(3)},${sc.animate}`;
    // Static scenes redraw only when the view changes; animated ones at ≤30 fps.
    if (key === this.lastKey && (!live || now - this.lastDraw < FRAME_MS - 4)) return; // 4 ms slack: on 60 Hz, every 2nd frame
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    if (live) { this.time += dt; this.step(dt); }
    this.lastKey = key; this.lastDraw = now;
    const t0 = performance.now(); this.draw(v, sc); this.stats.drawMs = +(this.stats.drawMs * 0.9 + (performance.now() - t0) * 0.1).toFixed(2);
    this.fpsWindow.push(now); while (this.fpsWindow.length && now - this.fpsWindow[0] > 1000) this.fpsWindow.shift();
    this.stats.fps = this.fpsWindow.length; this.stats.frames++;
  };

  private step(dt: number) {
    for (const t of this.trains) {
      const l = this.lines[t.line];
      if (t.wait > 0) { t.wait -= dt; continue; }
      t.s += TRAIN_SPEED * t.dir * dt;
      const stop = l.stations[t.next];
      if (stop !== undefined && (t.dir > 0 ? t.s >= stop : t.s <= stop)) { t.s = stop; t.wait = DWELL; t.next += t.dir; }
      if (t.s >= l.len || t.s <= 0) { t.s = Math.max(0, Math.min(l.len, t.s)); t.dir = t.dir > 0 ? -1 : 1; t.wait = DWELL * 2; t.next = t.dir > 0 ? 0 : l.stations.length - 1; }
    }
  }

  private draw(v: View, sc: Scene) {
    const { canvas, ctx } = this, dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(v.cw * dpr) || canvas.height !== Math.round(v.ch * dpr)) { canvas.width = Math.round(v.cw * dpr); canvas.height = Math.round(v.ch * dpr); }
    const z = v.cw / v.w; // screen px per image px
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * z, 0, 0, dpr * z, -v.x * dpr * z, -v.y * dpr * z);
    const x0 = v.x, y0 = v.y, x1 = v.x + v.w, y1 = v.y + v.h, pad = 40 / z;
    const onScreen = (x: number, y: number) => x > x0 - pad && x < x1 + pad && y > y0 - pad && y < y1 + pad;
    const t = this.time;
    const s = this.stats; s.carsDrawn = s.windowsLit = s.lamps = s.fireflies = s.clouds = s.blankRects = 0;

    // Never-rendered regions: textured open ground instead of flat beige, darkened at night.
    if (!this.pattern) this.pattern = ctx.createPattern(groundPattern(), 'repeat');
    for (const [bx, by, bw, bh] of this.data.blank) {
      if (bx > x1 || by > y1 || bx + bw < x0 || by + bh < y0) continue;
      this.pattern!.setTransform(new DOMMatrix().scale(16));
      ctx.fillStyle = this.pattern!; ctx.fillRect(bx, by, bw, bh);
      if (sc.night > 0) { ctx.fillStyle = `rgba(12,16,15,${0.86 * sc.night})`; ctx.fillRect(bx, by, bw, bh); }
      s.blankRects++;
    }

    // Monsoon cloud shadows: a few huge soft shapes drifting east-north-east.
    if (sc.monsoon > 0.02 && sc.animate) {
      for (let i = 0; i < 7; i++) {
        const r = 5000 + hash(i * 5) * 7000, span = 70000;
        const cx = ((hash(i * 5 + 1) * span + t * (55 + hash(i) * 30)) % span) - 6000, cy = hash(i * 5 + 2) * 52000 - 2000 - t * 8 % 4000;
        if (cx + r < x0 || cx - r > x1 || cy + r < y0 || cy - r > y1) continue;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, `rgba(20,30,45,${0.24 * sc.monsoon})`); g.addColorStop(0.6, `rgba(20,30,45,${0.12 * sc.monsoon})`); g.addColorStop(1, 'rgba(20,30,45,0)');
        ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r); s.clouds++;
      }
    }
    if (sc.night < 0.02 || !sc.animate) return;
    const n = sc.night;
    ctx.globalCompositeOperation = 'lighter';

    // Busy-area glow: slow breathing warm haze over the densest blocks.
    for (const [gx, gy, w] of this.data.glows) {
      const r = 900 + w * 900; if (!onScreen(gx, gy) && (gx + r < x0 || gx - r > x1 || gy + r < y0 || gy - r > y1)) continue;
      ctx.globalAlpha = (0.03 + 0.06 * w) * n * (0.85 + 0.15 * Math.sin(t * 0.4 + gx));
      ctx.drawImage(this.warm, gx - r, gy - r, 2 * r, 2 * r);
    }

    ctx.globalAlpha = 1;
    // Street lamps: steady pools with a gentle pulse; ~2% flicker. Drawn from neighbourhood zoom.
    if (z > 0.08) {
      const L = this.data.lamps, r = Math.max(14, 3 / z);
      for (let i = 0; i < L.length && s.lamps < 3000; i += 2) {
        const lx = L[i], ly = L[i + 1]; if (!onScreen(lx, ly)) continue;
        const h = hash(i), flicker = h < 0.02 ? (hash(i + Math.floor(t * 12)) < 0.35 ? 0.15 : 1) : 1;
        ctx.globalAlpha = n * flicker * (0.22 + 0.06 * Math.sin(t * (1.2 + h) + h * 40));
        ctx.drawImage(this.lampGlow, lx - r, ly - r, 2 * r, 2 * r);
        s.lamps++;
      }
    }

    ctx.globalAlpha = 1;
    // Living windows: each spot cycles on/off on its own 20–90 s rhythm.
    if (z > 0.05) {
      const W = this.data.windows, size = Math.max(3, 1.2 / z);
      for (let i = 0; i < W.length && s.windowsLit < 2500; i += 2) {
        const wx = W[i], wy = W[i + 1]; if (!onScreen(wx, wy)) continue;
        const h = hash(i * 3 + 11), period = 20 + h * 70, phase = (t + h * 500) / period;
        const on = hash(i * 3 + Math.floor(phase) * 977) < 0.55; if (!on) continue;
        const f = phase % 1, fade = Math.min(1, f * 12, (1 - f) * 12);
        ctx.fillStyle = `rgba(255,${200 + Math.round(h * 40)},${120 + Math.round(h * 60)},${0.85 * n * fade})`;
        ctx.fillRect(wx - size / 2, wy - size * 0.6, size, size * 1.2); s.windowsLit++;
      }
    }

    // Traffic: white headlights one way, red tail lights the other, offset into lanes.
    // One path per colour, filled once: thousands of cars cost two fill calls.
    const dot = Math.max(2.6 / z, 5), lane = Math.max(3, 1.8 / z), beams = z > 0.12;
    const head = new Path2D(), tail = new Path2D(), headBeam = new Path2D(), tailBeam = new Path2D();
    const visible = this.cars.filter((c) => { const b = this.roads[c.road].bbox; return !(b[2] < x0 - pad || b[0] > x1 + pad || b[3] < y0 - pad || b[1] > y1 + pad); });
    const stride = Math.max(1, Math.ceil(visible.length / DRAW_CARS));
    for (let i = 0; i < visible.length; i += stride) {
      const c = visible[i], r = this.roads[c.road], pos = (((c.s + c.v * c.dir * t) % r.len) + r.len) % r.len;
      const [cx, cy, dx, dy] = at(r, pos), px = cx - dy * lane * c.dir, py = cy + dx * lane * c.dir;
      if (!onScreen(px, py)) continue;
      (c.dir > 0 ? head : tail).rect(px - dot / 2, py - dot / 2, dot, dot);
      if (beams) (c.dir > 0 ? headBeam : tailBeam).rect(px + dx * c.dir * dot - dot, py + dy * c.dir * dot - dot, dot * 2, dot * 2);
      s.carsDrawn++;
    }
    if (beams) { ctx.fillStyle = `rgba(255,240,200,${0.18 * n})`; ctx.fill(headBeam); ctx.fillStyle = `rgba(255,60,40,${0.16 * n})`; ctx.fill(tailBeam); }
    ctx.fillStyle = `rgba(255,246,214,${0.95 * n})`; ctx.fill(head);
    ctx.fillStyle = `rgba(255,80,60,${n})`; ctx.fill(tail);

    // Metro trains: a lit three-car body along the viaduct with a soft glow.
    ctx.lineCap = 'round';
    for (const tr of this.trains) {
      const l = this.lines[tr.line], a = Math.max(0, tr.s - TRAIN_LEN / 2), bEnd = Math.min(l.len, tr.s + TRAIN_LEN / 2);
      const p0 = at(l, a), p1 = at(l, bEnd), pm = at(l, tr.s);
      if (!onScreen(pm[0], pm[1])) continue;
      ctx.strokeStyle = `rgba(150,200,255,${0.25 * n})`; ctx.lineWidth = Math.max(30, 7 / z);
      ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(pm[0], pm[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
      ctx.strokeStyle = `rgba(255,244,210,${0.95 * n})`; ctx.lineWidth = Math.max(12, 2.5 / z);
      ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(pm[0], pm[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
    }

    // Fireflies in parks: wandering, blinking specks at close zoom.
    if (z > 0.15) {
      const F = this.data.fireflies, r = Math.max(2.2, 1.4 / z);
      for (let i = 0; i < F.length; i += 2) {
        const h = hash(i + 3), fx = F[i] + Math.sin(t * (0.3 + h) + h * 9) * 30, fy = F[i + 1] + Math.cos(t * (0.25 + h * 0.5) + h * 5) * 22;
        if (!onScreen(fx, fy)) continue;
        const blink = Math.max(0, Math.sin(t * (1.5 + h * 2) + h * 30)); if (blink < 0.2) continue;
        ctx.fillStyle = `rgba(214,255,120,${0.9 * n * blink})`; ctx.fillRect(fx - r, fy - r, 2 * r, 2 * r); s.fireflies++;
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}
