// Before/after density chart for the Eastbrook↔Mirefen critter taper. Boots the
// offline game, teleports the player along the z-axis from the Eastbrook vale,
// across the causeway (z=180), into the Mirefen marsh, and samples the REAL
// number of visible ambient critters at each step. Overlays the pre-change flat
// cap (full pool everywhere) against the post-change tapered count, then draws
// the chart on an in-page canvas and screenshots it. Also grabs wide world shots
// in the vale vs on the causeway. Needs `npm run dev` (:5173). Writes to tmp/.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const W = 1600, H = 900;
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: [`--window-size=${W},${H}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: W, height: H },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text()); });

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Naturalist');
await page.evaluate(() => {
  document.querySelector('#offline-select .mini-class[data-class="warrior"]').click();
  document.querySelector('#btn-start-offline').click();
});
await new Promise((r) => setTimeout(r, 2500));

// god-mode so marsh camps don't kill the camera
await page.evaluate(() => {
  const p = window.__game.sim.player;
  p.hp = p.maxHp = 999999;
});

// Sample the live pool: at each z, settle a few hundred ms of ticks then count
// the critters the renderer is actually showing.
const samples = await page.evaluate(async () => {
  const g = window.__game;
  const cf = g.renderer.critters;
  const p = g.sim.player;
  const pool = cf.group.children.length;
  const out = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let z = -40; z <= 400; z += 20) {
    p.pos.x = 30; p.pos.z = z; // x=30 keeps us off the town props but on land
    await sleep(450); // let the pool relocate + settle around the new position
    let vis = 0;
    for (const m of cf.group.children) if (m.visible) vis++;
    out.push({ z, vis });
  }
  return { pool, out };
});
console.log('pool size:', samples.pool);
console.table(samples.out);

// Draw the before/after chart on a canvas overlay and screenshot it.
await page.evaluate(({ pool, out }) => {
  const cv = document.createElement('canvas');
  cv.id = 'critter-chart-overlay';
  cv.width = 1600; cv.height = 900;
  cv.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#11151c';
  document.body.appendChild(cv);
  const c = cv.getContext('2d');
  const L = 110, R = 1520, T = 120, B = 780;
  const zMin = -40, zMax = 400, yMax = pool + 1;
  const sx = (z) => L + (z - zMin) / (zMax - zMin) * (R - L);
  const sy = (v) => B - v / yMax * (B - T);

  c.fillStyle = '#e8eef5';
  c.font = '34px sans-serif';
  c.fillText('Ambient critter population — Eastbrook → causeway → Mirefen', L, 70);
  c.font = '20px sans-serif';

  // axes
  c.strokeStyle = '#3a4250'; c.lineWidth = 1;
  c.beginPath(); c.moveTo(L, T); c.lineTo(L, B); c.lineTo(R, B); c.stroke();
  c.fillStyle = '#9fb0c3';
  for (let v = 0; v <= pool; v += 2) {
    const y = sy(v); c.fillText(String(v), L - 40, y + 6);
    c.strokeStyle = '#222a34'; c.beginPath(); c.moveTo(L, y); c.lineTo(R, y); c.stroke();
  }
  for (let z = zMin; z <= zMax; z += 80) c.fillText('z=' + z, sx(z) - 24, B + 32);
  c.fillText('player z (yd)', (L + R) / 2 - 60, B + 70);

  // causeway boundary marker at z=180
  c.strokeStyle = '#c98b3a'; c.setLineDash([8, 6]); c.lineWidth = 2;
  c.beginPath(); c.moveTo(sx(180), T); c.lineTo(sx(180), B); c.stroke();
  c.setLineDash([]);
  c.fillStyle = '#c98b3a'; c.fillText('causeway (zone boundary z=180)', sx(180) + 10, T + 24);

  // BEFORE: flat pool cap everywhere
  c.strokeStyle = '#6b7682'; c.lineWidth = 3; c.setLineDash([10, 8]);
  c.beginPath(); c.moveTo(sx(zMin), sy(pool)); c.lineTo(sx(zMax), sy(pool)); c.stroke();
  c.setLineDash([]);
  c.fillStyle = '#6b7682'; c.fillText('before — flat ' + pool, R - 230, sy(pool) - 12);

  // AFTER: measured live visible counts
  c.strokeStyle = '#4ea36b'; c.lineWidth = 4;
  c.beginPath();
  out.forEach((s, i) => { const x = sx(s.z), y = sy(s.vis); i ? c.lineTo(x, y) : c.moveTo(x, y); });
  c.stroke();
  c.fillStyle = '#4ea36b';
  for (const s of out) { c.beginPath(); c.arc(sx(s.z), sy(s.vis), 4, 0, 7); c.fill(); }
  c.fillText('after — tapered (live render)', R - 320, sy(out[out.length - 1].vis) + 40);
}, samples);

await new Promise((r) => setTimeout(r, 200));
await page.screenshot({ path: 'tmp/critter_density_chart.png' });
console.log('wrote tmp/critter_density_chart.png');

// Wide world shots: full vale vs sparse causeway.
await page.evaluate(() => { document.getElementById('critter-chart-overlay')?.remove(); });
for (const [label, z] of [['vale', 40], ['causeway', 180]]) {
  await page.evaluate((z) => {
    const g = window.__game;
    g.sim.player.pos.x = 30; g.sim.player.pos.z = z;
    g.renderer.camPitch = 0.5; g.renderer.camDist = 18;
  }, z);
  await new Promise((r) => setTimeout(r, 3500));
  await page.screenshot({ path: `tmp/critters_world_${label}.png` });
  console.log(`wrote tmp/critters_world_${label}.png`);
}

if (errors.length) {
  console.log('=== PAGE ERRORS ==='); for (const e of errors.slice(0, 20)) console.log(e);
} else console.log('no page errors');
await browser.close();
