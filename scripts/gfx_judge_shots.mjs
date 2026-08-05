// Visual-judgement capture pass for the graphics overhaul: a portfolio of
// staged screenshots across every graphics tier, plus FPS at the scenic ultra
// locations so the perf story travels with the pictures.
//
// Same rules as scripts/gfx_ab_shot.mjs (read that first): real GPU via ANGLE,
// shared enterOfflineGame entry, pre-boot settings seeded with
// evaluateOnNewDocument, tier forced with ?gfx=<tier>, GM flag so camp mobs
// cannot interrupt a capture, teleport by writing sim.player.pos + input.cam*.
//
// Two things this adds over the A/B harness, both because it runs against a
// worktree that is being edited live:
//   - every shot re-checks window.__game and re-enters the world if a vite HMR
//     reload swallowed it, so one save mid-run costs one shot, not the run;
//   - the town and campfire shots are staged RELATIVE to the spawn point and to
//     fire lights found in the live scene, so they still frame something when
//     the map's absolute coordinates move under us.
//
// Needs `npm run dev -- --port 5173 --strictPort` running in another terminal.
// Usage:  node scripts/gfx_judge_shots.mjs
// Env:    GAME_URL (default http://localhost:5173), SHOT_OUT (default
//         tmp/gfx-photos), SHOT_ONLY (comma-separated names), SHOT_TIERS
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const BASE_URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.SHOT_OUT ?? 'tmp/gfx-photos';
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

// Camera convention (render/renderer.ts updateCamera): the camera sits at
// player - (sin yaw, cos yaw) * dist and looks through the player, so what is
// AHEAD in frame lies at bearing (sin yaw, cos yaw). camPitch clamps to
// [-0.4, 1.35]: POSITIVE lifts the camera and looks down, negative drops it and
// looks up (the skyline framing the A/B shots use). camDist clamps [3, 22].
//
// `at` picks the staging anchor: 'world' uses x/z as absolute coordinates,
// 'spawn' offsets them from the spawn point, 'fire' aims at the nearest warm
// point light (campfire/brazier) and ignores x/z.
const SHOTS = [
  // --- ultra: original-map scenic spots, matching tmp/gfx-ab/before_*.png ---
  { name: 'ultra_vale_meadow', tier: 'ultra', x: 20, z: 40, yaw: 0.6, pitch: -0.35, fps: true },
  { name: 'ultra_vale_lake', tier: 'ultra', x: -60, z: -80, yaw: 0.6, pitch: -0.35, fps: true },
  { name: 'ultra_marsh_rain', tier: 'ultra', x: 60, z: 360, yaw: 0.5, pitch: -0.3, fps: true },
  { name: 'ultra_peaks_snow', tier: 'ultra', x: 40, z: 720, yaw: 0.5, pitch: -0.25, fps: true },
  { name: 'ultra_eastbrook_town', tier: 'ultra', x: 13, z: 15, yaw: 2.45, pitch: -0.2, fps: true },

  // --- ultra: the player-style angles that exposed the card blackout -------
  { name: 'ultra_topdown_meadow', tier: 'ultra', x: 20, z: 40, yaw: 0.6, pitch: -0.62, fps: true },
  { name: 'ultra_road_closeup', tier: 'ultra', x: 2, z: 52, yaw: 0.4, pitch: -0.75, fps: true },

  // --- ultra: the eight new realms, each with its own sky + HDRI ----------
  { name: 'ultra_willowfen', tier: 'ultra', x: -360, z: 430, yaw: 0.6, pitch: -0.3, fps: true },
  { name: 'ultra_palmreach', tier: 'ultra', x: -360, z: 980, yaw: 0.6, pitch: -0.3, fps: true },
  { name: 'ultra_nightbloom', tier: 'ultra', x: -360, z: 1540, yaw: 0.6, pitch: -0.3, fps: true },
  { name: 'ultra_amberfall', tier: 'ultra', x: -360, z: 2100, yaw: 0.6, pitch: -0.3, fps: true },
  { name: 'ultra_galecrest', tier: 'ultra', x: 360, z: 440, yaw: 0.6, pitch: -0.3, fps: true },
  { name: 'ultra_evergarden', tier: 'ultra', x: 360, z: 980, yaw: 0.6, pitch: -0.3, fps: true },
  { name: 'ultra_drakelands', tier: 'ultra', x: 360, z: 2100, yaw: 0.6, pitch: -0.3, fps: true },
  { name: 'ultra_frostveil', tier: 'ultra', x: 0, z: 1700, yaw: 0.6, pitch: -0.3, fps: true },

  // --- ultra: emissive close-ups (staged off spawn / live fire lights) -----
  { name: 'ultra_town_windows', tier: 'ultra', at: 'fire', dist: 5, pitch: 0.05 },
  {
    name: 'ultra_town_square',
    tier: 'ultra',
    at: 'spawn',
    x: 0,
    z: 10,
    yaw: 3.1416,
    pitch: -0.18,
    dist: 14,
  },
  { name: 'ultra_town_wide', tier: 'ultra', at: 'fire', dist: 11, pitch: -0.15, back: 6 },

  // --- ultra: grass close work, including the two top-down player angles ---
  { name: 'ultra_grass_top', tier: 'ultra', x: 22, z: 44, yaw: 0.9, pitch: 1.0, dist: 4 },
  {
    name: 'ultra_grass_top_b',
    tier: 'ultra',
    x: 22,
    z: 44,
    yaw: 0.9,
    pitch: 1.0,
    dist: 4,
    reuse: true,
  },
  { name: 'ultra_grass_low', tier: 'ultra', x: 22, z: 44, yaw: 0.9, pitch: 0.1, dist: 5 },
  {
    name: 'ultra_ground_road',
    tier: 'ultra',
    at: 'spawn',
    x: 16,
    z: 1.6,
    yaw: 1.446,
    pitch: 0.22,
    dist: 5,
  },
  { name: 'ultra_ground_rock', tier: 'ultra', x: 30, z: 700, yaw: 0.5, pitch: 0.3, dist: 6 },

  // --- high: SMAA + bloom path ---------------------------------------------
  { name: 'high_town_windows', tier: 'high', at: 'fire', dist: 5, pitch: 0.05 },
  { name: 'high_nightbloom', tier: 'high', x: -360, z: 1540, yaw: 0.6, pitch: -0.3 },
  { name: 'high_vale_meadow', tier: 'high', x: 20, z: 40, yaw: 0.6, pitch: -0.35, fps: true },

  // --- medium: NO bloom, but the raised emissives still apply. The night
  // realm is the harshest test of that combination: bright emissives, dark
  // surround, nothing to soften the edge.
  { name: 'medium_town_windows', tier: 'medium', at: 'fire', dist: 5, pitch: 0.05 },
  { name: 'medium_nightbloom', tier: 'medium', x: -360, z: 1540, yaw: 0.6, pitch: -0.3, fps: true },
  { name: 'medium_topdown_meadow', tier: 'medium', x: 20, z: 40, yaw: 0.6, pitch: -0.62 },
  { name: 'medium_vale_meadow', tier: 'medium', x: 20, z: 40, yaw: 0.6, pitch: -0.35, fps: true },

  // --- low: Lambert path, sanity only --------------------------------------
  { name: 'low_vale_meadow', tier: 'low', x: 20, z: 40, yaw: 0.6, pitch: -0.35, fps: true },
  { name: 'low_nightbloom', tier: 'low', x: -360, z: 1540, yaw: 0.6, pitch: -0.3 },
  { name: 'low_town_windows', tier: 'low', at: 'fire', dist: 5, pitch: 0.05 },
];

