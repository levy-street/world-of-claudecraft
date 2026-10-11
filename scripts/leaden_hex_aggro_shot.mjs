// Screenshot rig for the Leaden Hex premature-aggro fix (docs/screenshots/
// warlock-leaden-hex-aggro-timing/).
//
// applyLeadenHex (src/sim/combat/warlock_talents.ts) used to call
// ctx.enterCombat the instant a warlock's Gloom Bolt (shadow_bolt) cast
// COMPLETED, i.e. the moment the bolt launches, not the moment it lands
// (projectile flight is deferred via src/sim/projectile_travel.ts: ~0.2-1s
// depending on range). That aggroed an idle hostile mob (flipped aiState to
// 'chase', inCombat true) before the bolt had actually hit it. The fix
// removes those calls; dealDamage (src/sim/combat/damage.ts) now engages
// combat only when the bolt lands.
//
// This rig boots the OFFLINE client, levels a warlock to 20, grants the
// Leaden Hex row-8 talent (wlk_r8_curse_of_exhaustion), spawns an idle
// hostile forest_wolf at a fixed range, casts shadow_bolt at it, and steps
// the live sim so it can screenshot the exact moment the bolt is in flight
// (ctx.pendingProjectiles non-empty) with the SAME fixed camera every run.
// On the buggy code the target is already aiState 'chase' / inCombat at that
// moment; on the fixed code it is still idle until the bolt actually lands.
//
// Sim advancement: src/main.ts only ticks offlineSim inside its rAF frame()
// callback, and headless Chrome here never fires rAF on its own until
// something forces a paint (a plain real-time sleep with zero screenshots
// produces zero cast progress). Once ANY paint has been forced, rendering
// stays "awake" and offlineSim keeps ticking in the background across plain
// (non-screenshot) real-time waits too, just below real-time speed. So this
// rig forces a handful of throwaway paints up front (frame(), before
// anything is cast) purely to wake rendering and let the camera/view settle,
// then drives the cast and all its timing off cheap state polls
// (page.evaluate, no screenshot) and takes a screenshot only at the two
// moments it actually wants pixels for.
//
// Needs `npm run dev` on :5173 (override with GAME_URL). No server, no
// ALLOW_DEV_COMMANDS needed: offline /dev chat commands are not gated by
// that env var (see scripts/sliding_far_mob_shot.mjs).
//
// Usage: node scripts/leaden_hex_aggro_shot.mjs <out-prefix>
//   writes tmp/leaden_hex/<out-prefix>-mid-flight.png and, when the bolt
//   lands during the pump window, tmp/leaden_hex/<out-prefix>-post-impact.png
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT_DIR = process.env.SHOTS_DIR ?? 'tmp/leaden_hex';
const OUT_PREFIX = process.argv[2] ?? 'shot';
const MOB_DIST = 28; // yards, near shadow_bolt's 30yd range: a long flight (~1.1s) survives
// the screenshot capture's own real-time cost (empirically a couple of real
// seconds under this environment's CPU contention) without fully resolving
// mid-capture, unlike a short 10yd flight (~0.4s) which the capture alone
// can consume outright.
fs.mkdirSync(OUT_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--window-size=1600,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
  ],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

// Standing capture rule: seed the lowest graphics preset before boot.
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
  } catch {
    /* ignore */
  }
});

// domcontentloaded, not networkidle0: this build prewarms ~200 GLBs in the
// background right from page load, which under swiftshader can take far
// longer than the world itself needs to boot; waiting for that network to go
// idle before even starting the offline-game entry flow starved the actual
// boot-hook poll below of its timeout budget.
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
const booted = await enterOfflineGame(page, {
  charClass: 'warlock',
  charName: 'Hexcheck',
  gameBootTimeoutMs: 60000,
  settleMs: 500,
});
if (!booted) {
  console.error('world never booted');
  await browser.close();
  process.exit(1);
}

// One forced paint (a discarded screenshot): the game's rAF loop only ticks
// offlineSim and syncs the renderer inside its own callback, which headless
// Chrome does not fire on its own without a compositor consumer.
async function frame() {
  await page.screenshot({ path: `${OUT_DIR}/_pump.png` });
}

