// Verification + screenshot harness for "the FOV slider does not work".
//
// Repro: set cameraFov in the persisted settings (what the options-menu slider
// writes) to a wide value, boot the offline world, then read the LIVE
// THREE.PerspectiveCamera.fov after several rendered frames have run. Before the
// fix, updateCamera() recomputed the camera's FOV every frame from a hard-coded
// CAMERA_BASE_FOV (60) plus the camera-feel kicks, so the very next frame after
// setCameraFov(deg) applied the slider value it snapped straight back to ~60.
// After the fix, updateCamera reads the player's stored base FOV (this.baseFov,
// set by setCameraFov) instead of the constant, so the configured value holds.
//
// Needs a dev server (default :5173, override with GAME_URL). Writes a
// screenshot and a before/after numeric report to tmp/.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const TAG = process.env.SHOT_TAG ?? 'after';
const CONFIGURED_FOV = 100;
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE:', m.text());
});

// Seed the lowest graphics preset (standing capture rule) plus the setting under
// test: a wide cameraFov, exactly what the options-menu slider persists.
await page.evaluateOnNewDocument(`
  try {
    var s = JSON.parse(localStorage.getItem('woc_settings') || '{}');
    s.graphicsPreset = 1;
    s.graphicsDefaultApplied = true;
    s.cameraFov = ${CONFIGURED_FOV};
    localStorage.setItem('woc_settings', JSON.stringify(s));
  } catch {}
`);

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
const booted = await enterOfflineGame(page, { charName: 'Fovwyn', settleMs: 2500 });

// Sample the LIVE camera FOV right after entry (one frame in) and again after a
// further second of rendering (many more updateCamera frames), plus the setting
// actually persisted, so a snap-back shows up as fovAtEntry !== fovAfterFrames.
const readFov = () =>
  page.evaluate(() => {
    let settingCameraFov = null;
    try {
      settingCameraFov = JSON.parse(localStorage.getItem('woc_settings') || '{}').cameraFov ?? null;
    } catch {
      /* ignore */
    }
    return { settingCameraFov, liveFov: window.__game?.renderer?.camera?.fov ?? null };
  });

const fovAtEntry = await readFov();
await page.screenshot({ path: `tmp/fov-slider-${TAG}-1-entry.png` });
await sleep(1000);
const fovAfterFrames = await readFov();
await page.screenshot({ path: `tmp/fov-slider-${TAG}-2-settled.png` });

const report = {
  tag: TAG,
  booted,
  configuredFov: CONFIGURED_FOV,
  fovAtEntry,
  fovAfterFrames,
  // The regression: the live FOV should equal the configured setting and STAY
  // there across frames, never drift back toward the shipped default (60).
  checks: {
    matchesSettingAtEntry: Math.abs(fovAtEntry.liveFov - CONFIGURED_FOV) < 0.5,
    matchesSettingAfterFrames: Math.abs(fovAfterFrames.liveFov - CONFIGURED_FOV) < 0.5,
    heldSteady: Math.abs(fovAfterFrames.liveFov - fovAtEntry.liveFov) < 0.5,
  },
};
fs.writeFileSync(`tmp/fov-slider-${TAG}-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

await browser.close();
const ok = Object.values(report.checks).every(Boolean);
console.log(
  ok
    ? 'PASS: the FOV slider setting is honored and holds across frames.'
    : 'FAIL: the live camera FOV does not match the configured setting, see report.',
);
process.exit(ok ? 0 : 1);
