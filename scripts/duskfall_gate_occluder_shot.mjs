// Before/after proof for the Duskfall Passage hollow-gate occluder fade fix:
// boots the offline game, drops the player onto the crystal-cave landing
// (REALM_PORTALS[0].a.landing in src/sim/content/realm.ts) facing away from
// the cave mouth (the same pose a real portal arrival leaves them in), aims
// the chase camera back toward the gate rock at a zoomed-out distance, and
// screenshots the result. Run once against the buggy tree and once against
// the fixed tree (see scripts/CLAUDE.md / the pr-screenshots skill for the
// before/after stash-and-restore protocol); pass the output path as argv[2].
//   node scripts/duskfall_gate_occluder_shot.mjs tmp/duskfall_gate_after.png
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? 'tmp/duskfall_gate_shot.png';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

// Standing capture rule: seed the lowest graphics preset before boot (this is
// a bug-repro shot, not a graphics-tier comparison).
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
});

await page.goto(URL, { waitUntil: 'load', timeout: 90000 });
const booted = await enterOfflineGame(page, { charClass: 'warrior', charName: 'Rider' });
if (!booted) throw new Error('offline game never booted');

// REALM_PORTALS[0].a.landing: {x: 6.5, z: 773.5, facing: -0.79} (the crystal
// cave on Thornpeak Heights, arrived at from the Duskfall/tree-cave side).
// This is a big jump from the spawn point, which src/main.ts's per-frame loop
// detects as "a teleport-sized jump" and answers with its own blocking
// loading screen (streaming the destination zone neighbourhood in) - so the
// wait for that curtain to lift belongs AFTER this placement, not before.
const camPitch = Number(process.env.CAM_PITCH ?? '0');
const camDist = Number(process.env.CAM_DIST ?? '20');
const camYawOverride = process.env.CAM_YAW !== undefined ? Number(process.env.CAM_YAW) : null;
const landing = await page.evaluate(
  (camPitch, camDist, camYawOverride) => {
    const sim = window.__game.sim;
    const p = sim.player;
    const g = sim.groundPos(6.5, 773.5);
    p.pos.x = g.x;
    p.pos.y = g.y;
    p.pos.z = g.z;
    p.prevPos = { ...p.pos };
    p.facing = -0.79;
    p.vy = 0;
    p.jumping = false;
    p.onGround = true;
    p.fallStartY = p.pos.y;
    // The chase camera orbit is owned by window.__game.input (input.ts), and
    // main.ts copies input.cam{Yaw,Pitch,Dist} onto the renderer EVERY frame
    // (mouse-orbit state, decoupled from Entity.facing) - writing
    // renderer.camYaw directly gets stomped within one frame. The landing's
    // authored facing (-0.79, "the direction players walk out", away from
    // the cave) is what a camera trailing that facing on arrival aligns to:
    // sin(yaw)=-0.707/cos(yaw)=0.707 solves cx,cz toward the gate at (10,770)
    // from this landing, which is yaw == facing for this formula's sign
    // convention (see src/render/renderer.ts's cx/cz camera-pose calc).
    const input = window.__game.input;
    if (input) {
      input.camYaw = camYawOverride === null ? p.facing : camYawOverride;
      input.camPitch = camPitch;
      input.camDist = camDist;
    }
    return {
      x: p.pos.x,
      y: p.pos.y,
      z: p.pos.z,
      facing: p.facing,
      camYaw: input?.camYaw,
      camSet: !!input,
    };
  },
  camPitch,
  camDist,
  camYawOverride,
);
console.log('placed player at', landing);

// Give the frame loop a beat to notice the jump and raise its own loading
// curtain (src/main.ts ~3838-3887) before polling for it, then wait it out.
// SwiftShader software rendering makes the zone-neighbourhood stream/prewarm
// genuinely slow here, so poll with progress logging instead of guessing a
// long fixed delay.
await new Promise((r) => setTimeout(r, 2000));
const loadStart = Date.now();
await page
  .waitForFunction(
    () => !document.querySelector('#loading-screen')?.classList.contains('visible'),
    { timeout: 300000, polling: 2000 },
  )
  .catch(() => console.log('WARNING: #loading-screen never hid within 300s'));
console.log('loading screen resolved after', Math.round((Date.now() - loadStart) / 1000), 's');

// Re-assert the camera orbit: the zone-load path can re-derive/re-snap it
// once the destination actually finishes streaming in.
await page.evaluate(
  (camPitch, camDist, camYawOverride, facing) => {
    const input = window.__game.input;
    if (!input) return;
    input.camYaw = camYawOverride === null ? facing : camYawOverride;
    input.camPitch = camPitch;
    input.camDist = camDist;
  },
  camPitch,
  camDist,
  camYawOverride,
  landing.facing,
);
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: OUT });
console.log('screenshot:', OUT);

await browser.close();
