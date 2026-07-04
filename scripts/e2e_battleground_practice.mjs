// E2E smoke of the Gravemarch battleground practice flow on the OFFLINE
// client: queue indicator, practice match creation (9 bots), countdown, the
// in-match HUD strip, the minimap schematic, a mid-lane minion clash, and a
// bulwark rubble swap. Needs `npm run dev` (GAME_URL, default
// http://localhost:5210). Output via SHOT_DIR (default tmp/bg_e2e).
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5210';
const OUT = process.env.SHOT_DIR ?? 'tmp/bg_e2e';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  protocolTimeout: 120000,
  args: [
    '--no-sandbox',
    '--window-size=1600,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(`${URL}/?gfx=high`, { waitUntil: 'networkidle0', timeout: 60000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(400);
await page.type('#char-name', 'Smoke');
await page.evaluate(() => {
  document.querySelector('#offline-select .mini-class[data-class="warrior"]').click();
  document.querySelector('#btn-start-offline').click();
});
await page.waitForFunction(() => Boolean(window.__game?.sim), { timeout: 60000, polling: 500 });
await sleep(1500);

async function shot(name, waitMs = 800) {
  await sleep(waitMs);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('wrote', `${OUT}/${name}.png`);
}

// Advance the offline sim quickly (dev-only trick: extra ticks between frames).
async function fastForward(seconds) {
  await page.evaluate((s) => {
    const g = window.__game;
    for (let i = 0; i < 20 * s; i++) g.sim.tick();
  }, seconds);
}

// 1. The Battlegrounds window + queued indicator: queue solo (no practice yet),
// the indicator must show the queue state.
await page.evaluate(() => {
  const g = window.__game;
  g.sim.setPlayerLevel(20);
  g.hud.toggleBattleground();
  g.sim.bgQueueJoin();
});
await sleep(1200);
await shot('e2e1_window_queued');
const queuedIndicator = await page.evaluate(() => {
  const el = document.querySelector('#bg-indicator');
  return el && el.style.display !== 'none' ? el.textContent : null;
});
console.log('CHECK queued indicator:', JSON.stringify(queuedIndicator));

// 2. Leave the queue, start a practice match, ride the countdown.
await page.evaluate(() => {
  const g = window.__game;
  g.sim.bgQueueLeave();
  g.hud.toggleBattleground(); // close the window
  g.sim.bgPracticeStart();
});
await page.waitForFunction(() => window.__game.sim.bgInfo?.match != null, {
  timeout: 30000,
  polling: 250,
});
await sleep(1000);
await shot('e2e2_countdown');
const matchState = await page.evaluate(() => window.__game.sim.bgInfo.match.state);
console.log('CHECK match state during countdown:', matchState);

// 3. Into the fight: fast-forward past the countdown and to the first clash.
await fastForward(12); // countdown (10s) + a little
await page.waitForFunction(() => window.__game.sim.bgInfo?.match?.state === 'active', {
  timeout: 20000,
  polling: 250,
});
await fastForward(35); // first waves meet mid-lane
// Look at the west road from above the player's base half.
await page.evaluate(() => {
  const g = window.__game;
  const p = g.sim.player;
  const info = g.sim.bgInfo.match;
  const south = info.team === 'A';
  p.pos.x = info.origin.x - 50;
  p.pos.z = info.origin.z + (south ? -25 : 25);
  p.pos.y = 0;
  g.input.camYaw = south ? 0 : Math.PI;
  g.input.camPitch = 0.5;
  g.input.camDist = 20;
});
await shot('e2e3_lane_clash', 1600);
const counts = await page.evaluate(() => {
  const g = window.__game;
  let minions = 0;
  for (const e of g.sim.entities.values()) {
    if (e.templateId && e.templateId.startsWith('bg_') && !e.dead) minions++;
  }
  const m = g.sim.bgInfo.match;
  return { bgEntities: minions, timeLeft: m.timeLeft, killsA: m.killsA, killsB: m.killsB };
});
console.log('CHECK live battleground entities + score:', JSON.stringify(counts));

// 4. The match HUD strip + minimap schematic (zone label must read the
// battleground, not a vale zone).
const hudBits = await page.evaluate(() => {
  const strip = document.querySelector('.bg-hud-strip, #bg-hud-strip');
  const zone = document.querySelector('#zone-label');
  return {
    strip: strip ? strip.textContent.slice(0, 80) : null,
    zone: zone ? zone.textContent : null,
  };
});
console.log('CHECK hud strip + zone label:', JSON.stringify(hudBits));
await shot('e2e4_match_hud');

// 5. Structure kill: batter the enemy west outer bulwark down and watch the
// rubble swap (render state driven by bgInfo hpFrac/alive).
await page.evaluate(() => {
  const g = window.__game;
  const info = g.sim.bgInfo.match;
  const myTeam = info.team;
  const target = info.structures.find(
    (s) => s.team !== myTeam && s.kind === 'bulwark' && s.tier === 'outer' && s.lane === 'west',
  );
  const p = g.sim.player;
  p.pos.x = target.x - 8;
  p.pos.z = target.z - 6;
  g.input.camYaw = Math.atan2(-(target.x - p.pos.x), target.z - p.pos.z);
  g.input.camPitch = 0.3;
  g.input.camDist = 14;
  // find the structure entity by proximity and batter it (dev smoke only)
  for (const e of g.sim.entities.values()) {
    if (e.templateId === 'bg_bulwark' && Math.hypot(e.pos.x - target.x, e.pos.z - target.z) < 1) {
      for (let i = 0; i < 200 && !e.dead; i++) {
        g.sim.dealDamage(p, e, 500, false, 'physical', null, 'hit');
        g.sim.tick();
      }
    }
  }
});
await shot('e2e5_bulwark_down', 1800);
const structs = await page.evaluate(() => {
  const m = window.__game.sim.bgInfo.match;
  return m.structures.filter((s) => !s.alive).map((s) => s.id);
});
console.log('CHECK destroyed structures:', JSON.stringify(structs));

await browser.close();
console.log('done');
