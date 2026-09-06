// Screenshot the freed Attack-slot RENDER fix in the offline client (reopen of #3548).
//
// PR #3548 fixed ActionBarController.loadAttackAction() so the freed slot's stored
// assignment survives a reload/relog under a build that does not grant it. That left a
// second, render-layer gap: Hud.abilityForSlot() (the paint path AND the tooltip) only
// resolves against the live sim.known list, so the moment a non-granting build goes
// active the slot painted fully 'empty' (no icon, aria-label "empty") even though the
// data survives in storage. From the player's own report ("switching between builds
// clears the slot", still open on macOS client 0.40.1) that IS the bug: the ability
// visibly vanishes on every build switch, not just after a relog.
//
// This drives the REAL Loadout-switch path a player uses (src/ui/talents_window.ts's
// Loadout menu -> Sim.switchLoadout + Hud.applyLoadoutBar), not a raw reload(), and
// captures the action bar while a NON-granting build (Restoration) is active with the
// Enhancement-only stormstrike still assigned to the freed slot 1.
//
// Before the fix: slot 1 is empty (no icon, "Action slot 1: empty").
// After the fix: slot 1 shows the Stormstrike icon, dimmed/unusable, aria-label
// "Action slot 1: Ancestral Strike" + aria-description "Unavailable".

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const VIEWPORT = process.env.SHOT_VIEWPORT ?? 'desktop';
const OUT_PREFIX = process.env.SHOT_OUT_PREFIX ?? 'tmp/actionbar_loadout_switch';
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

// Standing capture rule: seed the lowest graphics preset before the app boots.
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
  } catch {
    /* ignore */
  }
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
const booted = await enterOfflineGame(page, { charClass: 'shaman', charName: 'Squallwind' });
if (!booted) throw new Error('world did not boot');
await new Promise((r) => setTimeout(r, 500));

const result = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const hud = g.hud;
  const p = sim.player;
  sim.setPlayerLevel(20);
  p.gm = true;

  // 1. Go Enhancement (grants stormstrike), free the fixed Attack slot via the
  //    Interface setting, and place the Enhancement-only ability there.
  sim.applyTalents({ spec: 'enhancement', rows: {} });
  hud.optionsHooks.settings.set('showAttackButton', false);
  hud.actionBarController.replaceAttackAction({ type: 'ability', id: 'stormstrike' });
  hud.actionBarController.saveAttackAction();

  // 2. Save this as a "Enhancement" Loadout (the Talents window's "Save current").
  const enhBar = hud.hotbarActions.map((a) => (a && a.type === 'ability' ? a.id : null));
  const enhIdx = sim.saveLoadout('Enhancement', enhBar, { spec: 'enhancement', rows: {} }, false);

  // 3. Switch to Restoration (does not grant stormstrike) and save a second Loadout,
  //    the same two-build setup the reopened report demonstrates.
  sim.applyTalents({ spec: 'restoration', rows: {} });
  const restoBar = hud.hotbarActions.map((a) => (a && a.type === 'ability' ? a.id : null));
  const restoIdx = sim.saveLoadout(
    'Restoration',
    restoBar,
    { spec: 'restoration', rows: {} },
    false,
  );

  // 4. Switch back to Enhancement (normal play), THEN switch to the Restoration
  //    Loadout the way the Talents window dropdown does: switchLoadout, then
  //    applyLoadoutBar(lo.bar, lo.alloc) (Hud.requestLoadoutSwitch's own sequence).
  sim.applyTalents({ spec: 'enhancement', rows: {} });
  const lo = sim.loadouts[restoIdx];
  sim.switchLoadout(restoIdx);
  hud.applyLoadoutBar(lo.bar, lo.alloc);

  const slot0 = hud.actionBarController.actionForSlot(0);
  const displayAbility = hud.abilityForSlot(0);
  // Headless Chrome only repaints on demand; force one frame so the DOM (read
  // right after) reflects this tick's action-bar state instead of a stale one.
  hud.update();
  return {
    enhIdx,
    restoIdx,
    activeSpec: sim.talents.spec,
    slot0,
    displayAbility,
    showAttackButton: hud.optionsHooks.settings.get('showAttackButton'),
  };
});
console.log('loadout switch attack-slot result:', JSON.stringify(result, null, 2));

const btn0Aria = await page
  .evaluate(() => document.querySelector('[data-hotbar-slot="0"]')?.getAttribute('aria-label'))
  .catch(() => null);
console.log('slot 0 aria-label:', btn0Aria);
const restored = btn0Aria !== null && !/empty/i.test(btn0Aria);
console.log(
  restored
    ? 'AFTER-FIX BEHAVIOR: slot 1 keeps showing (dimmed) Ancestral Strike while Restoration is active'
    : 'BEFORE-FIX BEHAVIOR: slot 1 paints fully empty while Restoration is active',
);

if (isMobile) {
  // At the 844x390 landscape width the desktop-style HUD (no touch emulation, so the
  // compact touch layout never activates) squeezes #chatlog-wrap wide enough to overlap
  // the actionbar's first couple of slots. Hide it so the capture isolates the actionbar.
  await page.evaluate(() => {
    const chat = document.getElementById('chatlog-wrap');
    if (chat) chat.style.display = 'none';
  });
}

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

console.log(`saved ${OUT_PREFIX}-scene.png, ${OUT_PREFIX}-actionbar.png`);
await browser.close();
process.exit(0);
