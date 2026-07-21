// Render the 4 EPIC chrome chromas (metallic material + env reflections, no
// bloom). Each epic has an albedo PNG + a matching *_emis.png (eye glow).
//   npx esbuild scripts/mech_render_epic_entry.js --bundle --format=iife --outfile=tmp/mech_render_epic_bundle.js
//   node scripts/render_mech_epics.mjs [outPx=1920]
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const GLB = 'tmp/asset_src/Mech/characters/CombatMech.glb';
const DIR = 'tmp/asset_src/Mech/textures/epics';
const OUT = 'tmp/chroma_work/epic_shots';
const OUT_PX = Number(process.argv[2] || 1920);
mkdirSync(OUT, { recursive: true });

const BUNDLE = 'tmp/mech_render_epic_bundle.js';
if (!existsSync(BUNDLE)) { console.error(`missing ${BUNDLE} — bundle the entry first (see header)`); process.exit(1); }
const html = `<!doctype html><html><head><meta charset="utf8"><style>html,body{margin:0;background:#000}</style></head><body><script>${readFileSync(BUNDLE, 'utf8')}</script></body></html>`;

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH, headless: 'new',
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--ignore-gpu-blocklist', '--no-sandbox', '--enable-webgl'],
});
const page = await browser.newPage();
let pageErr = 0;
page.on('pageerror', (e) => { pageErr++; console.error('PAGEERR', e.message); });
page.on('console', (m) => { if (m.type() === 'error') console.error('CONSOLE', m.text()); });
await page.setContent(html, { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', { timeout: 30000 });

const glbB64 = readFileSync(GLB).toString('base64');
async function downscale(dataUrl, px) {
  return page.evaluate(async (url, p) => {
    const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const c = document.createElement('canvas'); c.width = p; c.height = p;
    const cx = c.getContext('2d'); cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
    cx.drawImage(img, 0, 0, p, p); return c.toDataURL('image/png');
  }, dataUrl, px);
}

const albedos = readdirSync(DIR).filter((f) => f.endsWith('.png') && !f.endsWith('_emis.png')).sort();
let n = 0;
for (const f of albedos) {
  const aB64 = readFileSync(path.join(DIR, f)).toString('base64');
  const eB64 = readFileSync(path.join(DIR, f.replace(/\.png$/, '_emis.png'))).toString('base64');
  let full;
  try { full = await page.evaluate((g, a, e) => window.renderEpic(g, a, e), glbB64, aB64, eB64); }
  catch (err) { console.error(`FAILED ${f}: ${err.message}`); continue; }
  const small = await downscale(full, OUT_PX);
  writeFileSync(path.join(OUT, f.replace(/^combatmech_/, '')), Buffer.from(small.split(',')[1], 'base64'));
  console.log(`✓ ${f.replace(/^combatmech_epic_/, '')}`); n++;
}
await browser.close();
console.log(`\nrendered ${n}/${albedos.length} epics -> ${OUT}  pageErrors=${pageErr}`);
