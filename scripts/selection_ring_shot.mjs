// Visual check for the animated target selection ring: boots offline, targets
// the nearest enemy, and captures the reticle around the selected unit.
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
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.click('#btn-offline');
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Reticle');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 2500));

// Target the nearest enemy so the selection ring appears, then nudge the
// camera down a touch for a clean look at the ring on the ground.
await page.keyboard.press('Tab');
await new Promise((r) => setTimeout(r, 400));
const info = await page.evaluate(() => {
  const g = window.__game;
  const p = g.sim.player;
  const t = p.targetId != null ? g.sim.entities.get(p.targetId) : null;
  return { targetId: p.targetId, targetName: t?.name ?? null };
});
console.log('target:', JSON.stringify(info));

// Place the targeted unit just in front of the player so the ground reticle
// fills the frame (offline sim — direct mutation is fine for a visual harness).
await page.evaluate(() => {
  const g = window.__game;
  const p = g.sim.player;
  const t = g.sim.entities.get(p.targetId);
  if (t) {
    // 90° to the player's right, in open ground, so nothing occludes the ring.
    t.pos.x = p.pos.x + Math.cos(p.facing) * 6;
    t.pos.z = p.pos.z - Math.sin(p.facing) * 6;
  }
});

// Let the ring spin/pulse a few frames, then capture full + a tight crop.
await new Promise((r) => setTimeout(r, 900));
await page.screenshot({ path: 'tmp/selection_ring.png' });
await page.screenshot({ path: 'tmp/selection_ring_crop.png', clip: { x: 230, y: 250, width: 480, height: 360 } });

// Friendly target → the reticle turns classic gold. Retarget the nearest NPC.
const friendly = await page.evaluate(() => {
  const g = window.__game;
  const p = g.sim.player;
  let best = null, bd = 1e9;
  for (const e of g.sim.entities.values()) {
    if (e.kind !== 'npc') continue;
    const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
    if (d < bd) { bd = d; best = e; }
  }
  if (best) {
    p.targetId = best.id;
    best.pos.x = p.pos.x + Math.cos(p.facing) * 6;
    best.pos.z = p.pos.z - Math.sin(p.facing) * 6;
    return best.name;
  }
  return null;
});
console.log('friendly target:', friendly);
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: 'tmp/selection_ring_friendly.png', clip: { x: 230, y: 250, width: 480, height: 360 } });
console.log('saved tmp/selection_ring.png + crop + friendly');

await browser.close();
