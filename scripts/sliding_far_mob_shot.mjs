// Repro for the sliding-far-mob bug: past the crowd-shrunk LOD band, a MOVING
// mob used to swap to the frozen idle-pose far mesh anyway (showsStaticFarMesh
// asked "how far", never "is it moving"), so it read as a statue gliding
// across the ground. Spawns a dense-enough crowd to shrink the frozen-mesh
// band well inside the uncrowded floor, then relocates one ALREADY-RENDERED
// wolf to 45yd (inside the crowd-shrunk band, outside the uncrowded floor)
// and keeps nudging its position every tick like real movement (oscillating
// in place, so it stays at ~45yd no matter how long the crowd takes to
// settle), then screenshots it. Also reads the renderer's own `v.isFar` flag
// for the target rig as ground truth, since a quadruped's idle stance and its
// mid-stride pose can look similar at thumbnail scale.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT_DIR = process.env.SHOTS_DIR ?? 'tmp/sliding_far_mob';
const OUT_NAME = process.env.OUT_NAME ?? 'shot';
const CROWD_TARGET = 48;
const WOLF_DIST = 45;
fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();

// Standing capture rule: seed the lowest graphics preset before boot. The
// crowd knee collapses farAnimRangeScale to exactly 1 at 48+ visible rigs
// regardless of tier, so this repro reproduces identically at any preset.
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
const booted = await enterOfflineGame(page, { charName: 'Statuecheck' });
if (!booted) {
  console.error('world never booted');
  await browser.close();
  process.exit(1);
}

const spawn = await page.evaluate(() => {
  const sim = window.__game.sim;
  const pid = sim.player.id;
  // Invincible: a horde of hostile wolves spawned adjacent to a level-1
  // warrior kills it in a couple of swings otherwise, which tears down this
  // whole staged scene (release-spirit screen, wolves scatter/despawn).
  sim.chat('/dev god', pid);
  // Dense crowd: /dev spawn is capped at 20 per call, so call it several
  // times to clear the 48-rig knee with margin (view construction is itself
  // budgeted per frame, so not every spawn is rendered yet by the time this
  // returns; the poll loop below waits for it).
  for (let i = 0; i < 6; i++) sim.chat('/dev spawn forest_wolf 20', pid);
  return { ok: true };
});
console.log('spawn:', JSON.stringify(spawn));

// Character-visual construction is budgeted per frame (compile-gated, see
// src/render/CLAUDE.md), so a freshly spawned crowd this large takes several
// seconds, not one settle delay, before visibleRigCount actually clears the
// 48-rig knee. Poll instead of guessing a fixed wait.
let visibleRigCount = 0;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 300));
  visibleRigCount = await page.evaluate(() => window.__game.renderer.lastVisibleRigCount);
  if (visibleRigCount >= CROWD_TARGET) break;
}
console.log('visibleRigCount settled at', visibleRigCount);
if (visibleRigCount < CROWD_TARGET) {
  console.warn(`WARNING: never reached the ${CROWD_TARGET}-rig knee (stuck at ${visibleRigCount})`);
}

// NOW pick the target: a forest_wolf that already has a rendered view (view
// creation lags entity creation by its own per-frame budget, so picking one
// before the crowd settles can pick one whose view never actually builds).
const setup = await page.evaluate((dist) => {
  const sim = window.__game.sim;
  const renderer = window.__game.renderer;
  const player = sim.player;
  let target = null;
  for (const [id, e] of sim.entities) {
    if (e.kind === 'mob' && e.templateId === 'forest_wolf' && renderer.views.has(id)) {
      target = id;
      break;
    }
  }
  if (target === null) return { ok: false, reason: 'no wolf with a rendered view' };

  // The spawned crowd sits in an arc centered on player.facing AT SPAWN TIME
  // (spawnMobsForDev), close and clustered. Turn to face the OPPOSITE way
  // before placing the target, so the crowd (still fully counted: visibility
  // is distance-based, not frustum-based) is behind the camera instead of
  // visually burying the one rig this shot is actually about.
  const angle = player.facing + Math.PI;
  player.facing = angle;
  // The camera's orbit yaw is independent state (window.__game.input.camYaw),
  // not derived from player.facing; point it the same way directly.
  window.__game.input.camYaw = angle;
  window.__game.renderer.camYaw = angle;
  const pos = sim.groundPos(
    player.pos.x + Math.sin(angle) * dist,
    player.pos.z + Math.cos(angle) * dist,
  );
  const e = sim.entities.get(target);
  e.pos = pos;
  e.prevPos = { ...pos };
  sim.rebucket(e);

  // Simulate real per-tick movement: nudge x/z and leave prevPos one step
  // behind, exactly the signal positionAdvancedThisTick reads. Oscillates in
  // place (a short pace back and forth) instead of walking off in one
  // direction, so the distance from the player stays close to `dist` no
  // matter how long the remaining settle takes before the shot.
  const perpAngle = angle + Math.PI / 2;
  let paceT = 0;
  window.__slideReproInterval = setInterval(() => {
    const ent = sim.entities.get(target);
    if (!ent) return;
    paceT += 0.12;
    const wobble = Math.sin(paceT) * 1.5;
    ent.prevPos = { ...ent.pos };
    ent.pos = {
      x: pos.x + Math.sin(perpAngle) * wobble,
      y: ent.pos.y,
      z: pos.z + Math.cos(perpAngle) * wobble,
    };
  }, 50);

  return { ok: true, targetId: target, wolfDistYd: dist };
}, WOLF_DIST);
console.log('setup:', JSON.stringify(setup));
if (!setup.ok) {
  console.error('setup failed:', setup.reason);
  await browser.close();
  process.exit(1);
}

