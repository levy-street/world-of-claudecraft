// Renders the layered-SVG crown source (crown.svg, authored in-repo to the
// chrome icon art direction) onto the flat magenta key the chrome converter
// expects, then invokes the converter script (the same one `npm run
// assets:chrome` wraps) so the intermediate crown.png does not linger in
// public/ (which deploys verbatim): the converter keys, trims, centers,
// encodes the shipping 128px WebP, and unlinks the PNG. If the converter
// fails, the stray PNG is caught by the WebP-only arm of
// tests/chrome_icons.test.ts rather than shipping.
//
// Run by hand from the repo root:
//   node scripts/assets/chrome_crown/render_source.mjs

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const src = path.join(here, 'crown.svg');
const out = path.join(repoRoot, 'public', 'ui', 'chrome', 'crown.png');

// 512px master on the flat #FF00FF key (KEY_LO/KEY_HI in the converter).
const crown = await sharp(src, { density: 288 })
  .resize(512, 512, { fit: 'contain', background: { r: 255, g: 0, b: 255, alpha: 1 } })
  .toBuffer();
await sharp({
  create: { width: 512, height: 512, channels: 3, background: { r: 255, g: 0, b: 255 } },
})
  .composite([{ input: crown }])
  .png()
  .toFile(out);
console.log(`wrote ${path.relative(repoRoot, out)}; converting...`);
execFileSync('node', [path.join(repoRoot, 'scripts', 'convert_chrome_icons_webp.mjs')], {
  cwd: repoRoot,
  stdio: 'inherit',
});
