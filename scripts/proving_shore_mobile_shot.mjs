// The Proving Shore arrival on the MOBILE HUD (landscape, the in-game rule):
// the ferry sets a newcomer down at the Gauntlet's mouth with the coach
// card's touch copy up. One shot, tmp/proving-shore-arrival-mobile.png.
//   GAME_URL=http://localhost:5173 node scripts/proving_shore_mobile_shot.mjs

import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  protocolTimeout: 240_000,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--window-size=844,390',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});
const page = await browser.newPage();
// Landscape mobile metrics (the in-game HUD is landscape-only on web).
await page.setViewport({
  width: 844,
  height: 390,
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});
await page.setUserAgent(
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
);
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.evaluate(() => {
  localStorage.clear();
  document.body.classList.add('mobile-touch');
});
const booted = await enterOfflineGame(page, {
  charClass: 'warrior',
  charName: 'Prover',
  gameBootTimeoutMs: 180_000,
  selectorTimeoutMs: 60_000,
});
if (!booted) throw new Error('offline world did not boot');
// The headless SwiftShader run trips the GPU notice; it must never sit in a
// committed screenshot (the proving_shore_shots.mjs dismissal).
await page.evaluate(() => document.querySelector('.gpu-notice-dismiss')?.click());

await page.waitForFunction(() => !!document.getElementById('tutorial-greeting'), {
  timeout: 15000,
  polling: 200,
});
await page.evaluate(() => document.querySelector('#tutorial-greeting [data-play]')?.click());
await page.waitForFunction(
  () => window.__game.sim.entities.get(window.__game.sim.playerId).pos.x < -180,
  { timeout: 15000, polling: 200 },
);
// Close Odo's note so the arrival view and the coach card carry the frame.
await sleep(1500);
await page.evaluate(() => {
  document.getElementById('tutorial-greeting')?.querySelector('button')?.click();
});
// Let the banner fade and the terrain stream in under software GL, and
// clear any late-arriving GPU notice before the shutter.
await sleep(9000);
await page.evaluate(() => document.querySelector('.gpu-notice-dismiss')?.click());
await sleep(500);
await page.screenshot({ path: 'tmp/proving-shore-arrival-mobile.png' });
console.log('shot arrival-mobile');
await browser.close();
