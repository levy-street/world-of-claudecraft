// Screenshot the Smoldering Fuse affix (on-hit fire DoT) in the offline client.
// Boots the game, repurposes a nearby mob as an Ironvein Sapper, forces its
// burning fuse onto the player, and captures the resulting fire DoT debuff on
// the player buff bar.
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

// Repurpose the nearest mob as an Ironvein Sapper and drive its fuse onto us.
const result = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  // gm survives the live 20Hz loop (raw maxHp gets re-derived from stamina each
  // tick by recalcPlayerStats); applyAura still lands on a gm player.
  p.gm = true; p.maxHp = 100000; p.hp = 100000;
  sim.rng.chance = () => true; // guarantee the on-hit proc fires

  let mob = null, d = 1e9;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead) {
      const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (dd < d) { d = dd; mob = e; }
    }
  }
  // Reskin it as the smoldering sapper and stand it next to us (offset on +x/+z
  // so the third-person camera frames it close).
  mob.templateId = 'ironvein_sapper';
  mob.name = 'Ironvein Sapper';
  mob.level = 16;
  mob.hostile = true;
  mob.hp = mob.maxHp;
  mob.pos.x = p.pos.x + 4; mob.pos.z = p.pos.z + 4;
  sim.targetEntity(mob.id);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  g.input.camYaw = p.facing;
  if (g.input) g.input.camDist = 10;

  for (let i = 0; i < 6; i++) sim.mobSwing(mob, p);
  const fuse = p.auras.find((a) => a.name === 'Smoldering Fuse');
  return { hasFuse: !!fuse, school: fuse?.school, value: fuse?.value, remaining: fuse?.remaining };
});
console.log('smolder result:', JSON.stringify(result));

await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: 'tmp/smolder_scene.png' });

// Crop tightly around the top-right buff/debuff bar where the fire DoT renders.
const box = await page.evaluate(() => {
  const bar = document.querySelector('#buff-bar');
  if (!bar) return null;
  const r = bar.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
if (box && box.w > 0) {
  const pad = 18;
  await page.screenshot({
    path: 'tmp/smolder_debuff.png',
    clip: {
      x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
      width: box.w + pad * 2, height: box.h + pad * 2,
    },
  });
}

console.log('saved tmp/smolder_scene.png, tmp/smolder_debuff.png');
await browser.close();
