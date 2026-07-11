// Visual proof for the heroic loot flair PR (#1705): the heroic upgraded drop variants
// (item level 28, rescaled stats, same name as the base with an "[HEROIC]" tooltip tag
// on the quality/kind line), the on-curve heroic weapon dps, and the Soulbound marker on
// Heroic Marks. Boots the offline game, grants a base drop next to its heroic variant
// plus a heroic weapon and a mark, and screenshots each tooltip.
//   node scripts/heroic_loot_shot.mjs    (needs `npm run dev` on :5173)
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

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForSelector('#btn-offline', { timeout: 60000 });
const jsClick = (sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) throw new Error(`missing ${s}`);
    el.click();
  }, sel);
await new Promise((r) => setTimeout(r, 400));
await jsClick('#btn-offline');
await new Promise((r) => setTimeout(r, 300));
await page.type('#char-name', 'Looter');
await jsClick('#offline-select .mini-class[data-class="warrior"]');
await jsClick('#btn-start-offline');
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 90000 });
await new Promise((r) => setTimeout(r, 2000));

await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 500));
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) =>
    /skip tutorial/i.test(b.textContent || ''),
  );
  btn?.click();
});
await new Promise((r) => setTimeout(r, 400));

// Cap level, turn on the item-level tooltip line, grant a base drop + its Heroic
// variant, a heroic set weapon + its base peer, and a soulbound mark.
const inv = await page.evaluate(() => {
  const { sim, hud } = window.__game;
  const pid = sim.player.id;
  sim.setPlayerLevel(20, pid);
  hud.optionsHooks?.settings.set('showItemLevel', true);
  const ids = [
    'deathlord_warplate', // base epic chest, item level 26
    'heroic_deathlord_warplate', // Heroic variant, item level 28
    'wyrmfang_greatblade', // base epic weapon, item level 26 (~15 dps)
    'gravewyrm_cleaver', // heroic set weapon, item level 31 (16 dps)
    'heroic_mark', // soulbound reward token
  ];
  for (const id of ids) sim.addItem(id, 1, pid);
  sim.tick();
  return sim.inventory.map((s) => s.itemId);
});
console.log('inventory:', JSON.stringify(inv));

await page.keyboard.press('b');
await new Promise((r) => setTimeout(r, 700));

// Hover the bag row whose NAME matches and whose tooltip text does/does not contain a
// probe string. The base epic and its heroic variant now share the same name, so they
// are told apart by the "[HEROIC]" tag the tooltip appends (need/avoid).
async function hoverShot(match, shot, { need, avoid } = {}) {
  const hoverRow = (nm, idx) =>
    page.evaluate(
      ({ nm, idx }) => {
        const rows = [...document.querySelectorAll('#bags .item-cell')].filter((r) =>
          (r.getAttribute('aria-label') || '').includes(nm),
        );
        const row = rows[idx];
        if (!row) return false;
        const b = row.getBoundingClientRect();
        const x = b.x + b.width / 2;
        const y = b.y + b.height / 2;
        for (const type of ['mouseenter', 'mouseover', 'mousemove'])
          row.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
        return true;
      },
      { nm, idx },
    );
  const readTip = () =>
    page.evaluate(() => {
      const tt = document.querySelector('#tooltip');
      return {
        shown: tt && tt.style.display === 'block',
        text: tt?.innerText?.replace(/\n/g, ' | '),
      };
    });
  // Walk every row with this name, hovering until the tooltip matches the probe.
  let tip = { shown: false };
  for (let idx = 0; idx < 8; idx++) {
    await page.mouse.move(10, 10);
    await new Promise((r) => setTimeout(r, 120));
    const ok = await hoverRow(match, idx);
    if (!ok) break;
    await new Promise((r) => setTimeout(r, 320));
    tip = await readTip();
    const text = tip.text || '';
    if (need && !text.includes(need)) continue;
    if (avoid && text.includes(avoid)) continue;
    break;
  }
  if (!tip.shown) {
    console.log('row not found:', match, JSON.stringify({ need, avoid }));
    return;
  }
  console.log(`tooltip[${match}]:`, JSON.stringify(tip));
  const box = await page.evaluate(() => {
    const b = document.querySelector('#tooltip').getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  const pad = 10;
  await page.screenshot({
    path: shot,
    clip: {
      x: Math.max(0, box.x - pad),
      y: Math.max(0, box.y - pad),
      width: box.w + pad * 2,
      height: box.h + pad * 2,
    },
  });
  console.log('shot:', shot);
}

await hoverShot('Barrowlord Warplate', 'tmp/heroic_variant_tooltip.png', { need: '[HEROIC]' });
await hoverShot('Barrowlord Warplate', 'tmp/base_chest_tooltip.png', { avoid: '[HEROIC]' });
await hoverShot('Gravewyrm Cleaver', 'tmp/heroic_weapon_tooltip.png');
await hoverShot('Wyrmfang Greatblade', 'tmp/base_weapon_tooltip.png');
await hoverShot('Heroic Mark', 'tmp/soulbound_mark_tooltip.png');

// A full bags shot for context.
await page.mouse.move(10, 10);
await new Promise((r) => setTimeout(r, 150));
await page.screenshot({ path: 'tmp/heroic_bags.png' });
console.log('shot: tmp/heroic_bags.png');

await browser.close();
