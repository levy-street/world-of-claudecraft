// Before/after showcase for issue #2917 point 3: a rift boss windup
// telegraph (stomp/pulse) rides the mage 'runeCircle' ground ring
// (src/render/mage_ground_fx.ts spawnRune), which used to hardcode arcane
// regardless of the emitted mechanic's real school. Drives the real running
// renderer's handleEvent with a schooled 'spellfxAt' runeCircle event (the
// same event shape src/sim/mob/locomotion.ts startRiftMechanicWindup emits
// for a stomp/pulse windup), so the shot exercises the exact code path the
// fix touches, not a stand-in. Needs `npm run dev` (GAME_URL, default
// :5173). Env: SCHOOL (default 'fire'), SHOT_PATH (default
// tmp/rune_circle_school.png).
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const SCHOOL = process.env.SCHOOL ?? 'fire';
const SHOT_PATH = process.env.SHOT_PATH ?? 'tmp/rune_circle_school.png';
const VIEWPORT = { width: 1280, height: 800 };
const userDataDir = '/tmp/woc-rune-circle-school-profile';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync('tmp', { recursive: true });
fs.rmSync(userDataDir, { recursive: true, force: true });

let browser;
try {
  browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: [
      `--user-data-dir=${userDataDir}`,
      '--disable-crash-reporter',
      '--disable-crashpad',
      '--crash-dumps-dir=/tmp/woc-rune-circle-school-crash-dumps',
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
    defaultViewport: VIEWPORT,
  });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('CONSOLEERROR:', msg.text());
  });

  // Standing capture rule: seed the lowest graphics preset before boot.
  await page.evaluateOnNewDocument(
    "localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));",
  );

  await page.setViewport(VIEWPORT);
  await page.bringToFront();
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 180000 });
  const booted = await enterOfflineGame(page, { charClass: 'warrior', charName: 'Telegraph' });
  if (!booted) {
    console.error('FAIL: world did not boot before the timeout');
    process.exit(1);
  }

  const setup = await page.evaluate((school) => {
    const g = window.__game;
    const me = g.sim.player;
    // Face straight down +z so the follow camera frames the ring directly
    // ahead instead of the character's own back.
    me.facing = 0;
    g.renderer.handleEvent({
      type: 'spellfxAt',
      x: me.pos.x,
      z: me.pos.z + 4,
      school,
      fx: 'runeCircle',
      radius: 6,
      duration: 20,
    });
    return { x: me.pos.x, z: me.pos.z };
  }, SCHOOL);
  console.log('setup:', JSON.stringify({ school: SCHOOL, ...setup }));

  await sleep(900); // let the mote orbit/spoke pulse read as a live ring, not a first-frame pop
  await page.screenshot({ path: SHOT_PATH });
  console.log(`PASS: shot written to ${SHOT_PATH}`);
  if (pageErrors.length) {
    console.error('FAIL: page errors', JSON.stringify(pageErrors));
    process.exit(1);
  }
} finally {
  if (browser) await browser.close().catch(() => {});
}
