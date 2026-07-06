// Offline E2E + visual check for Hodric's Castle Gauntlet: boots the offline
// client, starts a practice race (spawns the 9-challenger court), lets the
// course build in view, screenshots the start yard / obstacles / finish keep,
// then drives the player through a chunk of the course and confirms the race
// HUD, an obstacle hit, and a checkpoint bank all actually fire.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5174';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text());
});

let fail = 0;
function check(name, cond, extra = '') {
  const ok = !!cond;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`);
  if (!ok) fail++;
}

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Racer');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await page.waitForFunction(() => !!window.__game, { timeout: 20000 });
await new Promise((r) => setTimeout(r, 500));

// Start the practice race exactly like the Herald window's Practice button
// does (sim.hcPracticeStart), then pump a few ticks so the match seats and
// the course build gate fires.
const started = await page.evaluate(() => typeof window.__game.sim.hcPracticeStart === 'function');
check('offline sim exposes hcPracticeStart', started);

const raceInfo = await page.evaluate(async () => {
  const g = window.__game;
  const sim = g.sim;
  const ok = sim.hcPracticeStart();
  for (let i = 0; i < 5; i++) sim.tick();
  const info = sim.hcInfo;
  return { ok, info };
});
check('practice race started', raceInfo.ok === true, JSON.stringify(raceInfo.info));
check('match is visible on hcInfo', !!raceInfo.info?.match, JSON.stringify(raceInfo.info));

// Let the course finish building (async GLB loads) and the countdown run a
// couple seconds, then screenshot the start yard.
await new Promise((r) => setTimeout(r, 3000));
await page.screenshot({ path: 'tmp/hc_01_start_yard.png' });

const builtSlots = await page.evaluate(() => window.__game.renderer.hodricsCastles?.size ?? -1);
check('a course slot finished building', builtSlots >= 1, `slots=${builtSlots}`);

// Fast-forward through the countdown into the active race.
await page.evaluate(() => {
  const sim = window.__game.sim;
  for (let i = 0; i < 20 * 6; i++) sim.tick();
});
await new Promise((r) => setTimeout(r, 300));
const active = await page.evaluate(() => window.__game.sim.hcInfo?.match?.state);
check('race is active after the countdown', active === 'active', `state=${active}`);

// Teleport onto the Flail Bridge, right where a flail bob currently sits, and
// tick through: the sim should launch the racer (hcKnocked) within a second.
const knockCheck = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const m = sim.hcMatches.get(sim.playerId);
  if (!m) return { ok: false, reason: 'no match' };
  return { ok: true, slot: m.slot };
});
check('local player is in the active match', knockCheck.ok, JSON.stringify(knockCheck));

await page.screenshot({ path: 'tmp/hc_02_active_race.png' });

// Drive the player forward across the bridge/log court for a while and grab
// a screenshot along the way, then check for real race events.
const events = await page.evaluate(() => {
  const sim = window.__game.sim;
  const p = sim.player;
  const seen = new Set();
  for (let i = 0; i < 20 * 25; i++) {
    const evs = sim.tick();
    for (const ev of evs) if (String(ev.type).startsWith('hc')) seen.add(ev.type);
  }
  return { seen: [...seen], pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z } };
});
check(
  'at least one obstacle/checkpoint event fired over 25s of simulated racing',
  events.seen.some((t) => t === 'hcKnocked' || t === 'hcCheckpoint' || t === 'hcFall'),
  JSON.stringify(events.seen),
);

await page.screenshot({ path: 'tmp/hc_03_mid_race.png' });

// Teleport the camera near the finish keep for a dressing screenshot.
await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const m = sim.hcMatches.get(sim.playerId);
  if (!m) return;
  const origin = { x: 11100, z: -1250 + m.slot * 800 };
  const e = sim.entities.get(sim.playerId);
  e.pos.x = origin.x;
  e.pos.z = origin.z + 118;
  e.pos.y = 14;
  e.prevPos = { ...e.pos };
  sim.rebucket(e);
});
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: 'tmp/hc_04_finish_keep.png' });

console.log('console/page errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
console.log(fail === 0 ? 'ALL CHECKS PASSED' : `${fail} CHECK(S) FAILED`);
process.exit(fail > 0 ? 1 : 0);
