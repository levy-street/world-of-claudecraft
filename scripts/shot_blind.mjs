// Screenshot the Blinding Powder affix in the offline client.
// Boots the game, repurposes a nearby mob as a Vale Bandit, forces its on-hit
// Blinding Powder onto the player, and captures the resulting blind debuff on
// the player unit frame (plus the player's own swings whiffing).
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

// Repurpose the nearest mob as a Vale Bandit and drive its Blinding Powder onto us.
const result = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  p.maxHp = 100000; p.hp = 100000;

  let mob = null, d = 1e9;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead) {
      const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (dd < d) { d = dd; mob = e; }
    }
  }
  // Reskin it as the dirty-fighting bandit and stand it next to us.
  mob.templateId = 'vale_bandit';
  mob.name = 'Vale Bandit';
  mob.hostile = true;
  mob.maxHp = 100000; mob.hp = 100000;
  mob.pos.x = p.pos.x + 2; mob.pos.z = p.pos.z;
  sim.targetEntity(mob.id);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  g.input.camYaw = p.facing;

  // Force the powder onto us, then take a few of our own swings so the FCT
  // shows the blinded misses.
  sim.MOBS_FORCE = null;
  for (let i = 0; i < 6 && !p.auras.some((a) => a.kind === 'blind'); i++) sim.mobSwing(mob, p);
  if (!p.auras.some((a) => a.kind === 'blind')) {
    p.auras.push({
      id: 'blind_vale_bandit', name: 'Blinding Powder', kind: 'blind',
      remaining: 5, duration: 5, value: 0.3, sourceId: mob.id, school: 'physical',
    });
  }
  const blind = p.auras.find((a) => a.kind === 'blind');
  let misses = 0;
  for (let i = 0; i < 8; i++) { if (sim.meleeSwing(p, mob, 0, null, { cannotBeDodged: true }) === false) misses++; }
  return { hasBlind: !!blind, blindValue: blind?.value, blindRemaining: blind?.remaining, misses };
});
console.log('blind result:', JSON.stringify(result));

await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: 'tmp/blind_full.png' });

// Crop tightly around the player unit frame + buff/debuff bar.
const box = await page.evaluate(() => {
  const bar = document.querySelector('#buff-bar');
  if (!bar) return null;
  const r = bar.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
if (box) {
  const pad = 16;
  await page.screenshot({
    path: 'tmp/blind_frame.png',
    clip: {
      x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
      width: box.w + pad * 2, height: box.h + pad * 2,
    },
  });
}

console.log('saved tmp/blind_full.png, blind_frame.png');
await browser.close();
