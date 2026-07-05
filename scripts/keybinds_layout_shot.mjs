// Key Bindings panel layout screenshots: the wide multi-column desktop layout
// (Esc > Key Bindings) plus the single-column mobile-touch fallback. Offline
// flow (no server). Needs `npm run dev`. Writes PNGs to tmp/.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const CLASS = process.env.GAME_CLASS ?? 'warrior';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });

const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tap = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await tap('#btn-offline');
await wait(200);
await page.evaluate(() => {
  const n = document.querySelector('#char-name');
  if (n) { n.value = 'Keybinder'; n.dispatchEvent(new Event('input', { bubbles: true })); }
});
await tap(`#offline-select .mini-class[data-class="${CLASS}"]`);
await tap('#btn-start-offline');
await wait(3000);

const openKeybinds = () => page.evaluate(() => {
  const hud = window.__game.hud;
  hud.toggleOptionsMenu();
  hud.optionsView = 'keybinds';
  hud.renderOptions();
});
const panelClip = () => page.evaluate(() => {
  const el = document.querySelector('#options-menu');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
});

// --- Desktop: wide multi-column layout ---
await openKeybinds();
await wait(400);
await page.screenshot({ path: 'tmp/keybinds_wide_full.png' });
const wide = await panelClip();
if (wide && wide.width > 0) await page.screenshot({ path: 'tmp/keybinds_wide_panel.png', clip: wide });
console.log('desktop panel width:', wide?.width);

// --- Mobile: single-column touch fallback ---
await page.evaluate(() => { window.__game.hud.closeOptions(); });
// Landscape phone — avoids the portrait "rotate to landscape" overlay.
await page.setViewport({ width: 844, height: 412 });
await page.evaluate(() => document.body.classList.add('mobile-touch'));
await wait(200);
await openKeybinds();
await wait(400);
await page.screenshot({ path: 'tmp/keybinds_mobile_full.png' });
const mob = await panelClip();
if (mob && mob.width > 0) await page.screenshot({ path: 'tmp/keybinds_mobile_panel.png', clip: mob });
console.log('mobile panel width:', mob?.width);

if (errors.length) console.log('PAGE ERRORS:\n' + errors.join('\n'));
console.log('wrote tmp/keybinds_wide_panel.png, tmp/keybinds_wide_full.png, tmp/keybinds_mobile_panel.png, tmp/keybinds_mobile_full.png');
await browser.close();
