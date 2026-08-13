// Phase 09 apex weapons, jewelry, and tools: hand-authored original SVG
// compositions (one committed <id>.svg source per item in this directory),
// rasterized to 512x512 fully-opaque sRGB PNG masters for the item icon
// converter (npm run assets:items). woc-item-icon-v1 register: single centered
// subject at roughly 70 percent fill, opaque dark painted vignette, warm
// top-left key light, cool lower-right shadow, grounded contact shadow, no
// text or frames. Like the phase 08 sibling, this rasterizer READS the
// committed sources, so authoring and rasterization stay decoupled; the
// acceptance checks (count, title, size, opacity) are the same.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve sharp against the repo root's package.json relative to this file
// (docs/achievements/<dir>/ is three levels down), so the script runs from any
// clone or worktree, not just the machine it was authored on.
const require = createRequire(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..', 'package.json'),
);
const sharp = require('sharp');

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
const EXPECTED_IDS = [
  'duskforged_warblade',
  'duskforged_bulwark',
  'ridgebreaker',
  'wyrmfall_pendant',
  'warhewn_signet',
  'prismglass_loop',
  'makers_charm',
  'gyrelens_array',
  'masters_field_forge',
  'voidbound_grimoire',
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
