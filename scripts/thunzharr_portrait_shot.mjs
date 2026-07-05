// One-off: retake docs/screenshots/thunzharr-boss.png as a proper boss portrait.
// Goals:
//   - Boss large and centered, nameplate clearly readable
//   - Target ring visible (player targets the boss)
//   - Zone-title fade-out hidden before capture
//   - Nearby non-boss mobs pushed far away to reduce nameplate clutter
//   - Camera very close (camDist 4-5) with shallow pitch
//
// Requires `npm run dev` on :5173 (or GAME_URL env var).

import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const BASE_URL = (process.env.GAME_URL ?? 'http://localhost:5173') + '/?gfx=ultra';
const OUT_DIR = path.resolve('docs/screenshots');
fs.mkdirSync(OUT_DIR, { recursive: true });
const OUT_PATH = path.join(OUT_DIR, 'thunzharr-boss.png');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--window-size=1600,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
  ],
  defaultViewport: { width: 1600, height: 900 },
});

const page = await browser.newPage();
page.on('pageerror', (e) => console.error('PAGEERROR:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE-ERR:', m.text());
});

// Boot the offline client as a warrior (class does not matter for a portrait)
await page.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 90000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(300);
await page.evaluate(() => {
  const card =
    document.querySelector('#offline-select .mini-class[data-class="warrior"]') ||
    document.querySelector('.class-card[data-class="warrior"]');
  card?.click();
});
await sleep(150);
await page.evaluate(() => {
  const n = document.querySelector('#char-name');
  if (n) n.value = 'Portrait';
});
await page.evaluate(() => document.querySelector('#btn-start-offline')?.click());

await page.waitForFunction(() => window.__game?.sim?.entities?.size > 5, {
  timeout: 120000,
  polling: 500,
});
await sleep(4000);

// Dismiss any tutorial overlay
await page.evaluate(() => {
  document.querySelector('.tut-skip')?.click();
  const skip = [...document.querySelectorAll('button, .tut-skip, a')].find((el) =>
    /skip tutorial/i.test(el.textContent || ''),
  );
  if (skip) skip.click();
});
await sleep(400);

// Level to 20 so the boss health formula is correct
await page.evaluate(() => window.__game.sim.setPlayerLevel(20));
await sleep(300);

// Force-spawn Thunzharr
await page.evaluate(() => {
  window.__game.sim.worldBossNextAt[0] = 0;
});

let bossId = null;
for (let i = 0; i < 60; i++) {
  await sleep(100);
  bossId = await page.evaluate(() => {
    for (const e of window.__game.sim.entities.values()) {
      if (e.templateId === 'thunzharr_waking_peak' && !e.dead) return e.id;
    }
    return null;
  });
  if (bossId !== null) break;
}

if (bossId === null) {
  console.error('Boss did not spawn. Aborting.');
  await browser.close();
  process.exit(1);
}
console.log('Boss spawned, id:', bossId);

// Push all non-boss mobs (Stormcrag Elementals, bats, etc.) far away so their
// nameplates do not crowd the frame. Runtime mutation only; src/ untouched.
await page.evaluate((bid) => {
  const sim = window.__game.sim;
  for (const e of sim.entities.values()) {
    if (e.id === bid) continue;
    if (e.kind === 'mob' || e.kind === 'critter') {
      e.pos = { x: e.pos.x + 3000, y: e.pos.y, z: e.pos.z + 3000 };
      if (e.prevPos) e.prevPos = { ...e.pos };
    }
  }
}, bossId);

// Position the player ON TOP of the boss so the camera (behind the player)
// is centered on the boss. Player is buried inside the boss model, so the
// boss fills the frame rather than the player. camDist=1 is near-first-person,
// bypassing the 3-unit clamp in zoomBy (direct assignment is unclamped).
await page.evaluate((bid) => {
  const g = window.__game;
  const boss = g.sim.entities.get(bid);
  const p = g.sim.player;
  if (!boss) return;

  // Place the player at the boss center (overlapping) so the camera orbits
  // around the boss position. camDist=6 puts the camera 6 units behind/south,
  // which should be just outside the boss mesh (scale=1.7 elemental extends
  // roughly 3-4 units). Pitch=0.25 tilts the camera slightly up so the
  // protrusions fill the frame from a heroic low angle.
  p.pos.x = boss.pos.x;
  p.pos.z = boss.pos.z;
  p.pos.y = boss.pos.y;
  p.prevPos = { ...p.pos };
  p.facing = -Math.PI;

  // Target the boss to show the red hostile ring and target frame
  p.targetId = bid;

  g.input.camDist = 6;
  g.input.camPitch = 0.25;
  g.input.camYaw = 0;
}, bossId);

// Hide any zone banners, chat log, player frame, and nameplates so the boss
// is the visual focus. The chat log contains "Entering Thornpeak Heights"
// which is noisy for a portrait, and the player frame is not needed.
await page.evaluate(() => {
  // Zone/subzone banners
  const el = document.querySelector('#subzone-banner');
  if (el) {
    el.style.opacity = '0';
    el.style.display = 'none';
  }
  for (const id of ['#zone-banner', '#zone-title', '#zone-label-banner']) {
    const b = document.querySelector(id);
    if (b) {
      b.style.opacity = '0';
      b.style.display = 'none';
    }
  }
  // Chat panel (outer wrapper that contains chatlog-tabs + chatlog-frame)
  const cw = document.querySelector('#chatlog-wrap');
  if (cw) cw.style.display = 'none';
  // Player unit frame (health/mana bar + name in bottom-center)
  const pf = document.querySelector('#player-frame');
  if (pf) pf.style.display = 'none';
  // Keep #nameplates visible so the boss nameplate renders; it also renders
  // a player self-nameplate node which we hide by selector below.
  document.querySelectorAll('.nameplate-self, [data-self="1"]').forEach((n) => {
    n.style.display = 'none';
  });
});

// Wait for the renderer to settle with the new camera position and for any
// remaining fade-out overlays to clear (~8 s as specified)
await sleep(8000);

// One more hide pass in case the subzone timer re-shows it during the wait
await page.evaluate(() => {
  const el = document.querySelector('#subzone-banner');
  if (el) {
    el.style.opacity = '0';
    el.style.display = 'none';
  }
  const cw = document.querySelector('#chatlog-wrap');
  if (cw) cw.style.display = 'none';
});

await page.screenshot({ path: OUT_PATH });
console.log('wrote', OUT_PATH);

await browser.close();

// Verify the file exists and is non-trivially sized
const stat = fs.statSync(OUT_PATH);
console.log(`Output: ${OUT_PATH} (${(stat.size / 1024).toFixed(1)} KB)`);
