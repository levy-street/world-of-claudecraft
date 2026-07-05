// Render the Combat-Mech with each chroma texture applied, as preview PNGs.
// Drives headless system Chrome (puppeteer-core) running the esbuild bundle of
// scripts/mech_render_entry.js. The mech GLB is parsed once; each chroma PNG is
// passed as base64, swapped onto the shared material, and rendered.
//
// Prereq: bundle the entry first —
//   npx esbuild scripts/mech_render_entry.js --bundle --format=iife --outfile=tmp/mech_render_bundle.js
// Run:
//   node scripts/render_mech_chromas.mjs
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const GLB = 'tmp/asset_src/Mech/characters/CombatMech.glb';
const CHROMA_DIR = process.argv[2] || 'tmp/asset_src/Mech/textures/chromas';
const BASE_TEX = 'tmp/asset_src/Mech/textures/combatmech_texture.png';
const OUT = process.argv[3] || 'tmp/chroma_work/shots';
const OUT_PX = Number(process.argv[4] || 1000);
const SKIP_BASE = process.argv[5] === 'nobase';
mkdirSync(OUT, { recursive: true });

const BUNDLE = 'tmp/mech_render_bundle.js';
if (!existsSync(BUNDLE)) { console.error(`missing ${BUNDLE} — bundle the entry first (see header)`); process.exit(1); }
const bundle = readFileSync(BUNDLE, 'utf8');
const html = `<!doctype html><html><head><meta charset="utf8"><style>html,body{margin:0;background:#000}</style></head><body><script>${bundle}</script></body></html>`;

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--ignore-gpu-blocklist', '--no-sandbox', '--enable-webgl'],
});
const page = await browser.newPage();
let pageErr = 0;
page.on('pageerror', (e) => { pageErr++; console.error('PAGEERR', e.message); });
page.on('console', (m) => { if (m.type() === 'error') console.error('CONSOLE', m.text()); });

await page.setContent(html, { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', { timeout: 20000 });

const glbB64 = readFileSync(GLB).toString('base64');

async function downscale(dataUrl, px) {
  return page.evaluate(async (url, p) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const c = document.createElement('canvas'); c.width = p; c.height = p;
    const cx = c.getContext('2d');
    cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
    cx.drawImage(img, 0, 0, p, p);
    return c.toDataURL('image/png');
  }, dataUrl, px);
}

async function shoot(texPath, outName) {
  const texB64 = readFileSync(texPath).toString('base64');
  const full = await page.evaluate((g, t) => window.renderMech(g, t), glbB64, texB64);
  const small = await downscale(full, OUT_PX);
  writeFileSync(path.join(OUT, outName), Buffer.from(small.split(',')[1], 'base64'));
  console.log(`✓ ${outName}`);
}

// base first (sanity / framing), then all chromas
if (!SKIP_BASE) await shoot(BASE_TEX, '00_base.png');
const chromas = readdirSync(CHROMA_DIR).filter((f) => f.endsWith('.png')).sort();
for (const f of chromas) await shoot(path.join(CHROMA_DIR, f), f.replace(/^combatmech_/, ''));

await browser.close();
console.log(`\nrendered ${chromas.length + 1} shots -> ${OUT}  pageErrors=${pageErr}`);
