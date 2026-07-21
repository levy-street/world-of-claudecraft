// Screenshot harness for Voskar the Emberwing (rare elite dragonkin, Thornpeak
// Heights). Boots the offline client, repurposes the nearest mob into Voskar so
// the dragonkin model + rare scale/tint render, god-modes the player, then forces
// Searing Maw (mortalStrike) procs by swinging the drake at the player so the
// mortal-wound debuff lands and is visible. Writes PNGs to tmp/.
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
page.on('console', (msg) => { if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text()); });

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Drakeslayer');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 2500));

// Repurpose the nearest mob into Voskar the Emberwing, scale it up like a rare
// elite, god-mode the player, and face it so the camera frames the drake.
const setup = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  p.maxHp = 999999; p.hp = 999999;
  let mob = null, d = 1e9;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead && e.ownerId == null) {
      const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (dd < d) { d = dd; mob = e; }
    }
  }
  mob.templateId = 'voskar_emberwing';
  mob.name = 'Voskar the Emberwing';
  mob.level = 19;
  mob.maxHp = 4000; mob.hp = 4000;
  mob.scale = 1.3;
  // Move both onto open ground north of the hub for a clean, unobstructed frame.
  p.pos.x = -20; p.pos.z = 90; p.pos.y = sim.groundPos(p.pos.x, p.pos.z).y;
  mob.pos.x = p.pos.x + 3; mob.pos.z = p.pos.z + 6; mob.pos.y = sim.groundPos(mob.pos.x, mob.pos.z).y;
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  g.input.camYaw = p.facing;
  if ('camDist' in g.input) g.input.camDist = 10;
  sim.targetEntity(mob.id);
  return { mobId: mob.id, name: mob.name, hp: mob.hp, camDist: g.input.camDist };
});
console.log('setup:', JSON.stringify(setup));
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: 'tmp/voskar_01_drake.png' });

// Swing Voskar at the player; at 35% Searing Maw chance several land, applying
// the mortal-wound debuff. Keep player god-moded so the camera survives.
for (let burst = 0; burst < 24; burst++) {
  await page.evaluate(() => {
    const sim = window.__game.sim;
    const p = sim.player;
    p.hp = p.maxHp;
    let mob = null, d = 1e9;
    for (const e of sim.entities.values()) {
      if (e.kind === 'mob' && !e.dead && e.ownerId == null) {
        const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
        if (dd < d) { d = dd; mob = e; }
      }
    }
    if (!mob) return;
    mob.templateId = 'voskar_emberwing';
    mob.name = 'Voskar the Emberwing';
    mob.pos.x = p.pos.x + 3; mob.pos.z = p.pos.z + 6;
    p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
    window.__game.input.camYaw = p.facing;
    sim.targetEntity(mob.id);
    sim.mobSwing(mob, p);
  });
  await new Promise((r) => setTimeout(r, 140));
  if (burst === 16) await page.screenshot({ path: 'tmp/voskar_02_searing_maw.png' });
}

const debuff = await page.evaluate(() => {
  const p = window.__game.sim.player;
  return p.auras.filter((a) => a.kind === 'mortal_wound').map((a) => ({ name: a.name, value: a.value }));
});
console.log('player mortal-wound auras:', JSON.stringify(debuff));

await page.screenshot({ path: 'tmp/voskar_03_full.png' });

if (errors.length) { console.log('=== PAGE ERRORS ==='); for (const e of errors.slice(0, 20)) console.log(e); }
else console.log('no page errors');
await browser.close();
