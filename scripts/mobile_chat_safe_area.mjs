// Visual check for fix(mobile): keep the touch chat box clear of the
// landscape safe-area (notch) on the left edge.
//
// Headless Chromium always resolves env(safe-area-inset-left) to 0 (no real
// notch), so we can't observe the patched CSS directly. Instead we emulate a
// notched landscape phone, draw the unsafe inset region, and render the chat
// box at the value each CSS *computes* for that inset:
//   before (old code):  left: 10px                     -> sits under the notch
//   after  (this fix):  left: max(10px, <inset>)        -> clears the notch
//
// Usage: node scripts/mobile_chat_safe_area.mjs   (needs `npm run dev`)

import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const INSET = 44; // typical iPhone landscape safe-area-inset-left in CSS px
const OUT = process.env.OUT_DIR ?? '/tmp/woc-shots';

import fs from 'node:fs';

fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function enterGame(page) {
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  // Play Offline -> start -> dismiss mobile preflight.
  const clickIf = (sel) =>
    page.evaluate((s) => {
      const el = document.querySelector(s);
      if (el) {
        el.click();
        return true;
      }
      return false;
    }, sel);
  await enterOfflineGame(page, { charClass: 'warrior', charName: 'Tester', settleMs: 2000 });
  await clickIf('#mobile-preflight-continue');
  await sleep(1000);
  // Force the touch UI + open the chat overlay (headless can't report coarse pointer).
  await page.evaluate(() => {
    document.body.classList.add('mobile-touch', 'game-active', 'mobile-chat-open');
  });
  await sleep(400);
}

async function shoot(page, label, leftExpr) {
  await page.evaluate(
    (leftExpr, inset) => {
      document.getElementById('woc-notch')?.remove();
      document.getElementById('woc-chatfix')?.remove();
      // Draw the unsafe inset (notch) region.
      const notch = document.createElement('div');
      notch.id = 'woc-notch';
      notch.style.cssText =
        `position:fixed;left:0;top:0;bottom:0;width:${inset}px;z-index:9999;` +
        'background:repeating-linear-gradient(45deg,#e0303055,#e0303055 8px,#e0303022 8px,#e0303022 16px);' +
        'border-right:2px solid #ff5555;pointer-events:none;';
      document.body.appendChild(notch);
      // Apply the computed chat left for this state.
      const st = document.createElement('style');
      st.id = 'woc-chatfix';
      st.textContent =
        `body.mobile-touch #chatlog-wrap{left:${leftExpr} !important;display:block !important;}` +
        `body.mobile-touch #chat-input{left:${leftExpr} !important;}`;
      document.head.appendChild(st);
    },
    leftExpr,
    INSET,
  );
  await sleep(500);
  const path = `${OUT}/chat-safe-area-${label}.png`;
  await page.screenshot({ path });
  console.log('wrote', path);
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage();
  await page.setViewport({
    width: 812,
    height: 375,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await enterGame(page);
  await shoot(page, 'before', '10px');
  await shoot(page, 'after', `max(10px, ${INSET}px)`);
  await browser.close();
  console.log('done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
