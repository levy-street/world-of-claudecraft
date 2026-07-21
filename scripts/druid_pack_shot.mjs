// Screenshot harness for the druid spell pack (10 new abilities).
// Boots an offline druid, levels to 20, and captures:
//   1. the Spellbook showing the new spells
//   2. a Spellbook tooltip for one new spell (Tiger's Fury)
//   3. the buff bar after casting self-buffs (Tiger's Fury + Travel Form)
//   4. a target debuff from Faerie Fire + Insect Swarm
// Needs `npm run dev` (override with GAME_URL). Writes to tmp/.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,1750', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 1750 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(300);
await page.type('#char-name', 'Thornroot');
await page.evaluate(() => {
  const el = document.querySelector('#offline-select .mini-class[data-class="druid"]');
  if (el) el.click();
});
await page.click('#btn-start-offline');
await sleep(2500);

// level 20 druid, god-mode so the ambient world can't kill us mid-capture
await page.evaluate(() => {
  const g = window.__game;
  const p = g.sim.player;
  g.sim.setPlayerLevel(20, p.id);
  p.gm = true;
  p.resource = 1000;
});
await sleep(400);

// --- 1 & 2: Spellbook + a new-spell tooltip ---
await page.evaluate(() => window.__game.hud.toggleSpellbook());
await sleep(400);
// scroll the spell list to the bottom where the 10 new spells live (L16-20)
await page.evaluate(() => {
  const list = document.querySelector('#spellbook .spell-list');
  if (list) list.scrollTop = list.scrollHeight;
});
await sleep(400);
await page.screenshot({ path: 'tmp/druid-spellbook.png' });

// hover the Tiger's Fury row to surface its tooltip
const hovered = await page.evaluate(() => {
  const want = "Tiger's Fury";
  const rows = [...document.querySelectorAll('#spellbook .spell-row')];
  const row = rows.find((el) => (el.textContent || '').includes(want));
  if (!row) return null;
  row.scrollIntoView({ block: 'center' });
  const r = row.getBoundingClientRect();
  return { x: r.x + 40, y: r.y + r.height / 2 };
});
if (hovered) {
  await page.mouse.move(hovered.x - 5, hovered.y - 5);
  await page.mouse.move(hovered.x, hovered.y);
  await sleep(900);
  await page.screenshot({ path: 'tmp/druid-tooltip.png' });
}
await page.evaluate(() => window.__game.hud.toggleSpellbook());
await sleep(300);

// --- 3: self-buffs on the buff bar (Travel Form, then Tiger's Fury in cat form) ---
await page.evaluate(() => {
  const g = window.__game;
  g.sim.castAbility('travel_form', g.sim.player.id);
  g.sim.tick();
  g.sim.castAbility('cat_form', g.sim.player.id);
  g.sim.tick();
  g.sim.player.resource = 1000;
  g.sim.castAbility('tigers_fury', g.sim.player.id);
  g.sim.tick();
});
await sleep(800);
await page.screenshot({ path: 'tmp/druid-buffs.png' });

// --- 4: target debuffs — Faerie Fire (armor) + Insect Swarm (dot) on a nearby mob ---
const dbg = await page.evaluate(() => {
  const g = window.__game;
  const p = g.sim.player;
  // back to caster form so the ranged nukes are castable
  if (p.auras.some((a) => a.kind === 'form_cat')) { g.sim.castAbility('cat_form', p.id); g.sim.tick(); }
  // find the nearest hostile mob and pull it close + in front
  let mob = null, best = 1e9;
  for (const e of g.sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead || !e.hostile) continue;
    const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
    if (d < best) { best = d; mob = e; }
  }
  if (!mob) return 'no mob';
  mob.level = 20;
  mob.pos.x = p.pos.x + 6; mob.pos.z = p.pos.z; mob.pos.y = p.pos.y;
  mob.maxHp = 1e6; mob.hp = 1e6;
  g.sim.tick();
  p.targetId = mob.id;
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  g.input.camYaw = p.facing;
  p.resource = 1000;
  g.sim.castAbility('faerie_fire', p.id); g.sim.tick();
  // wait out the global cooldown before the second cast
  for (let i = 0; i < 35; i++) g.sim.tick();
  p.resource = 1000; p.targetId = mob.id;
  g.sim.castAbility('insect_swarm', p.id); g.sim.tick();
  return mob.auras.map((a) => a.name);
});
console.log('target auras:', dbg);
await sleep(900);
await page.screenshot({ path: 'tmp/druid-debuffs.png' });

await browser.close();
console.log('done — tmp/druid-spellbook.png, druid-tooltip.png, druid-buffs.png, druid-debuffs.png');
