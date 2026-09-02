// Render 3D face/front icons for the rideable mounts, for use as the 2D bag/tooltip
// icons on their reins items (and the mount-picker cards). Mirrors the headless-Chrome +
// swiftshader harness of scripts/render_weapon_icons.mjs and the transparent-WebP + blank
// alpha check of scripts/wiki/render_model_stills.mjs, but frames a front three-quarter
// close-up of each mount's head from its own bounding box (see scripts/mount_icon_entry.js
// for the framing rule). Output: public/ui/items/reins_<mount>.webp (128px, transparent),
// wired into ITEM_IMAGE_IDS in src/ui/icons.ts and gated by tests/item_icons.test.ts.
//
// Self-contained (no dev server): the GLB bytes are passed to the page as base64, like the
// weapon renderer. Run: `node scripts/render_mount_icons.mjs` (ONLY=valorsteed,grag_bear to
// render a subset while tuning framing; DEBUG_DIR=<dir> to also drop PNG previews there).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { BROWSER_PATH } from './browser_path.mjs';
import { ktx2TranscoderScriptTag } from './lib/ktx2_assets.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mountsDir = path.join(root, 'public/models/mounts');
const outDir = path.join(root, 'public/ui/items');
const OUT_PX = 128; // matches the existing public/ui/items icon size (mapping.json iconSize)
const debugDir = process.env.DEBUG_DIR || null;
mkdirSync(outDir, { recursive: true });
if (debugDir) mkdirSync(debugDir, { recursive: true });

// Per-mount render jobs. `file` is the GLB basename, `id` the reins item id (icon filename).
// `cfg` overrides the generic head framing (defaults live in the entry); tuned by eye until
// each mount's face fills the frame. All mounts face +Z (the model convention), so `fwd` is
// only set where a model deviates.
const JOBS = [
  {
    file: 'valorsteed.glb',
    id: 'reins_valorsteed',
    cfg: { headFwd: 0.9, headUp: 0.72, fill: 0.5, yaw: 0.5, pitch: 0.18 },
  },
  {
    // The bear carries its head low and forward, below a tall saddle on its back, so anchor
    // low (small headUp) and look near level (tiny pitch) or the camera frames the saddle.
    file: 'grag_bear.glb',
    id: 'reins_grag_bear',
    cfg: { headFwd: 0.95, headUp: 0.3, fill: 0.52, yaw: 0.5, pitch: 0.05 },
  },
  {
    file: 'stalkglider_snail.glb',
    id: 'reins_stalkglider_snail',
    cfg: { headFwd: 0.82, headUp: 0.72, fill: 0.6, yaw: 0.55, pitch: 0.16 },
  },
  {
    file: 'aether_hover_cycle.glb',
    id: 'reins_aether_hover_cycle',
    cfg: { headFwd: 0.84, headUp: 0.42, fill: 0.66, yaw: 0.55, pitch: 0.16 },
  },
  {
    file: 'shadowjump_toad.glb',
    id: 'reins_shadowjump_toad',
    cfg: { headFwd: 0.88, headUp: 0.5, fill: 0.72, yaw: 0.5, pitch: 0.2 },
  },
  {
    file: 'stormfeather_griffin.glb',
    id: 'reins_stormfeather_griffin',
    cfg: { headFwd: 0.88, headUp: 0.7, fill: 0.55, yaw: 0.5, pitch: 0.18 },
  },
  {
    // The gobbler's head rides high on the front of the neck, above mid-body;
    // frame a touch wider so the fanned tail still reads behind the face.
    file: 'thunderstrut_gobbler.glb',
    id: 'reins_thunderstrut_gobbler',
    cfg: { headFwd: 0.7, headUp: 0.7, fill: 0.62, yaw: 0.45, pitch: 0.12 },
  },
  {
    // Show the cannon, prow, and near track together so the silhouette reads
    // as a vehicle even at bag-icon size.
    file: 'terrorspark_groundshaker.glb',
    id: 'reins_terrorspark_groundshaker',
    cfg: { headFwd: 0.1, headUp: 0, fill: 1.18, yaw: 0.68, pitch: 0.24 },
  },
  {
    // The boulder has no head to frame: it is a sphere, so anchor dead centre
    // (headFwd/headUp 0) and fill the frame with the whole stone. The yaw and
    // pitch are only there to catch the rift seams across the terminator rather
    // than flat-on, where they would read as scratches.
    file: 'riftbound_boulder.glb',
    id: 'reins_riftbound_boulder',
    cfg: { headFwd: 0, headUp: 0, fill: 1.08, yaw: 0.62, pitch: 0.22 },
    opaque: true,
  },
  {
    // The raptor carries its head high and well forward on a long neck, above a
    // saddle set back over the hips: anchor forward and high, and look slightly
    // down so the snout reads rather than the saddle behind it.
    file: 'drakemaw_raptor.glb',
    id: 'reins_drakemaw_raptor',
    cfg: { headFwd: 0.95, headUp: 0.82, fill: 0.55, yaw: 0.52, pitch: 0.14 },
  },
];

const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;

