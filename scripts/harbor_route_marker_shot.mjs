// Owner-facing captures of the harbor route markers (src/sim/content/harbor_route_markers.ts):
// each berth's signpost at a medium and a long gameplay distance, the player standing
// beside it for scale, with the ferry lying at the berth. Offline client, dev build,
// driven through window.__game (the capture moves the player and the ferry clock the
// way scripts/ferry_voyage_shot.mjs does).
//
//   npx vite --port 5176
//   GAME_URL=http://localhost:5176 SHOTS_DIR=tmp/harbor-markers GPU=1 node scripts/harbor_route_marker_shot.mjs
//
// GRAPHICS_PRESET picks the preset (1 low, 2 medium, 3 high, the default, 4 ultra). ONLY limits
// the run to a comma list of shot names (for example `eastbrook_medium`); SUFFIX is
// appended to every file name (for example `_low`).
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5176';
const OUT = process.env.SHOTS_DIR ?? 'tmp/harbor-markers';
const PRESET = Number(process.env.GRAPHICS_PRESET ?? 3);
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
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
  window.__markers = await import('/src/sim/content/harbor_route_markers.ts');
  window.__marker = await import('/src/sim/harbor_route_markers.ts');
  // solar noon, whatever the live clock says (the /daynight dev override)
  (await import('/src/render/day_night_clock.ts')).setDayNightPhaseOverride(0.5);
`);
console.log(
  'graphics',
  await run(
    `const { GFX } = await import('/src/render/gfx.ts'); return GFX.tier + ' / effects ' + GFX.effectsTier;`,
  ),
);

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
  await sleep(ms);
}

/**
 * Put the ferry at marker `i`'s berth, stand the player beside the post, and
 * aim the camera at the board's sunlit face, `skew` radians round, `dist`
 * yards back.
 */
async function frame(i, skew, pitch, dist, flip = false) {
  await run(`
    const g = window.__game;
    const m = window.__markers.HARBOR_ROUTE_MARKERS[${i}];
    const R = window.__ships.TRANSPORT_ROUTES.find((r) => r.id === m.route);
    const berth = R.berths.findIndex((b) => b.id === m.berth);
    const F = window.__ferry;
    const clock = berth === 0 ? 20 : R.timings.docked + F.transportVoyageSeconds(R, 0) + 20;
    g.sim.transportClockOffset = clock - g.sim.time;
    const yaw = window.__marker.harborRouteMarkerYaw(m);
    // the board's two faces look along (sin yaw, cos yaw) and its opposite:
    // shoot the sunlit one (the renderer's one sun, gfx.ts SUN_DIR), with the
    // player standing under the board on the planks for scale
    const sun = (await import('/src/render/gfx.ts')).SUN_DIR;
    let nx = Math.sin(yaw), nz = Math.cos(yaw);
    if ((nx * sun.x + nz * sun.z < 0) !== ${flip}) { nx = -nx; nz = -nz; }
    const ax = Math.cos(yaw), az = -Math.sin(yaw);
    // behind the post, under the lantern, on the planks (the post stands on
    // the pier's edge stilt line and the board reaches along it)
    const px = m.x - ax * 1.3, pz = m.z - az * 1.3;
    const pos = g.sim.groundPos(px, pz);
    const p = g.sim.player;
    p.pos = { ...pos };
    p.prevPos = { ...pos };
    const face = Math.atan2(-nx, -nz) + ${skew};
    p.facing = face;
    p.prevFacing = face;
    p.vx = 0; p.vy = 0; p.vz = 0;
    g.input.camYaw = g.renderer.camYaw = face;
    g.input.camPitch = g.renderer.camPitch = ${pitch};
    g.input.camDist = g.renderer.camDist = ${dist};
  `);
}

async function shot(name) {
  // the ferry timetable panel sits over the top of the frame, where the
  // anchor roundel stands: hide it for the capture (it is HUD, not the sign)
  await run(
    `const el = document.querySelector('#ferry-hud'); if (el) el.style.visibility = 'hidden';`,
  );
  const file = path.join(OUT, `${name}${SUFFIX}.png`);
  await page.screenshot({ path: file });
  console.log('wrote', file);
}

const names = ['eastbrook', 'nightbloom', 'wickharbor', 'drakelands'];
const count = await run(`return window.__markers.HARBOR_ROUTE_MARKERS.length;`);
/** The long shot per berth: its swing off the board's face, and whether to
 *  shoot the shaded face instead (both shots: Wickharbor's sunlit side looks
 *  across the moored boats and the harbor buildings), so the camera sits over open water
 *  clear of the town's trees and roofs and of the bluff at Wyrmwatch. */
const LONG = {
  eastbrook: { skew: -0.3, flip: false },
  nightbloom: { skew: -0.3, flip: false },
  wickharbor: { skew: 0.3, flip: true },
  drakelands: { skew: 0.25, flip: false },
};
for (let i = 0; i < count; i++) {
  const berth = await run(`return window.__markers.HARBOR_ROUTE_MARKERS[${i}].berth;`);
  const name = names.includes(berth) ? berth : `marker${i}`;
  const long = LONG[name] ?? { skew: -0.3, flip: false };
  for (const [kind, skew, pitch, dist, wait, flip] of [
    ['medium', -0.45, 0.14, 12, 6000, long.flip],
    ['long', long.skew, 0.32, 30, 2500, long.flip],
  ]) {
    const shotName = `${name}_${kind}`;
    if (ONLY && !ONLY.has(shotName)) continue;
    await frame(i, skew, pitch, dist, flip);
    await settle(GPU ? wait : wait * 2);
    await frame(i, skew, pitch, dist, flip);
    await sleep(1200);
    await shot(shotName);
  }
}
await browser.close();
