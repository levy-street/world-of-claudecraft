// Owner-facing captures of the Wickharbor ferry wharf (the ferry berth off Wickharbor's
// south shore, the Galecrest): the owner's own angle over the pier root (the crossing
// decks the wharf replaced), close-ups of the old overlaps, the wharf from the town's
// boardwalk and from the bluff, and from the ferry arriving at the berth. Offline client,
// dev build, driven through window.__game the way scripts/drakelands_harbor_shot.mjs is.
// The same camera stations serve the before and after captures (run it on the old code
// first).
//
//   npx vite --port 5178
//   GAME_URL=http://localhost:5178 SHOTS_DIR=tmp/wickharbor-wharf GPU=1 node scripts/wickharbor_wharf_shot.mjs
//
// GRAPHICS_PRESET picks the preset (1 low, 2 medium, 3 high, the default, 4 ultra). ONLY limits
// the run to a comma list of shot names; PREFIX and SUFFIX wrap every file name.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5178';
const OUT = process.env.SHOTS_DIR ?? 'tmp/wickharbor-wharf';
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
// solar noon, whatever the live clock says (the /daynight dev command, through the chat box)
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

/** Route B (Wickharbor to the Drakelands): the ferry clock at `offset` seconds from the
 *  start of its cycle (the ship lies at the Wickharbor berth, boarding). Negative offsets
 *  count back from the end of the cycle (the ship coming home). */
async function setWickClock(offset) {
  await run(`
    const g = window.__game;
    const R = window.__ships.TRANSPORT_ROUTES.find((r) => r.id === 'wickharborDrakelands');
    const cycle = window.__ferry.transportCycleSeconds(R);
    const at = ${offset} >= 0 ? ${offset} : cycle + ${offset};
    g.sim.transportClockOffset = at - g.sim.time;
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

// The camera stations: name, stand x, z, look-at x, z, pitch, distance.
const STATIONS = [
  // the owner's report angle: on the pier by the route marker, looking out over the pier
  // root toward the ferry, high over the shoulder
  ['owner', 461, 377, 472.5, 367.5, 0.75, 15],
  // the crossing itself, close, from above the pier root
  ['crossing_close', 457.5, 377.2, 454.2, 375.6, 0.95, 7.5],
  // the elbow where the shore boardwalk met the pier, from the boardwalk side
  ['boardwalk_join', 465.2, 364.2, 461, 374, 0.45, 9],
  // the owner's long view from the pier root out over the harbor (wickharbor_long)
  ['long', 459, 374, 459, 360, 0.3, 14],
  // from the bluff behind the pier root, the whole berth
  ['bluff', 447.5, 372.5, 472, 380, 0.42, 14],
  // from the T-head back toward the town
  ['from_berth', 474, 380.6, 458, 373, 0.35, 11],
  // top-down-ish over the whole wharf
  ['overhead', 468, 378, 468.5, 374, 1.25, 34],
];
for (const [name, x, z, tx, tz, pitch, dist] of STATIONS) {
  if (!want(name)) continue;
  await setWickClock(20);
  await standAt(x, z, 0, pitch, dist);
  await settle(5000);
  await standAt(x, z, 0, pitch, dist);
  await lookAt(tx, tz, pitch, dist);
  await sleep(1500);
  await shot(name);
}

// From the sea: aboard the ferry coming home to Wickharbor, looking at the wharf.
if (want('arrival')) {
  await setWickClock(Number(process.env.ARRIVAL_CLOCK ?? -26));
  await run(`window.__game.sim.chat('/dev ferry wickharbor board');`);
  await settle(1500);
  const until = Date.now() + Number(process.env.ARRIVAL_WAIT ?? (GPU ? 9000 : 14000));
  while (Date.now() < until) {
    await lookAt(
      462,
      376,
      Number(process.env.ARRIVAL_PITCH ?? 0.5),
      Number(process.env.ARRIVAL_DIST ?? 22),
    );
    await sleep(120);
  }
  await shot('arrival');
}
await browser.close();
