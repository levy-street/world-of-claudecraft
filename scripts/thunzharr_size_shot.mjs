// Before/after screenshots of the Thunzharr world-boss size buff (scale 1.7 -> 3.4).
// Offline single-player; needs the dev server. Force-spawns the boss, pins it at its
// spawn, frames it from a fixed grounded vantage, and captures both sizes by toggling
// the live entity scale (same camera). Writes docs/screenshots/thunzharr-size-{before,after}.png.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync('docs/screenshots', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 60000,
  args: [
    '--window-size=1280,820',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
  ],
  defaultViewport: { width: 1280, height: 820 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 200)));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await sleep(800);
await page.evaluate(() => document.querySelector('#btn-offline')?.click());
await sleep(400);
await page.evaluate(() => {
  document.querySelector('#offline-select .mini-class[data-class="warrior"]')?.click();
  const n = document.querySelector('#char-name');
  if (n) n.value = 'Bosscheck';
  document.querySelector('#btn-start-offline')?.click();
});
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 60000, polling: 300 });

await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.worldBossNextAt[0] = sim.time;
});
await page.waitForFunction(
  () =>
    [...window.__game.sim.entities.values()].some(
      (e) => e.templateId === 'thunzharr_waking_peak' && !e.dead,
    ),
  { timeout: 20000, polling: 300 },
);

// Record the boss's home so we can pin it there (idle mobs wander a few yards).
const home = await page.evaluate(() => {
  const sim = window.__game.sim;
  const boss = [...sim.entities.values()].find(
    (e) => e.templateId === 'thunzharr_waking_peak' && !e.dead,
  );
  window.__BOSS_ID = boss.id;
  window.__BOSS_HOME = { ...boss.pos };
  return boss.pos;
});
console.log('boss home:', JSON.stringify(home));

const DIST = 40; // yards south of the boss (past its 18yd aggro radius; keeps the player in frame as a scale anchor)
// Pin the boss at home and the player at a grounded vantage looking north at it.
const pin = () =>
  page.evaluate((dist) => {
    const sim = window.__game.sim;
    const boss = sim.entities.get(window.__BOSS_ID);
    if (!boss) return;
    boss.pos = { ...window.__BOSS_HOME };
    boss.prevPos = { ...window.__BOSS_HOME };
    boss.aiState = 'idle';
    boss.aggroTargetId = null;
    boss.inCombat = false;
    boss.wanderTarget = null;
    boss.wanderTimer = 999;
    boss.threat.clear();
    const p = sim.player;
    const g = sim.groundPos(window.__BOSS_HOME.x, window.__BOSS_HOME.z - dist);
    p.pos = { x: g.x, y: g.y, z: g.z };
    p.prevPos = { ...p.pos };
    p.vx = 0;
    p.vy = 0;
    p.vz = 0;
    p.facing = 0; // +z, straight at the boss
  }, DIST);

for (let i = 0; i < 10; i++) {
  await pin();
  await sleep(200);
}

async function shot(scale, name) {
  await pin();
  await page.evaluate((s) => {
    sim_boss().scale = s;
    function sim_boss() {
      return window.__game.sim.entities.get(window.__BOSS_ID);
    }
  }, scale);
  await pin();
  await sleep(1200);
  await page.screenshot({ path: `docs/screenshots/${name}.png` });
  console.log(`shot ${name}: scale ${scale}`);
}

// "After" = the boss at its actual (current) template scale; "before" = an old 1.7x.
const spawnedScale = await page.evaluate(
  () => window.__game.sim.entities.get(window.__BOSS_ID).scale,
);
console.log('spawned (after) scale:', spawnedScale);
await shot(spawnedScale, 'thunzharr-size-after');
await shot(1.7, 'thunzharr-size-before');

await browser.close();
console.log('done');