async function readState(mobId) {
  return page.evaluate((id) => {
    const sim = window.__game.sim;
    const mob = sim.entities.get(id);
    return {
      pending: sim.ctx.pendingProjectiles.length,
      aiState: mob?.aiState ?? null,
      inCombat: mob?.inCombat ?? null,
      mobPos: mob ? { x: +mob.pos.x.toFixed(2), z: +mob.pos.z.toFixed(2) } : null,
      playerInCombat: sim.player.inCombat,
      casting: !!sim.player.castingAbility,
    };
  }, mobId);
}

// Level to 20 (Leaden Hex / shadow_bolt availability, matches
// tests/warlock_class_talents.test.ts rig()), grant the row-8 Leaden Hex
// choice, make the player unkillable for the duration of the shot, spawn one
// idle forest_wolf and pull it out to a fixed range directly in front of the
// player, target it, aim the camera at both, and start the shadow_bolt cast.
//
// Deliberately ONE evaluate with NO forced-paint frame in between: an idle
// forest_wolf has its own ambient wander (src/sim/mob/ambient.ts) that, once
// real ticks start flowing (a forced paint), visibly relocates it tens of
// yards within a handful of ticks and can desync the staged distance/facing
// before the cast fires; casting inside the same synchronous evaluate as the
// setup keeps zero sim ticks between placing the mob and pressing the button.
const setup = await page.evaluate((dist) => {
  const sim = window.__game.sim;
  const input = window.__game.input;
  const pid = sim.player.id;
  sim.setPlayerLevel(20);
  const talented = sim.applyTalents({
    spec: 'destruction',
    rows: { 8: 'wlk_r8_curse_of_exhaustion' },
  });
  const player = sim.player;
  player.resource = player.maxResource;
  sim.chat('/dev god', pid);

  const before = new Set(sim.entities.keys());
  sim.chat('/dev spawn forest_wolf 1', pid);
  let mobId = null;
  for (const id of sim.entities.keys()) {
    if (!before.has(id)) {
      mobId = id;
      break;
    }
  }
  if (mobId === null) return { ok: false, reason: 'no wolf spawned', talented };
  const mob = sim.entities.get(mobId);
  mob.hostile = true;
  mob.aiState = 'idle';
  mob.inCombat = false;
  // Freeze the normal idle-wander (mob/locomotion.ts): an idle forest_wolf
  // ambles on its own timer, and once real ticks flow (this cast's own
  // forced-paint pump loop) that wander can close much of the staged
  // distance before the cast even completes, collapsing the bolt's
  // remaining flight to nothing by the time it lands. This is purely
  // positional hygiene: it does NOT touch aggro/chase (separate code path),
  // so the bug this rig demonstrates is unaffected.
  mob.wanderTimer = 9999;
  mob.wanderTarget = null;
  // A level-1/2 forest_wolf (the /dev-spawn level clamp keeps it in its own
  // template range regardless of player level) has ~40-68 hp and a single
  // shadow_bolt one-shots it, which turns the post-impact "now visibly
  // chasing" keeper into a death instead. Match tests/warlock_class_talents.test.ts's
  // addTarget() helper: pad hp so it survives to actually chase.
  mob.maxHp = mob.hp = 100000;

  const facing = 0;
  player.facing = facing;
  player.prevFacing = facing;
  const pos = sim.groundPos(
    player.pos.x + Math.sin(facing) * dist,
    player.pos.z + Math.cos(facing) * dist,
  );
  mob.pos = pos;
  mob.prevPos = { ...pos };
  sim.rebucket(mob);

  // Tight, steep-ish framing keeps both figures large and centered instead
  // of the wide vista (ocean/NPCs) a further-back camera picks up on the
  // small tutorial-island spawn.
  input.camYaw = facing;
  input.camDist = 22;
  input.camPitch = 0.3;

  sim.targetEntity(mobId, pid);

  return {
    ok: true,
    talented,
    mobId,
    playerPos: { x: +player.pos.x.toFixed(2), z: +player.pos.z.toFixed(2) },
    mobPos: { x: +mob.pos.x.toFixed(2), z: +mob.pos.z.toFixed(2) },
    aiStateBeforeCast: mob.aiState,
  };
}, MOB_DIST);
console.log('setup:', JSON.stringify(setup));
if (!setup.ok) {
  console.error('setup failed:', setup.reason);
  await browser.close();
  process.exit(1);
}
const mobId = setup.mobId;

