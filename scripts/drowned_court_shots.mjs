// Captures for the Drowned Court arena PR: stages an OFFLINE 1v1 bout against
// an idle sparring bot with the rotation's preferred parity forced (odd =
// Drowned Court, even = Ashen Coliseum contrast shot), then shoots a pit
// overview, spawn-eye views, the arena window's map row, and a mobile
// overview. Needs `npm run dev` on :5173 (or GAME_URL).
//   node scripts/drowned_court_shots.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';
import { suppressGpuNotice } from './lib/gpu_notice_suppress.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.SHOTS_DIR ?? 'tmp/drowned-court-shots';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 120000,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});

// Queue the local player and a bot into a 1v1 after forcing the rotation's
// preferred parity (1 = odd slot = Drowned Court, 2 = even = Coliseum).
const stageBout = (nextId) => `(() => {
  const w = window.__game.world;
  w.ctx.nextArenaMatchId = ${nextId};
  const botPid = w.addPlayer('warrior', 'Sparring Bot');
  w.arenaQueueJoin();
  w.arenaQueueJoin(botPid);
  window.__botPid = botPid;
})()`;

async function stageArena(page, nextId) {
  await page.evaluate(stageBout(nextId));
  await page.waitForFunction(
    () => {
      const w = window.__game.world;
      return w.arenaInfo?.match != null && w.player.pos.x > 2800;
    },
    { timeout: 20000, polling: 200 },
  );
  await sleep(2500); // let the interior modules build
}

const CENTER_CAM = `(() => {
  const w = window.__game.world;
  const me = w.entities.get(w.playerId);
  const bot = w.entities.get(window.__botPid);
  const cx = (me.pos.x + bot.pos.x) / 2, cz = (me.pos.z + bot.pos.z) / 2;
  window.__spawnA = { x: me.pos.x, z: me.pos.z, facing: me.facing };
  window.__spawnB = { x: bot.pos.x, z: bot.pos.z, facing: bot.facing };
  me.pos.x = cx; me.pos.z = cz; me.prevPos = { ...me.pos };
  const input = window.__game.input;
  input.camDist = 38; input.camPitch = 1.32; input.camYaw = Math.PI;
})()`;

const AT_SPAWN = (which) => `(() => {
  const w = window.__game.world;
  const me = w.entities.get(w.playerId);
  const bot = w.entities.get(window.__botPid);
  const s = window.${which === 'A' ? '__spawnA' : '__spawnB'};
  bot.pos.x = 4200; bot.pos.z = s.z > 0 ? s.z - 40 : s.z + 40; bot.prevPos = { ...bot.pos };
  me.pos.x = s.x; me.pos.z = s.z; me.prevPos = { ...me.pos };
  me.facing = s.facing;
  const input = window.__game.input;
  // the camera looks along +(sin camYaw, cos camYaw): aim it down the pit
  input.camDist = 13; input.camPitch = 0.42;
  input.camYaw = s.facing;
})()`;

async function shoot(page, name) {
  await sleep(900);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`shot ${name}`);
}

// Force the max graphics preset before the app boots and reads woc_settings
// (the tutorial_maxgfx recipe): the default preset 2 sheds the glow decals
// and shadow work that carry each map's mood, which is not what the PR
// comparison should judge.
async function forceMaxGfx(page) {
  await page.evaluateOnNewDocument(() => {
    // guarded: the hook also fires on about:blank, where localStorage throws
    try {
      localStorage.setItem(
        'woc_settings',
        JSON.stringify({
          graphicsPreset: 5,
          terrainDetail: 1,
          foliageDensity: 1,
          effectsQuality: 1,
          shadowQuality: 1,
          renderScale: 1,
          browserEffects: 1,
        }),
      );
    } catch {
      /* about:blank or a sandboxed frame: the real origin gets the next call */
    }
  });
}

// ---- desktop: Drowned Court (odd slot) ----
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push(`[desktop] ${e.message}`));
await page.setViewport({ width: 1600, height: 900 });
await suppressGpuNotice(page);
await forceMaxGfx(page);
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
if (!(await enterOfflineGame(page, { charClass: 'warrior', charName: 'Gladiator' })))
  throw new Error('offline world did not boot');
await stageArena(page, 1);
await page.evaluate(CENTER_CAM);
await shoot(page, 'drowned-overview-desktop');
await page.evaluate(AT_SPAWN('A'));
await shoot(page, 'drowned-spawn-a-desktop');
await page.evaluate(AT_SPAWN('B'));
await shoot(page, 'drowned-spawn-b-desktop');
// the arena window naming the map during the bout
await page.evaluate(() => window.__game.hud.toggleArena());
await shoot(page, 'drowned-arena-window-desktop');
await page.close();

// ---- desktop: Ashen Coliseum contrast (even slot) ----
const page2 = await browser.newPage();
page2.on('pageerror', (e) => errors.push(`[coliseum] ${e.message}`));
await page2.setViewport({ width: 1600, height: 900 });
await suppressGpuNotice(page2);
await forceMaxGfx(page2);
await page2.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
if (!(await enterOfflineGame(page2, { charClass: 'warrior', charName: 'Gladiator' })))
  throw new Error('offline world did not boot');
await stageArena(page2, 2);
await page2.evaluate(CENTER_CAM);
await shoot(page2, 'coliseum-overview-desktop');
await page2.close();

// ---- mobile landscape: Drowned Court ----
try {
  const mobile = await browser.newPage();
  mobile.on('pageerror', (e) => errors.push(`[mobile] ${e.message}`));
  await suppressGpuNotice(mobile);
  await forceMaxGfx(mobile);
  await mobile.emulate({
    viewport: { width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  await mobile.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
  await mobile.evaluate(() => document.body.classList.add('mobile-touch'));
  await enterOfflineGame(mobile, { charClass: 'warrior', charName: 'Gladiator' });
  await stageArena(mobile, 1);
  await mobile.evaluate(CENTER_CAM);
  await shoot(mobile, 'drowned-overview-mobile');
  await mobile.close();
} catch (e) {
  errors.push(`MOBILE: ${e.message}`);
}

console.log(errors.length ? `PAGE ERRORS:\n${errors.slice(0, 8).join('\n')}` : 'no page errors');
await browser.close();
