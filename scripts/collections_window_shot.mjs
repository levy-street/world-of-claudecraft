// Screenshots for the Collections window: one shot per tab, plus the full HUD
// so the new micro-menu icon's placement beside the PvP (G) button is visible.
// Needs `npm run dev` running.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
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
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('CONSOLE: ' + m.text());
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jsClick = (sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) throw new Error(`missing ${s}`);
    el.click();
  }, sel);

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#btn-offline', { timeout: 90000 });
await sleep(400);
await jsClick('#btn-offline');
await sleep(300);
await page.type('#char-name', 'Collector');
await jsClick('#offline-select .mini-class[data-class="warrior"]');
await jsClick('#btn-start-offline');
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 40000 });
await sleep(2000);

// Dismiss the new-adventurer tutorial overlay, which otherwise intercepts input.
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) =>
    /skip tutorial/i.test(b.textContent || ''),
  );
  btn?.click();
});
await sleep(400);
await page.waitForFunction(
  () => getComputedStyle(document.querySelector('#ui')).display !== 'none',
  { timeout: 20000, polling: 250 },
);

await jsClick('#mm-collections');
await sleep(1500);
// Dismiss any quest dialog that would sit over the window in the shot.
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) =>
    /understood/i.test(b.textContent || ''),
  );
  btn?.click();
});
await sleep(500);

const shotTab = async (tab, name) => {
  if (tab) {
    await jsClick(`#collections-window [data-tab="${tab}"]`);
    await sleep(1200);
  }
  const box = await page.evaluate(() => {
    const r = document.querySelector('#collections-window').getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  await page.screenshot({ path: `tmp/${name}.png`, clip: box });
  const rows = await page.$$eval('#collections-window .col-row', (els) => els.length);
  console.log(`shot ${name}: ${rows} rows, box ${JSON.stringify(box)}`);
};

await shotTab(null, 'collections_buddies');
await shotTab('mounts', 'collections_mounts');
await shotTab('sets', 'collections_sets');

// Back to the buddy tab and select one companion by key (BUDDY_SHOT, default
// the newest epic), so the shot carries a dedicated rig, its idle clip and its
// source lines rather than the list alone.
await jsClick('#collections-window [data-tab="buddies"]');
await sleep(600);
const shotKey = process.env.BUDDY_SHOT ?? 'forgemaw';
await jsClick(`#collections-window [data-key="${shotKey}"]`);
await sleep(1500);
await shotTab(null, `collections_${shotKey}`);
await page.screenshot({ path: 'tmp/collections_full.png' });

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console/page errors');
await browser.close();
