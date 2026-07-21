// Screenshot the Skullthump affix (on-hit stun) in the offline client.
// Boots the game, repurposes a nearby mob as a Mogger Lackey, forces its
// on-hit crushing blow onto the player, and captures the resulting stun
// debuff in the player buff/debuff bar.
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

// Repurpose the nearest mob as a Mogger Lackey and drive its stun onto us.
const result = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  // gm survives the live 20Hz loop (a raw maxHp override is wiped by recalc).
  p.gm = true;
  sim.rng.chance = () => true; // force the on-hit proc deterministically

  let mob = null, d = 1e9;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead) {
      const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (dd < d) { d = dd; mob = e; }
    }
  }
  // Reskin it as the ogre lackey and stand it next to us.
  mob.templateId = 'mogger_lackey';
  mob.name = 'Mogger Lackey';
  mob.level = 6;
  mob.hostile = true;
  mob.hp = mob.maxHp;
  mob.pos.x = p.pos.x + 2; mob.pos.z = p.pos.z;
  sim.targetEntity(mob.id);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  g.input.camYaw = p.facing;

  for (let i = 0; i < 5; i++) sim.mobSwing(mob, p);
  const stun = p.auras.find((a) => a.name === 'Skullthump');
  // The live affix is a brief 1s proc (proven by the swings + the unit test);
  // hold the aura open here only so the still capture isn't a race with the loop.
  if (stun) { stun.remaining = 8; stun.duration = 8; }
  return { hasStun: !!stun, kind: stun?.kind };
});
console.log('skullthump result:', JSON.stringify(result));

// Crop tightly around the buff/debuff bar (top-right) where the stun renders.
const box = await page.evaluate(() => {
  const bar = document.querySelector('#buff-bar');
  if (!bar) return null;
  const r = bar.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
if (box) {
  const pad = 16;
  await page.screenshot({
    path: 'tmp/skullthump_debuff.png',
    clip: {
      x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
      width: box.w + pad * 2, height: box.h + pad * 2,
    },
  });
}

// Re-apply a fresh stun so the wide scene shot also shows the debuff on the bar.
await page.evaluate(() => {
  const sim = window.__game.sim;
  const p = sim.player;
  const stun = p.auras.find((a) => a.name === 'Skullthump');
  if (stun) { stun.remaining = 8; stun.duration = 8; }
  else p.auras.push({ id: 'stun_mogger_lackey', name: 'Skullthump', kind: 'stun', remaining: 8, duration: 8, value: 0, sourceId: p.id, school: 'physical' });
});
await page.screenshot({ path: 'tmp/skullthump_scene.png' });

console.log('saved tmp/skullthump_scene.png, skullthump_debuff.png');
await browser.close();
