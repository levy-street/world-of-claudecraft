// Owner-facing captures of sitting in the Mirefen tavern (src/sim/seat_anchor.ts, the chair
// clips in public/models/chars/players/sit_anims.glb): the player seated at the hearth, the
// bar, a booth, a chair, the tower's nook and the porch; the seated patrons; the walk in and
// sit down driven through the real pointer (a right-click on the seat); the innkeeper's goods
// and the rest-area badge. Offline client, dev build, driven through window.__game like
// scripts/mirefen_tavern_shot.mjs.
//
//   npx vite --port 5192
//   GAME_URL=http://localhost:5192 SHOTS_DIR=tmp/seats CLASS=mage GPU=1 node scripts/mirefen_tavern_seat_shot.mjs
//
// CLASS picks the class (default warrior); ONLY limits the run to a comma list of shot names;
// PREFIX and SUFFIX wrap every file name; DAYNIGHT sets the clock (default '/daynight day').
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5192';
const OUT = process.env.SHOTS_DIR ?? 'tmp/seats';
const CLASS = process.env.CLASS ?? 'warrior';
const PRESET = Number(process.env.GRAPHICS_PRESET ?? 3);
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const PREFIX = process.env.PREFIX ?? '';
const SUFFIX = process.env.SUFFIX ?? '';
const GPU = process.env.GPU === '1';
const WIDTH = Number(process.env.WIDTH ?? 1600);
const HEIGHT = Number(process.env.HEIGHT ?? 900);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const want = (name) => !ONLY || ONLY.has(name);

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
  charClass: CLASS,
  charName: 'Sitter',
  gameBootTimeoutMs: 240000,
  selectorTimeoutMs: 120000,
});
if (!booted) throw new Error('offline world did not boot');
await sleep(1500);

function run(body) {
  return page.evaluate(`(async () => { ${body} })()`);
}
await run(`window.__game.sim.setPlayerLevel(10);`);
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
await sleep(3000);

