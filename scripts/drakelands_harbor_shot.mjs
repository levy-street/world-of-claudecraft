// Owner-facing captures of the Wyrmwatch cliff harbor at the Drakelands ferry berth
// (src/sim/content/wyrmwatch_harbor.ts): from the sea on the arriving ferry, from the quay
// looking up the cliff, from the middle of the stair, and from the harbor gate at the top
// looking down, with the ferry lying at the berth; then the Harbormaster's House
// (src/sim/content/wyrmwatch_harbor_house.ts) from the sea, the quay and the stair top, at
// its door, and inside from several orbits (the cutaway) and from a camera zoomed in under
// its rafters. Offline client, dev build, driven through
// window.__game the way scripts/ferry_voyage_shot.mjs is. The same camera stations serve
// the before and after captures (run it on the old code first).
//
//   npx vite --port 5177
//   GAME_URL=http://localhost:5177 SHOTS_DIR=tmp/drakelands-harbor GPU=1 node scripts/drakelands_harbor_shot.mjs
//
// GRAPHICS_PRESET picks the preset (1 low, 2 medium, 3 high, the default, 4 ultra). ONLY limits
// the run to a comma list of shot names; PREFIX and SUFFIX wrap every file name.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5177';
const OUT = process.env.SHOTS_DIR ?? 'tmp/drakelands-harbor';
const PRESET = Number(process.env.GRAPHICS_PRESET ?? 3);
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const PREFIX = process.env.PREFIX ?? '';
const SUFFIX = process.env.SUFFIX ?? '';
const GPU = process.env.GPU === '1';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--window-size=1600,900',
    ...(GPU
      ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']
      : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
  ],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.evaluateOnNewDocument(`
  try { localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: ${PRESET}, graphicsDefaultApplied: true })); } catch {}
`);
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 120000 });
const booted = await enterOfflineGame(page, {
  charClass: 'warrior',
  charName: 'Deckhand',
  gameBootTimeoutMs: 180000,
  selectorTimeoutMs: 90000,
});
if (!booted) throw new Error('offline world did not boot');
await sleep(1500);

/** Run a string-form async body in the page (no bundler-injected helpers). */
function run(body) {
  return page.evaluate(`(async () => { ${body} })()`);
}

await run(`
  const g = window.__game;
  g.sim.setPlayerLevel(60);
  window.__ferry = await import('/src/sim/transport_schedule.ts');
  window.__ships = await import('/src/sim/content/transport_ships.ts');
`);
// solar noon, whatever the live clock says: the /daynight dev command goes through the
// chat box (a dynamic import here would load a second copy of the clock module)
await page.waitForSelector('#chat-input', { timeout: 120000 });
await page.evaluate(() => {
  const chat = document.querySelector('#chat-input');
  chat.value = '/daynight day';
  chat.dispatchEvent(new Event('input', { bubbles: true }));
  chat.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
});
await sleep(6000); // the grade lerps in
console.log(
  'graphics',
  await run(
    `const { GFX } = await import('/src/render/gfx.ts'); return GFX.tier + ' / effects ' + GFX.effectsTier;`,
  ),
);

/** Route B (Wickharbor to the Drakelands): the ferry clock at `offset` seconds
 *  from the moment it docks at the Drakelands berth. */
async function setDrakelandsClock(offset) {
  await run(`
    const g = window.__game;
    const R = window.__ships.TRANSPORT_ROUTES.find((r) => r.id === 'wickharborDrakelands');
    const docked = R.timings.docked + window.__ferry.transportVoyageSeconds(R, 0);
    g.sim.transportClockOffset = docked + ${offset} - g.sim.time;
  `);
}

/** Stand the player at (x, z) on the ground, the camera looking along `yaw`. */
async function standAt(x, z, yaw, pitch, dist) {
  await run(`
    const g = window.__game;
    const p = g.sim.player;
    const pos = g.sim.groundPos(${x}, ${z});
    p.pos = { ...pos };
    p.prevPos = { ...pos };
    p.facing = ${yaw};
    p.prevFacing = ${yaw};
    p.vx = 0; p.vy = 0; p.vz = 0;
    g.input.camYaw = g.renderer.camYaw = ${yaw};
    g.input.camPitch = g.renderer.camPitch = ${pitch};
    g.input.camDist = g.renderer.camDist = ${dist};
  `);
}

/** Aim the camera from the player at world point (x, z). */
async function lookAt(x, z, pitch, dist) {
  await run(`
    const g = window.__game;
    const p = g.sim.player;
    const yaw = Math.atan2(${x} - p.pos.x, ${z} - p.pos.z);
    p.facing = yaw;
    g.input.camYaw = g.renderer.camYaw = yaw;
    g.input.camPitch = g.renderer.camPitch = ${pitch};
    g.input.camDist = g.renderer.camDist = ${dist};
  `);
}

/** Wait out a long teleport's loading screen, then let the scene settle. */
async function settle(ms) {
  await sleep(1000);
  for (let i = 0; i < 240; i++) {
    const loading = await run(`
      const el = document.querySelector('#loading-screen');
      if (!el) return false;
      const s = getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.01;
    `);
    if (!loading) break;
    await sleep(500);
  }
  await sleep(GPU ? ms : ms * 2);
}