function dismissPerfBanner() {
  return page.evaluate(() => {
    const dismiss = [...document.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Dismiss',
    );
    dismiss?.click();
  });
}

// Kick-start rendering BEFORE casting anything: the FIRST forced paint in a
// run wakes the dormant rAF loop, and that wake-up alone can silently
// swallow a couple of real seconds' worth of sim ticks (the paint's own
// capture time lets the now-awake background loop run for a while before it
// returns). Paying that unpredictable cost HERE, before the cast exists, is
// harmless (the mob is idle, wander-frozen, and out of its own aggro
// radius); paying it mid-cast is what previously caused the whole
// cast+flight+chase sequence to complete inside a single forced paint,
// jumping straight past the "still in flight" moment this rig exists to
// capture. A few kick-start paints also let the camera/view construction
// settle before anything moves.
for (let i = 0; i < 4; i++) {
  await frame();
  await sleep(400);
}
await dismissPerfBanner();

const preCastState = await readState(mobId);
console.log('pre-cast state (post kick-start):', JSON.stringify(preCastState));
if (preCastState.aiState !== 'idle' || preCastState.inCombat) {
  console.error('mob left idle before the cast even started:', JSON.stringify(preCastState));
  await browser.close();
  process.exit(1);
}

// Start the cast via a bare evaluate (no screenshot): once rendering is
// awake, background ticking free-runs at roughly 5 ticks per ~1-1.5 real
// seconds without any further forced paint, so from here on state is
// sampled with cheap polls, and a screenshot is taken only at the two
// moments this rig actually wants pixels.
const cast = await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.castAbility('shadow_bolt', sim.player.id);
  return { castingAbility: sim.player.castingAbility ?? null };
});
console.log('cast started:', JSON.stringify(cast));
if (cast.castingAbility !== 'shadow_bolt') {
  console.error('cast never started:', JSON.stringify(cast));
  await browser.close();
  process.exit(1);
}

// Cheap-poll (evaluate only, no screenshot) until the cast completes and the
// bolt actually launches (ctx.pendingProjectiles becomes non-empty) -- the
// exact moment onCastCompleted / applyLeadenHex fires. Up to ~20s of real
// polling: castTime is 1.7s of SIM time, but background ticking here runs
// well under real-time speed.
let boltLaunchState = await readState(mobId);
for (let i = 0; i < 120 && boltLaunchState.pending === 0 && boltLaunchState.casting; i++) {
  await sleep(200);
  boltLaunchState = await readState(mobId);
}
console.log('bolt-launch state:', JSON.stringify(boltLaunchState));
if (boltLaunchState.pending === 0) {
  console.error('bolt never launched (cast did not complete):', JSON.stringify(boltLaunchState));
  await browser.close();
  process.exit(1);
}

// The bolt is in flight right now (pending > 0): this IS the mid-flight
// moment. Screenshot immediately.
const midFlightPath = `${OUT_DIR}/${OUT_PREFIX}-mid-flight.png`;
await page.screenshot({ path: midFlightPath });
const midFlightState = await readState(mobId);
console.log('mid-flight state (post-screenshot readback):', JSON.stringify(midFlightState));
console.log('wrote', midFlightPath);

// Keep cheap-polling to also capture the post-impact frame (the optional
// "after-desktop-impact" keeper on the fixed branch): poll until the bolt
// resolves (pendingProjectiles back to 0).
let postImpactState = midFlightState;
for (let i = 0; i < 120 && postImpactState.pending > 0; i++) {
  await sleep(200);
  postImpactState = await readState(mobId);
}
if (postImpactState.pending === 0) {
  const postImpactPath = `${OUT_DIR}/${OUT_PREFIX}-post-impact.png`;
  await page.screenshot({ path: postImpactPath });
  console.log('post-impact state:', JSON.stringify(postImpactState));
  console.log('wrote', postImpactPath);
} else {
  console.warn('bolt never resolved within the poll window:', JSON.stringify(postImpactState));
}

fs.writeFileSync(
  `${OUT_DIR}/${OUT_PREFIX}.json`,
  JSON.stringify(
    { setup, preCastState, cast, boltLaunchState, midFlightState, postImpactState },
    null,
    2,
  ),
);
try {
  fs.unlinkSync(`${OUT_DIR}/_pump.png`);
} catch {
  /* ignore */
}

await browser.close();
