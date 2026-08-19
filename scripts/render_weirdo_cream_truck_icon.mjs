// Render the Weirdo Cream truck's bag icon: the driver's portrait, not the van.
//
//   node scripts/render_weirdo_cream_truck_icon.mjs
//
// Every other mount icon is a framed close-up of the creature's head rendered
// off its GLB (scripts/render_mount_icons.mjs). A van has no head, and a shrunk
// three-quarter view of the whole vehicle reads as a grey lump at 128px, so this
// mount takes its icon from the same portrait the truck itself wears on its rear
// shutter: it is the most recognizable thing about the mount and it survives the
// downscale, because it is a face.
//
// Deterministic and self-contained: the portrait comes straight out of the
// signage atlas the GLB is textured from (scripts/assets/weirdo_cream_truck/
// decal_atlas.mjs), so the icon and the decal can never drift apart, and there
// is no browser in the loop.

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { buildDecalAtlas, DECAL_REGIONS } from './assets/weirdo_cream_truck/decal_atlas.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUTPUT = join(REPO_ROOT, 'public/ui/items/reins_weirdo_cream_truck.webp');
/** Matches the other item icons. */
const ICON_SIZE = 128;
/** Supersample factor for the circular mask, so the badge rim stays smooth. */
const SUPERSAMPLE = 4;
/** The near-black plate the other item icons already sit on, sampled from them,
 *  so the flattened corners match the family instead of inventing a colour. */
const ICON_BACKDROP = { r: 12, g: 12, b: 12 };

const atlas = await buildDecalAtlas();
const region = DECAL_REGIONS.portrait;
const left = Math.round(region.u0 * atlas.size);
const top = Math.round(region.v0 * atlas.size);
const width = Math.round((region.u1 - region.u0) * atlas.size);
const height = Math.round((region.v1 - region.v0) * atlas.size);

// Alpha mask: keep the badge plate and cut the square corners, so the icon reads
// as a round token. The corners are then FLATTENED onto the same near-black
// plate the rest of the item art carries rather than left transparent: every
// shipping item icon is fully opaque, and tests/item_art_consistency.test.ts
// fails any icon that is not (a transparent corner reads as a hole against the
// bag grid's own background).
const masked = ICON_SIZE * SUPERSAMPLE;
const mask = Buffer.alloc(masked * masked);
const radius = masked / 2;
for (let y = 0; y < masked; y++) {
  for (let x = 0; x < masked; x++) {
    const dx = x - radius + 0.5;
    const dy = y - radius + 0.5;
    mask[y * masked + x] = Math.hypot(dx, dy) <= radius ? 255 : 0;
  }
}

// Two pipelines on purpose: sharp honours only ONE resize per pipeline, so
// upscaling, joining the mask, and downsampling in a single chain silently
// drops the mask (the joined channel no longer matches the final dimensions).
// Stage one renders the masked badge at supersampled size...
const supersampled = await sharp(atlas.pixels, {
  raw: { width: atlas.size, height: atlas.size, channels: 3 },
})
  .extract({ left, top, width, height })
  .resize(masked, masked, { kernel: sharp.kernel.lanczos3 })
  .joinChannel(mask, { raw: { width: masked, height: masked, channels: 1 } })
  .png()
  .toBuffer();

// ...stage two resolves it down, which is what antialiases the rim.
const icon = await sharp(supersampled)
  .resize(ICON_SIZE, ICON_SIZE, { kernel: sharp.kernel.lanczos3 })
  .flatten({ background: ICON_BACKDROP })
  .webp({ quality: 92, effort: 6 })
  .toBuffer();

mkdirSync(dirname(OUTPUT), { recursive: true });
await sharp(icon).toFile(OUTPUT);
console.log(`weirdo cream truck icon: ${OUTPUT} (${(icon.length / 1024).toFixed(1)} KB)`);
