// Screenshot the Stagger affix (Off-Balance) in the offline client.
// Boots the game, repurposes a nearby mob as a Deeprock Tunneler, forces its
// on-hit Jarring Swing onto the player, and captures the resulting dodge-cut
// debuff on the player buff bar.
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

// Repurpose the nearest mob as a Deeprock Tunneler and drive its stagger onto us.
const result = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  p.gm = true; // invulnerable through the live tick; applyAura still fires

  let mob = null, d = 1e9;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead) {
      const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (dd < d) { d = dd; mob = e; }
    }
  }
  // Reskin it as the staggering kobold and stand it next to us.
  mob.templateId = 'deeprock_kobold';
  mob.name = 'Deeprock Tunneler';
  mob.level = 15;
  mob.hostile = true;
  mob.hp = mob.maxHp;
  mob.pos.x = p.pos.x + 2; mob.pos.z = p.pos.z;
  sim.targetEntity(mob.id);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  g.input.camYaw = p.facing;

  const dodgeBefore = p.dodgeChance;
  // Force a landed hit + a proc so the debuff appears for the capture.
  sim.rng.next = () => 0.99;
  sim.rng.chance = () => true;
  sim.mobSwing(mob, p);
  const dodgeAfter = p.dodgeChance;
  const aura = p.auras.find((a) => a.name === 'Off-Balance');
  return { dodgeBefore, dodgeAfter, hasAura: !!aura, value: aura?.value, remaining: aura?.remaining };
});
console.log('stagger result:', JSON.stringify(result));

await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: 'tmp/stagger_full.png' });

// Crop tightly around the buff/debuff bar where Off-Balance shows.
const box = await page.evaluate(() => {
  const bar = document.querySelector('#buff-bar');
  if (!bar) return null;
  const r = bar.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
if (box) {
  const pad = 16;
  await page.screenshot({
    path: 'tmp/stagger_debuff.png',
    clip: {
      x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
      width: box.w + pad * 2, height: box.h + pad * 2,
    },
  });
}

console.log('saved tmp/stagger_full.png, stagger_debuff.png');
await browser.close();
