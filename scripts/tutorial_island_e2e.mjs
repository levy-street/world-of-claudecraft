// Tutorial island E2E: boots a fresh offline character, waits for the spawn
// greeting dialog (the tutorialGreeting event's modal), accepts the ferry,
// and asserts the sim actually lands the player on the Proving Shore with
// the on-rails chain's first quest available. Screenshots land in tmp/.
// Needs the dev client running:  npm run dev
//   GAME_URL=http://localhost:5173 node scripts/tutorial_island_e2e.mjs

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  // A single CDP call has to survive a cold dev server: the first evaluate
  // after an i18n or wiki regen lands while Vite is still transforming the
  // module graph on the page's own main thread, which outran the 60s this
  // used to allow. The per-step waits below stay tight, so this only raises
  // the ceiling on how long one call may block, never how long a check waits.
  protocolTimeout: 240_000,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--window-size=1280,760',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  defaultViewport: { width: 1280, height: 760 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', e.message));

// Generous navigation budget: the first load after an i18n or wiki regen
// makes Vite re-transform the whole module graph, which outruns puppeteer's
// 30s default on a cold dev server.
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });
// A fresh profile every run, so the greeting one-shot always fires.
await page.evaluate(() => localStorage.clear());
// Generous boot budget: under SwiftShader (software GL) plus a cold Vite
// transform cache, the first world build can far outlast the helper default.
const booted = await enterOfflineGame(page, {
  charClass: 'warrior',
  charName: 'Prover',
  gameBootTimeoutMs: 180_000,
  selectorTimeoutMs: 60_000,
});
console.log('offline boot:', booted);
if (!booted) throw new Error('offline world did not boot');
await page.evaluate(() => document.querySelector('.gpu-notice-dismiss')?.click());

// The greeting sweeps on the 1 Hz mail-phase cadence, so the dialog appears
// within the first second or two of the world running.
await page.waitForFunction(() => !!document.getElementById('tutorial-greeting'), {
  timeout: 15000,
  polling: 200,
});
const dialogText = await page.evaluate(
  () => document.getElementById('tutorial-greeting')?.innerText.replace(/\s+/g, ' ') ?? '',
);
console.log('greeting dialog:', dialogText.slice(0, 140));
if (!/Proving Shore/.test(dialogText)) throw new Error('greeting dialog missing island copy');
await page.screenshot({ path: 'tmp/tutorial-greeting.png' });

const before = await page.evaluate(() => {
  const sim = window.__game.sim;
  return { ...sim.entities.get(sim.playerId).pos };
});
await page.evaluate(() => {
  document.querySelector('#tutorial-greeting [data-play]')?.click();
});

// The ferry is a sim-side teleport: wait for the player to stand on the
// island column (x < -180). The dialog element cannot be required gone:
// Odo's welcome note reuses the same #tutorial-greeting shell and opens
// within a frame of arrival, so the empty gap is never observable.
await page.waitForFunction(
  () => {
    const sim = window.__game.sim;
    return sim.entities.get(sim.playerId).pos.x < -180;
  },
  { timeout: 15000, polling: 200 },
);
// Ferryman Odo's welcome note opens on the first island arrival, directing
// the newcomer straight ahead to Warden Tam at the Gauntlet's gate.
await page.waitForFunction(
  () => {
    const el = document.getElementById('tutorial-greeting');
    return !!el && /Tam/i.test(el.innerText);
  },
  { timeout: 10000, polling: 200 },
);
console.log('island arrival: Odo welcome note shown');

const after = await page.evaluate(() => {
  const sim = window.__game.sim;
  const p = sim.entities.get(sim.playerId);
  return {
    pos: { ...p.pos },
    questState: sim.questState('q_ps_the_gauntlet'),
    greetingLatched: sim.players.get(sim.playerId).tutorialGreetingSent,
  };
});
console.log('before ferry:', before, 'after ferry:', after.pos);
console.log('first island quest:', after.questState, 'one-shot latched:', after.greetingLatched);
if (after.questState !== 'available') throw new Error('welcome quest not available on arrival');
if (!after.greetingLatched) throw new Error('greeting one-shot did not latch');

// Give the streamer a moment to draw the island before the proof shot.
await sleep(6000);
await page.screenshot({ path: 'tmp/tutorial-island-arrival.png' });

// The return trip: ring the Old Pier's ferry bell (a clicked object, never a
// walk-in trigger) and assert the crossing sets the player down in Eastbrook
// town beside the spawn square.
const returned = await page.evaluate(() => {
  const sim = window.__game.sim;
  const p = sim.entities.get(sim.playerId);
  const bell = [...sim.entities.values()].find(
    (e) => e.kind === 'object' && e.objectItemId === 'ps_ferry_bell' && e.pos.x < -180,
  );
  if (!bell) return { error: 'island ferry bell missing' };
  p.pos.x = bell.pos.x + 1;
  p.pos.z = bell.pos.z;
  sim.pickUpObject(bell.id);
  return { pos: { ...p.pos } };
});
console.log('after bell:', returned);
if (returned.error) throw new Error(returned.error);
if (!(Math.abs(returned.pos.x - 4) < 2 && Math.abs(returned.pos.z + 6) < 2)) {
  throw new Error('ferry bell did not land in Eastbrook town');
}

// The first homecoming points out the town's twin bell (a possible misclick
// ride): Bryn's one-button note opens off the ferryBellHome event. Matched
// on the mailbox landmark so a stale Odo note can never satisfy this wait.
await page.waitForFunction(
  () => {
    const el = document.getElementById('tutorial-greeting');
    return !!el && /mailbox/i.test(el.innerText);
  },
  { timeout: 10000, polling: 200 },
);
await sleep(1200);
await page.screenshot({ path: 'tmp/tutorial-bell-home-hint.png' });
console.log('E2E OK: greeting, ferry, chain head, bell home, twin-bell hint shown');

await browser.close();
