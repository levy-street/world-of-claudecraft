// Owner-facing captures of Lantern Hall, Highwatch's adventurers' guild
// (src/sim/content/highwatch_guild.ts, the model by scripts/assets/highwatch_guild/): the road and
// the gateway, the porch and the door, the great hall (the contracts board, the quartermaster's
// counter, the guildmaster's fireside, the map table), the trophy hall with every trophy and its
// Heroic gilding shown, the lantern tower and the back. Offline client, dev build, driven through
// window.__game the way scripts/mirefen_tavern_shot.mjs is.
//
//   npx vite --port 5195
//   GAME_URL=http://localhost:5195 SHOTS_DIR=tmp/guild GPU=1 node scripts/highwatch_guild_shot.mjs
//
// GPU=1 draws on the GPU (ANGLE over D3D11 on Windows, over Metal on macOS) rather than
// SwiftShader. GRAPHICS_PRESET picks the preset (1 low, 2 medium, 3 high, the default, 4 ultra).
// ONLY limits the run to a comma list of shot names; PREFIX and SUFFIX wrap every file name.
// DAYNIGHT sets the time (`/daynight day` by default, `/daynight night` for the lamps).
// TROPHIES=0 leaves the trophy room as a new character sees it (no clears, no trophies).
// MOBILE=1 emulates a landscape touch phone (pass WIDTH=844 HEIGHT=390 with it).
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5195';
const OUT = process.env.SHOTS_DIR ?? 'tmp/guild';
const PRESET = Number(process.env.GRAPHICS_PRESET ?? 3);
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const PREFIX = process.env.PREFIX ?? '';
const SUFFIX = process.env.SUFFIX ?? '';
const GPU = process.env.GPU === '1';
const WIDTH = Number(process.env.WIDTH ?? 1600);
const HEIGHT = Number(process.env.HEIGHT ?? 900);
const MOBILE = process.env.MOBILE === '1';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    `--window-size=${WIDTH},${HEIGHT}`,
    ...(GPU
      ? [
          `--use-angle=${process.platform === 'darwin' ? 'metal' : 'd3d11'}`,
          '--enable-gpu',
          '--ignore-gpu-blocklist',
        ]
      : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
  ],
  defaultViewport: { width: WIDTH, height: HEIGHT },
});
const page = await browser.newPage();
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
if (process.env.TROPHIES !== '0') {
  // every dungeon cleared, on Heroic: the trophy room shows every trophy and its gilding
  console.log(
    'trophies',
    await run(`
      const { GUILD_TROPHY_DUNGEONS } = await import('/src/render/highwatch_guild_trophies_core.ts');
      const g = window.__game;
      const stats = g.sim.deedStats ?? g.sim.player?.deedStats;
      if (!stats) return 'no deedStats on the offline world';
      stats.dungeonClears = stats.dungeonClears ?? {};
      for (const d of GUILD_TROPHY_DUNGEONS) {
        stats.dungeonClears[d] = 1;
        stats.dungeonClears[d + ':heroic'] = 1;
      }
      return Object.keys(stats.dungeonClears).length;
    `),
  );
}

/** Stand the player at the guild's local (lx, lz) (its model frame: +x to a visitor's left, +z
 *  in through the door), the camera looking at local (tx, tz). */
async function standAndLook(lx, lz, tx, tz, pitch, dist) {
  await run(`
    const { HIGHWATCH_BUILDINGS_BY_ID } = await import('/src/sim/highwatch_layout.ts');
    const { localToWorld } = await import('/src/sim/placed_town_kit.ts');
    const G = HIGHWATCH_BUILDINGS_BY_ID.highwatch_guild;
    const p = localToWorld(G.placement, G.rotation, ${lx}, ${lz});
    const t = localToWorld(G.placement, G.rotation, ${tx}, ${tz});
    const g = window.__game;
    const pl = g.sim.player;
    const pos = g.sim.groundPos(p.x, p.z);
    pl.pos = { ...pos };
    pl.prevPos = { ...pos };
    pl.vx = 0; pl.vy = 0; pl.vz = 0;
    const yaw = Math.atan2(t.x - pos.x, t.z - pos.z);
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
  ['approach', -8.0, -34.0, 0.0, -4.0, 0.3, 24],
  ['approach_wide', 14.0, -44.0, 2.0, -2.0, 0.34, 34],
  ['gateway', -8.0, -29.0, -8.0, -20.0, 0.12, 8],
  ['porch', 0.0, -21.0, 0.0, -10.0, 0.18, 10],
  ['door_view', 0.0, -12.5, 0.0, 6.0, 0.12, 6],
  ['hall', 0.0, -7.0, 0.0, 12.0, 0.28, 10],
  ['hall_high', 0.0, -8.0, 0.0, 10.0, 0.65, 16],
  ['board', 7.5, 0.0, 14.0, 0.0, 0.22, 7],
  ['counter', -6.5, -1.0, -14.0, -1.0, 0.24, 7],
  ['fireside', -5.5, 6.6, -14.0, 6.6, 0.3, 7],
  ['recruit', 7.3, 1.8, 7.3, 9.0, 0.35, 7],
  ['trophy', 0.0, 12.6, 0.0, 20.0, 0.22, 6],
  ['trophy_left', -2.5, 15.2, 8.5, 15.4, 0.18, 6],
  ['trophy_right', 2.5, 15.2, -8.5, 15.4, 0.18, 6],
  ['tower', 30.0, -26.0, 18.0, -7.0, 0.22, 24],
  ['back', 6.0, 44.0, 0.0, 6.0, 0.3, 30],
];
for (const [name, x, z, tx, tz, pitch, dist] of SHOTS) {
  if (!want(name)) continue;
  await standAndLook(x, z, tx, tz, pitch, dist);
  await settle(5000);
  await standAndLook(x, z, tx, tz, pitch, dist);
  await sleep(1500);
  await shot(name);
}
await browser.close();
