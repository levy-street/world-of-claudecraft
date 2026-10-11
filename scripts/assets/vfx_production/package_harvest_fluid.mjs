// Pack the reviewed Mantaflow render, preserving straight alpha and cell gutters.
// node scripts/assets/vfx_production/package_harvest_fluid.mjs tmp/harvest-fluid-v2
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const source = path.resolve(process.argv[2] ?? 'tmp/harvest-fluid-v2');
const metadata = JSON.parse(await readFile(path.join(source, 'metadata.json'), 'utf8'));
assert.match(metadata.source, /Mantaflow/);
assert.deepEqual(
  metadata.mesh_evidence?.map((frame) => frame.frame),
  Array.from({ length: 64 }, (_, index) => index + 1),
  'Packaging requires a complete render; preview frames cannot replace a production atlas',
);
const cells = [],
  frames = [];
for (let index = 0; index < 64; index++) {
  const file = path.join(source, 'frames', `${String(index + 1).padStart(3, '0')}.png`);
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 248);
  assert.equal(info.height, 248);
  let minX = 248,
    minY = 248,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < 248; y++)
    for (let x = 0; x < 248; x++) {
      if (data[(y * 248 + x) * 4 + 3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  const bounds = maxX < 0 ? null : [minX, minY, maxX, maxY];
  if (bounds) assert(minX > 2 && minY > 2 && maxX < 245 && maxY < 245, `Clipped frame ${index}`);
  if (index === 0 || index === 63) assert.equal(bounds, null, 'Endpoints must be empty');
  frames.push({ index, bounds });
  cells.push({ input: file, left: (index % 8) * 256 + 4, top: Math.floor(index / 8) * 256 + 4 });
}
assert(frames.filter((frame) => frame.bounds).length >= 60, 'Incomplete liquid render');
const bytes = await sharp({
  create: { width: 2048, height: 2048, channels: 4, background: '#00000000' },
})
  .composite(cells)
  .webp({ lossless: true, effort: 6 })
  .toBuffer();
const output = 'public/textures/vfx/production/harvest_impact.webp';
await writeFile(output, bytes);
await writeFile(
  path.join(source, 'packed_metadata.json'),
  JSON.stringify(
    {
      ...metadata,
      frames_review: frames,
      output,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    bytes: bytes.length,
    nonemptyFrames: frames.filter((frame) => frame.bounds).length,
  }),
);
