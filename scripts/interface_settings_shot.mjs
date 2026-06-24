// Interface & Comfort settings screenshots: the new Esc > Interface options
// panel (11 persisted sliders/toggles) plus an in-world shot with the FPS
// readout + frosted panels applied. Offline flow (no server). Needs `npm run dev`.
// Writes PNGs to tmp/.
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
await tap('#btn-offline');
await wait(200);
await page.evaluate(() => {
  const n = document.querySelector('#char-name');
  if (n) { n.value = 'Comfort'; n.dispatchEvent(new Event('input', { bubbles: true })); }
});
await tap(`#offline-select .mini-class[data-class="${CLASS}"]`);
await tap('#btn-start-offline');
await wait(3000);

// Open the Esc menu and switch to the new Interface sub-view.
await page.evaluate(() => {
  const hud = window.__game.hud;
  hud.toggleOptionsMenu();
  hud.optionsView = 'interface';
  hud.renderOptions();
});
await wait(400);
await page.screenshot({ path: 'tmp/interface_settings_full.png' });
const box = await page.evaluate(() => {
  const el = document.querySelector('#options-menu');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
});
if (box && box.width > 0) await page.screenshot({ path: 'tmp/interface_settings_panel.png', clip: box });

// Apply a few settings live, close the menu, and show them in-world: performance
// overlay on (showFps master toggle; configured in Options > Performance), frosted
// panels on, slightly faded HUD + larger combat text.
await page.evaluate(() => {
  const hud = window.__game.hud;
  const apply = hud.optionsHooks.onSettingChange;
  apply('showFps', true);
  apply('frostedPanels', true);
  apply('hudOpacity', 0.85);
  apply('fctScale', 1.4);
  apply('highContrastText', true);
  hud.closeOptions();
});
await wait(900);
await page.screenshot({ path: 'tmp/interface_settings_inworld.png' });

if (errors.length) console.log('PAGE ERRORS:\n' + errors.join('\n'));
console.log('wrote tmp/interface_settings_panel.png, tmp/interface_settings_full.png, tmp/interface_settings_inworld.png');
await browser.close();
