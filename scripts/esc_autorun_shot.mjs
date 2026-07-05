// Verification + VIDEO harness for "the Esc menu lets an autorun (R) keep running".
//
// This is the autorun companion to esc_run_shot.mjs (which covers click-to-move).
// Boots the offline world as a warrior at max graphics (?gfx=ultra), presses R to
// toggle autorun, confirms the player is running, then opens the game menu with
// Escape (as if to change a keybind or a setting) while the run is in flight. In a
// classic MMO the world never pauses, so the autorun latch must keep DRIVING the
// player forward while the menu is open: the menu is genuinely open and
// suspendMovement is set, input.autorun stays true, AND the player keeps covering
// ground. Records a webm so the behavior is visible, not just asserted.
//
// Needs a dev server (default :5173, override with GAME_URL). Writes a video, key
// screenshots, and a before/after state report to tmp/.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = (process.env.GAME_URL ?? 'http://localhost:5173') + '/?gfx=ultra';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  userDataDir: process.env.CHROME_USER_DATA_DIR || undefined,
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--no-sandbox', '--disable-crash-reporter', '--disable-breakpad', '--no-crashpad'],
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#btn-offline', { timeout: 60000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(300);
await page.type('#char-name', 'Autowyn');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await page.waitForFunction(() => window.__game?.hud && window.__game?.input, { timeout: 60000 });
await sleep(2000);

const pos = () => page.evaluate(() => ({
  modalOpen: window.__game.hud.isModalOpen(),
  suspended: window.__game.input.suspendMovement,
  autorun: window.__game.input.autorun,
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

// Start recording the whole sequence.
const recorder = await page.screencast({ path: 'tmp/esc-autorun.webm' });

// Face north so the run heads into open ground, then press R to toggle autorun
// (KeyR is the vanilla default for the 'autorun' edge action).
const start = await page.evaluate(() => {
  window.__game.input.autorun = false;
  return { pos: { x: window.__game.world.player.pos.x, z: window.__game.world.player.pos.z } };
});
await page.keyboard.press('KeyR');
const armed = await pos();

// 1) Confirm autorun is actually carrying the player before we touch the menu.
const running = await waitForMove(start.pos, 3, 5000);
await page.screenshot({ path: 'tmp/esc-autorun-1-running.png' });

// 2) Press Escape to open the game menu mid-run. The menu opens (suspendMovement),
//    the autorun latch stays set, and the player MUST keep running underneath it.
await page.keyboard.press('Escape');
await sleep(300);
const menuOpen = await pos();
await page.screenshot({ path: 'tmp/esc-autorun-2-menu-open.png' });
const ranDuringMenu = await waitForMove(menuOpen.pos, 2, 5000);
const movedWhileMenuOpen = Math.hypot(ranDuringMenu.pos.x - menuOpen.pos.x, ranDuringMenu.pos.z - menuOpen.pos.z);
await page.screenshot({ path: 'tmp/esc-autorun-3-running-with-menu.png' });

// 3) Close the menu; the run keeps going without interruption.
await page.keyboard.press('Escape');
const afterClose = await waitForMove(ranDuringMenu.pos, 2, 5000);
await page.screenshot({ path: 'tmp/esc-autorun-4-after-close.png' });
const movedAfterClose = Math.hypot(afterClose.pos.x - ranDuringMenu.pos.x, afterClose.pos.z - ranDuringMenu.pos.z);

await sleep(500);
await recorder.stop();

const report = {
  start, armed, running, menuOpen, ranDuringMenu, afterClose,
  checks: {
    autorunEngaged: armed.autorun === true,                 // R toggled it on
    // The run was active before the menu: the player covered ground from spawn to
    // the point the menu opened (headless rAF throttling makes per-poll motion
    // bursty, so measure total displacement, not the mid-run poll).
    runningBeforeMenu: Math.hypot(menuOpen.pos.x - start.pos.x, menuOpen.pos.z - start.pos.z) >= 3,
    menuActuallyOpen: ranDuringMenu.modalOpen === true,     // the game menu really is up
    // suspendMovement is recomputed once per render frame, so sample it at the
    // instant we confirm sustained motion (not +300ms after the keypress, when a
    // sub-1fps ultra-graphics frame may not have ticked yet). A frame that moves
    // the player is the same frame that set suspendMovement=true for the open menu.
    movementSuspendedByMenu: ranDuringMenu.suspended === true,
    autorunSurvivesMenu: ranDuringMenu.autorun === true,    // the latch is kept
    keepsRunningWhileMenuOpen: movedWhileMenuOpen > 1,      // THE FIX: still moving with menu open
    stillRunningAfterClose: movedAfterClose > 1,            // run continues uninterrupted
  },
};
fs.writeFileSync('tmp/esc-autorun-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

await browser.close();
const ok = Object.values(report.checks).every(Boolean);
console.log(ok ? 'PASS: the Esc menu lets the autorun keep running.' : 'FAIL: see report.');
process.exit(ok ? 0 : 1);
