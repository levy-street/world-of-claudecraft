// Screenshot pack for the Protect Yumi PR: the play window (Arena + Protect
// Yumi sections) on desktop and phone portrait, and, on the feature branch,
// the in-match extras (the `(?)` mystery orb and the hold-to-grab bar).
// Offline world, no server needed beyond `npm run dev`.
//
//   GAME_URL=http://localhost:5173 SHOT_PREFIX=after SHOTS=all \
//     node scripts/yumi_review_screens.mjs
//
// SHOTS=window captures only the play window (for a base checkout that
// predates the match extras). PNGs land in tmp/ (gitignored); the keepers are
// copied into docs/screenshots by hand.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const PREFIX = process.env.SHOT_PREFIX ?? 'after';
const SHOTS = process.env.SHOTS ?? 'all';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync('tmp', { recursive: true });

const shot = (name) => `tmp/${PREFIX}-${name}.png`;

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 60000,
  // Anti-throttle so the offline rAF loop keeps ticking headless.
  args: [
    '--window-size=1280,820',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
  defaultViewport: { width: 1280, height: 820 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error(`PAGEERROR: ${e.message}`));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await sleep(800);
await page.evaluate(() => {
  document.querySelector('#btn-offline')?.click();
});
await sleep(400);
await page.evaluate(() => {
  document.querySelector('#offline-select .mini-class[data-class="warrior"]')?.click();
  const name = document.querySelector('#char-name');
  if (name) name.value = 'Yumishots';
  document.querySelector('#btn-start-offline')?.click();
});
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 60000, polling: 300 });
// The world is up once the loading screen fades (a cold vite cache can hold it
// for a while).
await page.waitForFunction(
  () => {
    const ls = document.getElementById('loading-screen');
    return ls && !ls.classList.contains('visible');
  },
  { timeout: 120000, polling: 500 },
);
// A fresh headless profile has never seen the spawn cinematic, which hides the
// whole #ui layer while its village flyover runs: Escape is the skip gesture.
await sleep(600);
await page.keyboard.press('Escape');
await page.waitForFunction(
  () => {
    const ui = document.getElementById('ui');
    return ui && getComputedStyle(ui).display !== 'none';
  },
  { timeout: 15000, polling: 300 },
);
await sleep(2000); // let the HUD + first-frame renders settle
// Dismiss the first-run onboarding coach so its card does not overlap the shot.
await page.evaluate(() => {
  document.querySelector('.tut-skip')?.click();
});
await sleep(500);

// ---- The play window (Arena + Protect Yumi sections) ----------------------
await page.evaluate(() => {
  window.__game.hud.toggleArena();
});
await sleep(900);
await page.screenshot({ path: shot('play-window-desktop') });
console.log(`wrote ${shot('play-window-desktop')}`);

await page.setViewport({ width: 375, height: 812 });
await sleep(900);
await page.screenshot({ path: shot('play-window-mobile') });
console.log(`wrote ${shot('play-window-mobile')}`);

await page.setViewport({ width: 1280, height: 820 });
await sleep(400);
await page.evaluate(() => {
  window.__game.hud.toggleArena(); // close it again
});

if (SHOTS === 'all') {
  // ---- In-match: the `(?)` orb + the hold-to-grab bar ----------------------
  await page.evaluate(() => {
    const sim = window.__game.sim;
    sim.setPlayerLevel(20);
    const classes = ['warrior', 'mage', 'rogue', 'hunter', 'druid'];
    const pids = [sim.playerId, ...classes.map((c, i) => sim.addPlayer(c, `Bot${i}`))];
    for (const pid of pids) sim.arenaQueueJoin(pid, 'yumi3');
  });
  await page.waitForFunction(
    () => {
      const sim = window.__game.sim;
      const m = sim.arenaMatchFor(sim.playerId);
      return !!m && m.state === 'active';
    },
    { timeout: 30000, polling: 300 },
  );
  await sleep(2500); // maze interior + HUD strip

  // Spawn an orb now, park it READY right in front of the player, and face it.
  await page.evaluate(() => {
    const sim = window.__game.sim;
    const m = sim.arenaMatchFor(sim.playerId);
    m.yumi.powerupTimer = 0.05;
  });
  await page.waitForFunction(
    () => {
      const sim = window.__game.sim;
      const m = sim.arenaMatchFor(sim.playerId);
      return m && m.yumi.powerups.length > 0;
    },
    { timeout: 10000, polling: 200 },
  );
  await page.evaluate(() => {
    const g = window.__game;
    const sim = g.sim;
    const p = sim.player;
    const m = sim.arenaMatchFor(sim.playerId);
    const orb = m.yumi.powerups[0];
    orb.state = 'ready';
    orb.timer = 20;
    // Park the orb 4yd ahead of the player and look at it (offline sim state
    // is local and mutable, so this is a legitimate staging trick).
    orb.x = p.pos.x;
    orb.z = p.pos.z - 4;
    p.facing = Math.atan2(orb.x - p.pos.x, orb.z - p.pos.z);
    if (g.input) g.input.camYaw = p.facing;
    // A stable mid-channel grab bar: the bar paints off the entity fields, and
    // nothing decrements them unless a real channel is in the grab map.
    p.yumiGrabRemaining = 0.9;
    p.yumiGrabTotal = 1.8;
  });
  await sleep(1200);
  await page.screenshot({ path: shot('yumi-orb-grab-desktop') });
  console.log(`wrote ${shot('yumi-orb-grab-desktop')}`);

  await page.setViewport({ width: 375, height: 812 });
  await sleep(900);
  await page.screenshot({ path: shot('yumi-orb-grab-mobile') });
  console.log(`wrote ${shot('yumi-orb-grab-mobile')}`);
}

await browser.close();
console.log('done');
