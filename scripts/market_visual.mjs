// Visual + functional walkthrough of the World Market (the Merchant's auction
// house). Boots the offline game in a headless browser, then drives the REAL
// HUD + Sim: browse the Merchant's stock and other adventurers' listings, buy
// an item, list one of your own, have another adventurer buy it, and collect
// the proceeds. Screenshots land in tmp/. Run with `npm run dev` already up
// (or it is started for you by the npm pretest wrapper / CI).

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

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
    '--window-size=1600,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
  ],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => fails.push('PAGEERROR: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE-ERR:', m.text());
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(200);
await page.click('.class-card[data-class="warrior"]');
await page.waitForFunction(() => window.__game?.sim?.entities?.size > 5, {
  timeout: 20000,
  polling: 200,
});
await sleep(1500);

// --- set the scene: stand at the Merchant; stock the market from several
// adventurers so it reads like a living world market; fill the player's bags
// and purse so they can both buy and sell. -----------------------------------
const scene = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const merchant = [...sim.entities.values()].find((e) => e.templateId === 'the_merchant');
  const at = (e, x, z) => {
    const p = sim.groundPos(x, z);
    e.pos = p;
    e.prevPos = { ...p };
  };

  // the player steps up to the Merchant, facing him
  const me = sim.player;
  at(me, merchant.pos.x, merchant.pos.z - 3.2);
  me.facing = 0;
  me.prevFacing = 0;
  sim.players.get(me.id).copper = 50000; // 5g to shop with
  sim.addItem('oiled_boots', 1); // a green to list
  sim.addItem('spider_leg', 4); // some junk

  // other adventurers consign goods to the market
  const others = [
    ['Brena', 'mage'],
    ['Tovrin', 'rogue'],
    ['Sella', 'priest'],
  ];
  const ids = {};
  for (const [name, cls] of others) {
    const pid = sim.addPlayer(cls, name);
    ids[name] = pid;
    const e = sim.entities.get(pid);
    at(e, merchant.pos.x + (Math.random() * 4 - 2), merchant.pos.z + 2 + Math.random() * 2);
    sim.players.get(pid).copper = 100000;
  }
  sim.addItem('keen_dirk', 1, ids.Brena);
  sim.marketList('keen_dirk', 1, 4200, ids.Brena);
  sim.addItem('roasted_boar', 5, ids.Tovrin);
  sim.marketList('roasted_boar', 5, 900, ids.Tovrin);
  sim.addItem('greyjaw_pelt_cloak', 1, ids.Sella);
  sim.marketList('greyjaw_pelt_cloak', 1, 2600, ids.Sella);
  sim.addItem('wolf_fang', 3, ids.Tovrin);
  sim.marketList('wolf_fang', 3, 120, ids.Tovrin);

  return {
    merchant: !!merchant,
    name: me.name,
    buyerId: ids.Brena,
    listings: sim.marketListings.length,
  };
});
check(scene.merchant, 'the Merchant exists in Eastbrook');
check(scene.listings >= 8, `market has stock (${scene.listings} listings: house + adventurers)`);

// 1) the Merchant standing at his World Market stall in the square
await page.evaluate(() => {
  window.__game.input.camDist = 7.5;
  window.__game.input.camPitch = 0.32;
});
await sleep(900);
await page.screenshot({ path: 'tmp/market_01_merchant.png' });

// 2) open the market — the Browse tab, full of listings
await page.evaluate(() => window.__game.hud.openMarket());
await sleep(500);
const browseRows = await page.evaluate(
  () => document.querySelectorAll('#market-body .mkt-row').length,
);
check(browseRows >= 8, `Browse tab shows ${browseRows} listings`);
await page.screenshot({ path: 'tmp/market_02_browse.png' });

