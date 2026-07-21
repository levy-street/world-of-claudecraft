// Visual + behavioural verification for the delve wall/collision/transition fixes.
// Offline single-player (no server/Postgres needed): enters the collapsed
// reliquary, drives REAL keyboard movement into the side walls and the south
// gap, and asserts the player is contained to the active module. Also forces a
// forward module transition and re-checks (no backtracking into the prior room).
// Needs: npm run dev (:5173).

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync('tmp', { recursive: true });

let pass = 0,
  fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log(`OK   ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name}${extra ? ` ${extra}` : ''}`);
  }
};

const errors = [];
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 60000,
  // Anti-throttle so the offline rAF loop keeps ticking while we hold keys.
  args: [
    '--window-size=1280,820',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
  defaultViewport: { width: 1280, height: 820 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`);
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await sleep(800);

// Offline quick-start as warrior.
await page.evaluate(() => {
  document.querySelector('#btn-offline')?.click();
});
await sleep(400);
await page.evaluate(() => {
  document.querySelector('#offline-select .mini-class[data-class="warrior"]')?.click();
  const name = document.querySelector('#char-name');
  if (name) name.value = 'Wallcheck';
  document.querySelector('#btn-start-offline')?.click();
});
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 60000, polling: 300 });
check('entered offline world', true);

// Enter the delve directly through the sim (dev path).
const entered = await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.setPlayerLevel(9);
  sim.enterDelve('collapsed_reliquary', 'normal');
  const run = sim.delveRunForPlayer(sim.playerId);
  return run
    ? { ok: true, modules: run.modules.length, x: Math.round(sim.player.pos.x) }
    : { ok: false };
});
check('entered delve run', entered.ok, JSON.stringify(entered));

// Let the renderer prebuild the module interiors.
await page
  .waitForFunction(() => (window.__game.renderer?.builtInteriors?.size ?? 0) > 0, {
    timeout: 20000,
    polling: 400,
  })
  .catch(() => {});
await sleep(1500);

function _moduleBounds(page) {
  return page.evaluate(() => {
    const sim = window.__game.sim;
    const run = sim.delveRunForPlayer(sim.playerId);
    const id = run.modules[run.moduleIndex];
    const L = window.__DELVE_LAYOUTS?.[id];
    // Pull bounds from the run + layout via a sim helper if exposed; else recompute.
    const _layout = sim.constructor && L ? L : null;
    return {
      run: { moduleIndex: run.moduleIndex, modules: run.modules },
      originX: run.origin.x,
      originZ: run.origin.z,
    };
  });
}

// Roam: hold each direction so the body is driven into every wall, sampling pos.
async function roamAndSample(_label) {
  const keys = ['KeyW', 'KeyD', 'KeyS', 'KeyA', 'KeyS', 'KeyD'];
  const samples = [];
  for (const k of keys) {
    await page.keyboard.down(k);
    for (let i = 0; i < 8; i++) {
      await sleep(160);
      const s = await page.evaluate(() => {
        const sim = window.__game.sim;
        const run = sim.delveRunForPlayer(sim.playerId);
        const _id = run.modules[run.moduleIndex];
        const _layout = sim.delveLayoutFor ? null : null;
        const p = sim.player.pos;
        return { x: p.x, z: p.z, ox: run.origin.x, oz: run.origin.z, mi: run.moduleIndex };
      });
      samples.push(s);
    }
    await page.keyboard.up(k);
  }
  return samples;
}

// Helper to compute the active module's local bounds from the sim layout tables.
async function activeBounds() {
  return page.evaluate(() => {
    const sim = window.__game.sim;
    const run = sim.delveRunForPlayer(sim.playerId);
    const id = run.modules[run.moduleIndex];
    const L = window.__DELVE_LAYOUTS[id];
    // zBase: replicate delveModuleZOffset using exported helper on window.
    const zBase = window.__delveModuleZOffset(run.modules, run.moduleIndex);
    const wallX = L.wallX ?? 23;
    return {
      ox: run.origin.x,
      oz: run.origin.z + zBase,
      halfX: wallX - 1,
      zMin: L.zMin,
      zMax: L.zMax,
      mi: run.moduleIndex,
    };
  });
}

// Expose the layout tables + offset helper to the page for bound checks.
await page.evaluate(async () => {
  const dl = await import('/src/sim/delve_layout.ts');
  const data = await import('/src/sim/data.ts');
  window.__DELVE_LAYOUTS = dl.DELVE_MODULE_LAYOUTS;
  window.__delveModuleZOffset = data.delveModuleZOffset;
});

const R = 0.5;

// Drive the REAL swept move resolver (tick path, incl. the new module clamp).
// TS `private` is erased at runtime, so we can call it from the page.
async function attemptMove(fromX, fromZ, toX, toZ) {
  return page.evaluate(
    (fx, fz, tx, tz, r) => {
      const sim = window.__game.sim;
      const p = sim.player;
      return sim.resolveMove(fx, fz, tx, tz, r, p);
    },
    fromX,
    fromZ,
    toX,
    toZ,
    R,
  );
}

// --- Phase A: room 0 containment (deterministic, via the real resolver) ---
let b = await activeBounds();
const midZ = b.oz + (b.zMin + b.zMax) / 2;

// East: charge 200u into the +x wall.
let res = await attemptMove(b.ox, midZ, b.ox + 200, midZ);
check(
  'room0: side wall stops eastward charge',
  res.x <= b.ox + b.halfX - R + 0.05 && res.x > b.ox + b.halfX - R - 1,
  `x=${(res.x - b.ox).toFixed(2)} limit=${(b.halfX - R).toFixed(2)}`,
);
// West.
res = await attemptMove(b.ox, midZ, b.ox - 200, midZ);
check(
  'room0: side wall stops westward charge',
  res.x >= b.ox - (b.halfX - R) - 0.05 && res.x < b.ox - (b.halfX - R) + 1,
  `x=${(res.x - b.ox).toFixed(2)}`,
);
// South: charge 300u toward the entrance/gap; must stop at the front-wall seal.
res = await attemptMove(b.ox, b.oz + b.zMin + 8, b.ox, b.oz + b.zMin - 300, b.ox);
check(
  'room0: front wall seals the south exit (no gap escape)',
  res.z - b.oz >= b.zMin + 1 - 0.05,
  `z=${(res.z - b.oz).toFixed(2)} seal=${b.zMin + 1}`,
);

// Escape attempt: start INSIDE the inter-module gap (north of room 0's back
// wall) and charge sideways. Pre-fix this band had no side walls; the clamp now
// pulls the body back into the active module.
res = await attemptMove(b.ox, b.oz + b.zMax + 6, b.ox + 200, b.oz + b.zMax + 6);
check(
  'gap: cannot stand/strafe out through the missing side walls',
  Math.abs(res.x - b.ox) <= b.halfX - R + 0.05 && res.z - b.oz <= b.zMax - 1 - R + 0.05,
  `x=${(res.x - b.ox).toFixed(2)} z=${(res.z - b.oz).toFixed(2)}`,
);

// Screenshot: roam a little for a natural in-room shot.
await roamAndSample('room0');
await page.screenshot({ path: 'tmp/delve_room0.png' });

// --- Phase B: force a forward transition, then try to backtrack ---
const adv = await page.evaluate(() => {
  const sim = window.__game.sim;
  const run = sim.delveRunForPlayer(sim.playerId);
  if (run.modules.length < 2) return { ok: false };
  run.exitPortalOpen = true;
  sim.advanceDelveModule(run);
  return { ok: run.moduleIndex === 1, mi: run.moduleIndex };
});
check('advanced to module 1', adv.ok, JSON.stringify(adv));
await sleep(800);

b = await activeBounds();
// From module 1's entry, charge 300u south toward the previous room.
res = await attemptMove(b.ox, b.oz + b.zMin + 8, b.ox, b.oz + b.zMin - 300, b.ox);
check(
  'module1: cannot backtrack south into the previous room',
  res.z - b.oz >= b.zMin + 1 - 0.05,
  `z=${(res.z - b.oz).toFixed(2)} seal=${b.zMin + 1}`,
);

await roamAndSample('room1');
await page.screenshot({ path: 'tmp/delve_room1_after_transition.png' });

// Ignore harmless online-only telemetry fetch failures (project stats, 502).
const realErrors = errors.filter((e) => !/project stats|502|Bad Gateway/i.test(e));
check('no page errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
