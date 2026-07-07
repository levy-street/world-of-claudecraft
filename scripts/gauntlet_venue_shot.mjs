// Visual walkthrough of the Gauntlet venue. Boots the offline game (instant
// lobby: a join starts the run on the spot), joins at the recruiter, then
// screenshots each stage of the complex: the staging plaza, the sentinel
// field with the Stone Warden, the grandstands, the spectators' terrace, the
// podium, and the sealed future-trial arenas. Screenshots land in tmp/.
// Needs `npm run dev` already running (GAME_URL overrides the default URL).
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = (process.env.GAME_URL ?? 'http://localhost:5173') + '/?gfx=high';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (cond, msg) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'}  ${msg}`);
  if (!cond) fails.push(msg);
};

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
page.on('pageerror', (e) => fails.push('PAGEERROR: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE-ERR:', m.text());
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#btn-offline', { timeout: 120000 });
await sleep(500);
await page.evaluate(() => document.querySelector('#btn-offline').click());
// Wait for the offline class picker to actually render (a fixed sleep flakes
// on a cold Vite cache / slow machine), then pick the class.
await page.waitForFunction(
  () =>
    document.querySelector('#offline-select .mini-class[data-class="warrior"]') ||
    document.querySelector('.class-card[data-class="warrior"]'),
  { timeout: 30000, polling: 100 },
);
await sleep(300);
await page.evaluate(() => {
  const card =
    document.querySelector('#offline-select .mini-class[data-class="warrior"]') ||
    document.querySelector('.class-card[data-class="warrior"]');
  card?.click();
});
await sleep(300);
await page.evaluate(() => {
  const n = document.querySelector('#char-name');
  if (n) n.value = 'Vero';
});
await page.evaluate(() => document.querySelector('#btn-start-offline')?.click());
await page.waitForFunction(() => window.__game?.sim?.entities?.size > 5, {
  timeout: 120000,
  polling: 250,
});
await sleep(2000);
await page.evaluate(() => document.querySelector('.tut-skip')?.click());
await sleep(300);

// Stand at the recruiter and join: instant lobby teleports us to staging.
const joined = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const rec = [...sim.entities.values()].find((e) => e.templateId === 'gauntlet_recruiter');
  if (!rec) return { ok: false, why: 'no recruiter' };
  const me = sim.entities.get(g.world.playerId);
  me.pos.x = rec.pos.x;
  me.pos.z = rec.pos.z + 1;
  me.prevPos = { ...me.pos };
  g.world.gauntletJoin();
  return { ok: true };
});
check(joined.ok, `joined the gauntlet (${joined.why ?? 'instant lobby'})`);

// Wait for the run to reach staging and the venue to raise.
await page.waitForFunction(
  () => {
    const run = window.__game?.world?.gauntletRun;
    return run && run.phase !== 'lobby';
  },
  { timeout: 20000, polling: 250 },
);
await sleep(4500); // venue build is async on approach; give the GLBs room
const run = await page.evaluate(() => window.__game.world.gauntletRun);
check(run && run.phase, `run live, phase=${run?.phase}`);
console.log('run view:', JSON.stringify(run));

// Helper: put the player somewhere in the instance and face a heading, then
// let a few frames render before the shot.
async function shotAt(name, dx, dz, facing) {
  await page.evaluate(
    ({ dx, dz, facing }) => {
      const g = window.__game;
      const sim = g.sim;
      const run = g.world.gauntletRun;
      const me = sim.entities.get(g.world.playerId);
      me.pos.x = run.originX + dx;
      me.pos.z = run.originZ + dz;
      me.prevPos = { ...me.pos };
      me.facing = facing;
    },
    { dx, dz, facing },
  );
  await sleep(1200);
  await page.screenshot({ path: `tmp/gauntlet_${name}.png` });
  console.log(`shot: tmp/gauntlet_${name}.png`);
}

// The stages: staging plaza looking at the arch; the start line looking down
// the field at the Warden; mid-field; the spectators' terrace; the podium;
// and the two future-arena rows.
await shotAt('staging_arch', 0, -14, 0);
await shotAt('field_start', 0, 2, 0);
await shotAt('field_warden', 0, 55, 0);
await shotAt('spectator_terrace', 30, 40, -Math.PI / 2);
await shotAt('podium', 0, -6, Math.PI);
await shotAt('arenas_east_row', -20, 44, -Math.PI / 2);
await shotAt('arenas_west_row', -58, 60, -Math.PI / 2);

const venueBuilt = await page.evaluate(() => {
  const r = window.__game.renderer;
  return r && r.gauntletVenues ? r.gauntletVenues.size : -1;
});
check(venueBuilt !== 0, `venue built (slots=${venueBuilt})`);

