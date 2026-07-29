// Proof shots for feature/fix-lod-far-view: characters past the articulated LOD
// band used to swap to their baked idle-pose mesh, so a distant runner slid along
// in a standing pose. The animated far band keeps the rig articulated (at a lower
// pose rate) out to ~75yd instead.
//
// The scene is built to make that readable in a STILL: five identical runners are
// parked at 40, 52, 62, 68 and 74yd from the player on open meadow ground and
// driven sideways every frame, so each is unambiguously mid-stride. Before the
// fix the three far runners stand in the idle pose while the two near ones
// stride; after it, all five stride.
//
// Framing aids (identical in both captures, so only the runners differ): a
// telephoto FOV override makes them legible without changing the distance the
// LOD reads (that is measured from the PLAYER, not the camera), the camera pitch
// auto-aims at the row, the local player is scaled down so the chase camera's
// own rig stays out of frame, and the 2D layers plus grass are hidden.
//
// Needs a dev client (default http://localhost:5173, override with GAME_URL).
// `?gfx=high` is forced because headless SwiftShader otherwise resolves the low
// tier, where this band is deliberately disabled.
//
// Usage: BROWSER_PATH=... SHOTS_DIR=tmp/lod LABEL=after node scripts/far_lod_anim_shot.mjs
//   DESKTOP_ONLY=1 / MOBILE_ONLY=1  run a single viewport pass
//   CLIP=x,y,w,h    crop both captures to the same region (see the logged bbox)
//
// The mobile pass is a scene shot only: the phone-class profiles keep the old
// straight-to-frozen far LOD on purpose (GFX.farCharacterAnimScale is 1 there,
// pinned in tests/gfx.test.ts), and the constrained view-creation budget does not
// reliably stage a five-rig row at 40 to 74yd inside the capture window.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const BASE = process.env.GAME_URL ?? 'http://localhost:5173';
const URL = `${BASE}/?gfx=high`;
const SHOTS_DIR = process.env.SHOTS_DIR ?? 'tmp/lod';
const LABEL = process.env.LABEL ?? 'after';
const DISTANCES = [40, 52, 62, 68, 74];
// Boar Meadow: open grazing ground east of Eastbrook, clear of town geometry.
const STAND = { x: 66, z: -18 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(SHOTS_DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--window-size=1600,1000',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
  ],
  defaultViewport: { width: 1600, height: 1000 },
});

// Phase 1: stage the player. Runs before the camera direction is read so the
// boom has a frame to settle behind the teleported player.
const STAGE = `
(function (stand) {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  document.getElementById('gpu-notice')?.remove();
  if (!window.__lodKeepHud) {
    for (const id of ['ui', 'nameplates']) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    }
  }
  p.gm = true;
  p.hp = p.maxHp;
  p.pos.x = stand.x;
  p.pos.z = stand.z;
  p.pos.y = sim.groundPos(stand.x, stand.z).y;
  p.prevPos = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
  p.facing = 0;
  // The chase camera sits behind the local rig; at telephoto that rig would fill
  // the frame, so shrink it out of the way (presentation-only scale).
  p.scale = 0.02;
  g.input.camYaw = 0;
  g.input.camPitch = 0.06;
  // Grass would occlude the row at telephoto; identical in both captures.
  g.renderer.foliage?.setGrassQuality?.(0);
})(${JSON.stringify(STAND)});
`;

