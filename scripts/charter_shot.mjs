// Proof shot for the Mount Charter UI: a tier-4 holder who has also EARNED a
// higher flyer via a Charter — the mount window shows Mint buttons on covered
// rungs and an "Owned" badge + working summon on the earned mount.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = 'docs/screenshots/mounts';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
await page.type('#char-name', 'Holder');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await sleep(2600);

await page.evaluate(() => {
  const g = window.__game; const p = g.sim.player;
  p.mountTier = 4;                       // holds up to Stormhoof — Mint on tiers 1-4
  g.sim.grantEarnedMount('goldcrest');   // earned a 5%-rung flyer without holding it
  g.hud.toggleMounts();                  // open the mount window
});
await sleep(500);
await page.screenshot({ path: `${OUT}/charter-window.png` });
console.log(`done -> ${OUT}/charter-window.png`);
await browser.close();
