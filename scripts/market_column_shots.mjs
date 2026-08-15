// PR capture for the World Market redesign at each column count the auto-fill
// grid produces (1 / 2 / 3 columns), so reviewers see the row degrade honestly
// at every width: a long name truncates with an ellipsis, the seller line yields
// first, the single-unit price stays right-aligned. Boots the offline game once,
// floods the same merchant-stock book, opens the market, and clips the window at
// three viewport widths. Run with `npm run dev` up. Output:
// docs/screenshots/market-house-redesign/desktop-{1,2,3}col.png.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.OUT_DIR ?? 'docs/screenshots/market-house-redesign';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const G = 10000;
const S = 100;
// A spread that exercises every row feature at each width: long names (truncate),
// heroic + armor items, a legendary six-figure price, a copper-only listing.
const BOOK = [
  ['broodmother_silk_robe', 38 * G + 60 * S, 'Kaelra'],
  ['cryptbone_greaves', 5 * G + 40 * S, 'Aldwin'],
  ['valeborn_spellblade', 7 * G, 'Woodsman'],
  ['heroic_eelscale_leggings', 20 * G, 'Stridente'],
  ['heart_of_the_rift', 48500 * G + 99 * S + 99, 'Croesus'],
  ['recruit_tunic', 51, 'Sweden'],
  ['deathless_heartwood', 480 * G, 'Thorne'],
  ['roasted_boar', 1 * G + 51 * S + 20, 'Woodsman'],
];

async function floodAndOpen(page) {
  await page.waitForFunction(() => !!window.__game?.sim?.player, { timeout: 30000 });
  await page.evaluate(() => {
    document.querySelector('.tut-skip')?.click();
    const hud = window.__game?.hud;
    for (let i = 0; i < 20 && hud?.closeAll?.(); i++) {}
  });
  await sleep(200);
  await page.evaluate((book) => {
    const sim = window.__game.sim;
    const merchant = [...sim.entities.values()].find((e) => e.templateId === 'the_merchant');
    const p = sim.groundPos(merchant.pos.x, merchant.pos.z - 3.2);
    sim.player.pos = p;
    sim.player.prevPos = { ...p };
    const arr = sim.market.marketListings;
    let id = 6300;
    for (const [itemId, price, sellerName] of book) {
      arr.push({
        id: id++,
        sellerKey: 's' + id,
        sellerName,
        itemId,
        count: 1,
        price,
        // Infinity, not null: the once-a-second expiry sweep prunes any non-house
        // listing whose expiresAt is not in the future.
        expiresAt: Number.POSITIVE_INFINITY,
        house: false,
      });
    }
    // Rebuild the viewer snapshot at default filters so the injected rows reach
    // the page marketInfoFor produces.
    sim.marketSearch(
      {
        search: '',
        itemType: 'all',
        subtype: 'all',
        armorClass: 'all',
        primaryStat: 'all',
        rarity: 'all',
        sort: 'name',
        page: 0,
      },
      sim.primaryId,
    );
    window.__game.hud.openMarket();
  }, BOOK);
  await sleep(600);
  await page.evaluate(() => {
    for (const w of document.querySelectorAll('.window')) {
      if (w.id !== 'market-window') w.style.display = 'none';
    }
  });
}

async function clip(page, name) {
  const box = await page.evaluate(() => {
    const w = document.querySelector('#market-window');
    const r = w.getBoundingClientRect();
    const top = Math.max(0, Math.round(r.y));
    const height = Math.round(Math.min(r.bottom, window.innerHeight) - top);
    return { x: Math.max(0, Math.round(r.x)), y: top, width: Math.round(r.width), height };
  });
  await page.screenshot({ path: `${OUT}/${name}.png`, clip: box });
  console.log('captured ->', `${OUT}/${name}.png`, JSON.stringify(box));
}

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--window-size=1400,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    // Suppress the software-rendering infobar so it never leaks into a shot.
    '--disable-infobars',
    '--test-type',
  ],
  defaultViewport: { width: 1400, height: 900 },
});
try {
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await enterOfflineGame(page, { charClass: 'warrior', charName: 'Trader', settleMs: 2800 });
  await floodAndOpen(page);
  // The .mkt-list grid is auto-fill minmax(260px, 1fr): the market window width
  // decides the column count. Resize the window itself (the market panel tracks
  // it) to land 1, 2, and 3 columns.
  const WIDTHS = [
    ['desktop-1col', 340],
    ['desktop-2col', 620],
    ['desktop-3col', 900],
  ];
  for (const [name, w] of WIDTHS) {
    await page.evaluate((width) => {
      const win = document.querySelector('#market-window');
      win.style.width = `${width}px`;
      win.style.maxWidth = 'none';
    }, w);
    await sleep(300);
    await clip(page, name);
  }
} finally {
  await browser.close();
}
