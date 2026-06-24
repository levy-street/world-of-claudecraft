// Verification + screenshot harness for "Escape pauses the run, it does not cancel it".
//
// Boots the offline world as a warrior at max graphics (?gfx=ultra), enables
// click-to-move, sends the player running to a far destination, then opens the
// game menu with Escape while the run is in flight. With the fix the click-move
// destination survives the menu (input.clickMoveTarget stays set) and the run
// resumes when the menu closes; before the fix opening the menu cleared it.
//
// Needs a dev server (default :5173, override with GAME_URL). Writes screenshots
// and a before/after state report to tmp/.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = (process.env.GAME_URL ?? 'http://localhost:5173') + '/?gfx=ultra';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });

// Enable click-to-move before any script runs (settings load from localStorage
// at startup; the Settings object is not exposed on window.__game).
await page.evaluateOnNewDocument(() => {
  try {
    const cur = JSON.parse(localStorage.getItem('woc_settings') ?? '{}');
    localStorage.setItem('woc_settings', JSON.stringify({ ...cur, clickToMove: 1 }));
  } catch { /* storage unavailable */ }
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#btn-offline', { timeout: 60000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(300);
await page.type('#char-name', 'Runwyn');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await page.waitForFunction(() => window.__game?.hud && window.__game?.input, { timeout: 60000 });
await sleep(2000);

// Enable click-to-move and send the player on a long run to a clear destination.
const start = await page.evaluate(() => {
  const g = window.__game;
  const p = g.world.player;
  const dest = { x: p.pos.x, z: p.pos.z + 120 }; // 120 yd due north, well past arrival
  g.input.setClickMoveTarget(dest, 0.5, null, [dest], false);
  return { hasTarget: !!g.input.clickMoveTarget, pos: { x: p.pos.x, z: p.pos.z } };
});
const pos = () => page.evaluate(() => ({
  modalOpen: window.__game.hud.isModalOpen(),
  suspended: window.__game.input.suspendMovement,
  hasTarget: !!window.__game.input.clickMoveTarget,
  pos: { x: window.__game.world.player.pos.x, z: window.__game.world.player.pos.z },
}));
// Poll until the player has moved at least `min` yards from `from`, or timeout.
const waitForMove = async (from, min, ms) => {
  const t0 = Date.now();
  let last = from;
  while (Date.now() - t0 < ms) {
    last = await pos();
    if (Math.hypot(last.pos.x - from.x, last.pos.z - from.z) >= min) break;
    await sleep(100);
  }
  return last;
};

// 1) Confirm the run is actually under way before we touch the menu.
const running = await waitForMove(start.pos, 3, 4000);
await page.screenshot({ path: 'tmp/esc-run-1-running.png' });

// 2) Press Escape to open the game menu mid-run. This suspends movement; the run
//    must PAUSE (destination kept), not cancel. Sample twice to show no walking.
await page.keyboard.press('Escape');
await sleep(300);
const menuOpen = await pos();
await page.screenshot({ path: 'tmp/esc-run-2-menu-open.png' });
await sleep(700);
const stillOpen = await pos();
const movedWhilePaused = Math.hypot(stillOpen.pos.x - menuOpen.pos.x, stillOpen.pos.z - menuOpen.pos.z);

// 3) Close the menu; the run resumes from where it paused.
await page.keyboard.press('Escape');
const resumed = await waitForMove(menuOpen.pos, 2, 5000);
await page.screenshot({ path: 'tmp/esc-run-3-resumed.png' });
const movedAfterResume = Math.hypot(resumed.pos.x - menuOpen.pos.x, resumed.pos.z - menuOpen.pos.z);

const report = {
  start, running, menuOpen, stillOpen, resumed,
  checks: {
    // The run was active before the menu: the player covered ground from spawn to
    // the point the menu opened (headless rAF throttling makes per-poll motion
    // bursty, so measure total displacement, not the mid-run poll).
    runningBeforeMenu: running.hasTarget && Math.hypot(menuOpen.pos.x - start.pos.x, menuOpen.pos.z - start.pos.z) >= 3,
    targetSurvivesMenu: menuOpen.hasTarget,          // the fix
    heldStillWhilePaused: movedWhilePaused < 0.5,    // suspended => no walking
    resumedAfterClose: movedAfterResume > 1,         // run continues
  },
};
fs.writeFileSync('tmp/esc-run-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

await browser.close();
const ok = Object.values(report.checks).every(Boolean);
console.log(ok ? 'PASS: Escape pauses the run and it resumes.' : 'FAIL: see report.');
process.exit(ok ? 0 : 1);
