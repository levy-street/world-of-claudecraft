// Screenshot of the player Trade window's MONEY input. Before this fix the
// "Your offer" money was a single raw-copper number box; now it is three
// gold/silver/copper fields matching the World Market sell form, so a player
// no longer has to hand-convert (e.g. 5g 32s 45c instead of typing 53245).
// Boots the offline game headless at max graphics, stubs an open trade so the
// REAL HUD renders updateTradeWindow(), and captures tmp/trade_money.png.
// Run with `npm run dev` already up.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = (process.env.GAME_URL ?? 'http://localhost:5173') + '/?gfx=ultra';
const OUT = process.env.SHOT ?? 'tmp/trade_money.png';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,1000', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => fails.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE-ERR:', m.text()); });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 40000 });
await page.waitForSelector('#btn-offline', { visible: true, timeout: 25000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await page.waitForSelector('#offline-select .mini-class[data-class="warrior"]', { visible: true, timeout: 25000 });
await sleep(200);
await page.evaluate(() => {
  document.querySelector('#char-name').value = 'Hero';
  document.querySelector('#offline-select .mini-class[data-class="warrior"]').click();
  document.querySelector('#btn-start-offline').click();
});
// ?gfx=ultra under software rendering boots slowly (~30-40s); poll generously.
await page.waitForFunction(() => window.__game?.sim?.entities?.size > 5, { timeout: 60000, polling: 300 });
await sleep(2500); // let max-gfx scene settle

// Stub an open trade and stage a money amount, then drive the real HUD render.
const res = await page.evaluate(() => {
  const hud = window.__game.hud;
  const sim = window.__game.sim;
  const TI = {
    otherPid: 999,
    otherName: 'Aldric',
    myOffer: { items: [], copper: 53245 },
    theirOffer: { items: [], copper: 12050 },
    myAccepted: false,
    theirAccepted: false,
  };
  Object.defineProperty(sim, 'tradeInfo', { configurable: true, get() { return TI; } });
  hud.updateTradeWindow();            // opens window, resets stagedTrade to 0
  hud.stagedTrade = { items: [], copper: 53245 };
  hud.lastTradeSig = '';              // force a re-render with the staged amount
  hud.updateTradeWindow();
  const g = document.querySelector('#trade-g');
  const s = document.querySelector('#trade-s');
  const c = document.querySelector('#trade-c');
  return {
    open: document.querySelector('#trade-window')?.style.display === 'block',
    threeFields: !!(g && s && c),
    legacyField: !!document.querySelector('#trade-copper'),
    g: g?.value, s: s?.value, c: c?.value,
    coins: document.querySelectorAll('.trade-coins .coin.g, .trade-coins .coin.s, .trade-coins .coin.c').length,
  };
});
check(res.open, 'trade window is open');
check(res.threeFields, 'trade money has three gold/silver/copper fields');
check(!res.legacyField, 'the old single #trade-copper field is gone');
check(res.g === '5' && res.s === '32' && res.c === '45', `53245c seeds 5g 32s 45c (got ${res.g}g ${res.s}s ${res.c}c)`);
check(res.coins === 3, `each money field shows a gold/silver/copper coin glyph (got ${res.coins}/3)`);

await sleep(400);
const win = await page.$('#trade-window');
await win.screenshot({ path: OUT });
console.log('wrote ' + OUT);

await browser.close();
console.log(fails.length === 0 ? '\nALL TRADE-MONEY CHECKS PASSED' : `\n${fails.length} CHECK(S) FAILED:\n - ` + fails.join('\n - '));
process.exit(fails.length === 0 ? 0 : 1);
