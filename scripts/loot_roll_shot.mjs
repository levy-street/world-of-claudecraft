// Screenshot harness for the need-greed loot-roll prompt (the prompt that the
// snapshot-reconcile fix guarantees every eligible party member reliably sees).
//
// Boots the offline world at max graphics (?gfx=ultra) and feeds the HUD two
// lootRoll events (the same shape the server emits / re-delivers on the self
// snapshot), then captures the rendered Need/Greed/Pass panel.
//
// Needs a dev server (default :5173, override with GAME_URL). Writes to tmp/.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = (process.env.GAME_URL ?? 'http://localhost:5173') + '/?gfx=ultra';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#btn-offline', { timeout: 60000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(300);
await page.type('#char-name', 'Rollwyn');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await page.waitForFunction(() => window.__game?.hud, { timeout: 60000 });
await sleep(2000);

// Skip any tutorial overlay so the HUD is unobstructed.
await page.evaluate(() => document.querySelector('.tut-skip')?.click());
await sleep(500);

// Feed the HUD two open rolls, exactly as the server delivers them (and now
// re-delivers via the self snapshot for a client that missed the event).
const now = await page.evaluate(() => {
  const hud = window.__game.hud;
  const t = (window.__game.world.time ?? 0) + 30;
  hud.handleEvents([
    { type: 'lootRoll', rollId: 8001, itemId: 'greyjaw_hide_boots', itemName: 'Greyjaw Hide Boots', quality: 'uncommon', expiresAt: t },
    { type: 'lootRoll', rollId: 8002, itemId: 'cragmaw_huntcord', itemName: 'Cragmaw Huntcord', quality: 'rare', expiresAt: t },
  ]);
  return document.querySelectorAll('#loot-rolls .loot-roll').length;
});
console.log('rendered loot-roll panels:', now);
await sleep(800);

await page.screenshot({ path: 'tmp/loot_roll_prompt.png' });
// Tight crop around the prompt stack (bottom-right).
const clip = await page.evaluate(() => {
  const el = document.getElementById('loot-rolls');
  const r = el.getBoundingClientRect();
  const pad = 24;
  return { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.width + pad * 2, height: r.height + pad * 2 };
});
await page.screenshot({ path: 'tmp/loot_roll_prompt_crop.png', clip });
console.log('screenshots written to tmp/loot_roll_prompt.png and tmp/loot_roll_prompt_crop.png');

await browser.close();
