// Screenshot the stacking-poison affix (Brood Venom) in the offline client.
// Boots the game, repurposes a nearby mob as the Broodmother, forces its
// on-hit poison onto the player repeatedly, and captures the ramped 5-stack
// debuff (Brood Venom x5) on the player buff bar.
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
await new Promise((r) => setTimeout(r, 400)); // panel reveal auto-selects warrior
await page.type('#char-name', 'Brannok');
try { await page.click('#offline-select .mini-class[data-class="warrior"]'); } catch {}
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 2500));

const result = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  p.gm = true; // survive the L10 boss; applyAura still lands
  sim.rng.chance = () => true; // force every on-hit roll to proc

  let mob = null, d = 1e9;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead) {
      const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (dd < d) { d = dd; mob = e; }
    }
  }
  // Reskin it as the Broodmother and stand it next to us.
  mob.templateId = 'mirefen_broodmother';
  mob.name = 'The Broodmother';
  mob.level = 10;
  mob.hostile = true;
  mob.hp = mob.maxHp;
  mob.pos.x = p.pos.x + 2; mob.pos.z = p.pos.z;
  sim.targetEntity(mob.id);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  g.input.camYaw = p.facing;

  // Bite repeatedly to ramp the stacks to the cap (maxStacks = 5).
  for (let i = 0; i < 16; i++) sim.mobSwing(mob, p);
  const venom = p.auras.find((a) => a.name === 'Brood Venom');
  return { hasVenom: !!venom, stacks: venom?.stacks, value: venom?.value, remaining: venom?.remaining };
});
console.log('stackPoison result:', JSON.stringify(result));

await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: 'tmp/stackpoison_scene.png' });

// Crop tightly around the (top-right) buff/debuff bar showing Brood Venom x5.
const box = await page.evaluate(() => {
  const bar = document.querySelector('#buff-bar');
  if (!bar) return null;
  const r = bar.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
if (box) {
  const pad = 18;
  await page.screenshot({
    path: 'tmp/stackpoison_debuff.png',
    clip: {
      x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
      width: box.w + pad * 2, height: box.h + pad * 2,
    },
  });
}
// Hover the debuff icon to surface its tooltip (shows "Brood Venom x5").
if (box) {
  await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2);
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({
    path: 'tmp/stackpoison_tooltip.png',
    clip: {
      x: Math.max(0, box.x - 320), y: Math.max(0, box.y - 10),
      width: 320 + box.w + 20, height: 170,
    },
  });
}
console.log('saved tmp/stackpoison_scene.png, stackpoison_debuff.png, stackpoison_tooltip.png');
await browser.close();
