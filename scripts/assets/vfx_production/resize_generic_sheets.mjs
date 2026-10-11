// Downsize the GENERIC baked VFX sheets (smoke, shout dust, shockwave, the
// harvest impact splash) from 2048px to 1024px. They are soft, low-frequency
// alpha sheets drawn well under a quarter of the screen, so 2048px buys
// nothing on screen and costs 16 MB of RGBA each once decoded; at 1024px each
// is 4 MB. The signature Warrior sheets (power, fervor, bite, shear, crush)
// keep their authored resolution.
//
// The frame-baked 8x8 grids scale uniformly, so cell framing and the baked
// gutters are preserved. The Blender frame sources behind these sheets are
// not committed, so this re-encodes the shipped sheet (lossless decode, Lanczos
// resample, the same WebP quality the sibling packagers use). Idempotent: a
// sheet already at 1024px is left alone.
//
// Usage: node scripts/assets/vfx_production/resize_generic_sheets.mjs [--dry-run]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const TARGET = 1024;
const QUALITY = 94;
const SHEETS = ['smoke', 'shout_dust', 'shockwave', 'harvest_impact'];
const dryRun = process.argv.includes('--dry-run');

for (const name of SHEETS) {
  const file = resolve(ROOT, 'public', 'textures', 'vfx', 'production', `${name}.webp`);
  const before = readFileSync(file);
  const meta = await sharp(before).metadata();
  if (meta.width === TARGET && meta.height === TARGET) {
    console.log(`${name}: already ${TARGET}px, skipped`);
    continue;
  }
  if (meta.width !== meta.height) throw new Error(`${name}: expected a square sheet`);
  const after = await sharp(before)
    .resize(TARGET, TARGET, { kernel: sharp.kernel.lanczos3, fit: 'fill' })
    .webp({ quality: QUALITY, effort: 6 })
    .toBuffer();
  console.log(
    `${name}: ${meta.width}px ${(before.length / 1024).toFixed(0)} KB -> ${TARGET}px ${(after.length / 1024).toFixed(0)} KB`,
  );
  if (!dryRun) writeFileSync(file, after);
}
if (!dryRun)
  console.log('regenerate the media manifest: node scripts/build_media_manifest.mjs generate');
