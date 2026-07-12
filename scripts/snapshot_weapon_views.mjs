// Capture the new weapon icons across the HUD: bags, vendor, character/equipment
// panel, and an item tooltip. Boots the offline game, stages weapons, equips one,
// opens each panel, and writes PNGs to tmp/weapon_snapshots/. Needs `npm run dev`.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = 'tmp/weapon_snapshots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', e.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.click('#btn-offline');
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Iconsmith');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 2500));

const setup = await page.evaluate(() => {
  const g = window.__game, sim = g.sim, pid = sim.player.id;
  const give = ['wyrmfang_greatblade', 'drogmars_skullcleaver', 'valeborn_spellblade', 'fang_of_korzul',
    'gravecaller_staff', 'moggers_copper_cudgel', 'fen_reaver_glaive', 'redbrook_blade', 'keen_dirk', 'worn_sword'];
  for (const id of give) sim.addItem(id, 1, pid);
  // equip the best warrior-usable weapon for the character panel
  let equipped = null;
  for (const id of ['wyrmfang_greatblade', 'drogmars_skullcleaver', 'redbrook_blade', 'worn_sword']) {
    try { g.world.equipItem(id); } catch (e) { /* class-locked */ }
    if (g.world.equipment?.mainhand === id) { equipped = id; break; }
  }
  // find a weapon-selling vendor NPC
  const knownVendorWeapons = ['eastbrook_arming_sword', 'bronzework_mace', 'vale_carving_knife',
    'hickory_shortstaff', 'highwatch_warblade', 'bogiron_mace', 'fenreed_staff', 'mirefen_skinner',
    'craghorn_staff', 'icevein_dirk'];
  let vendorId = null;
  for (const e of sim.entities.values()) {
    if (Array.isArray(e.vendorItems) && e.vendorItems.some((it) => knownVendorWeapons.includes(it))) {
      vendorId = e.id; break;
    }
  }
  return { equipped, mainhand: g.world.equipment?.mainhand ?? null, vendorId };
});
console.log('setup:', JSON.stringify(setup));

// 1) BAGS
await page.evaluate(() => {
  window.__game.hud.renderBags();
  document.querySelector('#bags').style.display = 'flex';
});
await new Promise((r) => setTimeout(r, 400));
await (await page.$('#bags')).screenshot({ path: `${OUT}/01_bags.png` });

// 2) CHARACTER / EQUIPMENT panel
await page.evaluate(() => {
  window.__game.hud.renderChar();
  document.querySelector('#char-window').style.display = 'block';
});
await new Promise((r) => setTimeout(r, 400));
await (await page.$('#char-window')).screenshot({ path: `${OUT}/02_character_panel.png` });

// 3) VENDOR window
if (setup.vendorId !== null) {
  const vstate = await page.evaluate((id) => {
    // stand next to the vendor so the world's update loop keeps the shop open
    const sim = window.__game.sim;
    const npc = sim.entities.get(id);
    sim.player.pos.x = npc.pos.x + 1.5; sim.player.pos.z = npc.pos.z;
    for (const sel of ['#char-window', '#bags']) { const e = document.querySelector(sel); if (e) e.style.display = 'none'; }
    window.__game.hud.openVendor(id);
    document.querySelector('#bags').style.display = 'none'; // openVendor re-shows bags
    return { name: npc?.name, kids: document.querySelector('#vendor-window').childElementCount };
  }, setup.vendorId);
  console.log('vendor state:', JSON.stringify(vstate));
  await new Promise((r) => setTimeout(r, 400));
  const vclip = await page.evaluate(() => {
    const el = document.querySelector('#vendor-window');
    el.style.display = 'block'; el.style.left = '600px'; el.style.top = '80px';
    const r = el.getBoundingClientRect();
    return { x: Math.max(0, r.x - 6), y: Math.max(0, r.y - 6), width: r.width + 12, height: r.height + 12 };
  });
  await page.screenshot({ path: `${OUT}/03_vendor.png`, clip: vclip });

  // 4) TOOLTIP — synthesize a hover on the first vendor weapon row (attachTooltip
  // listens for mouseenter/mousemove and positions #tooltip at the cursor).
  await page.evaluate(() => {
    const row = document.querySelector('#vendor-window .vendor-item');
    const r = row.getBoundingClientRect();
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    for (const type of ['mouseenter', 'mouseover', 'mousemove']) {
      row.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: cx, clientY: cy }));
    }
  });
  await new Promise((r) => setTimeout(r, 300));
  // crop a region covering both the shop panel and the floating tooltip
  const ttclip = await page.evaluate(() => {
    const v = document.querySelector('#vendor-window').getBoundingClientRect();
    const tt = document.querySelector('#tooltip');
    const t = tt && tt.style.display !== 'none' ? tt.getBoundingClientRect() : v;
    const x0 = Math.max(0, Math.min(v.x, t.x) - 10), y0 = Math.max(0, Math.min(v.y, t.y) - 10);
    const x1 = Math.max(v.x + v.width, t.x + t.width) + 10, y1 = Math.max(v.y + v.height, t.y + t.height) + 10;
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  });
  await page.screenshot({ path: `${OUT}/04_tooltip.png`, clip: ttclip });
} else {
  console.log('no weapon vendor found near spawn');
}

console.log('snapshots written to', OUT);
await browser.close();
