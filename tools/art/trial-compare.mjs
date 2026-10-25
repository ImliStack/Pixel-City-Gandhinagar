// Side-by-side and detail crops of a repaint trial: input (deterministic) vs repainted (model-assisted).
// Usage: node tools/art/trial-compare.mjs outputs/art-trial/input-vidhan-sabha-A.png outputs/art-trial/repainted.png
import sharp from 'sharp';
const [a, b] = process.argv.slice(2), meta = await sharp(a).metadata(), w = Math.min(1200, meta.width), h = Math.round(w * meta.height / meta.width);
const left = await sharp(a).resize(w, h).toBuffer(), right = await sharp(b).resize(w, h).toBuffer();
await sharp({ create: { width: w * 2 + 12, height: h, channels: 3, background: '#fff' } }).composite([{ input: left, left: 0, top: 0 }, { input: right, left: w + 12, top: 0 }]).jpeg({ quality: 88 }).toFile(b.replace(/\.png$/, '-compare.jpg'));
const c = { left: Math.round(meta.width / 2 - 256), top: Math.round(meta.height / 2 - 192), width: 512, height: 384 };
const l2 = await sharp(a).extract(c).resize(1024, 768, { kernel: 'nearest' }).toBuffer(), r2 = await sharp(b).extract(c).resize(1024, 768, { kernel: 'nearest' }).toBuffer();
await sharp({ create: { width: 2060, height: 768, channels: 3, background: '#fff' } }).composite([{ input: l2, left: 0, top: 0 }, { input: r2, left: 1036, top: 0 }]).jpeg({ quality: 88 }).toFile(b.replace(/\.png$/, '-detail.jpg'));
console.log('wrote', b.replace(/\.png$/, '-compare.jpg'), b.replace(/\.png$/, '-detail.jpg'));
