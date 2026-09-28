// Owner-facing captures of the Mirefen tavern on the Fenbridge road
// (src/sim/content/mirefen_tavern.ts): from the road (the tankard sign), in the doorway, at the
// hearth ring, at the bar and its kitchen hatch, on the bard's stage, in the booths, in the
// tower's nook, round the hall at several orbits, and the player walking in and out through
// the front door (WALKS=1: a frame every few strides, the real movement kernel, several camera
// pitches, distances and angles). Offline client, dev build, driven through window.__game the
// way scripts/drakelands_harbor_shot.mjs is.
//
//   npx vite --port 5183
//   GAME_URL=http://localhost:5183 SHOTS_DIR=tmp/tavern GPU=1 node scripts/mirefen_tavern_shot.mjs
//
// GRAPHICS_PRESET picks the preset (1 low, 2 medium, 3 high, the default, 4 ultra). ONLY limits
// the run to a comma list of shot names; PREFIX and SUFFIX wrap every file name. WALKS=1 adds
// the walks in and out (WALKS_ONLY=1 takes only those).
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5183';
const OUT = process.env.SHOTS_DIR ?? 'tmp/tavern';
const PRESET = Number(process.env.GRAPHICS_PRESET ?? 3);
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const PREFIX = process.env.PREFIX ?? '';
const SUFFIX = process.env.SUFFIX ?? '';
const GPU = process.env.GPU === '1';
const WIDTH = Number(process.env.WIDTH ?? 1600);
const HEIGHT = Number(process.env.HEIGHT ?? 900);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The tavern's local frame (the door faces world +x): TAVERN_ORIGIN in the content. */
const ORIGIN = { x: -17, z: 408 };
const world = (lx, lz) => ({ x: ORIGIN.x + lz, z: ORIGIN.z - lx });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    `--window-size=${WIDTH},${HEIGHT}`,
    ...(GPU
      ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']
      : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
  ],
  defaultViewport: { width: WIDTH, height: HEIGHT },
});
const page = await browser.newPage();
// MOBILE=1 emulates a landscape touch phone (the pr_screenshots.mjs mobile metrics) so the
// mobile HUD draws; pass WIDTH=844 HEIGHT=390 with it.
const MOBILE = process.env.MOBILE === '1';
if (MOBILE) {
  await page.emulate({
    viewport: {
      width: WIDTH,
      height: HEIGHT,
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 1,
    },
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
}
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.evaluateOnNewDocument(`
  try { localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: ${PRESET}, graphicsDefaultApplied: true })); } catch {}
`);
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 180000 });
if (MOBILE) await page.evaluate(() => document.body.classList.add('mobile-touch'));
const booted = await enterOfflineGame(page, {
  charClass: 'warrior',
  charName: 'Wanderer',
  gameBootTimeoutMs: 240000,
  selectorTimeoutMs: 120000,
});
if (!booted) throw new Error('offline world did not boot');
await sleep(1500);

function run(body) {
  return page.evaluate(`(async () => { ${body} })()`);
}

await run(`window.__game.sim.setPlayerLevel(20);`);
await page.waitForSelector('#chat-input', { timeout: 120000 });
async function chat(line) {
  await page.evaluate((text) => {
    const box = document.querySelector('#chat-input');
    box.value = text;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }, line);
}
await chat(process.env.DAYNIGHT ?? '/daynight day');
await sleep(Number(process.env.DAYNIGHT_WAIT ?? 4000));
console.log(
  'graphics',
  await run(
    `const { GFX } = await import('/src/render/gfx.ts'); return GFX.tier + ' / effects ' + GFX.effectsTier;`,
  ),
);

/** Stand the player at local (lx, lz) on the floor, the camera looking at local (tx, tz). */
async function standAndLook(lx, lz, tx, tz, pitch, dist) {
  const p = world(lx, lz);
  const t = world(tx, tz);
  await run(`
    const g = window.__game;
    const pl = g.sim.player;
    const pos = g.sim.groundPos(${p.x}, ${p.z});
    pl.pos = { ...pos };
    pl.prevPos = { ...pos };
    pl.vx = 0; pl.vy = 0; pl.vz = 0;
    const yaw = Math.atan2(${t.x} - pos.x, ${t.z} - pos.z);
    pl.facing = yaw;
    pl.prevFacing = yaw;
    g.input.camYaw = g.renderer.camYaw = yaw;
    g.input.camPitch = g.renderer.camPitch = ${pitch};
    g.input.camDist = g.renderer.camDist = ${dist};
  `);
}

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
  if (process.env.CAMERA_DEBUG === '1') {
    console.log(
      name,
      await run(`
      const { interiorCameraInternalsForTest } = await import('/src/render/interior_camera.ts');
      const s = interiorCameraInternalsForTest.state();
      const g = window.__game;
      return { framing: s.active?.framing, lift: s.lift, swing: s.swing, cap: s.cap,
        position: g.renderer.camera.position.toArray(), pitch: g.renderer.camPitch,
        player: g.sim.player.pos, start: [s.startX, s.startY, s.startZ] };
    `),
    );
  }
  await run(
    `for (const id of ['#error-msg']) { const el = document.querySelector(id); if (el) el.style.visibility = 'hidden'; }`,
  );
  const file = path.join(OUT, `${PREFIX}${name}${SUFFIX}.png`);
  await page.screenshot({ path: file });
  console.log('wrote', file);
}

