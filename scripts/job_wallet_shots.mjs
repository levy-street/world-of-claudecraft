// In-game proof shots for the player-economy wallet panel: the bag's wallet
// chip, the Send tab (tip WOC/SOL/USDC), the Hire tab (paid-bodyguard contract
// builder), and the Jobs tab. Runs against the offline client.
//
// Usage: VITE_REOWN_PROJECT_ID=demo npm run dev   (in another shell)
//        node scripts/job_wallet_shots.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = 'docs/screenshots/jobs';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (page, sel, path) => {
  const el = await page.$(sel);
  if (!el) throw new Error(`selector not found for screenshot: ${sel}`);
  await el.screenshot({ path });
};

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH, headless: 'new',
  args: ['--window-size=1100,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1100, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('#btn-offline', { timeout: 15000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(200);
await page.type('#char-name', 'Helper');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await sleep(2600);

// 1) The bag, showing the clickable wallet balance chip (the panel's entry point).
//    Normalize the inline display first: toggleBags() opens only from 'none'.
await page.evaluate(() => {
  const el = document.querySelector('#bags');
  el.style.display = 'none';
  window.__game.hud.toggleBags();
});
await sleep(500);
await shot(page, '#bags', `${OUT}/01-bag-wallet-chip.png`);

// 2) Open the wallet panel from the chip → Send tab (tip a player directly).
await page.evaluate(() => document.querySelector('#bags [data-wallet]')?.click());
await page.waitForSelector('#wallet-panel', { timeout: 5000 });
await sleep(500);
await shot(page, '#wallet-panel', `${OUT}/02-wallet-send.png`);

// 3) Hire tab. Offline gates the form behind an "enter the world online" notice,
//    so reveal the real form DOM and pick a goal to show the contract builder.
await page.evaluate(() => {
  document.querySelector('#wallet-panel [data-tab="hire"]')?.click();
  const form = document.querySelector('#wallet-panel [data-h-form]');
  const offline = document.querySelector('#wallet-panel [data-h-offline]');
  if (form) form.hidden = false;
  if (offline) offline.hidden = true;
  document.querySelector('#wallet-panel [data-goal="reach_level"]')?.click();
});
await sleep(400);
await shot(page, '#wallet-panel', `${OUT}/03-wallet-hire.png`);

// 4) Jobs tab — the tracker for posted/hired contracts.
await page.evaluate(() => document.querySelector('#wallet-panel [data-tab="jobs"]')?.click());
await sleep(400);
await shot(page, '#wallet-panel', `${OUT}/04-wallet-jobs.png`);

console.log(`done -> ${OUT}/`);
await browser.close();
