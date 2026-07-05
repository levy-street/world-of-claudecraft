// Screenshot harness for the Crossroads Outfitters gear pack (items.ts).
// Boots an offline warrior, grants all 12 pieces, equips a full set, and
// captures three frames: bags (all 12 + icons), paperdoll (equipped set), and
// the World Market showing The Merchant's standing Crossroads stock.
// Needs `npm run dev` on :5173 (override with GAME_URL). Writes to tmp/.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PACK = [
  'crossroads_saber', 'tradesman_hatchet', 'drovers_staff', 'caravan_warden_dirk',
  'outrider_brigandine', 'caravan_quilted_vest', 'wanderers_chestguard', 'outrider_legguards',
  'trail_leggings', 'pilgrims_leggings', 'outrider_sabatons', 'milepost_boots',
];
// unrestricted pieces a warrior can wear, one per slot, for the paperdoll
const EQUIP = ['crossroads_saber', 'outrider_brigandine', 'outrider_legguards', 'outrider_sabatons'];

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(200);
await page.type('#char-name', 'Wendel');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await sleep(2500);

// god-mode, grant the whole pack, equip a full set
await page.evaluate((pack, equip) => {
  const g = window.__game;
  const p = g.sim.player;
  p.maxHp = 99999; p.hp = 99999; p.level = 12;
  for (const id of pack) g.sim.addItem(id, 1, p.id);
  for (const id of equip) g.sim.equipItem(id, p.id);
  // stand the player on The Merchant so the World Market stays open
  const ents = g.sim.entities ? [...(g.sim.entities.values?.() ?? g.sim.entities)] : [];
  const merchant = ents.find((e) => e && (e.templateId === 'the_merchant' || e.npcId === 'the_merchant'));
  if (merchant && merchant.pos) { p.pos.x = merchant.pos.x; p.pos.z = merchant.pos.z; }
}, PACK, EQUIP);
await sleep(600);

const closeAll = () => page.evaluate(() => {
  for (const id of ['#market-window', '#bags', '#char-window', '#loot-window']) {
    const el = document.querySelector(id); if (el) el.style.display = 'none';
  }
  const h = window.__game.hud; h.marketOpen = false;
});

// pin a window to a fixed, on-screen rect (the bags/market panels position
// themselves with 100vw/auto-offset CSS that lands off-screen under headless)
const pin = (sel, css) => page.evaluate((s, c) => {
  const el = document.querySelector(s);
  Object.assign(el.style, c);
}, sel, css);

// --- market shot: player is on the merchant so it stays open ---
await page.evaluate(() => { window.__game.hud.openMarket(); });
await pin('#market-window', { position: 'fixed', top: '70px', left: '40px', right: 'auto', bottom: 'auto', transform: 'none', zIndex: '9999' });
await sleep(900);
await page.screenshot({ path: 'tmp/crossroads-market.png' });
const mEl = await page.$('#market-window');
if (mEl) await mEl.screenshot({ path: 'tmp/crossroads-market-crop.png' });

// --- bags shot: toggleBags() reads the empty inline style as "open" on the
// first call, so call until it actually shows, then pin it on-screen. ---
await closeAll();
await page.evaluate(() => {
  const el = document.querySelector('#bags');
  for (let i = 0; i < 3 && getComputedStyle(el).display === 'none'; i++) window.__game.hud.toggleBags();
  window.__game.hud.renderBags();
});
await pin('#bags', { position: 'fixed', top: '60px', right: '24px', left: 'auto', bottom: 'auto', transform: 'none', maxHeight: '780px', zIndex: '9999' });
await sleep(700);
await page.screenshot({ path: 'tmp/crossroads-bags.png' });
const bEl = await page.$('#bags');
if (bEl) await bEl.screenshot({ path: 'tmp/crossroads-bags-crop.png' });

// --- paperdoll: full frame plus a tight crop of the panel for legibility ---
await closeAll();
await page.evaluate(() => { window.__game.hud.toggleChar(); });
await sleep(700);
await page.screenshot({ path: 'tmp/crossroads-character.png' });
const charEl = await page.$('#char-window');
if (charEl) await charEl.screenshot({ path: 'tmp/crossroads-paperdoll.png' });

await browser.close();
console.log('done -> tmp/crossroads-{bags,character,market}.png');
