// Visual check for friendly-pet nameplate + selection-ring coloring.
// Boots offline, turns a nearby low-level mob into a friendly owned pet
// (ownerId = player, hostile = false) exactly as taming/summoning would,
// targets it, and captures the nameplate text color + ground reticle.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const TAG = process.env.SHOT_TAG ?? 'before';
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
await click('#btn-offline');
await new Promise((r) => setTimeout(r, 300));
await page.type('#char-name', 'Houndmaster');
await click('#offline-select .mini-class[data-class="hunter"]');
await new Promise((r) => setTimeout(r, 150));
await click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 2500));

// Convert the nearest mob into a friendly owned pet, low enough level that the
// old con-color logic (diff >= 3) would paint its name red. Place it in front
// and target it so both the nameplate and the selection ring are visible.
const info = await page.evaluate(() => {
  const g = window.__game;
  const p = g.sim.player;
  let best = null, bd = 1e9;
  for (const e of g.sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead) continue;
    const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
    if (d < bd) { bd = d; best = e; }
  }
  if (!best) return { ok: false };
  best.ownerId = p.id;
  best.hostile = false;
  best.petMode = 'defensive';
  best.name = 'Wolf';
  best.level = p.level + 5; // diff >= 3 so the old con-color logic painted the name RED
  best.pos.x = p.pos.x + Math.cos(p.facing) * 6;
  best.pos.z = p.pos.z - Math.sin(p.facing) * 6;
  best.hp = best.maxHp;
  p.targetId = best.id;
  return { ok: true, name: best.name, level: best.level, owner: best.ownerId === p.id, hostile: best.hostile, diff: best.level - p.level };
});
console.log('pet:', JSON.stringify(info));

await new Promise((r) => setTimeout(r, 900));
await page.screenshot({ path: `tmp/pet_nameplate_${TAG}.png` });
// Crop tightly around the pet's on-screen nameplate so the name color is obvious.
const clip = await page.evaluate(() => {
  const g = window.__game;
  const v = g.renderer?.views?.get(g.sim.player.targetId);
  const r = v?.nameplate?.getBoundingClientRect?.();
  if (!r || r.width === 0) return null;
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  return { x: Math.max(0, cx - 240), y: Math.max(0, cy - 90), width: 480, height: 320 };
});
await page.screenshot({ path: `tmp/pet_nameplate_${TAG}_crop.png`, clip: clip ?? { x: 520, y: 180, width: 560, height: 460 } });

// Pull the actual rendered nameplate color for the pet's view.
const nameColor = await page.evaluate(() => {
  const g = window.__game;
  const p = g.sim.player;
  const v = g.renderer?.views?.get(p.targetId);
  return v?.nameEl ? { text: v.nameEl.textContent, color: v.nameEl.style.color } : null;
});
console.log('nameplate:', JSON.stringify(nameColor));
console.log(`saved tmp/pet_nameplate_${TAG}.png + crop`);

await browser.close();
