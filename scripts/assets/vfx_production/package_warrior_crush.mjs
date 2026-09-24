// Pack original Blender compression frames in the existing 8x8 guttered convention.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const source = 'tmp/warrior-crush';
const metadata = JSON.parse(await readFile(`${source}/metadata.json`, 'utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
assert.equal(metadata.frames, 64);
assert.equal(metadata.frame_size, 496);
assert.equal(metadata.gutter, 8);
assert.deepEqual(metadata.grid, [8, 8]);
assert.deepEqual(
  metadata.rendered_frames,
  Array.from({ length: 64 }, (_, i) => i + 1),
);
assert.equal(
  metadata.source_sha256,
  sha256(await readFile(new URL('./bake_warrior_crush.py', import.meta.url))),
  'Bake source changed after render',
);
const cells = [];
for (let index = 0; index < 64; index++) {
  const input = await readFile(`${source}/frames/${String(index + 1).padStart(3, '0')}.png`);
  assert.equal(sha256(input), metadata.frame_sha256[String(index + 1)], `Stale frame ${index}`);
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 496);
  assert.equal(info.height, 496);
  assert.equal(info.channels, 4);
  let visible = 0;
  for (let y = 0; y < 496; y++)
    for (let x = 0; x < 496; x++) {
      if (!data[(y * 496 + x) * 4 + 3]) continue;
      visible++;
      assert(x > 1 && x < 494 && y > 1 && y < 494, `Clipped frame ${index}`);
    }
  if (index === 0 || index === 63) assert.equal(visible, 0);
  else assert(visible > 0, `Missing frame ${index}`);
  cells.push({ input, left: (index % 8) * 512 + 8, top: Math.floor(index / 8) * 512 + 8 });
}
const bytes = await sharp({
  create: { width: 4096, height: 4096, channels: 4, background: '#00000000' },
})
  .composite(cells)
  .webp({ lossless: true, effort: 6 })
  .toBuffer();
await mkdir('public/textures/vfx/production', { recursive: true });
await writeFile('public/textures/vfx/production/warrior_crush.webp', bytes);
console.log(
  JSON.stringify({
    frames: 64,
    bytes: bytes.length,
    sha256: sha256(bytes),
    endpoints: 'empty',
    clipping: 'none',
  }),
);

// Optional runtime encode keeps the lossless master and uses the existing
// KTX2 loader. Bake flipY; compressed textures cannot flip at upload time.
// node scripts/assets/vfx_production/package_warrior_crush.mjs --ktx <ktx-executable>
if (process.argv[2] === '--ktx') {
  const executable = process.argv[3];
  assert(executable, '--ktx requires an executable path');
  const flipped = `${source}/atlas-flipped.png`;
  const output = 'public/textures/vfx/production/warrior_crush.ktx2';
  await sharp(bytes).flip().png().toFile(flipped);
  for (const args of [
    [
      'create',
      '--format',
      'R8G8B8A8_SRGB',
      '--encode',
      'uastc',
      '--uastc-quality',
      '4',
      '--zstd',
      '18',
      '--threads',
      '4',
      '--assign-tf',
      'srgb',
      flipped,
      output,
    ],
    ['validate', output],
    ['extract', '--transcode', 'rgba8', output, `${source}/atlas-decoded.png`],
  ]) {
    const result = spawnSync(executable, args, { stdio: 'inherit', windowsHide: true });
    assert.equal(result.status, 0, 'KTX2 encode/validation failed');
  }
  const original = await sharp(bytes).ensureAlpha().raw().toBuffer();
  const decoded = await sharp(`${source}/atlas-decoded.png`).flip().ensureAlpha().raw().toBuffer();
  assert.equal(decoded.length, original.length);
  let error = 0,
    channels = 0,
    alphaError = 0;
  for (let i = 0; i < original.length; i += 4) {
    alphaError += Math.abs(original[i + 3] - decoded[i + 3]);
    if (original[i + 3] < 16) continue;
    for (let c = 0; c < 3; c++) {
      error += Math.abs(original[i + c] - decoded[i + c]);
      channels++;
    }
  }
  const meanVisibleRgbError = error / channels,
    meanAlphaError = alphaError / (original.length / 4);
  assert(meanVisibleRgbError < 8 && meanAlphaError < 1, 'Compression exceeds the detail budget');
  const runtime = await readFile(output);
  const proof = {
    runtimeSha256: sha256(runtime),
    runtimeBytes: runtime.length,
    masterSha256: sha256(bytes),
    meanVisibleRgbError,
    meanAlphaError,
    verticalFlipVerified: true,
    encoding: 'UASTC quality4, no RDO, Zstd18, one level',
  };
  await writeFile(`${source}/compression-proof.json`, JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof));
}
