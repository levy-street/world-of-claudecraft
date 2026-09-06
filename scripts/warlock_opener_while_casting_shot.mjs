// Screenshot the Affliction opener-while-casting fix in the offline client.
// Boots a level 20 Affliction warlock, marks a spawned enemy with Evil Eye,
// starts a Needle of Fate cast, and presses Hour of Judgment while the cast is
// still running (outside the cast-queue tail). Before the fix the busy guard
// rejected the press ("You are busy.") and the Doom meter stayed at 0. After
// the fix the opener fires through the running cast: 40 Condemnation and three
// Fate Threads land on the meter while the Needle keeps casting.
//
// Runs against a Vite dev client (GAME_URL, default :5199). Offline dev
// commands are on under Vite (import.meta.env.DEV), which is what spawns the
// practice target.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5199';
const VIEWPORT = process.env.SHOT_VIEWPORT ?? 'desktop';
const OUT_PREFIX = process.env.SHOT_OUT_PREFIX ?? 'tmp/warlock_opener_while_casting';
const isMobile = VIEWPORT === 'mobile';
// Mobile HUD is landscape-only on the web client.
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
const booted = await enterOfflineGame(page, { charClass: 'warlock', charName: 'Maledicta' });
if (!booted) throw new Error('world did not boot');
await page
  .waitForFunction(() => getComputedStyle(document.querySelector('#ui')).display !== 'none', {
    timeout: 20000,
  })
  .catch(() => {});
await new Promise((r) => setTimeout(r, 500));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Stage: level 20 Affliction, an immortal warlock, one practice target in
// front of the player, marked with Evil Eye.
const staged = await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.setPlayerLevel(20);
  const spec = sim.setSpec('affliction');
  sim.chat('/dev immortal');
  sim.chat('/dev noaggro');
  sim.chat('/dev spawn ridge_stalker 1 20');
  const me = sim.player;
  let best = null;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead || !e.hostile) continue;
    const d = Math.hypot(e.pos.x - me.pos.x, e.pos.z - me.pos.z);
    if (!best || d < best.d) best = { id: e.id, d };
  }
  if (best) sim.targetEntity(best.id);
  sim.player.resource = sim.player.maxResource;
  return { spec, target: best };
});
console.log('staged', JSON.stringify(staged));
if (!staged.target) throw new Error('no practice target spawned');

await page.evaluate(() => document.querySelector('#tutorial-greeting')?.remove());
await page.evaluate(() => window.__game.sim.castAbility('evil_eye'));
await page.waitForFunction(
  () => {
    const p = window.__game.sim.player;
    return !p.castingAbility && p.gcdRemaining <= 0;
  },
  { timeout: 10000 },
);
await sleep(200);

// The scenario: Needle of Fate is mid-cast (well outside the 0.4 s queue
// tail) when Hour of Judgment is pressed.
await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.player.resource = sim.player.maxResource;
  sim.castAbility('needle_of_fate');
});
await sleep(250);
const pressed = await page.evaluate(() => {
  const sim = window.__game.sim;
  const before = {
    casting: sim.player.castingAbility,
    castRemaining: sim.player.castRemaining,
  };
  sim.castAbility('hour_of_judgment');
  return before;
});
console.log('pressed at', JSON.stringify(pressed));
await sleep(220);

const result = await page.evaluate(() => {
  const p = window.__game.sim.player;
  const doom = p.auras.find((a) => a.kind === 'affliction_doom');
  return {
    casting: p.castingAbility,
    castRemaining: p.castRemaining,
    doom: doom?.stacks ?? 0,
    cooldown: p.cooldowns.get('hour_of_judgment') ?? null,
    error: document.querySelector('#error-msg')?.textContent ?? '',
    meter: document.querySelector('#warlock-doom')?.getAttribute('aria-valuenow') ?? null,
  };
});
console.log('result', JSON.stringify(result));
// The software-GPU toast is headless-capture noise, not part of the scene.
await page.evaluate(() => document.querySelector('#gpu-notice')?.remove());

const out = `${OUT_PREFIX}-${VIEWPORT}.png`;
await page.screenshot({ path: out });
console.log(`wrote ${out}`);
await browser.close();
