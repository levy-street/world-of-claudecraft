// Screenshot harness for the Modular Inventory & Bag Filtering System.
// Boots the offline world, fills the bags with a spread of items across every
// category, opens the bags, and captures the new filter bar in three states:
// (1) All + Recent, (2) the Weapons category chip active, (3) a live search.
// Needs a dev server (default :5173, override GAME_URL). Renders at ?gfx=ultra.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = (process.env.GAME_URL ?? 'http://localhost:5173') + '/?gfx=ultra';
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
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE:', m.text());
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#btn-offline', { timeout: 60000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(300);
await page.type('#char-name', 'Sortwyn');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await page.waitForFunction(() => window.__game?.hud, { timeout: 60000 });
await sleep(2500);

// A spread across every category so the chips and sorts have something to do.
await page.evaluate(() => {
  const sim = window.__game.sim;
  const items = [
    'eastbrook_arming_sword',
    'crossroads_saber',
    'caravan_warden_dirk',
    'bristleback_maul',
    'gorraks_cleaver',
    'apprentice_staff',
    'eastbrook_chain_vest',
    'cryptbone_helm',
    'cryptbone_greaves',
    'boundstone_girdle',
    'apprentice_robe',
    'acolytes_circlet',
    'baked_bread',
    'brightwood_venison',
    'minor_mana_potion',
    'minor_healing_potion',
    'elixir_of_the_bear',
    'boar_hide',
    'glade_pelt',
    'amber_hide',
    'bone_fragments',
  ];
  for (const id of items) sim.addItem(id, 1);
});
await page.evaluate(() => {
  const el = document.querySelector('#bags');
  el.style.display = 'none';
  window.__game.hud.toggleBags();
});
await sleep(500);
await page.screenshot({ path: 'tmp/bag-filter-1-all.png' });

// Activate the Weapons category chip.
await page.evaluate(() => {
  const chips = [...document.querySelectorAll('#bags .filter-row .chip')];
  const weapons = chips.find((c) => /weapon/i.test(c.textContent || ''));
  weapons?.click();
});
await sleep(400);
await page.screenshot({ path: 'tmp/bag-filter-2-weapons.png' });

// Reset to All, then type a live search.
await page.evaluate(() => {
  const chips = [...document.querySelectorAll('#bags .filter-row .chip')];
  chips.find((c) => /^all$/i.test((c.textContent || '').trim()))?.click();
});
await sleep(300);
await page.type('#bags .bag-search', 'crypt');
await sleep(400);
await page.screenshot({ path: 'tmp/bag-filter-3-search.png' });

const report = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#bags .item-cell')].map((r) =>
    (r.getAttribute('aria-label') || '').trim(),
  );
  const chips = [...document.querySelectorAll('#bags .filter-row .chip')].map((c) =>
    c.textContent.trim(),
  );
  return { chips, searchRows: rows };
});
console.log('REPORT', JSON.stringify(report));
fs.writeFileSync('tmp/bag-filter-report.json', JSON.stringify(report, null, 2));

await browser.close();
