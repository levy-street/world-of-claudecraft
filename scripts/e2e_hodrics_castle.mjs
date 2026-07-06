// Offline E2E + visual check for Hodric's Castle Gauntlet, the three-round
// elimination show: boots the offline client, starts a practice race (spawns
// the 9-challenger court), lets the generated course build in view, then
// drives the FULL SHOW: round 1 racing + a qualification, the elimination
// catapult + gallery, Hodric's rebuild (a NEW generated course, and the
// renderer must rebuild to match), round 2, the final, and the crown.
// Screenshots each round's distinct course along the way.

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
  const m = sim.hcInfo?.match;
  return { ok, round: m?.round, rounds: m?.rounds, state: m?.state, courseSeed: m?.courseSeed };
});
check(
  'practice race started in round 1 of 3',
  raceInfo.ok && raceInfo.round === 1 && raceInfo.rounds === 3,
  JSON.stringify(raceInfo),
);

// Let the course finish building and the countdown run, then screenshot.
await new Promise((r) => setTimeout(r, 3000));
await page.screenshot({ path: 'tmp/hc_r1_start.png' });

const build1 = await page.evaluate(() => {
  const g = window.__game;
  const m = g.sim.hcMatches.get(g.sim.playerId);
  const view = g.renderer.hodricsCastles?.get(m?.slot);
  return { built: !!view, seedMatch: view?.seed === m?.courseSeed };
});
check(
  'round 1 course built with the match seed',
  build1.built && build1.seedMatch,
  JSON.stringify(build1),
);

// Through the countdown into the live round.
await page.evaluate(() => {
  const sim = window.__game.sim;
  for (let i = 0; i < 20 * 6; i++) sim.tick();
});
const active = await page.evaluate(() => window.__game.sim.hcInfo?.match?.state);
check('round 1 is active after the countdown', active === 'active', `state=${active}`);

// Let the field race for 15 simulated seconds: real knocks/checkpoints.
const raceEvents = await page.evaluate(() => {
  const sim = window.__game.sim;
  const seen = new Set();
  for (let i = 0; i < 20 * 15; i++) {
    for (const ev of sim.tick()) if (String(ev.type).startsWith('hc')) seen.add(ev.type);
  }
  return [...seen];
});
check(
  'race events fired during round 1',
  raceEvents.some((t) => t === 'hcKnocked' || t === 'hcCheckpoint' || t === 'hcFall'),
  JSON.stringify(raceEvents),
);
await page.screenshot({ path: 'tmp/hc_r1_racing.png' });

// Resolve a round quickly: cross the line with the local player plus enough
// bots to hit the qualify target, exactly like the sim test suite does.
async function resolveRound() {
  return await page.evaluate(() => {
    const sim = window.__game.sim;
    const match = sim.hcMatches.get(sim.playerId);
    if (!match) return { ok: false, reason: 'no match' };
    const origin = { x: 11100, z: -1250 + match.slot * 800 };
    const cross = (pid) => {
      const e = sim.entities.get(pid);
      e.pos.x = origin.x;
      e.pos.z = origin.z + match.course.finishZ + 1.5;
      e.pos.y = match.course.finishY;
      e.prevPos = { ...e.pos };
      sim.rebucket(e);
    };
    const seen = new Set();
    const pump = (n) => {
      for (let i = 0; i < n; i++) {
        for (const ev of sim.tick()) if (String(ev.type).startsWith('hc')) seen.add(ev.type);
      }
    };
    cross(sim.playerId);
    pump(2);
    const alive = [...match.racers.values()].filter(
      (r) => !r.left && r.eliminatedRound === 0 && !r.finished,
    );
    // Enough finishers to hit the target (the player already crossed).
    const target = Math.min(match.round >= 3 ? 1 : match.round === 2 ? 3 : 6, alive.length + 1);
    for (let i = 0; i < target - 1 && i < alive.length; i++) {
      cross(alive[i].pid);
      pump(2);
    }
    pump(6);
    return { ok: true, state: match.state, round: match.round, events: [...seen] };
  });
}