const ONLY = process.env.SHOT_ONLY ? process.env.SHOT_ONLY.split(',') : null;
const TIERS = process.env.SHOT_TIERS
  ? process.env.SHOT_TIERS.split(',')
  : ['ultra', 'high', 'medium', 'low'];
const ACTIVE = SHOTS.filter((s) => TIERS.includes(s.tier)).filter(
  (s) => !ONLY || ONLY.includes(s.name),
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const samples = [];
const errors = [];
const notes = [];

// Blocks while the world loader is up, then gives the fade + first frames a
// moment. Returns the seconds spent waiting so a slow realm load is visible in
// the run notes rather than silently eating a capture.
async function waitForWorldVisible(page, label, timeoutMs = 90000) {
  const t0 = Date.now();
  const up = () =>
    page
      .evaluate(() =>
        Boolean(document.querySelector('#loading-screen')?.classList.contains('visible')),
      )
      .catch(() => false);
  if (!(await up())) return 0;
  while (Date.now() - t0 < timeoutMs) {
    await sleep(1000);
    if (!(await up())) break;
  }
  const waited = (Date.now() - t0) / 1000;
  notes.push(`[${label}] world loader was up for ${waited.toFixed(1)}s after the teleport`);
  // let the fade finish and the newly streamed realm draw a few clean frames
  await sleep(6000);
  return waited;
}

const SETTINGS_SEED = () => {
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
      showFps: true,
    }),
  );
  localStorage.setItem('woc_perf_overlay', JSON.stringify({ metrics: { gpu: true } }));
};

