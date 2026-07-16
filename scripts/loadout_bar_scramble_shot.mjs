// Screenshot the talent-loadout action-bar scramble fix in the offline client.
// Boots a shaman, opens the Talents window, and reproduces the reported bug: the
// shared/global hotbar still holds an Enhancement-only ability (stormstrike) when
// a Restoration loadout is SAVED (currentBar() captures whatever is on the live
// bar at save time), then that stale ability id survives a later switch back to
// the Restoration loadout because applyLoadoutBar validated "does this id exist
// anywhere in ABILITIES" instead of "does the loadout's OWN build grant it".
// Before the fix: slot 1 still shows the Stormstrike icon after switching to
// Restoration. After the fix: the loadout's own alloc rejects it and the slot
// is empty (this loadout never captured a Restoration-legal ability there).

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5175';
const VIEWPORT = process.env.SHOT_VIEWPORT ?? 'desktop';
const OUT_PREFIX = process.env.SHOT_OUT_PREFIX ?? 'tmp/loadout_bar';
const isMobile = VIEWPORT === 'mobile';
// Mobile HUD is landscape-only on the web client.
const metrics = isMobile
  ? { width: 844, height: 390, deviceScaleFactor: 2, mobile: true }
  : { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false };
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
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

// Suppress the one-time "Choose Your Camera" prompt and the new-adventurer tutorial
// overlay so captures show clean gameplay/UI, not onboarding chrome.
await page.evaluateOnNewDocument(() => {
  window.localStorage.setItem('woc.cameraModePrompt.shown', '1');
  window.localStorage.setItem('woc.tutorial.v1', 'done');
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await new Promise((r) => setTimeout(r, 400));
await page.type('#char-name', 'Raidolo');
await page.evaluate(() => {
  const chip = document.querySelector('#offline-select .mini-class[data-class="shaman"]');
  if (chip) chip.click();
});
await page.click('#btn-start-offline');
let booted = false;
for (let i = 0; i < 30; i++) {
  booted = await page.evaluate(() => !!window.__game?.sim?.player);
  if (booted) break;
  await new Promise((r) => setTimeout(r, 1000));
}
if (!booted) throw new Error('world did not boot');
// The first-spawn intro cinematic hides #ui for ~9s of real time; wait it out so
// the HUD (including the action bar) is actually visible for the capture.
await page
  .waitForFunction(() => getComputedStyle(document.querySelector('#ui')).display !== 'none', {
    timeout: 15000,
  })
  .catch(() => {});
await new Promise((r) => setTimeout(r, 500));

const setup = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const hud = g.hud;
  const p = sim.player;
  sim.setPlayerLevel(20);
  p.gm = true;

  // 1. Go Enhancement, place its signature ability on the bar (the shared, not
  //    per-build, hotbar slot map).
  sim.applyTalents({ spec: 'enhancement', ranks: {}, choices: {} });
  hud.hotbarActions[1] = { type: 'ability', id: 'stormstrike' };

  // 2. "Save" a Restoration build WHILE that Enhancement ability is still sitting
  //    on the live bar (saveLoadout snapshots hud.currentBar() as-is; the shaman
  //    at this point has not actually re-armed the bar for the new spec).
  sim.applyTalents({ spec: 'restoration', ranks: {}, choices: {} });
  const restoAlloc = { spec: 'restoration', ranks: {}, choices: {} };
  const capturedBar = hud.hotbarActions.map((a) => (a && a.type === 'ability' ? a.id : null));
  sim.saveLoadout('Restoration', capturedBar, restoAlloc);

  // 3. Switch back to Enhancement (simulating normal play away from the saved
  //    build), then switch to the saved Restoration loadout the way the Talents
  //    window dropdown does: switchLoadout, then applyLoadoutBar(lo.bar, lo.alloc).
  sim.applyTalents({ spec: 'enhancement', ranks: {}, choices: {} });
  const idx = sim.loadouts.findIndex((l) => l.name === 'Restoration');
  const lo = sim.loadouts[idx];
  sim.switchLoadout(idx);
  // Reach past the private TS modifier (erased at runtime) to call the same
  // method the Talents window dropdown handler calls.
  hud.applyLoadoutBar(lo.bar, lo.alloc);

  hud.toggleTalents();
  return {
    slot1: hud.hotbarActions[1],
    loadoutBar: lo.bar,
    activeSpec: sim.talentSpec,
  };
});
console.log('loadout bar scramble result:', JSON.stringify(setup, null, 2));

const stillScrambled = setup.slot1?.id === 'stormstrike';
console.log(
  stillScrambled
    ? 'BEFORE-FIX BEHAVIOR: slot 1 still shows the foreign-spec stormstrike icon'
    : 'AFTER-FIX BEHAVIOR: slot 1 was rejected for the active Restoration build',
);

// Capture immediately: syncSlotMap self-heals a rejected/foreign ability id on
// the very next 20Hz tick (~50ms), so any longer pause here would erase the
// visual difference this repro is trying to show.
await page.screenshot({ path: `${OUT_PREFIX}-scene.png` });

const clipOf = async (sel) =>
  page.evaluate((s) => {
    const bar = document.querySelector(s);
    if (!bar) return null;
    const r = bar.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }, sel);

const box = await clipOf('#actionbar, #hotbar');
if (box && box.w > 0) {
  const pad = 18;
  await page.screenshot({
    path: `${OUT_PREFIX}-actionbar.png`,
    clip: {
      x: Math.max(0, box.x - pad),
      y: Math.max(0, box.y - pad),
      width: Math.min(metrics.width - Math.max(0, box.x - pad), box.w + pad * 2),
      height: Math.min(metrics.height - Math.max(0, box.y - pad), box.h + pad * 2),
    },
  });
}

const winBox = await clipOf('#talents-window');
if (winBox && winBox.w > 0) {
  const pad = 8;
  await page.screenshot({
    path: `${OUT_PREFIX}-talents.png`,
    clip: {
      x: Math.max(0, winBox.x - pad),
      y: Math.max(0, winBox.y - pad),
      width: Math.min(metrics.width - Math.max(0, winBox.x - pad), winBox.w + pad * 2),
      height: Math.min(metrics.height - Math.max(0, winBox.y - pad), winBox.h + pad * 2),
    },
  });
}
console.log(
  `saved ${OUT_PREFIX}-scene.png, ${OUT_PREFIX}-actionbar.png, ${OUT_PREFIX}-talents.png`,
);
await browser.close();
process.exit(0);
