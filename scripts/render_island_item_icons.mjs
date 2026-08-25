// One-off: render the Proving Shore's interact-prop item icons from the
// REAL world models the player clicks (the castaway crate's supply_crate GLB,
// the ferry bell's marsh_bell_gallows GLB, and the death lesson's Passing
// Stone, which reuses the round gravestone), composited over the item-icon
// vignette at the shipped 128px. A sibling of render_finder_portraits.mjs
// (same bundled stills entry, same server, same sharp finishing); the outputs
// land in public/ui/items/ and are committed like any painted icon.

import { writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { BROWSER_PATH } from './browser_path.mjs';
import { PORTRAIT_RENDER_DEFINES } from './lib/mob_portrait_jobs.mjs';

const root = process.cwd();
const publicDir = path.join(root, 'public');
const OUT_PX = 128;

const JOBS = [
  { itemId: 'ps_castaway_crate', spec: { url: '/models/quest/supply_crate.glb' } },
  { itemId: 'ps_ferry_bell', spec: { url: '/models/props/marsh_bell_gallows.glb' } },
  { itemId: 'ps_passing_stone', spec: { url: '/models/props/gravestone_round.glb' } },
];

const bundled = await esbuild.build({
  entryPoints: [path.join(root, 'scripts', 'wiki', 'stills_render_entry.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  absWorkingDir: root,
  define: PORTRAIT_RENDER_DEFINES,
  write: false,
  logLevel: 'silent',
});
const bundleJs = bundled.outputFiles[0].text;
if (bundleJs.includes('import.meta') || /\bimport_meta\b/.test(bundleJs)) {
  throw new Error('stills bundle still reads an import.meta.env field with no define');
}

const HARNESS = `<!doctype html><html><head><meta charset="utf8"><style>html,body{margin:0;background:transparent}</style></head><body><script src="/__icons_bundle.js"></script></body></html>`;
const MIME = {
  '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ktx2': 'image/ktx2',
  '.hdr': 'image/vnd.radiance',
  '.json': 'application/json',
  '.gltf': 'model/gltf+json',
};
const server = http.createServer(async (req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/__icons.html') {
    res.setHeader('content-type', 'text/html');
    res.end(HARNESS);
    return;
  }
  if (url === '/__icons_bundle.js') {
    res.setHeader('content-type', 'text/javascript');
    res.end(bundleJs);
    return;
  }
  const filePath = path.normalize(path.join(publicDir, url));
  if (filePath !== publicDir && !filePath.startsWith(publicDir + path.sep)) {
    res.statusCode = 403;
    res.end('forbidden');
    return;
  }
  try {
    const buf = await readFile(filePath);
    res.setHeader(
      'content-type',
      MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    );
    res.end(buf);
  } catch {
    res.statusCode = 404;
    res.end('not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();

// The item-icon vignette: a soft radial glow over near-black, the shipped
// icon family's ground.
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
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('PAGEERR', e.message));
await page.goto(`http://127.0.0.1:${port}/__icons.html`, { waitUntil: 'load', timeout: 30000 });
await page.waitForFunction('window.__ready === true', { timeout: 20000 });

for (const job of JOBS) {
  const pngUrl = await page.evaluate((s) => window.renderStill(s, null), job.spec);
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
