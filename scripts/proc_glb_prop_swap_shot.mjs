// Real in-game before/after captures for the "procedural to GLB prop swap" PR
// (crypt_ritual_circle, the delve module exit / surface exit / pressure plate /
// four rite shrine kinds, and the marsh root_wall dressing piece). Run once on
// the feature branch (AFTER) and once on the base branch (BEFORE) with the same
// SHOT_DIR-prefixed output so the pairs line up.
//
//   node scripts/proc_glb_prop_swap_shot.mjs
//
// Needs `npm run dev` (GAME_URL defaults to :5173).
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.SHOT_DIR ?? 'tmp/proc_glb_shots';
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 60000,
  args: [
    '--window-size=1280,760',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-crash-reporter',
    '--disable-breakpad',
    '--no-crash-upload',
  ],
  defaultViewport: { width: 1280, height: 760 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

// Pre-set the first-run flags the real client honors so the camera-mode-choice
// prompt never owns a frame; the tutorial popup is dismissed explicitly below.
await page.evaluateOnNewDocument(() => {
  try {
    window.localStorage.setItem('woc.cameraModePrompt.shown', '1');
  } catch {
    /* private mode: dismissed via click below instead */
  }
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await enterOfflineGame(page, { settleMs: 2500 });

// Belt-and-braces: dismiss the camera-mode prompt and skip-tutorial button if
// either still shows (e.g. localStorage write failed), and wait for the
// intro/logo fade overlay to be gone before any shot is taken.
await page.evaluate(() => {
  document.querySelector('.camera-prompt-confirm')?.click();
  for (const b of document.querySelectorAll('button')) {
    if (/skip tutorial/i.test(b.textContent ?? '')) b.click();
  }
});
await page
  .waitForFunction(
    () => {
      const fade = document.querySelector('#intro-fade, .intro-fade, .logo-fade');
      return (
        !fade || getComputedStyle(fade).display === 'none' || getComputedStyle(fade).opacity === '0'
      );
    },
    { timeout: 8000 },
  )
  .catch(() => {});
await sleep(500);

async function teleportAndFace(x, z, faceX, faceZ) {
  await page.evaluate(
    (x, z, faceX, faceZ) => {
      const w = window.__game.world;
      w.player.pos.x = x;
      w.player.pos.z = z;
      w.player.facing = Math.atan2(faceX - x, faceZ - z);
      window.__game.renderer?.snapCameraToPlayer?.();
    },
    x,
    z,
    faceX,
    faceZ,
  );
  await sleep(900);
}

async function shot(name) {
  // Re-verify no first-run overlay crept back before every capture.
  await page.evaluate(() => {
    document.querySelector('.camera-prompt-confirm')?.click();
    for (const b of document.querySelectorAll('button')) {
      if (/skip tutorial/i.test(b.textContent ?? '')) b.click();
    }
  });
  await sleep(300);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`shot ${name}`);
}

// --- crypt_ritual_circle: fixed overworld position (zone3.ts GROUND_PICKUPS) ---
await page.evaluate(() => {
  window.__game.sim.setPlayerLevel?.(25);
});
await teleportAndFace(68, 806, 68, 800);
await shot('crypt_ritual_circle');

// --- The Drowned Litany delve: module exit, surface exit, pressure plate,
// and the four rite shrine kinds all live in this module. ---
await page.evaluate(() => {
  const w = window.__game.world;
  w.player.level = 25;
  w.enterDelve('drowned_litany', 'normal');
});
await sleep(2500);

const found = await page.evaluate(() => {
  const w = window.__game.world;
  if (!w.delveRun) return null;
  const wanted = new Set([
    'delve_module_exit',
    'delve_surface_exit',
    'delve_pressure_plate',
    'delve_pressure_plate_triggered',
    // sluice_valve / grave_tablet / corpse_candle all render through the same
    // buildPressurePlate() GLB-backed builder as delve_pressure_plate.
    'delve_sluice_valve',
    'delve_sluice_valve_open',
    'delve_grave_tablet',
    'delve_grave_tablet_lit',
    'delve_corpse_candle',
    'delve_corpse_candle_lit',
    'delve_rite_shrine_bell',
    'delve_rite_shrine_candle',
    'delve_rite_shrine_reed',
    'delve_rite_shrine_skull',
  ]);
  const hits = {};
  for (const e of w.entities.values()) {
    if (e.templateId && wanted.has(e.templateId) && !(e.templateId in hits)) {
      hits[e.templateId] = { x: e.pos.x, z: e.pos.z };
    }
  }
  return { moduleId: w.delveRun.moduleId, px: w.player.pos.x, pz: w.player.pos.z, hits };
});
console.log('drowned_litany scan', JSON.stringify(found));

// The surface exit and the four rite shrines only spawn after the delve's
// boss (Sister Nhalia) dies (drowned_litany_rite.ts). Path to the boss apse
// and use the dev killtarget command (offline dev mode, gated by
// import.meta.env.DEV same as every other dev-command screenshot script) to
// clear her instantly rather than fighting a full encounter for a screenshot.
if (found) {
  await teleportAndFace(0, 68, 0, 72);
  const bossId = await page.evaluate(() => {
    const w = window.__game.world;
    for (const e of w.entities.values()) {
      if (
        e.templateId === 'sister_nhalia_drowned_canticle' ||
        e.mobId === 'sister_nhalia_drowned_canticle'
      ) {
        return e.id;
      }
    }
    return null;
  });
  console.log('boss id', bossId);
  if (bossId != null) {
    await page.evaluate((id) => {
      const w = window.__game.world;
      w.player.targetId = id;
    }, bossId);
    await sleep(300);
    await page.evaluate(() => window.__game.world.chat('/dev killtarget'));
    await sleep(3000);
  }
}

let postBoss = null;
if (found) {
  postBoss = await page.evaluate(() => {
    const w = window.__game.world;
    const wanted = new Set([
      'delve_surface_exit',
      'delve_rite_shrine_bell',
      'delve_rite_shrine_candle',
      'delve_rite_shrine_reed',
      'delve_rite_shrine_skull',
    ]);
    const hits = {};
    for (const e of w.entities.values()) {
      if (e.templateId && wanted.has(e.templateId) && !(e.templateId in hits)) {
        hits[e.templateId] = { x: e.pos.x, z: e.pos.z };
      }
    }
    return hits;
  });
  console.log('post-boss scan', JSON.stringify(postBoss));
  Object.assign(found.hits, postBoss);
}

if (found) {
  const labels = {
    delve_module_exit: 'delve_module_exit',
    delve_surface_exit: 'delve_surface_exit',
    delve_pressure_plate: 'delve_pressure_plate',
    delve_pressure_plate_triggered: 'delve_pressure_plate',
    delve_sluice_valve: 'delve_pressure_plate',
    delve_sluice_valve_open: 'delve_pressure_plate',
    delve_grave_tablet: 'delve_pressure_plate',
    delve_grave_tablet_lit: 'delve_pressure_plate',
    delve_corpse_candle: 'delve_pressure_plate',
    delve_corpse_candle_lit: 'delve_pressure_plate',
    delve_rite_shrine_bell: 'delve_rite_shrine_bell',
    delve_rite_shrine_candle: 'delve_rite_shrine_candle',
    delve_rite_shrine_reed: 'delve_rite_shrine_reed',
    delve_rite_shrine_skull: 'delve_rite_shrine_skull',
  };
  for (const [templateId, pos] of Object.entries(found.hits)) {
    const label = labels[templateId];
    // Approach from a few units back so the camera frames the prop, not the player's back.
    await teleportAndFace(pos.x, pos.z + 4, pos.x, pos.z);
    await shot(label);
  }
}

// --- marsh root_wall dressing anchor: sweep near the module origin (litany
// dressing anchors are module-local; deterministic per fixed seed). ---
if (found) {
  const rootWallSpots = [
    [0, 6],
    [10, 14],
    [-8, 18],
    [4, 26],
    [-14, 10],
    [12, -6],
  ];
  for (const [dx, dz] of rootWallSpots) {
    await teleportAndFace(found.px + dx, found.pz + dz, found.px, found.pz);
    // Not a scriptable visual identity check from here (procedural fallback and
    // GLB read identically to a screenshot diff); capture each candidate spot
    // once so a human can pick the frame that actually shows the root wall.
    await shot(`marsh_root_wall_candidate_${dx}_${dz}`);
  }
}

await page.close();
await browser.close();
if (errors.length) console.log('page errors:', errors.slice(0, 5).join('; '));
process.exit(0);
