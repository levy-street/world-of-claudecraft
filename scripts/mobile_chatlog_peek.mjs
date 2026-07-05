// Verifies the mobile read-only chat-log peek (long-press the Chat button).
// Renders the in-game HUD on a landscape phone viewport, generates a few chat
// lines, then captures two shots: the default play view (log hidden) and the
// peeked view (log visible, no keyboard). Screenshots land in tmp/.
//
// Run the Vite dev client first (npm run dev), then:
//   GAME_URL=http://localhost:5173 node scripts/mobile_chatlog_peek.mjs

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

// iPhone 12/13-class landscape: coarse pointer + 390px height triggers the
// PHONE_TOUCH_QUERY (max-height <= 760) so body.mobile-touch activates.
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  protocolTimeout: 60000,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--window-size=844,390',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  defaultViewport: {
    width: 844,
    height: 390,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
});

const page = await browser.newPage();
page.on('pageerror', (e) => errors.push(e.message));
// isMobile + hasTouch already make Chromium report `pointer: coarse`; some
// puppeteer-core builds reject emulateMediaFeatures('pointer'), so skip it.
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await sleep(900);

// Offline entry: Play Offline -> name -> class -> Enter World -> preflight.
await enterOfflineGame(page, { charClass: 'warrior', charName: 'Thumbwar', settleMs: 900 });
await page.evaluate(() => document.querySelector('#mobile-preflight-continue')?.click());
await page.waitForFunction(() => window.__game?.world?.entities?.size > 0, {
  timeout: 20000,
  polling: 300,
});
await sleep(600);

// Seed a few log lines so the peek has something to show (append straight to
// the #chatlog list — the same node hud.chatLogFrom writes into).
await page.evaluate(() => {
  const log = document.querySelector('#chatlog');
  if (!log) return;
  const lines = [
    ['[Guild] Aleph: heading to the crypt, who is in?', '#40d264'],
    ['[Party] Bet: pulling the next pack', '#7fd4ff'],
    ['You loot 12 silver.', '#f0ead8'],
    ['Forest Wolf hits you for 24.', '#ff8866'],
    ['Bet whispers: need a tank?', '#ff80ff'],
  ];
  for (const [text, color] of lines) {
    const div = document.createElement('div');
    div.textContent = text;
    div.style.color = color;
    log.appendChild(div);
  }
  log.scrollTop = log.scrollHeight;
});
await sleep(400);

const shot = (name) => page.screenshot({ path: `tmp/${name}.png` });

// 1) Default play view — log stays hidden so the world is unobstructed.
await shot('mobile_chatlog_before');
const hiddenDefault = await page.evaluate(
  () => !document.body.classList.contains('mobile-chatlog-peek'),
);

// 2) Long-press the Chat button (>420ms) to toggle the read-only peek.
const btn = await page.$('#mobile-chat');
const box = await btn.boundingBox();
const cx = box.x + box.width / 2,
  cy = box.y + box.height / 2;
await page.touchscreen.touchStart(cx, cy);
await sleep(550);
await page.touchscreen.touchEnd();
await sleep(400);

const peeking = await page.evaluate(() => document.body.classList.contains('mobile-chatlog-peek'));
const composerHidden = await page.evaluate(
  () => !document.body.classList.contains('mobile-chat-open'),
);
await shot('mobile_chatlog_after');

console.log('default log hidden:', hiddenDefault);
console.log('peek active after long-press:', peeking);
console.log('composer (keyboard) stayed closed:', composerHidden);
if (errors.length) console.log('PAGE ERRORS:', errors);
const ok = hiddenDefault && peeking && composerHidden && errors.length === 0;
console.log(ok ? 'PASS' : 'FAIL');

await browser.close();
process.exit(ok ? 0 : 1);
