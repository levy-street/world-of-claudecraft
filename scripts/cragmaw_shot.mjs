// Screenshot Old Cragmaw — the rare elite ridge beast (Thornpeak Heights) — in
// the offline client. Boots the game, repurposes a nearby mob as Old Cragmaw at
// its real template/level, targets it, and captures the elite target frame.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
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

// Repurpose the nearest mob as Old Cragmaw, scaled like the real level-14 rare
// elite, and stand it in front of us so the elite target frame reads correctly.
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
  mob.templateId = 'old_cragmaw';
  mob.name = 'Old Cragmaw';
  mob.level = 14;
  mob.hostile = true;
  mob.maxHp = 1056; mob.hp = mob.maxHp; // ~ level-14 elite scaling
  mob.scale = 1.3;
  mob.pos.x = p.pos.x + 4; mob.pos.z = p.pos.z;
  sim.targetEntity(mob.id);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  g.input.camYaw = p.facing;
  return { name: mob.name, level: mob.level, hp: mob.hp };
});
console.log('cragmaw:', JSON.stringify(result));

await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: 'tmp/cragmaw_full.png' });

// Crop the target frame (name + elite tag + health).
const box = await page.evaluate(() => {
  const el = document.querySelector('#target-frame');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
if (box) {
  const pad = 18;
  await page.screenshot({
    path: 'tmp/cragmaw_targetframe.png',
    clip: {
      x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
      width: box.w + pad * 2, height: box.h + pad * 2,
    },
  });
}

console.log('saved tmp/cragmaw_full.png, tmp/cragmaw_targetframe.png');
await browser.close();