async function settle(ms) {
  await sleep(800);
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

/** A seat by id, from the live registry. */
async function seatOf(id) {
  return run(`
    const { seatById } = await import('/src/sim/seat_registry.ts');
    const s = seatById(${JSON.stringify(id)});
    return s ? JSON.parse(JSON.stringify(s)) : null;
  `);
}

/** Put the player on a floor point, standing, the camera on `yaw` (the way it looks). */
async function standAt(x, z, facing, yaw, pitch, dist) {
  await run(`
    const g = window.__game;
    const pl = g.sim.player;
    pl.sitting = false;
    pl.eating = null;
    pl.drinking = null;
    const pos = g.sim.groundPos(${x}, ${z});
    pl.pos = { ...pos };
    pl.prevPos = { ...pos };
    pl.vx = 0; pl.vy = 0; pl.vz = 0;
    pl.facing = ${facing};
    pl.prevFacing = ${facing};
    g.input.camYaw = g.renderer.camYaw = ${yaw};
    g.input.camPitch = g.renderer.camPitch = ${pitch};
    g.input.camDist = g.renderer.camDist = ${dist};
  `);
}

/** Sit the player on a seat through the sim's own command, framed from `around` radians
 *  round the seat's front (0 = face on). */
async function sitAndFrame(id, around, pitch, dist) {
  const s = await seatOf(id);
  if (!s) throw new Error(`no seat ${id}`);
  const yaw = s.facing + Math.PI + around;
  await standAt(s.standX, s.standZ, s.facing, yaw, pitch, dist);
  await settle(1500);
  await run(`window.__game.sim.sitOnSeat(${JSON.stringify(id)});`);
  await run(`
    const g = window.__game;
    g.input.camYaw = g.renderer.camYaw = ${yaw};
  `);
  await sleep(3500);
}

// name, seat, camera round the seat's front, pitch, distance
const SEATED = [
  ['sit_hearth', 'tavern_hearth_0_1', 0.9, 0.3, 5],
  ['sit_hearth_side', 'tavern_hearth_0_1', 1.35, 0.1, 4.5],
  ['sit_bar', 'tavern_barstool_2', 0.7, 0.14, 5.5],
  ['sit_bar_side', 'tavern_barstool_3', -1.3, 0.1, 4.5],
  ['sit_booth', 'tavern_settle_0_1', 0.4, 0.2, 5.5],
  ['sit_booth_side', 'tavern_settle_4_1', -0.9, 0.16, 5],
  ['sit_chair', 'tavern_chair_1', 0.6, 0.18, 5.5],
  ['sit_fire_settle', 'tavern_settle_6_0', 0.5, 0.15, 5.5],
  ['sit_turret', 'tavern_nook_2_0', 0.45, 0.2, 6],
  ['sit_longbench', 'tavern_longbench_1_1', 0.6, 0.18, 5.5],
  ['sit_stage', 'tavern_stool_3', 0.4, 0.14, 5.5],
  ['sit_porch', 'tavern_porch_0_0', 0.6, 0.16, 6],
  ['sit_terrace', 'tavern_terrace_1_1', -0.6, 0.12, 6],
];
for (const [name, id, around, pitch, dist] of SEATED) {
  if (!want(name)) continue;
  await sitAndFrame(id, around, pitch, dist);
  await shot(name);
}

// eating in the chair: the drink idle
if (want('sit_eat')) {
  await sitAndFrame('tavern_chair_3', 0.5, 0.16, 5);
  await run(`
    const g = window.__game;
    g.sim.addItem('baked_bread', 1);
    g.sim.player.hp = Math.max(1, g.sim.player.maxHp - 40);
    g.sim.useItem('baked_bread');
  `);
  await sleep(2600);
  await shot('sit_eat');
}

// the patrons: the two at the hearth, the drover at the bar, the mapmaker in her booth, each
// seen from where a player walking in would stand (local x, z), looking at the patron's seat
const ORIGIN = { x: -17, z: 408 };
const worldOf = (lx, lz) => ({ x: ORIGIN.x + lz, z: ORIGIN.z - lx });
const PATRONS = [
  ['patrons_hearth', 'tavern_hearth_2_0', -5.4, 1.2, 0.18, 5.5],
  ['patron_bar', 'tavern_barstool_1', 5.2, -3.3, 0.16, 5],
  ['patron_booth', 'tavern_settle_2_1', -7.8, 8.2, 0.22, 6],
];
for (const [name, id, lx, lz, pitch, dist] of PATRONS) {
  if (!want(name)) continue;
  const s = await seatOf(id);
  const at = worldOf(lx, lz);
  const yaw = Math.atan2(s.x - at.x, s.z - at.z);
  await standAt(at.x, at.z, yaw, yaw, pitch, dist);
  await settle(3500);
  await shot(name);
}

// the pointer: a right-click on a free chair walks the body there and sits it
if (want('click_sit')) {
  const s = await seatOf('tavern_chair_2');
  // a few strides off in the room, the camera behind the player looking at the chair
  const start = worldOf(6.2, 6.4);
  const yaw = Math.atan2(s.x - start.x, s.z - start.z);
  await standAt(start.x, start.z, yaw, yaw - 0.35, 0.32, 8);
  await settle(2500);
  const at = await run(`
    const g = window.__game;
    const v = g.renderer.camera.position.clone().set(${s.x}, ${s.seatY} + 0.05, ${s.z});
    v.project(g.renderer.camera);
    const c = document.querySelector('#game-canvas');
    return { x: (v.x * 0.5 + 0.5) * c.clientWidth, y: (-v.y * 0.5 + 0.5) * c.clientHeight, z: v.z };
  `);
  console.log('seat on screen at', JSON.stringify(at));
  // the click must land on the game canvas (a fading loading screen still takes it)
  for (let i = 0; i < 80; i++) {
    const top = await run(
      `const el = document.elementFromPoint(${at.x}, ${at.y}); return el ? el.id : '';`,
    );
    if (top === 'game-canvas') break;
    await sleep(250);
  }
  await page.mouse.move(at.x, at.y);
  await sleep(400);
  await shot('click_sit_00_hover');
  await page.mouse.click(at.x, at.y, { button: 'right' });
  for (let k = 1; k <= 8; k++) {
    await sleep(450);
    await shot(`click_sit_${String(k).padStart(2, '0')}`);
  }
  await sleep(2500);
  await shot('click_sit_09_seated');
  // and up again, standing in place (a /stand)
  await chat('/stand');
  for (let k = 10; k <= 12; k++) {
    await sleep(350);
    await shot(`click_sit_${k}_rise`);
  }
}

// the innkeeper's goods and the rest-area badge
if (want('vendor')) {
  const keeper = await run(`
    const g = window.__game;
    const e = [...g.sim.entities.values()].find((x) => x.templateId === 'innkeeper_maudie');
    return { id: e.id, x: e.pos.x, z: e.pos.z, f: e.facing };
  `);
  const px = keeper.x + Math.sin(keeper.f) * 3;
  const pz = keeper.z + Math.cos(keeper.f) * 3;
  await standAt(px, pz, keeper.f + Math.PI, keeper.f + Math.PI, 0.2, 6);
  await settle(2500);
  await run(`window.__game.hud.openQuestDialog(${keeper.id});`);
  await sleep(1500);
  await shot('vendor_dialog');
  // the goods: the dialog's browse button
  await run(`
    const b = [...document.querySelectorAll('button, .gossip-option, .qd-option')].find((el) =>
      /goods|browse|buy|trade/i.test(el.textContent || ''));
    if (b) b.click();
  `);
  await sleep(1500);
  await shot('vendor_window');
}
if (want('rested')) {
  const s = await seatOf('tavern_longbench_1_1');
  await standAt(s.standX, s.standZ, s.facing, s.facing + Math.PI + 0.5, 0.25, 7);
  await settle(2500);
  await run(
    `document.querySelector('#pf-rest')?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));`,
  );
  await sleep(800);
  await shot('rested_indicator');
}
await browser.close();
