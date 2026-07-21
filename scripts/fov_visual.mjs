// Visual capture for the Field of View setting: boots offline, shows the new
// "Field of View" slider in the Graphics options panel, then captures the same
// vista at the narrow / default / wide ends of the FOV range.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text()); });

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.click('#btn-offline');
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Adventurer');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 2500));

// run forward a little so the camera looks out over the world, not the spawn pad
await page.keyboard.down('w');
await new Promise((r) => setTimeout(r, 2500));
await page.keyboard.up('w');
await new Promise((r) => setTimeout(r, 800));

// --- Graphics options panel showing the new Field of View row ---
await page.evaluate(() => {
  const hud = window.__game.hud;
  hud.toggleOptionsMenu();
  const btn = [...document.querySelectorAll('#options-menu .btn')].find((b) => b.textContent === 'Graphics');
  btn?.click();
});
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: 'tmp/fov_options_panel.png' });
const rows = await page.evaluate(() =>
  [...document.querySelectorAll('#options-menu .set-row .set-name')].map((n) => n.textContent));
console.log('graphics rows:', JSON.stringify(rows));

// close the menu again
await page.evaluate(() => window.__game.hud.toggleOptionsMenu());
await new Promise((r) => setTimeout(r, 300));

// --- same vista at three FOV values via the live renderer setter ---
async function shot(deg, name) {
  await page.evaluate((d) => window.__game.renderer.setCameraFov(d), deg);
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: `tmp/${name}.png` });
  const fov = await page.evaluate(() => window.__game.renderer.camera.fov);
  console.log(`${name}: camera.fov = ${fov}`);
}
await shot(55, 'fov_55_narrow');
await shot(60, 'fov_60_default');
await shot(100, 'fov_100_wide');

if (errors.length) { console.log('\n=== PAGE ERRORS ==='); for (const e of errors.slice(0, 20)) console.log(e); }
else console.log('no page errors');
await browser.close();
