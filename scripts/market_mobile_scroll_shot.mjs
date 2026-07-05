// Reproduction + verification for the "cannot scroll the World Market on mobile"
// bug. Boots the offline game in a landscape-phone touch viewport (body.mobile-touch),
// floods the Merchant's market so the listing column overflows, opens the Market,
// and MEASURES whether the scroll container can actually move. Prints a SCROLLABLE/
// STUCK verdict and writes before/after-scroll screenshots into tmp/.
// Run with `npm run dev` already up.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
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
    '--window-size=900,440',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
  ],
});
const page = await browser.newPage();
page.on('pageerror', (e) => fails.push('PAGEERROR: ' + e.message));
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

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await enterOfflineGame(page, { charClass: 'warrior', charName: 'Touch', settleMs: 2800 });
await page.evaluate(() => document.getElementById('mobile-preflight-continue')?.click());
await sleep(600);
// Clear the new-adventurer tutorial overlay and any auto-opened window so the
// screenshots show only the Market.
await page.evaluate(() => {
  document.querySelector('.tut-skip')?.click();
  const hud = window.__game?.hud;
  for (let i = 0; i < 20 && hud?.closeAll?.(); i++) {}
});
await sleep(400);
check(
  await page.evaluate(() => document.body.classList.contains('mobile-touch')),
  'mobile-touch is active',
);

// Flood the market so the listing column is far taller than the window.
const scene = await page.evaluate(() => {
  const sim = window.__game.sim;
  const merchant = [...sim.entities.values()].find((e) => e.templateId === 'the_merchant');
  const at = (e, x, z) => {
    const p = sim.groundPos(x, z);
    e.pos = p;
    e.prevPos = { ...p };
  };
  const me = sim.player;
  at(me, merchant.pos.x, merchant.pos.z - 3.2);
  me.facing = 0;
  me.prevFacing = 0;
  sim.players.get(me.id).copper = 500000;
  const goods = [
    'wolf_fang',
    'wolf_pelt',
    'spider_leg',
    'roasted_boar',
    'keen_dirk',
    'oiled_boots',
  ];
  for (let i = 0; i < 14; i++) {
    const pid = sim.addPlayer(
      ['mage', 'rogue', 'priest', 'hunter'][i % 4],
      'Seller' + 'ABCDEFGHIJKLMN'[i],
    );
    const e = sim.entities.get(pid);
    at(e, merchant.pos.x + (i % 5) - 2, merchant.pos.z + 2 + (i % 3));
    for (let j = 0; j < 12; j++) {
      sim.addItem(goods[(i + j) % goods.length], 1, pid);
      sim.marketList(goods[(i + j) % goods.length], 1, 100 + j * 10, pid);
    }
  }
  return { merchant: !!merchant, total: sim.marketListings.length };
});
check(scene.merchant && scene.total > 120, `market flooded (${scene.total} listings)`);

await page.evaluate(() => window.__game.hud.openMarket());
await sleep(600);
// Presentation only: the offline tutorial keeps re-opening helper windows; hide
// every window except the Market so the screenshots show the bug/fix in isolation.
await page.evaluate(() => {
  for (const w of document.querySelectorAll('.window')) {
    if (w.id !== 'market-window') w.style.display = 'none';
  }
});

// Measure the scroll container. #market-body is the intended scroller.
const m = await page.evaluate(() => {
  const win = document.querySelector('#market-window');
  const body = document.querySelector('#market-body');
  const cs = (el) => getComputedStyle(el);
  return {
    winOverflowY: cs(win).overflowY,
    bodyOverflowY: cs(body).overflowY,
    bodyScrollH: body.scrollHeight,
    bodyClientH: body.clientHeight,
    winScrollH: win.scrollHeight,
    winClientH: win.clientHeight,
  };
});
console.log('measure:', JSON.stringify(m));
// The user-facing condition: the scroll container must have a real, visible
// height. A flex:1 scroller that collapsed to ~0px is overflowing AND scrollable
// in the abstract, but the player sees no list at all and cannot touch-scroll it.
const MIN_LIST_H = 80;
const scroller = m.bodyClientH >= m.winClientH ? 'window' : 'market-body';
const listH = scroller === 'window' ? m.winClientH : m.bodyClientH;
check(
  listH >= MIN_LIST_H,
  `the listing area has a usable visible height (${scroller} clientHeight=${listH}px, need >= ${MIN_LIST_H})`,
);
await page.screenshot({ path: 'tmp/market_mobile_scroll_01_top.png' });

// Drive a real scroll on whichever container holds the overflow, then confirm it moved.
const moved = await page.evaluate(() => {
  const body = document.querySelector('#market-body');
  const win = document.querySelector('#market-window');
  const target = body.scrollHeight > body.clientHeight + 4 ? body : win;
  target.scrollTop = 9999;
  return { scrollTop: target.scrollTop, which: target.id || 'market-body' };
});
check(
  moved.scrollTop > 10,
  `scroll position advanced (${moved.which} scrollTop=${moved.scrollTop})`,
);
await page.screenshot({ path: 'tmp/market_mobile_scroll_02_scrolled.png' });

await browser.close();
console.log(
  fails.length === 0
    ? '\nMARKET MOBILE SCROLL: SCROLLABLE'
    : `\nMARKET MOBILE SCROLL: STUCK\n - ` + fails.join('\n - '),
);
process.exit(fails.length === 0 ? 0 : 1);
