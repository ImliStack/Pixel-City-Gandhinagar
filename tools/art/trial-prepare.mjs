// Cut a trial crop (default: capital complex, 3072×2048 px at full resolution) out of the exported
// Deep Zoom tiles, ready to upload to a cloud GPU for tools/art/repaint_trial.py.
// Usage: node tools/art/trial-prepare.mjs [poiId] [width] [height] [layer]
import fs from 'node:fs';
import sharp from 'sharp';
const [poiId = 'vidhan-sabha', W = '3072', H = '2048', layer = 'A'] = process.argv.slice(2);
const dir = 'outputs/maps/gandhinagar-city', meta = JSON.parse(fs.readFileSync(`${dir}/metadata.json`));
const poi = meta.pois.find((p) => p.id === poiId); if (!poi) throw new Error(`no POI ${poiId}`);
const w = Number(W), h = Number(H), x0 = Math.round(poi.image[0] - w / 2), y0 = Math.round(poi.image[1] - h / 2);
const level = Math.ceil(Math.log2(Math.max(meta.width, meta.height))), ts = meta.tileSize, ov = meta.overlap;
const parts = [];
for (let r = Math.floor(y0 / ts); r <= Math.floor((y0 + h - 1) / ts); r++) for (let c = Math.floor(x0 / ts); c <= Math.floor((x0 + w - 1) / ts); c++) {
  const file = `${dir}/${layer}_files/${level}/${c}_${r}.${meta.format}`; if (!fs.existsSync(file)) continue;
  parts.push({ input: await sharp(file).png().toBuffer(), left: c * ts - (c ? ov : 0) - x0, top: r * ts - (r ? ov : 0) - y0 });
}
const out = 'outputs/art-trial'; fs.mkdirSync(out, { recursive: true });
// Negative offsets are clipped by compositing onto a padded canvas, then cropping.
const pad = ts * 2, canvas = sharp({ create: { width: w + pad * 2, height: h + pad * 2, channels: 3, background: '#d9cfae' } })
  .composite(parts.map((p) => ({ ...p, left: p.left + pad, top: p.top + pad })));
await sharp(await canvas.png().toBuffer()).extract({ left: pad, top: pad, width: w, height: h }).png().toFile(`${out}/input-${poiId}-${layer}.png`);
fs.writeFileSync(`${out}/input-${poiId}-${layer}.json`, JSON.stringify({ poiId, layer, image: [x0, y0, w, h], mapVersion: meta.version }, null, 1));
console.log(`${out}/input-${poiId}-${layer}.png`, w, '×', h, 'from', parts.length, 'tiles');
