// Visual proof for "You have no feast to set out" on an apex feast (the
// Sageleaf Feast report): boots the offline game on the LOW preset, grants
// one Sageleaf Feast, opens Bags, clicks the feast row (the real placeFeast
// verb the bags window raises) and screenshots the result: on the base the
// error line reads the no_feast denial; on the fix the feast entity is set
// out at the player's feet and the bag slot is spent. Needs `npm run dev`
// (or `GAME_URL` pointing at a Vite dev client). Screenshots land in tmp/.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const TAG = process.env.SHOT_TAG ?? 'after';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--window-size=1600,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
  ],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

// Standing capture rule: seed the LOWEST graphics preset before the app boots.
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
  } catch {
    // ignore
  }
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 45000 });
await enterOfflineGame(page, { charClass: 'warrior', charName: 'Wicca' });
await sleep(1500);

// Grant the apex feast and open Bags.
const staged = await page.evaluate(() => {
  const g = window.__game;
  g.sim.addItem('sageleaf_feast', 1);
  g.hud.toggleBags();
  document.getElementById('tutorial-greeting')?.remove();
  return { count: g.sim.countItem('sageleaf_feast') };
});
console.log('staged', staged);
await sleep(800);

// Click the feast row the way a player does (the bags click ladder classifies
// it as placeFeast and sends the named slot).
const clicked = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#bags .bag-grid [aria-label]')];
  const row = rows.find((r) => /Sageleaf Feast/.test(r.getAttribute('aria-label') ?? ''));
  if (!row)
    return { found: false, labels: rows.slice(0, 5).map((r) => r.getAttribute('aria-label')) };
  row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  return { found: true };
});
console.log('clicked', clicked);
await sleep(1200);

const result = await page.evaluate(() => {
  const g = window.__game;
  const feasts = [...g.sim.entities.values()].filter((e) => e.templateId === 'sageleaf_feast');
  return {
    error: document.querySelector('#error-msg')?.textContent ?? '',
    placed: feasts.length,
    left: g.sim.countItem('sageleaf_feast'),
  };
});
console.log('result', result);

await page.screenshot({ path: `tmp/apex_feast_set_out_${TAG}.png` });
await browser.close();
