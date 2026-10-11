// Package all 64 original Blender frames with transparent four-pixel gutters.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const source = 'tmp/warrior-fervor';
const metadata = JSON.parse(await readFile(`${source}/metadata.json`, 'utf8'));
assert.equal(metadata.frames, 64);
assert.equal(metadata.frame_size, 248);
assert.equal(metadata.gutter, 4);
assert.equal(metadata.camera_span, 5.6);
assert.equal(metadata.baked_bloom, false);
const expectedPivot = [0.5 - 1.45 / 5.6, 0.5 + 0.8 / 5.6];
assert(Array.isArray(metadata.pivot_content_top_origin));
assert.equal(metadata.pivot_content_top_origin.length, 2);
for (let axis = 0; axis < 2; axis++) {
  const actual = metadata.pivot_content_top_origin[axis];
  assert(Number.isFinite(actual), `Non-finite power pivot axis ${axis}`);
  assert(Math.abs(actual - expectedPivot[axis]) < 1e-12, `Wrong power pivot axis ${axis}`);
}
const cells = [];
for (let index = 0; index < 64; index++) {
  const input = `${source}/frames/${String(index + 1).padStart(3, '0')}.png`;
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 248);
  assert.equal(info.height, 248);
  assert.equal(info.channels, 4);
  let visible = 0;
  for (let y = 0; y < 248; y++)
    for (let x = 0; x < 248; x++) {
      if (!data[(y * 248 + x) * 4 + 3]) continue;
      visible++;
      assert(x > 1 && x < 246 && y > 1 && y < 246, `Clipped frame ${index}`);
    }
  if (index === 0 || index === 63) assert.equal(visible, 0);
  else assert(visible > 0, `Missing frame ${index}`);
  cells.push({ input, left: (index % 8) * 256 + 4, top: Math.floor(index / 8) * 256 + 4 });
}
const bytes = await sharp({
  create: { width: 2048, height: 2048, channels: 4, background: '#00000000' },
})
  .composite(cells)
  .webp({ lossless: true, effort: 6 })
  .toBuffer();
await writeFile('public/textures/vfx/production/warrior_fervor.webp', bytes);
console.log(
  JSON.stringify({
    frames: 64,
    bytes: bytes.length,
    endpoints: 'empty',
    clipping: 'none',
    pivot_content_top_origin: metadata.pivot_content_top_origin,
  }),
);