const want = (name) => !ONLY || ONLY.has(name);
// name, stand (local x, z), look at (local x, z), pitch, camera distance
const SHOTS = [
  ['exterior_road', 12.0, 30.0, 0.0, 2.0, 0.26, 30],
  ['exterior_north', 26.0, 10.0, 8.0, -6.0, 0.2, 20],
  ['doorway', 0.0, 12.9, 0.0, -10.0, 0.14, 5],
  ['hearth', 0.0, 8.3, 0.0, 2.4, 0.42, 9],
  ['bar', 7.35, -4.9, 9.0, -8.8, 0.18, 7],
  ['hatch', 9.0, -3.0, 9.4, -14.0, 0.12, 6],
  ['stage', -8.0, -4.0, -12.3, -12.0, 0.3, 8],
  ['booth', -9.6, -4.6, -14.0, -4.6, 0.25, 6],
  ['window_booth', -4.0, 8.0, -9.0, 12.5, 0.3, 7],
  ['nook_arch', -1.5, -7.0, -1.5, -20.0, 0.25, 8],
  ['nook_inside', -1.5, -16.0, -1.5, -22.0, 0.35, 7],
  ['nook_out', -1.5, -21.0, -1.5, 0.0, 0.3, 7],
  ['scale_table', -10.1, 2.2, -14.0, 0.2, 0.12, 6],
  ['scale_door', 0.0, 15.0, 0.0, 10.0, 0.05, 8],
  // the owner's spot by the long table (world -13, 418), the camera over the room behind him,
  // and the same spot orbited all the way round: no timber crosses the view
  ['owner_spot', -10.0, 4.0, -12.2, 11.0, 0.55, 9],
  ['owner_orbit_n', -10.0, 4.0, -10.0, 14.0, 0.45, 12],
  ['owner_orbit_e', -10.0, 4.0, 4.0, 4.0, 0.45, 12],
  ['owner_orbit_s', -10.0, 4.0, -10.0, -10.0, 0.45, 12],
  ['owner_orbit_w', -10.0, 4.0, -20.0, 4.0, 0.45, 12],
  ['hall_from_stage', -12.0, -10.5, 6.0, 8.0, 0.35, 12],
  ['hall_from_bar', 9.0, -5.0, -8.0, 6.0, 0.4, 14],
  ['hall_high', 0.0, -2.0, 0.0, 10.0, 0.75, 18],
  // the lit wall fireplace on the right wall, from beside its settle
  ['wall_fireplace', 11.2, 0.6, 14.6, 3.2, 0.6, 6.5],
  // the grounds and the front (the jettied storey, the terrace, the stable, the dog, the smoke)
  ['fachada_camino', 0.0, 32.0, 0.0, 10.0, 0.16, 16],
  ['fachada_camino_angulo', 12.0, 30.0, 0.0, 2.0, 0.26, 30],
  ['voladizo_cerca', -9.0, 17.2, -9.0, 13.0, 0.02, 6],
  ['ventanas_cerca', 9.0, 22.0, 9.0, 13.0, 0.1, 5],
  ['terraza', -3.0, 24.0, -11.0, 17.5, 0.35, 11],
  ['establo_carro', -22.0, 12.5, -23.5, 2.0, 0.28, 10],
  ['perro', 0.4, 16.8, -3.48, 15.95, 1.1, 3.0],
  ['chimenea_humo', 26.0, 18.0, 16.0, 2.0, 0.15, 26],
  ['lenera', 24.0, 10.0, 17.0, 6.0, 0.2, 9],
  ['humo_cerca', 36.0, 8.0, 16.0, 2.5, -0.15, 9],
];
const WALKS = process.env.WALKS === '1' || process.env.WALKS_ONLY === '1';
if (process.env.WALKS_ONLY !== '1') {
  for (const [name, x, z, tx, tz, pitch, dist] of SHOTS) {
    if (!want(name)) continue;
    await standAndLook(x, z, tx, tz, pitch, dist);
    await settle(5000);
    await standAndLook(x, z, tx, tz, pitch, dist);
    await sleep(1500);
    await shot(name);
  }
}

