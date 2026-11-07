// Daytime traffic with real-looking vehicles. Each vehicle type is a stack of 3D boxes (chassis, cabin,
// cargo) projected with the map's own camera into sprites for 32 headings, with a soft ground shadow,
// like the cars in Pixel Singapore. Traffic drives on the left in lanes sized by road class; vehicles
// in a lane share one speed and fixed slots, so they never overlap.

type Transform = { right: number[]; up: number[]; scale: number; eye?: number[] };
type Box = { l: number; w: number; h: number; z: number; x: number; color: string; top?: string };
type Kind = { id: string; len: number; boxes: (c: string) => Box[]; colours: string[]; weight: number; speed: number };

const SHADE = (hex: string, k: number) => { const n = parseInt(hex.slice(1), 16), f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k))); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; };

// Sizes in metres. Mix tuned for an Indian city: many two-wheelers and autos, fewer buses and trucks.
const KINDS: Kind[] = [
  { id: 'car', len: 4.3, weight: 38, speed: 1, colours: ['#f2f2ee', '#c4c8cc', '#8a9096', '#2f3338', '#b8302a', '#2e5fa6', '#7a1f24'],
    boxes: (c) => [{ l: 4.3, w: 1.8, h: 0.75, z: 0.25, x: 0, color: c }, { l: 2.2, w: 1.55, h: 0.6, z: 1.0, x: -0.25, color: '#26323c', top: c }] },
  { id: 'scooter', len: 1.9, weight: 30, speed: 0.95, colours: ['#d23b2f', '#1f1f22', '#e6e6e0', '#2f6db3', '#4a8a3a'],
    boxes: (c) => [{ l: 1.8, w: 0.6, h: 0.55, z: 0.25, x: 0, color: c }, { l: 0.5, w: 0.5, h: 0.75, z: 0.8, x: -0.2, color: '#3c3a46', top: '#2a2420' }] },
  { id: 'auto', len: 2.7, weight: 18, speed: 0.85, colours: ['#2f8f3e', '#f2c230'],
    boxes: (c) => [{ l: 2.7, w: 1.35, h: 0.7, z: 0.2, x: 0, color: c }, { l: 1.9, w: 1.3, h: 0.85, z: 0.9, x: -0.2, color: '#1f1f1f', top: '#f2c230' }] },
  { id: 'bus', len: 11, weight: 3, speed: 0.8, colours: ['#c8402f', '#e8e4d8'],
    boxes: (c) => [{ l: 11, w: 2.5, h: 2.9, z: 0.35, x: 0, color: c, top: '#d9d6cc' }] },
  { id: 'truck', len: 8, weight: 5, speed: 0.75, colours: ['#e07a1f', '#2f6db3', '#d8a21c'],
    boxes: (c) => [{ l: 2.2, w: 2.4, h: 2.2, z: 0.4, x: 2.8, color: '#e9e4d6' }, { l: 5.4, w: 2.4, h: 2.6, z: 0.5, x: -1.2, color: c }] },
  { id: 'tempo', len: 4.6, weight: 6, speed: 0.85, colours: ['#f2f2ee', '#3f7ab0'],
    boxes: (c) => [{ l: 1.6, w: 1.7, h: 1.4, z: 0.3, x: 1.4, color: c }, { l: 2.9, w: 1.75, h: 1.6, z: 0.4, x: -0.8, color: '#c9b17a' }] },
];
const HEADINGS = 32, SPRITE_PX_PER_M = 10, TOTAL_WEIGHT = KINDS.reduce((s, k) => s + k.weight, 0);
// Lanes per direction and lane width by road class weight (motion.json `w`).
const LANES = (w: number) => (w >= 6 ? 2 : 1), LANE_M = 3.3;
const SPEED = (w: number) => 45 + w * 6; // image px/s (≈ 9–16 m/s)

type Sprite = { canvas: HTMLCanvasElement; ox: number; oy: number; scale: number };

