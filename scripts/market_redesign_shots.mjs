// PR capture for the World Market listing/forms redesign: desktop + mobile shots
// of the Browse tab, flooded with a quality-varied, feature-representative book so
// the redesigned row reads at a glance (colored names, weight pips, the heroic
// star, the gold-dominant price, the forged gold Buy button). Boots the offline
// game, teleports to the Merchant, lists a fixed set of real items as fake sellers,
// opens the market, and clips the window. Run with `npm run dev` up; override the
// port with GAME_URL, the output dir with OUT_DIR (so the same script can capture
// both the "before" checkout and the "after" branch into different folders).
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.OUT_DIR ?? 'docs/screenshots/market-house-redesign';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A fixed, quality-varied book: [itemId, copperPrice, seller]. Real item ids so
// names, quality colors, and armor types all resolve from the shipped content.
const G = 10000;
const S = 100;
const BOOK = [
  ['broodmother_silk_robe', 38 * G + 60 * S, 'Kaelra'], // epic cloth
  ['heroic_eelscale_leggings', 138 * G, 'Vane'], // heroic leather rare (gold star)
  ['valeborn_spellblade', 7 * G, 'Gnotib'], // rare, no armor
  ['cryptbone_greaves', 5 * G, 'Marsh'], // uncommon mail
  ['woven_robe', 9 * G, 'Aldwin'], // uncommon cloth
  ['moggers_shiv', 3 * G + 60 * S, 'Ahap'], // rare
  ['heart_of_the_rift', 48500 * G + 99 * S + 99, 'Croesus'], // legendary, huge price
  ['recruit_tunic', 51, 'Sweden'], // common leather, copper-only
  ['deathless_heartwood', 480 * G, 'Thorne'], // legendary long name
  ['roasted_boar', 1 * G + 51 * S + 20, 'Woodsman'], // common commodity
];

async function floodAndOpen(page) {
  // Boot can outlast a fixed settle under SwiftShader; wait for the live world.
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
    const m = sim.market;
    const arr = m.marketListings;
    let id = 6000;
    for (const [itemId, price, sellerName] of book) {
      arr.push({
        id: id++,
        sellerKey: 's' + id,
        sellerName,
        itemId,
        count: 1,
        price,
        expiresAt: null,
        house: false,
      });
    }
    m.sortedBookByPriceCache = null;
    window.__game.hud.openMarket();
  }, BOOK);
  await sleep(600);
  // Hide every other window so the market clips clean.
  await page.evaluate(() => {
    for (const w of document.querySelectorAll('.window')) {
      if (w.id !== 'market-window') w.style.display = 'none';
    }
  });
}

async function clipMarket(page, name, { scrollToRows = false } = {}) {
  if (scrollToRows) {
    // The mobile market is a whole-sheet scroller taller than the viewport; the
    // listing rows (the redesign) sit below the controls, so scroll them into
    // view before clipping so the shot shows rows, not just the filters.
    await page.evaluate(() => {
      const scroller = document.querySelector('#market-window');
      const firstRow = document.querySelector('.mkt-row');
      if (scroller && firstRow) {
        scroller.scrollTop = firstRow.offsetTop - 8;
      }
    });
    await sleep(200);
  }
  const box = await page.evaluate(() => {
    const w = document.querySelector('#market-window');
    const r = w.getBoundingClientRect();
    const vh = window.innerHeight;
    // Clip to the on-screen portion of the window only (a clip past the viewport
    // bottom captures blank canvas).
    const top = Math.max(0, Math.round(r.y));
    const height = Math.round(Math.min(r.bottom, vh) - top);
    return { x: Math.max(0, Math.round(r.x)), y: top, width: Math.round(r.width), height };
  });
  console.log(name, 'market box:', JSON.stringify(box));
  await page.screenshot({ path: `${OUT}/${name}.png`, clip: box });
  console.log('captured ->', `${OUT}/${name}.png`);
}

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--window-size=1280,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    // Suppress the Chromium "hardware acceleration is unavailable" infobar that
    // software rendering (swiftshader) raises: it can overlap the clipped market
    // window corner and leak into a committed shot. --test-type stops Chromium
    // treating the automation session as a normal profile that shows the banner.
    '--disable-infobars',
    '--test-type',
  ],
  defaultViewport: { width: 1280, height: 900 },
});

// ---- Desktop ----
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await enterOfflineGame(page, { charClass: 'warrior', charName: 'Trader', settleMs: 2800 });
await sleep(400);
await floodAndOpen(page);
await clipMarket(page, 'desktop');
await page.close();

// ---- Mobile ----
// The client gates portrait on phones with a "rotate to landscape" screen, so
// the touch capture uses a LANDSCAPE phone viewport (matching the repo's other
// market mobile shots) and dismisses the GPU/preflight banner before flooding.
const mob = await browser.newPage();
mob.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await mob.emulate({
  name: 'phone-landscape',
  userAgent:
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
  viewport: {
    width: 844,
    height: 560,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    isLandscape: true,
  },
});
await mob.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await enterOfflineGame(mob, { charClass: 'warrior', charName: 'Trader', settleMs: 3000 });
await mob.evaluate(() => document.getElementById('mobile-preflight-continue')?.click());
await sleep(400);
await floodAndOpen(mob);
await clipMarket(mob, 'mobile', { scrollToRows: true });
await mob.close();

await browser.close();
console.log('done');
