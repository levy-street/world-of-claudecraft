// Inventory 2.0 end-to-end showcase. Offline flow (no server), desktop viewport.
// Captures the new helmet/shoulder/waist/gloves slots equipped across all three
// armor archetypes (each wearing its epic), plus an item tooltip proving stats.
// Needs `npm run dev`. Writes PNGs to tmp/.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 860 });

const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tap = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);

// Each archetype wears its epic in the matching new slot, with the rest of the
// new slots filled by the class-neutral Inventory 2.0 pieces.
const LOADOUTS = {
  warrior: {
    name: 'Bastion',
    set: { mainhand: 'worn_sword', helmet: 'deathlords_dread_visage', shoulder: 'gravewyrm_mantle',
      chest: 'recruit_tunic', waist: 'boundstone_girdle', legs: 'quilted_trousers',
      gloves: 'gravewyrm_gauntlets', feet: 'oiled_boots' },
  },
  mage: {
    name: 'Mistweave',
    set: { mainhand: 'worn_sword', helmet: 'cryptbone_helm', shoulder: 'necromancers_soulspire_mantle',
      chest: 'recruit_tunic', waist: 'mistveil_cord', legs: 'quilted_trousers',
      gloves: 'mistveil_grips', feet: 'oiled_boots' },
  },
  rogue: {
    name: 'Talonshade',
    set: { mainhand: 'worn_sword', helmet: 'cryptbone_helm', shoulder: 'cryptbone_pauldrons',
      chest: 'recruit_tunic', waist: 'boundstone_girdle', legs: 'quilted_trousers',
      gloves: 'wyrmshadow_talongrips', feet: 'oiled_boots' },
  },
};

async function startAs(cls, name) {
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
  await tap('#btn-offline');
  await wait(200);
  await page.evaluate((n) => {
    const el = document.querySelector('#char-name');
    if (el) { el.value = n; el.dispatchEvent(new Event('input', { bubbles: true })); }
  }, name);
  await tap(`#offline-select .mini-class[data-class="${cls}"]`);
  await tap('#btn-start-offline');
  await wait(3000);
}

async function equip(set) {
  return page.evaluate((s) => {
    const sim = window.__game.sim;
    const pid = sim.player.id;
    sim.player.maxHp = 99999; sim.player.hp = 99999;
    for (const id of Object.values(s)) { sim.addItem(id, 1, pid); sim.equipItem(id, pid); }
    return sim.equipment;
  }, set);
}

async function shotChar(file) {
  await page.evaluate(() => window.__game.hud.toggleChar());
  await wait(500);
  const box = await page.evaluate(() => {
    const el = document.querySelector('#char-window');
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  });
  await page.screenshot({ path: file, clip: box });
}

for (const [cls, { name, set }] of Object.entries(LOADOUTS)) {
  await startAs(cls, name);
  const eq = await equip(set);
  await shotChar(`tmp/inv2_${cls}.png`);
  console.log(`${cls} equipped:`, JSON.stringify(eq));

  // Warrior: also capture the epic helmet tooltip (proves slot + quality + stats).
  if (cls === 'warrior') {
    await page.hover('#equip-col-left .equip-slot:nth-child(1)'); // helmet = left column, first row
    await wait(500);
    await page.screenshot({ path: 'tmp/inv2_epic_tooltip.png' });
  }
  await page.evaluate(() => window.__game.hud.closeAll?.());
  await wait(200);
}

if (errors.length) console.log('PAGE ERRORS:\n' + errors.join('\n'));
console.log('wrote tmp/inv2_warrior.png, tmp/inv2_epic_tooltip.png, tmp/inv2_mage.png, tmp/inv2_rogue.png');
await browser.close();
