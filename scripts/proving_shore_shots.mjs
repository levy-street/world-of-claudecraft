// Proving Shore camp visuals: the Dawnrest Camp declutter (loose crates gone,
// mailbox off the outfitter's stall), the guild notice board that replaced
// them, the pier ferry bell stood clear of the planks, and the Eastbrook bell
// beside the town mailbox. Offline flow (no server). Needs `npm run dev`.
//   GAME_URL=http://localhost:5173 node scripts/proving_shore_shots.mjs
// Writes PNGs to tmp/.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  // Same cold-dev-server allowance as the E2E: one CDP call may block while
  // Vite is still transforming the module graph on the page's main thread.
  protocolTimeout: 240_000,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--window-size=1600,960',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  defaultViewport: { width: 1600, height: 960 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.evaluate(() => localStorage.clear());
const booted = await enterOfflineGame(page, {
  charClass: 'warrior',
  charName: 'Prover',
  gameBootTimeoutMs: 180_000,
  selectorTimeoutMs: 60_000,
});
if (!booted) throw new Error('offline world did not boot');
await page.evaluate(() => document.querySelector('.gpu-notice-dismiss')?.click());
// The spawn greeting would sit over every shot; dismiss it and take the walk
// to the island by hand instead.
await page.waitForFunction(() => !!document.getElementById('tutorial-greeting'), {
  timeout: 15000,
  polling: 200,
});
await page.evaluate(() => document.querySelector('#tutorial-greeting [data-play]')?.click());
await page.waitForFunction(
  () => {
    const sim = window.__game.sim;
    return sim.entities.get(sim.playerId).pos.x < -180;
  },
  { timeout: 15000, polling: 200 },
);
// Odo's arrival note reuses the greeting shell; close it before shooting.
await sleep(800);
await page.evaluate(() => document.querySelector('#tutorial-greeting [data-close]')?.click());

// Stand the camera where a player would be looking at each subject. Setting
// pos directly is the offline sim's own state, the same thing a walk would
// produce, and the renderer reads it on the next frame; the chase camera is
// aimed through the same input fields the other shot scripts drive.
const stand = async (x, z, yaw, dist = 7, pitch = 0.22) => {
  await page.evaluate(
    ({ px, pz, py, d, pi }) => {
      const g = window.__game;
      const p = g.sim.entities.get(g.sim.playerId);
      p.pos.x = px;
      p.pos.z = pz;
      p.facing = py;
      const inp = g.input;
      inp.camYaw = py;
      inp.camDist = d;
      inp.camPitch = pi;
    },
    { px: x, pz: z, py: yaw, d: dist, pi: pitch },
  );
  await sleep(2500); // terrain + prop streaming under software GL
};

const shot = async (name) => {
  // Odo's note and the zone banner both re-arm as the teleports cross the
  // strait, and either would sit across the subject. Clear the note, then let
  // the banner finish its fade before the shutter.
  await page.evaluate(() => {
    const note = document.getElementById('tutorial-greeting');
    note?.querySelector('button')?.click();
  });
  await sleep(4000);
  await page.screenshot({ path: `tmp/proving-shore-${name}.png` });
  console.log('shot', name);
};

// Aim at a subject rather than guessing a heading: stand a few yards off and
// let the yaw fall out of the bearing to it.
const look = (from, at, opts = {}) =>
  stand(from.x, from.z, Math.atan2(at.x - from.x, at.z - from.z), opts.dist, opts.pitch);

// The arrival view: what a newcomer actually sees the moment the ferry sets
// them down at the Gauntlet's mouth (the talk-to-Tam card is up, the quest
// not yet accepted).
await look({ x: -281, z: -18 }, { x: -283, z: -21 }, { dist: 8, pitch: 0.18 });
await shot('arrival-view');

// The rest of the pass runs the card's later lessons, so take the quest now.
await page.evaluate(() => window.__game.sim.acceptQuest('q_ps_the_gauntlet'));

// The Gauntlet's gate: Warden Tam, the entrance braziers, and lane 1
// running west between its walls.
await look({ x: -280, z: -14 }, { x: -296, z: -16 }, { dist: 9, pitch: 0.22 });
await shot('gauntlet-gate');

// The first elbow: flag 1 where lane 1 turns into the southward lane 2.
await look({ x: -300, z: -16 }, { x: -308, z: -22 }, { dist: 9, pitch: 0.25 });
await shot('gauntlet-elbow');

// The finish: lane 3 running west to the red flag and Overseer Pell beyond.
await look({ x: -322, z: -31.5 }, { x: -335, z: -33 }, { dist: 9, pitch: 0.2 });
await shot('gauntlet-finish');

// The relay's north leg: Tidewarden Nel just up from the wreck line, the
// first castaway crates on her long path toward camp behind her.
await look({ x: -378, z: -20 }, { x: -368, z: -10 }, { dist: 11, pitch: 0.25 });
await shot('relay-north');

// The widened practice yard: five effigies over an 11-yard spread.
await look({ x: -324, z: -16 }, { x: -338, z: -14 }, { dist: 12, pitch: 0.3 });
await shot('practice-yard');

// The widened camp from its east gate: Maren at the junction, the stall row
// on the north edge, tents by the muster fire, and the perimeter rail.
await look({ x: -292, z: 48 }, { x: -310, z: 52 }, { dist: 12, pitch: 0.32 });
await shot('camp-overview');

// Bursar Wick's strongbox desk at the camp's quiet west end (-325, 42),
// now facing north-west over the water.
await look({ x: -318, z: 45 }, { x: -324, z: 42.5 }, { dist: 8, pitch: 0.2 });
await shot('wick-desk');

// The notice board south of the camp gate at (-312, 40), facing north.
await look({ x: -312, z: 46 }, { x: -312, z: 40 }, { dist: 6, pitch: 0.15 });
await shot('notice-board');

// The scaled-up pier and rowboat, from the shore looking out.
await look({ x: -280, z: 2 }, { x: -270, z: 0.5 }, { dist: 11, pitch: 0.25 });
await shot('pier');

// The Gauntlet at NIGHT: the fence lanterns are the course's only light, so
// this is the proof they carry it. /daynight through real chat, the
// streetlamp_night_shots.mjs recipe.
async function setTimeOfDay(arg) {
  const marker = `time of day set to ${arg}`;
  const before = await page.evaluate(
    (m) => (document.querySelector('#chatlog')?.textContent ?? '').split(m).length - 1,
    marker,
  );
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Enter');
  await sleep(500);
  await page.click('#chat-input').catch(async () => {
    await page.focus('#chat-input');
  });
  await sleep(200);
  await page.evaluate((a) => {
    const c = document.querySelector('#chat-input');
    c.value = `/daynight ${a}`;
    c.dispatchEvent(new Event('input', { bubbles: true }));
  }, arg);
  await page.keyboard.press('Enter');
  const took = await page
    .waitForFunction(
      (m, n) => (document.querySelector('#chatlog')?.textContent ?? '').split(m).length - 1 > n,
      { timeout: 15000 },
      marker,
      before,
    )
    .then(() => true)
    .catch(() => false);
  if (!took) throw new Error(`/daynight ${arg} did not register in #chatlog`);
  await page.evaluate(() => document.querySelector('#chat-input')?.blur());
  await sleep(30000); // the grade lerps in (slowly, under software GL)
}
await setTimeOfDay('night');
await look({ x: -288, z: -16 }, { x: -304, z: -18 }, { dist: 9, pitch: 0.2 });
await shot('gauntlet-night');

await browser.close();
console.log('proving shore shots written to tmp/');
