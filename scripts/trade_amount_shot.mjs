// Screenshot of the player Trade window's staged-row AMOUNT box. Before this
// fix the only way to offer a whole stack was one bag click per unit (the
// reported 112-click trade); now a staged line the player holds more than one
// of carries a number box capped at the held total plus a Max button.
// Boots the offline game headless at the LOWEST graphics preset (window shots
// are evidence about the DOM, never render fidelity), seeds a 112-unit stack in
// the bags, stubs an open trade so the REAL woc_trade controller renders
// updateTradeWindow(), presses Max on the staged row, and captures the window
// on desktop and on a landscape phone. Run with a Vite dev client up
// (GAME_URL, default http://localhost:5173); SHOT_DIR and SHOT_PREFIX name the
// PNGs (tmp/trade_amount-desktop.png, tmp/trade_amount-mobile.png).
// PRESS_MAX=0 leaves the staged line at one unit (the BEFORE shape).

import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';
import { suppressGpuNotice } from './lib/gpu_notice_suppress.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const DIR = process.env.SHOT_DIR ?? 'tmp';
const PREFIX = process.env.SHOT_PREFIX ?? 'trade_amount';
const PRESS_MAX = process.env.PRESS_MAX !== '0';
fs.mkdirSync(DIR, { recursive: true });
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

// Drives the real HUD: seeds the stack, stubs the open trade, stages one
// unit (exactly what one bag click does), optionally presses Max.
const STAGE = `(() => {
  const hud = window.__game.hud;
  const sim = window.__game.sim;
  const inv = sim.inventory;
  for (let i = 0; i < 6; i++) inv.push({ itemId: 'wolf_fang', count: i === 5 ? 12 : 20 });
  const TI = {
    otherPid: 999,
    otherName: 'Aldric',
    myOffer: { items: [{ itemId: 'wolf_fang', count: 1 }], copper: 0 },
    theirOffer: { items: [], copper: 0 },
    myAccepted: false,
    theirAccepted: false,
  };
  Object.defineProperty(sim, 'tradeInfo', { configurable: true, get() { return TI; } });
  sim.tradeSetOffer = (items, copper) => { TI.myOffer = { items: items.map((s) => ({ ...s })), copper }; };
  hud.wocTrade.updateTradeWindow();
  hud.stagedTrade = { items: [{ itemId: 'wolf_fang', count: 1 }], copper: 0 };
  hud.wocTrade.lastTradeSig = '';
  hud.wocTrade.updateTradeWindow();
  if (${PRESS_MAX}) {
    document.querySelector('#trade-window .trade-qty-max')?.click();
    hud.wocTrade.lastTradeSig = '';
    hud.wocTrade.updateTradeWindow();
  }
  const box = document.querySelector('#trade-window .trade-qty-input');
  return {
    open: document.querySelector('#trade-window')?.style.display === 'block',
    hasBox: !!box,
    value: box?.value ?? null,
    max: box?.max ?? null,
    staged: TI.myOffer.items[0]?.count ?? null,
  };
})()`;

async function shoot(mobile) {
  const page = await browser.newPage();
  await suppressGpuNotice(page);
  if (mobile) {
    await page.emulate({
      viewport: { width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });
  }
  await page.evaluateOnNewDocument(
    `try { const k = 'woc_settings'; const s = JSON.parse(localStorage.getItem(k) || '{}'); s.graphicsPreset = 1; s.graphicsDefaultApplied = true; localStorage.setItem(k, JSON.stringify(s)); } catch {}`,
  );
  page.on('pageerror', (e) => fails.push('PAGEERROR: ' + e.message));
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (mobile) await page.evaluate(() => document.body.classList.add('mobile-touch'));
  await enterOfflineGame(page, {
    charName: 'Hero',
    gameBootTimeoutMs: 90000,
    selectorTimeoutMs: 60000,
  });
  const res = await page.evaluate(STAGE);
  const tag = mobile ? 'mobile' : 'desktop';
  check(res.open, `${tag}: trade window is open`);
  if (PRESS_MAX) {
    check(
      res.hasBox && res.max === '112',
      `${tag}: amount box capped at the 112 held (got max ${res.max})`,
    );
    check(
      res.value === '112' && res.staged === 112,
      `${tag}: Max staged the whole stack in one press (got ${res.value}/${res.staged})`,
    );
  } else {
    check(res.staged === 1, `${tag}: one bag click staged one unit`);
  }
  await sleep(500);
  const out = path.join(DIR, `${PREFIX}-${tag}.png`);
  const win = await page.$('#trade-window');
  await win.screenshot({ path: out });
  console.log('wrote ' + out);
  await page.close();
}

await shoot(false);
await shoot(true);
await browser.close();
console.log(
  fails.length === 0
    ? '\nALL TRADE-AMOUNT CHECKS PASSED'
    : `\n${fails.length} CHECK(S) FAILED:\n - ` + fails.join('\n - '),
);
process.exit(fails.length === 0 ? 0 : 1);
