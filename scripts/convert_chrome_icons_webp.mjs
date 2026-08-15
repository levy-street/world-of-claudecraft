// Normalize the painted HUD-chrome launcher art to 128x128 WebP with a real alpha matte.
//
// Drop new art into public/ui/chrome/ in ANY common raster format
// (.png/.jpg/.jpeg/.gif/.bmp/.tif/.tiff/.avif), then run:  npm run assets:chrome
// The ORIGINAL is deleted, so the committed tree is always WebP only (the guard in
// tests/chrome_icons.test.ts fails if a non-webp image is ever committed). The file
// basename IS the icon name, which must then be listed in CHROME_ART_IDS
// (src/ui/chrome_icon_art.ts) and must be a real UiIconName.
//
// Sibling of scripts/convert_item_icons_webp.mjs. The one behavioral difference, and the
// reason this is its own script rather than another items-style pass: this art is authored
// on a FLAT MAGENTA (#FF00FF) key instead of arriving with an alpha channel, because the
// image generator that produces it cannot emit transparency. So the pipeline here is
// key -> despill -> trim -> pad -> resize -> encode:
//
//   1. Key:     alpha comes from "magenta-ness" (min(r,b) - g). Pure key = 255, and every
//               colour in the approved palette (gold r>g>b, cream, parchment, the arcane
//               blue r<g) scores at or below zero, so nothing in the art is keyed. The
//               ramp between LO and HI keeps antialiased edges soft instead of jagged.
//   2. Despill: a pixel with BOTH r>g and b>g carries magenta spill from the key edge (no
//               palette colour satisfies both). Pull r and b back toward g in proportion to
//               how keyed the pixel is, or every icon ships a pink fringe on dark chrome.
//   3. Trim:    the generator frames loosely and does not always return a square, so the
//               content bounding box is measured from the alpha and re-centered. Without
//               this, icons render at visibly different optical sizes in the same rail.
//   4. Pad:     content is fitted to CONTENT_SIZE inside the ICON_SIZE square, so every
//               icon in the set shares one optical margin.
//
// Nothing converts at BUILD time (this is a pre-commit tool, NOT wired into `npm run
// build`, so CI never re-encodes). Re-running with everything already WebP is a no-op.
//
// Flags: --quality <n> overrides the default 88.

import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const chromeDir = path.join(root, 'public/ui/chrome');

// The served icon square, and the box the trimmed content is fitted into inside it. The
// HUD renders these at 20 to 26px and upscales on 3x mobile, so the master stays at 128.
const ICON_SIZE = 128;
const CONTENT_SIZE = 118;

// Key ramp on the magenta-ness score: at or below LO the pixel is fully opaque art, at or
// above HI it is fully transparent background, and in between it fades. Pure #FF00FF
// scores 255; the palette's warmest gold scores well below zero.
const KEY_LO = 60;
const KEY_HI = 140;

// Foreign (non-webp) raster inputs we know how to convert. Any .webp is left alone.
const SOURCE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tif', '.tiff', '.avif']);

const qFlag = process.argv.indexOf('--quality');
const quality = qFlag !== -1 ? Number(process.argv[qFlag + 1]) : 88;
if (!Number.isFinite(quality) || quality < 1 || quality > 100) {
  console.error('[assets:chrome] --quality must be a number 1..100');
  process.exit(1);
}

// smartSubsample defeats the 4:2:0 colored-halo artifact on the saturated gold edges, and
// alphaQuality 100 keeps the keyed matte crisp (the whole point of this set).
const webpOptions = { quality, alphaQuality: 100, smartSubsample: true, effort: 6 };

/** Key the flat magenta background out to alpha and despill the edge, in place. */
function keyMagenta(data, pixels) {
  for (let i = 0; i < pixels; i++) {
    const o = i * 4;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    const keyness = Math.min(r, b) - g;
    let alpha = 255;
    if (keyness >= KEY_HI) alpha = 0;
    else if (keyness > KEY_LO) alpha = Math.round((255 * (KEY_HI - keyness)) / (KEY_HI - KEY_LO));
    data[o + 3] = alpha;
    // Despill only where the pixel actually carries the key hue (both channels above
    // green). Gold (b < g), cream (b < g), and the arcane blue (r < g) never qualify.
    if (alpha > 0 && r > g && b > g) {
      const excess = Math.min(r, b) - g;
      const strength = 1 - alpha / 255; // fully opaque interior art is left untouched
      const cut = excess * Math.max(strength, 0.5);
      data[o] = Math.max(g, r - cut);
      data[o + 2] = Math.max(g, b - cut);
    }
  }
}

/** Bounding box of every pixel with a non-trivial alpha, or null when fully transparent. */
function alphaBounds(data, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0
    ? null
    : { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

async function convert(file) {
  const raw = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { data, info } = raw;
  keyMagenta(data, info.width * info.height);

  const bounds = alphaBounds(data, info.width, info.height);
  if (!bounds) throw new Error('every pixel keyed out (is the art on a magenta background?)');

  const pad = Math.round((ICON_SIZE - CONTENT_SIZE) / 2);
  const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
  const out = path.join(path.dirname(file), `${path.basename(file, path.extname(file))}.webp`);
  // One pipeline: sharp applies extract -> resize -> extend in that order, so the keyed raw
  // buffer never round-trips through an intermediate encode.
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .extract(bounds)
    .resize(CONTENT_SIZE, CONTENT_SIZE, { fit: 'contain', background: transparent })
    .extend({
      top: pad,
      bottom: ICON_SIZE - CONTENT_SIZE - pad,
      left: pad,
      right: ICON_SIZE - CONTENT_SIZE - pad,
      background: transparent,
    })
    .webp(webpOptions)
    .toFile(out);
  return out;
}

async function main() {
  if (!existsSync(chromeDir)) {
    console.error(`[assets:chrome] no chrome dir at ${path.relative(root, chromeDir)}`);
    process.exit(1);
  }

  const sources = readdirSync(chromeDir, { withFileTypes: true })
    .filter((ent) => ent.isFile() && SOURCE_EXTS.has(path.extname(ent.name).toLowerCase()))
    .map((ent) => path.join(chromeDir, ent.name))
    .sort();

  if (sources.length === 0) {
    console.log('[assets:chrome] nothing to convert (tree is already WebP only)');
    return;
  }

  let converted = 0;
  for (const file of sources) {
    const name = path.basename(file);
    try {
      const out = await convert(file);
      unlinkSync(file);
      converted++;
      console.log(`[assets:chrome] ${name} -> ${path.basename(out)}`);
    } catch (err) {
      console.error(`[assets:chrome] FAILED ${name}: ${err.message}`);
      process.exitCode = 1;
    }
  }
  console.log(`[assets:chrome] converted ${converted}/${sources.length} at quality ${quality}`);
}

await main();
