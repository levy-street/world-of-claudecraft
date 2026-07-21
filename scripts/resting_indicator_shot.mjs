// Captures the player unit-frame "resting" zZz indicator in the offline client.
// Run the dev client first (npm run dev), then:
//   GAME_URL=http://localhost:5173 node scripts/resting_indicator_shot.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH as CHROME } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = 'docs/pr-assets/resting-indicator';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  protocolTimeout: 60000,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,760', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 760 },
});

const page = await browser.newPage();
page.on('pageerror', (e) => console.error('pageerror:', e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await sleep(800);

// Offline boot flow: char-name -> pick class -> start.
await page.evaluate(() => {
  document.querySelector('#btn-offline').click();
  document.querySelector('#char-name').value = 'Resty';
  document.querySelector('#offline-select .mini-class[data-class="warrior"]').click();
  document.querySelector('#btn-start-offline').click();
});
await page.waitForFunction(() => window.__game?.sim?.entities?.size > 5, { timeout: 20000, polling: 300 });
await sleep(800);

async function clipPlayerFrame(name) {
  await sleep(700); // let the per-frame HUD pick up the state + a pulse beat
  const box = await page.evaluate(() => {
    const r = document.querySelector('#player-frame').getBoundingClientRect();
    return { x: Math.max(0, r.x - 10), y: Math.max(0, r.y - 12), width: r.width + 20, height: r.height + 22 };
  });
  await page.screenshot({ path: `${OUT}/${name}.png`, clip: box });
  console.log('shot:', name);
}

// 1) Standing — no indicator.
await clipPlayerFrame('standing');

// 2) Resting (bare sit).
await page.evaluate(() => { window.__game.sim.player.sitting = true; });
await clipPlayerFrame('resting');

// 3) Eating + drinking (recovering).
await page.evaluate(() => {
  const p = window.__game.sim.player;
  p.sitting = true;
  p.eating = { itemId: 'bread', remaining: 18 };
  p.drinking = { itemId: 'water', remaining: 18 };
});
await clipPlayerFrame('recovering');

// 4) Full HUD context shot while resting.
await page.evaluate(() => { window.__game.sim.player.eating = null; window.__game.sim.player.drinking = null; });
await sleep(500);
await page.screenshot({ path: `${OUT}/full-hud.png` });
console.log('shot: full-hud');

await browser.close();
console.log('done ->', OUT);
