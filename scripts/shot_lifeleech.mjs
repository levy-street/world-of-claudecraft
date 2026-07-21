// Screenshot harness for the Drowned Dead lifesteal affix (Drowning Grasp).
// Boots the offline client, repurposes the nearest mob into a Drowned Dead with
// a big health deficit, god-modes the player, then forces leech procs by swinging
// the mob at the player so the green heal numbers float over the mob and its
// health bar visibly refills. Writes PNGs to tmp/.
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
await page.type('#char-name', 'Drowner');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 2500));

// Repurpose the nearest mob into a Drowned Dead, drop its HP, god-mode the player,
// and face it so the camera frames the mob and its health bar.
const setup = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  let mob = null, d = 1e9;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead && e.ownerId == null) {
      const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (dd < d) { d = dd; mob = e; }
    }
  }
  mob.templateId = 'drowned_dead';
  mob.name = 'Drowned Dead';
  mob.maxHp = 400;
  mob.hp = 120; // big deficit so leech heals are obvious
  mob.pos.x = p.pos.x + 5; mob.pos.z = p.pos.z;
  p.pos.y = sim.entities.get(p.id) ? p.pos.y : p.pos.y;
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  g.input.camYaw = p.facing;
  sim.targetEntity(mob.id);
  return { mobId: mob.id, hp: mob.hp, maxHp: mob.maxHp };
});
console.log('setup:', JSON.stringify(setup));
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: 'tmp/lifeleech_01_before.png' });

// Swing the mob at the player repeatedly; at 35% leech chance several of these
// land a proc, floating green heal numbers over the mob and refilling its bar.
// Capture mid-burst so the FCT is on-screen.
for (let burst = 0; burst < 24; burst++) {
  await page.evaluate(() => {
    const sim = window.__game.sim;
    const p = sim.player;
    p.hp = p.maxHp; // god-mode the player so the camera survives
    // re-acquire (or re-create) a living Drowned Dead pinned in front of the player
    let mob = null, d = 1e9;
    for (const e of sim.entities.values()) {
      if (e.kind === 'mob' && !e.dead && e.ownerId == null) {
        const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
        if (dd < d) { d = dd; mob = e; }
      }
    }
    if (!mob) return;
    mob.templateId = 'drowned_dead';
    mob.name = 'Drowned Dead';
    mob.maxHp = 400;
    if (mob.hp >= mob.maxHp) mob.hp = mob.maxHp - 1; // keep room to heal so procs stay visible
    mob.pos.x = p.pos.x + 5; mob.pos.z = p.pos.z;
    p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
    window.__game.input.camYaw = p.facing;
    sim.targetEntity(mob.id);
    sim.mobSwing(mob, p);
  });
  await new Promise((r) => setTimeout(r, 140));
  if (burst === 16) await page.screenshot({ path: 'tmp/lifeleech_02_leech.png' });
}

const after = await page.evaluate(() => {
  const sim = window.__game.sim;
  for (const e of sim.entities.values()) if (e.templateId === 'drowned_dead' && !e.dead) return { hp: e.hp, maxHp: e.maxHp };
  return null;
});
console.log('after swings:', JSON.stringify(after));

// Tight crop around the mob health area for the PR thumbnail.
await page.screenshot({ path: 'tmp/lifeleech_03_full.png' });

if (errors.length) { console.log('=== PAGE ERRORS ==='); for (const e of errors.slice(0, 20)) console.log(e); }
else console.log('no page errors');
await browser.close();
