// Screenshot the Banshee's Wail elite mechanic in the offline client.
// Boots the game, repurposes a nearby mob as Sister Nhalia, fires her timed
// AoE-fear pulse onto the player, and captures the resulting fear debuff on
// the player unit frame.
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

// Repurpose the nearest mob as Sister Nhalia and fire her wail onto us.
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
  // Reskin it as the wailing banshee, stand it next to us, lock it in combat.
  mob.templateId = 'sister_nhalia';
  mob.name = 'Sister Nhalia';
  mob.hostile = true;
  mob.hp = mob.maxHp;
  mob.pos.x = p.pos.x + 3; mob.pos.z = p.pos.z;
  mob.aiState = 'attack';
  mob.aggroTargetId = p.id;
  mob.inCombat = true;
  sim.targetEntity(mob.id);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  g.input.camYaw = p.facing;

  // Fire the timed wail now via the real AI path.
  mob.terrifyTimer = 0.001;
  sim.updateMob(mob);

  const wail = p.auras.find((a) => a.name === "Banshee's Wail");
  return { hasWail: !!wail, kind: wail?.kind, remaining: wail?.remaining, breaksOnDamage: wail?.breaksOnDamage };
});
console.log('terrify result:', JSON.stringify(result));

await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: 'tmp/terrify_full.png' });

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
    path: 'tmp/terrify_frame.png',
    clip: {
      x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
      width: box.w + pad * 2, height: box.h + pad * 2,
    },
  });
  // Hover the debuff icon to surface its tooltip.
  await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2);
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({
    path: 'tmp/terrify_tooltip_crop.png',
    clip: {
      x: Math.max(0, box.x - 300), y: Math.max(0, box.y - 10),
      width: 300 + box.w + 20, height: 140,
    },
  });
}

console.log('saved tmp/terrify_full.png, terrify_frame.png, terrify_tooltip_crop.png');
await browser.close();