export class Vehicles {
  private sprites = new Map<string, Sprite>(); // `${kind}|${colour}|${heading}`
  private inv: [number, number, number, number]; // image vector → ground vector
  private lanes: { road: number; dir: 1 | -1; lane: number; v: number; slots: { s: number; kind: number; colour: number }[] }[] = [];
  stats = { drawn: 0 };

  constructor(private t: Transform, private roads: { pts: Float32Array; cum: Float32Array; len: number; bbox: [number, number, number, number] }[], weights: number[], hash: (n: number) => number) {
    const [rx, ry] = t.right, [ux, uy] = t.up, s = t.scale;
    // image = (s*(rx*gx+ry*gy), -s*(ux*gx+uy*gy)) → invert the 2×2 for road headings.
    const a = s * rx, b = s * ry, c = -s * ux, d = -s * uy, det = a * d - b * c;
    this.inv = [d / det, -b / det, -c / det, a / det];
    // Fill lanes with evenly spaced slots (gap ≥ 2× the longest vehicle), deterministic per road.
    weights.forEach((w, i) => {
      if (w < 1) return;
      const r = roads[i], per = LANES(w);
      for (const dir of [1, -1] as const) for (let lane = 0; lane < per; lane++) {
        const seed = i * 131 + (dir > 0 ? 0 : 7) + lane * 17, slotLen = (11 + 14 + hash(seed) * 30) * t.scale; // ≥ bus + gap
        const count = Math.floor(r.len / slotLen * Math.min(1, 0.35 + w * 0.1));
        if (!count) continue;
        const slots = Array.from({ length: count }, (_, k) => {
          let pick = hash(seed * 7 + k) * TOTAL_WEIGHT, kind = 0;
          while (pick > KINDS[kind].weight) { pick -= KINDS[kind].weight; kind++; }
          if (lane === 0 && per > 1 && (KINDS[kind].id === 'bus' || KINDS[kind].id === 'truck')) kind = 0; // heavy vehicles keep to the outer lane
          return { s: (k + hash(seed + k) * 0.3) * (r.len / count), kind, colour: Math.floor(hash(seed * 3 + k) * KINDS[kind].colours.length) };
        });
        this.lanes.push({ road: i, dir, lane, v: SPEED(w) * (lane ? 1.15 : 1), slots });
      }
    });
  }

  private headingIndex(dx: number, dy: number) {
    const [a, b, c, d] = this.inv, gx = a * dx + b * dy, gy = c * dx + d * dy;
    return ((Math.round((Math.atan2(gy, gx) / (Math.PI * 2)) * HEADINGS) % HEADINGS) + HEADINGS) % HEADINGS;
  }

