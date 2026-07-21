// Screenshot harness for the touch-only "Joystick Deadzone" accessibility
// setting (Esc to Graphics, shown only on phone-touch devices). Boots the game
// in a phone-sized viewport with touch emulation, forces the mobile-touch
// layout (headless Chromium doesn't report pointer:coarse), then opens the
// Graphics options to capture the new slider at a few values.
//
// Run with `npm run dev` up:  node scripts/mobile_joystick_deadzone.mjs

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });

// iPhone-ish landscape: pointer:coarse + small height triggers PHONE_TOUCH_QUERY.
const VIEWPORT = { width: 880, height: 412, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=880,412', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: VIEWPORT,
});
const page = await browser.newPage();
// Headless Chromium reports pointer:fine even under touch emulation, so the
// PHONE_TOUCH_QUERY (pointer: coarse ...) never matches and the touch-only UI
// stays hidden. Patch matchMedia at document start so isPhoneTouchDevice() is
// true and the whole mobile path (joysticks + Graphics deadzone slider) renders.
await page.evaluateOnNewDocument(() => {
  const real = window.matchMedia.bind(window);
  window.matchMedia = (q) =>
    /coarse/.test(q)
      ? {
          matches: true,
          media: q,
          addEventListener() {},
          removeEventListener() {},
          addListener() {},
          removeListener() {},
          onchange: null,
          dispatchEvent: () => false,
        }
      : real(q);
});
const errors = [];
// The offline dev server (npm run dev with no game server) 502s the homepage's
// background project-stats fetch; that is expected offline and unrelated to the
// deadzone slider under test, so it is not a script failure.
const IGNORED_CONSOLE = /502|Bad Gateway|fetch project stats/i;
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error' && !IGNORED_CONSOLE.test(msg.text())) {
    errors.push(`CONSOLE: ${msg.text()}`);
  }
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await enterOfflineGame(page, { charClass: 'warrior', charName: 'Tapper', settleMs: 2500 });

// Headless Chromium reports pointer:fine, so force the touch layout the same
// way the other mobile harnesses do, and make isPhoneTouchDevice() return true
// so the Graphics view renders the touch-only slider.
await page.evaluate(() => {
  document.body.classList.add('mobile-touch');
  const mc = window.__game?.mobileControls;
  if (mc) mc.setActive?.(true);
});
// Wait for the forced touch layout to actually apply before the screenshot,
// instead of a blind delay (poll for the body class the mobile path sets).
await page
  .waitForFunction(() => document.body.classList.contains('mobile-touch'), { timeout: 5000 })
  .catch(() => {});
await page.screenshot({ path: 'tmp/mobile_deadzone_01_controls.png' });

// Open the Esc menu, then Graphics. Poll for each panel to actually render
// instead of guessing with fixed delays, so the deadzone row below is never
// looked up before the touch-only sliders mount.
await page.evaluate(() => window.__game?.hud?.toggleOptionsMenu?.());
await page
  .waitForFunction(
    () =>
      [...document.querySelectorAll('#options-menu .btn')].some((b) =>
        /graphics/i.test(b.textContent || ''),
      ),
    { timeout: 10000 },
  )
  .catch(() => {});
// Click the Graphics entry in the options menu.
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('#options-menu .btn')];
  const g = btns.find((b) => /graphics/i.test(b.textContent || ''));
  g?.click();
});
// The "Joystick Deadzone" row renders only when env.touch is true (matchMedia
// was patched to coarse at document start and body.mobile-touch was forced
// above), so poll for that exact row before the lookup rather than racing a
// fixed timeout.
await page
  .waitForFunction(
    () =>
      [...document.querySelectorAll('#options-menu .set-row')].some((r) =>
        /deadzone/i.test(r.querySelector('.set-name')?.textContent || ''),
      ),
    { timeout: 10000 },
  )
  .catch(() => {});
await page.screenshot({ path: 'tmp/mobile_deadzone_02_graphics.png' });

// Drag the deadzone slider to its max and re-shoot.
const set = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#options-menu .set-row')];
  const row = rows.find((r) => /deadzone/i.test(r.querySelector('.set-name')?.textContent || ''));
  if (!row) return { found: false };
  const slider = row.querySelector('input[type="range"]');
  slider.value = slider.max;
  slider.dispatchEvent(new Event('input', { bubbles: true }));
  return { found: true, value: slider.value, label: row.querySelector('.set-val')?.textContent };
});
// Item-8 assertion: the post-entry nav must actually surface the deadzone row. If the
// waitForFunction poll above timed out (its rejection is caught), set.found is false and
// the run must FAIL rather than silently pass.
if (!set.found) {
  errors.push('DEADZONE: the Joystick Deadzone row never rendered after entering Graphics');
}
await new Promise((r) => setTimeout(r, 200));
await page.screenshot({ path: 'tmp/mobile_deadzone_03_max.png' });

console.log('slider:', JSON.stringify(set));
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no console/page errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