// 3) buy another adventurer's listing outright (click a real Buy button) and
// confirm coin + goods move. Keen Dirk is Brena's and uniquely named.
const beforeBuy = await page.evaluate(() => {
  const dirk = window.__game.world.marketInfo.listings.find((l) => l.itemId === 'keen_dirk');
  return {
    copper: window.__game.world.copper,
    dirk: window.__game.sim.countItem('keen_dirk'),
    price: dirk.price,
    seller: dirk.sellerName,
  };
});
await page.evaluate(() => {
  const row = [...document.querySelectorAll('#market-body .mkt-row')].find(
    (r) => /Keen Dirk/.test(r.textContent) && /Buy/.test(r.textContent),
  );
  row.querySelector('.mkt-btn').click();
});
await sleep(600);
const afterBuy = await page.evaluate(() => ({
  copper: window.__game.world.copper,
  dirk: window.__game.sim.countItem('keen_dirk'),
}));
check(
  afterBuy.copper === beforeBuy.copper - beforeBuy.price,
  `buyer paid ${beforeBuy.price}c for ${beforeBuy.seller}'s Keen Dirk (${beforeBuy.copper} -> ${afterBuy.copper})`,
);
check(
  afterBuy.dirk === beforeBuy.dirk + 1,
  `buyer received the Keen Dirk (${beforeBuy.dirk} -> ${afterBuy.dirk})`,
);
await page.screenshot({ path: 'tmp/market_03_bought.png' });

// 4) Sell tab: pick an item from the bags and see the listing form
await page.evaluate(() => {
  document.querySelector('#market-window [data-tab="sell"]').click();
  const row = [...document.querySelectorAll('#bags .item-cell')].find((r) =>
    /Oiled Leather Boots/.test(r.getAttribute('aria-label') || ''),
  );
  row.click();
});
await sleep(400);
const sellForm = await page.evaluate(() => !!document.querySelector('#mkt-g'));
check(sellForm, 'Sell tab shows the price form for the chosen item');
await page.screenshot({ path: 'tmp/market_04_sell.png' });

// 5) list it for 4s, then Browse shows it as mine (Reclaim)
await page.evaluate(() => {
  document.querySelector('#mkt-g').value = '0';
  document.querySelector('#mkt-s').value = '4';
  document.querySelector('#mkt-c').value = '0';
  document.querySelector('.mkt-list-btn').click();
});
await sleep(600);
const listed = await page.evaluate(() => {
  window.__game.hud.openMarket(); // back to Browse
  const mine = window.__game.world.marketInfo.listings.find(
    (l) => l.mine && l.itemId === 'oiled_boots',
  );
  return { id: mine?.id ?? null, escrowed: window.__game.sim.countItem('oiled_boots') === 0 };
});
check(listed.id !== null, 'my Oiled Leather Boots are now listed on the market');
check(listed.escrowed, 'the listed item left my bags (held in escrow)');
await sleep(300);
await page.screenshot({ path: 'tmp/market_05_listed.png' });

// 6) another adventurer buys my listing; collect the proceeds (price less the cut)
await page.evaluate(
  (info) => {
    window.__game.sim.marketBuy(info.id, info.buyerId);
  },
  { id: listed.id, buyerId: scene.buyerId },
);
await sleep(400);
await page.evaluate(() => document.querySelector('#market-window [data-tab="collect"]').click());
await sleep(400);
const collectible = await page.evaluate(() => window.__game.world.marketInfo.collectionCopper);
check(
  collectible === Math.floor(400 * 0.95),
  `proceeds waiting to collect: ${collectible}c (4s = 400c listing, less 5% cut = 380c)`,
);
await page.screenshot({ path: 'tmp/market_06_collect.png' });

// collect it into the purse
const purseBefore = await page.evaluate(() => window.__game.world.copper);
await page.evaluate(() => document.querySelector('#market-body .mkt-list-btn').click());
await sleep(500);
const purseAfter = await page.evaluate(() => window.__game.world.copper);
check(
  purseAfter === purseBefore + collectible,
  `collected ${collectible}c into the purse (${purseBefore} -> ${purseAfter})`,
);
await page.screenshot({ path: 'tmp/market_07_collected.png' });

await browser.close();
console.log(
  fails.length === 0
    ? '\nALL MARKET CHECKS PASSED'
    : `\n${fails.length} CHECK(S) FAILED:\n - ` + fails.join('\n - '),
);
process.exit(fails.length === 0 ? 0 : 1);
