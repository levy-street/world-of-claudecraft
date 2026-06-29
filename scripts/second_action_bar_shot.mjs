// Screenshot harness for the second action bar. Boots the offline world as a
// mage, levels up so the kit overflows the primary bar onto the secondary bar,
// drops a couple of item shortcuts on the secondary row, and captures the
// stacked action bars. Needs a dev server (default :5173, override GAME_URL).

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = `${process.env.GAME_URL ?? 'http://localhost:5173'}/?gfx=ultra`;
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
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE:', m.text());
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#btn-offline', { timeout: 60000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(300);
await page.type('#char-name', 'Twobars');
await page.click('#offline-select .mini-class[data-class="mage"]');
await page.click('#btn-start-offline');
await page.waitForFunction(() => window.__game?.hud, { timeout: 60000 });
await sleep(1500);

// Level up so the full mage kit is learned and spills onto the second bar, then
// seed two item shortcuts onto the secondary row so it is visibly in use.
await page.evaluate(() => {
  const g = window.__game;
  g.sim.setPlayerLevel?.(20);
  for (const id of ['minor_healing_potion', 'minor_mana_potion', 'baked_bread'])
    g.sim.addItem(id, 5);
});
await sleep(1500);

// Report what rendered so the run self-verifies even if the PNG is not inspected.
const info = await page.evaluate(() => ({
  bar1: document.querySelectorAll('#actionbar .action-btn').length,
  bar2: document.querySelectorAll('#actionbar2 .action-btn').length,
  bar2Visible:
    !!document.querySelector('#actionbar2') &&
    getComputedStyle(document.querySelector('#actionbar2')).display !== 'none',
}));
console.log('action bars:', JSON.stringify(info));

const stack = await page.$('#actionbar-stack');
await (stack ?? page).screenshot({ path: 'tmp/second-action-bar.png' });
console.log('wrote tmp/second-action-bar.png');

await browser.close();
