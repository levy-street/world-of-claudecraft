// Screenshot the Stoneskin affix (Bone Carapace) in the offline client.
// Boots the game, repurposes a nearby mob as Marrowlord Varkas, fires its
// periodic self-shield through the real mob-AI path, and captures the boss
// in-world (with the barrier nova), its target frame, and the combat-log line.
// A mob self-buff has no player-debuff icon, so the proof is the log + the
// console soak math (shield drains, HP spared).
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

const result = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  // gm survives the live boss loop; applyAura/updateMob still work, and the
  // barrier sits on the mob anyway so player invulnerability doesn't confound it.
  p.gm = true; p.maxHp = 100000; p.hp = 100000;

  let mob = null, d = 1e9;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead) {
      const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (dd < d) { d = dd; mob = e; }
    }
  }
  // Reskin it as the Marrowlord and stand it in front of us at its real level.
  mob.templateId = 'marrowlord_varkas';
  mob.name = 'Marrowlord Varkas';
  mob.level = 19;
  mob.hostile = true;
  mob.maxHp = 4000; mob.hp = 4000;
  mob.scale = 1.25;
  // Must sit inside MELEE_RANGE or the mob-AI attack case breaks to 'chase'
  // before the periodic self-shield block runs.
  mob.pos.x = p.pos.x + 3.5; mob.pos.z = p.pos.z;
  mob.spawnPos = { x: mob.pos.x, y: mob.pos.y, z: mob.pos.z };
  mob.aiState = 'attack'; mob.aggroTargetId = p.id; mob.inCombat = true;
  sim.targetEntity(mob.id);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  g.input.camYaw = p.facing;
  g.input.camDist = 11;

  // Fire the barrier through the real periodic path (emits the nova + log line).
  mob.stoneskinTimer = 0.001;
  sim.updateMob(mob);
  const ward = mob.auras.find((a) => a.id === 'stoneskin_marrowlord_varkas');

  // Prove the soak: a 100-damage hit is fully absorbed; HP is untouched.
  const shieldBefore = ward?.value;
  const hpBefore = mob.hp;
  sim.dealDamage(p, mob, 100, false, 'physical', null, 'hit');
  const shieldAfter = mob.auras.find((a) => a.id === 'stoneskin_marrowlord_varkas')?.value;

  return {
    hasWard: !!ward, name: ward?.name, kind: ward?.kind,
    shieldBefore, shieldAfter, soaked: shieldBefore - shieldAfter,
    hpBefore, hpAfter: mob.hp, hpSpared: hpBefore === mob.hp,
  };
});
console.log('stoneskin result:', JSON.stringify(result));

await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: 'tmp/stoneskin_scene.png' });

// Crop the boss target frame (top-left): name + boss portrait.
const tf = await page.evaluate(() => {
  const el = document.querySelector('#target-frame');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
if (tf && tf.w > 0) {
  const pad = 14;
  await page.screenshot({
    path: 'tmp/stoneskin_targetframe.png',
    clip: { x: Math.max(0, tf.x - pad), y: Math.max(0, tf.y - pad), width: tf.w + pad * 2, height: tf.h + pad * 2 },
  });
}

// Switch to the combat log tab and crop it to show the "unleashes Bone Carapace!" line.
await page.evaluate(() => {
  const tab = document.querySelector('.chat-tab[data-log-tab="combat"]') || document.querySelector('.chat-tab');
  if (tab) tab.click();
});
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({
  path: 'tmp/stoneskin_log.png',
  clip: { x: 0, y: 620, width: 560, height: 280 },
});

console.log('saved tmp/stoneskin_scene.png, stoneskin_targetframe.png, stoneskin_log.png');
await browser.close();
