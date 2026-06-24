// Screenshot proof for the Tab targeting fix at max graphics (?gfx=ultra).
// Boots the offline game, relocates two hostile mobs around the player (one in
// front / on screen and farther, one closer but directly behind), aligns the
// camera with the player's facing, then presses Tab. Before the fix Tab picked
// the nearest mob (behind, off screen); after the fix it picks the on-screen
// one. Writes PNGs to tmp/. Needs `npm run dev` (:5173). Override URL with
// GAME_URL=.
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
await page.type('#char-name', 'Tabby');
await tap('#offline-select .mini-class[data-class="warrior"]');
await new Promise((r) => setTimeout(r, 200));
await tap('#btn-start-offline');
await page.waitForFunction(() => window.__game && window.__game.sim && window.__game.sim.player, { timeout: 40000 });
await new Promise((r) => setTimeout(r, 3000)); // settle the ultra pipeline
await tap('.tut-skip'); // dismiss the new-adventurer tutorial overlay for a clean frame
await new Promise((r) => setTimeout(r, 300));

// Stage two hostile mobs around the player and look where the player faces.
const staged = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  p.hp = p.maxHp = 999999;
  p.facing = 0; // facing +Z

  const mobs = [];
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && e.ownerId === null && !e.dead) mobs.push(e);
  }
  if (mobs.length < 2) return { ok: false, count: mobs.length };

  const place = (e, dx, dz) => {
    e.pos.x = p.pos.x + dx;
    e.pos.z = p.pos.z + dz;
    e.pos.y = p.pos.y;
    e.prevPos = { ...e.pos };
    e.dead = false; e.hp = e.maxHp;
    sim.rebucket(e);
  };
  const front = mobs[0], behind = mobs[1];
  place(front, 1, 22);   // on screen, farther
  place(behind, 0, -6);  // off screen (behind), closer
  // Park any other nearby mobs far away so only our two are candidates.
  for (let i = 2; i < mobs.length; i++) place(mobs[i], 9000, 9000);

  g.renderer.camYaw = 0;      // look toward +Z, same as the player faces
  g.renderer.camPitch = 0.34;
  g.renderer.camDist = 13;
  sim.targetEntity(null);     // clear any current target
  return { ok: true, frontId: front.id, behindId: behind.id, frontName: front.name, behindName: behind.name };
});
console.log('staged:', JSON.stringify(staged));
if (!staged.ok) { console.error('not enough mobs', staged); await browser.close(); process.exit(1); }
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: 'tmp/tab_target_01_no_target.png' });

// Press Tab: the fix selects the on-screen mob, not the closer one behind.
await page.keyboard.press('Tab');
await new Promise((r) => setTimeout(r, 1200));
const sel = await page.evaluate(() => {
  const sim = window.__game.sim;
  return { targetId: sim.player.targetId };
});
console.log('after Tab, targetId =', sel.targetId,
  sel.targetId === staged.frontId ? '(ON-SCREEN mob, correct)' : '(WRONG: behind mob)');
await page.screenshot({ path: 'tmp/tab_target_02_after_tab.png' });

if (errors.length) console.log('page errors:\n' + errors.join('\n'));
await browser.close();
console.log('done; wrote tmp/tab_target_01_no_target.png and tmp/tab_target_02_after_tab.png');
