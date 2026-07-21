// Screenshot the Knockback affix (Crushing Sweep) in the offline client.
// Boots the game, repurposes the nearest mob as Marrowlord Varkas, captures the
// player standing toe-to-toe with it, forces the on-hit shove, then captures the
// player hurled back with the "unleashes Crushing Sweep!" line in the combat log.
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
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Brannok');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 2500));

// Stand the Marrowlord toe-to-toe with us, look at it. (before the shove)
await page.evaluate(() => {
  const g = window.__game, sim = g.sim, p = sim.player;
  p.gm = true; // an L19 elite shouldn't kill us mid-demo
  let mob = null, d = 1e9;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead) {
      const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (dd < d) { d = dd; mob = e; }
    }
  }
  mob.templateId = 'marrowlord_varkas';
  mob.name = 'Marrowlord Varkas';
  mob.level = 19; mob.hostile = true; mob.hp = mob.maxHp;
  mob.pos.x = p.pos.x + 2.5; mob.pos.z = p.pos.z;
  sim.targetEntity(mob.id);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  g.input.camYaw = p.facing; g.input.camDist = 9;
  window.__mobId = mob.id;
});
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: 'tmp/knockback_before.png' });

// Force the on-hit shove and confirm the displacement via the real swing path.
const result = await page.evaluate(() => {
  const g = window.__game, sim = g.sim, p = sim.player;
  const mob = sim.entities.get(window.__mobId);
  const before = Math.hypot(p.pos.x - mob.pos.x, p.pos.z - mob.pos.z);
  // drive real swings until we're flung; guarantee the demo lands if RNG is shy
  let moved = false;
  for (let i = 0; i < 60 && !moved; i++) {
    sim.mobSwing(mob, p);
    moved = Math.hypot(p.pos.x - mob.pos.x, p.pos.z - mob.pos.z) > before + 1;
  }
  if (!moved) sim.applyKnockback(mob, p, 6);
  const after = Math.hypot(p.pos.x - mob.pos.x, p.pos.z - mob.pos.z);
  // keep facing the (now distant) Marrowlord
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  g.input.camYaw = p.facing;
  return { before, after };
});
console.log('knockback gap before/after:', JSON.stringify(result));

// Surface the combat log so the "unleashes Crushing Sweep!" line shows.
await page.evaluate(() => {
  const tab = document.querySelector('.chat-tab[data-log-tab="combat"]') ||
              document.querySelector('[data-log-tab="combat"]');
  if (tab) tab.click();
});
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: 'tmp/knockback_after.png' });

console.log('saved tmp/knockback_before.png, knockback_after.png');
await browser.close();
