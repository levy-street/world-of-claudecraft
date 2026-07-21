// Inventory 2.0 tooltip proof: equips each archetype's epic and captures the
// item tooltip (clipped tight) so the balanced stats are legible.
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tap = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);

// [class, epic id, column selector, row nth-child]
// Left col: helmet(1), shoulder(2), chest(3), mainhand(4).
// Right col: gloves(1), waist(2), legs(3), feet(4).
const CASES = [
  ['warrior', 'deathlords_dread_visage', '#equip-col-left', 1],
  ['mage', 'necromancers_soulspire_mantle', '#equip-col-left', 2],
  ['rogue', 'wyrmshadow_talongrips', '#equip-col-right', 1],
];

async function startAs(cls) {
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
  await tap('#btn-offline');
  await wait(200);
  await page.evaluate(() => {
    const el = document.querySelector('#char-name');
    if (el) { el.value = 'Tester'; el.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await tap(`#offline-select .mini-class[data-class="${cls}"]`);
  await tap('#btn-start-offline');
  await wait(3000);
}

for (const [cls, epic, colSel, row] of CASES) {
  await startAs(cls);
  await page.evaluate((id) => {
    const sim = window.__game.sim;
    const pid = sim.player.id;
    sim.player.maxHp = 99999; sim.player.hp = 99999;
    sim.addItem(id, 1, pid); sim.equipItem(id, pid);
  }, epic);
  await wait(200);
  await page.evaluate(() => window.__game.hud.toggleChar());
  await wait(400);
  await page.hover(`${colSel} .equip-slot:nth-child(${row})`);
  await wait(400);
  const box = await page.evaluate(() => {
    const el = document.querySelector('#tooltip');
    if (!el || el.style.display === 'none') return null;
    const r = el.getBoundingClientRect();
    return { x: Math.max(0, Math.round(r.x) - 6), y: Math.max(0, Math.round(r.y) - 6),
      width: Math.round(r.width) + 12, height: Math.round(r.height) + 12 };
  });
  if (box && box.width > 0) {
    await page.screenshot({ path: `tmp/inv2_tip_${cls}.png`, clip: box });
    console.log(`captured tooltip for ${epic}`);
  } else {
    console.log(`WARN: no visible tooltip for ${epic}`);
  }
  await page.evaluate(() => window.__game.hud.closeAll?.());
  await wait(200);
}

await browser.close();
console.log('wrote tmp/inv2_tip_warrior.png, tmp/inv2_tip_mage.png, tmp/inv2_tip_rogue.png');
