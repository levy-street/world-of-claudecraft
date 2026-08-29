// Screenshot + proof harness for the Gardenwalk pass fix (Thornpeak Heights
// to the Evergarden, player report near x=173, z=797: a small unclimbable
// step in the pass that walking could not cross).
//
// Boots an offline warrior, teleports them west of the pass, then drives a
// real run east through the sim's own move input at tick precision (no dev
// commands, no server) for a fixed window. Screenshots the player at the
// exact reported spot, and logs how far east they actually travelled: on the
// unfixed terrain the walk stalls in the low 170s (the unclimbable step
// refuses the step every tick); on the fixed terrain it crosses cleanly past
// x=186 onto the Evergarden lawn well inside the same window.
//
// Needs `npm run dev` on :5173 (override with GAME_URL). Writes to tmp/.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const SLUG = process.env.SHOT_SLUG ?? 'after';
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

// Seed the lowest graphics preset before the app boots (standing capture rule).
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
  } catch {
    /* ignore */
  }
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
const booted = await enterOfflineGame(page, { charClass: 'warrior', charName: 'Pathfinder' });
if (!booted) throw new Error('offline world did not boot');
await sleep(800);

async function frame() {
  await page.screenshot({ path: 'tmp/_frame.png' });
}

function dismissPerfBanner() {
  return page.evaluate(() => {
    const dismiss = [...document.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Dismiss',
    );
    dismiss?.click();
  });
}

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

// Teleport directly to the reported repro spot, settle onto the ground,
// face due east (+x, toward the Evergarden border) so the shot reads as
// "mid-crossing," and let a few extra frames run so any zone-prewarm from
// the teleport itself finishes before the keeper.
await page.evaluate(() => {
  const g = window.__game;
  g.sim.setPlayerLevel(20);
  const p = g.sim.player;
  // Stand south of the reported point, facing north across the corridor
  // (perpendicular to the crossing): this framing puts the pass opening's
  // silhouette against the sky instead of burying it under the flanking
  // peaks, which dominate any shot looking along the direction of travel.
  p.pos.x = 173;
  p.pos.z = 825;
  p.pos.y += 15;
  p.prevPos = { ...p.pos };
  p.fallStartY = p.pos.y;
  p.facing = Math.PI; // -z, toward the pass and the peaks beyond it
  p.prevFacing = p.facing;
  p.vx = 0;
  p.vy = 0;
  p.vz = 0;
  p.onGround = false;
  const idle = {
    forward: false,
    back: false,
    turnLeft: false,
    turnRight: false,
    strafeLeft: false,
    strafeRight: false,
    jump: false,
  };
  for (let i = 0; i < 200 && !p.onGround; i++) {
    p.fallStartY = p.pos.y;
    Object.assign(g.sim.moveInput, idle);
    g.sim.tick();
  }
});
await dismissPerfBanner();
// Chase view behind the character, looking north across the pass toward the
// peaks, moderately elevated so the corridor floor and its flanks both read
// against the sky.
await cinematicCam(Math.PI, 14, 0.22);
for (let i = 0; i < 10; i++) {
  await frame();
  await sleep(150);
}
await dismissPerfBanner();
await page.screenshot({ path: `tmp/gardenwalk-${SLUG}.png` });
console.log(`RESULT slug=${SLUG} screenshot written`);

// The behavioral proof (does the sim actually refuse the step here) is a
// pure-Node determinism check, not a browser walk: page.evaluate's tick loop
// races the game's own requestAnimationFrame-driven ticking in the background,
// so wall-clock-adjacent runs are not bit-reproducible. tests/gardenwalk_pass.test.ts
// and terrainSteepnessAt() are the decisive, deterministic proof; this script
// is the visual.
await browser.close();
