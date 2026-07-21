// Browser smoke test: boots the game in headless Edge, plays a little,
// and saves screenshots to tmp/ for visual inspection.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

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
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text());
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Adventurer');
await page.screenshot({ path: 'tmp/01_start.png' });

// pick warrior
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: 'tmp/02_spawn.png' });

const state0 = await page.evaluate(() => {
  const g = window.__game;
  const p = g.sim.player;
  return { x: p.pos.x, z: p.pos.z, hp: p.hp, maxHp: p.maxHp, level: p.level, entities: g.sim.entities.size };
});
console.log('spawn state:', JSON.stringify(state0));

// run forward for 3 seconds
await page.keyboard.down('w');
await new Promise((r) => setTimeout(r, 3000));
await page.keyboard.up('w');
await page.screenshot({ path: 'tmp/03_ran_forward.png' });
const state1 = await page.evaluate(() => {
  const p = window.__game.sim.player;
  return { x: p.pos.x, z: p.pos.z };
});
console.log('after running:', JSON.stringify(state1));
const moved = Math.hypot(state1.x - state0.x, state1.z - state0.z);
console.log('moved distance:', moved.toFixed(1), moved > 10 ? 'OK' : 'FAIL');

// turn for a second, then jump
await page.keyboard.down('a');
await new Promise((r) => setTimeout(r, 700));
await page.keyboard.up('a');
await page.keyboard.press('Space');
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: 'tmp/04_turned.png' });

// teleport near a wolf, target it, fight it
const fight = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  let wolf = null, d = 1e9;
  for (const e of sim.entities.values()) {
    if (e.templateId === 'forest_wolf' && !e.dead) {
      const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (dd < d) { d = dd; wolf = e; }
    }
  }
  p.pos.x = wolf.pos.x + 3; p.pos.z = wolf.pos.z;
  sim.targetEntity(wolf.id);
  return { wolfId: wolf.id, wolfHp: wolf.hp, wolfLevel: wolf.level };
});
console.log('fight setup:', JSON.stringify(fight));
await new Promise((r) => setTimeout(r, 300));
// face it and attack
await page.evaluate((id) => {
  const g = window.__game;
  const p = g.sim.player;
  g.sim.targetEntity(id);
  const t = g.sim.entities.get(id);
  p.facing = Math.atan2(t.pos.x - p.pos.x, t.pos.z - p.pos.z);
  g.input.camYaw = p.facing;
  g.sim.startAutoAttack();
}, fight.wolfId);
await new Promise((r) => setTimeout(r, 1000));
await page.keyboard.press('1'); // heroic strike (queues)
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: 'tmp/05_combat.png' });

// wait for kill (up to 30s)
let killed = false;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const s = await page.evaluate((id) => {
    const g = window.__game;
    const w = g.sim.entities.get(id);
    const p = g.sim.player;
    if (!w.dead) {
      if (p.targetId !== id) g.sim.targetEntity(id);
      p.facing = Math.atan2(w.pos.x - p.pos.x, w.pos.z - p.pos.z);
      if (!p.autoAttack) g.sim.startAutoAttack();
      if (p.resource >= 15 && !p.queuedOnSwing) g.sim.castAbility('heroic_strike');
    }
    return { wolfDead: w.dead, wolfHp: w.hp, playerHp: p.hp, rage: p.resource, xp: g.sim.xp, auto: p.autoAttack };
  }, fight.wolfId);
  if (i % 5 === 0) console.log('combat:', JSON.stringify(s));
  if (s.wolfDead) { killed = true; break; }
}
console.log('wolf killed:', killed ? 'OK' : 'FAIL');
await page.screenshot({ path: 'tmp/06_killed.png' });

// loot it
const loot = await page.evaluate((id) => {
  const g = window.__game;
  const w = g.sim.entities.get(id);
  const p = g.sim.player;
  p.pos.x = w.pos.x + 1; p.pos.z = w.pos.z;
  g.sim.lootCorpse(id);
  return { copper: g.sim.copper, inv: g.sim.inventory.map((s) => s.itemId), xp: g.sim.xp, level: p.level };
}, fight.wolfId);
console.log('loot:', JSON.stringify(loot));
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: 'tmp/07_looted.png' });

// quest npc dialog: teleport to marshal and press F
await page.evaluate(() => {
  const g = window.__game;
  g.sim.player.pos.x = 4; g.sim.player.pos.z = 3;
});
await new Promise((r) => setTimeout(r, 200));
await page.keyboard.press('f');
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: 'tmp/08_quest_dialog.png' });
// gossip flow: click the first quest in the list, then Accept
const accepted = await page.evaluate(async () => {
  const first = document.querySelector('#quest-dialog .qd-list-item');
  if (!first) return false;
  first.click();
  await new Promise((r) => setTimeout(r, 150));
  const btns = [...document.querySelectorAll('#quest-dialog .btn')];
  const accept = btns.find((b) => b.textContent === 'Accept');
  if (accept) { accept.click(); return true; }
  return false;
});
console.log('quest accepted:', accepted ? 'OK' : 'FAIL');
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: 'tmp/09_quest_tracker.png' });

// bags
await page.keyboard.press('b');
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: 'tmp/10_bags.png' });

const final = await page.evaluate(() => {
  const g = window.__game;
  return {
    quests: [...g.sim.questLog.keys()],
    fps_entities: g.sim.entities.size,
  };
});
console.log('final:', JSON.stringify(final));

if (errors.length) {
  console.log('\n=== PAGE ERRORS ===');
  for (const e of errors.slice(0, 20)) console.log(e);
} else {
  console.log('no page errors');
}
await browser.close();
