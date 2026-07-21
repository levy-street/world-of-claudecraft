// Screenshot the reactive Frenzy affix (Blood Frenzy) in the offline client.
// Boots the game, repurposes a nearby mob as Old Greyjaw, drives a player blow
// through the real damage funnel with the proc forced, and captures the
// "flies into a frenzy" combat-log line + the nova VFX on the wolf. The buff is
// a self-haste on the mob (not a player debuff), so there is no debuff icon to
// grab — the combat log is the reliable visual, as for other reactive traits.
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

// Switch the chat panel to the combat-log tab up front.
await page.evaluate(() => {
  const tab = [...document.querySelectorAll('.chat-tab')].find((t) => t.dataset.logTab === 'combat');
  if (tab) tab.click();
});

// Repurpose the nearest mob as Old Greyjaw and drive the real frenzy proc.
const result = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  p.gm = true; // invulnerable so the live 20Hz tick can't kill us mid-capture

  let mob = null, d = 1e9;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead) {
      const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (dd < d) { d = dd; mob = e; }
    }
  }
  // Reskin it as the rare wolf, stand it ~6yd out front, and keep it alive.
  mob.templateId = 'old_greyjaw';
  mob.name = 'Old Greyjaw';
  mob.level = 4;
  mob.hostile = true;
  mob.maxHp = 100000; mob.hp = 100000;
  mob.pos.x = p.pos.x + 4; mob.pos.z = p.pos.z;
  sim.targetEntity(mob.id);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  g.input.camYaw = p.facing;
  if (g.input.camDist !== undefined) g.input.camDist = 10;

  // Force the proc and land a real player blow through the production path.
  sim.rng.chance = () => true;
  const before = sim.swingIntervalMult(mob);
  sim.dealDamage(p, mob, 10, false, 'physical', null, 'hit', true);
  const after = sim.swingIntervalMult(mob);
  const aura = mob.auras.find((a) => a.id === 'blood_frenzy');
  return {
    hasFrenzy: !!aura, name: aura?.name, value: aura?.value, remaining: aura?.remaining,
    swingBefore: before, swingAfter: after,
  };
});
console.log('frenzy result:', JSON.stringify(result));

// Let the nova VFX render, capture the full scene.
await new Promise((r) => setTimeout(r, 250));
await page.screenshot({ path: 'tmp/frenzy_scene.png' });

// Crop the combat log (fixed bottom-left region — the panel reports 0 width).
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({
  path: 'tmp/frenzy_log.png',
  clip: { x: 8, y: 560, width: 470, height: 320 },
});

console.log('saved tmp/frenzy_scene.png, tmp/frenzy_log.png');
await browser.close();
