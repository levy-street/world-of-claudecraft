// The Weirdo Cream truck showcase: a full 360-degree orbit at ultra graphics,
// stationary, jumping on a loop so the roof chime keeps firing.
//
//   node scripts/weirdo_cream_truck_orbit.mjs        (needs `npm run dev`)
//
// Stationary on purpose. The point of this capture is the CAB (the driver has to
// read as sitting in it, unclipped, from every angle) and the jump (which is
// what triggers the five-second chime), neither of which a driving shot shows
// well. The camera does the moving instead: one continuous revolution while the
// truck idles and hops in place.
//
// Frames are captured on a fixed schedule and encoded with the bundled ffmpeg,
// so the output is an MP4 plus a GIF with no external tooling.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { dismissEntryOverlays, enterOfflineGame } from './enter_offline_game.mjs';
import { FFMPEG_PATH } from './sfx/ffmpeg_paths.mjs';

const BASE = process.env.GAME_URL ?? 'http://localhost:5173';
// Ultra tier plus a high-DPI viewport: this is the "show me the graphics" pass,
// not a perf capture.
const URL = `${BASE}/?gfx=ultra`;
const OUT_DIR = process.env.OUT_DIR ?? 'docs/screenshots/weirdo-cream-truck/showcase';
const FRAME_DIR = 'tmp/weirdo_orbit_frames';
const FRAMES = Number(process.env.FRAMES ?? 120);
const FPS = 24;
/** Jump every this many frames, so several chimes land across the revolution. */
const JUMP_EVERY = 24;

fs.rmSync(FRAME_DIR, { recursive: true, force: true });
fs.mkdirSync(FRAME_DIR, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--window-size=1280,720',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--force-device-scale-factor=1',
    // Required wherever this runs as root (CI containers, the cloud session
    // box); Chromium refuses to start otherwise.
    '--no-sandbox',
  ],
  // deviceScaleFactor 1 on purpose: at 2 the compositor is asked for
  // 2560x1440 per frame, which SwiftShader could not deliver and CDP
  // answered with 'Unable to capture screenshot'.
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
page.on('pageerror', (error) => console.log('PAGEERROR:', error.message));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await page.goto(URL, { waitUntil: 'load', timeout: 240_000 });
// Use the shared entry rather than hand-driving the pre-game UI: it dismisses
// the three overlays that must never appear in a capture (intro logo, tutorial,
// and the camera-mode prompt). Hand-rolling this is exactly how the first pass
// ended up with the camera prompt sitting in the middle of all 120 frames.
// The timeouts are wide because software rendering makes world entry minutes.
await enterOfflineGame(page, {
  charClass: 'warrior',
  charName: 'Luffy',
  settleMs: 4000,
  gameBootTimeoutMs: 300_000,
  selectorTimeoutMs: 180_000,
});
await dismissEntryOverlays(page);

await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.setPlayerLevel(20, sim.playerId);
  sim.addItem('reins_weirdo_cream_truck', 1);
  // Riding is gated on the skill Marla sells for 80g; grant it on the meta
  // rather than walking the capture to the stables and through a purchase.
  const meta = sim.meta(sim.playerId);
  if (meta) meta.ridingTrained = true;
});
await sleep(500);

// Riding is an ITEM USE. This build deliberately has no selected mount and no
// picker (see src/world_api/mounts.ts): using the reins routes through
// summonMountItem, which starts a 1.5 SIM-second summon cast.
//
// That cast is why this wait is minutes rather than seconds. The sim advances
// with the render loop, so under software rendering the world runs roughly
// twenty times slower than wall clock: a 1.5s cast measured 0.5s of progress
// over 12s of real time. Re-issuing the use while a cast is in flight is
// swallowed by design (summonMountItem returns early), so only issue one when
// nothing is pending, which also self-corrects a click refused outright.
await page.waitForFunction(
  () => {
    const sim = window.__game.sim;
    const self = sim.entities.get(sim.playerId);
    if (self?.mountKey === 'weirdo_cream_truck') return true;
    if (!((self?.mountCastRemaining ?? 0) > 0)) sim.useItem('reins_weirdo_cream_truck');
    return false;
  },
  { timeout: 300_000, polling: 1000 },
);