async function shot(name) {
  await run(
    `for (const id of ['#ferry-hud', '#error-msg']) { const el = document.querySelector(id); if (el) el.style.visibility = 'hidden'; }`,
  );
  const file = path.join(OUT, `${PREFIX}${name}${SUFFIX}.png`);
  await page.screenshot({ path: file });
  console.log('wrote', file);
}

const want = (name) => !ONLY || ONLY.has(name);
/** The harbor's middle, where the from-afar shots aim. */
const HARBOR = { x: 492, z: 1908 };

// 1) From the sea: aboard the arriving ferry, looking across at the cliff harbor.
if (want('sea')) {
  // board while the ship is well out, then ride it in (a clock jump would leave the
  // passenger behind)
  await setDrakelandsClock(Number(process.env.SEA_CLOCK ?? -20));
  await run(`window.__game.sim.chat('/dev ferry wickharbor board');`);
  await settle(1500);
  const until = Date.now() + (GPU ? 7000 : 12000);
  while (Date.now() < until) {
    await lookAt(
      HARBOR.x,
      HARBOR.z,
      Number(process.env.SEA_PITCH ?? 0.34),
      Number(process.env.SEA_DIST ?? 18),
    );
    await sleep(120);
  }
  await shot('sea');
}

// 2) From the quay (the pier root before), looking up the cliff at the stair.
if (want('quay')) {
  await setDrakelandsClock(20);
  await standAt(496.5, 1900.2, -0.3, 0.06, 9);
  await settle(5000);
  await standAt(496.5, 1900.2, -0.3, 0.06, 9);
  await sleep(1200);
  await shot('quay');
}

// 3) Half way up the stair, looking back over the landing and the quay.
if (want('midstair')) {
  await setDrakelandsClock(20);
  await standAt(491.4, 1914, -2.65, 0.26, 10);
  await settle(5000);
  await standAt(491.4, 1914, -2.65, 0.26, 10);
  await sleep(1200);
  await shot('midstair');
}

// 4) From the arrival point at the top, looking down on the harbor and the ship.
if (want('top')) {
  await setDrakelandsClock(20);
  await standAt(486.8, 1908.4, 1.85, 0.42, 11);
  await settle(5000);
  await standAt(486.8, 1908.4, 1.85, 0.42, 11);
  await sleep(1200);
  await shot('top');
}

// 5) Walking in from Wyrmwatch: the path to the harbor gate at the cliff edge.
if (want('approach')) {
  await setDrakelandsClock(20);
  await standAt(474, 1908.2, Math.PI / 2 - 0.05, 0.2, 9);
  await settle(5000);
  await standAt(474, 1908.2, Math.PI / 2 - 0.05, 0.2, 9);
  await sleep(1200);
  await shot('approach');
}

// 6) From the pier, the camera out over the bay north of the ship: the whole climb.
if (want('wide')) {
  await setDrakelandsClock(20);
  await standAt(499, 1897.6, -0.53, 0.2, 24);
  await settle(5000);
  await lookAt(HARBOR.x - 1, HARBOR.z + 3, 0.2, 24);
  await sleep(1200);
  await shot('wide');
}
// 7) The Harbormaster's House: outside, then in (the house_* shots; ONLY picks them).
const HOUSE = { x: 493.1, z: 1885.6 };
const HOUSE_SHOTS = [
  // name, stand x, z, look-at x, z, pitch, distance (house_sea: swimming off its sea side)
  ['house_sea', 505.5, 1875.5, HOUSE.x, HOUSE.z, 0.16, 12],
  ['house_quay', 495.2, 1899.6, 490.4, 1890.4, 0.14, 9],
  ['house_stairtop', 490.9, 1908.6, HOUSE.x, HOUSE.z, 0.32, 9],
  ['house_door', 490.2, 1892.6, 490.2, 1884, 0.06, 5],
  ['house_map', 493.8, 1888.2, 493.8, 1881, 0.1, 7],
  ['house_table', 491.4, 1888.8, 494.3, 1884.5, 0.2, 8],
  ['house_hearth', 491.3, 1887.2, 488.95, 1884.5, 0.22, 7],
  ['house_npc', 494.3, 1888.4, 494.3, 1884.5, 0.05, 3.2],
  ['house_rafters', 491.0, 1886.8, 488.95, 1884.5, -0.22, 3.2],
  ['house_overhead', 492.6, 1887.4, 493.6, 1884.8, 0.95, 13],
];
for (const [name, x, z, tx, tz, pitch, dist] of HOUSE_SHOTS) {
  if (!want(name)) continue;
  await setDrakelandsClock(20);
  await standAt(x, z, 0, pitch, dist);
  await settle(5000);
  await standAt(x, z, 0, pitch, dist);
  await lookAt(tx, tz, pitch, dist);
  await sleep(1500);
  await shot(name);
}
await browser.close();
