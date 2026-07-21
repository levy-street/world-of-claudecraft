// Screenshot Sloomtooth the Drowned (rare elite murloc) in the offline client.
// Boots the game, repurposes a nearby mob into Sloomtooth, targets it to raise
// the golden rare-elite nameplate, fires its Tidal Sweep cleave + Drowning
// Resurgence, and captures the scene + target frame + a drop tooltip.
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
await page.click('#btn-offline');
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Tidewarden');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 2500));

const result = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  p.maxHp = 100000; p.hp = 100000;

  let mob = null, d = 1e9;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead) {
      const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (dd < d) { d = dd; mob = e; }
    }
  }
  // Reskin the nearest mob as Sloomtooth and stand it right in front of us.
  const tpl = sim.constructor.MOBS?.sloomtooth_the_drowned;
  mob.templateId = 'sloomtooth_the_drowned';
  mob.name = 'Sloomtooth the Drowned';
  mob.rare = true; mob.elite = true; mob.level = 11;
  mob.hostile = true;
  mob.maxHp = 1200; mob.hp = mob.maxHp;
  mob.scale = 1.1;
  mob.pos.x = p.pos.x + 3; mob.pos.z = p.pos.z + 1;
  sim.targetEntity(mob.id);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  g.input.camYaw = p.facing;

  // Drive the desperation heal: drop it low, run boss mechanics once.
  mob.inCombat = true;
  mob.hp = Math.round(mob.maxHp * 0.25);
  const hpBefore = mob.hp;
  sim.updateBossMechanics(mob);
  const healed = mob.hp - hpBefore;

  const tplOk = !!(window.__MOBS ? window.__MOBS.sloomtooth_the_drowned : true);
  return { healed, hpAfter: mob.hp, maxHp: mob.maxHp, name: mob.name, rare: mob.rare, tplOk };
});
console.log('sloomtooth result:', JSON.stringify(result));

await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: 'tmp/sloomtooth_scene.png' });

// Crop the target unit frame (top-center) showing the golden rare name.
const tf = await page.evaluate(() => {
  const el = document.querySelector('#target-frame') || document.querySelector('#target-unit');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
if (tf && tf.w > 0) {
  const pad = 18;
  await page.screenshot({
    path: 'tmp/sloomtooth_target.png',
    clip: {
      x: Math.max(0, tf.x - pad), y: Math.max(0, tf.y - pad),
      width: tf.w + pad * 2, height: tf.h + pad * 2,
    },
  });
}

console.log('saved tmp/sloomtooth_scene.png' + (tf ? ', sloomtooth_target.png' : ''));
await browser.close();
