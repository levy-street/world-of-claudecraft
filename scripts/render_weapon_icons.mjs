// Render small weapon-thumbnail JPGs from staged weapon GLBs, for use as 2D
// item icons in the HUD. Drives a headless browser (puppeteer-core + system
// Chrome via browser_path.mjs) running the esbuild bundle of
// scripts/weapon_render_entry.js. Each GLB is passed as base64 and parsed in
// the page (no network), rendered, and the canvas saved as a downscaled JPG.
//
// Prereq: bundle the entry first —
//   npx esbuild scripts/weapon_render_entry.js --bundle --format=iife --outfile=tmp/weapon_render_bundle.js
// Run:
//   node scripts/render_weapon_icons.mjs [srcDir=tmp/weapon_src] [outDir] [px=128]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const SRC = process.argv[2] || 'tmp/weapon_src';
const OUT = process.argv[3] || 'tmp/weapon_thumbs';
const PX = Number(process.argv[4] || 128);
mkdirSync(OUT, { recursive: true });

const BUNDLE = 'tmp/weapon_render_bundle.js';
if (!existsSync(BUNDLE)) {
  console.error(`missing ${BUNDLE} — bundle the entry first (see header)`);
  process.exit(1);
}
const bundle = readFileSync(BUNDLE, 'utf8');
const html = `<!doctype html><html><head><meta charset="utf8"><style>html,body{margin:0;background:#000}</style></head><body><script>${bundle}</script></body></html>`;

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

// Downscale the 256px render to PX with a smoothing pass, in-page.
async function downscale(dataUrl) {
  return page.evaluate(
    async (url, px) => {
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = url;
      });
      const c = document.createElement('canvas');
      c.width = px;
      c.height = px;
      const cx = c.getContext('2d');
      cx.imageSmoothingEnabled = true;
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(img, 0, 0, px, px);
      return c.toDataURL('image/jpeg', 0.84);
    },
    dataUrl,
    PX,
  );
}

const files = readdirSync(SRC)
  .filter((f) => f.endsWith('.glb'))
  .sort();
let n = 0;
for (const f of files) {
  const b64 = readFileSync(path.join(SRC, f)).toString('base64');
  let full;
  try {
    const renderPx = Math.max(256, PX * 2);
    full = await page.evaluate((b, size) => window.renderWeapon(b, size), b64, renderPx);
  } catch (e) {
    console.error(`FAILED ${f}: ${e.message}`);
    continue;
  }
  const small = await downscale(full);
  const jpg = Buffer.from(small.split(',')[1], 'base64');
  const name = f.replace(/\.glb$/, '.jpg');
  writeFileSync(path.join(OUT, name), jpg);
  n++;
  console.log(`✓ ${name} (${(jpg.length / 1024).toFixed(1)} KB)`);
}

await browser.close();
console.log(`\nrendered ${n}/${files.length} thumbnails → ${OUT} (${PX}px)  pageErrors=${pageErr}`);
