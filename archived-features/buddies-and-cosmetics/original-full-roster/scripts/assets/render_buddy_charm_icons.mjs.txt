// Renders the bag-icon WebP for every buddy COSMETIC charm item (ItemDef kind
// 'buddy_cosmetic', content/items.ts) by re-tinting the committed whistle icon
// of the companion the look belongs to: the same rendered-from-GLB still the
// whistle ships, multiplied toward the cosmetic's own dye. Deterministic, no
// text-to-image generation, no internet reference art; the charm reads as
// "that companion, in that look", which is exactly what using it unlocks.
//
// Usage: node scripts/assets/render_buddy_charm_icons.mjs
import { existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'public/ui/items');

/** charm item id -> [source whistle id, tint] (content/buddy_cosmetics.ts). */
export const CHARM_ICON_BATCH = [
  { itemId: 'charm_stag_acorn', source: 'whistle_stag', tint: 0xb8863b },
  { itemId: 'charm_stag_gilded', source: 'whistle_stag', tint: 0xffd700 },
];

const ICON_SIZE = 128;

async function renderOne({ itemId, source, tint }) {
  const src = path.join(OUT_DIR, `${source}.webp`);
  if (!existsSync(src)) throw new Error(`missing source icon ${src}`);
  const r = (tint >> 16) & 0xff;
  const g = (tint >> 8) & 0xff;
  const b = tint & 0xff;
  // A 50% lerp toward the dye over the whole still: strong enough to read as
  // the look at 32px in a bag cell, weak enough to keep the silhouette.
  const dyed = await sharp(src)
    .resize(ICON_SIZE, ICON_SIZE)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const px = dyed.data;
  for (let i = 0; i < px.length; i += 3) {
    px[i] = Math.round(px[i] * 0.5 + r * 0.5);
    px[i + 1] = Math.round(px[i + 1] * 0.5 + g * 0.5);
    px[i + 2] = Math.round(px[i + 2] * 0.5 + b * 0.5);
  }
  await sharp(px, { raw: { width: dyed.info.width, height: dyed.info.height, channels: 3 } })
    .webp({ quality: 82, effort: 6 })
    .toFile(path.join(OUT_DIR, `${itemId}.webp`));
  console.log(`rendered ${itemId}.webp from ${source}`);
}

for (const entry of CHARM_ICON_BATCH) await renderOne(entry);
