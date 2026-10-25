import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const file = 'outputs/maps/gandhinagar-city/motion.json';
test('motion export: roads, both metro sections, ambience inside the image', { skip: !fs.existsSync(file) }, () => {
  const m = JSON.parse(fs.readFileSync(file)), meta = JSON.parse(fs.readFileSync('outputs/maps/gandhinagar-city/metadata.json'));
  assert.equal(m.version, meta.version);
  assert.ok(m.roads.length > 1000 && m.roads.every((r) => r.p.length >= 4 && r.p.length % 2 === 0 && r.w > 0));
  assert.equal(m.metro.length, 2);
  assert.equal(m.metro.flatMap((s) => s.stations).length, meta.pois.filter((p) => p.category === 'metro').length, 'every metro station sits on a section');
  for (const key of ['lamps', 'windows', 'fireflies']) {
    assert.ok(m[key].length > 1000 && m[key].length % 2 === 0, key);
    for (let i = 0; i < m[key].length; i += 2) assert.ok(m[key][i] > -500 && m[key][i] < meta.width + 500 && m[key][i + 1] > -500 && m[key][i + 1] < meta.height + 500, key);
  }
  assert.ok(m.blank.length > 0 && m.blank.every(([x, y, w, h]) => w > 0 && w <= 4096 && h > 0 && h <= 4096 && x % 4096 === 0 && y % 4096 === 0));
});
