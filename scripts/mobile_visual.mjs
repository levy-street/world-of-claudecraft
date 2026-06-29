// Mobile screenshot tour: boots the game in a phone-sized touch viewport so the
// on-screen touch controls (body.mobile-touch) activate, then captures the touch
// HUD, the expanded "More" tray, and the new Haptics toggle in both states.
// Needs `npm run dev` (:5173). Writes PNGs into tmp/.

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
});
const page = await browser.newPage();
// Landscape phone: coarse pointer + small enough to satisfy PHONE_TOUCH_QUERY.
await page.emulate({
  name: 'phone-landscape',
  userAgent:
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
  viewport: {
    width: 900,
    height: 420,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    isLandscape: true,
  },
});

const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text());
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await enterOfflineGame(page, { charClass: 'warrior', charName: 'Touchscreen', settleMs: 2800 });

// Dismiss the landscape/fullscreen preflight if it's up.
await page.evaluate(() => {
  document.getElementById('mobile-preflight-continue')?.click();
});
await new Promise((r) => setTimeout(r, 600));

const touchOn = await page.evaluate(() => document.body.classList.contains('mobile-touch'));
console.log('mobile-touch active:', touchOn ? 'OK' : 'FAIL');
await page.screenshot({ path: 'tmp/mobile_01_hud.png' });

// Open the "More" tray to reveal the extra controls incl. Haptics.
await page.click('#mobile-more');
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: 'tmp/mobile_02_more_tray.png' });

const before = await page.evaluate(() => {
  const b = document.getElementById('mobile-haptics');
  return {
    exists: !!b,
    pressed: b?.getAttribute('aria-pressed'),
    label: b?.querySelector('.mobile-label')?.textContent,
  };
});
console.log('haptics button (default):', JSON.stringify(before));

// Toggle haptics off — tray stays open, button dims + relabels.
await page.click('#mobile-haptics');
await new Promise((r) => setTimeout(r, 300));
const after = await page.evaluate(() => {
  const b = document.getElementById('mobile-haptics');
  return {
    pressed: b?.getAttribute('aria-pressed'),
    label: b?.querySelector('.mobile-label')?.textContent,
    persisted: localStorage.getItem('woc_haptics_on'),
  };
});
console.log('haptics button (after toggle):', JSON.stringify(after));
await page.screenshot({ path: 'tmp/mobile_03_haptics_off.png' });

const ok =
  before.exists &&
  before.pressed === 'true' &&
  after.pressed === 'false' &&
  after.persisted === '0';
console.log('haptics toggle:', ok ? 'OK' : 'FAIL');

if (errors.length) {
  console.log('\n=== PAGE ERRORS ===');
  for (const e of errors.slice(0, 20)) console.log(e);
} else {
  console.log('no page errors');
}
await browser.close();
process.exit(ok && touchOn ? 0 : 1);
