// Screenshot the Soulrot affix (necrotic shadow DoT) in the offline client.
// Boots the game, repurposes a nearby mob as Restless Bones, forces its
// on-hit rot onto the player, and captures the resulting shadow DoT debuff
// (and a ticking shadow damage number) on the player.
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

// Repurpose the nearest mob as Restless Bones and drive its rot onto us.
const result = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  // gm survives the live 20Hz loop (a raw maxHp override is wiped by recalc).
  p.gm = true; p.maxHp = 100000; p.hp = 100000;

  let mob = null, d = 1e9;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead) {
      const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (dd < d) { d = dd; mob = e; }
    }
  }
  mob.templateId = 'restless_bones';
  mob.name = 'Restless Bones';
  mob.level = 6;
  mob.hostile = true;
  mob.hp = mob.maxHp;
  mob.pos.x = p.pos.x + 2; mob.pos.z = p.pos.z;
  sim.targetEntity(mob.id);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  g.input.camYaw = p.facing;

  // Force the on-hit proc deterministically, then swing until the rot festers.
  const origChance = sim.rng.chance;
  sim.rng.chance = () => true;
  let rot = null;
  for (let i = 0; i < 30 && !rot; i++) {
    sim.mobSwing(mob, p);
    rot = p.auras.find((a) => a.name === 'Soulrot');
  }
  sim.rng.chance = origChance;
  return { hasRot: !!rot, value: rot?.value, school: rot?.school, remaining: rot?.remaining };
});
console.log('soulrot result:', JSON.stringify(result));

// Let the DoT tick a couple of times so a shadow damage number floats up.
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: 'tmp/soulrot_scene.png' });

// Crop tightly around the player buff/debuff bar (top-right).
const box = await page.evaluate(() => {
  const bar = document.querySelector('#buff-bar');
  if (!bar) return null;
  const r = bar.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
if (box) {
  const pad = 16;
  await page.screenshot({
    path: 'tmp/soulrot_debuff.png',
    clip: {
      x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
      width: box.w + pad * 2, height: box.h + pad * 2,
    },
  });
}
console.log('saved tmp/soulrot_scene.png, soulrot_debuff.png');
await browser.close();
