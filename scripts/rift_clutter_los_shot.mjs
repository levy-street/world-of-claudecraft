// Context screenshot for the rift floor-clutter line-of-sight fix
// (dungeon_layout.ts layoutColliders + colliders.ts sightBlockedAt's rift
// branch). The bug itself has no visible geometry to diff: the offending
// "clutter" collider carries no matching render prop on a procedural rift
// floor (unlike the delve family, which draws bone piles at the same spots),
// so this is a reference shot proving the floor between the caster and the
// target mob is completely open ground with nothing standing on it, then
// casting Fireball across it with no "Line of sight." refusal, for reviewer
// orientation alongside tests/rift_line_of_sight.test.ts.
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
  charClass: 'mage',
  charName: 'Clutterspell',
  gameBootTimeoutMs: 60000,
});
if (!booted) {
  await page.screenshot({ path: 'tmp/_boot_debug.png' });
  throw new Error('offline world did not boot');
}
await sleep(500);

// Seed 15, floor 0: tests/rift_line_of_sight.test.ts pins a clutter piece at
// instance-local (7.7, 6.9) on a dead-straight 12yd line with nothing else on
// it. Enter that exact floor, capture the arrival point as the world-space
// origin reference, then place the caster and a spawned target 12yd apart
// down the open nave (same open-floor class the pinned pair exercises).
const found = await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.setPlayerLevel(20);
  sim.enterRift(15, 20, sim.player.id);
  const inst = sim.riftInstances.find((i) => i.partyKey !== null);
  if (!inst) return null;
  for (const id of inst.mobIds) {
    const e = sim.entities.get(id);
    if (e) {
      e.hp = 0;
      e.dead = true;
    }
  }
  sim.player.gm = true;
  sim.player.hp = sim.player.maxHp;
  // The arrival point (just inside the entrance porch) anchors the nave.
  const anchor = { x: sim.player.pos.x, z: sim.player.pos.z };
  sim.player.pos = { x: anchor.x - 6, y: 0, z: anchor.z + 10 };
  sim.player.prevPos = { ...sim.player.pos };
  sim.drainEvents();

  const before = new Set(sim.entities.keys());
  sim.chat('/dev spawn forest_wolf 1 20', sim.player.id);
  let wolf = null;
  for (const [id, e] of sim.entities) {
    if (!before.has(id) && e.kind === 'mob') {
      wolf = e;
      break;
    }
  }
  if (!wolf) return { anchor, wolfSpawned: false };
  wolf.pos = { x: anchor.x + 6, y: 0, z: anchor.z + 10 };
  wolf.prevPos = { ...wolf.pos };
  sim.rebucket(wolf);
  sim.player.facing = Math.atan2(wolf.pos.x - sim.player.pos.x, wolf.pos.z - sim.player.pos.z);
  sim.targetEntity(wolf.id, sim.player.id);
  return { anchor, wolfSpawned: true };
});
console.log('setup:', JSON.stringify(found));

// A couple of settle ticks so the freshly teleported camera/renderer catch up.
for (let i = 0; i < 5; i++) {
  await page.screenshot({ path: 'tmp/_frame.png' });
  await sleep(60);
}

await page.evaluate(() => {
  const inp = window.__game.input;
  inp.camYaw = 0;
  inp.camDist = 14;
  inp.camPitch = 0.55;
});
await sleep(200);
// The GPU-acceleration warning banner appears a while after boot (SwiftShader
// headless is always "unaccelerated") and must not sit across the keeper.
for (let i = 0; i < 20; i++) {
  const dismissed = await page.evaluate(() => {
    const dismiss = [...document.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Dismiss',
    );
    if (!dismiss) return false;
    dismiss.click();
    return true;
  });
  if (dismissed) break;
  await sleep(300);
}
await sleep(200);

// Fix confirmation: the fix under review is exactly this, casting Fireball
// across the pinned open floor with no "Line of sight." refusal.
const cast = await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.drainEvents();
  sim.castAbility('fireball', sim.player.id);
  const events = sim.drainEvents();
  return {
    startedCast: events.some((e) => e.type === 'castStart' && e.ability === 'fireball'),
    losRefused: events.some((e) => e.type === 'error' && e.text === 'Line of sight.'),
  };
});
console.log('cast result:', JSON.stringify(cast));
await sleep(150);
await page.screenshot({ path: 'tmp/rift-clutter-los-context.png' });

const result = await page.evaluate(() => {
  const p = window.__game.sim.player;
  return { pos: { x: +p.pos.x.toFixed(2), z: +p.pos.z.toFixed(2) }, target: p.targetId };
});
console.log('capture state:', JSON.stringify(result));

await browser.close();
process.exit(0);
