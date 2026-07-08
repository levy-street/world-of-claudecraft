// E2E smoke of the Vale Cup practice flow on the OFFLINE client: the window
// (nation/role/bracket picks), the queue indicator, a practice match with the
// countdown and kickoff, a deliberate ballKick goal with the fireworks frame,
// the match HUD strip, and the sport hotbar swap. Needs `npm run dev`
// (GAME_URL). Output via SHOT_DIR (default tmp/vcup_e2e).
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5174';
const OUT = process.env.SHOT_DIR ?? 'tmp/vcup_e2e';
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
await page.type('#char-name', 'Striker');
await page.evaluate(() => {
  document.querySelector('#offline-select .mini-class[data-class="warrior"]').click();
  document.querySelector('#btn-start-offline').click();
});
await page.waitForFunction(() => Boolean(window.__game?.sim), { timeout: 60000, polling: 500 });
await sleep(1500);

async function shot(name, waitMs = 900) {
  await sleep(waitMs);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('wrote', `${OUT}/${name}.png`);
}
async function fastForward(seconds) {
  await page.evaluate((s) => {
    const g = window.__game;
    for (let i = 0; i < 20 * s; i++) g.sim.tick();
  }, seconds);
}

// 1. Walk-up look: teleport to the Sowfield gate, verify presence label + window.
await page.evaluate(() => {
  const g = window.__game;
  const p = g.sim.player;
  g.sim.setPlayerLevel(20);
  p.pos.x = -11;
  p.pos.z = -80;
  p.pos.y = 0;
  g.input.camYaw = Math.PI;
  g.input.camPitch = 0.42;
  g.input.camDist = 20;
  g.hud.toggleValeCup();
});
await shot('e2e1_window_at_gate', 1600);

// 2. Queue solo (indicator state), then leave and start practice 3v3.
await page.evaluate(() => {
  const g = window.__game;
  g.sim.vcupQueueJoin(3, 'vale', 'striker');
});
await sleep(900);
const queued = await page.evaluate(() => {
  const el = document.querySelector('#vcup-indicator');
  return el && el.style.display !== 'none' ? el.textContent : null;
});
console.log('CHECK queued indicator:', JSON.stringify(queued));
await shot('e2e2_queued');
await page.evaluate(() => {
  const g = window.__game;
  g.sim.vcupQueueLeave();
  g.hud.toggleValeCup(); // close the window
  g.sim.vcupPracticeStart(3);
});
await page.waitForFunction(() => window.__game.sim.cupInfo?.match != null, {
  timeout: 30000,
  polling: 250,
});
await sleep(800);
const found = await page.evaluate(() => {
  const m = window.__game.sim.cupInfo.match;
  return { phase: m.phase, nations: [m.nationA, m.nationB], team: m.team, ball: m.ballId };
});
console.log('CHECK match opens on briefing:', JSON.stringify(found));
await shot('e2e3_briefing');

// 3. Ready up (the briefing overlay's I'M READY), then kickoff + hotbar check.
await page.evaluate(() => window.__game.sim.vcupReady());
await page.waitForFunction(() => window.__game.sim.cupInfo?.match?.phase === 'countdown', {
  timeout: 10000,
  polling: 200,
});
await fastForward(4);
await page.waitForFunction(() => window.__game.sim.cupInfo?.match?.phase === 'active', {
  timeout: 20000,
  polling: 250,
});
const kit = await page.evaluate(() => window.__game.sim.known.map((k) => k.def.id));
console.log('CHECK sport kit on the bar:', JSON.stringify(kit));
await shot('e2e4_kickoff', 1200);

// 4. Play: let the bots fight for a bit mid-pitch, then screenshot the clash.
await fastForward(20);
await page.evaluate(() => {
  const g = window.__game;
  const m = g.sim.cupInfo.match;
  const ball = g.sim.entities.get(m.ballId);
  const p = g.sim.player;
  if (ball) {
    p.pos.x = ball.pos.x - 6;
    p.pos.z = ball.pos.z - 4;
    g.input.camYaw = Math.atan2(-(ball.pos.x - p.pos.x), ball.pos.z - p.pos.z);
    g.input.camPitch = 0.34;
    g.input.camDist = 16;
  }
});
await shot('e2e5_open_play', 1400);
const mid = await page.evaluate(() => {
  const m = window.__game.sim.cupInfo.match;
  const strip = document.querySelector('#vcup-match-hud');
  const zone = document.querySelector('#zone-label');
  return {
    phase: m.phase,
    score: [m.scoreA, m.scoreB],
    timeLeft: m.timeLeft,
    strip: strip ? strip.textContent.slice(0, 60) : null,
    zone: zone ? zone.textContent : null,
  };
});
console.log('CHECK mid-match hud:', JSON.stringify(mid));

// 5. A deliberate goal: park the player + ball in front of the east goal and Kick.
await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const m = sim.cupInfo.match;
  const ball = sim.entities.get(m.ballId);
  const p = sim.player;
  // shoot at whichever goal my team attacks: team A attacks EAST (x max)
  const east = m.team === 'A';
  const lineX = east ? 11 : -33;
  const bx = east ? lineX - 6 : lineX + 6;
  ball.pos.x = bx;
  ball.pos.z = -112;
  p.pos.x = east ? bx - 2.5 : bx + 2.5;
  p.pos.z = -112;
  g.input.camYaw = east ? (3 * Math.PI) / 2 : Math.PI / 2;
  g.input.camPitch = 0.3;
  g.input.camDist = 14;
  sim.castAbilityAt('sport_kick', { x: east ? lineX + 1 : lineX - 1, z: -112 });
});
await sleep(300);
await fastForward(2);
await shot('e2e6_goal_fireworks', 700);
const after = await page.evaluate(() => {
  const m = window.__game.sim.cupInfo.match;
  return { phase: m.phase, score: [m.scoreA, m.scoreB] };
});
console.log('CHECK after shot:', JSON.stringify(after));

await browser.close();
console.log('done');
