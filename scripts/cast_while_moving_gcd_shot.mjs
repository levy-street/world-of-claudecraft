// Screenshot the cast-while-moving GCD-waste fix in the offline client. Boots a
// mage, holds forward movement input (as if the player never let go of W), and
// presses Cinderbolt (Fireball). Before the fix the cast started anyway and armed
// the GCD, only for the very next movement tick to cancel it (the held key never
// went away): the player got nothing, and the GCD greyed out the whole action bar
// for a cast that never had a chance to complete. After the fix the press is
// denied outright with a clear toast, and the GCD never arms.
//
// Runs against a Vite dev client (GAME_URL, default :5199).

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5199';
const VIEWPORT = process.env.SHOT_VIEWPORT ?? 'desktop';
const OUT_PREFIX = process.env.SHOT_OUT_PREFIX ?? 'tmp/cast_while_moving_gcd';
const isMobile = VIEWPORT === 'mobile';
const metrics = isMobile
  ? { width: 844, height: 390, deviceScaleFactor: 2, mobile: true }
  : { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false };
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    `--window-size=${metrics.width},${metrics.height}`,
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  defaultViewport: { width: metrics.width, height: metrics.height },
});
const page = await browser.newPage();
const cdp = await page.createCDPSession();
await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: metrics.width,
  height: metrics.height,
  deviceScaleFactor: metrics.deviceScaleFactor,
  mobile: metrics.mobile,
});
page.on('pageerror', (e) => console.log(`PAGEERROR: ${e.message}`));

// Standing capture rule: seed the lowest graphics preset before boot, and
// suppress the one-time camera prompt and the new-adventurer tutorial overlay.
await page.evaluateOnNewDocument(() => {
  window.localStorage.setItem(
    'woc_settings',
    JSON.stringify({ graphicsPreset: 1, graphicsDefaultApplied: true }),
  );
  window.localStorage.setItem('woc.cameraModePrompt.shown', '1');
  window.localStorage.setItem('woc.tutorial.v1', 'done');
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
const booted = await enterOfflineGame(page, { charClass: 'mage', charName: 'Windrunner' });
if (!booted) throw new Error('world did not boot');
await page
  .waitForFunction(() => getComputedStyle(document.querySelector('#ui')).display !== 'none', {
    timeout: 20000,
  })
  .catch(() => {});
await new Promise((r) => setTimeout(r, 500));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Stage: level 12 mage, an immortal target dummy in front, facing it.
const staged = await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.setPlayerLevel(12);
  sim.chat('/dev immortal');
  sim.chat('/dev noaggro');
  sim.chat('/dev spawn forest_wolf 1 12');
  const me = sim.player;
  let best = null;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead || !e.hostile) continue;
    const d = Math.hypot(e.pos.x - me.pos.x, e.pos.z - me.pos.z);
    if (!best || d < best.d) best = { id: e.id, d };
  }
  if (best) {
    sim.targetEntity(best.id);
    const mob = sim.entities.get(best.id);
    me.facing = Math.atan2(mob.pos.x - me.pos.x, mob.pos.z - me.pos.z);
  }
  sim.player.resource = sim.player.maxResource;
  return { target: best };
});
console.log('staged', JSON.stringify(staged));
if (!staged.target) throw new Error('no target dummy spawned');

await page.evaluate(() => document.querySelector('#tutorial-greeting')?.remove());

// The scenario: the player is already holding forward (as if mid-sprint) and
// presses Cinderbolt (Fireball), a normal cast-time spell with no mobility grant.
const pressed = await page.evaluate(() => {
  const sim = window.__game.sim;
  const meta = sim.players.get(sim.player.id);
  meta.moveInput.forward = true;
  sim.castAbility('fireball');
  return { castingAbility: sim.player.castingAbility, gcdRemaining: sim.player.gcdRemaining };
});
console.log('pressed while moving', JSON.stringify(pressed));
await sleep(250);

const result = await page.evaluate(() => {
  const p = window.__game.sim.player;
  return {
    castingAbility: p.castingAbility,
    gcdRemaining: p.gcdRemaining,
    errorText: document.querySelector('#error-msg')?.textContent ?? '',
  };
});
console.log('result', JSON.stringify(result));
// The software-GPU toast is headless-capture noise, not part of the scene.
await page.evaluate(() => document.querySelector('#gpu-notice')?.remove());

const out = `${OUT_PREFIX}-${VIEWPORT}.png`;
await page.screenshot({ path: out });
console.log(`wrote ${out}`);
await browser.close();
