// Round-7 surface-detail verification captures: the Eastbrook keep (Grand
// Armoury), a town street, natural boulders (rock family), the Eldergleam
// giant trunk (landmark bark), the Last Keep bailey, and a forge close-up
// (Metal013 metalness). Grazing-angle variants exercise the deepened
// per-family parallax. Modeled on scripts/gfx_judge_shots.mjs (real GPU via
// ANGLE, shared enterOfflineGame entry, teleport by writing sim.player.pos).
//
// Needs `npm run dev -- --port 5182 --strictPort` running.
// Usage: node scripts/round7_surface_shots.mjs
// Env:   GAME_URL (default http://localhost:5182), SHOT_OUT (default
//        tmp/round7-shots), SHOT_ONLY (comma-separated names)
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const BASE_URL = process.env.GAME_URL ?? 'http://localhost:5182';
const OUT = process.env.SHOT_OUT ?? 'tmp/round7-shots';
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
  // The Grand Armoury keep at (17.5, -5.5): the flat-wall repro.
  { name: 'keep_front', x: 2, z: -6, yaw: Math.PI / 2, pitch: -0.18, dist: 16 },
  // Grazing along the keep's front face (x ~ 13, runs along z): parallax read.
  { name: 'keep_graze', x: 12.2, z: -13, yaw: 0.12, pitch: 0.05, dist: 4 },
  // Eastbrook street with the rebuilt service buildings + walls.
  { name: 'town_street', x: 13, z: 15, yaw: 2.45, pitch: -0.2, dist: 12 },
  // Natural boulders near the peaks: the rock family (no brick pattern).
  { name: 'boulder_close', x: 30, z: 700, yaw: 0.5, pitch: 0.3, dist: 6 },
  { name: 'boulder_graze', x: 30, z: 700, yaw: 0.5, pitch: 0.02, dist: 4 },
  // The Eldergleam great tree at (-40, 1026), scale 6.5: landmark bark.
  { name: 'great_tree_trunk', x: -33, z: 1020, yaw: -0.86, pitch: 0.15, dist: 8 },
  // The Last Keep bailey (khex/kcas masonry stays ashlar).
  { name: 'last_keep_street', x: 396, z: 2040, yaw: 2.24, pitch: -0.15, dist: 12 },
  // Forge / campfire close-up near spawn: metal family + IBL response.
  { name: 'metal_forge', at: 'fire', dist: 5, pitch: 0.05 },
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
      let x = p.x ?? 0;
      let z = p.z ?? 0;
      let yaw = p.yaw ?? 0;
      if (p.at === 'fire') {
        player.pos.x = p.spawnX;
        player.pos.z = p.spawnZ;
        const lights = [];
        g.renderer.scene.traverse((o) => {
          if (!o.isPointLight || o.intensity <= 0) return;
          if (!(o.color.r > o.color.g && o.color.g >= o.color.b)) return;
          const v = new o.position.constructor();
          o.getWorldPosition(v);
          lights.push(v);
        });
        if (!lights.length) return { ok: false, reason: 'no fire lights' };
        lights.sort(
          (a, b) =>
            Math.hypot(a.x - player.pos.x, a.z - player.pos.z) -
            Math.hypot(b.x - player.pos.x, b.z - player.pos.z),
        );
        const fire = lights[0];
        const back = p.back ?? 3.5;
        const ang = 2.2;
        x = fire.x + Math.sin(ang) * back;
        z = fire.z + Math.cos(ang) * back;
        yaw = Math.atan2(fire.x - x, fire.z - z);
      }
      player.pos.x = x;
      player.pos.z = z;
      player.facing = yaw;
      g.input.camYaw = yaw;
      g.input.camPitch = p.pitch;
      g.input.camDist = p.dist ?? 12;
      g.renderer.camDist = p.dist ?? 12;
      return { ok: true, x, z, yaw };
    },
    { ...shot, spawnX: spawn.x, spawnZ: spawn.z },
  );
  if (!placed.ok) {
    notes.push(`[${shot.name}] SKIPPED: ${placed.reason}`);
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
