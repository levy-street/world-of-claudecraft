// Online World Market end-to-end over real WebSockets, in two phases:
//   node scripts/market_mp_e2e.mjs sell    -> two clients: seller lists, buyer
//     sees it across the wire, earns coin at the vendor, buys it; seller (still
//     online) is credited and collects. Seller leaves one item listed.
//   node scripts/market_mp_e2e.mjs verify   -> after a server restart, the
//     seller reconnects and the still-listed item is present (DB persistence).
// Needs the game server up (:8787) with ALLOW_DEV_COMMANDS=1. A fixed MKT_UNIQ
// env keeps the account/char names stable across the two phases.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:8787';
const PHASE = process.argv[2] ?? 'sell';
const UNIQ = process.env.MKT_UNIQ ?? 'demo';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'}  ${m}`); if (!c) fails.push(m); };
const SELLER = `Sellwyn${UNIQ}`;
const BUYER = `Buyrum${UNIQ}`;
const PASS = 'hunter22';

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH, headless: 'new', protocolTimeout: 60000,
  args: ['--no-sandbox', '--window-size=1280,760', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 760 },
});

async function enter(page, charName, cls, mode) {
  page.on('pageerror', (e) => fails.push(`[${charName}] ` + e.message));
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(700);
  await page.evaluate((u, p, btn) => {
    document.querySelector('#btn-online').click();
    document.querySelector('#login-user').value = u;
    document.querySelector('#login-pass').value = p;
    document.querySelector(btn).click();
  }, `mkt_${charName}`, PASS, mode === 'register' ? '#btn-register' : '#btn-login');
  await page.waitForFunction(() => document.querySelector('#charselect-panel')?.style.display === 'block', { timeout: 9000, polling: 200 });
  if (mode === 'register') {
    await page.evaluate((name, cls) => {
      document.querySelector('#new-char-name').value = name;
      document.querySelector(`#charselect-panel .mini-class[data-class="${cls}"]`).click();
      document.querySelector('#btn-create-char').click();
    }, charName, cls);
    await sleep(700);
  }
  await page.evaluate((name) => {
    [...document.querySelectorAll('.char-row')].find((r) => r.querySelector('.char-name')?.textContent === name)?.querySelector('.enter-world-btn')?.click();
  }, charName);
  await page.waitForFunction(() => window.__game?.world?.entities?.size > 5, { timeout: 20000, polling: 500 });
  await sleep(500);
}

// teleport to the Merchant (dev) and wait until the server streams the market
async function goToMerchant(page) {
  await page.evaluate(() => {
    const w = window.__game.world;
    const m = [...w.entities.values()].find((e) => e.templateId === 'the_merchant');
    window.__MKT = { x: m.pos.x, z: m.pos.z };
    window.__game.online.cmd({ cmd: 'dev_teleport', x: m.pos.x, z: m.pos.z - 3 });
  });
  await page.waitForFunction(() => window.__game.world.marketInfo !== null, { timeout: 8000, polling: 150 });
}

if (PHASE === 'sell') {
  const seller = await browser.newPage();
  const buyer = await browser.newPage();
  await enter(seller, SELLER, 'warrior', 'register');
  await enter(buyer, BUYER, 'mage', 'register');
  await goToMerchant(seller);

  // seller lists two items: the boots will sell, the candle stays for the
  // persistence phase
  await seller.evaluate(() => {
    window.__game.online.cmd({ cmd: 'dev_give', item: 'oiled_boots', count: 1 });
    window.__game.online.cmd({ cmd: 'dev_give', item: 'tallow_candle', count: 1 });
  });
  await sleep(500);
  await seller.evaluate(() => {
    window.__game.world.marketList('oiled_boots', 1, 400);
    window.__game.world.marketList('tallow_candle', 1, 250);
  });
  await sleep(500);

  // buyer walks up and should see the seller's listings over the wire
  await goToMerchant(buyer);
  await buyer.evaluate(() => window.__game.hud.openMarket());
  await sleep(500);
  const seen = await buyer.evaluate((sellerName) => {
    const ls = window.__game.world.marketInfo.listings.filter((l) => l.sellerName === sellerName);
    return { count: ls.length, boots: ls.find((l) => l.itemId === 'oiled_boots') ?? null };
  }, SELLER);
  check(seen.count >= 2, `buyer sees the seller's ${seen.count} listings across the wire`);
  await buyer.screenshot({ path: 'tmp/market_mp_buyer_sees.png' });

  // buyer earns coin at Trader Wilkes, then buys the boots
  await buyer.evaluate(() => window.__game.online.cmd({ cmd: 'dev_give', item: 'militia_vest', count: 5 }));
  await sleep(400);
  await buyer.evaluate(() => window.__game.online.cmd({ cmd: 'dev_teleport', x: -7, z: 3 })); // Trader Wilkes
  await sleep(600);
  await buyer.evaluate(() => { for (let i = 0; i < 5; i++) window.__game.world.sellItem('militia_vest'); });
  await sleep(600);
  const purse = await buyer.evaluate(() => window.__game.world.copper);
  check(purse >= 400, `buyer earned coin at the vendor (${purse}c)`);
  await goToMerchant(buyer);
  await buyer.evaluate((id) => window.__game.world.marketBuy(id), seen.boots.id);
  await sleep(700);
  const bought = await buyer.evaluate(() => window.__game.sim.countItem ? null : null); // sim not on client
  const buyerHasBoots = await buyer.evaluate(() => window.__game.world.inventory.some((s) => s.itemId === 'oiled_boots'));
  check(buyerHasBoots, 'buyer received the Oiled Leather Boots over the wire');

  // the seller, still online, was credited — collect it
  await sleep(500);
  const owed = await seller.evaluate(() => window.__game.world.marketInfo?.collectionCopper ?? 0);
  check(owed === Math.floor(400 * 0.95), `seller is owed ${owed}c (400c sale less 5% cut)`);
  await seller.evaluate(() => window.__game.hud.openMarket());
  await sleep(300);
  const before = await seller.evaluate(() => window.__game.world.copper);
  await seller.evaluate(() => window.__game.world.marketCollect());
  await sleep(600);
  const after = await seller.evaluate(() => window.__game.world.copper);
  check(after === before + owed, `seller collected ${owed}c into the purse (${before} -> ${after})`);
} else {
  // verify phase: reconnect the seller after a server restart
  const seller = await browser.newPage();
  await enter(seller, SELLER, 'warrior', 'login');
  await goToMerchant(seller);
  await seller.evaluate(() => window.__game.hud.openMarket());
  await sleep(500);
  const persisted = await seller.evaluate((sellerName) =>
    window.__game.world.marketInfo.listings.some((l) => l.sellerName === sellerName && l.itemId === 'tallow_candle'), SELLER);
  check(persisted, 'the still-listed Tallow Candle survived the server restart (DB persistence)');
  await seller.screenshot({ path: 'tmp/market_mp_persisted.png' });
}

await browser.close();
console.log(fails.length === 0 ? `\nPHASE "${PHASE}" PASSED` : `\n${fails.length} CHECK(S) FAILED:\n - ` + fails.join('\n - '));
process.exit(fails.length === 0 ? 0 : 1);
