// Screenshot the school-lockout affix (Wyrmward Sigil) in the offline client.
// Boots the game, repurposes a nearby mob as a Wyrmcult Zealot, forces its
// on-hit lockout onto the player, and captures the resulting red fire-lockout
// debuff icon in the top-right buff bar.
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
await new Promise((r) => setTimeout(r, 400)); // panel reveal + auto-select warrior
await page.type('#char-name', 'Brannok');
await page.evaluate(() => document.querySelector('#btn-start-offline').click());
await new Promise((r) => setTimeout(r, 2500));

const result = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  // gm survives the live 20Hz loop (a raw maxHp override gets wiped by
  // recalcPlayerStats); applyAura still lands so the debuff shows.
  p.gm = true;
  sim.rng.chance = () => true; // force the lockout proc deterministically

  let mob = null, d = 1e9;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead) {
      const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (dd < d) { d = dd; mob = e; }
    }
  }
  // Reskin it as a Wyrmcult Zealot and stand it next to us.
  mob.templateId = 'wyrmcult_zealot';
  mob.name = 'Wyrmcult Zealot';
  mob.level = 18;
  mob.hostile = true;
  mob.hp = mob.maxHp;
  mob.pos.x = p.pos.x + 3.5; mob.pos.z = p.pos.z;
  sim.targetEntity(mob.id);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  g.input.camYaw = p.facing;
  if (g.input.camDist !== undefined) g.input.camDist = 10;

  for (let i = 0; i < 5; i++) sim.mobSwing(mob, p);
  const sigil = p.auras.find((a) => a.kind === 'lockout');
  // hold the aura open so the live tick doesn't expire it before capture
  if (sigil) { sigil.remaining = 30; sigil.duration = 30; }
  return { hasSigil: !!sigil, name: sigil?.name, school: sigil?.school, remaining: sigil?.remaining };
});
console.log('lockout result:', JSON.stringify(result));

await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: 'tmp/lockout_scene.png' });

const box = await page.evaluate(() => {
  const bar = document.querySelector('#buff-bar');
  if (!bar) return null;
  const r = bar.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
if (box && box.w > 0) {
  const pad = 18;
  await page.screenshot({
    path: 'tmp/lockout_debuff.png',
    clip: {
      x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
      width: box.w + pad * 2, height: box.h + pad * 2,
    },
  });
}

await browser.close();
console.log('done');
