// Context screenshot for the Saintless Hall delve line-of-sight fix
// (lineOfSightClear's delve branch in src/sim/colliders.ts, plus the clutter
// cameraTopY in src/sim/dungeon_layout.ts). The bug is a spurious "Line of
// sight." refusal against an open-ground target: nothing renders differently
// (the clutter prop looks the same low object either way), so this is not a
// before/after diff, it is a reference shot of the fixed cast succeeding
// against a Funeral Ringer-family trash mob straddling an aisle-clutter
// scatter point, for reviewer orientation, matching
// scripts/rift_ghost_boulder_push_shot.mjs's own header pattern for a
// sim-only fix with nothing to visually diff.
//
// Needs `npm run dev` on :5173 (override with GAME_URL). Writes to tmp/, then
// the caller copies the keeper into docs/screenshots/.
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
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text());
});

await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
  } catch {
    /* ignore */
  }
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
const booted = await enterOfflineGame(page, {
  charClass: 'warlock',
  charName: 'Ringtest',
  gameBootTimeoutMs: 60000,
});
if (!booted) {
  await page.screenshot({ path: 'tmp/_boot_debug.png' });
  throw new Error('offline world did not boot');
}
await sleep(500);

// Enter The Collapsed Reliquary, force the run straight into the Saintless
// Hall module, then place the caster and a trash mob straddling the same
// aisle-clutter scatter point the reported bug's video shows: nothing
// visually between them, on flat open floor. Cast a ranged spell and confirm
// no "Line of sight." refusal.
const attempt = await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.setPlayerLevel(7);
  sim.enterDelve('collapsed_reliquary', 'normal', sim.player.id);
  const run = sim.delveRunForPlayer(sim.player.id);
  run.modules = ['reliquary_saintless_hall'];
  run.moduleIndex = 0;
  sim.spawnDelveModule(run);
  const origin = run.origin;
  const zBase = sim.delveModuleZOffset(run);
  // Aisle clutter scatter point at instance-local (0, 12) (delve_layout.ts
  // AISLE_CLUTTER), the same point the reported bug's video shows blocking a
  // cast against open ground.
  const clutterX = origin.x;
  const clutterZ = origin.z + zBase + 12;

  const player = sim.player;
  player.pos = { x: clutterX, y: 0, z: clutterZ - 3 };
  player.prevPos = { ...player.pos };
  sim.rebucket(player);
  player.hp = player.maxHp;
  player.resource = player.maxResource;
  player.gcdRemaining = 0;

  sim.chat('/dev spawn reliquary_ledger_wraith 1 7', player.id);
  const mob = [...sim.entities.values()].find(
    (e) => e.kind === 'mob' && e.templateId === 'reliquary_ledger_wraith' && !e.dead,
  );
  if (mob) {
    mob.pos = { x: clutterX, y: 0, z: clutterZ + 3 };
    mob.prevPos = { ...mob.pos };
    sim.rebucket(mob);
  }

  player.facing = mob ? Math.atan2(mob.pos.x - player.pos.x, mob.pos.z - player.pos.z) : 0;
  if (mob) sim.targetEntity(mob.id, player.id);
  sim.drainEvents();
  sim.castAbility('shadow_bolt');
  const events = sim.drainEvents();
  return {
    mobFound: !!mob,
    mobPos: mob ? { x: +mob.pos.x.toFixed(2), z: +mob.pos.z.toFixed(2) } : null,
    playerPos: { x: +player.pos.x.toFixed(2), z: +player.pos.z.toFixed(2) },
    events: events.map((e) => e.type),
    losError: events.some((e) => e.type === 'error' && e.text === 'Line of sight.'),
    castStarted: events.some((e) => e.type === 'castStart'),
  };
});
console.log('cast attempt:', JSON.stringify(attempt));
if (!attempt.mobFound) throw new Error('reliquary_ledger_wraith did not spawn');
if (attempt.losError) throw new Error('regression: cast was refused with Line of sight.');
if (!attempt.castStarted) throw new Error('cast never started');

await page.evaluate(() => {
  const inp = window.__game.input;
  inp.camYaw = 0;
  inp.camDist = 12;
  inp.camPitch = 0.35;
});

// A few settle frames so the freshly teleported camera/renderer catch up,
// and the cast bar (still mid-cast: shadow_bolt has a cast time) is visible.
for (let i = 0; i < 6; i++) {
  await page.screenshot({ path: 'tmp/_frame.png' });
  await sleep(80);
}
await sleep(150);
await page.screenshot({ path: 'tmp/saintless-hall-los-fix-context.png' });

const result = await page.evaluate(() => {
  const p = window.__game.sim.player;
  return { casting: p.castingAbility, pos: { x: +p.pos.x.toFixed(2), z: +p.pos.z.toFixed(2) } };
});
console.log('capture state:', JSON.stringify(result));

await browser.close();
process.exit(0);