// Let a handful of frames run so the relocated rig's LOD decision (and the
// oscillation) settle, and the camera's own follow/look-at lag catch up to
// the facing set above, before reading ground truth / screenshotting.
await new Promise((r) => setTimeout(r, 2500));

// One evaluate() computes BOTH the ground truth and the target's projected
// screen position (plain matrix math, no THREE import needed:
// camera.matrixWorldInverse/projectionMatrix are already built every frame),
// then screenshot immediately after with no further round trip, so the crop
// coordinates and ground truth describe the exact frame captured.
// (renderer.ts recomputes camera.fov every sync() for its own zoom/FOV-kick
// feel, so a one-time telephoto override on camera.fov does not hold; this
// crop-after-projecting stands in for it instead.)
const readout = await page.evaluate((wolfId) => {
  const renderer = window.__game.renderer;
  const sim = window.__game.sim;
  const cam = renderer.camera;
  const e = sim.entities.get(wolfId);
  const v = renderer.views.get(wolfId);
  const p = sim.player;
  const groundTruth = {
    hasView: !!v,
    isFar: v?.isFar ?? null,
    distYdFromPlayer: e ? Math.sqrt((e.pos.x - p.pos.x) ** 2 + (e.pos.z - p.pos.z) ** 2) : null,
    visibleRigCount: renderer.lastVisibleRigCount,
  };
  if (!e) return { groundTruth, projected: null };
  const wx = e.pos.x,
    wy = e.pos.y + 1.1,
    wz = e.pos.z;
  const pm = cam.projectionMatrix.elements;
  const vm = cam.matrixWorldInverse.elements;
  const combined = new Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += pm[row + k * 4] * vm[k + col * 4];
      combined[row + col * 4] = sum;
    }
  }
  const cx = combined[0] * wx + combined[4] * wy + combined[8] * wz + combined[12];
  const cy = combined[1] * wx + combined[5] * wy + combined[9] * wz + combined[13];
  const cw = combined[3] * wx + combined[7] * wy + combined[11] * wz + combined[15];
  const width = window.innerWidth;
  const height = window.innerHeight;
  const projected = {
    sx: Math.round((cx / cw / 2 + 0.5) * width),
    sy: Math.round((1 - (cy / cw / 2 + 0.5)) * height),
    inFront: cw > 0,
    width,
    height,
  };
  return { groundTruth, projected };
}, setup.targetId);
console.log('readout:', JSON.stringify(readout));
const { groundTruth, projected } = readout;

const path = `${OUT_DIR}/${OUT_NAME}.png`;
await page.screenshot({ path });
console.log('wrote', path);

// Crop tight around the target's projected screen position (verified against
// a debug marker while building this script) so the small, far rig reads
// clearly, standing in for a telephoto lens FOV writes cannot hold.
if (projected?.inFront) {
  const { execFileSync } = await import('node:child_process');
  const ffmpegPath = (await import('ffmpeg-static')).default;
  const cw = 200,
    ch = 180;
  const cx = Math.max(0, Math.min(projected.width - cw, projected.sx - cw / 2));
  const cy = Math.max(0, Math.min(projected.height - ch, projected.sy - ch / 2));
  const cropPath = `${OUT_DIR}/${OUT_NAME}-crop.png`;
  execFileSync(ffmpegPath, [
    '-y',
    '-i',
    path,
    '-vf',
    `crop=${cw}:${ch}:${cx}:${cy},scale=${cw * 4}:${ch * 4}:flags=neighbor`,
    '-update',
    '1',
    '-frames:v',
    '1',
    cropPath,
  ]);
  console.log('wrote', cropPath);
}

await page.evaluate(() => clearInterval(window.__slideReproInterval));
if (projected) fs.writeFileSync(`${OUT_DIR}/${OUT_NAME}.projected.json`, JSON.stringify(projected));
fs.writeFileSync(`${OUT_DIR}/${OUT_NAME}.ground_truth.json`, JSON.stringify(groundTruth));

await browser.close();
