// Before/after proof for the mounted "silent dismount running into ordinary
// terrain" bug: a ground mount running toward an UNDECLARED deep-water pocket
// (open sea the generator carved below swim depth, outside every authored
// lake's footprint, so it never got a lake's graded shore) used to get shoved
// through the raw terrain wall at its edge by the standoffPass wall-clearance
// nudge and force-dismounted, with no error toast and often no visible water
// at all. Boots the offline game, teleports a mounted rider to the exact
// live-seed coordinate the bug reproduces at, and drives a few real sim ticks
// of forward movement through the sim's own move input (headless painting is
// too coarse to steer by key events at this precision).
//
// Needs `npm run dev` on :5173 (override with GAME_URL). Writes to tmp/.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.SHOT_PREFIX ?? 'tmp/mount_water_wall';
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

// Standing capture rule: seed the lowest graphics preset before boot (this is
// a gameplay/physics proof, not a graphics comparison).
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
  } catch {
    /* ignore */
  }
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
const booted = await enterOfflineGame(page, { charClass: 'warrior', charName: 'Rider' });
if (!booted) throw new Error('offline world did not boot');
await sleep(800);

async function frame() {
  await page.screenshot({ path: 'tmp/_frame.png' });
}

// Teleport a mounted rider to the undeclared-pocket shore and drive N real
// sim ticks of forward movement, returning the trajectory + final state.
function runAtPocket(x, z, facing, ticks) {
  return page.evaluate(
    ({ x, z, facing, ticks }) => {
      const g = window.__game;
      const sim = g.sim;
      sim.setPlayerLevel(60);
      sim.addItem('reins_grag_bear', 1);
      const meta = sim.players.get(sim.playerId);
      if (meta) meta.ridingTrained = true;
      const p = sim.player;
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
      p.pos.y += 20;
      p.prevPos = { ...p.pos };
      p.facing = facing;
      p.prevFacing = facing;
      p.vx = 0;
      p.vy = 0;
      p.vz = 0;
      p.onGround = false;
      p.jumping = false;
      p.mountKey = 'grag_bear';
      p.mountCastRemaining = 0;
      p.mountCastKey = '';
      // Settle the drop onto real terrain before driving the approach.
      for (let i = 0; i < 200 && !p.onGround; i++) {
        p.fallStartY = p.pos.y;
        Object.assign(sim.moveInput, idle);
        sim.tick();
      }
      p.mountKey = 'grag_bear'; // the fall/settle never dismounts, but pin it
      const path = [];
      for (let i = 0; i < ticks; i++) {
        Object.assign(sim.moveInput, { ...idle, forward: true });
        sim.tick();
        path.push({
          x: +p.pos.x.toFixed(2),
          y: +p.pos.y.toFixed(2),
          z: +p.pos.z.toFixed(2),
          onGround: p.onGround,
          mountKey: p.mountKey,
        });
      }
      Object.assign(sim.moveInput, idle);
      return { path, mountKey: p.mountKey, x: p.pos.x, z: p.pos.z };
    },
    { x, z, facing, ticks },
  );
}

// Undeclared deep-water pocket the sim's own world content places at the live
// WORLD_SEED (see the mount-dismount repro scan in the accompanying PR):
// starting 12yd out and running straight at it dismounts at tick 9 pre-fix.
const START = { x: -232.28654868376154, z: 400.8074666825723, facing: 5.585053606381854 };

await page.evaluate(() => {
  window.__game.input.camYaw = 3.5;
  window.__game.input.camDist = 6.5;
  window.__game.input.camPitch = 0.18;
});

// Settle + wait for the mount visual to actually be riding before either shot.
await runAtPocket(START.x, START.z, START.facing, 0);
await page.waitForFunction(
  () => !!window.__game.renderer?.views?.get(window.__game.sim.playerId)?.mountVisual,
  { timeout: 20000, polling: 300 },
);
await frame();
await sleep(80);
await page.screenshot({ path: `${OUT}-1-mounted-approach.png` });
console.log('mounted approach:', `${OUT}-1-mounted-approach.png`);

const after = await runAtPocket(START.x, START.z, START.facing, 30);
console.log('after 30 ticks:', JSON.stringify(after));
await frame();
await sleep(80);
await page.screenshot({ path: `${OUT}-2-result.png` });
console.log('result:', `${OUT}-2-result.png`);

console.log(
  'RESULT',
  JSON.stringify({ finalMountKey: after.mountKey, stillMounted: after.mountKey === 'grag_bear' }),
);

await browser.close();
