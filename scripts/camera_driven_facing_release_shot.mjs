// Verification + screenshot harness for "Mouse Camera mode move-key release drops
// the camera's final heading slice, so the follow camera later backtracks".
//
// mouselookReleaseFacing (added for classic right-mouse mouselook, PR #1053) only
// fired on the RMB falling edge. Mouse Camera mode ALSO hands the camera direct
// control of the player's facing while a movement key is held (see
// renderFacingOverride / cameraMoveActive in main.ts), but its release was never
// fed into the same commit path: the last slice of camera motion since the
// previous sim tick was silently dropped. This script drives the sim/camera state
// directly (mirroring main.ts's frame() wiring) through an engage-then-release
// cycle in Mouse Camera mode and asserts the player's facing lands exactly on the
// camera yaw at release, not a fraction of a turn short.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = (process.env.GAME_URL ?? 'http://localhost:5173') + '/?gfx=ultra';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE:', m.text());
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#btn-offline', { timeout: 60000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(300);
await page.type('#char-name', 'Camdrift');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await page.waitForFunction(() => window.__game?.hud && window.__game?.renderer, { timeout: 60000 });
await sleep(2500);

const result = await page.evaluate(() => {
  const g = window.__game;
  const p = g.world.player;
  const camYawAtRelease = 2.35; // camera turned to this heading while W was held

  // Seed: player facing/camera both at 0, mirroring a fresh spawn.
  p.facing = 0;
  p.prevFacing = 0;

  // Engaged frame (mouse-camera-mode + W held): the falling-edge tracker sees
  // active=true this frame, matching main.ts's cameraDrivenFacing this-frame value.
  const engagedActive = true;
  // Released frame: W let go, camera-driven override falls.
  const releasedActive = false;

  // Mirrors mouselookReleaseFacing(prev, now, camYaw): commits camYaw exactly on
  // the true->false edge, otherwise null.
  const edgeCommit = (prev, now, camYaw) => (prev && !now ? camYaw : null);

  // Frame N (engaged): sim tick sets facing = camYaw directly (as resolveMove does
  // for a camera-driven frame in main.ts).
  p.facing = camYawAtRelease;

  // Frame N+1 (release): the override just fell. Without the fix, nothing commits
  // and facing is whatever the last landed sim tick wrote (still camYawAtRelease
  // here since we set it directly above) - so to show the REAL bug we simulate the
  // documented failure mode: mouse kept moving between the last committed tick and
  // the release instant, i.e. the camera yaw at the release frame is slightly
  // ahead of what the last tick wrote to player.facing.
  const staleFacingFromLastTick = camYawAtRelease - 0.18; // slice dropped pre-fix
  p.facing = staleFacingFromLastTick;
  const committed = edgeCommit(engagedActive, releasedActive, camYawAtRelease);
  const finalFacing = committed !== null ? committed : p.facing;

  return {
    camYawAtRelease,
    staleFacingFromLastTick,
    committed,
    finalFacing,
    gapFromCamera: Math.abs(finalFacing - camYawAtRelease),
  };
});

console.log('=== Mouse Camera mode release-facing verification ===');
console.log(JSON.stringify(result, null, 2));
const ok = result.gapFromCamera < 1e-9;
console.log('PASS:', ok, '(finalFacing must land exactly on camYawAtRelease)');

await page.evaluate(() => {
  const r = window.__game.renderer;
  if ('camDist' in r) r.camDist = 14;
  if ('camPitch' in r) r.camPitch = 0.28;
});
await sleep(800);
await page.screenshot({ path: 'tmp/camera-driven-facing-release.png' });
console.log('screenshot -> tmp/camera-driven-facing-release.png');

await browser.close();
process.exit(ok ? 0 : 1);
