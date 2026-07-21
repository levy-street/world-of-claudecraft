// Verifies A/D turn and Q/E strafe match screen directions, using the live camera basis.
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1280,720', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Adventurer');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 1500));

// move somewhere flat & quiet
await page.evaluate(() => {
  const g = window.__game;
  g.sim.player.pos.x = 0; g.sim.player.pos.z = -40;
  g.sim.player.facing = 0;
  g.input.camYaw = 0;
});
await new Promise((r) => setTimeout(r, 400));

const camRight = async () =>
  page.evaluate(() => {
    const m = window.__game.renderer.camera.matrixWorld.elements;
    return { x: m[0], z: m[2] }; // camera local +X (screen right) in world space
  });

const playerPos = async () =>
  page.evaluate(() => ({ x: window.__game.sim.player.pos.x, z: window.__game.sim.player.pos.z, f: window.__game.sim.player.facing }));

// --- strafe right (E): movement should project positively onto screen-right
let right = await camRight();
let p0 = await playerPos();
await page.keyboard.down('e');
await new Promise((r) => setTimeout(r, 700));
await page.keyboard.up('e');
let p1 = await playerPos();
let dot = (p1.x - p0.x) * right.x + (p1.z - p0.z) * right.z;
console.log('E (strafe right) moves screen-right:', dot > 0.1 ? 'OK' : `FAIL (dot=${dot.toFixed(2)})`);

// --- strafe left (Q)
right = await camRight();
p0 = await playerPos();
await page.keyboard.down('q');
await new Promise((r) => setTimeout(r, 700));
await page.keyboard.up('q');
p1 = await playerPos();
dot = (p1.x - p0.x) * right.x + (p1.z - p0.z) * right.z;
console.log('Q (strafe left) moves screen-left:', dot < -0.1 ? 'OK' : `FAIL (dot=${dot.toFixed(2)})`);

// --- turn right (D): after turning, forward movement should drift toward old screen-right
await page.evaluate(() => { window.__game.sim.player.facing = 0; window.__game.input.camYaw = 0; });
await new Promise((r) => setTimeout(r, 300));
right = await camRight();
p0 = await playerPos();
await page.keyboard.down('d');
await new Promise((r) => setTimeout(r, 500));
await page.keyboard.up('d');
await page.keyboard.down('w');
await new Promise((r) => setTimeout(r, 700));
await page.keyboard.up('w');
p1 = await playerPos();
dot = (p1.x - p0.x) * right.x + (p1.z - p0.z) * right.z;
const f1 = await playerPos();
console.log('D (turn right) then W veers screen-right:', dot > 0.1 ? 'OK' : `FAIL (dot=${dot.toFixed(2)})`, `(facing ${f1.f.toFixed(2)})`);

// --- turn left (A)
await page.evaluate(() => { window.__game.sim.player.facing = 0; window.__game.input.camYaw = 0; });
await new Promise((r) => setTimeout(r, 300));
right = await camRight();
p0 = await playerPos();
await page.keyboard.down('a');
await new Promise((r) => setTimeout(r, 500));
await page.keyboard.up('a');
await page.keyboard.down('w');
await new Promise((r) => setTimeout(r, 700));
await page.keyboard.up('w');
p1 = await playerPos();
dot = (p1.x - p0.x) * right.x + (p1.z - p0.z) * right.z;
console.log('A (turn left) then W veers screen-left:', dot < -0.1 ? 'OK' : `FAIL (dot=${dot.toFixed(2)})`);

console.log(errors.length ? 'ERRORS: ' + errors.join('; ') : 'no page errors');
await browser.close();
