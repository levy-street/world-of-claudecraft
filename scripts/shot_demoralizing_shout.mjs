// Screenshot the warrior's Demoralizing Shout in the offline client.
// Boots a level-20 warrior, clusters a few nearby mobs in front, casts the
// shout, and captures the scene, the enemy attack-power debuff on the target
// frame, and the spellbook tooltip for the new ability.
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
page.on('pageerror', (e) => console.log('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await new Promise((r) => setTimeout(r, 300));
await page.type('#char-name', 'Brannok');
await page.evaluate(() => {
  const w = document.querySelector('#offline-select .mini-class[data-class="warrior"]');
  if (w) w.click();
});
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 2500));

const result = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  sim.setPlayerLevel(20, p.id); // learns Demoralizing Shout (rank 2)
  p.gm = true;
  p.resource = 100; // rage to fuel the shout

  // Cluster the three nearest mobs in a fan in front of us.
  const mobs = [];
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead) {
      e._d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      mobs.push(e);
    }
  }
  mobs.sort((a, b) => a._d - b._d);
  const crew = mobs.slice(0, 3);
  const offs = [[2.5, 4], [-2.5, 4.5], [0, 6]];
  crew.forEach((m, i) => {
    m.hostile = true; m.hp = m.maxHp;
    m.pos.x = p.pos.x + offs[i][0];
    m.pos.z = p.pos.z + offs[i][1];
  });
  const lead = crew[0];
  p.facing = Math.atan2(lead.pos.x - p.pos.x, lead.pos.z - p.pos.z);
  g.input.camYaw = p.facing;
  sim.targetEntity(lead.id);

  // Re-index the spatial grid at the mobs' new positions before the AoE scans it.
  sim.tick();
  crew.forEach((m, i) => { m.pos.x = p.pos.x + offs[i][0]; m.pos.z = p.pos.z + offs[i][1]; });
  sim.tick();

  const apBefore = crew.map((m) => sim.effectiveAttackPower(m));
  p.resource = 100;
  sim.castAbility('demoralizing_shout', p.id);
  sim.tick();
  const apAfter = crew.map((m) => sim.effectiveAttackPower(m));
  const debuffs = crew.map((m) => m.auras.find((a) => a.id === 'demoralizing_shout_ap'));
  return {
    apBefore, apAfter,
    debuffed: debuffs.filter(Boolean).length,
    value: debuffs[0]?.value, remaining: debuffs[0]?.remaining,
  };
});
console.log('demoralizing shout:', JSON.stringify(result));

await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: 'tmp/demoshout_scene.png' });

// Target-frame shows the enemy's debuffs (top-left of the HUD by default).
const tf = await page.evaluate(() => {
  const el = document.querySelector('#target-frame');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
if (tf) {
  const pad = 12;
  await page.screenshot({
    path: 'tmp/demoshout_targetframe.png',
    clip: {
      x: Math.max(0, tf.x - pad), y: Math.max(0, tf.y - pad),
      width: tf.w + pad * 2, height: tf.h + pad * 2,
    },
  });
}

// Spellbook tooltip for the new ability.
await page.evaluate(() => window.__game.hud.toggleSpellbook());
await new Promise((r) => setTimeout(r, 500));
const hover = await page.evaluate(() => {
  const book = document.querySelector('#spellbook');
  if (!book) return null;
  for (const nameEl of book.querySelectorAll('.spell-name')) {
    if ((nameEl.textContent || '').includes('Demoralizing Shout')) {
      const row = nameEl.closest('.spell-row') || nameEl;
      row.scrollIntoView({ block: 'center' });
      const r = row.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
  }
  return null;
});
if (hover) {
  await page.mouse.move(hover.x, hover.y);
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: 'tmp/demoshout_spellbook.png' });
}

console.log('saved tmp/demoshout_scene.png, demoshout_targetframe.png, demoshout_spellbook.png');
await browser.close();
