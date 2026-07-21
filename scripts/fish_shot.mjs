// Screenshot harness for the ambient leaping-fish system (src/render/fish.ts).
// Boots the offline world, stands an angler on the shore of the Mirefen Marsh
// lake (~ -128,300), and captures fish breaking the surface — both a forced
// "hero" pose (frozen at the arc apex over water) and natural in-game frames.
//
// Needs `npm run dev` on :5173 (override with GAME_URL). Writes to tmp/.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(200);
await page.type('#char-name', 'Gillwyn');
await page.click('#offline-select .mini-class[data-class="hunter"]');
await page.click('#btn-start-offline');
await sleep(2500);

// stand on the shore looking west across the marsh lake; god-mode the angler
await page.evaluate(() => {
  const g = window.__game;
  const p = g.sim.player;
  p.pos.x = -104; p.pos.z = 300;
  p.maxHp = 99999; p.hp = 99999;
  // face the open water at ~(-128,300): west, -x
  p.facing = Math.atan2(-128 - p.pos.x, 0);
  g.input.camYaw = p.facing;
  g.input.camPitch = 0.18; // low angle so leaps arc against the far shore
});
await sleep(1500);
await page.screenshot({ path: 'tmp/fish-shore.png' });

// --- forced hero pose: freeze the fish updater and pin one fish at the apex ---
const posed = await page.evaluate(() => {
  const g = window.__game;
  const fish = g.renderer.fish;
  const cam = g.renderer.camera;
  // a point ~20yd ahead of the camera, out over the water (camera -Z is forward)
  const v = { x: -cam.matrix.elements[8], z: -cam.matrix.elements[10] };
  const len = Math.hypot(v.x, v.z) || 1;
  const fx = cam.position.x + (v.x / len) * 20;
  const fz = cam.position.z + (v.z / len) * 20;
  const WATER_Y = -4.5; // WATER_LEVEL
  // children are [body,splash] per fish; pose the first body + its splash
  const kids = fish.group.children;
  const body = kids[0];
  const splash = kids[1];
  fish.group.visible = true;
  fish.update = () => {}; // freeze so our pose survives the render loop
  // broadside to the camera: long axis perpendicular to the view direction
  const perp = { x: v.z / len, z: -v.x / len };
  const heading = Math.atan2(perp.x, perp.z);
  body.visible = true;
  body.position.set(fx, WATER_Y + 2.1, fz); // apex
  body.rotation.set(0, 0, 0);
  body.rotateY(heading);
  body.rotateX(-0.55); // nose pitched up out of the water
  body.rotateZ(0.35); // roll so the flank catches the light
  body.scale.set(2.8, 2.8, 2.8); // enlarge for a legible hero shot
  // ripple where it broke the surface, a little behind/below the fish
  splash.visible = true;
  splash.position.set(fx - perp.x * 1.2, WATER_Y + 0.02, fz - perp.z * 1.2);
  splash.scale.set(1.6, 1, 1.6);
  splash.material.opacity = 0.5;
  return { fx: +fx.toFixed(1), fz: +fz.toFixed(1), camX: +cam.position.x.toFixed(1) };
});
console.log('hero pose:', JSON.stringify(posed));
await sleep(400);
await page.screenshot({ path: 'tmp/fish-hero.png' });

await browser.close();
console.log('done -> tmp/fish-shore.png, tmp/fish-hero.png');
