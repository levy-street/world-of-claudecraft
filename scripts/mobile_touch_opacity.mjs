// Visual proof for the Touch Controls Opacity accessibility slider.
// Boots the offline game in a touch-emulated phone viewport and captures the
// on-screen joysticks + buttons at full, mid, and low opacity. Saves to tmp/.
//
// Needs `npm run dev` on :5173. Headless Chromium does not report
// `pointer: coarse`, so we force `document.body.classList.add('mobile-touch')`
// to reveal the touch overlay (same trick the mobile e2e scripts use).

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=900,440', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: {
    width: 844,
    height: 390,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text());
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await enterOfflineGame(page, { charClass: 'warrior', charName: 'Adventurer', settleMs: 2500 });

// Reveal the touch overlay (headless Chromium reports pointer: fine).
await page.evaluate(() => document.body.classList.add('mobile-touch'));
await new Promise((r) => setTimeout(r, 400));

async function shot(opacity, name) {
  await page.evaluate((o) => {
    document.documentElement.style.setProperty('--touch-opacity', String(o));
  }, opacity);
  await new Promise((r) => setTimeout(r, 250));
  await page.screenshot({ path: `tmp/${name}` });
  console.log(`captured ${name} at opacity ${opacity}`);
}

await shot(1.0, 'touch_opacity_100.png');
await shot(0.6, 'touch_opacity_60.png');
await shot(0.3, 'touch_opacity_30.png');

await browser.close();
if (errors.length) {
  console.error('Browser errors:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('done');
