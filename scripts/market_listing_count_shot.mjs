// Evidence for the market-listing-count fix. Reproduces a busy shared market
// (>120 listings) where a seller holds all 12 of their slots, then captures the
// market window's Sell tab ("X / 12 slots") alongside the Browse tab. Before the
// fix the seller's own goods sort past MARKET_WIRE_LIMIT and never wire, so the
// Browse list shows none of them while Sell still reads 12/12. After the fix the
// seller's listings are always wired (the "Reclaim" rows on page 1).
//
// Run with max graphics: GFX=ultra. Toggle which build you screenshot with
// LABEL=before|after (purely cosmetic — affects only the output filenames).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const GFX = process.env.GFX ?? 'ultra';
const LABEL = process.env.LABEL ?? 'after';
const URL = `${process.env.GAME_URL ?? 'http://localhost:5173'}/?gfx=${GFX}`;
const OUT = 'tmp/market_count';
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,1000', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 1000 },
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
const tap = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
await page.waitForSelector('#btn-offline', { timeout: 30000 });
await tap('#btn-offline');
await wait(300);
await page.evaluate(() => {
  document.querySelector('#char-name').value = 'Strider';
  document.querySelector('#offline-select .mini-class[data-class="warrior"]')?.click();
});
await tap('#btn-start-offline');
await page.waitForFunction(() => window.__game?.hud && window.__game?.sim, { timeout: 30000 });
await wait(1500);

// Stand the player on the Merchant, list all 12 of their slots, then flood the
// market with 200 cheaper other-seller listings that sort first.
const setup = await page.evaluate(() => {
  const { sim, hud } = window.__game;
  const me = [...sim.players.keys()][0];
  let merch = null;
  for (const e of sim.entities.values()) if (e.templateId === 'the_merchant') merch = e;
  const pe = sim.entities.get(me);
  pe.pos.x = merch.pos.x; pe.pos.z = merch.pos.z; pe.prevPos = { ...pe.pos };

  sim.addItem('wolf_fang', 12, me);
  for (let i = 0; i < 12; i++) sim.marketList('wolf_fang', 1, 200 + i, me);

  let id = sim.nextListingId;
  for (let i = 0; i < 200; i++) {
    sim.marketListings.push({
      id: id++, sellerKey: `Trader${i}`, sellerName: `Trader${i}`,
      itemId: 'bone_fragments', count: 1, price: 40 + (i % 30), expiresAt: sim.time + 1000, house: false,
    });
  }
  sim.nextListingId = id;
  const info = sim.marketInfoFor(me);
  return {
    total: sim.marketListings.length,
    myListingCount: info.myListingCount,
    wired: info.listings.length,
    mineWired: info.listings.filter((l) => l.mine).length,
  };
});
console.log(`[${LABEL}]`, JSON.stringify(setup));

// Open the market and capture the Browse tab (page 1).
await page.evaluate(() => window.__game.hud.openMarket());
await wait(600);
const clip = await page.evaluate(() => {
  const el = document.querySelector('#market-window');
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
});
await page.screenshot({ path: `${OUT}/${LABEL}_browse.png`, clip });

// Switch to the Sell tab where the "X / 12 listing slots" note lives.
await page.evaluate(() => { const h = window.__game.hud; h.marketTab = 'sell'; h.renderMarket(); });
await wait(400);
await page.screenshot({ path: `${OUT}/${LABEL}_sell.png`, clip });

await browser.close();
console.log(`saved ${OUT}/${LABEL}_browse.png and ${OUT}/${LABEL}_sell.png`);
