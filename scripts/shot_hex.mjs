// Screenshot the Weakening Hex affix in the offline client. Boots the game,
// repurposes a nearby mob as a Gravecaller Cultist, forces its on-hit hex onto
// the player, and captures the resulting debuff on the player unit frame. Logs
// the measured damage/healing reduction the hex applies.
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

// Repurpose the nearest mob as a Gravecaller Cultist and drive its hex onto us.
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
  // Reskin it as the hexing cultist and stand it next to us.
  mob.templateId = 'gravecaller_cultist';
  mob.name = 'Gravecaller Cultist';
  mob.hostile = true;
  mob.hp = mob.maxHp;
  mob.pos.x = p.pos.x + 2; mob.pos.z = p.pos.z;
  sim.targetEntity(mob.id);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  g.input.camYaw = p.facing;

  // Force the hex, then measure the output reduction on a fresh dummy target.
  for (let i = 0; i < 8 && !p.auras.some((a) => a.kind === 'hex'); i++) sim.mobSwing(mob, p);
  const hex = p.auras.find((a) => a.kind === 'hex');
  const dummyHp = 1e9;
  mob.hp = dummyHp;
  sim.dealDamage(p, mob, 1000, false, 'shadow', null, 'hit', true);
  const hexedHit = dummyHp - mob.hp;
  mob.hp = mob.maxHp;
  return {
    hasHex: !!hex, hexName: hex?.name, reduction: hex?.value, remaining: hex?.remaining,
    fullHit: 1000, hexedHit,
  };
});
console.log('hex result:', JSON.stringify(result));

await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: 'tmp/hex_full.png' });

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
    path: 'tmp/hex_frame.png',
    clip: {
      x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
      width: box.w + pad * 2, height: box.h + pad * 2,
    },
  });
}

// Hover the debuff icon to surface its tooltip, then capture it.
if (box) {
  // The hex is the rightmost icon in the bar; hover its centre to surface the tooltip.
  await page.mouse.move(box.x + box.w - 14, box.y + box.h / 2);
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({
    path: 'tmp/hex_tooltip_crop.png',
    clip: {
      x: Math.max(0, box.x - 360), y: Math.max(0, box.y - 10),
      width: 360 + box.w + 30, height: 170,
    },
  });
}

console.log('saved tmp/hex_full.png, hex_frame.png, hex_tooltip_crop.png');
await browser.close();
