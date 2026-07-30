// Visual proof of the item tooltip comparison. Boots the offline game, drops a
// chest upgrade and a weapon into the bags, and hovers each to capture the
// "Currently equipped" comparison block with stat deltas.
//   node scripts/item_compare_visual.mjs    (needs `npm run dev` on :5173)

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.click('#btn-offline');
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Adventurer');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 2500));

// Drop an upgrade chest, a weapon, and a sidegrade into the bags.
const inv = await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.addItem('militia_vest', 1, sim.player.id); // uncommon chest upgrade vs Recruit's Tunic
  sim.addItem('eastbrook_chain_vest', 1, sim.player.id);
  return {
    equippedChest: sim.equipment.chest,
    equippedMain: sim.equipment.mainhand,
    inv: sim.inventory.map((s) => s.itemId),
  };
});
console.log('inventory set:', JSON.stringify(inv));

await page.keyboard.press('b'); // open bags
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: 'tmp/cmp_1_bags.png' });

// Hover the upgrade chest to raise its comparison tooltip.
async function hoverItem(name, shot) {
  const ok = await page.evaluate((nm) => {
    const rows = [...document.querySelectorAll('#bags .bag-item')];
    const row = rows.find((r) => r.textContent.includes(nm));
    if (!row) return false;
    const b = row.getBoundingClientRect();
    const x = b.x + b.width / 2,
      y = b.y + b.height / 2;
    for (const type of ['mouseenter', 'mouseover', 'mousemove']) {
      row.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
    }
    return true;
  }, name);
  if (!ok) {
    console.log('row not found:', name);
    return;
  }
  await new Promise((r) => setTimeout(r, 250));
  const tip = await page.evaluate(() => {
    const tt = document.querySelector('#tooltip');
    return {
      shown: tt && tt.style.display === 'block',
      hasCmp: !!tt?.querySelector('.tt-cmp'),
      text: tt?.innerText?.replace(/\n/g, ' | '),
    };
  });
  console.log(`tooltip[${name}]:`, JSON.stringify(tip));
  await page.screenshot({ path: shot });
  // also a tight, zoomed crop of just the tooltip for legibility in the PR
  const box = await page.evaluate(() => {
    const tt = document.querySelector('#tooltip');
    const b = tt.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  const pad = 6;
  await page.screenshot({
    path: shot.replace('.png', '_crop.png'),
    clip: {
      x: Math.max(0, box.x - pad),
      y: Math.max(0, box.y - pad),
      width: box.w + pad * 2,
      height: box.h + pad * 2,
    },
  });
}

await hoverItem('Militia Chainvest', 'tmp/cmp_2_chest_compare.png');
await hoverItem('Eastbrook Chainmail Vest', 'tmp/cmp_3_chest2_compare.png');

// Now equip the upgrade and hover the old tunic to show a downgrade (red deltas).
await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.equipItem('militia_vest'); // Recruit's Tunic swaps back into the bags
});
await new Promise((r) => setTimeout(r, 300));
await page.keyboard.press('b'); // close + reopen to re-render the bag list
await new Promise((r) => setTimeout(r, 150));
await page.keyboard.press('b');
await new Promise((r) => setTimeout(r, 250));
await hoverItem("Recruit's Tunic", 'tmp/cmp_4_downgrade.png');

await browser.close();
