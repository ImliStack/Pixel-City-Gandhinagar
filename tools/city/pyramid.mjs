// Deep Zoom pyramid built straight from render chunks, never materialising the full image.
// Level L cores are the chunk PNGs; each lower level's 1024 px cores are lossless 2× box-downsamples of 2×2 cores above.
// DZI tiles (tileSize + overlap) are cut from up to 2×2 decoded cores held in a small LRU cache.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

export async function buildPyramid({chunkDir, width, height, chunk = 1024, tileSize = 512, overlap = 1, background = [217, 207, 174], out, quality = 88, workDir, log = console.log}) {
  sharp.cache(false); sharp.concurrency(2);
  const L = Math.ceil(Math.log2(Math.max(width, height)));
  const dims = l => [Math.ceil(width / 2 ** (L - l)), Math.ceil(height / 2 ** (L - l))];
  const coreFile = (l, i, j) => l === L ? path.join(chunkDir, `${i * chunk}-${j * chunk}.png`) : path.join(workDir, String(l), `${i}-${j}.png`);
  const cache = new Map(), MAX = 160;
  async function core(l, i, j) {
    const key = `${l}/${i}/${j}`; if (cache.has(key)) { const v = cache.get(key); cache.delete(key); cache.set(key, v); return v; }
    const [W, H] = dims(l), w = Math.min(chunk, W - i * chunk), h = Math.min(chunk, H - j * chunk), f = coreFile(l, i, j);
    let buf;
    if (w <= 0 || h <= 0) buf = null;
    else if (fs.existsSync(f)) buf = await sharp(f).removeAlpha().raw().toBuffer();
    else { buf = Buffer.alloc(w * h * 3); for (let p = 0; p < w * h; p++) buf.set(background, p * 3); }
    const v = {buf, w, h}; cache.set(key, v); if (cache.size > MAX) cache.delete(cache.keys().next().value); return v;
  }
  // Copy level-l image rectangle into a raw RGB buffer.
  async function read(l, x, y, w, h) {
    const outBuf = Buffer.alloc(w * h * 3);
    for (let j = Math.floor(y / chunk); j <= Math.floor((y + h - 1) / chunk); j++) for (let i = Math.floor(x / chunk); i <= Math.floor((x + w - 1) / chunk); i++) {
      const c = await core(l, i, j); if (!c.buf) continue;
      const sx0 = Math.max(x, i * chunk), sx1 = Math.min(x + w, i * chunk + c.w), sy0 = Math.max(y, j * chunk), sy1 = Math.min(y + h, j * chunk + c.h);
      for (let yy = sy0; yy < sy1; yy++) c.buf.copy(outBuf, ((yy - y) * w + (sx0 - x)) * 3, ((yy - j * chunk) * c.w + (sx0 - i * chunk)) * 3, ((yy - j * chunk) * c.w + (sx1 - i * chunk)) * 3);
    }
    return outBuf;
  }
  // Lossless lower-level cores.
  for (let l = L - 1; l >= 0; l--) {
    const [W, H] = dims(l); fs.mkdirSync(path.join(workDir, String(l)), {recursive: true});
    for (let j = 0; j * chunk < H; j++) for (let i = 0; i * chunk < W; i++) {
      const f = coreFile(l, i, j); if (fs.existsSync(f)) continue;
      const w = Math.min(chunk, W - i * chunk), h = Math.min(chunk, H - j * chunk), [PW, PH] = dims(l + 1);
      const sw = Math.min(2 * w, PW - 2 * i * chunk), sh = Math.min(2 * h, PH - 2 * j * chunk);
      const src = await read(l + 1, 2 * i * chunk, 2 * j * chunk, sw, sh);
      // Exact 2×2 box average (odd edges reuse the last row/column), matching libvips' Deep Zoom shrink.
      const dst = Buffer.alloc(w * h * 3);
      for (let yy = 0; yy < h; yy++) { const ya = Math.min(2 * yy, sh - 1), yb = Math.min(2 * yy + 1, sh - 1);
        for (let xx = 0; xx < w; xx++) { const xa = Math.min(2 * xx, sw - 1), xb = Math.min(2 * xx + 1, sw - 1);
          for (let ch = 0; ch < 3; ch++) dst[(yy * w + xx) * 3 + ch] = (src[(ya * sw + xa) * 3 + ch] + src[(ya * sw + xb) * 3 + ch] + src[(yb * sw + xa) * 3 + ch] + src[(yb * sw + xb) * 3 + ch] + 2) >> 2; } }
      await sharp(dst, {raw: {width: w, height: h, channels: 3}}).png({compressionLevel: 3}).toFile(f + '.tmp'); fs.renameSync(f + '.tmp', f);
    }
    if (l % 3 === 0) log(`cores level ${l} done`);
  }
  // DZI tiles.
  const files = `${out}_files`; let count = 0;
  for (let l = L; l >= 0; l--) {
    const [W, H] = dims(l); fs.mkdirSync(path.join(files, String(l)), {recursive: true});
    for (let row = 0; row * tileSize < H; row++) for (let col = 0; col * tileSize < W; col++) {
      const x0 = Math.max(0, col * tileSize - overlap), y0 = Math.max(0, row * tileSize - overlap), x1 = Math.min(W, (col + 1) * tileSize + overlap), y1 = Math.min(H, (row + 1) * tileSize + overlap);
      const f = path.join(files, String(l), `${col}_${row}.webp`); if (fs.existsSync(f)) { count++; continue; }
      const raw = await read(l, x0, y0, x1 - x0, y1 - y0);
      await sharp(raw, {raw: {width: x1 - x0, height: y1 - y0, channels: 3}}).webp({quality, effort: 4, smartSubsample: true}).toFile(f + '.tmp'); fs.renameSync(f + '.tmp', f); count++;
    }
    log(`tiles level ${l} (${W}×${H})`);
  }
  fs.writeFileSync(`${out}.dzi`, `<?xml version="1.0" encoding="UTF-8"?>\n<Image xmlns="http://schemas.microsoft.com/deepzoom/2008" Format="webp" Overlap="${overlap}" TileSize="${tileSize}">\n  <Size Height="${height}" Width="${width}"/>\n</Image>\n`);
  return {levels: L + 1, tiles: count};
}