// 1) Bundle the browser entry to a self-contained IIFE.
const built = await esbuild.build({
  entryPoints: [path.join(root, 'scripts', 'mount_icon_entry.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  write: false,
  logLevel: 'silent',
  // An IIFE bundle has no module record, so esbuild rewrites bare `import.meta`
  // to `{}` and three's KTX2Loader ends up calling `new URL(undefined, ...)`,
  // which throws 'Invalid URL' before the entry can set window.__ready. The page
  // then only times out, with the real cause 20 seconds upstream. Any absolute
  // base works: nothing is fetched relative to it (the GLB arrives as base64 and
  // the transcoder is inlined as its own script tag), it just has to parse. The
  // page's own baseURI does NOT, because setContent leaves that as about:blank.
  define: { 'import.meta.url': JSON.stringify('https://mount-icon.invalid/entry.js') },
});
const bundleJs = built.outputFiles[0].text;
const ktx2Tag = ktx2TranscoderScriptTag(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
);
const html = `<!doctype html><html><head><meta charset="utf8"><style>html,body{margin:0;background:transparent}</style></head><body>${ktx2Tag}<script>${bundleJs}</script></body></html>`;

// The woc-item-icon-v1 shipping contract (public/ui/items/mapping.json) requires an
// OPAQUE dark ground: a transparent icon fails the catalog gate in
// tests/item_art_consistency.test.ts. A job that opts in with `opaque: true`
// gets its render composited over this vignette, which is built to the same
// values the painted catalog art sits on (near-black corners falling off from a
// slightly lifted centre). Jobs without the flag keep the historical
// transparent output untouched.
const GROUND_CENTER = { r: 0x24, g: 0x21, b: 0x2a };
const GROUND_EDGE = { r: 0x08, g: 0x07, b: 0x0a };

function paintedGround(size) {
  const pixels = Buffer.alloc(size * size * 3);
  const half = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Radial falloff normalized so the corners, not the edge midpoints, are
      // the darkest point: a vignette that bottoms out at the edges leaves the
      // corners flat and the icon reads as a rounded rectangle on a card.
      const radius = Math.min(1, Math.hypot(x - half, y - half) / (half * Math.SQRT2));
      const t = radius * radius;
      const at = (y * size + x) * 3;
      pixels[at] = Math.round(GROUND_CENTER.r + (GROUND_EDGE.r - GROUND_CENTER.r) * t);
      pixels[at + 1] = Math.round(GROUND_CENTER.g + (GROUND_EDGE.g - GROUND_CENTER.g) * t);
      pixels[at + 2] = Math.round(GROUND_CENTER.b + (GROUND_EDGE.b - GROUND_CENTER.b) * t);
    }
  }
  return sharp(pixels, { raw: { width: size, height: size, channels: 3 } })
    .png()
    .toBuffer();
}

// 2) Drive headless Chrome over software WebGL.
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--use-angle=swiftshader',
    '--use-gl=angle',
    '--ignore-gpu-blocklist',
    '--no-sandbox',
    '--enable-webgl',
  ],
});
const page = await browser.newPage();
let pageErr = 0;
page.on('pageerror', (e) => {
  pageErr++;
  console.error('PAGEERR', e.message);
});
page.on('console', (m) => {
  if (m.type() === 'error') console.error('CONSOLE', m.text());
});

await page.setContent(html, { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', { timeout: 20000 });

let ok = 0;
let failed = 0;
for (const job of JOBS) {
  const base = job.file.replace(/\.glb$/, '');
  if (only && !only.has(base) && !only.has(job.id)) continue;
  try {
    const b64 = readFileSync(path.join(mountsDir, job.file)).toString('base64');
    const pngUrl = await page.evaluate((b, c) => window.renderMountFace(b, c), b64, job.cfg);
    const png = Buffer.from(pngUrl.split(',')[1], 'base64');
    // Reject a silently blank/off-frame render: a still that frames nothing still encodes a
    // valid, fully transparent PNG the file-existence gate cannot catch (guide stills do the
    // same). If no pixel is meaningfully opaque, the mount was not drawn, so fail the job.
    const alpha = (await sharp(png).stats()).channels[3];
    if (!alpha || alpha.max < 8) {
      throw new Error(`blank render (alpha max ${alpha ? alpha.max : 'none'})`);
    }
    const framed = job.opaque
      ? await sharp(await paintedGround((await sharp(png).metadata()).width))
          .composite([{ input: png }])
          .png()
          .toBuffer()
      : png;
    const webp = await sharp(framed)
      .resize(OUT_PX, OUT_PX, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 90, alphaQuality: 100, effort: 6 })
      .toBuffer();
    writeFileSync(path.join(outDir, `${job.id}.webp`), webp);
    if (debugDir) {
      const previewPng = await sharp(framed)
        .resize(OUT_PX, OUT_PX, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
      writeFileSync(path.join(debugDir, `${job.id}.png`), previewPng);
    }
    ok++;
    console.log(`ok ${job.id}.webp (${(webp.length / 1024).toFixed(1)} KB)`);
  } catch (e) {
    console.error(`FAILED ${job.id}: ${e.message}`);
    failed++;
  }
}

await browser.close();
console.log(
  `\nrendered ${ok}/${JOBS.length} mount icons to public/ui/items (${OUT_PX}px, ${failed} failed, pageErrors=${pageErr})`,
);
if (failed > 0 || pageErr > 0) process.exit(1);
