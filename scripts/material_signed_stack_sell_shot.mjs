// Evidence for the material signed-bucket Sell-cap fix. Stages a 20-unit
// gathered-material stack that merges a 9-unit plain bucket with an 11-unit
// signed (premium) bucket from the same gatherer, the reported "several
// benefactors" shape, then opens the World Market Sell tab. Before the fix
// fungibleBagCount summed the raw slot.count, so the tab advertised "of 20"
// even though the sim's countFungibleItem gate only ever escrows the 9 plain
// units; after the fix it reads "of 9", matching what marketList will
// actually accept.
//
// Run with LABEL=before against the pre-fix commit and LABEL=after against
// the fix, same script, same seeded stack.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const GFX = process.env.GFX ?? 'ultra';
const LABEL = process.env.LABEL ?? 'after';
const URL = `${process.env.GAME_URL ?? 'http://localhost:5173'}/?gfx=${GFX}`;
const OUT = 'tmp/material_signed_sell';
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Blocks until #loading-screen is not painted over the viewport. Teleporting
// onto the Merchant's stall can re-raise it well after window.__game was
// published (a zone-load backdrop, not the spawn intro), and every DOM
// assertion still passes while it is up because it reads the real window
// underneath: a clip shot lands the backdrop in the file instead
// (scripts/charter_store_shot.mjs precedent, "eight loading screens").
async function awaitWorldPainted(page) {
  await page.waitForFunction(
    () => {
      const el = document.getElementById('loading-screen');
      if (!el) return true;
      const cs = getComputedStyle(el);
      return cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0;
    },
    { timeout: 120000 },
  );
}

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1280,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await enterOfflineGame(page, {
  charClass: 'warrior',
  charName: 'Strider',
  settleMs: 4000,
  gameBootTimeoutMs: 90000,
});
await awaitWorldPainted(page);

// Seed the stack, teleport onto the Merchant's stall, and open the market.
const seeded = await page.evaluate(() => {
  const { sim, hud } = window.__game;
  const merch = [...sim.entities.values()].find((e) => e.templateId === 'the_merchant');
  const p = sim.player;
  p.pos = sim.groundPos(merch.pos.x, merch.pos.z);
  p.prevPos = { ...p.pos };

  const wicca = { kind: 'character', id: 4001, name: 'Wicca' };
  sim.addItem('copper_ore', 20, sim.playerId, {
    materialSources: [
      { source: { gatherer: wicca }, count: 9 },
      { source: { gatherer: wicca, signer: 'Wicca' }, count: 11 },
    ],
  });

  const el = document.querySelector('#market-window');
  if (el) el.style.display = 'none';
  hud.openMarket();
  const bags = document.querySelector('#bags');
  if (bags) bags.style.display = 'none';

  return { itemId: 'copper_ore' };
});

const MARKET_SEL = '#market-window';
await page.waitForFunction((sel) => !!document.querySelector(sel), { timeout: 15000 }, MARKET_SEL);
// The teleport onto the Merchant's stall can cross a zone-streaming boundary,
// and the client raises #loading-screen asynchronously (a beat after the
// position write, not synchronously with it), so checking immediately is a
// race: give it a moment to actually appear before waiting for it to clear.
await wait(3000);
await awaitWorldPainted(page);

const SELL_TAB = '#market-window [data-tab="sell"]';
await page.waitForSelector(SELL_TAB, { timeout: 10000 });
await page.evaluate((sel) => document.querySelector(sel).click(), SELL_TAB);
await page.waitForFunction(
  (sel) => document.querySelector(sel)?.getAttribute('aria-pressed') === 'true',
  { timeout: 10000 },
  SELL_TAB,
);

// Stage the seeded stack for sale through the same call bags_window's click
// handler makes (deps.stageMarketSell), never a hand-rolled staging path.
await page.evaluate((itemId) => {
  window.__game.hud.marketWindow.stageSell(itemId);
}, seeded.itemId);
await awaitWorldPainted(page);

const readout = await page.evaluate(() => {
  const tag = document.querySelector('.mkt-coin-tag');
  return tag ? tag.textContent : null;
});
console.log(`[${LABEL}] Sell tab quantity readout:`, readout);
if (readout === null) {
  await page.screenshot({ path: `${OUT}/${LABEL}_debug_no_form.png` });
  throw new Error('Sell tab never reached the form state; see debug screenshot');
}

const clip = await page.evaluate(() => {
  const el = document.querySelector('#market-window');
  const r = el.getBoundingClientRect();
  return {
    x: Math.round(r.x),
    y: Math.round(r.y),
    width: Math.round(r.width),
    height: Math.round(r.height),
  };
});
await page.screenshot({ path: `${OUT}/${LABEL}_sell.png`, clip });

await browser.close();
console.log(`saved ${OUT}/${LABEL}_sell.png`);
