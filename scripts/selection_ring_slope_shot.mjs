// Before/after proof for the 3D selection-ring fix.
//
// The target reticle is a flat ring at a unit's feet. On a slope the OLD code
// kept it perfectly horizontal, so its uphill half sank into the rising terrain
// and only a red downhill streak survived depth testing (see the bug report).
// The fix drapes the ring over the terrain (drapeRingLocalY) so every vertex
// rides its own ground height and the full reticle reads at any elevation.
//
// This drives the REAL offline renderer: we drop a mob on a steep slope, target
// it, and capture two frames of the SAME scene:
//   - "before": the ring is re-flattened each frame to emulate the old code
//   - "after" : the shipped draped ring
//
// Needs `npm run dev`. Override the port with GAME_URL. Writes:
//   tmp/selection-ring-before.png, tmp/selection-ring-after.png
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5174';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1280,820', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 820 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(300);
await page.type('#char-name', 'Slopewatch');
await page.evaluate(() => {
  const el = document.querySelector('#offline-select .mini-class[data-class="hunter"]');
  if (el) el.click();
});
await page.click('#btn-start-offline');
await page.waitForFunction(() => window.__game && window.__game.sim && window.__game.sim.player,
  { timeout: 30000 });
await sleep(800);

// Stage the scene and install the "before"/"after" ring toggle.
const staged = await page.evaluate(async () => {
  const w = await import('/src/sim/world.ts');
  const g = window.__game;
  const sim = g.sim;
  const seed = sim.cfg.seed;
  const p = sim.player;
  const gh = (x, z) => w.groundHeight(x, z, seed);
  const mobs = [...sim.entities.values()].filter((e) => e.kind === 'mob');
  const target = mobs[0];
  // nearest OTHER mob to a point, used to keep the staged scene uncluttered.
  const nearestOtherMob = (x, z) => {
    let d2 = Infinity;
    for (const m of mobs) {
      if (m.id === target.id) continue;
      const dd = (m.pos.x - x) ** 2 + (m.pos.z - z) ** 2;
      if (dd < d2) d2 = dd;
    }
    return Math.sqrt(d2);
  };

  // Find a moderate, walkable slope near spawn (grad ~0.3-0.55, about 17 to 29
  // degrees, matching the grassy hill in the report; steeper points are cliffs).
  let best = null;
  for (let dx = -160; dx <= 160; dx += 4) {
    for (let dz = -160; dz <= 160; dz += 4) {
      const x = p.pos.x + dx, z = p.pos.z + dz;
      const h = gh(x, z);
      if (h < 1.5) continue; // well above water so the slope is lit, not a dark shore
      const grad = Math.hypot(gh(x + 2, z) - h, gh(x, z + 2) - h) / 2;
      if (grad < 0.55 || grad > 0.8) continue;
      if (nearestOtherMob(x, z) < 30) continue; // keep the frame uncluttered
      const score = grad - Math.hypot(dx, dz) * 0.002; // steep, lightly favor nearby
      if (!best || score > best.score) best = { x, z, h, grad, score };
    }
  }
  if (!best) return { ok: false };

  // Uphill direction (gradient ascent) at the slope point.
  const gx = gh(best.x + 1, best.z) - gh(best.x - 1, best.z);
  const gz = gh(best.x, best.z + 1) - gh(best.x, best.z - 1);
  const upLen = Math.hypot(gx, gz) || 1;
  const up = { x: gx / upLen, z: gz / upLen };

  // Mob on the slope; player ~5yd downhill so the slope rises toward the target.
  target.pos.x = best.x; target.pos.z = best.z; target.pos.y = gh(best.x, best.z);
  // downhill + lateral offset so the player doesn't occlude the targeted mob.
  const cross = { x: up.z, z: -up.x };
  const px = best.x - up.x * 3.2 + cross.x * 2.6;
  const pz = best.z - up.z * 3.2 + cross.z * 2.6;
  p.pos.x = px; p.pos.z = pz; p.pos.y = gh(px, pz);
  p.targetId = target.id;
  // aim the camera from the player toward the target so the mob is in open frame.
  const dirx = best.x - px, dirz = best.z - pz;
  p.facing = Math.atan2(dirx, dirz);
  g.renderer.camYaw = Math.atan2(dirx, dirz);
  g.renderer.camPitch = 0.26;
  g.renderer.camDist = 6;

  // Pin the mob + target so a few frames of AI can't drift the scene.
  const tx = target.pos.x, tz = target.pos.z, ty = target.pos.y;
  g.__ringMode = 'after';
  if (!g.__ringHooked) {
    g.__ringHooked = true;
    const r = g.renderer;
    const origSync = r.sync.bind(r);
    r.sync = (...args) => {
      target.pos.x = tx; target.pos.z = tz; target.pos.y = ty;
      p.targetId = target.id;
      origSync(...args);
      if (g.__ringMode === 'before' && r.selectionRing.visible) {
        const tv = r.views.get(target.id);
        if (tv) {
          // OLD behavior: flat ring anchored to the entity's render Y.
          r.selectionRing.position.set(
            tv.group.position.x, tv.group.position.y + 0.08, tv.group.position.z);
          const pos = r.selectionRingMesh.geometry.getAttribute('position');
          for (let i = 0; i < pos.count; i++) pos.setY(i, 0);
          pos.needsUpdate = true;
          r.selectionRingTicks.position.y = 0;
        }
      }
    };
  }
  return { ok: true, best, targetName: target.name, targetId: target.id };
});
console.log('staged:', JSON.stringify(staged));
if (!staged.ok) { await browser.close(); process.exit(1); }

await sleep(900); // let camera/render settle

await page.evaluate(() => { window.__game.__ringMode = 'before'; });
await sleep(500);
await page.screenshot({ path: 'tmp/selection-ring-before.png' });

await page.evaluate(() => { window.__game.__ringMode = 'after'; });
await sleep(500);
await page.screenshot({ path: 'tmp/selection-ring-after.png' });

console.log('wrote tmp/selection-ring-before.png and tmp/selection-ring-after.png');
await browser.close();
