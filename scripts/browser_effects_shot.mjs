// Adaptive browser-effects screenshots: the new Esc > Graphics "Browser Effects"
// control, plus a before/after of the start-screen decorative effects under the
// fx-full vs fx-minimal tiers (backdrop-filter blur + ambient background layers
// dropped). Offline flow (no server). Needs `npm run dev`. Writes PNGs to tmp/.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const CLASS = process.env.GAME_CLASS ?? 'mage';
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

// 1) Start screen with FULL decorative effects (portal blur rings, nebula, embers).
await page.evaluate(() => {
  document.body.classList.remove('fx-reduced', 'fx-minimal');
  document.body.classList.add('fx-full');
});
await wait(600);
await page.screenshot({ path: 'tmp/browser_effects_start_full.png' });

// 2) Same start screen at the MINIMAL tier — frozen background animations, blur
//    layers dropped, ember field hidden. The toned-down ambience a weak engine
//    (e.g. Safari mobile / old Firefox) would auto-receive.
await page.evaluate(() => {
  document.body.classList.remove('fx-full', 'fx-reduced');
  document.body.classList.add('fx-minimal');
});
await wait(600);
await page.screenshot({ path: 'tmp/browser_effects_start_minimal.png' });

// Boot into the offline world.
await page.evaluate(() => {
  document.body.classList.remove('fx-minimal');
  document.body.classList.add('fx-full');
});
await tap('#btn-offline');
await wait(200);
await page.evaluate(() => {
  const n = document.querySelector('#char-name');
  if (n) { n.value = 'Adapt'; n.dispatchEvent(new Event('input', { bubbles: true })); }
});
await tap(`#offline-select .mini-class[data-class="${CLASS}"]`);
await tap('#btn-start-offline');
await page.waitForFunction(() => !!(window.__game && window.__game.hud), { timeout: 30000 });
await wait(1500);

// 3) The new "Browser Effects" control in the Graphics options panel.
await page.evaluate(() => {
  const hud = window.__game.hud;
  hud.toggleOptionsMenu();
  hud.optionsView = 'graphics';
  hud.renderOptions();
});
await wait(400);
const box = await page.evaluate(() => {
  const el = document.querySelector('#options-menu');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
});
await page.screenshot({ path: 'tmp/browser_effects_graphics_full.png' });
if (box && box.width > 0) await page.screenshot({ path: 'tmp/browser_effects_graphics_panel.png', clip: box });

// Report the detected engine + classes so the PR can cite what was running.
const detected = await page.evaluate(() => ({
  ua: navigator.userAgent,
  bodyClasses: [...document.body.classList].filter((c) => /^engine-|^is-|^fx-/.test(c)),
}));
console.log('detected:', JSON.stringify(detected));
if (errors.length) console.log('PAGE ERRORS:\n' + errors.join('\n'));
console.log('wrote tmp/browser_effects_{start_full,start_minimal,graphics_full,graphics_panel}.png');
await browser.close();
