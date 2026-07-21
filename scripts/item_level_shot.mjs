// Item-level feature proof. Boots offline as a warrior, turns on the
// "Show Item Level" interface toggle, and captures: (1) the Interface options
// panel with the toggle, (2) item tooltips for a spread of level-20 gear across
// tiers (raid / dungeon / legendary / rare) showing the "Item Level N" + power-
// score lines, and (3) a before/after of the same item with the toggle off vs on.
// Needs `npm run dev`. Writes PNGs to tmp/.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tap = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);

async function clipEl(sel, name, pad = 6) {
  const box = await page.evaluate(
    (s, p) => {
      const el = document.querySelector(s);
      if (!el || el.style.display === 'none') return null;
      const r = el.getBoundingClientRect();
      if (r.width < 4) return null;
      return {
        x: Math.max(0, Math.round(r.x) - p),
        y: Math.max(0, Math.round(r.y) - p),
        width: Math.round(r.width) + 2 * p,
        height: Math.round(r.height) + 2 * p,
      };
    },
    sel,
    pad,
  );
  if (box) {
    await page.screenshot({ path: `tmp/item_level_${name}.png`, clip: box });
    console.log(`captured tmp/item_level_${name}.png`);
    return true;
  }
  console.log(`WARN: nothing to clip for ${name} (${sel})`);
  return false;
}

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForSelector('#btn-offline', { timeout: 180000 });
await wait(500);
await tap('#btn-offline');
await wait(400);
await page.evaluate(() => {
  const el = document.querySelector('#char-name');
  if (el) {
    el.value = 'Ilvl';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
await tap('#offline-select .mini-class[data-class="warrior"]');
await tap('#btn-start-offline');
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 180000 });
await wait(1500);

// Dismiss the tutorial popup if present, and turn the readout on.
await page.evaluate(() => {
  document.querySelector('#tutorial-skip')?.click();
  [...document.querySelectorAll('button')]
    .find((b) => /skip tutorial/i.test(b.textContent ?? ''))
    ?.click();
  window.__game.hud.optionsHooks.settings.set('showItemLevel', true);
});
await wait(300);

// (1) Interface options panel. The toggle list (.set-rows) has a fixed max-height
// with internal scroll; rather than fight the scroll, lift the height cap and use a
// tall viewport so the whole list (including "Show Item Level") renders in the clip.
try {
  await page.setViewport({ width: 1280, height: 1500 });
  await page.evaluate(() => {
    const hud = window.__game.hud;
    hud.toggleOptionsMenu();
    hud.optionsView = 'interface';
    hud.renderOptions();
  });
  await wait(400);
  await page.evaluate(() => {
    const menu = document.querySelector('#options-menu');
    const rows = document.querySelector('#options-menu .set-rows');
    if (menu) {
      menu.style.top = '12px';
      menu.style.bottom = 'auto';
      menu.style.maxHeight = 'none';
      menu.style.height = 'auto';
    }
    if (rows) {
      rows.style.maxHeight = 'none';
      rows.style.overflow = 'visible';
    }
  });
  await wait(400);
  await clipEl('#options-menu', 'interface_panel', 0);
  await page.evaluate(() => window.__game.hud.closeOptions?.());
  await page.setViewport({ width: 1280, height: 900 });
  await wait(200);
} catch (e) {
  console.log('WARN: panel capture failed: ' + e.message);
}

// (2) Equip a spread of level-20 tiers and shoot each tooltip.
const SHOTS = [
  ['crownforged_dreadhelm', '#equip-col-left', 1, 'raid_helmet'], // raid epic, ilvl 29
  ['deathlord_warplate', '#equip-col-left', 3, 'dungeon_chest'], // dungeon epic, ilvl 26
  ['kingsbane_last_oath', '#equip-col-left', 4, 'legendary_weapon'], // legendary, ilvl 33
  ['boundstone_girdle', '#equip-col-right', 2, 'rare_waist'], // rare, ilvl 23
];
try {
  await page.evaluate(
    (ids) => {
      const { sim } = window.__game;
      const pid = sim.player.id;
      sim.player.maxHp = 99999;
      sim.player.hp = 99999;
      sim.setPlayerLevel?.(20);
      for (const id of ids) {
        sim.addItem(id, 1, pid);
        sim.equipItem(id, pid);
      }
    },
    SHOTS.map((s) => s[0]),
  );
  await wait(300);
  await page.evaluate(() => window.__game.hud.toggleChar());
  await wait(500);
  for (const [, colSel, row, name] of SHOTS) {
    await page.hover(`${colSel} .equip-slot:nth-child(${row})`);
    await wait(350);
    await clipEl('#tooltip', name);
  }
} catch (e) {
  console.log('WARN: tooltip capture failed: ' + e.message);
}

// (3) Before/after on the raid helmet (toggle off vs on).
const hoverHelmet = async () => {
  await page.evaluate(() => {
    if (!document.querySelector('#equip-col-left .equip-slot')) window.__game.hud.toggleChar();
  });
  await wait(150);
  await page.hover('#equip-col-left .equip-slot:nth-child(3)');
  await wait(150);
  await page.hover('#equip-col-left .equip-slot:nth-child(1)');
  await wait(300);
};
try {
  await page.evaluate(() => window.__game.hud.optionsHooks.settings.set('showItemLevel', false));
  await hoverHelmet();
  await clipEl('#tooltip', 'toggle_off');
  await page.evaluate(() => window.__game.hud.optionsHooks.settings.set('showItemLevel', true));
  await hoverHelmet();
  await clipEl('#tooltip', 'toggle_on');
} catch (e) {
  console.log('WARN: before/after capture failed: ' + e.message);
}

if (errors.length) console.log('PAGE ERRORS:\n' + errors.slice(0, 4).join('\n'));
await browser.close();
console.log('done');
