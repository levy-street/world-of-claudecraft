// Before/after proof screenshot for the Rift Essence / Rift Gem mail + market fix.
//
// Grants rift_essence via the debug hook (it is otherwise only reachable by
// clearing a Rift, the market-collapse-toggle precedent for seeding setup
// state directly), then drives the REAL World Market Sell-tab UI: opens the
// Merchant window, switches to Sell, stages the item through the real bag
// click path (data-focus-key, the market-sell-price-ref precedent), and
// clicks the actual List button. Captures the full viewport so both
// #market-window and the fading #error-msg toast are in frame regardless of
// where each lands on screen.
//
// Needs `npm run dev` on :5173 (override with GAME_URL). Writes to tmp/.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? 'tmp/rift-currency-market-sell.png';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

// Standing capture rule: seed the LOWEST graphics preset before boot.
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
  } catch {
    /* ignore */
  }
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
const booted = await enterOfflineGame(page, { charClass: 'warrior', charName: 'Prospector' });
if (!booted) throw new Error('offline world did not boot');
await sleep(500);

async function pollForSize(sel, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const rect = await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height };
    }, sel);
    if (rect && rect.w > 0 && rect.h > 0) return true;
    await sleep(50);
  }
  return false;
}

// Grant Rift Essence, teleport onto the Merchant's stall (zone1, {0, 11.5})
// so marketOpen's proximity gate passes, then open the Market window.
const grantOk = await page.evaluate(() => {
  const sim = window.__game?.sim;
  const p = sim?.player;
  if (!sim || !p?.pos) return false;
  p.pos.x = 0;
  p.pos.z = 11.5;
  sim.addItem?.('rift_essence', 5, p.id);
  const el = document.querySelector('#market-window');
  if (el) el.style.display = 'none';
  window.__game?.hud?.openMarket?.();
  return true;
});
if (!grantOk) throw new Error('could not grant rift_essence / open market');
if (!(await pollForSize('#market-window'))) throw new Error('market window never opened');

// Switch to the Sell tab and stage Rift Essence through the real bag click path.
const staged = await page.evaluate(() => {
  const tab = document.querySelector('#market-window [data-tab="sell"]');
  if (!tab) return false;
  tab.click();
  const row = document.querySelector('[data-focus-key^="bag:rift_essence:"]');
  if (!row) return false;
  row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return true;
});
if (!staged) throw new Error('could not stage Rift Essence onto the Sell tab');
await sleep(300);

// Click the real List button if the client even offers one: before this fix
// the Sell tab's own view-core (market_view.ts renderSellForm) pre-detects
// noMarketList as 'cannot-market' and shows the "cannot be sold" pick message
// with NO list button at all, never reaching the sim's own refusal. After the
// fix the form renders normally and clicking List creates a real listing.
const clicked = await page.evaluate(() => {
  const btn = document.querySelector('#market-window .mkt-list-btn');
  if (!btn) return false;
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return true;
});
await sleep(500);

const state = await page.evaluate(() => {
  const sim = window.__game?.sim;
  const errText = document.querySelector('#error-msg')?.textContent ?? '';
  const pickText = document.querySelector('#market-window .mkt-sell-pick')?.textContent ?? '';
  const listed = (sim?.marketListings ?? []).some((l) => l.itemId === 'rift_essence');
  return { errText, pickText, listed };
});
console.log('STATE:', JSON.stringify({ ...state, listButtonClicked: clicked }));

await page.screenshot({ path: OUT });
console.log(`RESULT wrote ${OUT}`);
await browser.close();