// --- Trial 2, the in-world sigil slab: drive the run to the sigils trial and
// prove a synthesized pointer trace across the slab's screen projection
// registers progress on the wire view. The player crosses trial 1 by
// teleporting down the field during a green light (a teleport is one tick of
// displacement, legal while green); retried each green until the sim marks
// the crossing finished.
const crossed = await (async () => {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const run = window.__game.world.gauntletRun;
      if (!run) return { done: false, gone: true };
      if (run.trialIndex > 0 || run.finished) return { done: true };
      if (run.phase === 'trial' && run.sentinel && run.sentinel.light === 'green') {
        const g = window.__game;
        const me = g.sim.entities.get(g.world.playerId);
        me.pos.z = run.originZ + run.sentinel.fieldLength + 4;
        me.prevPos = { ...me.pos };
      }
      return { done: false };
    });
    if (state.gone) return false;
    if (state.done) return true;
    await sleep(300);
  }
  return false;
})();
check(crossed, 'crossed the sentinel field (trial 1 resolved for the viewer)');

// Wait out the interlude until the sigils trial is live for the viewer.
await page.waitForFunction(
  () => {
    const run = window.__game.world.gauntletRun;
    return !!run?.sigils && !run.spectating;
  },
  { timeout: 120000, polling: 250 },
);
await sleep(2000); // camera focus glide + outline tube build
await page.screenshot({ path: 'tmp/gauntlet_sigil_slab.png' });
console.log('shot: tmp/gauntlet_sigil_slab.png');

// The etched outline's screen projection, via the same shared shape module the
// sim scores against (Vite serves the TS in dev, so the page can import it).
const tracePath = await page.evaluate(async () => {
  const g = window.__game;
  const run = g.world.gauntletRun;
  if (!run?.sigils) return null;
  const { sigilOutline } = await import('/src/sim/gauntlet/sigil_shapes.ts');
  const { GAUNTLET, GAUNTLET_VENUE } = await import('/src/sim/content/gauntlet.ts');
  const rect = g.renderer.gauntletSigilSlabRect(run.originX, run.originZ);
  if (!rect) return null;
  const o = sigilOutline(run.sigils.shapeSeed, run.sigils.shapeId, GAUNTLET.sigils.outlinePoints);
  const pad = GAUNTLET_VENUE.sigils.slab.padFrac;
  const inner = 1 - 2 * pad;
  const pts = [];
  for (let i = 0; i < o.xs.length; i += 2) {
    // Shape-local -> face fraction -> rect-local [-1,1] -> world -> screen.
    const lu = (pad + o.ys[i] * inner) * 2 - 1;
    const lv = (pad + o.xs[i] * inner) * 2 - 1;
    const s = g.renderer.worldToScreen(
      rect.center.x + rect.u.x * lu + rect.v.x * lv,
      rect.center.y + rect.u.y * lu + rect.v.y * lv,
      rect.center.z + rect.u.z * lu + rect.v.z * lv,
    );
    if (!s.behind) pts.push({ x: s.x, y: s.y });
  }
  return pts;
});
check(tracePath && tracePath.length > 20, `slab outline projects (${tracePath?.length} points)`);

if (tracePath && tracePath.length > 20) {
  await page.mouse.move(tracePath[0].x, tracePath[0].y);
  await page.mouse.down();
  for (const p of tracePath) {
    await page.mouse.move(p.x, p.y);
    await sleep(35);
  }
  await page.mouse.up();
  await sleep(600); // let the tail batch flush and the sim tick
  const prog = await page.evaluate(() => window.__game.world.gauntletRun?.sigils?.progress ?? -1);
  check(prog > 0, `in-world trace registered progress (${prog})`);
  await page.screenshot({ path: 'tmp/gauntlet_sigil_traced.png' });
  console.log('shot: tmp/gauntlet_sigil_traced.png');

  // The desk-trial station lock: a live sigils player is held at the lectern,
  // so 2s of forward input must not move them while the trial stays live (the
  // guard skips gracefully if the trial happened to resolve first).
  const mark = await page.evaluate(() => {
    const me = window.__game.sim.entities.get(window.__game.world.playerId);
    return { x: me.pos.x, z: me.pos.z };
  });
  await page.keyboard.down('w');
  await sleep(2000);
  await page.keyboard.up('w');
  const held = await page.evaluate(() => {
    const g = window.__game;
    const me = g.sim.entities.get(g.world.playerId);
    return { x: me.pos.x, z: me.pos.z, live: !!g.world.gauntletRun?.sigils };
  });
  if (held.live) {
    const drift = Math.hypot(held.x - mark.x, held.z - mark.z);
    check(drift < 0.6, `station lock held during the sigils trial (drift ${drift.toFixed(2)}yd)`);
  } else {
    console.log('SKIP  station-lock check (sigils trial resolved before the hold window)');
  }
}

await browser.close();
if (fails.length) {
  console.error('\nFAILURES:');
  for (const f of fails) console.error(' - ' + f);
  process.exit(1);
}
console.log('\nAll venue shots captured.');
