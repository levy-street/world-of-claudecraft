// Screenshot harness for item set bonuses. Boots the offline world as a warrior,
// equips two Deathlord (tier-1 Strength set) pieces, opens the bags, and hovers a
// third Deathlord piece so its tooltip shows the set block: "Deathlord Battlegear
// (2/3)" with the 2-piece bonus lit and the 3-piece bonus still dim. Then equips
// the third piece and re-hovers to show both bonuses active. Needs a dev server
// (default :5173, override GAME_URL).

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
await page.type('#char-name', 'Setlord');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await page.waitForFunction(() => window.__game?.hud, { timeout: 60000 });
await sleep(1500);

async function equip(ids) {
  await page.evaluate((ids) => {
    const sim = window.__game.sim;
    sim.setPlayerLevel?.(20);
    for (const id of ids) {
      sim.addItem(id, 1);
      sim.equipItem(id);
    }
  }, ids);
}

// Show the tooltip for an item by hovering its bag row (open bags, then hover the
// row whose label contains the given text). Returns the tooltip's text so the run
// self-verifies.
async function hoverBagItem(label) {
  await page.evaluate(() => {
    const el = document.querySelector('#bags');
    if (el) el.style.display = 'none';
    window.__game.hud.toggleBags();
  });
  await sleep(400);
  const handle = await page.evaluateHandle((label) => {
    const rows = [...document.querySelectorAll('#bags .item-cell')];
    return rows.find((r) => (r.getAttribute('aria-label') || '').includes(label)) ?? null;
  }, label);
  const el = handle.asElement();
  if (!el) throw new Error(`bag row not found: ${label}`);
  await el.hover();
  await sleep(350);
  return page.evaluate(() => document.querySelector('#tooltip')?.innerText ?? '');
}

// State 1: two pieces equipped, a third in the bags -> (2/3), 3-piece dim.
await equip(['deathlord_warplate', 'deathlord_legguards']);
await page.evaluate(() => window.__game.sim.addItem('deathlord_sabatons', 1));
let tip = await hoverBagItem('Deathlord Sabatons');
console.log('TOOLTIP (2pc):\n' + tip);
await (await page.$('#tooltip')).screenshot({ path: 'tmp/item-set-bonus-2pc.png' });

// State 2: equip the third piece -> (3/3), both bonuses active.
await page.evaluate(() => {
  const el = document.querySelector('#bags');
  if (el) el.style.display = 'none';
});
await equip(['deathlord_sabatons']);
await page.evaluate(() => window.__game.sim.addItem('deathlords_dread_visage', 1));
tip = await hoverBagItem('Deathlord');
console.log('TOOLTIP (3pc):\n' + tip);
await (await page.$('#tooltip')).screenshot({ path: 'tmp/item-set-bonus-3pc.png' });

await browser.close();
console.log('wrote tmp/item-set-bonus-2pc.png and tmp/item-set-bonus-3pc.png');
