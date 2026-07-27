// Screenshot + proof harness for dungeon-interior parkour and the chapel's
// low roof: the raised boss dais you walk up and stand on, the coffin lids
// you mantle onto, the Sunken Bastion cargo stacks you grab-and-climb, and
// Eastbrook's chapel entry-hall roof. Same tick-precise driving as
// climb_stall_shot.mjs (headless paints too coarsely to steer by key events).
//
// Needs `npm run dev` (override port with GAME_URL). Writes to tmp/.
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
const booted = await enterOfflineGame(page, { charClass: 'warrior', charName: 'Delver' });
if (!booted) throw new Error('offline world did not boot');
await sleep(800);

async function frame() {
  await page.screenshot({ path: 'tmp/_frame.png' });
}

function cam(yaw, dist, pitch) {
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

// Enter a dungeon through the real dev flow (renderer builds the interior),
// then snap the instance origin to the slot grid (origins are 900 + 600*index
// in x and -1250 + 500*slot in z; the arrival point sits near local (0, 4)).
async function enterDungeon(id) {
  return page.evaluate((dungeonId) => {
    const g = window.__game;
    g.sim.setPlayerLevel(60);
    g.sim.chat(`/dev dungeon ${dungeonId}`);
    for (let i = 0; i < 10; i++) g.sim.tick();
    const p = g.sim.player;
    const ox = Math.round((p.pos.x - 900) / 600) * 600 + 900;
    const oz = Math.round((p.pos.z + 1250) / 500) * 500 - 1250;
    return { ox, oz, x: p.pos.x, z: p.pos.z };
  }, id);
}

// Teleport within the current region (instance or open world), settle, and
// drive the sim per the plan's input flags for `ticks`.
function drive(x, z, facing, plan) {
  return page.evaluate(
    ({ x, z, facing, plan }) => {
      const g = window.__game;
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
      if (x !== null) {
        p.pos.x = x;
        p.pos.z = z;
        p.pos.y += 12;
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
        for (let i = 0; i < 200 && !p.onGround; i++) {
          p.fallStartY = p.pos.y;
          Object.assign(g.sim.moveInput, idle);
          g.sim.tick();
        }
      }
      const out = [];
      for (const step of plan) {
        for (let i = 0; i < step.ticks; i++) {
          Object.assign(g.sim.moveInput, idle, {
            forward: !!step.forward,
            jump: !!step.jump,
          });
          if (step.freezeClimb && p.climb && p.climb.duration < 9000) {
            p.climb.duration = 9999;
          }
          g.sim.tick();
          if (step.stopOnClimb && p.climb) break;
          if (step.stopAboveY !== undefined && p.onGround && p.pos.y > step.stopAboveY) break;
        }
        out.push({
          x: +p.pos.x.toFixed(2),
          y: +p.pos.y.toFixed(2),
          z: +p.pos.z.toFixed(2),
          onGround: p.onGround,
          climbing: !!p.climb,
        });
      }
      Object.assign(g.sim.moveInput, idle);
      return out;
    },
    { x, z, facing, plan },
  );
}

function setClimbPhase(t) {
  return page.evaluate((phase) => {
    const p = window.__game.sim.player;
    if (p.climb) p.climb.elapsed = phase * p.climb.duration;
  }, t);
}

function finishClimb() {
  return page.evaluate(() => {
    const p = window.__game.sim.player;
    if (p.climb) {
      p.climb.duration = 0.4;
      p.climb.elapsed = 0.39;
    }
  });
}

async function shoot(slug) {
  await frame();
  await sleep(80);
  await page.screenshot({ path: `tmp/${slug}.png` });
}

const results = {};

// --- Scene 1: the Hollow Crypt boss dais + a coffin lid ---------------------
{
  const inst = await enterDungeon('hollow_crypt');
  console.log('hollow_crypt origin', JSON.stringify(inst));
  await sleep(2500); // let the interior mesh + lights build
  // Walk up the dais rim from the south (dais local (0, 96), r 9.5).
  const walk = await drive(inst.ox, inst.oz + 84, 0, [{ forward: true, ticks: 50 }]);
  console.log('dais walk:', JSON.stringify(walk));
  await cam(0.7, 7, 0.35);
  await shoot('dungeon-dais-standing');
  results.dais = walk[0].onGround && walk[0].y > 0.5;

  // Mantle onto the first coffin (tomb slot (-19, 16)), approaching from the
  // aisle side, the same geometry tests/dungeon_parkour.test.ts pins.
  const lid = await drive(inst.ox - 19 + 3.2, inst.oz + 16, -Math.PI / 2, [
    { forward: true, jump: true, ticks: 90, stopAboveY: 1.0 },
  ]);
  console.log('coffin:', JSON.stringify(lid));
  await cam(-2.3, 5, 0.2);
  await shoot('dungeon-coffin-standing');
  results.coffin = lid[0].onGround && lid[0].y > 1.0;
}

// --- Scene 2: the Sunken Bastion cargo stack climb ---------------------------
{
  const inst = await enterDungeon('sunken_bastion');
  console.log('sunken_bastion origin', JSON.stringify(inst));
  await sleep(2500);
  // The cargo stack is a two-tier staircase now: vault the broad lower tier,
  // stride onto the top crate. Stop the drive the moment the body stands on
  // the top so it does not run off the far side.
  const up = await drive(inst.ox - 19, inst.oz + 16 - 1 - 1.0 - 1.5, 0, [
    { forward: true, jump: true, ticks: 120, stopAboveY: 2.0 },
  ]);
  console.log('cargo up:', JSON.stringify(up));
  await cam(0.85, 6, 0.25);
  await shoot('dungeon-cargo-standing');
  results.cargo = up[0].onGround && up[0].y > 2.0;
}

// --- Scene 3: Eastbrook chapel entry-hall roof -------------------------------
{
  // Leave the instance by teleporting home (open world), then climb the hall
  // roof from the chapel's front (+z local edge rotated by 0.9).
  const rot = 0.9;
  const frontDirX = Math.sin(rot);
  const frontDirZ = Math.cos(rot);
  const hallX = -16 + frontDirX * (7 / 2 - 1.62);
  const hallZ = -8 + frontDirZ * (7 / 2 - 1.62);
  const startX = -16 + frontDirX * (7 / 2 + 1.7);
  const startZ = -8 + frontDirZ * (7 / 2 + 1.7);
  const facing = Math.atan2(hallX - startX, hallZ - startZ);
  const arm = await drive(startX, startZ, facing, [
    { forward: true, jump: true, ticks: 90, stopOnClimb: true, freezeClimb: true },
  ]);
  console.log('chapel arm:', JSON.stringify(arm));
  if (arm[0].climbing) {
    await page.evaluate(() => {
      const p = window.__game.sim.player;
      if (p.climb && p.climb.duration < 9000) p.climb.duration = 9999;
    });
    await cam(facing + 0.8, 5.5, 0.2);
    await setClimbPhase(0.16);
    await shoot('chapel-roof-reach');
    await finishClimb();
    const done = await drive(null, 0, 0, [{ ticks: 10 }]);
    console.log('chapel done:', JSON.stringify(done));
    await cam(facing + 0.8, 8, 0.35);
    await shoot('chapel-roof-standing');
    results.chapel = done[0].onGround && done[0].y > 2.5;
  } else {
    results.chapel = false;
  }
}

// --- Scene 4: ruin stump beside the Hollow Crypt delve ruins -----------------
{
  // Ring (-5,-60) r8: column i=2 is a 2.11-tall broken stump at (1.93, -64).
  // Standing on it must NOT vanish it (hideables register their real height).
  const arm = await drive(1.93, -64 - 1.1 - 1.5, 0, [
    { forward: true, jump: true, ticks: 120, stopAboveY: 1.6 },
  ]);
  console.log('stump:', JSON.stringify(arm));
  await cam(0.8, 5.5, 0.3);
  await shoot('ruin-stump-standing');
  results.stump = arm[0].onGround && arm[0].y > 1.6;
}

console.log(`RESULT ${JSON.stringify(results)}`);
await browser.close();
const ok = results.dais && results.coffin && results.cargo && results.chapel && results.stump;
process.exit(ok ? 0 : 1);
