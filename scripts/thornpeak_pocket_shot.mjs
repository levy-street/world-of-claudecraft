// Screenshot harness for the Thornpeak hillside pocket fix (player report:
// stuck at the minimap readout "-69, 631", west of the Highwatch practice
// row, /unstuck the only way out).
//
// Boots an offline paladin, sets them down in the pit at the foot of the
// sliver crest, and shoots them standing there with the chase camera looking
// due east (straight downhill toward the practice row). It then holds
// forward due east for three seconds of sim ticks, driven synchronously in
// one page.evaluate so the game's own frame loop cannot interleave, and
// shoots again. On the unfixed terrain the crest refuses every step and the
// paladin is still beside the boulder; on the graded hillside they are well
// down the slope. Logs the distance travelled.
//
// The decisive, deterministic proof is tests/thornpeak_hillside_pocket.test.ts;
// this script is the visual. Needs `npm run dev` on :5173 (override with
// GAME_URL). Writes tmp/thornpeak-pocket-<slug>-{stand,walk}.png.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const SLUG = process.env.SHOT_SLUG ?? 'after';
const PIT = { x: -68.4, z: 631.0 };
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

// Generous timeouts: a cold Vite compile of the whole client is slow under load.
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 180000 });
const booted = await enterOfflineGame(page, {
  charClass: 'paladin',
  charName: 'Chronicler',
  gameBootTimeoutMs: 180000,
  selectorTimeoutMs: 90000,
});
if (!booted) throw new Error('offline world did not boot');
await sleep(800);

function dismissPerfBanner() {
  return page.evaluate(() => {
    const dismiss = [...document.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Dismiss',
    );
    dismiss?.click();
    document.getElementById('tutorial-greeting')?.remove();
  });
}

// Chase view behind the paladin, looking due east down the hillside. The
// ground behind them rises about 0.7 per yard, so a pitch under ~0.6 puts
// the camera inside the slope and the paladin behind it.
function chaseCamEast() {
  return page.evaluate(() => {
    const inp = window.__game.input;
    inp.camYaw = Math.PI / 2;
    inp.camDist = 11;
    inp.camPitch = 0.9;
  });
}

async function settleAndShoot(name) {
  await dismissPerfBanner();
  await chaseCamEast();
  for (let i = 0; i < 12; i++) {
    await page.screenshot({ path: 'tmp/_frame.png' });
    await sleep(150);
  }
  await dismissPerfBanner();
  await page.screenshot({ path: `tmp/thornpeak-pocket-${SLUG}-${name}.png` });
}

// Set the paladin down in the pit, facing due east, and let them settle.
await page.evaluate((pit) => {
  const g = window.__game;
  g.sim.setPlayerLevel(20);
  const p = g.sim.player;
  const at = g.sim.groundPos(pit.x, pit.z);
  p.pos.x = at.x;
  p.pos.z = at.z;
  p.pos.y = at.y + 0.05;
  p.prevPos = { ...p.pos };
  p.fallStartY = p.pos.y;
  p.facing = Math.PI / 2; // +x, due east, straight downhill
  p.prevFacing = p.facing;
  p.vx = 0;
  p.vy = 0;
  p.vz = 0;
}, PIT);
await sleep(3000);
await settleAndShoot('stand');

// Three seconds of forward due east at tick precision.
const walk = await page.evaluate(() => {
  const g = window.__game;
  const p = g.sim.player;
  const sx = p.pos.x;
  const sz = p.pos.z;
  const mi = g.sim.moveInput;
  for (let i = 0; i < 60; i++) {
    Object.assign(mi, {
      forward: true,
      back: false,
      turnLeft: false,
      turnRight: false,
      strafeLeft: false,
      strafeRight: false,
      jump: false,
    });
    p.facing = Math.PI / 2;
    p.hp = p.maxHp;
    g.sim.tick();
  }
  mi.forward = false;
  return {
    from: [sx, sz],
    to: [p.pos.x, p.pos.z],
    moved: Math.hypot(p.pos.x - sx, p.pos.z - sz),
  };
});
await settleAndShoot('walk');
console.log(
  `RESULT slug=${SLUG} walked east from (${walk.from.map((v) => v.toFixed(1))}) to (${walk.to.map((v) => v.toFixed(1))}): ${walk.moved.toFixed(1)} yd in 3s`,
);
await browser.close();
