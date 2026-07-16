// Screenshot Old Cragmaw's new unique drops in the offline client: the
// guaranteed `old_cragmaws_pelt` trophy and the rare `cragmaw_huntcord`
// waist piece (alongside the existing prowlboots). Boots the game, drops the
// items into the bag, opens it, and captures each new item's tooltip.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
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
page.on('pageerror', (e) => console.log(`PAGEERROR: ${e.message}`));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
// Landing flow (v0.12.0): Play -> Offline -> pick class + name -> Start.
const jsClick = (sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) throw new Error(`missing ${s}`);
    el.click();
  }, sel);
await page.waitForSelector('#nav-btn-play', { timeout: 15000 });
await jsClick('#nav-btn-play');
await page.waitForSelector('#btn-offline', { timeout: 15000 });
await jsClick('#btn-offline');
await page.waitForSelector('#offline-select .mini-class[data-class="warrior"]', { timeout: 15000 });
await page.type('#char-name', 'Brannok');
await jsClick('#offline-select .mini-class[data-class="warrior"]');
await jsClick('#btn-start-offline');
await page.waitForFunction(() => window.__game?.sim && window.__game.hud, { timeout: 20000 });
await new Promise((r) => setTimeout(r, 1200));

const info = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  // Drop Old Cragmaw's full unique table into the bag.
  sim.addItem('old_cragmaws_pelt', 1);
  sim.addItem('cragmaw_huntcord', 1);
  sim.addItem('cragmaw_prowlboots', 1);
  // toggleBags() treats an empty inline display as "open" and closes first,
  // so normalise to 'none' before toggling it open.
  document.querySelector('#bags').style.display = 'none';
  g.hud.toggleBags();
  g.hud.renderBags();
  const rows = [...document.querySelectorAll('#bags .bag-item')].map((r) => r.textContent.trim());
  return { rows };
});
console.log('bag rows:', JSON.stringify(info.rows));

await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: 'tmp/cragmaw_drops_bag.png' });

// Hover each new item to surface its tooltip, and capture name + quality + stats.
async function shotTooltip(label, file) {
  const idx = await page.evaluate((label) => {
    const rows = [...document.querySelectorAll('#bags .bag-item')];
    return rows.findIndex((r) => r.textContent.includes(label));
  }, label);
  if (idx < 0) {
    console.log(`tooltip ${label}: row not found`);
    return;
  }
  const rect = await page.evaluate((i) => {
    const r = [...document.querySelectorAll('#bags .bag-item')][i].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, idx);
  // Approach from outside the element so a real mouseenter + mousemove fires.
  await page.mouse.move(rect.x, rect.y - 60);
  await page.mouse.move(rect.x, rect.y, { steps: 8 });
  await new Promise((r) => setTimeout(r, 450));
  // Clip to the tooltip + bag region so the item details are legible.
  const clip = await page.evaluate(() => {
    const tt = document.querySelector('#tooltip');
    const bg = document.querySelector('#bags');
    const rs = [tt, bg]
      .filter((e) => e && e.style.display !== 'none')
      .map((e) => e.getBoundingClientRect());
    if (!rs.length) return null;
    const x0 = Math.min(...rs.map((r) => r.left)) - 12;
    const y0 = Math.min(...rs.map((r) => r.top)) - 12;
    const x1 = Math.max(...rs.map((r) => r.right)) + 12;
    const y1 = Math.max(...rs.map((r) => r.bottom)) + 12;
    return { x: Math.max(0, x0), y: Math.max(0, y0), width: x1 - x0, height: y1 - y0 };
  });
  await page.screenshot({ path: file, ...(clip ? { clip } : {}) });
  console.log(`saved ${file}`, clip ? '(clipped)' : '(full)');
}

await shotTooltip("Old Cragmaw's Pelt", 'tmp/cragmaw_trophy_tooltip.png');
await shotTooltip("Cragmaw's Huntcord", 'tmp/cragmaw_huntcord_tooltip.png');

await browser.close();
