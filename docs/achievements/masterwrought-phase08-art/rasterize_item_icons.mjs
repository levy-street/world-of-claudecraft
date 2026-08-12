// Phase 08 apex armor: hand-authored original SVG compositions (one committed
// <id>.svg source per item in this directory), rasterized to 512x512
// fully-opaque sRGB PNG masters for the item icon converter
// (npm run assets:items). woc-item-icon-v1 register: single centered subject
// at roughly 70 percent fill, opaque dark painted vignette, warm top-left key
// light, cool lower-right shadow, grounded contact shadow, no text or frames.
// Unlike the phase 07 sibling (which composed its SVGs in-script), this
// rasterizer READS the committed sources, so authoring and rasterization stay
// decoupled; the acceptance checks (count, title, size, opacity) are the same.
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('/Users/fernando/Documents/wocc-masterwrought/package.json');
const sharp = require('sharp');

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
const EXPECTED_IDS = [
  'spiritweld_girdle',
  'forgefold_legguards',
  'wardspeaker_sabatons',
  'briarstep_jerkin',
  'fenbloom_breeches',
  'barksong_handguards',
  'sunspun_vestments',
  'sunspun_leggings',
  'sunspun_handwraps',
  'sunspun_haversack',
];

const svgFiles = readdirSync(SRC_DIR)
  .filter((f) => f.endsWith('.svg'))
  .map((f) => path.basename(f, '.svg'))
  .sort();
const expected = [...EXPECTED_IDS].sort();
if (JSON.stringify(svgFiles) !== JSON.stringify(expected)) {
  console.error(`svg set mismatch: found [${svgFiles}], expected [${expected}]`);
  process.exit(1);
}

const target = process.argv[2];
if (!target) {
  console.log('usage: node rasterize_item_icons.mjs <out-dir>');
  process.exit(1);
}
mkdirSync(target, { recursive: true });

for (const id of EXPECTED_IDS) {
  const svg = readFileSync(path.join(SRC_DIR, `${id}.svg`), 'utf8');
  // The <title> element is the phase 06 convention and the biome a11y
  // noSvgWithoutTitle contract; it renders no pixels.
  if (!/<title>[^<]+<\/title>/.test(svg)) {
    console.error(`${id}.svg: missing <title>`);
    process.exit(1);
  }
  const png = await sharp(Buffer.from(svg))
    .resize(512, 512, { fit: 'fill' })
    .flatten({ background: '#101014' })
    .removeAlpha()
    .toColorspace('srgb')
    .png()
    .toBuffer();
  const meta = await sharp(png).metadata();
  if (meta.width !== 512 || meta.height !== 512) {
    console.error(`${id}: unexpected raster size ${meta.width}x${meta.height}`);
    process.exit(1);
  }
  writeFileSync(path.join(target, `${id}.png`), png);
  console.log(`rasterized ${id}.png (${png.length} bytes)`);
}