for (const tier of TIERS) {
  const shots = ACTIVE.filter((s) => s.tier === tier);
  if (!shots.length) continue;

  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: LAUNCH_ARGS,
    defaultViewport: { width: 1600, height: 900 },
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(`[${tier}] PAGEERROR: ` + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[${tier}] CONSOLE: ` + m.text());
  });

  // Preset 5 (Advanced) with every sub-knob at 1 leaves the tier defaults
  // untouched (gfx.ts only DOWNGRADES from the advanced hints), so each tier
  // renders its own shipped ceiling rather than a hand-nerfed variant.
  await page.evaluateOnNewDocument(SETTINGS_SEED);
  // domcontentloaded, NOT networkidle0: the new map streams assets continuously,
  // so waiting for an idle network burns the budget and leaves the pre-game UI
  // in a state the entry flow then fails to drive. The world-boot hook below is
  // the real readiness signal.
  await page.goto(`${BASE_URL}?gfx=${tier}`, { waitUntil: 'domcontentloaded', timeout: 120000 });

  let reloads = 0;
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
    reloads++;
    await enter();
    return true;
  };
  await enter();

  const spawn = await page.evaluate(() => ({
    x: window.__game.sim.player.pos.x,
    z: window.__game.sim.player.pos.z,
  }));
  notes.push(`[${tier}] spawn ${spawn.x.toFixed(1)}, ${spawn.z.toFixed(1)}`);

  for (const shot of shots) {
    if (!shot.reuse) {
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
          if (p.at === 'spawn') {
            x += p.spawnX;
            z += p.spawnZ;
          } else if (p.at === 'fire') {
            // Warm point lights are the campfire/brazier fire lights (props.ts
            // adds one per flame). Stand `back` metres from the closest one and
            // face it, so the shot frames a fire wherever the map put it.
            // Reset to spawn FIRST: "nearest" is relative to the player, and
            // after a realm tour that would anchor on a fire in whatever realm
            // the previous shot left us in, not on the town.
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
            if (!lights.length) return { ok: false, reason: 'no fire lights in scene' };
            lights.sort(
              (a, b) =>
                Math.hypot(a.x - player.pos.x, a.z - player.pos.z) -
                Math.hypot(b.x - player.pos.x, b.z - player.pos.z),
            );
            const fire = lights[0];
            const back = p.back ?? 3.5;
            // stand back along +x/+z diagonal from the fire, then look at it
            const ang = 2.2;
            x = fire.x + Math.sin(ang) * back;
            z = fire.z + Math.cos(ang) * back;
            yaw = Math.atan2(fire.x - x, fire.z - z);
            return applyPose();
            function applyPose() {
              player.pos.x = x;
              player.pos.z = z;
              player.facing = yaw;
              g.input.camYaw = yaw;
              g.input.camPitch = p.pitch;
              g.input.camDist = p.dist ?? 12;
              g.renderer.camDist = p.dist ?? 12;
              return { ok: true, x, z, yaw, fire: { x: fire.x, z: fire.z } };
            }
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
      notes.push(
        `[${shot.name}] at ${placed.x.toFixed(1)}, ${placed.z.toFixed(1)} yaw ${placed.yaw.toFixed(2)}` +
          (placed.fire ? ` fire ${placed.fire.x.toFixed(1)}, ${placed.fire.z.toFixed(1)}` : ''),
      );
      // A cross-map teleport streams terrain, foliage and a new sky/HDRI, and
      // those hitches pollute both the frame and the FPS window. 14s of settle
      // before the shutter (and before perf.reset) is what it takes for the
      // far realms; the near ones just idle for the remainder.
      await sleep(14000);
      // A far-realm jump can also raise the world loader over the top, and
      // window.__game survives that, so the game-alive check below cannot see
      // it: without this wait the shutter photographs the loading art and the
      // FPS window measures an empty scene. #loading-screen carries the
      // 'visible' class exactly while it is up (main.ts show/hideLoadingScreen).
      await waitForWorldVisible(page, shot.name);
    } else {
      // Wind/animation delta frame: same pose, 1.5s later.
      await sleep(1500);
    }

    // A reload between the teleport and the shutter would photograph the spawn
    // point instead of the staged pose: redo the shot rather than file a lie.
    if (await ensureGame()) {
      notes.push(`[${shot.name}] page reloaded mid-shot, retrying`);
      shots.push({ ...shot, reuse: false });
      continue;
    }

    if (shot.fps) {
      await page.evaluate(() => window.__game.perf.reset());
      await sleep(6000);
      if (await ensureGame()) {
        notes.push(`[${shot.name}] reloaded during FPS window, retrying`);
        shots.push({ ...shot, reuse: false });
        continue;
      }
      const s = await page.evaluate((name) => {
        const r = window.__game.perf.report();
        const rr = r.renderer;
        return {
          name,
          fps: r.fps,
          fps10s: r.windows?.last10s?.fps,
          frameP95: r.frameMs.p95,
          frameP99: r.frameMs.p99,
          long50: r.frameMs.long50,
          tier: rr?.tier,
          calls: rr?.calls,
          triangles: rr?.triangles,
        };
      }, shot.name);
      samples.push(s);
      console.log(
        `${s.name.padEnd(22)} fps=${s.fps} p95=${s.frameP95}ms long50=${s.long50} tier=${s.tier} calls=${s.calls} tris=${s.triangles}`,
      );
    }

    await page.screenshot({ path: `${OUT}/${shot.name}.png` });
    if (!shot.fps) console.log(`${shot.name.padEnd(22)} captured`);
  }
  notes.push(`[${tier}] reload recoveries: ${reloads}`);
  await browser.close();
}

fs.writeFileSync(`${OUT}/judge_fps.json`, JSON.stringify({ samples, notes }, null, 2));
console.log('\n' + notes.join('\n'));
console.log(`\nwrote ${OUT}/judge_fps.json`);
console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 20).join('\n') : 'no page errors');
