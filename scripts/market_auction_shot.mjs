// Screenshots of the auction house extension to the World Market. Boots the
// offline game headless, stubs a marketInfo snapshot so the REAL market window
// renders (browse rows with time-left, auction bids, denomination badges, and a
// sell form with the duration picker, auction toggle, and deposit preview), and
// captures desktop browse, desktop sell, and a phone-viewport browse.
// Run with `npm run dev` already up.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = `${process.env.GAME_URL ?? 'http://localhost:5173'}/?gfx=med`;
const OUT_BROWSE = process.env.SHOT_BROWSE ?? 'tmp/market_auction_browse.png';
const OUT_SELL = process.env.SHOT_SELL ?? 'tmp/market_auction_sell.png';
const OUT_MOBILE = process.env.SHOT_MOBILE ?? 'tmp/market_auction_mobile.png';
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

// Drive the REAL sim market near a real Merchant: teleport beside the Eastbrook
// Merchant, seed real listings through the actual sim methods (an auction with a
// live bid, a per-unit stack, house stock is already seeded), then open the
// window through the HUD path so everything renders through marketInfoFor.
const setup = await page.evaluate(() => {
  const ui = document.querySelector('#ui');
  if (ui) ui.style.display = 'block';
  const g = window.__game;
  const sim = g.sim;
  // find the Merchant anchor
  let merchant = null;
  for (const e of sim.entities.values()) {
    if (e.name && /merchant|trader|auctioneer/i.test(e.name) && e.vendorItems === undefined) {
      merchant = e;
      if (/merchant/i.test(e.name)) break;
    }
  }
  if (!merchant) {
    for (const e of sim.entities.values()) {
      if (e.name && /merchant/i.test(e.name)) {
        merchant = e;
        break;
      }
    }
  }
  if (!merchant) return { ok: false, why: 'no merchant entity found' };
  const p = sim.entities.get(sim.playerId);
  p.pos.x = merchant.pos.x + 2;
  p.pos.z = merchant.pos.z + 2;
  // a second player to own an auction the viewer can bid on
  const rivalPid = sim.addPlayer('mage', 'Aldric');
  const rival = sim.entities.get(rivalPid);
  rival.pos.x = merchant.pos.x + 3;
  rival.pos.z = merchant.pos.z + 2;
  sim.players.get(rivalPid).copper = 500000;
  sim.addItem('eastbrook_arming_sword', 1, rivalPid);
  sim.addItem('wolf_fang', 20, rivalPid);
  sim.marketList('eastbrook_arming_sword', 1, 4000, rivalPid, {
    durationHours: 24,
    auction: { startingBid: 2500, buyoutPrice: 9000 },
  });
  sim.marketList('wolf_fang', 20, 35, rivalPid, { durationHours: 12 });
  // the viewer holds gold and bids on the auction
  sim.copper = 250000;
  const auction = [...sim.marketListings].find((l) => l.kind === 'auction');
  if (auction) sim.marketBid(auction.id, 2600);
  sim.tick();
  g.hud.openMarketWindow?.() ?? g.hud.openMarket?.();
  return {
    ok: true,
    listings: sim.marketListings.length,
    auctionId: auction?.id ?? -1,
  };
});
check(setup.ok, `market staged near the Merchant (${setup.why ?? `${setup.listings} listings`})`);
await sleep(400);
const winState = await page.evaluate(() => {
  const w = document.querySelector('#market-window');
  return {
    open: !!w && w.style.display !== 'none' && w.style.display !== '',
    display: w?.style.display,
    hasRows: (w?.querySelectorAll('.mkt-row, [class*="mkt-"]').length ?? 0) > 0,
  };
});
check(winState.open || winState.hasRows, `market window rendering (display=${winState.display})`);
const clip = async () => {
  const r = await page.evaluate(() => {
    const w = document.querySelector('#market-window').getBoundingClientRect();
    return {
      x: Math.max(0, w.x - 16),
      y: Math.max(0, w.y - 16),
      width: w.width + 32,
      height: w.height + 32,
    };
  });
  return r;
};
await page.screenshot({ path: OUT_BROWSE, clip: await clip() });
console.log(`wrote ${OUT_BROWSE}`);

// Sell tab with the duration picker + auction toggle + deposit preview.
const sellState = await page.evaluate(() => {
  const w = document.querySelector('#market-window');
  const tabs = [...(w?.querySelectorAll('button, .mkt-tab, [role="tab"]') ?? [])];
  const sellTab = tabs.find((b) => /sell/i.test(b.textContent ?? ''));
  sellTab?.click();
  const bagItem = document.querySelector('#bags .bag-item, .bag-item');
  bagItem?.click();
  return { tabbed: !!sellTab };
});
check(sellState.tabbed, 'sell tab opened');
await sleep(400);
await page.screenshot({ path: OUT_SELL, clip: await clip() });
console.log(`wrote ${OUT_SELL}`);

// Phone viewport.
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await page.evaluate(() => {
  document.body.classList.add('mobile-touch');
  const w = document.querySelector('#market-window');
  const tabs = [...(w?.querySelectorAll('button, .mkt-tab, [role="tab"]') ?? [])];
  tabs.find((b) => /browse|buy/i.test(b.textContent ?? ''))?.click();
});
await sleep(400);
const mclip = await page.evaluate(() => {
  const r = document.querySelector('#market-window').getBoundingClientRect();
  return {
    x: Math.max(0, r.x),
    y: Math.max(0, r.y),
    width: Math.min(390, r.width),
    height: Math.min(844, r.height),
  };
});
await page.screenshot({ path: OUT_MOBILE, clip: mclip });
console.log(`wrote ${OUT_MOBILE}`);

await browser.close();
console.log(
  fails.length === 0
    ? '\nALL MARKET-AUCTION CHECKS PASSED'
    : `\n${fails.length} CHECK(S) FAILED:\n - ${fails.join('\n - ')}`,
);
process.exit(fails.length === 0 ? 0 : 1);
