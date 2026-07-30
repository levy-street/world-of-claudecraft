// Rift visual E2E: enter offline, drive the procedural rift via window.__game.world,
// and screenshot the overworld portal + several generated interiors (different seeds
// and a boss floor) to eyeball variety + confirm the render path does not throw.
// Needs `npm run dev` running (offline enables devCommands in the vite dev server).

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5174';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync('tmp/rift', { recursive: true });

const errors = [];
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 60000,
  args: ['--window-size=1280,760', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 760 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`);
});

console.log('loading + entering offline...');
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
// The one canonical pre-game entry flow (offline click-through, class card, the
// Welcome Screen continue, intro/tutorial/camera-prompt dismissal).
await enterOfflineGame(page, { charName: 'Rifter' });
await page.waitForFunction(() => !!window.__game?.world?.player, { timeout: 60000, polling: 200 });
await sleep(2500); // let assets + first frames settle
// God mode so the tester survives the group-tuned elites long enough to shoot.
await page.evaluate(() => window.__game.world.chat('/dev god', window.__game.world.player.id));
console.log('in-game (god on).');

// Drive a rift entirely through the offline sim seam, advancing frames between steps.
async function tick(frames = 40) {
  await page.evaluate(async (n) => {
    for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
  }, frames);
}

async function enterAndShoot(seed, level, label) {
  await page.evaluate(
    (s, l) => {
      const g = window.__game;
      g.world.enterRift(s, l, g.world.player.id);
    },
    seed,
    level,
  );
  await tick(60);
  const info = await page.evaluate(() => {
    const rf = window.__game.world.riftFloor;
    const p = window.__game.world.player.pos;
    return { rf, px: p.x, pz: p.z };
  });
  await page.screenshot({ path: `tmp/rift/${label}.png` });
  console.log(`${label}: floor=${JSON.stringify(info.rf)} playerX=${Math.round(info.px)}`);
  return info;
}

const shots = [];
shots.push(await enterAndShoot(101, 20, 'seed101_f0'));
shots.push(await enterAndShoot(202, 20, 'seed202_f0'));
shots.push(await enterAndShoot(303, 20, 'seed303_f0'));

// Descend seed 101 to the boss floor by clearing + walking the descent each floor.
await page.evaluate(
  (s, l) => {
    window.__game.world.enterRift(s, l, window.__game.world.player.id);
  },
  101,
  20,
);
await tick(20);
for (let guard = 0; guard < 8; guard++) {
  const done = await page.evaluate(() => {
    const w = window.__game.world;
    const inst = w.riftInstances.find((i) => i.partyKey !== null);
    if (!inst) return true;
    if (inst.floorIndex >= inst.floorCount - 1) return true;
    for (const id of inst.mobIds) {
      if (id === inst.bossId) continue;
      const e = w.entities.get(id);
      if (e) {
        e.hp = 0;
        e.dead = true;
      }
    }
    inst.litPylons = new Set(inst.pylonIds);
    return false;
  });
  if (done) break;
  await tick(30); // let updateRiftInstances open the descent
  await page.evaluate(() => {
    const w = window.__game.world;
    const inst = w.riftInstances.find((i) => i.partyKey !== null);
    if (inst?.descentId != null) {
      const d = w.entities.get(inst.descentId);
      if (d) {
        w.player.pos = { ...d.pos };
        w.player.hp = w.player.maxHp;
      }
    }
  });
  await tick(10);
}
await tick(20);
// Stand a few yards in front of the giant boss and face it for the shot.
const bossInfo = await page.evaluate(() => {
  const w = window.__game.world;
  const inst = w.riftInstances.find((i) => i.partyKey !== null);
  const boss = inst?.bossId != null ? w.entities.get(inst.bossId) : null;
  if (boss) {
    w.player.pos = { x: boss.pos.x, y: boss.pos.y, z: boss.pos.z - 16 };
    w.player.prevPos = { ...w.player.pos };
    w.player.facing = 0; // face +z toward the boss at the back
    w.player.hp = w.player.maxHp;
  }
  return { rf: w.riftFloor, bossScale: boss?.scale, bossHp: boss?.maxHp, bossName: boss?.name };
});
await tick(40);
await page.screenshot({ path: 'tmp/rift/seed101_boss.png' });
console.log(`boss floor: ${JSON.stringify(bossInfo)}`);

await browser.close();
console.log(`\nerrors during run: ${errors.length}`);
for (const e of errors.slice(0, 20)) console.log(`  ${e}`);
process.exit(errors.some((e) => e.startsWith('PAGEERROR')) ? 1 : 0);
