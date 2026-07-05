// Visual proof of the inspect-another-player gear window. Boots the offline game,
// spawns a second player entity dressed in a full set, opens the right-click
// player context menu (showing the Inspect / View Profile action), then opens the
// inspect window which now renders that player's worn gear as a read-only
// paperdoll (portrait + name + level/class on top, equipment below).
//   node scripts/inspect_gear_shot.mjs    (needs `npm run dev` on :5173)
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
const jsClick = (sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) throw new Error(`missing ${s}`);
    el.click();
  }, sel);
await new Promise((r) => setTimeout(r, 400));
await jsClick('#btn-offline');
await new Promise((r) => setTimeout(r, 300));
await page.type('#char-name', 'Looker');
await jsClick('#offline-select .mini-class[data-class="warrior"]');
await jsClick('#btn-start-offline');
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 40000 });
await new Promise((r) => setTimeout(r, 2000));

// Dismiss the new-adventurer tutorial overlay (intercepts input otherwise).
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) =>
    /skip tutorial/i.test(b.textContent || ''),
  );
  btn?.click();
});
await new Promise((r) => setTimeout(r, 400));

// Spawn a second player entity dressed in a full set, so there is someone to
// inspect. The local player is auto-equipped, so copy that valid set onto the
// new player's render-only equippedItems mirror (what the inspect window reads).
const info = await page.evaluate(() => {
  const sim = window.__game.sim;
  const pid = sim.addPlayer('mage', 'Sorcia');
  const ent = sim.entities.get(pid);
  ent.level = 60;
  // A full end-game set (one real item per paperdoll slot from the ITEMS table)
  // so every slot fills and the per-quality tints are visible in the shot.
  ent.equippedItems = {
    helmet: 'deathlords_dread_visage',
    shoulder: 'necromancers_soulspire_mantle',
    chest: 'deathlord_warplate',
    mainhand: 'deathless_heartwood',
    gloves: 'wyrmshadow_talongrips',
    waist: 'boundstone_girdle',
    legs: 'deathlord_legguards',
    feet: 'deathlord_sabatons',
  };
  // place them beside the local player so the world looks populated
  ent.pos = { ...sim.player.pos, x: sim.player.pos.x + 2 };
  return { pid, slots: Object.keys(ent.equippedItems), name: ent.name };
});
console.log('inspectee:', JSON.stringify(info));

// 1) The right-click player context menu (shows the Inspect / View Profile row).
await page.evaluate((pid) => {
  window.__game.hud.openContextMenu(pid, 'Sorcia', 820, 360);
}, info.pid);
await new Promise((r) => setTimeout(r, 350));
const ctxBox = await page.evaluate(() => {
  const el = document.querySelector('#ctx-menu');
  if (!el || el.style.display === 'none') return null;
  const b = el.getBoundingClientRect();
  return { x: b.x, y: b.y, w: b.width, h: b.height };
});
if (ctxBox) {
  const pad = 10;
  await page.screenshot({
    path: 'tmp/inspect_context_menu.png',
    clip: {
      x: Math.max(0, ctxBox.x - pad),
      y: Math.max(0, ctxBox.y - pad),
      width: ctxBox.w + pad * 2,
      height: ctxBox.h + pad * 2,
    },
  });
  console.log('wrote tmp/inspect_context_menu.png');
} else {
  console.log('context menu not shown');
}

// 2) The inspect window itself, now with the worn-gear paperdoll.
await page.evaluate((pid) => {
  window.__game.hud.openInspect(pid);
}, info.pid);
await new Promise((r) => setTimeout(r, 500));
const win = await page.evaluate(() => {
  const el = document.querySelector('#inspect-window');
  const shown = el && el.style.display === 'block';
  const slots = document.querySelectorAll('#inspect-window .equip-slot').length;
  const items = [...document.querySelectorAll('#inspect-window .slot-item')].map(
    (n) => n.textContent,
  );
  const b = el?.getBoundingClientRect();
  return { shown, slots, items, box: b && { x: b.x, y: b.y, w: b.width, h: b.height } };
});
console.log('inspect window:', JSON.stringify(win));
if (win.shown && win.box) {
  const pad = 12;
  await page.screenshot({
    path: 'tmp/inspect_gear_window.png',
    clip: {
      x: Math.max(0, win.box.x - pad),
      y: Math.max(0, win.box.y - pad),
      width: win.box.w + pad * 2,
      height: win.box.h + pad * 2,
    },
  });
  console.log('wrote tmp/inspect_gear_window.png');
}

await page.screenshot({ path: 'tmp/inspect_full.png' });
await browser.close();
