// Browser feel smoke: drives the real offline frame loop and asserts the
// movement/camera cases called out in community feedback.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from './browser_path.mjs';

const BASE_URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUTPUT = process.env.FEEL_OUT ?? path.join('tmp', `feel-smoke-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
const STEP_MS = Number(process.env.FEEL_STEP_MS ?? 180);
const SETTLE_MS = Number(process.env.FEEL_SETTLE_MS ?? 120);
const BOOT_TIMEOUT_MS = Number(process.env.FEEL_BOOT_TIMEOUT_MS ?? 120000);
const TICK_TIMEOUT_MS = Number(process.env.FEEL_TICK_TIMEOUT_MS ?? 60000);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function gameUrl() {
  const url = new URL(BASE_URL);
  url.searchParams.set('perf', '');
  return url.toString();
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

async function bootOffline(page) {
  await page.bringToFront();
  await page.setViewport({
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
  });
  await page.goto(gameUrl(), { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#btn-offline', { timeout: 30000 });
  await page.$eval('#btn-offline', (el) => el.click());
  await page.waitForSelector('#char-name', { timeout: 30000 });
  await page.$eval('#char-name', (el) => {
    el.value = 'Feelcheck';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.$eval('#offline-select .mini-class[data-class="warrior"]', (el) => el.click());
  await page.$eval('#btn-start-offline', (el) => el.click());
  await page.waitForFunction(
    () => Boolean(window.__game?.sim?.player && window.__game?.perf?.report),
    { timeout: BOOT_TIMEOUT_MS },
  );
  await page.evaluate(() => {
    const start = window.__game?.perf?.report?.().frames ?? 0;
    window.__feelStartFrames = start;
  });
  try {
    await page.waitForFunction(
      () => (window.__game?.perf?.report?.().frames ?? 0) >= (window.__feelStartFrames ?? 0) + 3,
      { timeout: 10000, polling: 100 },
    );
  } catch (err) {
    const debug = await page.evaluate(() => ({
      frames: window.__game?.perf?.report?.().frames ?? null,
      bodyClass: document.body.className,
      startDisplay: getComputedStyle(document.querySelector('#start-screen')).display,
      loadingClass: document.querySelector('#loading-screen')?.className ?? '',
      activeElement: document.activeElement?.id ?? document.activeElement?.tagName ?? '',
      modal: window.__game?.hud?.isModalOpen?.() ?? null,
      visibility: document.visibilityState,
    }));
    throw new Error(`Timed out waiting for active frame loop: ${JSON.stringify(debug)}`, { cause: err });
  }
  await sleep(SETTLE_MS);
  await waitForFrames(page, 1, 5000).catch(() => undefined);
  await page.evaluate(() => {
    const g = window.__game;
    g.input.camYaw = 0;
    g.input.camPitch = 0.32;
    g.renderer.camYaw = 0;
    g.renderer.camPitch = 0.32;
  });
  await sleep(20);
}

async function resetRig(page) {
  await page.evaluate(() => {
    const g = window.__game;
    const p = g.sim.player;
    const neutralMove = {
      forward: false,
      back: false,
      turnLeft: false,
      turnRight: false,
      strafeLeft: false,
      strafeRight: false,
      jump: false,
    };
    const placePlayer = (x, z) => {
      p.pos.x = x;
      p.pos.z = z;
      p.pos.y = g.sim.groundPos(x, z).y;
      p.prevPos = { ...p.pos };
      p.facing = 0;
      p.prevFacing = 0;
      p.vx = 0;
      p.vz = 0;
      p.vy = 0;
      p.onGround = true;
      p.fallStartY = p.pos.y;
      Object.assign(g.sim.moveInput, neutralMove);
    };
    const probeMove = (spot, move) => {
      placePlayer(spot.x, spot.z);
      Object.assign(g.sim.moveInput, neutralMove, move);
      g.sim.tick();
      const result = {
        dx: p.pos.x - spot.x,
        dz: p.pos.z - spot.z,
        airborne: !p.onGround,
        vx: p.vx,
        vz: p.vz,
      };
      placePlayer(spot.x, spot.z);
      return result;
    };
    const findFeelSpot = () => {
      for (let z = -90; z <= 120; z += 10) {
        for (let x = -60; x <= 60; x += 10) {
          const pos = g.sim.findSafePos(x, z, -3);
          if (Math.hypot(pos.x - x, pos.z - z) > 0.2) continue;
          const h = g.sim.groundPos(pos.x, pos.z).y;
          const probes = [
            [pos.x, pos.z + 3],
            [pos.x, pos.z - 3],
            [pos.x - 3, pos.z],
            [pos.x + 3, pos.z],
          ];
          let ok = true;
          for (const [px, pz] of probes) {
            const safe = g.sim.findSafePos(px, pz, -3);
            const ph = g.sim.groundPos(px, pz).y;
            if (Math.hypot(safe.x - px, safe.z - pz) > 0.2 || Math.abs(ph - h) > 2) {
              ok = false;
              break;
            }
          }
          if (!ok) continue;
          const f = probeMove(pos, { forward: true });
          const b = probeMove(pos, { back: true });
          const sr = probeMove(pos, { strafeRight: true });
          const j = probeMove(pos, { forward: true, jump: true });
          if (f.dz > 0.1 && b.dz < -0.04 && sr.dx < -0.1 && j.airborne && j.vz > 4) return pos;
        }
      }
      return { x: 0, z: -40 };
    };
    const spot = findFeelSpot();
    window.__feelSpot = spot;
    g.input.clearTouchMove();
    g.input.setTouchLook(false);
    g.input.setTouchLookVector({ x: 0, y: 0 });
    g.input.keys.clear();
    g.input.leftDown = false;
    g.input.rightDown = false;
    g.input.autorun = false;
    g.hud.closeAll();
    p.pos.x = spot.x;
    p.pos.z = spot.z;
    p.pos.y = g.sim.groundPos(spot.x, spot.z).y;
    p.prevPos = { ...p.pos };
    p.facing = 0;
    p.prevFacing = 0;
    p.vx = 0;
    p.vz = 0;
    p.vy = 0;
    p.onGround = true;
    p.fallStartY = p.pos.y;
    g.input.camYaw = 0;
    g.input.camPitch = 0.32;
    g.renderer.camYaw = 0;
    g.renderer.camPitch = 0.32;
  });
  await sleep(SETTLE_MS);
}

async function state(page) {
  return page.evaluate(() => {
    const g = window.__game;
    const p = g.sim.player;
    const r = g.perf.report();
    return {
      t: performance.now(),
      x: p.pos.x,
      y: p.pos.y,
      z: p.pos.z,
      facing: p.facing,
      vx: p.vx,
      vz: p.vz,
      vy: p.vy,
      onGround: p.onGround,
      camYaw: g.input.camYaw,
      move: g.input.readMoveInput(),
      suspended: g.input.suspendMovement,
      modal: g.hud.isModalOpen(),
      spot: window.__feelSpot ?? null,
      simTime: g.sim.time,
      tickCount: g.sim.tickCount,
      frames: r.frames,
      frameP95: r.windows?.last10s?.frameMs?.p95 ?? r.frameMs?.p95 ?? 0,
    };
  });
}

async function waitForFrames(page, count = 2, timeout = 15000) {
  const start = await page.evaluate(() => window.__game.perf.report().frames);
  await page.waitForFunction(
    ({ start, count }) => window.__game.perf.report().frames >= start + count,
    { timeout, polling: 50 },
    { start, count },
  );
}

async function waitForTicks(page, count = 1, timeout = TICK_TIMEOUT_MS) {
  const start = await page.evaluate(() => window.__game.sim.tickCount);
  await page.waitForFunction(
    ({ start, count }) => window.__game.sim.tickCount >= start + count,
    { timeout, polling: 50 },
    { start, count },
  );
}

async function setMove(page, move) {
  await page.evaluate((move) => window.__game.input.setTouchMove(move), move);
}

async function clearMove(page) {
  await page.evaluate(() => window.__game.input.clearTouchMove());
}

async function setMouselookYaw(page, yaw) {
  await page.evaluate((yaw) => {
    window.__game.input.camYaw = yaw;
    window.__game.input.setTouchLook(true);
    window.__game.input.setTouchLookVector({ x: 0, y: 0 });
  }, yaw);
}

async function runCheck(name, fn, checks) {
  try {
    const result = await fn();
    const failures = checks(result).filter(Boolean);
    return {
      name,
      ok: failures.length === 0,
      failures,
      result,
    };
  } catch (err) {
    return {
      name,
      ok: false,
      failures: [err instanceof Error ? err.message : String(err)],
      result: null,
    };
  }
}

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--window-size=1280,720',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});

const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (msg) => {
  if (msg.type() !== 'error') return;
  const text = msg.text();
  if (text.includes('/api/project-stats') || text.includes('project stats') || text.includes('502')) return;
  errors.push(`CONSOLE: ${text}`);
});

const checks = [];
try {
  await bootOffline(page);

  checks.push(await runCheck('forward input moves on the next short window', async () => {
    await resetRig(page);
    const before = await state(page);
    await setMove(page, { forward: true, back: false, strafeLeft: false, strafeRight: false });
    await waitForTicks(page);
    const after = await state(page);
    await clearMove(page);
    return { before, after, dz: after.z - before.z, elapsedMs: after.t - before.t };
  }, ({ dz, elapsedMs }) => [
    dz <= 0.25 ? `forward dz ${dz.toFixed(3)} <= 0.25 after ${finite(elapsedMs).toFixed(1)}ms` : '',
  ]));

  checks.push(await runCheck('reverse input changes direction without glide', async () => {
    await resetRig(page);
    await setMove(page, { forward: true, back: false, strafeLeft: false, strafeRight: false });
    await waitForTicks(page);
    const switchAt = await state(page);
    await setMove(page, { forward: false, back: true, strafeLeft: false, strafeRight: false });
    await waitForTicks(page);
    const after = await state(page);
    await clearMove(page);
    return { switchAt, after, dz: after.z - switchAt.z, elapsedMs: after.t - switchAt.t };
  }, ({ dz, elapsedMs }) => [
    dz >= -0.12 ? `reverse dz ${dz.toFixed(3)} >= -0.12 after ${finite(elapsedMs).toFixed(1)}ms` : '',
  ]));

  checks.push(await runCheck('mouselook 180 turns forward movement promptly', async () => {
    await resetRig(page);
    await setMouselookYaw(page, 0);
    await setMove(page, { forward: true, back: false, strafeLeft: false, strafeRight: false });
    await waitForTicks(page);
    const switchAt = await state(page);
    await setMouselookYaw(page, Math.PI);
    await waitForTicks(page);
    const after = await state(page);
    await clearMove(page);
    await page.evaluate(() => window.__game.input.setTouchLook(false));
    return {
      switchAt,
      after,
      dz: after.z - switchAt.z,
      facingDelta: Math.abs(Math.atan2(Math.sin(after.facing - Math.PI), Math.cos(after.facing - Math.PI))),
      elapsedMs: after.t - switchAt.t,
    };
  }, ({ dz, facingDelta, elapsedMs }) => [
    dz >= -0.2 ? `180 turn dz ${dz.toFixed(3)} >= -0.2 after ${finite(elapsedMs).toFixed(1)}ms` : '',
    facingDelta > 0.25 ? `facing stayed ${facingDelta.toFixed(3)}rad away from camera yaw` : '',
  ]));

  checks.push(await runCheck('airborne mouselook turns facing but preserves launch momentum', async () => {
    await resetRig(page);
    await setMouselookYaw(page, 0);
    await setMove(page, { forward: true, back: false, strafeLeft: false, strafeRight: false });
    await waitForTicks(page);
    await page.evaluate(() => window.__game.input.keys.add('Space'));
    await waitForTicks(page);
    await page.evaluate(() => window.__game.input.keys.delete('Space'));
    const airborne = await state(page);
    await setMouselookYaw(page, Math.PI);
    await waitForFrames(page, 1);
    const after = await state(page);
    await clearMove(page);
    await page.evaluate(() => window.__game.input.setTouchLook(false));
    return {
      airborne,
      after,
      dz: after.z - airborne.z,
      launchVz: airborne.vz,
      facingDelta: Math.abs(Math.atan2(Math.sin(after.facing - Math.PI), Math.cos(after.facing - Math.PI))),
      elapsedMs: after.t - airborne.t,
    };
  }, ({ airborne, after, dz, launchVz, facingDelta, elapsedMs }) => [
    airborne.onGround ? 'player was not airborne at launch sample' : '',
    launchVz <= 4 ? `launch vz ${launchVz.toFixed(3)} <= 4` : '',
    dz <= 0.25 ? `airborne dz ${dz.toFixed(3)} <= 0.25 after ${finite(elapsedMs).toFixed(1)}ms` : '',
    facingDelta > 0.35 ? `airborne facing stayed ${facingDelta.toFixed(3)}rad away from camera yaw` : '',
  ]));

  checks.push(await runCheck('mouselook A/D maps to strafe instead of keyboard turn', async () => {
    await resetRig(page);
    await setMouselookYaw(page, 0);
    await page.evaluate(() => {
      const g = window.__game;
      g.input.keys.add('KeyD');
    });
    const before = await state(page);
    await waitForTicks(page);
    const after = await state(page);
    await page.evaluate(() => {
      const g = window.__game;
      g.input.keys.delete('KeyD');
      g.input.setTouchLook(false);
    });
    return { before, after, dx: after.x - before.x, facingDelta: Math.abs(after.facing - before.facing), elapsedMs: after.t - before.t };
  }, ({ dx, facingDelta, elapsedMs }) => [
    dx >= -0.25 ? `mouselook D dx ${dx.toFixed(3)} >= -0.25; expected screen-right/world -X` : '',
    facingDelta > 0.08 ? `mouselook D changed facing by ${facingDelta.toFixed(3)}rad over ${finite(elapsedMs).toFixed(1)}ms` : '',
  ]));
} finally {
  await browser.close();
}

const artifact = {
  generatedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  url: gameUrl(),
  stepMs: STEP_MS,
  settleMs: SETTLE_MS,
  tickTimeoutMs: TICK_TIMEOUT_MS,
  browserPath: BROWSER_PATH,
  checks,
  errors,
};
fs.writeFileSync(OUTPUT, `${JSON.stringify(artifact, null, 2)}\n`);

for (const check of checks) {
  const status = check.ok ? 'OK' : 'FAIL';
  console.log(`${status} ${check.name}`);
  if (!check.ok) {
    for (const failure of check.failures) console.log(`  ${failure}`);
  }
}
console.log(`wrote ${OUTPUT}`);

const failures = [
  ...errors,
  ...checks.flatMap((check) => check.failures.map((failure) => `${check.name}: ${failure}`)),
];
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
}
