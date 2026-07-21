// Screenshot tour for ambient critters: boots the offline game, stands in open
// meadow, and captures the wandering wildlife — a wide ambient shot plus a tight
// projected crop of the nearest critter. Writes PNGs to tmp/. Needs `npm run dev`
// (:5173). Override URL with GAME_URL=.
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
await page.click('#btn-offline');
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Naturalist');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 2500));

// god-mode + open meadow clear of hub props; pull the camera up for a wide framing
await page.evaluate(() => {
  const g = window.__game;
  const p = g.sim.player;
  p.pos.x = 150; p.pos.z = 210;
  p.hp = p.maxHp = 999999;
  g.renderer.camPitch = 0.45;
  g.renderer.camDist = 16;
});
await new Promise((r) => setTimeout(r, 4000)); // let the pool populate + wander
await page.screenshot({ path: 'tmp/critters_01_meadow.png' });

// Find the nearest in-frame critter, project it to screen, and crop a detail shot.
const crop = await page.evaluate(() => {
  const g = window.__game;
  const cam = g.renderer.camera;
  const cf = g.renderer.critters;
  if (!cf) return null;
  const p = g.sim.player;
  let best = null, bd = 1e9;
  for (const m of cf.group.children) {
    if (!m.visible) continue;
    const d = Math.hypot(m.position.x - p.pos.x, m.position.z - p.pos.z);
    if (d < bd) { bd = d; best = m; }
  }
  if (!best) return null;
  const v = best.position.clone();
  v.y += 0.25;
  v.project(cam);
  return {
    sx: (v.x * 0.5 + 0.5) * window.innerWidth,
    sy: (-v.y * 0.5 + 0.5) * window.innerHeight,
    species: best.geometry.uuid,
    dist: +bd.toFixed(1),
  };
});
console.log('nearest critter:', JSON.stringify(crop));
if (crop) {
  const S = 280;
  const x = Math.max(0, Math.min(W - S, Math.round(crop.sx - S / 2)));
  const y = Math.max(0, Math.min(H - S, Math.round(crop.sy - S / 2)));
  await page.screenshot({ path: 'tmp/critters_02_closeup.png', clip: { x, y, width: S, height: S } });
}

// walk toward them to provoke the flee behaviour
await page.keyboard.down('w');
await new Promise((r) => setTimeout(r, 1500));
await page.keyboard.up('w');
await page.screenshot({ path: 'tmp/critters_03_flee.png' });

if (errors.length) {
  console.log('=== PAGE ERRORS ===');
  for (const e of errors.slice(0, 20)) console.log(e);
} else {
  console.log('no page errors');
}
await browser.close();
