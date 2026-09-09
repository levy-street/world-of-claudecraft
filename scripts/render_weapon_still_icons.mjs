// Deterministic inventory icons for weapons that ship in-engine stills of their
// committed held GLBs (renderWeaponAlpha in scripts/weapon_render_entry.js)
// composited on the shared item-icon vignette, shipped at 128px webp.
//
// One script, one jobs table per batch: the recipe is the one
// scripts/render_island_item_icons.mjs (vignette) and
// scripts/render_varkhul_drop_icons.mjs (weapon stills) established; this
// generalizes it so a new render wave adds a jobs JSON under its
// docs/achievements/<batch>/ provenance directory instead of a third copy of
// the script. Jobs table shape:
//   { "jobs": [{ "itemId": "<item id>", "glb": "models/weapons/<key>.glb",
//                "pose": [x, y, z] }] }
// where pose is an XYZ euler into the shared framing rig (the catalog diagonal
// is [0.18, -0.5, -0.42]).
//
// Prereq: bundle the entry first:
//   npx esbuild scripts/weapon_render_entry.js --bundle --format=iife \
//     --define:import.meta.url='"http://127.0.0.1/"' --outfile=tmp/weapon_render_bundle.js
// Run:
//   node scripts/render_weapon_still_icons.mjs docs/achievements/<batch>/render-jobs.json
import { readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { BROWSER_PATH } from './browser_path.mjs';
import { ktx2TranscoderScriptTag } from './lib/ktx2_assets.mjs';

const OUT_PX = 128;
const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(repoDir, 'public');

const jobsPath = process.argv[2];
if (!jobsPath) {
  console.error('usage: node scripts/render_weapon_still_icons.mjs <render-jobs.json>');
  process.exit(1);
}
const { jobs: JOBS } = JSON.parse(readFileSync(path.resolve(repoDir, jobsPath), 'utf8'));
if (!Array.isArray(JOBS) || JOBS.length === 0) throw new Error(`${jobsPath}: no jobs`);
for (const job of JOBS) {
  if (!job.itemId || !job.glb || !Array.isArray(job.pose) || job.pose.length !== 3) {
    throw new Error(`${jobsPath}: malformed job ${JSON.stringify(job)}`);
  }
}

const BUNDLE = path.join(repoDir, 'tmp', 'weapon_render_bundle.js');
const bundle = readFileSync(BUNDLE, 'utf8');
const ktx2Tag = ktx2TranscoderScriptTag(repoDir);
const html = `<!doctype html><html><head><meta charset="utf8"><style>html,body{margin:0;background:#000}</style></head><body>${ktx2Tag}<script>${bundle}</script></body></html>`;

// The item-icon vignette: a soft radial glow over near-black, the shipped
// icon family's ground (render_island_item_icons.mjs).
const backgroundSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${OUT_PX}" height="${OUT_PX}"><defs><radialGradient id="g" cx="50%" cy="42%" r="62%"><stop offset="0%" stop-color="#3a3527"/><stop offset="55%" stop-color="#211d15"/><stop offset="100%" stop-color="#0d0b08"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--use-angle=swiftshader',
    '--use-gl=angle',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    '--no-sandbox',
  ],
});
// Serve the page over loopback: the ktx2 transcoder attach resolves URLs
// against the page origin, and about:blank (setContent) has none.
const server = http.createServer((req, res) => {
  if (req.url === '/__icons.html') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(html);
    return;
  }
  const rel = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\/+/, '');
  const file = path.join(publicDir, rel);
  try {
    const body = readFileSync(file);
    res.writeHead(200);
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();

const page = await browser.newPage();
page.on('pageerror', (e) => console.error('PAGEERR', e.message));
await page.goto(`http://127.0.0.1:${port}/__icons.html`, { waitUntil: 'load', timeout: 30000 });
await page.waitForFunction('window.__ready === true', { timeout: 20000 });

for (const job of JOBS) {
  const b64 = readFileSync(path.join(publicDir, job.glb)).toString('base64');
  const pngUrl = await page.evaluate(
    (b, size, pose) => window.renderWeaponAlpha(b, size, pose),
    b64,
    512,
    job.pose,
  );
  const png = Buffer.from(pngUrl.split(',')[1], 'base64');
  const alpha = (await sharp(png).stats()).channels[3];
  if (!alpha || alpha.max < 8) throw new Error(`blank render for ${job.itemId}`);
  const inset = Math.max(1, Math.round(OUT_PX * 0.09));
  const subject = await sharp(png)
    .trim()
    .resize(OUT_PX - inset * 2, OUT_PX - inset * 2, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .extend({
      top: inset,
      bottom: inset,
      left: inset,
      right: inset,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  const webp = await sharp(Buffer.from(backgroundSvg))
    .composite([{ input: subject }])
    .webp({ quality: 88, alphaQuality: 100, effort: 6 })
    .toBuffer();
  writeFileSync(path.join(publicDir, 'ui', 'items', `${job.itemId}.webp`), webp);
  console.log(`ok ${job.itemId}.webp (${(webp.length / 1024).toFixed(1)} KB)`);
}
await browser.close();
server.close();
console.log('ICONS DONE');
