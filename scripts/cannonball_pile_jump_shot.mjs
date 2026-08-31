// Before/after proof for the Dawnhold cannonball-pile collision fix (issue:
// "cant jump on balls"). Drops the player from well above the hexCannonballs
// pile at Evergarden (276.5, 909) with no input and lets the sim's own
// gravity/collision resolve where they land: before the fix the pile has no
// collider at all, so the drop falls straight through to open ground; after
// the fix the pile is a standable platform (colliders.ts moveTopY/standable),
// so the drop lands and rests on TOP of it. Logs the landing height next to
// the pixels as the physics proof.
//
// Needs `npm run dev` on :5173 (override with GAME_URL). Writes to tmp/.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.SHOT_NAME ?? 'tmp/cannonball-pile.png';
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

// Lowest graphics preset per the standing capture rule: this is a gameplay
// (collision) proof, not a graphics comparison.
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
  } catch {
    /* ignore */
  }
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 90000 });
const booted = await enterOfflineGame(page, {
  charClass: 'warrior',
  charName: 'Ballboy',
  gameBootTimeoutMs: 120000,
  selectorTimeoutMs: 60000,
});
if (!booted) throw new Error('offline world did not boot');
await sleep(800);

async function frame() {
  await page.screenshot({ path: 'tmp/_frame.png' });
}

// Drop the player straight down onto the pile from well above it and let the
// sim's own tick loop resolve the landing; no jump/movement input involved.
const result = await page.evaluate(() => {
  const g = window.__game;
  g.sim.setPlayerLevel(60); // the roadside Topiary Wolf must not decide this capture
  const p = g.sim.player;
  const idle = {
    forward: false,
    back: false,
    turnLeft: false,
    turnRight: false,
    strafeLeft: false,
    strafeRight: false,
    jump: false,
  };
  const x = 276.5;
  const z = 909;
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y += 8; // well above the pile top either way
  p.prevPos = { ...p.pos };
  p.fallStartY = p.pos.y;
  p.facing = Math.PI; // face -z, looking back at the gate/pile from the lawn
  p.prevFacing = p.facing;
  p.vx = 0;
  p.vy = 0;
  p.vz = 0;
  p.onGround = false;
  const startY = +p.pos.y.toFixed(3);
  for (let i = 0; i < 200 && !p.onGround; i++) {
    Object.assign(g.sim.moveInput, idle);
    g.sim.tick();
  }
  return {
    settled: p.onGround,
    startY,
    landedY: +p.pos.y.toFixed(3),
    x: +p.pos.x.toFixed(2),
    z: +p.pos.z.toFixed(2),
  };
});
console.log('drop result:', JSON.stringify(result));

await page.evaluate(() => {
  const inp = window.__game.input;
  inp.camYaw = 2.5;
  inp.camDist = 9;
  inp.camPitch = 0.55;
});

for (let i = 0; i < 10; i++) {
  await frame();
  await sleep(400);
  // The GPU-acceleration warning banner must not sit across the keeper; it
  // can appear a while after boot, so keep dismissing it across the wait.
  await page.evaluate(() => {
    const dismiss = [...document.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Dismiss',
    );
    dismiss?.click();
  });
}
await page.screenshot({ path: OUT });
console.log('wrote', OUT);

await browser.close();
