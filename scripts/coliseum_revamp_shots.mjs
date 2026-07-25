// One-off before/after capture for the Ashen Coliseum revamp PR: stages an
// OFFLINE 1v1 bout against an idle sparring bot (addPlayer + arenaQueueJoin
// for both pids; matchmaking teleports both onto the sands), then shoots a
// pulled-back pit overview, a spawn-eye view from each side, and a mobile
// landscape overview. Needs `npm run dev` on :5173 (or GAME_URL).
//   SHOT_PREFIX=after node scripts/coliseum_revamp_shots.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';
import { suppressGpuNotice } from './lib/gpu_notice_suppress.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const PREFIX = process.env.SHOT_PREFIX ?? 'after';
const OUT = process.env.SHOTS_DIR ?? 'tmp/coliseum-shots';
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

// Queue the local player and a freshly added bot into a 1v1; resolves once the
// bout is staged on the sands (countdown state already teleports both in).
const STAGE_BOUT = `(() => {
  const w = window.__game.world;
  const botPid = w.addPlayer('warrior', 'Sparring Bot');
  w.arenaQueueJoin();
  w.arenaQueueJoin(botPid);
  window.__botPid = botPid;
})()`;

async function stageArena(page) {
  await page.evaluate(STAGE_BOUT);
  await page.waitForFunction(
    () => {
      const w = window.__game.world;
      return w.arenaInfo?.match != null && w.player.pos.x > 2800;
    },
    { timeout: 20000, polling: 200 },
  );
  await sleep(2500); // let the interior modules build
}

// pos helpers run in-page; the offline world IS the Sim, so entity positions
// are directly writable (screenshot staging only, never a gameplay claim).
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
  // camera position sits at player minus (sin(yaw), cos(yaw)) * dist, so the
  // view direction IS camYaw: aim it where the fighter faces (down the pit).
  input.camDist = 13; input.camPitch = 0.42;
  input.camYaw = s.facing;
})()`;

async function shoot(page, name) {
  await sleep(900);
  await page.screenshot({ path: `${OUT}/${PREFIX}-${name}.png` });
  console.log(`shot ${PREFIX}-${name}`);
}

// ---- fiesta bout start (hazard ring visual), SHOT_FIESTA=1 only ----
if (process.env.SHOT_FIESTA) {
  const f = await browser.newPage();
  f.on('pageerror', (e) => errors.push(`[fiesta] ${e.message}`));
  await f.setViewport({ width: 1600, height: 900 });
  await suppressGpuNotice(f);
  await f.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
  const ok = await enterOfflineGame(f, { charClass: 'warrior', charName: 'Gladiator' });
  if (!ok) throw new Error('offline world did not boot');
  await f.evaluate(() => window.__game.world.startFiestaPractice());
  await f.waitForFunction(() => window.__game.world.player.pos.x > 2800, {
    timeout: 30000,
    polling: 200,
  });
  await sleep(1500);
  await f.evaluate(() => {
    const w = window.__game.world;
    const fighters = [...w.entities.values()].filter((e) => e.kind === 'player' && e.pos.x > 2800);
    const cx = fighters.reduce((s, e) => s + e.pos.x, 0) / fighters.length;
    const cz = fighters.reduce((s, e) => s + e.pos.z, 0) / fighters.length;
    const me = w.entities.get(w.playerId);
    me.pos.x = cx;
    me.pos.z = cz;
    me.prevPos = { ...me.pos };
    const input = window.__game.input;
    input.camDist = 38;
    input.camPitch = 1.32;
    input.camYaw = Math.PI;
  });
  await shoot(f, 'fiesta-start-desktop');
  await f.close();
  console.log(errors.length ? `PAGE ERRORS:\n${errors.join('\n')}` : 'no page errors');
  await browser.close();
  process.exit(0);
}

// ---- desktop ----
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push(`[desktop] ${e.message}`));
await page.setViewport({ width: 1600, height: 900 });
await suppressGpuNotice(page);
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
const booted = await enterOfflineGame(page, { charClass: 'warrior', charName: 'Gladiator' });
if (!booted) throw new Error('offline world did not boot');
await stageArena(page);
await page.evaluate(CENTER_CAM);
await shoot(page, 'overview-desktop');
await page.evaluate(AT_SPAWN('A'));
await shoot(page, 'spawn-a-desktop');
await page.evaluate(AT_SPAWN('B'));
await shoot(page, 'spawn-b-desktop');
await page.close();

// ---- mobile landscape ----
try {
  const mobile = await browser.newPage();
  mobile.on('pageerror', (e) => errors.push(`[mobile] ${e.message}`));
  await suppressGpuNotice(mobile);
  await mobile.emulate({
    viewport: { width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  await mobile.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
  await mobile.evaluate(() => document.body.classList.add('mobile-touch'));
  await enterOfflineGame(mobile, { charClass: 'warrior', charName: 'Gladiator' });
  await stageArena(mobile);
  await mobile.evaluate(CENTER_CAM);
  await shoot(mobile, 'overview-mobile');
  await mobile.close();
} catch (e) {
  errors.push(`MOBILE: ${e.message}`);
}

console.log(errors.length ? `PAGE ERRORS:\n${errors.slice(0, 8).join('\n')}` : 'no page errors');
await browser.close();
