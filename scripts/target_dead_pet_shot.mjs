// Visual proof for "target your own dead pet" (fix/target-own-dead-pet).
// Boots offline as a hunter, turns a nearby mob into the player's OWN pet and kills
// it (dead = true, lootable = false) exactly as a wipe would leave it, then drives
// the real target path (world.targetEntity) and opens the pet context menu from the
// target portrait. Before the fix, targetEntity rejected the dead, unlootable pet so
// targetId stayed null and the Revive/Abandon menu was unreachable.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const TAG = process.env.SHOT_TAG ?? 'after';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.bringToFront(); // headless throttles rAF while backgrounded; __game is set in a frame callback
await click('#btn-offline');
await new Promise((r) => setTimeout(r, 300));
await page.type('#char-name', 'Houndmaster');
await click('#offline-select .mini-class[data-class="hunter"]');
await new Promise((r) => setTimeout(r, 150));
await click('#btn-start-offline');
await page
  .waitForFunction(() => window.__game?.sim?.player, { timeout: 30000 })
  .catch(() => console.log('WARN: __game not ready in time'));
await new Promise((r) => setTimeout(r, 1500));

// Convert the nearest mob into the player's own DEAD pet, in front of the camera.
const info = await page.evaluate(() => {
  const g = window.__game;
  const p = g.sim.player;
  let best = null,
    bd = 1e9;
  for (const e of g.sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead) continue;
    const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  if (!best) return { ok: false };
  best.ownerId = p.id;
  best.hostile = false;
  best.petMode = 'defensive';
  best.name = 'Wolf';
  best.dead = true;
  best.lootable = false;
  best.hp = 0;
  best.pos.x = p.pos.x + Math.cos(p.facing) * 6;
  best.pos.z = p.pos.z - Math.sin(p.facing) * 6;

  // Drive the REAL target path the click handler uses.
  p.targetId = null;
  g.sim.targetEntity(best.id);
  return { ok: true, petId: best.id, dead: best.dead, targetId: p.targetId };
});
console.log('target:', JSON.stringify(info));

// Open the pet context menu from the target portrait (right-click), the only way to
// reach Revive/Abandon. This needs a live target, which the fix now allows.
await page.evaluate(() => {
  const frame = document.querySelector('#target-frame');
  const r = frame.getBoundingClientRect();
  frame.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
    }),
  );
});
await new Promise((r) => setTimeout(r, 500));

const menu = await page.evaluate(() => {
  const el = document.querySelector('#ctx-menu');
  if (!el) return null;
  return { text: el.textContent, visible: el.style.display !== 'none' };
});
console.log('petMenu:', JSON.stringify(menu));

await page.screenshot({ path: `tmp/target_dead_pet_${TAG}.png` });
console.log(`saved tmp/target_dead_pet_${TAG}.png`);

await browser.close();
