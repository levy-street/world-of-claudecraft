// Before/after screenshots for the Broodmother egg quest-gated aggro fix: a
// non-quester standing beside a spider_egg (Widow Thicket, q_broodmother) used to be
// pulled into combat by the egg's own idle-scan aggro (mob/locomotion.ts's detection
// radius floors above 0 regardless of the egg's aggroRadius: 0 template value), even
// though the egg's own damage gate (combat/quest_damage_gate.ts) already refuses to
// let that same non-quester harm it back. questGateBlocksAggro
// (src/sim/mob/quest_gated_aggro.ts) closes the gap.
//
// Offline flow (no server). Needs `npm run dev`. Writes PNGs to tmp/.
// GAME_URL, e.g.: GAME_URL=http://localhost:5273 SHOT_TAG=before node
// scripts/broodmother_egg_aggro_shot.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const TAG = process.env.SHOT_TAG ?? 'shot';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 960 });
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`);
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await enterOfflineGame(page, { charClass: 'warrior', charName: 'Fenn', settleMs: 3000 });
// Headless SwiftShader rendering is slow enough that the "Entering the world..."
// curtain can still be up after enterOfflineGame's fixed settle. A bare waitForFunction
// here resolves instantly (the curtain may not have `visible` yet at poll start), so
// give it a moment to actually show first, then wait it out for real.
await new Promise((r) => setTimeout(r, 500));
await page
  .waitForFunction(
    () => !document.querySelector('#loading-screen')?.classList.contains('visible'),
    {
      timeout: 30000,
    },
  )
  .catch(() => {});

// Find a live Broodmother egg, stand the player right beside it, and clear every
// OTHER wild mob out of the local camp (Widow Thicket also hosts real, un-gated
// Mirefen Widows) so the shot isolates the egg's own aggro behavior instead of the
// whole zone's ambient difficulty.
const eggPos = await page.evaluate(() => {
  const { sim } = window.__game;
  const egg = [...sim.entities.values()].find(
    (e) => e.kind === 'mob' && e.templateId === 'spider_egg' && !e.dead,
  );
  if (!egg) return null;
  const dist2d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const pos = sim.groundPos(egg.pos.x + 1, egg.pos.z);
  sim.player.pos = { ...pos };
  sim.player.prevPos = { ...pos };
  for (const [id, e] of sim.entities) {
    if (e.kind === 'mob' && e.id !== egg.id && e.ownerId === null && dist2d(e.pos, egg.pos) < 60)
      sim.entities.delete(id);
  }
  sim.grid.refresh(sim.entities.values());
  return { x: egg.pos.x, z: egg.pos.z };
});
if (!eggPos) throw new Error('no live spider_egg found in the offline world');

// 5s of ticks (the offline client runs the sim on the same 20Hz loop as the server):
// comfortably enough time for the egg's idle-scan aggro (or its absence) to settle.
await new Promise((r) => setTimeout(r, 5200));

// The "Entering the world..." curtain can stay stuck up under headless SwiftShader
// (an asset-preload signal it waits on never fires there) even though the sim itself
// is long since ticking correctly underneath, as the state dump below proves. Force it
// out of the way for the shot rather than waiting on a signal that will not come.
await page.evaluate(() => {
  document.querySelector('#loading-screen')?.classList.remove('visible', 'fade');
});

await page.screenshot({ path: `tmp/broodmother_egg_aggro_${TAG}_wide.png` });
const frameBox = await page.evaluate(() => {
  const el = document.querySelector('#player-frame');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});
if (frameBox) {
  await page.screenshot({
    path: `tmp/broodmother_egg_aggro_${TAG}_frame.png`,
    clip: {
      x: Math.max(0, frameBox.x - 12),
      y: Math.max(0, frameBox.y - 12),
      width: frameBox.width + 24,
      height: frameBox.height + 24,
    },
  });
}

const state = await page.evaluate(() => {
  const { sim } = window.__game;
  const egg = [...sim.entities.values()].find(
    (e) => e.kind === 'mob' && e.templateId === 'spider_egg' && !e.dead,
  );
  return {
    playerInCombat: sim.player.inCombat,
    playerFrameHasCombatClass: document
      .querySelector('#player-frame')
      ?.classList.contains('combat'),
    eggAiState: egg?.aiState,
    eggInCombat: egg?.inCombat,
  };
});
console.log(TAG, JSON.stringify(state));

if (errors.length) console.log(`PAGE ERRORS:\n${errors.join('\n')}`);
await browser.close();
console.log('done');
