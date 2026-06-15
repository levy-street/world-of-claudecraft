// Mobile More-tray screenshot tour: boots the offline game in a phone-sized
// viewport (pointer: coarse → body.mobile-touch), enters the world, opens the
// "More" tray, and captures the new Nameplates/Leaderboard buttons (#323).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

import { BROWSER_PATH as CHROME } from './browser_path.mjs';
const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
// iPhone-ish portrait: coarse pointer + max-width 940 → PHONE_TOUCH_QUERY matches.
await page.emulate({
  viewport: { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
});
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.click('#btn-offline');
await sleep(250);
await page.type('#char-name', 'Mobile');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await sleep(2500);

const active = await page.evaluate(() => document.body.classList.contains('mobile-touch'));
console.log('mobile-touch active:', active);
await page.screenshot({ path: 'tmp/mobile_tray_01_hud.png' });

// Open the More tray.
await page.click('#mobile-more');
await sleep(400);
await page.screenshot({ path: 'tmp/mobile_tray_02_more_open.png' });

// Verify the two new buttons exist and are reachable.
const present = await page.evaluate(() => ({
  nameplates: !!document.getElementById('mobile-nameplates'),
  leaderboard: !!document.getElementById('mobile-leaderboard'),
}));
console.log('buttons present:', JSON.stringify(present));

// Tap Leaderboard → leaderboard window should open.
await page.click('#mobile-leaderboard');
await sleep(500);
const lbOpen = await page.evaluate(() => {
  const el = document.getElementById('leaderboard-window') || document.querySelector('.leaderboard-window, #leaderboard');
  return !!el && getComputedStyle(el).display !== 'none';
});
console.log('leaderboard opened:', lbOpen);
await page.screenshot({ path: 'tmp/mobile_tray_03_leaderboard.png' });

// Tap Nameplates twice (toggle off then on) and report the renderer flag.
await page.evaluate(() => document.getElementById('mobile-more')?.click());
await sleep(300);
const beforeNp = await page.evaluate(() => window.__game?.renderer?.showNameplates);
await page.click('#mobile-nameplates');
await sleep(200);
const afterNp = await page.evaluate(() => window.__game?.renderer?.showNameplates);
console.log('nameplates toggled:', beforeNp, '->', afterNp);

if (errors.length) { console.log('PAGE ERRORS:\n' + errors.join('\n')); }
await browser.close();
const ok = present.nameplates && present.leaderboard && beforeNp !== afterNp;
console.log(ok ? 'RESULT OK' : 'RESULT FAIL');
process.exit(ok ? 0 : 1);