// ROUND 1 -> intermission (catapult + gallery), then Hodric rebuilds.
const r1 = await resolveRound();
check('round 1 resolves into the intermission', r1.state === 'intermission', JSON.stringify(r1));
check(
  'qualification + elimination events fired',
  r1.events.includes('hcQualified') && r1.events.includes('hcEliminated'),
  JSON.stringify(r1.events),
);
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: 'tmp/hc_r1_elimination.png' });

const toRound2 = await page.evaluate(() => {
  const sim = window.__game.sim;
  const match = sim.hcMatches.get(sim.playerId);
  const seedBefore = match.courseSeed;
  // Ride out the intermission (6s) into the round-2 countdown.
  for (let i = 0; i < 20 * 7; i++) sim.tick();
  const g = match.course.gallery;
  const origin = { x: 11100, z: -1250 + match.slot * 800 };
  const galleryFolk = [...match.racers.values()].filter((r) => {
    if (r.eliminatedRound === 0 || r.left) return false;
    const e = sim.entities.get(r.pid);
    return e && Math.abs(e.pos.y - g.y) < 1.5 && Math.abs(e.pos.x - origin.x - g.x) < 8;
  }).length;
  return {
    round: match.round,
    state: match.state,
    seedChanged: match.courseSeed !== seedBefore,
    galleryFolk,
  };
});
check(
  'round 2 plated on a REBUILT course (new seed)',
  toRound2.round === 2 && toRound2.state === 'countdown' && toRound2.seedChanged,
  JSON.stringify(toRound2),
);
check(
  'the eliminated watch from the gallery',
  toRound2.galleryFolk === 4,
  `gallery=${toRound2.galleryFolk}`,
);

// The renderer must have torn down round 1's castle and raised round 2's.
await new Promise((r) => setTimeout(r, 1500));
const build2 = await page.evaluate(() => {
  const g = window.__game;
  const m = g.sim.hcMatches.get(g.sim.playerId);
  const view = g.renderer.hodricsCastles?.get(m?.slot);
  return { seedMatch: view?.seed === m?.courseSeed, seed: view?.seed };
});
check('renderer rebuilt the castle for round 2', build2.seedMatch, JSON.stringify(build2));
await page.screenshot({ path: 'tmp/hc_r2_new_course.png' });

// ROUND 2 -> intermission -> ROUND 3.
await page.evaluate(() => {
  const sim = window.__game.sim;
  for (let i = 0; i < 20 * 6; i++) sim.tick();
});
const r2 = await resolveRound();
check('round 2 resolves into the intermission', r2.state === 'intermission', JSON.stringify(r2));
await page.evaluate(() => {
  const sim = window.__game.sim;
  for (let i = 0; i < 20 * 13; i++) sim.tick(); // intermission + countdown
});
const round3 = await page.evaluate(() => {
  const g = window.__game;
  const m = g.sim.hcMatches.get(g.sim.playerId);
  return { round: m?.round, state: m?.state };
});
check('the final is live', round3.round === 3 && round3.state === 'active', JSON.stringify(round3));
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: 'tmp/hc_r3_final.png' });

// Cross the line: the crown, instantly credited, full board.
const finale = await resolveRound();
check(
  'the crown closes the show',
  finale.state === 'over' && finale.events.includes('hcFinish') && finale.events.includes('hcEnd'),
  JSON.stringify(finale),
);
const standings = await page.evaluate(() => {
  const sim = window.__game.sim;
  const meta = sim.players.get(sim.playerId);
  const match = sim.hcMatches.get(sim.playerId);
  const places = [...match.racers.values()].map((r) => r.place).sort((a, b) => a - b);
  return { wins: meta.hcWins, races: meta.hcRaces, places };
});
check(
  'the winner is credited and the board is complete',
  standings.wins === 1 &&
    standings.races === 1 &&
    standings.places.join(',') === '1,2,3,4,5,6,7,8,9,10',
  JSON.stringify(standings),
);
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: 'tmp/hc_r3_crown.png' });

console.log('console/page errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
console.log(fail === 0 ? 'ALL CHECKS PASSED' : `${fail} CHECK(S) FAILED`);
process.exit(fail > 0 ? 1 : 0);
