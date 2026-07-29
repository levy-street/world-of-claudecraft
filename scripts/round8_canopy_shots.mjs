// Round-8 canopy-detail verification captures: pine forest against a hillside
// (the flat-cone repro), a close pine-tier read, the vale mixed treeline, and
// a broadleaf close-up. Modeled on scripts/round7_surface_shots.mjs (real GPU
// via ANGLE, shared enterOfflineGame entry, teleport by writing sim.player.pos).
//
// Needs `npm run dev -- --port 5184 --strictPort` running.
// Usage: node scripts/round8_canopy_shots.mjs
// Env:   GAME_URL (default http://localhost:5184), SHOT_OUT (default
//        tmp/round8-shots), SHOT_LABEL (prefix, e.g. before/after),
//        SHOT_ONLY (comma-separated names)
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const BASE_URL = process.env.GAME_URL ?? 'http://localhost:5184';
const OUT = process.env.SHOT_OUT ?? 'tmp/round8-shots';
const LABEL = process.env.SHOT_LABEL ?? 'shot';
fs.mkdirSync(OUT, { recursive: true });

const LAUNCH_ARGS = [
  '--window-size=1600,900',
  '--ignore-gpu-blocklist',
  '--enable-gpu-rasterization',
  '--use-gl=angle',
  '--use-angle=gl',
  '--enable-webgl',
  '--no-sandbox',
];

// Camera convention (render/renderer.ts updateCamera): ahead in frame lies at
// bearing (sin yaw, cos yaw); positive pitch lifts the camera and looks down.
// Vantages scouted from generateDecorations(20061) pine/oak density cells.
const SHOTS = [
  // The vale pine belt at (50-120, ~150) against its +z hillside: several
  // pines overlapping a rising slope, the user's flat-cone repro.
  { name: 'pine_forest', x: 85, z: 112, yaw: 0.15, pitch: -0.06, dist: 16 },
  // Close pine-tier read: individual tiers should read as needle clumps.
  { name: 'pine_close', x: 89, z: 140, yaw: 0.2, pitch: 0.04, dist: 7 },
  // Vale mixed treeline (oaks + pines + bushes) from the foliage-lod vantage.
  { name: 'vale_treeline', x: 40, z: -40, yaw: Math.PI, pitch: -0.08, dist: 14 },
  // Jungle broadleaf cluster on a rising slope: oak-lobe read.
  { name: 'broadleaf_close', x: -215, z: 718, yaw: 1.35, pitch: 0.02, dist: 9 },
];

const ONLY = process.env.SHOT_ONLY ? process.env.SHOT_ONLY.split(',') : null;
const ACTIVE = SHOTS.filter((s) => !ONLY || ONLY.includes(s.name));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const notes = [];
const errors = [];

async function waitForWorldVisible(page, label, timeoutMs = 90000) {
  const t0 = Date.now();
  const up = () =>
    page
      .evaluate(() =>
        Boolean(document.querySelector('#loading-screen')?.classList.contains('visible')),
      )
      .catch(() => false);
  if (!(await up())) return;
  while (Date.now() - t0 < timeoutMs) {
    await sleep(1000);
    if (!(await up())) break;
  }
  notes.push(`[${label}] loader up ${(Date.now() - t0) / 1000}s`);
  await sleep(6000);
}

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: LAUNCH_ARGS,
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('CONSOLE: ' + m.text());
});
await page.evaluateOnNewDocument(() => {
  localStorage.setItem(
    'woc_settings',
    JSON.stringify({
      graphicsPreset: 5,
      terrainDetail: 1,
      foliageDensity: 1,
      effectsQuality: 1,
      shadowQuality: 1,
      renderScale: 1,
      browserEffects: 1,
    }),
  );
});
await page.goto(`${BASE_URL}?gfx=ultra`, { waitUntil: 'domcontentloaded', timeout: 120000 });

const enter = async () => {
  await enterOfflineGame(page, {
    charClass: 'warrior',
    charName: 'Canopy',
    settleMs: 2500,
    gameBootTimeoutMs: 120000,
  });
  await page.waitForFunction(() => Boolean(window.__game?.sim?.player), { timeout: 120000 });
};
const ensureGame = async () => {
  const alive = await page.evaluate(() => Boolean(window.__game?.sim?.player)).catch(() => false);
  if (alive) return false;
  await enter();
  return true;
};
await enter();

for (const shot of [...ACTIVE]) {
  await ensureGame();
  await page.evaluate((p) => {
    const g = window.__game;
    const player = g.sim.player;
    player.gm = true;
    player.hp = player.maxHp;
    player.pos.x = p.x;
    player.pos.z = p.z;
    player.facing = p.yaw;
    g.input.camYaw = p.yaw;
    g.input.camPitch = p.pitch;
    g.input.camDist = p.dist;
    g.renderer.camDist = p.dist;
  }, shot);
  notes.push(`[${shot.name}] at ${shot.x}, ${shot.z}`);
  await sleep(12000);
  await waitForWorldVisible(page, shot.name);
  if (await ensureGame()) {
    notes.push(`[${shot.name}] reloaded mid-shot, retrying once`);
    ACTIVE.push({ ...shot });
    continue;
  }
  await page.screenshot({ path: `${OUT}/${LABEL}_${shot.name}.png` });
  console.log(`${LABEL}_${shot.name}`.padEnd(28) + 'captured');
}

await browser.close();
console.log('\nnotes:\n' + notes.join('\n'));
if (errors.length) console.log('\nerrors (first 10):\n' + errors.slice(0, 10).join('\n'));
