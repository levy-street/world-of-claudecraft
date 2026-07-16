// Screenshot + smoke harness for game-controller (gamepad) support.
// Boots the offline world at max graphics (?gfx=ultra), injects a synthetic
// W3C Standard Gamepad (so the GamepadManager treats one as connected), and
// captures: (1) the new Options > Controller panel, (2) the stick-driven
// virtual cursor over an open HUD window, and (3) left-stick movement actually
// walking the character. Needs the dev server (default :5173, GAME_URL to override).

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = (process.env.GAME_URL ?? 'http://localhost:5173') + '/?gfx=ultra';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--window-size=1600,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ],
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE:', m.text());
});

// Install a controllable synthetic Standard Gamepad BEFORE any app code runs so
// gamepad.start()'s initial getGamepads() scan picks it up at boot.
await page.evaluateOnNewDocument(() => {
  const pad = {
    id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)',
    index: 0,
    connected: true,
    mapping: 'standard',
    timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    vibrationActuator: { playEffect: () => Promise.resolve('complete') },
  };
  window.__pad = pad;
  navigator.getGamepads = () => [pad];
  navigator.webkitGetGamepads = navigator.getGamepads;
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#btn-offline', { timeout: 60000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(300);
await page.type('#char-name', 'Padwyn');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await page.waitForFunction(() => window.__game?.hud, { timeout: 60000 });
await sleep(2500);

// --- Shot 1: Options > Controller panel -----------------------------------
await page.evaluate(() => window.__game.hud.toggleOptionsMenu());
await sleep(300);
// Click the "Controller" entry in the game menu by its label.
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('#options-menu .opt-btn')].find((b) =>
    /controller|手柄|手把|コントローラー|컨트롤러|геймпад/i.test(b.textContent),
  );
  btn?.click();
});
await sleep(500);
await page.screenshot({ path: 'tmp/gamepad_panel.png' });
console.log('wrote tmp/gamepad_panel.png');

// Close the menu.
await page.evaluate(() => window.__game.hud.toggleOptionsMenu());
await sleep(300);

// --- Shot 2: virtual cursor over an open HUD window ------------------------
// Headless rAF is throttled to ~1 Hz, so we pump the manager's poll() directly
// at a steady dt (this is exactly what the real frame loop calls each frame).
await page.evaluate(() => {
  const el = document.querySelector('#bags');
  el.style.display = 'none';
  window.__game.hud.toggleBags();
  // Push the left stick down-right and step the gamepad ~50 frames so the
  // pointer travels from screen-centre onto the bag grid.
  window.__pad.axes = [0.85, 0.55, 0, 0];
  for (let i = 0; i < 50; i++) window.__game.gamepad.poll(1 / 60);
  window.__pad.axes = [0, 0, 0, 0];
});
await sleep(200);
const cursor = await page.evaluate(() => {
  const c = document.querySelector('.gamepad-cursor');
  return c ? { display: c.style.display, left: c.style.left, top: c.style.top } : null;
});
console.log('cursor state:', JSON.stringify(cursor));
await page.screenshot({ path: 'tmp/gamepad_cursor.png' });
console.log('wrote tmp/gamepad_cursor.png');

// --- Shot 3: left-stick movement walks the character ----------------------
// Close every open window so the HUD un-suspends movement (and cursor mode ends).
await page.evaluate(() => {
  for (let i = 0; i < 20 && window.__game.hud.closeAll(); i++) {
    /* close all */
  }
});
await sleep(300);
const start = await page.evaluate(() => ({ ...window.__game.sim.player.pos }));
// Full forward on the left stick, then pump the gamepad + drive offline sim
// ticks deterministically (again, bypassing the throttled rAF clock).
await page.evaluate(() => {
  window.__pad.axes = [0, -1, 0, 0];
  const g = window.__game.gamepad,
    sim = window.__game.sim,
    input = window.__game.input;
  for (let i = 0; i < 60; i++) {
    g.poll(1 / 20);
    Object.assign(sim.moveInput, input.readMoveInput());
    sim.tick();
  }
  window.__pad.axes = [0, 0, 0, 0];
});
await sleep(200);
const end = await page.evaluate(() => ({ ...window.__game.sim.player.pos }));
const moved = Math.hypot(end.x - start.x, end.z - start.z);
console.log(
  `left-stick walk: moved ${moved.toFixed(2)} yd (start ${start.x.toFixed(1)},${start.z.toFixed(1)} -> end ${end.x.toFixed(1)},${end.z.toFixed(1)})`,
);
await page.screenshot({ path: 'tmp/gamepad_walk.png' });
console.log('wrote tmp/gamepad_walk.png');

await browser.close();
console.log(
  moved > 1 ? 'PASS: gamepad left stick moved the character' : 'WARN: character did not move',
);
