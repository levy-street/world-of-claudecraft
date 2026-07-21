// Screenshot harness for the "Lock Cursor While Rotating" camera fix.
//
// Boots the offline world at max graphics (?gfx=ultra), opens the Esc menu's
// Key Bindings panel, and captures the new toggle. Also drives a real camera
// drag and reports whether the input layer asked the canvas for pointer lock,
// proving the fix engages in the live client (headless browsers do not actually
// grant the lock without a trusted display, so we assert the REQUEST, which is
// the behavior the bug was missing).
//
// Needs a dev server (default :5173, override with GAME_URL). Writes to tmp/.
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

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#btn-offline', { timeout: 60000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(300);
await page.type('#char-name', 'Orbitwyn');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await page.waitForFunction(() => window.__game?.hud && window.__game?.input, { timeout: 60000 });
await sleep(2000);

// Open the Esc menu, then jump straight to the Key Bindings sub-view where the
// new toggle lives, and screenshot it.
await page.evaluate(() => {
  const hud = window.__game.hud;
  hud.toggleOptionsMenu();
  hud.optionsView = 'keybinds';
  hud.renderOptions();
  document.querySelector('#options-menu').style.display = 'block';
});
await sleep(500);
const toggleText = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#options-menu .kb-row, #options-menu *')];
  const hit = rows.find((el) => /Lock Cursor While Rotating/i.test(el.textContent || ''));
  return hit ? hit.textContent.trim().slice(0, 80) : '(label not found)';
});
await page.screenshot({ path: 'tmp/pointer-lock-1-keybind-panel.png' });
console.log('keybind panel toggle:', toggleText);

// Close the menu and drive a real camera drag over the canvas, instrumenting
// canvas.requestPointerLock to record that the fix engages it.
await page.keyboard.press('Escape');
await sleep(300);
const dragResult = await page.evaluate(async () => {
  const canvas = document.querySelector('canvas');
  // requestPointerLock lives on Element.prototype; patch there to catch any element.
  window.__lockRequests = 0;
  const proto = Element.prototype;
  const orig = proto.requestPointerLock;
  proto.requestPointerLock = function (...a) { window.__lockRequests++; return orig ? orig.apply(this, a) : undefined; };
  window.__game.input.setLockCursorOnRotate(true);
  // Headless Chromium reports the page as fullscreen, which (correctly) triggers
  // the fix's fullscreen carve-out. Real windowed users (esp. dual-monitor) are
  // NOT fullscreen, so emulate that to exercise the normal pointer-lock path.
  window.__diag = { fullscreenBefore: !!document.fullscreenElement, webkitBefore: !!document.webkitFullscreenElement };
  Object.defineProperty(document, 'fullscreenElement', { get: () => null, configurable: true });
  Object.defineProperty(document, 'webkitFullscreenElement', { get: () => null, configurable: true });
  const yaw0 = window.__game.input.camYaw;
  const rect = canvas.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  // Right-button press, then drag well past the threshold (classic orbit).
  canvas.dispatchEvent(new MouseEvent('mousedown', { button: 2, clientX: cx, clientY: cy, bubbles: true }));
  const trace = [];
  for (let i = 1; i <= 10; i++) {
    window.dispatchEvent(new MouseEvent('mousemove', { movementX: 12, movementY: 0, clientX: cx + i * 12, clientY: cy, bubbles: true }));
    trace.push({ i, active: window.__game.input.isCameraDragActive?.(), locks: window.__lockRequests });
    await new Promise((r) => setTimeout(r, 16));
  }
  window.dispatchEvent(new MouseEvent('mouseup', { button: 2, clientX: cx + 120, clientY: cy, bubbles: true }));
  return { lockRequests: window.__lockRequests, rotated: Math.abs(window.__game.input.camYaw - yaw0) > 0.001, trace, pointerLockEl: !!document.pointerLockElement };
});
await page.screenshot({ path: 'tmp/pointer-lock-2-after-drag.png' });
console.log('camera drag -> requestPointerLock calls:', dragResult.lockRequests, '| camera rotated:', dragResult.rotated, '| pointerLockEl:', dragResult.pointerLockEl);
console.log('trace:', JSON.stringify(dragResult.trace));
console.log('diag:', JSON.stringify(await page.evaluate(() => window.__diag)));

await browser.close();
console.log('wrote tmp/pointer-lock-1-keybind-panel.png and tmp/pointer-lock-2-after-drag.png');
