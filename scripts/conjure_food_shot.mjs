// Screenshot harness for the mage Conjure Food ability + conjured bread items.
// Boots the offline world as a level-18 mage (all 3 ranks known), casts the
// spell to stock the bags, then captures the spellbook (Conjure Food listed)
// and the bags with a conjured-bread tooltip.
//
// Needs `npm run dev` on :5173 (override with GAME_URL). Writes to tmp/.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE:', m.text());
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(200);
await page.type('#char-name', 'Breadwyn');
await page.click('#offline-select .mini-class[data-class="mage"]');
await page.click('#btn-start-offline');
await sleep(2500);

// level the mage to 18 (all three Conjure Food ranks known) and conjure bread
const info = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  sim.setPlayerLevel(18);
  const p = sim.player;
  p.maxHp = 99999;
  p.hp = 99999;
  p.resource = 99999;
  // conjure each rank's bread so all three tiers sit in the bags
  sim.addItem('conjured_bread', 2);
  sim.addItem('conjured_bread2', 2);
  sim.addItem('conjured_bread3', 2);
  return {
    level: p.level,
    bread: sim.countItem('conjured_bread'),
    bread2: sim.countItem('conjured_bread2'),
    bread3: sim.countItem('conjured_bread3'),
  };
});
console.log('mage state:', JSON.stringify(info));
await sleep(500);

// --- spellbook: Conjure Food in the mage list (full frame + clipped) ---
await page.evaluate(() => window.__game.hud.toggleSpellbook());
await sleep(600);
await page.screenshot({ path: 'tmp/conjure-food-spellbook.png' });
const sbBox = await page.evaluate(() => {
  const el = document.querySelector('#spellbook');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});
if (sbBox && sbBox.width > 0) {
  await page.screenshot({ path: 'tmp/conjure-food-spellbook-panel.png', clip: sbBox });
}
await page.evaluate(() => window.__game.hud.toggleSpellbook());
await sleep(200);

// --- bags + tooltip on a conjured bread ---
await page.evaluate(() => {
  const hud = window.__game.hud;
  const el = document.querySelector('#bags');
  hud.renderBags();
  el.style.display = 'flex';
});
await sleep(600);
const hovered = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#bags .bag-item')];
  const el = rows.find((r) =>
    /Conjured (Bread|Pumpernickel|Sweet Roll)/i.test(
      r.textContent || r.getAttribute('aria-label') || '',
    ),
  );
  if (!el) return false;
  el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  return el.textContent.trim();
});
console.log('hovered conjured bread slot:', hovered);
await sleep(500);
await page.screenshot({ path: 'tmp/conjure-food-bags.png' });

await browser.close();
console.log('done -> tmp/conjure-food-spellbook.png, tmp/conjure-food-bags.png');
