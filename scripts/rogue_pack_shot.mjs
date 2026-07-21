// Screenshots for the rogue ability pack: the spellbook showing the 10 new
// abilities, a tooltip on Rupture, and an in-world capture of Crippling
// Poison's slow + Rupture's bleed on a target dummy.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('shots', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,1750', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 1750 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Shivspeak');
await page.click('#offline-select .mini-class[data-class="rogue"]');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 2500));

// Level to 20 so the whole kit (all 10 new abilities ≤ L20) is learned.
await page.evaluate(() => {
  const g = window.__game;
  const p = g.sim.player;
  g.sim.setPlayerLevel(20, p.id);
  p.gm = true;
});
await new Promise((r) => setTimeout(r, 400));

// 1) Full spellbook.
await page.evaluate(() => window.__game.hud.toggleSpellbook());
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: 'shots/spellbook.png' });

// 2) Tooltip on Rupture (hover its spell row).
const hovered = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#spellbook .spell-row')];
  const row = rows.find((r) =>
    /Rupture|Lacera|Кровопуск|割裂|파열|Ruptur/i.test(r.textContent || ''),
  );
  if (!row) return null;
  const b = row.getBoundingClientRect();
  return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
});
if (hovered) {
  await page.mouse.move(hovered.x, hovered.y);
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: 'shots/tooltip.png' });
}
await page.evaluate(() => window.__game.hud.toggleSpellbook());

// 3) In-world: drop a dummy next to us, apply Crippling Poison (slow) and
// Rupture (bleed), capture the target frame debuffs.
const result = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  p.maxHp = 100000;
  p.hp = 100000;
  p.comboPoints = 5;
  p.comboUntil = sim.time + 30;

  let mob = null,
    d = 1e9;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead) {
      const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (dd < d) {
        d = dd;
        mob = e;
      }
    }
  }
  mob.hp = mob.maxHp = 100000;
  mob.pos.x = p.pos.x + 2;
  mob.pos.z = p.pos.z;
  sim.targetEntity(mob.id);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  g.input.camYaw = p.facing;

  sim.castAbility('crippling_poison', p.id);
  for (let i = 0; i < 35; i++) sim.tick(); // clear the GCD before the finisher
  p.comboPoints = 5;
  p.comboUntil = sim.time + 30;
  sim.castAbility('rupture', p.id);
  for (let i = 0; i < 6; i++) sim.tick();

  return { auras: mob.auras.map((a) => ({ name: a.name, kind: a.kind })) };
});
console.log('rogue in-world auras:', JSON.stringify(result));
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: 'shots/target-debuff.png' });
await page.screenshot({ path: 'shots/scene.png' });

await browser.close();
console.log('done');
