// Mage E2E: casting, polymorph, conjure water + drinking, death + release.
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

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'MageName');
await page.click('#offline-select .mini-class[data-class="mage"]');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 1500));

// level up to 8 (learns frostbolt, fire blast, polymorph, arcane missiles)
await page.evaluate(() => {
  window.__game.sim.setPlayerLevel(8);
});

const known = await page.evaluate(() => window.__game.sim.known.map((k) => k.def.id));
console.log('known at 8:', JSON.stringify(known));

// frostbolt kill at range
const setup = await page.evaluate(() => {
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
  p.pos.x = wolf.pos.x + 25; p.pos.z = wolf.pos.z;
  sim.targetEntity(wolf.id);
  p.facing = Math.atan2(wolf.pos.x - p.pos.x, wolf.pos.z - p.pos.z);
  g.input.camYaw = p.facing;
  return { wolfId: wolf.id, mana: p.resource };
});
let killed = false;
for (let i = 0; i < 50; i++) {
  const s = await page.evaluate((id) => {
    const g = window.__game;
    const p = g.sim.player;
    const w = g.sim.entities.get(id);
    if (!w.dead) {
      if (p.targetId !== id) g.sim.targetEntity(id);
      p.facing = Math.atan2(w.pos.x - p.pos.x, w.pos.z - p.pos.z);
      if (!p.castingAbility && p.gcdRemaining <= 0) {
        const d = Math.hypot(w.pos.x - p.pos.x, w.pos.z - p.pos.z);
        g.sim.castAbility(d < 12 ? 'fire_blast' : 'frostbolt');
      }
    }
    return { dead: w.dead, whp: w.hp, slowed: w.auras.some((a) => a.kind === 'slow') };
  }, setup.wolfId);
  if (i === 2) console.log('mid-fight:', JSON.stringify(s));
  if (s.dead) { killed = true; break; }
  await new Promise((r) => setTimeout(r, 400));
}
console.log('mage killed wolf at range:', killed ? 'OK' : 'FAIL');

// polymorph another wolf (retry until the cast actually starts — GCD-safe)
const poly = await page.evaluate(() => {
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
  // shake any aggro from the previous fight so nothing interrupts the cast
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead && e.aggroTargetId === p.id) {
      e.aiState = 'evade';
      e.aggroTargetId = null;
    }
  }
  p.hp = p.maxHp;
  p.pos.x = wolf.pos.x + 15; p.pos.z = wolf.pos.z;
  p.resource = p.maxResource;
  sim.targetEntity(wolf.id);
  return wolf.id;
});
// note: headless rAF throttling makes sim time run slower than wall time,
// so poll on sim state with generous timeouts rather than fixed sleeps.
let sheeped = false;
for (let i = 0; i < 40 && !sheeped; i++) {
  sheeped = await page.evaluate((id) => {
    const g = window.__game;
    const sim = g.sim;
    const p = sim.player;
    const w = sim.entities.get(id);
    if (w.auras.some((a) => a.kind === 'polymorph')) return true;
    p.facing = Math.atan2(w.pos.x - p.pos.x, w.pos.z - p.pos.z);
    if (!p.castingAbility && p.gcdRemaining <= 0) sim.castAbility('polymorph');
    return false;
  }, poly);
  if (!sheeped) await new Promise((r) => setTimeout(r, 400));
}
console.log('polymorph applied:', sheeped ? 'OK' : 'FAIL');
await page.screenshot({ path: 'tmp/m1_sheep.png' });

// conjure water + drink (retry until the 3s cast starts)
await page.evaluate(() => {
  const sim = window.__game.sim;
  const p = sim.player;
  sim.targetEntity(null);
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead && e.aggroTargetId === p.id) {
      e.aiState = 'evade';
      e.aggroTargetId = null;
    }
  }
  p.pos.x = 0; p.pos.z = -40; // somewhere quiet
  p.resource = p.maxResource;
});
let conjured = 0;
for (let i = 0; i < 50 && conjured < 2; i++) {
  conjured = await page.evaluate(() => {
    const sim = window.__game.sim;
    const p = sim.player;
    const count = sim.countItem('conjured_water');
    if (count < 2 && !p.castingAbility && p.gcdRemaining <= 0) sim.castAbility('conjure_water');
    return count;
  });
  if (conjured < 2) await new Promise((r) => setTimeout(r, 400));
}
const drink2 = await page.evaluate(() => {
  const sim = window.__game.sim;
  const p = sim.player;
  p.resource = 20;
  p.inCombat = false;
  p.combatTimer = 99;
  sim.useItem('conjured_water');
  return { sitting: p.sitting };
});
console.log('conjured water:', conjured === 2 ? 'OK' : `FAIL (${conjured})`, '| sitting to drink:', drink2.sitting ? 'OK' : 'FAIL');
let manaAfter = 20;
for (let i = 0; i < 30 && manaAfter <= 20; i++) {
  await new Promise((r) => setTimeout(r, 500));
  manaAfter = await page.evaluate(() => window.__game.sim.player.resource);
}
console.log('mana regen from drinking:', manaAfter > 20 ? `OK (${Math.round(manaAfter)})` : 'FAIL');
await page.screenshot({ path: 'tmp/m2_drinking.png' });

// death + release
await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  let boss = null;
  for (const e of sim.entities.values()) if (e.templateId === 'gorrak') boss = e;
  p.pos.x = boss.pos.x + 3; p.pos.z = boss.pos.z;
  p.hp = 10;
});
let deadOk = false;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 500));
  if (await page.evaluate(() => window.__game.sim.player.dead)) { deadOk = true; break; }
}
console.log('died to boss:', deadOk ? 'OK' : 'FAIL');
await page.click('#release-btn');
await new Promise((r) => setTimeout(r, 800));
const after = await page.evaluate(() => {
  const p = window.__game.sim.player;
  return { dead: p.dead, hp: p.hp };
});
console.log('release:', !after.dead && after.hp > 0 ? 'OK' : 'FAIL');

console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 10).join('\n') : 'no page errors');
await browser.close();