  // Project a world-space point (metres, vehicle-local frame already rotated) to sprite pixels.
  private sprite(kind: number, colour: number, heading: number): Sprite {
    const key = `${kind}|${colour}|${heading}`, hit = this.sprites.get(key); if (hit) return hit;
    const K = KINDS[kind], col = K.colours[colour], ang = (heading / HEADINGS) * Math.PI * 2, ca = Math.cos(ang), sa = Math.sin(ang);
    const [rx, ry] = this.t.right, [ux, uy, uz] = this.t.up, S = SPRITE_PX_PER_M;
    const P = (lx: number, ly: number, z: number) => { const gx = lx * ca - ly * sa, gy = lx * sa + ly * ca; return [S * (rx * gx + ry * gy), -S * (ux * gx + uy * gy + uz * z)] as [number, number]; };
    const size = Math.ceil((K.len + 4) * S * 1.4), cv = document.createElement('canvas'); cv.width = cv.height = size;
    const g = cv.getContext('2d')!, o = size / 2; g.translate(o, o);
    const poly = (pts: [number, number][], fill: string) => { g.fillStyle = fill; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill(); };
    // Soft shadow: footprint pushed a little toward the sun's far side.
    const hl = K.len / 2 + 0.3, hw = (K.boxes(col)[0].w) / 2 + 0.25, sh = (x: number, y: number) => { const p = P(x, y, 0); return [p[0] + 0.6 * S, p[1] + 0.35 * S] as [number, number]; };
    g.globalAlpha = 0.28; poly([sh(-hl, -hw), sh(hl, -hw), sh(hl, hw), sh(-hl, hw)], '#1a1a12'); g.globalAlpha = 1;
    // Boxes, far to near; each draws its camera-facing sides (darker) then its top.
    const eye = this.t.eye ? [this.t.eye[0], this.t.eye[1]] : [0.2424, -0.5198]; // ground direction toward the camera
    const toGround = (lx: number, ly: number) => [lx * ca - ly * sa, lx * sa + ly * ca];
    // Painter's order: boxes further from the camera first.
    const boxes = K.boxes(col).slice().sort((p, q) => { const a = toGround(p.x, 0), b = toGround(q.x, 0); return (a[0] * eye[0] + a[1] * eye[1]) - (b[0] * eye[0] + b[1] * eye[1]); });
    for (const bx of boxes) {
      const x0 = bx.x - bx.l / 2, x1 = bx.x + bx.l / 2, y0 = -bx.w / 2, y1 = bx.w / 2, z0 = bx.z, z1 = bx.z + bx.h;
      const faces: [[number, number], [number, number][], number][] = [
        [[1, 0], [[x1, y0], [x1, y1]], 0.78], // front
        [[-1, 0], [[x0, y1], [x0, y0]], 0.72], // back
        [[0, -1], [[x0, y0], [x1, y0]], 0.86], // right side (local -y)
        [[0, 1], [[x1, y1], [x0, y1]], 0.64], // left side (local +y)
      ];
      for (const [[nx, ny], [a, b], shade] of faces) {
        // Keep a face only if its ground-space normal points toward the camera.
        const [gx, gy] = toGround(nx, ny);
        if (gx * eye[0] + gy * eye[1] <= 0) continue;
        poly([P(a[0], a[1], z0), P(b[0], b[1], z0), P(b[0], b[1], z1), P(a[0], a[1], z1)], SHADE(bx.color, shade));
      }
      poly([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], bx.top || SHADE(bx.color, 1.06));
      if (K.id === 'car' && bx.z > 0.5) poly([P(x1 - 0.05, y0 + 0.1, z1 - 0.02), P(x1 + 0.35, y0 + 0.12, z1 - 0.45), P(x1 + 0.35, y1 - 0.12, z1 - 0.45), P(x1 - 0.05, y1 - 0.1, z1 - 0.02)], '#7fa6c2'); // windscreen
    }
    const sp = { canvas: cv, ox: o, oy: o, scale: 1 / S };
    this.sprites.set(key, sp); return sp;
  }

  draw(ctx: CanvasRenderingContext2D, t: number, view: { x0: number; y0: number; x1: number; y1: number }, at: (r: { pts: Float32Array; cum: Float32Array }, s: number) => [number, number, number, number], alpha: number, limit = 1800) {
    this.stats.drawn = 0;
    const s5 = this.t.scale, ppm = s5; // image px per metre
    ctx.globalAlpha = alpha; ctx.imageSmoothingEnabled = true;
    for (const L of this.lanes) {
      const r = this.roads[L.road], b = r.bbox; if (b[2] < view.x0 || b[0] > view.x1 || b[3] < view.y0 || b[1] > view.y1) continue;
      const off = (LANE_M * (L.lane + 0.5)) * ppm;
      for (const sl of L.slots) {
        if (this.stats.drawn >= limit) break;
        const pos = (((sl.s + L.v * L.dir * t) % r.len) + r.len) % r.len;
        const [x, y, dx, dy] = at(r, pos), hx = dx * L.dir, hy = dy * L.dir;
        const px = x + hy * off, py = y - hx * off; // keep left (image y points down)
        if (px < view.x0 - 80 || px > view.x1 + 80 || py < view.y0 - 80 || py > view.y1 + 80) continue;
        const sp = this.sprite(sl.kind, sl.colour, this.headingIndex(hx, hy)), k = sp.scale * ppm, w = sp.canvas.width * k;
        ctx.drawImage(sp.canvas, px - sp.ox * k, py - sp.oy * k, w, w);
        this.stats.drawn++;
      }
    }
    ctx.globalAlpha = 1;
  }
}
