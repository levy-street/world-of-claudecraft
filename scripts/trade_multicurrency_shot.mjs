// Screenshots of the multi-currency player Trade window (feat/woc-p2p-trading).
// Boots the offline game headless, stubs an open trade with items, gold, and the
// Claudium/WOC pledge rows visible (rails on), plus a settling-state panel, and
// captures both through the REAL extracted trade window (buildTradeView +
// renderTradeWindow). Run with `npm run dev` already up.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = `${process.env.GAME_URL ?? 'http://localhost:5173'}/?gfx=med`;
const OUT_OPEN = process.env.SHOT_OPEN ?? 'tmp/trade_multicurrency_open.png';
const OUT_SETTLE = process.env.SHOT_SETTLE ?? 'tmp/trade_multicurrency_settle.png';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (cond, msg) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'}  ${msg}`);
  if (!cond) fails.push(msg);
};

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--window-size=1600,1000',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
  ],
  defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => fails.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE-ERR:', m.text());
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 40000 });
await page.waitForSelector('#btn-offline', { visible: true, timeout: 25000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await page.waitForSelector('#offline-select .mini-class[data-class="warrior"]', {
  visible: true,
  timeout: 25000,
});
await sleep(200);
await page.evaluate(() => {
  document.querySelector('#char-name').value = 'Hero';
  document.querySelector('#offline-select .mini-class[data-class="warrior"]').click();
  document.querySelector('#btn-start-offline').click();
});
await page.waitForFunction(() => window.__game?.sim?.entities?.size > 5, {
  timeout: 60000,
  polling: 300,
});
await sleep(2000);

// State 1: an open multi-currency trade. Stub tradeInfo with items on both sides,
// gold, and rails on so the Claudium + WOC pledge rows render; stage a pledge.
const openRes = await page.evaluate(() => {
  const hud = window.__game.hud;
  const sim = window.__game.sim;
  // Headless offline boot does not run the full enter-world transition that
  // reveals the HUD layer, so force the #ui overlay visible for the capture.
  const ui = document.querySelector('#ui');
  if (ui) ui.style.display = 'block';
  const mine = [
    { itemId: 'worn_sword', count: 1 },
    { itemId: 'recruit_tunic', count: 1 },
  ];
  const theirs = [{ itemId: 'lesser_healing_potion', count: 3 }];
  const info = {
    otherPid: 999,
    otherName: 'Aldric',
    myOffer: { items: mine, copper: 53245, claudium: 25, woc: '0' },
    theirOffer: { items: theirs, copper: 12050, claudium: 0, woc: '1.5' },
    myAccepted: false,
    theirAccepted: false,
    phase: 'open',
    rails: { claudium: true, woc: true },
    settle: null,
    wocPay: null,
  };
  Object.defineProperty(sim, 'tradeInfo', { configurable: true, get: () => info });
  hud.tradeWasOpen = false;
  hud.lastTradeSig = '';
  hud.updateTradeWindow();
  hud.stagedTrade = { items: mine, copper: 53245, claudium: 25, woc: '0' };
  hud.lastTradeSig = '';
  hud.updateTradeWindow();
  const win = document.querySelector('#trade-window');
  return {
    open: win?.style.display === 'block',
    hasClaudium: !!document.querySelector('#trade-claudium'),
    hasWoc: !!document.querySelector('#trade-woc'),
    itemRows: document.querySelectorAll('#trade-window .trade-item').length,
    dialog: win?.getAttribute('role') === 'dialog',
  };
});
check(openRes.open, 'trade window open');
check(openRes.hasClaudium, 'Claudium pledge input renders when the rail is on');
check(openRes.hasWoc, 'WOC pledge input renders when the rail is on');
check(openRes.itemRows >= 3, `both offers show item rows (got ${openRes.itemRows})`);
check(openRes.dialog, 'window root is role=dialog (markDialogRoot)');
await sleep(300);
const clipOpen = await page.evaluate(() => {
  const r = document.querySelector('#trade-window').getBoundingClientRect();
  return {
    x: Math.max(0, r.x - 24),
    y: Math.max(0, r.y - 24),
    width: r.width + 48,
    height: r.height + 48,
  };
});
await page.screenshot({ path: OUT_OPEN, clip: clipOpen });
console.log(`wrote ${OUT_OPEN} (${clipOpen.width}x${clipOpen.height})`);

// State 2: settling panel with a WOC payment request for this player.
const settleRes = await page.evaluate(() => {
  const hud = window.__game.hud;
  const sim = window.__game.sim;
  const ui = document.querySelector('#ui');
  if (ui) ui.style.display = 'block';
  const info = {
    otherPid: 999,
    otherName: 'Aldric',
    myOffer: { items: [{ itemId: 'worn_sword', count: 1 }], copper: 0, claudium: 0, woc: '1.5' },
    theirOffer: {
      items: [{ itemId: 'lesser_healing_potion', count: 3 }],
      copper: 5000,
      claudium: 0,
      woc: '0',
    },
    myAccepted: true,
    theirAccepted: true,
    phase: 'settling',
    rails: { claudium: true, woc: true },
    settle: { claudiumMine: 'none', claudiumTheirs: 'none', wocMine: 'pending', wocTheirs: 'none' },
    wocPay: {
      uri: 'solana:8xkv...Aldric?amount=1.5&spl-token=3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth&reference=9fT2...k4',
      reference: '9fT2qeWmR5xK4pDh8nQ2vB7cL1sA3zY6uH0jN4k',
      amountUi: '1.5',
    },
  };
  Object.defineProperty(sim, 'tradeInfo', { configurable: true, get: () => info });
  hud.lastTradeSig = '';
  hud.updateTradeWindow();
  const win = document.querySelector('#trade-window');
  return {
    open: win?.style.display === 'block',
    settlingText: (win?.textContent ?? '').length > 0,
  };
});
check(settleRes.open, 'settling panel renders');
await sleep(300);
const clipSettle = await page.evaluate(() => {
  const r = document.querySelector('#trade-window').getBoundingClientRect();
  return {
    x: Math.max(0, r.x - 24),
    y: Math.max(0, r.y - 24),
    width: r.width + 48,
    height: r.height + 48,
  };
});
await page.screenshot({ path: OUT_SETTLE, clip: clipSettle });
console.log(`wrote ${OUT_SETTLE} (${clipSettle.width}x${clipSettle.height})`);

// State 3: the open trade on a phone viewport (mobile layout: columns stack,
// touch-target floors), same real render path.
const OUT_MOBILE = process.env.SHOT_MOBILE ?? 'tmp/trade_multicurrency_mobile.png';
// Resize width-only (no isMobile flag, which would reset the page context and
// wipe window.__game); the mobile-touch class drives the responsive HUD CSS.
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await page.evaluate(() => document.body.classList.add('mobile-touch'));
const mobileRes = await page.evaluate(() => {
  const hud = window.__game.hud;
  const sim = window.__game.sim;
  const ui = document.querySelector('#ui');
  if (ui) ui.style.display = 'block';
  const mine = [{ itemId: 'worn_sword', count: 1 }];
  const info = {
    otherPid: 999,
    otherName: 'Aldric',
    myOffer: { items: mine, copper: 53245, claudium: 25, woc: '0' },
    theirOffer: {
      items: [{ itemId: 'lesser_healing_potion', count: 3 }],
      copper: 12050,
      claudium: 0,
      woc: '1.5',
    },
    myAccepted: false,
    theirAccepted: false,
    phase: 'open',
    rails: { claudium: true, woc: true },
    settle: null,
    wocPay: null,
  };
  Object.defineProperty(sim, 'tradeInfo', { configurable: true, get: () => info });
  hud.stagedTrade = { items: mine, copper: 53245, claudium: 25, woc: '0' };
  hud.lastTradeSig = '';
  hud.updateTradeWindow();
  return { open: document.querySelector('#trade-window')?.style.display === 'block' };
});
check(mobileRes.open, 'trade window renders on a phone viewport');
await sleep(300);
const clipMobile = await page.evaluate(() => {
  const r = document.querySelector('#trade-window').getBoundingClientRect();
  return {
    x: Math.max(0, r.x),
    y: Math.max(0, r.y),
    width: Math.min(390, r.width),
    height: Math.min(844, r.height),
  };
});
await page.screenshot({ path: OUT_MOBILE, clip: clipMobile });
console.log(`wrote ${OUT_MOBILE} (${clipMobile.width}x${clipMobile.height})`);

await browser.close();
console.log(
  fails.length === 0
    ? '\nALL TRADE-WINDOW CHECKS PASSED'
    : `\n${fails.length} CHECK(S) FAILED:\n - ${fails.join('\n - ')}`,
);
process.exit(fails.length === 0 ? 0 : 1);
