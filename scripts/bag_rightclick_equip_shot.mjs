// Proof for the bag right-click fix (issue 1852): a plain right-click on a bag
// item now equips/uses it (matching classic-MMO expectations) instead of jumping
// straight to a destroy prompt. Captures before (sword sitting in the bag) and
// after (right-click with no shift equips it, bag slot empties, char window
// shows it equipped) plus the shift+right-click destroy confirmation prompt.
// Needs `npm run dev`. Writes PNGs to tmp/.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 860 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tap = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await tap('#btn-offline');
await wait(200);
await page.evaluate(() => {
  const el = document.querySelector('#char-name');
  if (el) {
    el.value = 'Tester';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
await tap('#offline-select .mini-class[data-class="warrior"]');
await tap('#btn-start-offline');
for (let i = 0; i < 60; i++) {
  const ready = await page.evaluate(() => !!window.__game?.sim);
  if (ready) break;
  await wait(500);
}

// Give a second, spare sword (autoEquip already fills the mainhand) so the bag
// has a destroyable/equippable item sitting in it, then open bags.
await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.addItem('worn_sword', 1, sim.player.id);
});
await page.evaluate(() => window.__game.hud.toggleBags());
await wait(400);
// Headless swiftshader/chromium mis-evaluates the body:has(#start-screen...) #ui
// guard rule in this offline-injected flow (the intro/cinematic never actually ran),
// so force #ui visible for the screenshot only; it does not touch app behavior.
await page.evaluate(() => {
  const ui = document.querySelector('#ui');
  if (ui) ui.style.setProperty('display', 'block', 'important');
});
await page.screenshot({ path: 'tmp/bag_rightclick_before.png' });
console.log('captured tmp/bag_rightclick_before.png (sword in bag)');

// Dispatch a real contextmenu MouseEvent (no shiftKey) at the bag row holding
// the spare sword, mirroring a desktop right-click.
const rightClicked = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('#bags .bag-item'));
  const row = rows.find((r) => r.getAttribute('aria-label')?.includes('Pitted Shortsword'));
  if (!row) return false;
  row.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, shiftKey: false }),
  );
  return true;
});
if (!rightClicked) {
  console.log('FAIL: spare sword row not found in bags');
} else {
  await wait(400);
  await page.screenshot({ path: 'tmp/bag_rightclick_after_equip.png' });
  console.log(
    'captured tmp/bag_rightclick_after_equip.png (right-click equipped, no destroy prompt)',
  );
}

// Now prove shift+right-click still destroys: give another spare sword and
// shift+right-click it, expecting the destroy confirmation prompt to open.
await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.addItem('worn_sword', 1, sim.player.id);
});
await wait(200);
const shiftRightClicked = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('#bags .bag-item'));
  const row = rows.find((r) => r.getAttribute('aria-label')?.includes('Pitted Shortsword'));
  if (!row) return false;
  row.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, shiftKey: true }),
  );
  return true;
});
if (!shiftRightClicked) {
  console.log('FAIL: spare sword row not found for shift+right-click');
} else {
  await wait(300);
  await page.screenshot({ path: 'tmp/bag_shiftrightclick_destroy_prompt.png' });
  console.log(
    'captured tmp/bag_shiftrightclick_destroy_prompt.png (shift+right-click still destroys)',
  );
}

await browser.close();
