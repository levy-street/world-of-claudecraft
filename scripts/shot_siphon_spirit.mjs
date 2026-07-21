// Screenshot the Spirit Siphon affix in the offline client. Boots the game as a
// mage (a mana user, so the Spirit drain applies), repurposes a nearby mob as
// Sister Nhalia, forces her on-hit siphon onto the player, and captures the
// resulting Spirit debuff (negative buff_spi) on the player buff bar.
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
await page.type('#char-name', 'Aelwyn');
await page.click('#offline-select .mini-class[data-class="mage"]');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 2500));

// Repurpose the nearest mob as Sister Nhalia and drive her siphon onto us.
const result = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  // gm keeps us alive through the live boss loop; applyAura still lands. (A raw
  // maxHp override would be wiped by recalcPlayerStats re-deriving HP each tick.)
  p.gm = true;
  sim.rng.chance = () => true; // force the proc deterministically for the capture

  let mob = null, d = 1e9;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead) {
      const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (dd < d) { d = dd; mob = e; }
    }
  }
  // Reskin it as the shadow priestess and stand it next to us.
  mob.templateId = 'sister_nhalia';
  mob.name = 'Sister Nhalia';
  mob.level = 12;
  mob.hostile = true;
  mob.hp = mob.maxHp;
  mob.pos.x = p.pos.x + 2; mob.pos.z = p.pos.z;
  sim.targetEntity(mob.id);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  g.input.camYaw = p.facing;

  const spiBefore = p.stats.spi;
  for (let i = 0; i < 5; i++) sim.mobSwing(mob, p);
  const siphon = p.auras.find((a) => a.name === 'Spirit Siphon');
  return { spiBefore, spiAfter: p.stats.spi, hasSiphon: !!siphon, value: siphon?.value, remaining: siphon?.remaining };
});
console.log('siphon result:', JSON.stringify(result));

await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: 'tmp/siphon_spirit_scene.png' });

// Crop tightly around the buff/debuff bar (top-right) where the red-bordered
// Spirit Siphon debuff icon renders.
const box = await page.evaluate(() => {
  const bar = document.querySelector('#buff-bar');
  if (!bar) return null;
  const r = bar.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
if (box) {
  const pad = 16;
  await page.screenshot({
    path: 'tmp/siphon_spirit_debuff.png',
    clip: {
      x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
      width: box.w + pad * 2, height: box.h + pad * 2,
    },
  });
}

console.log('saved tmp/siphon_spirit_scene.png, siphon_spirit_debuff.png');
await browser.close();
