// Per-character keybinds proof shots (offline flow, no server). Boots two
// offline characters, rebinds a key for each, and shows the rebinds stay
// independent and persist per character. Max graphics preset so the world
// behind the Key Bindings panel renders at full quality. Needs `npm run dev`.
// Writes PNGs + a localStorage dump to tmp/.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
const URL = process.env.GAME_URL ?? 'http://localhost:5173';
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

// Seed max-graphics settings so every shot renders the world at full quality.
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.evaluate(() => localStorage.setItem('woc_settings', JSON.stringify({
  graphicsPreset: 5, effectsQuality: 1, shadowQuality: 1,
})));

async function bootOffline(name, cls) {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#btn-offline', { timeout: 20000 });
  await tap('#btn-offline');
  await wait(200);
  await page.evaluate((n) => {
    const el = document.querySelector('#char-name');
    if (el) { el.value = n; el.dispatchEvent(new Event('input', { bubbles: true })); }
  }, name);
  await tap(`#offline-select .mini-class[data-class="${cls}"]`);
  await tap('#btn-start-offline');
  await page.waitForFunction(() => window.__game && window.__game.hud, { timeout: 30000 });
  await wait(1500); // let the first frames + assets settle for the shot
}

const openKeybinds = () => page.evaluate(() => {
  const hud = window.__game.hud;
  hud.toggleOptionsMenu();
  hud.optionsView = 'keybinds';
  hud.renderOptions();
});
// Rebind through the live Keybinds instance the HUD owns, then re-render so the
// keycap updates exactly as a manual rebind would.
const rebind = (action, code) => page.evaluate((a, c) => {
  window.__game.hud.keybinds.bind(a, 0, c);
  window.__game.hud.renderOptions();
}, action, code);
const jumpCap = () => page.evaluate(() => window.__game.hud.keybinds.labelAt('jump', 0));
const dumpKeys = () => page.evaluate(() => Object.fromEntries(
  Object.keys(localStorage)
    .filter((k) => k.startsWith('woc_keybinds'))
    .map((k) => [k, JSON.parse(localStorage.getItem(k)).jump])));

// --- Character A: Aldric the warrior rebinds Jump to Z ---
await bootOffline('Aldric', 'warrior');
await openKeybinds();
await wait(400);
console.log('Aldric jump before:', await jumpCap());
await rebind('jump', 'KeyZ');
await wait(300);
console.log('Aldric jump after :', await jumpCap());
await page.screenshot({ path: 'tmp/keybinds_char_aldric.png' });

// --- Character B: Brenna the mage. Jump must still be the default Space ---
await bootOffline('Brenna', 'mage');
await openKeybinds();
await wait(400);
console.log('Brenna jump (independent):', await jumpCap());
await rebind('jump', 'KeyU');
await wait(300);
await page.screenshot({ path: 'tmp/keybinds_char_brenna.png' });

// --- Back to Aldric: his custom Z must have persisted ---
await bootOffline('Aldric', 'warrior');
await openKeybinds();
await wait(400);
console.log('Aldric jump (persisted):', await jumpCap());
await page.screenshot({ path: 'tmp/keybinds_char_aldric_reload.png' });

const keys = await dumpKeys();
fs.writeFileSync('tmp/keybinds_localstorage.json', JSON.stringify(keys, null, 2));
console.log('per-character localStorage keys (jump binding):', JSON.stringify(keys, null, 2));

if (errors.length) console.log('PAGE ERRORS:\n' + errors.join('\n'));
console.log('wrote tmp/keybinds_char_aldric.png, tmp/keybinds_char_brenna.png, tmp/keybinds_char_aldric_reload.png');
await browser.close();
