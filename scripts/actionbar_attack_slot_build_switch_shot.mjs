// Screenshot the attack-slot build-switch fix in the offline client.
// Boots a shaman, frees the fixed Attack-button slot (slot 0) via the
// showAttackButton interface setting, drops an Enhancement-only ability
// (stormstrike) into it, then switches to Restoration (which does not grant
// stormstrike) and back to Enhancement. ActionBarController.loadAttackAction()
// reloads the freed slot on every build switch (the same path a real login or
// server layout restore takes): before the fix it gated the stored id on
// "granted by the CURRENTLY active build" and deleted it outright the moment
// Restoration was active, so switching back to Enhancement could never bring
// it back. After the fix the freed slot survives the round trip.
// Before the fix: actionForSlot(0) is null and slot 0 is empty after the
// switch back. After the fix: actionForSlot(0) still returns stormstrike and
// its icon is back in slot 0.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5199';
const VIEWPORT = process.env.SHOT_VIEWPORT ?? 'desktop';
const OUT_PREFIX = process.env.SHOT_OUT_PREFIX ?? 'tmp/actionbar_attack_slot';
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
await page.type('#char-name', 'Squallwind');
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

  // 1. Go Enhancement (grants stormstrike). TalentAllocation is { spec, rows }
  //    (src/sim/content/talents.ts), not { spec, ranks, choices }: the wrong
  //    shape leaves `rows` undefined, which validateAllocation quietly
  //    rejects, so sim.talentSpec never actually changes.
  sim.applyTalents({ spec: 'enhancement', rows: {} });

  // 2. Free the fixed Attack-button slot (slot 0) via the Interface setting,
  //    same as unchecking "Show Attack Button" in the Options window.
  // Reach past the private TS modifier (erased at runtime) to call the same
  // hook the Options window's checkbox handler calls.
  hud.optionsHooks.settings.set('showAttackButton', false);

  // 3. Drop the Enhancement-only ability into the now-freed slot 0, the same
  //    effect a spellbook drag-and-drop onto slot 0 has, and persist it.
  hud.actionBarController.replaceAttackAction({ type: 'ability', id: 'stormstrike' });
  hud.actionBarController.saveAttackAction();
  const afterAssign = hud.actionBarController.actionForSlot(0);

  // 4. Switch to Restoration, which does NOT grant stormstrike (simulates the
  //    player switching talent builds).
  sim.applyTalents({ spec: 'restoration', rows: {} });

  // 5. Reload the action bar the way login / a server layout restore does.
  hud.actionBarController.reload();
  const afterRestoReload = hud.actionBarController.actionForSlot(0);

  // 6. Switch BACK to Enhancement, the build that originally granted
  //    stormstrike.
  sim.applyTalents({ spec: 'enhancement', rows: {} });

  // 7. Reload again. This is the capture moment.
  hud.actionBarController.reload();
  const afterEnhancementReload = hud.actionBarController.actionForSlot(0);

  return { afterAssign, afterRestoReload, afterEnhancementReload };
});
console.log('actionForSlot(0):', JSON.stringify(setup.afterEnhancementReload));
console.log('attack slot build switch result:', JSON.stringify(setup, null, 2));

const restored = setup.afterEnhancementReload?.id === 'stormstrike';
console.log(
  restored
    ? 'AFTER-FIX BEHAVIOR: slot 0 shows the stormstrike icon again after switching back'
    : 'BEFORE-FIX BEHAVIOR: slot 0 is permanently empty after switching back',
);

if (isMobile) {
  // At the 844x390 landscape width the desktop-style HUD (no touch emulation,
  // so the compact touch layout never activates: the mobile action ring hard-
  // codes its own slot 0 to the fixed Attack toggle regardless of
  // showAttackButton and never exposes the freed slot this bug is about, so a
  // genuine touch capture would show nothing relevant) squeezes #chatlog-wrap
  // wide enough to overlap the actionbar's first couple of slots. Hide it so
  // the capture isolates the actionbar, the same way onboarding overlays are
  // suppressed above.
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
