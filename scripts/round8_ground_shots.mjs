// Round-8 ground verification captures: the de-spotted combed grass, the
// per-layer sd-normalized ground parallax, and the grazing-smear fix.
// Shots: the user's high-angle close grass framing, a grazing grass shot
// (tussock relief), a high-angle path shot (dirt clod height), and a
// near-horizontal along-the-path shot (the smear repro framing).
// Modeled on scripts/round7_surface_shots.mjs (real GPU via ANGLE, shared
// enterOfflineGame entry, teleport by writing sim.player.pos).
//
// Needs `npm run dev -- --port 5185 --strictPort` running.
// Usage: node scripts/round8_ground_shots.mjs
// Env:   GAME_URL (default http://localhost:5185), SHOT_OUT (default
//        tmp/round8-shots), SHOT_ONLY (comma-separated names)
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const BASE_URL = process.env.GAME_URL ?? 'http://localhost:5185';
const OUT = process.env.SHOT_OUT ?? 'tmp/round8-shots';
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
const SHOTS = [
  // The user's screenshot framing: close grass, high angle, ~5-15yd.
  { name: 'grass_high', x: 15, z: 45, yaw: 1.0, pitch: 0.55, dist: 9 },
  { name: 'grass_close', x: 15, z: 45, yaw: 1.0, pitch: 0.35, dist: 6 },
  // Grazing grass: tussock relief from the normalized grass parallax.
  { name: 'grass_graze', x: 15, z: 45, yaw: 1.0, pitch: 0.04, dist: 4 },
  // The east road to the boars ((30,8) -> (55,12)): dirt clod height.
  { name: 'path_high', x: 40, z: 9.5, yaw: 1.41, pitch: 0.5, dist: 8 },
  // Near-horizontal along the path: the grazing-smear repro framing.
  { name: 'path_graze', x: 40, z: 9.5, yaw: 1.41, pitch: 0.03, dist: 4 },
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
    charName: 'Probe',
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
const spawn = await page.evaluate(() => ({
  x: window.__game.sim.player.pos.x,
  z: window.__game.sim.player.pos.z,
}));
notes.push(`spawn ${spawn.x.toFixed(1)}, ${spawn.z.toFixed(1)}`);

for (const shot of [...ACTIVE]) {
  await ensureGame();
  const placed = await page.evaluate(
    (p) => {
      const g = window.__game;
      const player = g.sim.player;
      player.gm = true;
      player.hp = player.maxHp;
      player.pos.x = p.x;
      player.pos.z = p.z;
      player.facing = p.yaw;
      g.input.camYaw = p.yaw;
      g.input.camPitch = p.pitch;
      g.input.camDist = p.dist ?? 12;
      g.renderer.camDist = p.dist ?? 12;
      return { ok: true, x: p.x, z: p.z, yaw: p.yaw };
    },
    { ...shot },
  );
  if (!placed.ok) {
    notes.push(`[${shot.name}] SKIPPED`);
    continue;
  }
  notes.push(`[${shot.name}] at ${placed.x.toFixed(1)}, ${placed.z.toFixed(1)}`);
  await sleep(12000);
  await waitForWorldVisible(page, shot.name);
  if (await ensureGame()) {
    notes.push(`[${shot.name}] reloaded mid-shot, retrying once`);
    ACTIVE.push({ ...shot });
    continue;
  }
  await page.screenshot({ path: `${OUT}/${shot.name}.png` });
  console.log(`${shot.name.padEnd(20)} captured`);
}

await browser.close();
console.log('\nnotes:\n' + notes.join('\n'));
if (errors.length) console.log('\nerrors (first 10):\n' + errors.slice(0, 10).join('\n'));
