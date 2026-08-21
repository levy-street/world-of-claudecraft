// Screenshots for the Highwatch practice row: the four target dummies on the
// hill above Highwatch, framed the two ways the row's layout is judged.
//
//   approach  a player standing where the walk-up from Highwatch arrives. This
//             is the framing the row was wrong in: laid along x it is seen
//             end-on, so the four bodies and their nameplates collapse into one.
//   overhead  the same spot from above, where the row's shape and its single
//             campfire are both visible at once.
//
// Boots the offline world once (no server, no dev commands), forces day so the
// two frames are comparable, then teleports the player per framing. Needs
// `npm run dev` running; browser via scripts/browser_path.mjs.
//
// Run:  GAME_URL=http://localhost:5173 SHOTS_DIR=docs/screenshots/<slug> \
//         SHOT_TAG=after node scripts/practice_row_shots.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.SHOTS_DIR ?? 'practice-row-shots';
const TAG = process.env.SHOT_TAG ?? 'shot';
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// The row's own coordinates (src/sim/content/practice_dummies.ts) and the
// Highwatch hub the approach framing stands on the line to.
const ROW = { x: -40, z: 651 };
const HUB = { x: 0, z: 660 };

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1280,760', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 760 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(URL, { waitUntil: 'load', timeout: 120000 });
const booted = await enterOfflineGame(page, {
  charClass: 'warrior',
  charName: 'Rowcheck',
  settleMs: 4000,
  selectorTimeoutMs: 60000,
  gameBootTimeoutMs: 180000,
});
if (!booted) {
  await browser.close();
  throw new Error('the offline world never booted');
}

// Day, so a before/after pair is not separated by the night grade.
await page.waitForSelector('#chat-input', { timeout: 120000 });
await page.evaluate(() => {
  const chat = document.querySelector('#chat-input');
  chat.value = '/daynight day';
  chat.dispatchEvent(new Event('input', { bubbles: true }));
  chat.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
});
await new Promise((r) => setTimeout(r, 8000));

function place(v) {
  return page.evaluate((s) => {
    const g = window.__game;
    const p = g.sim.player;
    p.pos.x = s.x;
    p.pos.z = s.z;
    p.prevPos.x = s.x;
    p.prevPos.z = s.z;
    p.facing = s.yaw;
    g.input.camYaw = s.yaw;
    g.input.camPitch = s.pitch;
    g.input.camDist = s.dist;
  }, v);
}

async function shot(name, v) {
  await place(v);
  await new Promise((r) => setTimeout(r, 9000));
  // The first-run camera picker and the software-GL notice mount late; clear
  // whichever is up right before the frame (idempotent).
  await page.evaluate(() => {
    for (const label of ['Confirm', 'Dismiss', 'Skip Tutorial']) {
      const btn = [...document.querySelectorAll('button')].find(
        (b) => b.textContent.trim() === label && b.getBoundingClientRect().width > 0,
      );
      btn?.click();
    }
  });
  await new Promise((r) => setTimeout(r, 800));
  const file = `${OUT}/${TAG}_${name}.png`;
  await page.screenshot({ path: file });
  log('wrote', file);
}

const yawTo = (fx, fz, tx, tz) => Math.atan2(tx - fx, tz - fz);

// Warm-up: stand at the row so the terrain and the dummy assets stream in
// before the first frame that has to look right.
await place({ x: ROW.x, z: ROW.z, yaw: 0, pitch: 0.3, dist: 12 });
await new Promise((r) => setTimeout(r, 12000));

// 1. The walk-up from Highwatch: the view a player actually gets.
await shot('approach', {
  x: -30,
  z: 650,
  yaw: yawTo(-30, 650, ROW.x, 653),
  pitch: 0.16,
  dist: 9,
});
// 2. From above, so the whole row's shape is visible at once.
await shot('overhead', {
  x: ROW.x,
  z: 653,
  yaw: yawTo(ROW.x, 653, HUB.x, HUB.z),
  pitch: 0.85,
  dist: 34,
});

await browser.close();
log('done');
