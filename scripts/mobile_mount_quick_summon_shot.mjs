// Before/after proof for the mobile More > Mount quick-summon fix (issue #2739):
// on a mobile viewport, an unmounted player who already owns a mount and has
// paid for riding taps the More tray's Mount/Dismount control and the mount
// should summon directly, with no action-bar placement or paging required.
// Grants riding + one reins item via the offline sim handle (no dev commands
// needed), taps More then Mount, waits out the 1.5s summon channel, and shoots
// the result plus prints the sim's own mount state for a definitive pass/fail.
//   node scripts/mobile_mount_quick_summon_shot.mjs   (needs `npm run dev`; GAME_URL overrides :5173)
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.OUT_DIR ?? 'docs/screenshots/mobile-mount-quick-summon';
const TAG = process.env.SHOT_TAG ?? 'after';
fs.mkdirSync(OUT, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=844,390', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 844, height: 390, isMobile: true, hasTouch: true },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
// Headless SwiftShader trips the software-rendering notice; pre-dismiss it (a
// one-time per-install toast, unrelated to this fix) so it never overlaps the shot.
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('woc_gpu_notice_dismissed', '1');
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 120000 });
await page.evaluate(() => document.body.classList.add('mobile-touch'));
await enterOfflineGame(page, { charClass: 'warrior', charName: 'Ridertest', settleMs: 2000 });

const jsClick = (sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) throw new Error(`missing ${s}`);
    el.click();
  }, sel);

// Riding trained + exactly one owned mount: a real, common player state (not
// the dev-only every-mount-owned rig other mount scripts use).
await page.evaluate(() => {
  const sim = window.__game?.sim;
  const meta = sim.players.get(sim.player.id);
  if (meta) meta.ridingTrained = true;
  sim.addItem('reins_valorsteed', 1);
});
await wait(300);

const before = await page.evaluate(() => ({ mountKey: window.__game.sim.player.mountKey }));
console.log(`[${TAG}] unmounted before tapping More > Mount:`, JSON.stringify(before));

await jsClick('#mobile-more');
await wait(400);
await jsClick('#mobile-mounts');
// MOUNT_SUMMON_SECONDS is 1.5s; poll for the channel to resolve (unpatched
// code never starts a channel at all, so this just times out there instead).
await page
  .waitForFunction(() => window.__game.sim.player.mountKey === 'valorsteed', {
    timeout: 6000,
    polling: 200,
  })
  .catch(() => {});
await wait(500);
await jsClick('#mobile-more-close');
await wait(500);

const after = await page.evaluate(() => {
  const sim = window.__game.sim;
  return {
    mountKey: sim.player.mountKey,
    mountCastKey: sim.player.mountCastKey,
    mountCastRemaining: sim.player.mountCastRemaining,
  };
});
console.log(
  `[${TAG}] state after tapping More > Mount while unmounted, owning a mount:`,
  JSON.stringify(after),
);
console.log(`[${TAG}] summoned without visiting the action bar:`, after.mountKey === 'valorsteed');

await page.screenshot({ path: `${OUT}/${TAG}-mount-quick-summon-mobile.png` });
console.log(`shot: ${OUT}/${TAG}-mount-quick-summon-mobile.png`);

await browser.close();
