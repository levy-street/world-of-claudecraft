// Visual proof of the unique-equipped tooltip tag (PR 2985). Boots the offline
// game as a WARRIOR, drops the two shipped legendary weapons and the legendary
// neck into the bags, and hovers each to capture the slot row now carrying the
// gold "Unique-Equipped" tag right-aligned in the type seat (the armor-weight
// layout), plus one non-legendary control shot showing an unchanged tooltip.
//   node scripts/unique_equipped_tooltip_shot.mjs    (needs `npm run dev` on :5173)
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

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

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
const booted = await enterOfflineGame(page, { charClass: 'warrior', charName: 'Thronebearer' });
if (!booted) {
  console.log('game did not boot');
  process.exit(1);
}

const inv = await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.addItem('kingsbane_last_oath', 1, sim.player.id); // legendary mainhand
  sim.addItem('voidsong_dirk', 1, sim.player.id); // legendary dagger
  sim.addItem('heart_of_the_rift', 1, sim.player.id); // legendary neck
  sim.addItem('redbrook_blade', 1, sim.player.id); // non-legendary control
  return sim.inventory.map((s) => s.itemId);
});
console.log('inventory set:', JSON.stringify(inv));

await page.keyboard.press('b'); // open bags
await sleep(600);
console.log(
  'bag rows:',
  await page.evaluate(() => document.querySelectorAll('#bags .bag-item').length),
);

async function hoverItem(itemId, shot) {
  await page.mouse.move(10, 10);
  await sleep(120);
  const ok = await page.evaluate((id) => {
    // Bag cells are icon buttons; the item identity rides data-focus-key
    // ("bag:<itemId>:<n>"), not the text content.
    const row = document.querySelector(`#bags .bag-item[data-focus-key^="bag:${id}:"]`);
    if (!row) return false;
    const b = row.getBoundingClientRect();
    const x = b.x + b.width / 2;
    const y = b.y + b.height / 2;
    for (const type of ['mouseenter', 'mouseover', 'mousemove']) {
      row.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
    }
    return true;
  }, itemId);
  if (!ok) {
    console.log('row not found:', itemId);
    return;
  }
  await sleep(300);
  const tip = await page.evaluate(() => {
    const tt = document.querySelector('#tooltip');
    return {
      shown: tt && tt.style.display === 'block',
      text: tt?.innerText?.replace(/\n/g, ' | '),
    };
  });
  console.log(`tooltip[${itemId}]:`, JSON.stringify(tip));
  const box = await page.evaluate(() => {
    const b = document.querySelector('#tooltip').getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  const pad = 8;
  await page.screenshot({
    path: shot,
    clip: {
      x: Math.max(0, box.x - pad),
      y: Math.max(0, box.y - pad),
      width: box.w + pad * 2,
      height: box.h + pad * 2,
    },
  });
}

await hoverItem('kingsbane_last_oath', 'tmp/unique_equipped_thronebane.png');
await hoverItem('voidsong_dirk', 'tmp/unique_equipped_voidsong.png');
await hoverItem('heart_of_the_rift', 'tmp/unique_equipped_neck.png');
await hoverItem('redbrook_blade', 'tmp/unique_equipped_control_nonlegendary.png');

await browser.close();
