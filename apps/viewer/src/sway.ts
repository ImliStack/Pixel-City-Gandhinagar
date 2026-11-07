// Tree sway and water shimmer without re-rendering: a WebGL2 canvas over the map re-draws the map's own canopy pixels
// (detected by colour: green-dominant, not too dark or bright) with a small offset that follows
// travelling gusts anchored to image coordinates, so the wind does not slide when you pan.
// Because this canvas sits above the ground motion layer, cars pass under tree crowns too.
// The map canvas is captured only when the view has settled; while panning or zooming the layer hides.

export type SwayView = { x: number; y: number; z: number; cw: number; ch: number };

const VS = `#version 300 es
in vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D map; uniform vec2 res; uniform vec2 origin; uniform float scale; uniform float t; uniform float amp; uniform float night;
out vec4 o;
float tree(vec3 c) {
  float g = c.g, m = max(c.r, c.b);
  return step(m * 1.07 + 0.012, g) * step(0.09 + 0.02 * (1.0 - night), g) * step(g, 0.86);
}
// Mapped water in every layer: blue-teal, clearly bluer than it is red, not grey.
float water(vec3 c) { return step(c.r * 1.45 + 0.02, c.g) * step(c.r * 1.55 + 0.02, c.b) * step(c.g * 0.92, c.b) * step(0.16, c.b); }
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec2 px = vec2(gl_FragCoord.x, res.y - gl_FragCoord.y);          // device px, top-left origin
  vec2 img = origin + px / scale;                                   // image px (stable under panning)
  // Gusts: a wave front moving east-north-east plus low-frequency turbulence, per ~12 m crown cell.
  vec2 cell = floor(img / 60.0);
  float gust = 0.55 + 0.45 * sin(img.x * 0.0021 + img.y * 0.0009 - t * 0.9);
  float phase = h(cell) * 6.2831;
  vec2 d = vec2(sin(t * 2.1 + phase) + 0.6 * (n(img / 90.0 + t * 0.25) - 0.5), 0.45 * cos(t * 1.7 + phase * 1.3)) * amp * gust;
  vec2 src = (px + d) / res;
  vec3 c = texture(map, vec2(src.x, src.y)).rgb;
  if (tree(c) > 0.5) {
    // Lit side of the gust: a touch brighter as leaves turn, so motion reads even in flat canopy.
    o = vec4(c * (1.0 + 0.06 * gust * sin(t * 2.1 + phase)), 1.0);
    return;
  }
  // Water: the map's own lake and river pixels ripple in drifting bands, with sun glints by day.
  vec3 w = texture(map, px / res).rgb;
  if (water(w) < 0.5) discard;
  float ripple = n(img / 38.0 + vec2(t * 0.35, t * 0.12)) - n(img / 23.0 - vec2(t * 0.22, -t * 0.3));
  float glint = step(0.93, n(img / 5.0 + vec2(t * 1.7, t * 0.9))) * step(0.6, n(img / 70.0 + t * 0.1)) * (1.0 - night);
  o = vec4(w * (1.0 + 0.13 * ripple) + vec3(0.55) * glint + vec3(0.05, 0.06, 0.08) * night * max(ripple, 0.0), 1.0);
}`;

export class TreeSway {
  private gl: WebGL2RenderingContext | null;
  private prog: WebGLProgram | null = null;
  private tex: WebGLTexture | null = null;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private captured: SwayView | null = null;
  ready = false;
  stats = { captures: 0, frames: 0 };

  constructor(private canvas: HTMLCanvasElement) {
    this.gl = canvas.getContext('webgl2', { premultipliedAlpha: false, alpha: true });
    const gl = this.gl; if (!gl) return;
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram()!; gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { this.gl = null; return; }
    this.prog = prog; gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const k of ['map', 'res', 'origin', 'scale', 't', 'amp', 'night']) this.u[k] = gl.getUniformLocation(prog, k);
    this.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  }

  get supported() { return !!this.gl; }

  // Snapshot the map canvas for the current (settled) view.
  capture(map: HTMLCanvasElement, view: SwayView) {
    const gl = this.gl; if (!gl || !map.width) return;
    if (this.canvas.width !== map.width || this.canvas.height !== map.height) { this.canvas.width = map.width; this.canvas.height = map.height; }
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, map);
    this.captured = view; this.ready = true; this.stats.captures++;
  }

  invalidate() { this.ready = false; this.clear(); }

  clear() { const gl = this.gl; if (gl) { gl.viewport(0, 0, this.canvas.width, this.canvas.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); } }

  draw(t: number, night: number) {
    const gl = this.gl, v = this.captured; if (!gl || !this.ready || !v) return;
    const W = this.canvas.width, H = this.canvas.height, scale = W / (v.cw / v.z); // device px per image px
    gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.u.map, 0); gl.uniform2f(this.u.res, W, H); gl.uniform2f(this.u.origin, v.x, v.y); gl.uniform1f(this.u.scale, scale);
    gl.uniform1f(this.u.t, t); gl.uniform1f(this.u.night, night);
    // ~0.3 m of crown movement, never under ~1 device px so it reads, never over 3 so trees don't wobble.
    gl.uniform1f(this.u.amp, Math.max(1, Math.min(3, scale * 1.5)));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.stats.frames++;
  }
}
