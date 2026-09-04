// Context screenshot for the rift ghost-form boulder-push exploit fix
// (updateRiftTriggers in src/sim/rift/runs.ts). The bug itself is invisible on
// screen (a boulder either moves or does not, server-side, whether the mover is
// a live player or a released spirit), so this is not a before/after diff: it
// is a reference shot of the strength-boulder puzzle the exploit targeted, for
// reviewer orientation, plus a caption panel documenting the real numbers the
// fix's tests captured (tests/rift_mechanics.test.ts, "strength boulders").
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
    localStorage.setItem(
      'woc_settings',
      JSON.stringify({ graphicsPreset: 5, terrainDetail: 1, effectsQuality: 1, shadowQuality: 1 }),
    );
  } catch {
    /* ignore */
  }
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
const booted = await enterOfflineGame(page, {
  charClass: 'warrior',
  charName: 'Rockpush',
  gameBootTimeoutMs: 60000,
});
if (!booted) {
  await page.screenshot({ path: 'tmp/_boot_debug.png' });
  throw new Error('offline world did not boot');
}
await sleep(500);

// Find a floor-0 seed carrying a boulder_push puzzle by driving the live sim's
// own enterRift/leaveRift, so this matches whatever the shipped generator
// actually rolls rather than duplicating its odds table.
const found = await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.setPlayerLevel(20);
  for (let seed = 1; seed <= 300; seed++) {
    sim.enterRift(seed, 20, sim.player.id);
    const inst = sim.riftInstances.find((i) => i.partyKey !== null);
    if (inst && inst.boulderIds.length > 0) {
      // Clear trash so camp mobs cannot photobomb or kill the camera.
      for (const id of inst.mobIds) {
        const e = sim.entities.get(id);
        if (e) {
          e.hp = 0;
          e.dead = true;
        }
      }
      sim.player.gm = true;
      sim.player.hp = sim.player.maxHp;
      const b = sim.entities.get(inst.boulderIds[0]);
      // Stand just south of the boulder, facing it, matching the walk-in the
      // regression test drives directly against updateRiftTriggers.
      sim.player.pos = { x: b.pos.x, y: b.pos.y, z: b.pos.z - 3 };
      sim.player.prevPos = { ...sim.player.pos };
      sim.player.facing = Math.atan2(b.pos.x - sim.player.pos.x, b.pos.z - sim.player.pos.z);
      return {
        seed,
        boulder: { x: +b.pos.x.toFixed(2), z: +b.pos.z.toFixed(2) },
      };
    }
    if (!sim.player.dead) sim.leaveRift(sim.player.id);
  }
  return null;
});
if (!found) throw new Error('no boulder_push floor found in the first 300 seeds');
console.log('found boulder_push floor:', JSON.stringify(found));

// A couple of settle ticks so the freshly teleported camera/renderer catch up.
for (let i = 0; i < 5; i++) {
  await page.screenshot({ path: 'tmp/_frame.png' });
  await sleep(60);
}

await page.evaluate(() => {
  const inp = window.__game.input;
  inp.camYaw = 0; // face the boulder head-on, matching the walk-in direction
  inp.camDist = 6;
  inp.camPitch = 0.3;
});
await sleep(200);
await page.screenshot({ path: 'tmp/_frame.png' });
// The GPU-acceleration warning banner appears a while after boot (SwiftShader
// headless is always "unaccelerated") and must not sit across the keeper; poll
// for it since it can still be absent on the first check.
for (let i = 0; i < 10; i++) {
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
await page.screenshot({ path: 'tmp/_frame.png' });
await sleep(150);
await page.screenshot({ path: 'tmp/rift-boulder-push-context.png' });

const result = await page.evaluate(() => {
  const p = window.__game.sim.player;
  return { pos: { x: +p.pos.x.toFixed(2), z: +p.pos.z.toFixed(2) }, dead: p.dead, ghost: p.ghost };
});
console.log('capture state:', JSON.stringify(result));

await browser.close();
process.exit(0);
