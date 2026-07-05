// Screenshot walkthrough of the World Market browse SEARCH (added so players can
// reach goods past the MARKET_WIRE_LIMIT=120 per-snapshot cap). Boots the offline
// game headless, floods the Merchant's market with many adventurers' listings so
// the cap actually bites, then drives the REAL HUD: the Browse tab with its new
// search field, a name-filtered view, and the "showing N of M" truncation note.
// Screenshots land in tmp/. Run with `npm run dev` already up.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => fails.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE-ERR:', m.text()); });

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await page.waitForSelector('#offline-select .mini-class[data-class="warrior"]', { visible: true, timeout: 20000 });
await sleep(200);
await page.evaluate(() => {
  document.querySelector('#char-name').value = 'Hero';
  document.querySelector('#offline-select .mini-class[data-class="warrior"]').click();
  document.querySelector('#btn-start-offline').click();
});
await page.waitForFunction(() => window.__game?.sim?.entities?.size > 5, { timeout: 20000, polling: 200 });
await sleep(1500);

// Flood the market so the 120-cap bites: many sellers, 12 listings each, across
// a spread of items so a name search has something to filter to.
const scene = await page.evaluate(() => {
  const sim = window.__game.sim;
  const merchant = [...sim.entities.values()].find((e) => e.templateId === 'the_merchant');
  const at = (e, x, z) => { const p = sim.groundPos(x, z); e.pos = p; e.prevPos = { ...p }; };

  const me = sim.player;
  at(me, merchant.pos.x, merchant.pos.z - 3.2);
  me.facing = 0; me.prevFacing = 0;
  sim.players.get(me.id).copper = 500000;

  // A pool of distinctly-named items; several share the word "Wolf" so a "wolf"
  // search reads clearly in the screenshot.
  const goods = ['wolf_fang', 'wolf_pelt', 'spider_leg', 'roasted_boar', 'keen_dirk',
    'oiled_boots', 'greyjaw_pelt_cloak', 'bone_fragments', 'boar_tusk', 'cracked_fang'];
  let listed = 0;
  for (let i = 0; i < 14; i++) {
    const pid = sim.addPlayer(['mage', 'rogue', 'priest', 'hunter'][i % 4], 'Seller' + 'ABCDEFGHIJKLMN'[i]);
    const e = sim.entities.get(pid);
    at(e, merchant.pos.x + (i % 5) - 2, merchant.pos.z + 2 + (i % 3));
    for (let j = 0; j < 12; j++) {
      const id = goods[(i + j) % goods.length];
      sim.addItem(id, 1, pid);
      if (sim.marketList(id, 1, 100 + j * 10, pid) !== false) listed++;
    }
  }
  return { merchant: !!merchant, total: sim.marketListings.length };
});
check(scene.merchant, 'the Merchant exists');
check(scene.total > 120, `market is flooded past the 120 cap (${scene.total} listings)`);

// 1) Browse tab — the new search field sits atop the (capped) list, with the
//    "showing 120 of N" truncation note telling the player there is more.
await page.evaluate(() => window.__game.hud.openMarket());
await sleep(500);
const browse = await page.evaluate(() => ({
  hasSearch: !!document.querySelector('#market-body .mkt-search'),
  rows: document.querySelectorAll('#market-body .mkt-row').length,
  note: document.querySelector('#market-body .mkt-note')?.textContent ?? '',
  shown: window.__game.world.marketInfo.listings.length,
  total: window.__game.world.marketInfo.totalCount,
}));
check(browse.hasSearch, 'Browse tab shows the new search field');
check(browse.rows === 120, `Browse is capped at the wire limit (${browse.rows} rows)`);
check(/showing/i.test(browse.note), `truncation note is shown: "${browse.note}"`);
check(browse.total > browse.shown, `server reports more matches (${browse.total}) than shipped (${browse.shown})`);
await page.screenshot({ path: 'tmp/market_search_01_capped.png' });

// 2) Type a name into the search — the server-side filter narrows the list so
//    the matching goods become reachable even though they were past the cap.
await page.evaluate(() => {
  const s = document.querySelector('#market-body .mkt-search');
  s.value = 'wolf';
  s.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(500);
const filtered = await page.evaluate(() => ({
  filter: window.__game.world.marketInfo.filter,
  rows: document.querySelectorAll('#market-body .mkt-row').length,
  allWolf: window.__game.world.marketInfo.listings.every((l) => /wolf/i.test(l.itemId)),
}));
check(filtered.filter === 'wolf', `search term reached the server (filter="${filtered.filter}")`);
check(filtered.rows > 0 && filtered.allWolf, `every shown listing matches "wolf" (${filtered.rows} rows)`);
await page.screenshot({ path: 'tmp/market_search_02_filtered.png' });

// 3) A no-match query shows the friendly empty-search copy (field still present).
await page.evaluate(() => {
  const s = document.querySelector('#market-body .mkt-search');
  s.value = 'zzzznothing';
  s.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(500);
const empty = await page.evaluate(() => ({
  hasSearch: !!document.querySelector('#market-body .mkt-search'),
  empty: document.querySelector('#market-body .mkt-empty')?.textContent ?? '',
}));
check(empty.hasSearch && empty.empty.length > 0, `no-match shows empty copy: "${empty.empty}"`);
await page.screenshot({ path: 'tmp/market_search_03_nomatch.png' });

await browser.close();
console.log(fails.length === 0 ? '\nALL MARKET-SEARCH CHECKS PASSED' : `\n${fails.length} CHECK(S) FAILED:\n - ` + fails.join('\n - '));
process.exit(fails.length === 0 ? 0 : 1);
