// Screenshot the Battle Fury (Rampage) affix carrier — Warlord Drogmar — in the
// offline client. Boots the game, repurposes a nearby mob as the warlord, stands
// it in front of a god-moded player, drives a string of landed swings so the
// self-stacking buff_ap aura builds, and captures the boss in-world (nameplate +
// target frame). The fury is a self-BUFF on the mob (it has no enemy-debuff UI),
// so the meaningful visual is the warlord himself; the ramp is asserted in
// tests/mob_rampage.test.ts and reported on the console here.
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

// Repurpose the nearest mob as Warlord Drogmar, stand it in front of us, and
// drive a run of landed swings so Battle Fury stacks up to its cap.
const result = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  p.maxHp = 100000; p.hp = 100000;
  p.dodgeChance = 0;

  let mob = null, d = 1e9;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead) {
      const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (dd < d) { d = dd; mob = e; }
    }
  }
  mob.templateId = 'warlord_drogmar';
  mob.name = 'Warlord Drogmar';
  mob.level = 17;
  mob.scale = 1.5;
  mob.hostile = true;
  mob.maxHp = 800; mob.hp = mob.maxHp;
  mob.pos.x = p.pos.x + 3; mob.pos.z = p.pos.z;
  sim.targetEntity(mob.id);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  g.input.camYaw = p.facing;

  const apBefore = sim.effectiveAttackPower(mob);
  for (let i = 0; i < 12; i++) { p.hp = p.maxHp; sim.mobSwing(mob, p); }
  const fury = mob.auras.find((a) => a.name === 'Battle Fury');
  const apAfter = sim.effectiveAttackPower(mob);
  return { apBefore, apAfter, hasFury: !!fury, stacks: fury?.stacks, furyValue: fury?.value };
});
console.log('rampage result:', JSON.stringify(result));

await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: 'tmp/rampage_full.png' });

// Crop around the target frame (top-center boss frame) for a tight portrait.
const box = await page.evaluate(() => {
  const tf = document.querySelector('#target-frame');
  if (!tf) return null;
  const r = tf.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
if (box) {
  const pad = 24;
  await page.screenshot({
    path: 'tmp/rampage_target.png',
    clip: {
      x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
      width: box.w + pad * 2, height: box.h + pad * 2,
    },
  });
}

console.log('saved tmp/rampage_full.png, rampage_target.png');
await browser.close();
