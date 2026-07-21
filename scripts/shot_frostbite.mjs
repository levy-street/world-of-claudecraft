// Screenshot the Frostbite affix in the offline client. Boots the game,
// repurposes a nearby mob as Shardlord Kazzix, forces its on-hit frost DoT onto
// the player, and captures the resulting frost debuff on the player buff bar.
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

// Repurpose the nearest mob as Shardlord Kazzix and drive its frost burn onto us.
const result = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  // gm survives the live 20Hz loop (a raw maxHp bump is wiped by recalcPlayerStats);
  // applyAura still lands, so the debuff renders.
  p.gm = true;
  // Force the on-hit roll so the frost DoT lands deterministically.
  sim.rng.chance = () => true;

  let mob = null, d = 1e9;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead) {
      const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (dd < d) { d = dd; mob = e; }
    }
  }
  // Reskin it as the rare ice elemental and stand it next to us.
  mob.templateId = 'shardlord_kazzix';
  mob.name = 'Shardlord Kazzix';
  mob.level = 18;
  mob.hostile = true;
  mob.hp = mob.maxHp;
  mob.pos.x = p.pos.x + 2; mob.pos.z = p.pos.z;
  sim.targetEntity(mob.id);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  g.input.camYaw = p.facing;

  for (let i = 0; i < 5; i++) sim.mobSwing(mob, p);
  const frost = p.auras.find((a) => a.id === 'frostbite_shardlord_kazzix');
  return { hasFrostbite: !!frost, name: frost?.name, value: frost?.value, school: frost?.school, remaining: frost?.remaining };
});
console.log('frostbite result:', JSON.stringify(result));

await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: 'tmp/frostbite_scene.png' });

// Crop tightly around the player buff/debuff bar (top-right).
const box = await page.evaluate(() => {
  const bar = document.querySelector('#buff-bar');
  if (!bar) return null;
  const r = bar.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
if (box && box.w > 0) {
  const pad = 16;
  await page.screenshot({
    path: 'tmp/frostbite_debuff.png',
    clip: {
      x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
      width: box.w + pad * 2, height: box.h + pad * 2,
    },
  });
}

await browser.close();
