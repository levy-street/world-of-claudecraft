// Verification + screenshot harness for the bag-scroll-preservation fix.
// Boots the offline world as a mage, fills the bags past one screenful (so the
// .bag-grid scroll container actually scrolls), opens the bags, scrolls to the
// bottom, then clicks a mana potion to consume it. With the fix the list stays
// put; without it the list snaps back to the top.
//
// Needs a dev server (default :5173, override with GAME_URL). Renders at max
// graphics via ?gfx=ultra. Writes screenshots + a scrollTop report to tmp/.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = (process.env.GAME_URL ?? 'http://localhost:5173') + '/?gfx=ultra';
const TAG = process.env.SHOT_TAG ?? 'after';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#btn-offline', { timeout: 60000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(300);
await page.type('#char-name', 'Potionwyn');
await page.click('#offline-select .mini-class[data-class="mage"]');
await page.click('#btn-start-offline');
await page.waitForFunction(() => window.__game?.hud, { timeout: 60000 });
await sleep(2500);

// Fill the bags with many DISTINCT items (stacks would collapse to one row) so
// the .bag-grid actually overflows and scrolls, plus a mana potion to consume.
await page.evaluate(() => {
  const sim = window.__game.sim;
  const distinct = [
    'acolytes_circlet', 'amber_hide', 'apprentice_robe', 'apprentice_staff', 'baked_bread',
    'bandit_bandana', 'blessed_wax', 'boar_hide', 'bone_fragments', 'boundstone_girdle',
    'boundstone_helm', 'bramblehide_jerkin', 'brightwood_venison', 'bristleback_maul',
    'bristlehide_spaulders', 'bronzework_mace', 'caravan_quilted_vest', 'caravan_warden_dirk',
    'crossroads_saber', 'cryptbone_greaves', 'cryptbone_helm', 'cryptbone_pauldrons',
    'cryptstalker_jerkin', 'drovers_staff', 'eastbrook_arming_sword', 'eastbrook_chain_vest',
    'eastbrook_wool_trousers', 'elixir_of_the_bear', 'embroidered_mantle', 'footpad_jerkin',
    'glade_pelt', 'gnarled_staff', 'gorraks_cleaver',
  ];
  for (const id of distinct) sim.addItem(id, 1);
  sim.addItem('minor_mana_potion', 5);
});
await page.evaluate(() => {
  const el = document.querySelector('#bags');
  // toggleBags() reads the *inline* display; force it closed then open so we
  // get a guaranteed fresh render regardless of the default state.
  el.style.display = 'none';
  window.__game.hud.toggleBags();
});
await sleep(500);

// Scroll the grid to the bottom and capture the offset + the bottom item.
const before = await page.evaluate(() => {
  const grid = document.querySelector('#bags .bag-grid');
  grid.scrollTop = 300; // scroll partway down (stable, unclamped)
  return { scrollTop: grid.scrollTop, scrollHeight: grid.scrollHeight, clientHeight: grid.clientHeight };
});
await sleep(200);
await page.screenshot({ path: `tmp/bag-scroll-${TAG}-1-scrolled.png` });

// Consume a mana potion the same way a player would: click its bag row.
const used = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#bags .bag-item')];
  const row = rows.find((r) => /Mana Potion/i.test(r.textContent || ''));
  if (!row) return false;
  row.click();
  return true;
});
await sleep(400);

const after = await page.evaluate(() => {
  const grid = document.querySelector('#bags .bag-grid');
  return { scrollTop: grid.scrollTop, scrollHeight: grid.scrollHeight };
});
await page.screenshot({ path: `tmp/bag-scroll-${TAG}-2-after-use.png` });

const report = { tag: TAG, usedPotion: used, before, after, preserved: Math.abs(before.scrollTop - after.scrollTop) < 4 };
fs.writeFileSync(`tmp/bag-scroll-${TAG}-report.json`, JSON.stringify(report, null, 2));
console.log('REPORT', JSON.stringify(report));

await browser.close();
