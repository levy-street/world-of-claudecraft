// Normalize the three standalone Warrior material bakes (steel plate tint,
// pressure/grain map, blood blade decal) to power-of-two lossy WebP, matching
// the sibling production bakes' pipeline instead of shipping raw PNG masters
// verbatim from public/. Unlike the Blender-frame atlas packagers in this
// directory (package_warrior_crush.mjs and friends), these three are not
// sprite sheets: each source is already the single finished texture the
// renderer samples, so this script only resizes and re-encodes it.
//
// node scripts/assets/vfx_production/package_warrior_materials.mjs
//
// The PNG masters are deleted by the caller after a successful run (plain
// `rm`, never `git rm`, per this repo's no-state-changing-git-commands rule
// for an agent); this script only ever writes the new .webp siblings.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const PRODUCTION_DIR = path.resolve('public/textures/vfx/production');
// Lossy quality matching the sibling non-lossless production bakes
// (package_warrior_power.py, package_shout_dust.py: quality 94).
const WEBP_QUALITY = 94;

/** One row per source: its current on-disk size (guards against packaging a
 * stale or swapped-out source unnoticed) and its power-of-two output size. */
const TARGETS = [
  {
    name: 'warrior_forged_steel',
    sourceSize: [1254, 1254],
    outputSize: [1024, 1024],
  },
  {
    name: 'warrior_pressure',
    sourceSize: [1254, 1254],
    outputSize: [1024, 1024],
  },
  {
    // 1774x887 is closer to 2048x1024 than to 1024x512 (delta 274 vs 750 on
    // the long edge), and the blade decal is sampled at close range on the
    // held weapon (sanguineWeaponGeometry in
    // src/render/characters/sanguine_weapon_sheath.ts), so the larger target
    // keeps the detail instead of halving it.
    name: 'warrior_blood_blade',
    sourceSize: [1774, 887],
    outputSize: [2048, 1024],
  },
];

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function packageOne({ name, sourceSize, outputSize }) {
  const inputPath = path.join(PRODUCTION_DIR, `${name}.png`);
  const outputPath = path.join(PRODUCTION_DIR, `${name}.webp`);
  const input = await readFile(inputPath);
  const beforeBytes = input.byteLength;
  const metadata = await sharp(input).metadata();
  assert.equal(metadata.width, sourceSize[0], `${name}: unexpected source width`);
  assert.equal(metadata.height, sourceSize[1], `${name}: unexpected source height`);
  assert.equal(metadata.hasAlpha, false, `${name}: source gained an alpha channel`);
  const [width, height] = outputSize;
  const bytes = await sharp(input)
    .resize(width, height, { fit: 'fill' })
    .webp({ quality: WEBP_QUALITY, effort: 6 })
    .toBuffer();
  await writeFile(outputPath, bytes);
  const afterMetadata = await sharp(bytes).metadata();
  assert.equal(afterMetadata.width, width, `${name}: output width drifted`);
  assert.equal(afterMetadata.height, height, `${name}: output height drifted`);
  return {
    name,
    input: path.relative(process.cwd(), inputPath),
    output: path.relative(process.cwd(), outputPath),
    beforeBytes,
    afterBytes: bytes.byteLength,
    beforeDimensions: sourceSize,
    afterDimensions: outputSize,
    sha256: sha256(bytes),
  };
}

async function main() {
  const report = [];
  for (const target of TARGETS) {
    report.push(await packageOne(target));
  }
  console.log(JSON.stringify(report, null, 2));
}

// Fails loudly (non-zero exit) on any assertion above; nothing here retries
// or falls back, matching the other packagers in this directory.
await main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

export { TARGETS, WEBP_QUALITY };
