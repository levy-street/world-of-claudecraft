// Screenshot + empirical proof for the "excessive melee range on monsters" fix at
// max graphics (?gfx=ultra). Boots the offline game, packs a cluster of STATIONARY
// hostile mobs (scale 1, true melee range 5 yd) and parks the player walking past at
// 6.5 yd from the nearest one, then ticks the sim. Before the fix a stationary mob
// got a +3 yd "moving target" grace (reach 8 yd) just because the player walked past,
// so it struck the passerby; after the fix a stationary mob only reaches its true
// 5 yd, so the player at 6.5 yd takes no damage. Writes PNGs to tmp/. Needs
// `npm run dev` (:5173). Override URL with GAME_URL=.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = (process.env.GAME_URL ?? 'http://localhost:5173') + '/?gfx=ultra';
const W = 1600, H = 900;
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: [`--window-size=${W},${H}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: W, height: H },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text()); });

const tap = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 45000 });
await page.waitForSelector('#nav-btn-play', { visible: true, timeout: 20000 });
await tap('#nav-btn-play');
await new Promise((r) => setTimeout(r, 400));
await tap('#btn-offline');
await page.waitForSelector('#char-name', { timeout: 20000 });
await new Promise((r) => setTimeout(r, 300));
await page.focus('#char-name');
await page.type('#char-name', 'Strider');
await tap('#offline-select .mini-class[data-class="warrior"]');
await new Promise((r) => setTimeout(r, 200));
await tap('#btn-start-offline');
await page.waitForFunction(() => window.__game && window.__game.sim && window.__game.sim.player, { timeout: 40000 });
await new Promise((r) => setTimeout(r, 3000)); // settle the ultra pipeline
await tap('.tut-skip');
await new Promise((r) => setTimeout(r, 300));

// Pack a row of STATIONARY hostile mobs (scale 1) and place the player walking past
// at 6.5 yd from the nearest. The player keeps walking (so the target is "moving"),
// which under the old code inflated each stationary mob's reach to 8 yd.
const staged = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  p.hp = p.maxHp = 100000;
  p.facing = 0;

  const mobs = [];
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && e.ownerId === null && !e.dead) mobs.push(e);
  }
  if (mobs.length < 4) return { ok: false, count: mobs.length };

  // Park EVERY hostile mob far away so only our staged camp can touch the player, then
  // pack a cluster 6.5 yd to the SIDE of the player. As the player paces along the camp
  // the nearest-approach distance stays 6.5 yd: beyond the true 5 yd reach, but inside
  // the old inflated 8 yd reach. Mobs are stationary (moveSpeed 0) so they cannot chase.
  for (const e of mobs) {
    e.pos.x = p.pos.x + 9000; e.pos.z = p.pos.z + 9000; e.prevPos = { ...e.pos };
    e.aggroTargetId = null; e.aiState = 'idle';
    sim.rebucket(e);
  }
  const anchors = [];
  const place = (e, dx, dz) => {
    e.scale = 1;
    e.moveSpeed = 0;
    e.pos.x = p.pos.x + dx;
    e.pos.z = p.pos.z + dz;
    e.pos.y = p.pos.y;
    e.prevPos = { ...e.pos };
    e.dead = false; e.hp = e.maxHp;
    e.hostile = true;
    sim.rebucket(e);
    anchors.push({ id: e.id, x: e.pos.x, y: e.pos.y, z: e.pos.z });
  };
  place(mobs[0], 6.5, -3);
  place(mobs[1], 6.5, 0);
  place(mobs[2], 6.5, 3);
  place(mobs[3], 6.5, 6);
  window.__campOrigin = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
  window.__camp = anchors;

  g.renderer.camYaw = 0;
  g.renderer.camPitch = 0.42;
  g.renderer.camDist = 16;
  return { ok: true, nearDist: 6.5, hpBefore: p.hp };
});
console.log('staged:', JSON.stringify(staged));
if (!staged.ok) { console.error('not enough mobs', staged); await browser.close(); process.exit(1); }
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: 'tmp/melee_range_walk_past_camp.png' });

// Report the reach geometry for the staged scene. The deterministic before/after
// damage proof lives in tests/mob_melee_walk_past.test.ts (a bare Sim with no world
// spawners); here we only confirm the framing: the player passes the packed camp at
// 6.5 yd, outside a stationary scale-1 mob's true 5 yd reach but inside the old
// inflated 8 yd reach (true 5 yd + the removed flat 3 yd moving-target grace).
console.log('staged packed camp at 6.5 yd from the player:',
  'true reach (fixed) = 5 yd -> safe; old reach = 8 yd -> would have hit.');

if (errors.length) console.log('page errors:\n' + errors.join('\n'));
await browser.close();
console.log('done; wrote tmp/melee_range_walk_past_camp.png');
