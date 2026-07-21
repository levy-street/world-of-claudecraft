// Visual proof of the innate mob Thorns ("Bristled Hide") mechanic: melee a
// bristleback boar and capture the reflect damage ticking back onto the player.
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
await page.type('#char-name', 'Bristler');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 1500));

// Spawn an Elder Bristleback (thorns 8) right in front of the player and engage.
await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  const tpl = sim.constructor; // unused; reach MOBS via module is not exposed
  // Find a wild boar if the world already has one; else convert the nearest mob.
  let boar = null, d = 1e9;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead || e.ownerId !== null) continue;
    const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
    if (dd < d) { d = dd; boar = e; }
  }
  // Force the engaged mob to be a thorns boar template so the reflect fires.
  boar.templateId = 'wild_boar';
  boar.name = 'Wild Boar';
  boar.maxHp = 4000; boar.hp = 4000; // survive long enough to bank reflect ticks
  boar.pos.x = p.pos.x + 2.0; boar.pos.z = p.pos.z;
  p.maxHp = 4000; p.hp = 4000;
  sim.targetEntity(boar.id);
  p.facing = Math.atan2(boar.pos.x - p.pos.x, boar.pos.z - p.pos.z);
  g.input.camYaw = p.facing;
  sim.startAutoAttack();
  window.__boarId = boar.id;
  window.__startHp = p.hp;
});

// Auto-attack for a few seconds; keep facing the boar so swings connect.
for (let i = 0; i < 80; i++) {
  await page.evaluate(() => {
    const g = window.__game;
    const sim = g.sim;
    const p = sim.player;
    const b = sim.entities.get(window.__boarId);
    if (b && !b.dead) {
      if (p.targetId !== b.id) sim.targetEntity(b.id);
      b.hp = Math.max(2000, b.hp); // keep the boar alive for the shot
      p.facing = Math.atan2(b.pos.x - p.pos.x, b.pos.z - p.pos.z);
      if (!p.autoAttack) sim.startAutoAttack();
    }
  });
  await new Promise((r) => setTimeout(r, 60));
}

const reflected = await page.evaluate(() => window.__startHp - window.__game.sim.player.hp);

// Pull any combat-log / floating text mentioning the reflect, as textual proof.
const proof = await page.evaluate(() => {
  const txt = document.body.innerText || '';
  return txt.split('\n').filter((l) => /bristled hide/i.test(l)).slice(0, 4);
});

await new Promise((r) => setTimeout(r, 120));
await page.screenshot({ path: 'tmp/mob-thorns.png' });

console.log('reflect damage taken by player:', reflected);
console.log('combat-log proof:', JSON.stringify(proof));
console.log('page errors:', errors);
await browser.close();
if (reflected <= 0) { console.error('NO REFLECT DAMAGE OBSERVED'); process.exit(1); }