/** The player's local position (x, z). */
async function local() {
  return run(`
    const p = window.__game.sim.player.pos;
    return { x: ${ORIGIN.z} - p.z, z: p.x - ${ORIGIN.x} };
  `);
}

/** Walk the player in the real movement kernel from local (x0, z0) toward (x1, z1) (W held),
 *  the camera `yawOff` radians round from straight behind, taking a frame at each of `marks`
 *  (local z, crossed going the walk's way). */
async function walk(name, x0, z0, x1, z1, pitch, dist, yawOff, marks) {
  await standAndLook(x0, z0, x1, z1, pitch, dist);
  await run(`
    const g = window.__game;
    g.input.camYaw = g.renderer.camYaw = g.sim.player.facing + ${yawOff};
  `);
  await settle(3500);
  await run(`
    const g = window.__game;
    g.input.camYaw = g.renderer.camYaw = g.sim.player.facing + ${yawOff};
  `);
  await sleep(800);
  await shot(`${name}_00`);
  const dir = Math.sign(z1 - z0);
  await page.keyboard.down('w');
  let k = 1;
  const start = Date.now();
  for (const m of marks) {
    for (;;) {
      const p = await local();
      if ((p.z - m) * dir >= 0 || Date.now() - start > 20000) break;
      await sleep(15);
    }
    await shot(`${name}_${String(k).padStart(2, '0')}`);
    if (process.env.WALK_DEBUG === '1') {
      console.log(
        name,
        k,
        JSON.stringify(
          await run(`
            const ic = await import('/src/render/interior_camera.ts');
            const s = ic.interiorCameraInternalsForTest.state();
            const g = window.__game;
            const c = g.renderer.camera.position;
            const p = g.sim.player.pos;
            return { lz: p.x - ${ORIGIN.x}, lx: ${ORIGIN.z} - p.z, active: !!s.active, fp: s.firstPerson,
              lens: s.lensInside, lift: +s.lift.toFixed(3), swing: +s.swing.toFixed(3), boom: +s.boom.dist.toFixed(2),
              through: +s.through.toFixed(2), release: +s.release.toFixed(2),
              start: [+(s.startX - ${ORIGIN.x}).toFixed(2), +s.startY.toFixed(2), +(${ORIGIN.z} - s.startZ).toFixed(2)],
              self: [+(s.lastSelfX - ${ORIGIN.x}).toFixed(2), +s.lastSelfY.toFixed(2), +(${ORIGIN.z} - s.lastSelfZ).toFixed(2)],
              cam: [+(c.x - ${ORIGIN.x}).toFixed(2), +(c.y).toFixed(2), +(${ORIGIN.z} - c.z).toFixed(2)],
              yaw: +g.renderer.camYaw.toFixed(3), pitch: +g.renderer.camPitch.toFixed(3), dist: +g.renderer.camDist.toFixed(2) };
          `),
        ),
      );
    }
    k++;
  }
  await page.keyboard.up('w');
  await sleep(1200);
  await shot(`${name}_${String(k).padStart(2, '0')}_settled`);
}

if (WALKS) {
  const IN = [20, 17.5, 15.5, 14.5, 13.5, 12.5, 11, 9.5, 8, 6, 4, 2, 0, -2];
  const OUT = [4, 7, 9.5, 11.5, 13, 14, 15, 16.5, 18.5, 21];
  const walks = [
    // straight in, the default camera, a steep far camera (the owner's), a low close one
    ['walk_in_default', 0, 26, 0, -8, 0.32, 12, 0, IN],
    ['walk_in_steep', 0, 28, 0, -8, 0.75, 18, 0, IN],
    ['walk_in_low', 0, 24, 0, -8, 0.12, 6, 0, IN],
    // in at an angle, and with the camera swung off to the side
    ['walk_in_angle', -3.2, 22, 2.0, 6, 0.4, 12, 0, IN],
    ['walk_in_sidecam', 0, 26, 0, -8, 0.4, 12, 0.7, IN],
    // out again, the camera behind in the room
    ['walk_out_default', 6.5, -1, 1.0, 14, 0.32, 12, 0, OUT],
    ['walk_out_steep', 6.5, -1, 1.0, 14, 0.75, 18, 0, OUT],
  ];
  for (const [name, x0, z0, x1, z1, pitch, dist, yawOff, marks] of walks) {
    if (!want(name)) continue;
    await walk(name, x0, z0, x1, z1, pitch, dist, yawOff, marks);
  }
}
await browser.close();
