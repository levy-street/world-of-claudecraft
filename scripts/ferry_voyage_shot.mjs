// Owner-facing captures of the two ferry routes (Eastbrook to the Nightbloom,
// Wickharbor to the Drakelands): each ship docked at its far berth's new
// pier, each under way with the deck walkable, and each arrival. Offline
// client, dev build (the /dev ferry commands are dev-only), driven through
// window.__game.
//
// Needs `npx vite --port <port>` running (GAME_URL, default
// http://localhost:5178). Writes PNGs to SHOTS_DIR (default
// tmp/ferry-voyage). GPU=1 renders on the machine's GPU instead of
// SwiftShader (sharper, and fast enough to let a scene settle).
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5178';
const OUT = process.env.SHOTS_DIR ?? 'tmp/ferry-voyage';
const PRESET = Number(process.env.GRAPHICS_PRESET ?? 2);
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const GPU = process.env.GPU === '1';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--window-size=1280,720',
    ...(GPU
      ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']
      : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
  ],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.evaluateOnNewDocument(`
  try { localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: ${PRESET} })); } catch {}
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

// Level up (the zones' mobs must not decide a capture), and bring the
// schedule module in for the clock arithmetic.
await run(`
  const g = window.__game;
  g.sim.setPlayerLevel(60);
  window.__ferry = await import('/src/sim/transport_schedule.ts');
  window.__ships = await import('/src/sim/content/transport_ships.ts');
`);

/** Route `r` (0 or 1): its docked seconds and both voyage lengths. */
function timing(r) {
  return run(`
    const R = window.__ships.TRANSPORT_ROUTES[${r}];
    const F = window.__ferry;
    return { docked: R.timings.docked, out: F.transportVoyageSeconds(R, 0), home: F.transportVoyageSeconds(R, 1) };
  `);
}

/** Set the ferry clock to `clock` seconds. */
async function setClock(clock) {
  await run(`
    const g = window.__game;
    g.sim.transportClockOffset = ${clock} - g.sim.time;
  `);
}

/** Stand the player at (x, z) on the ground, facing `facing`, camera at yaw. */
async function standAt(x, z, facing, yaw, pitch, dist) {
  await run(`
    const g = window.__game;
    const p = g.sim.player;
    const pos = g.sim.groundPos(${x}, ${z});
    p.pos = { ...pos };
    p.prevPos = { ...pos };
    p.facing = ${facing};
    p.prevFacing = ${facing};
    p.vx = 0; p.vy = 0; p.vz = 0;
    g.input.camYaw = g.renderer.camYaw = ${yaw};
    g.input.camPitch = g.renderer.camPitch = ${pitch};
    g.input.camDist = g.renderer.camDist = ${dist};
  `);
}

/** Aim the camera relative to route `r`'s ship's bow (null keeps a value). */
async function aimOffBow(r, yawOffBow, pitch, dist) {
  await run(`
    const g = window.__game;
    const R = window.__ships.TRANSPORT_ROUTES[${r}];
    const pose = window.__ferry.transportShipPoseAt(R, g.sim.time + g.sim.transportClockOffset, { x: 0, z: 0, rot: 0 });
    g.input.camYaw = g.renderer.camYaw = pose.rot + ${yawOffBow};
    if (${pitch} !== null) g.input.camPitch = g.renderer.camPitch = ${pitch};
    if (${dist} !== null) g.input.camDist = g.renderer.camDist = ${dist};
  `);
}

/** Turn the camera to look at route `r`'s ship from where the player stands
 *  (`skew` radians off the line of sight). */
async function lookAtShip(r, skew, pitch, dist) {
  await run(`
    const g = window.__game;
    const R = window.__ships.TRANSPORT_ROUTES[${r}];
    const s = window.__ferry.transportShipPoseAt(R, g.sim.time + g.sim.transportClockOffset, { x: 0, z: 0, rot: 0 });
    const p = g.sim.player;
    g.input.camYaw = g.renderer.camYaw = Math.atan2(s.x - p.pos.x, s.z - p.pos.z) + ${skew};
    g.input.camPitch = g.renderer.camPitch = ${pitch};
    g.input.camDist = g.renderer.camDist = ${dist};
  `);
}

/** Board route `r`'s ship wherever it is (named by its first berth). */
async function board(r, yawOffBow, pitch, dist) {
  const berth = await run(`return window.__ships.TRANSPORT_ROUTES[${r}].berths[0].id;`);
  await run(`window.__game.sim.chat('/dev ferry ${berth} board');`);
  await aimOffBow(r, yawOffBow, pitch, dist);
}

/** Keep the camera's yaw locked off route `r`'s bow for `ms`. */
async function holdCamera(r, yawOffBow, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    await aimOffBow(r, yawOffBow, null, null);
    await sleep(100);
  }
}

async function shot(name) {
  if (ONLY && !ONLY.has(name)) return;
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  console.log('wrote', file);
}

const want = (name) => !ONLY || ONLY.has(name);

/** Wait out a long teleport's loading screen, then let the scene settle. */
async function settle(gpuMs, softMs) {
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
  await sleep(GPU ? gpuMs : softMs);
}

// Route A: Eastbrook to Moonrest's shore in the Nightbloom.
const A = await timing(0);
// Route B: Wickharbor to the shore below Wyrmwatch in the Drakelands.
const B = await timing(1);

// 1) Route A's ship lying at the Moonrest ferry pier, seen from the shore.
if (want('a_docked_moonrest')) {
  await setClock(A.docked + A.out + 20);
  await standAt(-486, 1509, -Math.PI / 2, -Math.PI / 2 + 0.55, 0.25, 22);
  await settle(6000, 12000);
  await lookAtShip(0, 0.45, 0.25, 22);
  await sleep(1500);
  await shot('a_docked_moonrest');
}

// 2) Route A under way: on deck, running north up the western shallows.
if (want('a_sailing')) {
  await setClock(A.docked + A.out * 0.62);
  await board(0, Math.PI * 0.85, 0.32, 16);
  await settle(1000, 1000);
  await holdCamera(0, Math.PI * 0.85, GPU ? 4000 : 8000);
  await shot('a_sailing');
}

// 3) Route A arriving at the Moonrest pier, seen from the pier.
if (want('a_arrival_moonrest')) {
  await setClock(A.docked + A.out - 12);
  await standAt(-498, 1507, Math.PI, Math.PI + 0.5, 0.22, 16);
  await settle(0, 0);
  await setClock(A.docked + A.out - 9);
  for (let i = 0; i < 30; i++) {
    await lookAtShip(0, 0.35, 0.22, 16);
    await sleep(150);
  }
  await shot('a_arrival_moonrest');
}

// 4) Route A casting off from Eastbrook and turning north, from the pier.
if (want('a_departure_eastbrook')) {
  await setClock(A.docked + 9);
  await standAt(-110, -54, -Math.PI / 2, -Math.PI / 2 - 0.35, 0.22, 14);
  await settle(4000, 2500);
  await shot('a_departure_eastbrook');
}

// 5) Route B's ship lying at the Wyrmwatch ferry pier, seen from the bank
//    top above the bluff stair.
if (want('b_docked_wyrmwatch')) {
  await setClock(B.docked + B.out + 20);
  await standAt(481, 1903, Math.PI / 2, Math.PI / 2 - 0.5, 0.3, 20);
  await settle(6000, 12000);
  await lookAtShip(1, -0.4, 0.3, 22);
  await sleep(1500);
  await shot('b_docked_wyrmwatch');
}

// 6) Route B under way: on deck in the deep strait along the Drakelands.
if (want('b_sailing')) {
  await setClock(B.docked + B.out * 0.8);
  await board(1, Math.PI * 0.8, 0.32, 16);
  await settle(1000, 1000);
  await holdCamera(1, Math.PI * 0.8, GPU ? 4000 : 8000);
  await shot('b_sailing');
}

// 7) Route B arriving: swinging round onto the Wyrmwatch pier.
if (want('b_arrival_wyrmwatch')) {
  await setClock(B.docked + B.out - 14);
  await standAt(501, 1899, Math.PI / 2, Math.PI / 2 - 0.3, 0.25, 16);
  await settle(0, 0);
  await setClock(B.docked + B.out - 11);
  for (let i = 0; i < 30; i++) {
    await lookAtShip(1, -0.35, 0.25, 18);
    await sleep(150);
  }
  await shot('b_arrival_wyrmwatch');
}

// 8) Route B through the widened Thornpeak neck.
if (want('b_neck')) {
  const t = await run(`
    const R = window.__ships.TRANSPORT_ROUTES[1];
    const F = window.__ferry;
    const p = { x: 0, z: 0, rot: 0 };
    let best = 0, bestD = Infinity;
    const T = F.transportVoyageSeconds(R, 0);
    for (let t = 0; t < T; t += 0.25) {
      F.transportShipPoseAt(R, R.timings.docked + t, p);
      const d = Math.hypot(p.x - 539.5, p.z - 767);
      if (d < bestD) { bestD = d; best = t; }
    }
    return best;
  `);
  // board once to stream the area in, then again once it has loaded (the
  // ship sailed on meanwhile), a few seconds short of the neck
  await setClock(B.docked + t - 4);
  await board(1, Math.PI, 0.45, 26);
  await settle(0, 0);
  await setClock(B.docked + t - 4);
  await board(1, Math.PI, 0.45, 26);
  await holdCamera(1, Math.PI, 3500);
  await shot('b_neck');
}

await browser.close();
