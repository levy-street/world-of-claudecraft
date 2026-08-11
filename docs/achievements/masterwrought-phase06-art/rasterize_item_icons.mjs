// Rasterize the six phase 06 inscription item-icon SVG sources in this directory to the
// shipping 128x128 fully opaque WebP squares under public/ui/items/, using the repo's
// sharp dependency directly (the sources are authored at the shipping size, so the
// assets:items 512px-master converter does not apply; this mirrors the phase 04/05
// SVG-raster method). Each SVG is supersampled at 4x, downscaled to 128, flattened onto
// its own opaque painted ground, alpha-stripped, and encoded with the converter's tuned
// q82 WebP settings. The script verifies every output decodes as an opaque 128x128 sRGB
// WebP within the 15 KiB shipping budget and that all six are byte-unique, then prints
// the accepted sha256 and byte size per id for the provenance record.
//
// Run from the repo root:  node docs/achievements/masterwrought-phase06-art/rasterize_item_icons.mjs

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const itemsDir = path.join(repoRoot, 'public/ui/items');
const IDS = [
  'silverleaf_primer',
  'goldleaf_folio',
  'sunpetal_grimoire',
  'silverleaf_scroll',
  'goldleaf_scroll',
  'sunpetal_scroll',
];
const ICON_SIZE = 128;
const SIZE_CAP = 15 * 1024;
const QUALITY = 82;

const seenHashes = new Map();
for (const id of IDS) {
  const svg = readFileSync(path.join(here, `${id}.svg`));
  const png = await sharp(svg, { density: 288 })
    .resize(ICON_SIZE, ICON_SIZE, { fit: 'fill' })
    .flatten({ background: '#0a0a08' })
    .removeAlpha()
    .png()
    .toBuffer();
  const webp = await sharp(png)
    .webp({ quality: QUALITY, alphaQuality: 100, effort: 6, smartSubsample: true })
    .toBuffer();
  const meta = await sharp(webp).metadata();
  if (meta.format !== 'webp' || meta.width !== ICON_SIZE || meta.height !== ICON_SIZE) {
    throw new Error(`${id}: bad output geometry ${meta.format} ${meta.width}x${meta.height}`);
  }
  if (meta.hasAlpha) throw new Error(`${id}: output kept an alpha channel`);
  if (meta.space !== 'srgb') throw new Error(`${id}: output colorspace ${meta.space}`);
  if (webp.length > SIZE_CAP) throw new Error(`${id}: ${webp.length} bytes exceeds ${SIZE_CAP}`);
  const hash = createHash('sha256').update(webp).digest('hex');
  if (seenHashes.has(hash)) throw new Error(`${id}: byte-identical to ${seenHashes.get(hash)}`);
  seenHashes.set(hash, id);
  writeFileSync(path.join(itemsDir, `${id}.webp`), webp);
  process.stdout.write(`${id} sha256 ${hash} bytes ${webp.length}\n`);
}
