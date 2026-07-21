// Visual proof of the heading-compass strip beneath the minimap. Boots the
// offline game headless, then rotates the player's facing through the four
// cardinals and a diagonal, clipping the #minimap-wrap region each time so the
// rose strip + centre caret + heading readout are clearly legible. Needs
// `npm run dev` running (port 5173). Screenshots land in tmp/.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.click('#btn-offline');
await sleep(300);
await page.type('#char-name', 'Pathfinder');
await page.click('#offline-select .mini-class[data-class="hunter"]');
await sleep(150);
await page.click('#btn-start-offline');
await page.waitForFunction(() => window.__game?.sim?.entities?.size > 5, { timeout: 20000, polling: 200 });
await sleep(1200);

// facing radians → expected heading (world convention: 0 = north, right = -)
const SHOTS = [
  ['north', 0, 'N'],
  ['east', -Math.PI / 2, 'E'],
  ['south', Math.PI, 'S'],
  ['west', Math.PI / 2, 'W'],
  ['northeast', -Math.PI / 4, 'NE'],
];

const clip = await page.evaluate(() => {
  const r = document.querySelector('#minimap-wrap').getBoundingClientRect();
  // pad so the full strip + heading text are captured with a margin
  return { x: Math.floor(r.x) - 8, y: Math.floor(r.y) - 6, width: Math.ceil(r.width) + 16, height: Math.ceil(r.height) + 28 };
});

for (const [name, facing, expect] of SHOTS) {
  const heading = await page.evaluate((f) => {
    const me = window.__game.sim.player;
    me.facing = f; me.prevFacing = f;
    window.__game.hud.update(0);
    return document.querySelector('#compass-heading').textContent;
  }, facing);
  await sleep(150);
  await page.screenshot({ path: `tmp/compass_${name}.png`, clip });
  console.log(`${heading === expect ? 'OK  ' : 'FAIL'}  facing ${name} → heading "${heading}" (expected ${expect})`);
}

// a full-HUD wide shot for context
await page.screenshot({ path: 'tmp/compass_full_hud.png' });
console.log('wrote tmp/compass_*.png');
await browser.close();