// Phase 2: lay the row out along the camera's REAL forward axis (read from the
// live matrix, so no yaw convention is assumed), keep the runners moving so the
// renderer's locomotion picks the run clip, and auto-aim the pitch at the row.
// Re-asserted every frame because the mob AI keeps ticking underneath.
const DEMO = `
(function (distances) {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  const cam = g.renderer.camera;
  const Vec = Object.getPrototypeOf(cam.position).constructor;
  const m = cam.matrixWorld.elements;
  let fx = -m[8];
  let fz = -m[10];
  const flen = Math.hypot(fx, fz) || 1;
  fx /= flen;
  fz /= flen;
  const rx = fz;
  const rz = -fx;
  const at = { x: p.pos.x, z: p.pos.z };
  const ids = [...sim.entities.values()]
    .filter((e) => e.kind === 'mob' && !e.dead)
    .sort(
      (a, b) =>
        Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z) -
        Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z),
    )
    .slice(0, distances.length)
    .map((e) => e.id);
  window.__lodIds = ids;
  // Telephoto: the LOD band is measured from the player, so narrowing the lens
  // makes the far runners legible without moving them out of their band.
  if (!window.__lodNoTelephoto) {
    Object.defineProperty(cam, 'fov', { get: () => 14, set: () => {}, configurable: true });
    cam.updateProjectionMatrix();
  }
  const mid = [];
  let sweep = -1.5;
  let sweepDir = 1;
  const step = () => {
    // Ping-pong rather than wrap: a wrap teleports the runners sideways, which
    // the locomotion would read as one enormous velocity spike.
    sweep += sweepDir * 0.075;
    if (sweep > 1.5 || sweep < -1.5) sweepDir = -sweepDir;
    for (let i = 0; i < ids.length; i++) {
      const e = sim.entities.get(ids[i]);
      if (!e) continue;
      e.dead = false;
      e.hp = e.maxHp;
      e.hostile = false;
      e.templateId = 'vale_bandit';
      e.name = 'Vale Bandit';
      e.level = 6;
      e.scale = 1;
      e.wanderTimer = 9999;
      e.prevPos = { x: e.pos.x, y: e.pos.y, z: e.pos.z };
      const lateral = sweep + (i - (ids.length - 1) / 2) * 1.7;
      const x = at.x + fx * distances[i] + rx * lateral;
      const z = at.z + fz * distances[i] + rz * lateral;
      e.pos.x = x;
      e.pos.z = z;
      e.pos.y = sim.groundPos(x, z).y;
      e.facing = Math.atan2(rx, rz);
      e.targetId = null;
      if (i === Math.floor(ids.length / 2) + 1) {
        mid[0] = x;
        mid[1] = e.pos.y + 1;
        mid[2] = z;
      }
    }
    // Auto-aim: nudge the boom pitch until the middle runner sits mid-frame.
    if (mid.length === 3) {
      const v = new Vec(mid[0], mid[1], mid[2]);
      v.project(cam);
      if (Number.isFinite(v.y)) {
        g.input.camPitch = Math.max(-0.6, Math.min(1.2, g.input.camPitch - v.y * 0.05));
      }
      if (Number.isFinite(v.x)) g.input.camYaw += v.x * 0.03;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  return ids.length;
})(${JSON.stringify(DISTANCES)});
`;

// Screen bbox of the runners, so the capture can be cropped to the row.
const BBOX = `
(function () {
  const g = window.__game;
  const cam = g.renderer.camera;
  const Vec = Object.getPrototypeOf(cam.position).constructor;
  const w = window.innerWidth;
  const h = window.innerHeight;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of window.__lodIds ?? []) {
    const ent = g.sim.entities.get(id);
    if (!ent) continue;
    for (const dy of [0, 2.2]) {
      const v = new Vec(ent.pos.x, ent.pos.y + dy, ent.pos.z);
      v.project(cam);
      minX = Math.min(minX, ((v.x + 1) / 2) * w);
      maxX = Math.max(maxX, ((v.x + 1) / 2) * w);
      minY = Math.min(minY, ((1 - v.y) / 2) * h);
      maxY = Math.max(maxY, ((1 - v.y) / 2) * h);
    }
  }
  return {
    x: Math.round(minX),
    y: Math.round(minY),
    w: Math.round(maxX - minX),
    h: Math.round(maxY - minY),
  };
})();
`;

function parseClip(width, height) {
  if (!process.env.CLIP) return { x: 0, y: 0, width, height };
  const [x, y, w, h] = process.env.CLIP.split(',').map(Number);
  return { x, y, width: w, height: h };
}

async function shoot(page, name, clip) {
  await page.screenshot({ path: `${SHOTS_DIR}/${LABEL}-${name}.png`, clip });
  console.log(`wrote ${SHOTS_DIR}/${LABEL}-${name}.png`);
}

async function run(page, name, width, height, opts = {}) {
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
  await enterOfflineGame(page, { charClass: 'warrior', charName: 'Ranger', settleMs: 3500 });
  await page.evaluate(
    `window.__lodKeepHud = ${!!opts.keepHud}; window.__lodNoTelephoto = ${!!opts.noTelephoto};`,
  );
  await page.evaluate(STAGE);
  await sleep(1200);
  const placed = await page.evaluate(DEMO);
  await sleep(opts.settleMs ?? 5000);
  console.log(`${name} runners placed: ${placed}`);
  console.log(`${name} bbox: ${JSON.stringify(await page.evaluate(BBOX))}`);
  await shoot(page, name, parseClip(width, height));
}

// --- desktop ----------------------------------------------------------------
if (!process.env.MOBILE_ONLY) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log(`PAGEERROR: ${e.message}`));
  await run(page, 'desktop', 1600, 1000);
}

// --- mobile (landscape; the phone profiles opt OUT of the band by design, so
// this pair is the no-regression proof rather than a difference) -------------
if (!process.env.DESKTOP_ONLY) {
  const mob = await browser.newPage();
  mob.on('pageerror', (e) => console.log(`PAGEERROR: ${e.message}`));
  const cdp = await mob.createCDPSession();
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 844,
    height: 390,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await run(mob, 'mobile', 844, 390, { keepHud: true, settleMs: 9000 });
}

await browser.close();
