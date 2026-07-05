// Screenshot the Drowned Apse boss fight mid Tolling-Bells volley. Offline
// single-player; needs the dev server. Writes tmp/litany_boss_*.png.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync('tmp', { recursive: true });

const ALL_MODULES = [
  'litany_sluice',
  'litany_ledger',
  'litany_ring',
  'litany_baptistry',
  'litany_choir_loft',
  'litany_causeway',
  'litany_apse',
];

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

await page.evaluate(async () => {
  const lay = await import('/src/sim/delve_litany_layout.ts');
  const data = await import('/src/sim/data.ts');
  window.__LITANY_BOUNDS = lay.litanyModuleBounds;
  window.__delveModuleZOffset = data.delveModuleZOffset;
});

await page.evaluate((mods) => {
  const sim = window.__game.sim;
  sim.setPlayerLevel(14);
  sim.player.maxHp = 999999;
  sim.player.hp = 999999; // survive a few bell hits while we watch
  sim.enterDelve('drowned_litany', 'normal');
  const run = sim.delveRunForPlayer(sim.playerId);
  run.modules = mods.slice();
}, ALL_MODULES);
await sleep(2500);

// Jump straight to the Apse (module index 6).
await page.evaluate(() => {
  const sim = window.__game.sim;
  const run = sim.delveRunForPlayer(sim.playerId);
  while (run.moduleIndex < 6 && run.moduleIndex < run.modules.length - 1) {
    run.exitPortalOpen = true;
    sim.advanceDelveModule(run);
  }
});
await sleep(2600);

// Stand near the altar and force combat + an immediate bell volley.
const found = await page.evaluate(() => {
  const sim = window.__game.sim;
  const run = sim.delveRunForPlayer(sim.playerId);
  const zBase = window.__delveModuleZOffset(run.modules, run.moduleIndex);
  let boss = null;
  for (const e of sim.entities.values()) {
    if (e.templateId === 'sister_nhalia_drowned_canticle' && !e.dead) {
      boss = e;
      break;
    }
  }
  if (!boss) return { ok: false, reason: 'boss not found' };

  const p = sim.player;
  // Altar center per the apse layout spec: x=0, z=72 (room-local), offset by zBase.
  const ax = run.origin.x;
  const az = run.origin.z + zBase + 72;
  p.pos.x = ax;
  p.pos.z = az - 6; // a few yards south of the altar center, on the dais
  p.pos.y = 0;
  p.prevPos = { ...p.pos };
  p.facing = 0; // face +z toward the boss

  boss.pos.x = ax;
  boss.pos.z = az;
  boss.inCombat = true;
  boss.aiState = 'attack';

  if (!run.nhaliaBoss) return { ok: false, reason: 'no nhaliaBoss state yet' };
  run.nhaliaBoss.bellVolleyTimer = 0.01; // force a volley on the next tick
  return { ok: true, bossHp: boss.hp, playerPos: { x: p.pos.x, z: p.pos.z } };
});
console.log('setup:', JSON.stringify(found));

// Let a couple of sim ticks pass so the volley fires and bells start moving.
await sleep(600);

const bellState = await page.evaluate(() => {
  const sim = window.__game.sim;
  const run = sim.delveRunForPlayer(sim.playerId);
  const bells = run.nhaliaBoss?.bells ?? [];
  return { count: bells.length, sample: bells[0] ?? null };
});
console.log('bells:', JSON.stringify(bellState));

await sleep(500); // let bells travel a bit further out from the altar
await page.screenshot({ path: 'tmp/litany_boss_bells.png' });
console.log('shot boss+bells');

// Face the player directly at the nearest live bell entity and step back so
// it's framed, then shot again to see what the bell mesh actually looks like.
const faced = await page.evaluate(() => {
  const sim = window.__game.sim;
  const run = sim.delveRunForPlayer(sim.playerId);
  const bells = run.nhaliaBoss?.bells ?? [];
  if (!bells.length) return { ok: false, reason: 'no bells left' };
  const be = sim.entities.get(bells[0].entityId);
  if (!be || be.dead) return { ok: false, reason: 'bell entity gone' };
  const p = sim.player;
  const dx = be.pos.x - p.pos.x;
  const dz = be.pos.z - p.pos.z;
  p.facing = Math.atan2(dx, dz);
  return { ok: true, bellPos: { x: be.pos.x, z: be.pos.z }, dist: Math.hypot(dx, dz) };
});
console.log('faced:', JSON.stringify(faced));
await sleep(900); // let the chase cam swing to the new facing
await page.screenshot({ path: 'tmp/litany_boss_bell_closeup.png' });
console.log('shot bell closeup');

await browser.close();
console.log('done');
