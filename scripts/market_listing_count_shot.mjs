// Evidence for the market-listing-count fix. Reproduces a busy shared market
// (>120 listings) where a seller holds all 12 of their slots, then captures the
// market window's Sell tab ("X / 12 slots") alongside the Browse tab. Before the
// fix the seller's own goods sort past MARKET_WIRE_LIMIT and never wire, so the
// Browse list shows none of them while Sell still reads 12/12. After the fix the
// seller's listings are always wired (the "Reclaim" rows on page 1).
//
// Run with max graphics: GFX=ultra. Toggle which build you screenshot with
// LABEL=before|after (purely cosmetic, it only affects the output filenames).
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';
import { buildFillerListings, summarizeListingIds } from './lib/market_filler_listings.mjs';

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
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
// The shared entry flow (scripts/CLAUDE.md): it drives Play Offline, the name, the
// class card, and Enter World, then dismisses the intro cinematic, the tutorial, and
// the camera prompt. None of those may appear in a capture, and the intro sets #ui to
// display:none outright, which zeroes the window clip taken below.
await enterOfflineGame(page, { charClass: 'warrior', charName: 'Strider', settleMs: 2500 });

// Stand the player on the Merchant and list all 12 of their slots.
const seeded = await page.evaluate(() => {
  const { sim } = window.__game;
  const merch = [...sim.entities.values()].find((e) => e.templateId === 'the_merchant');
  const pe = sim.player;
  pe.pos = sim.groundPos(merch.pos.x, merch.pos.z);
  pe.prevPos = { ...pe.pos };

  sim.addItem('wolf_fang', 12, sim.playerId);
  for (let i = 0; i < 12; i++) sim.marketList('wolf_fang', 1, 200 + i, sim.playerId);
  // The filler ids are allocated out in Node, so hand back what the book already
  // holds plus the clock their expiry is measured against.
  return { takenIds: sim.marketListings.map((l) => l.id), now: sim.time };
});

// Flood the market with 200 other-seller listings. Browse sorts by item name and
// only then by price, so a filler item whose name sorts ahead of the seller's own
// goods is what pushes those goods out of the wire window. The rows take their ids
// from the filler band's own allocator: the sim's listing-id counter is private to
// Market, so a script must never try to read one off Sim (#2475).
const fillers = buildFillerListings({ count: 200, takenIds: seeded.takenIds, now: seeded.now });
const setup = await page.evaluate((rows) => {
  const { sim } = window.__game;
  sim.marketListings.push(...rows);
  const info = sim.marketInfoFor(sim.playerId);
  return {
    total: sim.marketListings.length,
    myListingCount: info.myListingCount,
    wired: info.listings.length,
    mineWired: info.listings.filter((l) => l.mine).length,
    bookIds: sim.marketListings.map((l) => l.id),
  };
}, fillers);
// Report the id health of the whole seeded book alongside the counts: every row has
// to stay reachable by its own id or the market cannot resolve a buy or a reclaim
// against it (#2475 left all 200 filler rows sharing one unusable NaN).
const { bookIds, ...counts } = setup;
const ids = summarizeListingIds(bookIds);
console.log(`[${LABEL}]`, JSON.stringify({ ...counts, ids }));
// The seeded book is a precondition of the capture, not part of what the shot
// compares, so it holds for LABEL=before and LABEL=after alike and can be checked
// outright. Still write the PNGs (they are the evidence of whatever went wrong), but
// do not let an unattended rerun report success on a book #2475 would recognize.
if (ids.unusable > 0 || ids.duplicated > 0 || counts.total <= 120) {
  console.error(`[${LABEL}] seeded book is unfit for capture:`, JSON.stringify({ ...counts, ids }));
  process.exitCode = 1;
}

// Open the market and capture the Browse tab (page 1).
await page.evaluate(() => window.__game.hud.openMarket());
await wait(600);
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
await page.screenshot({ path: `${OUT}/${LABEL}_browse.png`, clip });

// Switch to the Sell tab where the "X / 12 listing slots" note lives. The tab state
// is private to the market window, so click the real tab button (the idiom of
// scripts/localization_e2e.mjs) instead of poking at the HUD. Wait for the button and
// then for its aria-pressed to flip, rather than sleeping: the clip below is the one
// computed on Browse, so a click that quietly missed would write a second Browse
// capture into the file named `_sell`, which is the failure mode the vanished
// hud.marketTab hook this replaces at least used to announce by throwing.
const SELL_TAB = '#market-window [data-tab="sell"]';
await page.waitForSelector(SELL_TAB, { timeout: 10000 });
await page.evaluate((sel) => document.querySelector(sel).click(), SELL_TAB);
await page.waitForFunction(
  (sel) => document.querySelector(sel)?.getAttribute('aria-pressed') === 'true',
  { timeout: 10000 },
  SELL_TAB,
);
await wait(400);
await page.screenshot({ path: `${OUT}/${LABEL}_sell.png`, clip });

await browser.close();
console.log(`saved ${OUT}/${LABEL}_browse.png and ${OUT}/${LABEL}_sell.png`);
