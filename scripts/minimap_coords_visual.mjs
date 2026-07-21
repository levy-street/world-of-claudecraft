// Screenshot the minimap coordinate readout through a real offline client.
// Boots offline, walks to a couple of positions, and element-clips #minimap-wrap
// so the new #minimap-coords pill is visible under the minimap.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1280,800', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.click('#btn-offline');
await sleep(200);
await page.type('#char-name', 'Wayra');
await page.click('#offline-select .mini-class[data-class="hunter"]');
await page.click('#btn-start-offline');
await sleep(3000);
await page.evaluate(() => document.querySelector('#mobile-preflight-continue')?.click());
await sleep(500);

async function shotAt(x, z, name) {
  // place the player at a known spot; offline sim lets us set pos directly.
  await page.evaluate((px, pz) => {
    const p = window.__game.sim.player;
    p.pos.x = px;
    p.pos.z = pz;
  }, x, z);
  await sleep(400); // let updateMinimapCoords run a frame
  const coords = await page.evaluate(() => document.querySelector('#minimap-coords')?.textContent);
  console.log(`${name}: coords pill =`, JSON.stringify(coords));
  const el = await page.$('#minimap-wrap');
  await el.screenshot({ path: `tmp/${name}.png` });
}

await shotAt(52, 18, 'minimap_coords_a');
await shotAt(-120, 240, 'minimap_coords_b');

// a full-HUD shot for context
await page.screenshot({ path: 'tmp/minimap_coords_full.png' });

console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 5).join('\n') : 'no page errors');
await browser.close();