// The mount GLB is lazyPreload: wait for the visual, not a fixed nap.
await page.waitForFunction(
  () => !!window.__game.renderer?.views?.get(window.__game.sim.playerId)?.mountVisual,
  { timeout: 120_000, polling: 300 },
);
await sleep(1500);

// Hide the HUD: this is an asset showcase, not a UI shot.
await page.evaluate(() => {
  const ui = document.querySelector('#ui');
  if (ui) ui.style.display = 'none';
  // The headless run has no GPU, so the client shows a software-rendering
  // warning with its own Dismiss button. Click it rather than guessing at a
  // class name (the first pass guessed three and matched none).
  for (const button of document.querySelectorAll('button')) {
    if (/dismiss/i.test(button.textContent || '')) button.click();
  }
});
await sleep(1200);

console.log(`capturing ${FRAMES} frames...`);
for (let frame = 0; frame < FRAMES; frame++) {
  const yaw = (frame / FRAMES) * Math.PI * 2;
  await page.evaluate((y) => {
    const input = window.__game.input;
    if (input) {
      input.camYaw = y;
      // POSITIVE looks DOWN here (src/game/input.ts: camPitch is positive
      // looking down, default 0.32). A negative value aims at empty sky, which
      // is what turned the first capture into 120 grey frames.
      input.camPitch = 0.22;
      // The truck is 4.9 long and 3.7 tall with the rider above that, so the
      // default chase distance crops it. 10 frames the whole vehicle plus the
      // driver (clamped 3..22 in input.ts).
      input.camDist = 10;
    }
  }, yaw);
  if (frame % JUMP_EVERY === 0) {
    await page.keyboard.down('Space');
    await sleep(60);
    await page.keyboard.up('Space');
  }
  await sleep(120);
  const framePath = path.join(FRAME_DIR, `f${String(frame).padStart(4, '0')}.png`);
  // One retry: under load the compositor occasionally cannot produce a frame in
  // time, and losing the whole capture to a single refusal is not worth it.
  try {
    await page.screenshot({ path: framePath });
  } catch {
    await sleep(1000);
    await page.screenshot({ path: framePath });
  }
}
await browser.close();
console.log('frames captured, encoding...');

const mp4 = path.join(OUT_DIR, 'orbit-ultra.mp4');
const gif = path.join(OUT_DIR, 'orbit-ultra.gif');
const palette = path.join(FRAME_DIR, 'palette.png');
const input = path.join(FRAME_DIR, 'f%04d.png');
const run = (args) => execFileSync(FFMPEG_PATH, args, { stdio: ['ignore', 'ignore', 'pipe'] });

run([
  '-hide_banner',
  '-loglevel',
  'error',
  '-y',
  '-framerate',
  String(FPS),
  '-i',
  input,
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  '-crf',
  '18',
  '-vf',
  'scale=trunc(iw/2)*2:trunc(ih/2)*2',
  mp4,
]);
run([
  '-hide_banner',
  '-loglevel',
  'error',
  '-y',
  '-i',
  input,
  '-vf',
  'fps=16,scale=720:-1:flags=lanczos,palettegen=stats_mode=diff',
  palette,
]);
run([
  '-hide_banner',
  '-loglevel',
  'error',
  '-y',
  '-framerate',
  String(FPS),
  '-i',
  input,
  '-i',
  palette,
  '-lavfi',
  'fps=16,scale=720:-1:flags=lanczos[x];[x][1:v]paletteuse',
  gif,
]);

console.log(`mp4: ${mp4} (${(fs.statSync(mp4).size / 1024).toFixed(0)} KB)`);
console.log(`gif: ${gif} (${(fs.statSync(gif).size / 1024).toFixed(0)} KB)`);
