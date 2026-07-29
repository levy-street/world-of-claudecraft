// Screenshot + proof harness for the ledge climb onto town roofs.
//
// Boots an offline warrior at MAX graphics, teleports them to Eastbrook's
// market stall, and drives a real run-and-jump through the sim's own move
// input at tick precision (headless paints too coarsely to steer by key
// events: five ticks pass per painted frame and the body slides around the
// stall between paints). The moment the sim arms the climb it stretches the
// live climb's duration so the pull can be stepped to exact phases (reach,
// pull, vault) for keeper frames, then lets it complete and captures the
// player STANDING on the canopy. A second pass does the same on the dock hut
// roof. Logs the sim numbers (grab target, landing height) as the physics
// proof next to the pixels.
//
// Needs `npm run dev` on :5173 (override with GAME_URL). Writes to tmp/.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

// Seed MAX graphics before the app boots so the renderer inits at preset 5.
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem(
      'woc_settings',
      JSON.stringify({ graphicsPreset: 5, terrainDetail: 1, effectsQuality: 1, shadowQuality: 1 }),
    );
  } catch {
    /* ignore */
  }
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
const booted = await enterOfflineGame(page, { charClass: 'warrior', charName: 'Scaler' });
if (!booted) throw new Error('offline world did not boot');
await sleep(800);

// One compositor frame: headless only paints when asked, and each paint runs
// the game loop (input read + up to 5 sim ticks + render). With no real keys
// held those ticks are idle, and a frozen climb barely advances, so forcing
// frames is safe at every capture point below. The discarded screenshot is
// the cheapest way to ask for a paint.
async function frame() {
  await page.screenshot({ path: 'tmp/_frame.png' });
}

// Teleport beside a roof facing it, settle onto the ground, then run-and-jump
// at it through the sim's own move input at tick precision until the climb
// arms. Freezes the armed climb (stretched duration) and returns the grab.
function teleportAndArm(x, z, facing) {
  return page.evaluate(
    ({ x, z, facing }) => {
      const g = window.__game;
      g.sim.setPlayerLevel(60); // roadside mobs must not decide a capture
      const p = g.sim.player;
      const idle = {
        forward: false,
        back: false,
        turnLeft: false,
        turnRight: false,
        strafeLeft: false,
        strafeRight: false,
        jump: false,
      };
      p.pos.x = x;
      p.pos.z = z;
      p.pos.y += 15;
      p.prevPos = { ...p.pos };
      p.fallStartY = p.pos.y;
      p.facing = facing;
      p.prevFacing = facing;
      p.vx = 0;
      p.vy = 0;
      p.vz = 0;
      p.onGround = false;
      p.jumping = false;
      p.climb = null;
      // Settle the drop; pin fallStartY so the teleport never counts as a fall.
      for (let i = 0; i < 200 && !p.onGround; i++) {
        p.fallStartY = p.pos.y;
        Object.assign(g.sim.moveInput, idle);
        g.sim.tick();
      }
      if (!p.onGround) return { error: 'never settled' };
      const groundY = +p.pos.y.toFixed(2);
      // Run at the roof, jumping continuously, until the sim grabs the ledge.
      for (let i = 0; i < 300 && !p.climb; i++) {
        Object.assign(g.sim.moveInput, { ...idle, forward: true, jump: true });
        g.sim.tick();
      }
      Object.assign(g.sim.moveInput, idle);
      if (!p.climb) {
        return {
          error: 'no climb armed',
          at: { x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2) },
        };
      }
      const real = p.climb.duration;
      p.climb.duration = 9999; // freeze phase; stepped explicitly below
      return {
        groundY,
        realDuration: real,
        from: {
          x: +p.climb.from.x.toFixed(2),
          y: +p.climb.from.y.toFixed(2),
          z: +p.climb.from.z.toFixed(2),
        },
        to: {
          x: +p.climb.to.x.toFixed(2),
          y: +p.climb.to.y.toFixed(2),
          z: +p.climb.to.z.toFixed(2),
        },
      };
    },
    { x, z, facing },
  );
}

// Step the frozen climb to an exact phase and paint it twice (the first frame
// moves the pose, the second is the keeper).
async function shootPhase(slug, phase) {
  await page.evaluate((t) => {
    const p = window.__game.sim.player;
    if (p.climb) p.climb.elapsed = t * p.climb.duration;
  }, phase);
  await frame();
  await sleep(80);
  await page.screenshot({ path: `tmp/${slug}.png` });
}

// Let the frozen climb complete and settle standing on the roof.
async function finishClimb(slug) {
  await page.evaluate(() => {
    const p = window.__game.sim.player;
    if (p.climb) {
      p.climb.duration = 0.4;
      p.climb.elapsed = 0.39;
    }
  });
  for (let i = 0; i < 8; i++) {
    await frame();
    await sleep(60);
  }
  const state = await page.evaluate(() => {
    const p = window.__game.sim.player;
    return { y: +p.pos.y.toFixed(2), onGround: p.onGround, climb: !!p.climb };
  });
  await page.screenshot({ path: `tmp/${slug}.png` });
  return state;
}

// Pull the chase camera into a close three-quarter view so the pull-up pose
// (hands planting, knees tucking) actually reads in the keepers.
function cinematicCam(yaw, dist, pitch) {
  return page.evaluate(
    ({ yaw, dist, pitch }) => {
      const inp = window.__game.input;
      inp.camYaw = yaw;
      inp.camDist = dist;
      inp.camPitch = pitch;
    },
    { yaw, dist, pitch },
  );
}

// The GPU-acceleration warning banner must not sit across the keepers; it can
// appear a while after boot, so dismiss right before shooting.
function dismissPerfBanner() {
  return page.evaluate(() => {
    const dismiss = [...document.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Dismiss',
    );
    dismiss?.click();
  });
}

async function captureRoof(name, spot) {
  console.log(`--- ${name} ---`);
  const armed = await teleportAndArm(spot.x, spot.z, spot.facing);
  if (armed.error) {
    console.log(`FAIL at ${name}:`, JSON.stringify(armed));
    return false;
  }
  console.log('climb armed:', JSON.stringify(armed));
  await dismissPerfBanner();
  await cinematicCam(spot.camYaw ?? 0.85, 5, 0.12);
  await frame(); // paint the frozen just-armed pose once before stepping
  await shootPhase(`climb-${name}-reach`, 0.14);
  await shootPhase(`climb-${name}-pull`, 0.45);
  await shootPhase(`climb-${name}-vault`, 0.8);
  await cinematicCam(spot.camYaw ?? 0.85, 8, 0.25);
  const done = await finishClimb(`climb-${name}-standing`);
  console.log('finished:', JSON.stringify(done));
  return done.onGround && !done.climb && done.y > armed.from.y + 0.8;
}

// Eastbrook market stall (zone1 content: x -8.5, z 3, r 1.7): approach from
// the south street (z -1.5 verified clear of the market furniture), canopy
// 2.45 above its ground. The cemetery cross and dock hut climbs are pinned by
// tests/climb.test.ts; on the live seed their surroundings (steep cemetery
// bank, sloped dock deck) make them poor camera subjects, so the stall is the
// showcase.
// The World Market rebuild stall at (-5.5, 9.5, rot 2.508844): approach its
// front face along the stall's local +z (the flat 2.7 canopy deck).
const stallOk = await captureRoof('stall', { x: -3.97, z: 7.4, facing: -0.63 });

console.log(`RESULT stall=${stallOk ? 'OK' : 'FAIL'}`);
await browser.close();
process.exit(stallOk ? 0 : 1);
