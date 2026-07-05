// Temporary smoke test: confirm the Guide 3D viewer actually loads a GLB and renders.
// Needs `npm run dev`. Launches headless Chrome with software WebGL.
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const BASE = process.env.GUIDE_URL ?? 'http://localhost:5173';
let fail = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) fail++; };

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

async function waitState(sel, want, ms = 25000) {
  try {
    await page.waitForFunction(
      (s, w) => document.querySelector(s)?.getAttribute('data-state') === w, { timeout: ms }, sel, want,
    );
    return true;
  } catch { return false; }
}

// 1) Class page: click "View in 3D", expect a ready canvas.
await page.goto(`${BASE}/wiki/classes/warrior`, { waitUntil: 'networkidle0' });
await page.click('.guide-class-portrait .guide-viewer-load');
const classReady = await waitState('.guide-class-portrait .guide-viewer', 'ready');
check('class page viewer reaches ready', classReady);
check('class page viewer has a live canvas', await page.$('.guide-class-portrait .guide-viewer-canvas') !== null);

// 2) Bestiary: click the first creature thumb, expect ready.
await page.goto(`${BASE}/wiki/bestiary`, { waitUntil: 'networkidle0' });
await page.click('.guide-creature .guide-viewer-load');
check('bestiary thumb viewer reaches ready', await waitState('.guide-creature .guide-viewer', 'ready'));

// 3) Gallery: first model auto-loads into the single viewer.
await page.goto(`${BASE}/wiki/models`, { waitUntil: 'networkidle0' });
const galleryCanvas = await page.waitForSelector('.guide-gallery-stage .guide-viewer-canvas', { timeout: 25000 }).then(() => true).catch(() => false);
check('gallery auto-loads a model canvas', galleryCanvas);
// Switch model via the picker and confirm it stays alive.
const opts = await page.$$('.guide-gallery-opt');
if (opts.length > 1) { await opts[opts.length - 1].click(); await new Promise((r) => setTimeout(r, 1500)); }
check('gallery still has exactly one canvas after switching', (await page.$$('.guide-gallery-stage .guide-viewer-canvas')).length === 1);

check('no page/console errors during viewer use', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
console.log(fail ? `\n${fail} smoke check(s) failed` : '\nAll viewer smoke checks passed');
process.exit(fail > 0 ? 1 : 0);
