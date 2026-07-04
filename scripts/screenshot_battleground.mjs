// Lookdev screenshots of the Gravemarch battleground environment
// (src/render/battleground.ts). Boots the OFFLINE client, teleports the sim
// player to battlegroundOrigin(0) via window.__game.sim (dev exposure), waits
// for the lazy build, and captures base / lane / chapel / overview angles.
// Needs `npm run dev` running (GAME_URL, default http://localhost:5210).
// Browser via scripts/browser_path.mjs. Output dir via SHOT_DIR (default
// tmp/bg_shots).
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5210';
const OUT = process.env.SHOT_DIR ?? 'tmp/bg_shots';
const GFX = process.env.SHOT_GFX ?? 'high';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// battlegroundOrigin(0) (src/sim/data.ts): x 9900, z -1250
const OX = 9900;
const OZ = -1250;

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  protocolTimeout: 120000,
  args: [
    '--no-sandbox',
    '--window-size=1600,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(`${URL}/?gfx=${GFX}`, { waitUntil: 'networkidle0', timeout: 60000 });
// the offline trigger is a hidden compat button: click it in page context
// (arena_visual.mjs pattern) rather than through the pointer
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(400);
await page.type('#char-name', 'Lookdev');
await page.evaluate(() => {
  document.querySelector('#offline-select .mini-class[data-class="warrior"]').click();
  document.querySelector('#btn-start-offline').click();
});
await page.waitForFunction(() => Boolean(window.__game?.sim), { timeout: 60000, polling: 500 });
await sleep(1500);

async function teleport(x, z, facing, camYaw, camPitch, camDist) {
  await page.evaluate(
    (x, z, facing, camYaw, camPitch, camDist) => {
      const g = window.__game;
      const p = g.sim.player;
      p.maxHp = 99999;
      p.hp = 99999;
      p.pos.x = x;
      p.pos.z = z;
      p.pos.y = 0;
      p.facing = facing;
      g.input.camYaw = camYaw;
      g.input.camPitch = camPitch;
      g.input.camDist = camDist;
    },
    x,
    z,
    facing,
    camYaw,
    camPitch,
    camDist,
  );
}

async function shot(name, waitMs = 1400) {
  await sleep(waitMs);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('wrote', `${OUT}/${name}.png`);
}

// camYaw is the direction the CAMERA faces: 0 = north (+z), PI/2 = west (-x),
// PI = south (-z), 3PI/2 = east (+x). Set facing to match so the chase cam
// does not swing during the settle wait.

// 1. Base A seen from the field: gates, keep and warstone glow to the south.
await teleport(OX + 0, OZ - 62, Math.PI, Math.PI, 0.34, 18);
await sleep(4500); // first visit: lazy build + shader compiles
await shot('bg1_base_a');

// 2. West lane mid-field: road running south to A's outer bulwark (red roof).
await teleport(OX - 56, OZ + 6, Math.PI, Math.PI - 0.25, 0.28, 13);
await shot('bg2_lane_west');

// 3. The chapel of the Knell: bell + ring stubs, base A far behind.
await teleport(OX - 2, OZ + 22, Math.PI, Math.PI + 0.08, 0.4, 17);
await shot('bg3_chapel');

// 4. Overview: high camera from the south-east looking north-west across the
// field (chapel center, both lanes, base B in the haze). View dir is
// (-sin(yaw), cos(yaw)), so NW = PI/4.
await teleport(OX + 44, OZ - 62, Math.PI / 4, Math.PI / 4, 0.95, 30);
await shot('bg4_overview');

// 5. Base B (Pale, blue) team-tint contrast, from the field looking north.
await teleport(OX + 0, OZ + 62, 0, 0, 0.34, 18);
await shot('bg5_base_b');

// 6. Warstone close-up: monolith glow shader + embers + dais + braziers
// (south-west of the camera, so yaw PI - 0.5).
await teleport(OX + 5, OZ - 96, Math.PI - 0.5, Math.PI - 0.5, 0.3, 13);
await shot('bg6_warstone');

await browser.close();
console.log('done');
