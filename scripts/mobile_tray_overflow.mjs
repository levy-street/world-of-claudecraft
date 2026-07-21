// Reproduces and verifies the mobile More-tray overflow on short landscape phones.
// The tray is a fixed 2-col grid anchored to the bottom that grows upward with
// no max-height/scroll, so once it holds enough buttons the top rows render
// above the viewport (negative top) and become unreachable.
//
// Usage: node scripts/mobile_tray_overflow.mjs           (default 740x360)
//        VP=812x375 node scripts/mobile_tray_overflow.mjs

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as CHROME } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const [W, H] = (process.env.VP ?? '740x360').split('x').map(Number);
const TAG = process.env.TAG ?? 'before';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.emulate({
  viewport: { width: W, height: H, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
});
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await enterOfflineGame(page, { charClass: 'warrior', charName: 'Mobile', settleMs: 2500 });
await page.click('#mobile-more');
await sleep(400);

const report = await page.evaluate((vh) => {
  const tray = document.getElementById('mobile-extra-controls');
  const btns = [...document.querySelectorAll('#mobile-extra-controls .mobile-btn')];
  const cs = getComputedStyle(tray);
  const clipped = btns
    .map((b) => ({ id: b.id, top: Math.round(b.getBoundingClientRect().top) }))
    .filter((b) => b.top < 0 || b.top > vh);
  return {
    count: btns.length,
    trayTop: Math.round(tray.getBoundingClientRect().top),
    trayBottom: Math.round(tray.getBoundingClientRect().bottom),
    overflowY: cs.overflowY,
    maxHeight: cs.maxHeight,
    clipped,
  };
}, H);

await page.screenshot({ path: `tmp/tray_overflow_${TAG}.png` });
console.log(
  `viewport ${W}x${H} - ${report.count} buttons, tray top=${report.trayTop} bottom=${report.trayBottom}, overflowY=${report.overflowY}, maxHeight=${report.maxHeight}`,
);
console.log('off-screen (unreachable) buttons:', JSON.stringify(report.clipped));
await browser.close();
const bug = report.clipped.length > 0;
console.log(
  bug
    ? `RESULT: BUG - ${report.clipped.length} buttons off-screen`
    : 'RESULT: OK - all buttons on-screen',
);
process.exit(0);
