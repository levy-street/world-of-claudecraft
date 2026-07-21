// Visual check for the subzone banner: enter offline, walk into two named
// landmarks and screenshot the banner each time.
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
page.on('pageerror', (e) => console.log('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.click('#btn-offline');
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Wanderer');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 1500));

async function shot(name, poi) {
  // teleport into the landmark, face it, let a frame run so the banner fires
  await page.evaluate(({ x, z }) => {
    const g = window.__game;
    const p = g.sim.player;
    p.pos.x = x; p.pos.z = z;
  }, poi);
  await new Promise((r) => setTimeout(r, 300));
  const txt = await page.evaluate(() => document.querySelector('#subzone-banner').textContent);
  console.log(`${name}: subzone banner = "${txt}"`);
  await page.screenshot({ path: `tmp/${name}.png` });
}

// Boar Meadow lies at (65,0) in Eastbrook Vale; Wolf Run at (-2,70).
await shot('subzone-boar-meadow', { x: 65, z: 0 });
await shot('subzone-wolf-run', { x: -2, z: 70 });

await browser.close();
console.log('done');
