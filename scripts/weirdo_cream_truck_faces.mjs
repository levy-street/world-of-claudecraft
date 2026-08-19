// Daylight product shots of the Weirdo Cream truck, one per face.
//
//   node scripts/weirdo_cream_truck_faces.mjs      (needs `npm run dev`)
//
// The orbit capture (weirdo_cream_truck_orbit.mjs) films the mount in the world
// at whatever the clock says, which lands at dusk and leaves the signage in
// shadow. This one pins the cycle to noon with the /daynight dev command and
// takes four cardinal views plus a three-quarter hero, which is what a PR needs
// to show the flank lettering, the rear portrait, and the open cab.

import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { dismissEntryOverlays, enterOfflineGame } from './enter_offline_game.mjs';

const BASE = process.env.GAME_URL ?? 'http://localhost:5173';
const URL = `${BASE}/?gfx=ultra`;
const OUT = process.env.OUT_DIR ?? 'docs/screenshots/weirdo-cream-truck/faces';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--window-size=1280,720',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
  ],
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
page.on('pageerror', (error) => console.log('PAGEERROR:', error.message));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await page.goto(URL, { waitUntil: 'load', timeout: 240_000 });
await enterOfflineGame(page, {
  charClass: 'warrior',
  charName: 'Luffy',
  settleMs: 4000,
  gameBootTimeoutMs: 300_000,
  selectorTimeoutMs: 180_000,
});
await dismissEntryOverlays(page);

await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.setPlayerLevel(20, sim.playerId);
  sim.addItem('reins_weirdo_cream_truck', 1);
  const meta = sim.meta(sim.playerId);
  if (meta) meta.ridingTrained = true;
});
await sleep(500);

// Riding is an item use, and the summon is a 1.5 SIM-second cast. Under software
// rendering the sim runs many times slower than wall clock, so this waits in
// minutes; re-issuing during a cast is swallowed by design, hence the guard.
await page.waitForFunction(
  () => {
    const sim = window.__game.sim;
    const self = sim.entities.get(sim.playerId);
    if (self?.mountKey === 'weirdo_cream_truck') return true;
    if (!((self?.mountCastRemaining ?? 0) > 0)) sim.useItem('reins_weirdo_cream_truck');
    return false;
  },
  { timeout: 300_000, polling: 1000 },
);
await page.waitForFunction(
  () => !!window.__game.renderer?.views?.get(window.__game.sim.playerId)?.mountVisual,
  { timeout: 120_000, polling: 300 },
);

// Pin the cycle to noon. /daynight is a client dev command handled by a keydown
// listener ON the chat input (src/main.ts), so the event has to be dispatched at
// that element: pressing Enter through the keyboard API needs the textarea
// focused, and focusing it while the chat is closed silently does nothing, which
// left the first attempt still shooting at dusk.
const dayNight = await page.evaluate(async () => {
  const input = document.querySelector('#chat-input');
  if (!input) return 'no chat input';
  input.value = '/daynight noon';
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }),
  );
  await new Promise((resolve) => setTimeout(resolve, 1200));
  // The handler logs a confirmation line; that is the only readable proof it ran.
  return /time of day set to/i.test(document.body.textContent || '') ? 'ok' : 'not applied';
});
console.log(`daynight noon: ${dayNight}`);
if (dayNight !== 'ok') {
  console.warn('WARNING: the noon override did not apply; these shots are NOT daytime.');
}
await sleep(2500);

await page.evaluate(() => {
  const ui = document.querySelector('#ui');
  if (ui) ui.style.display = 'none';
  for (const button of document.querySelectorAll('button')) {
    if (/dismiss/i.test(button.textContent || '')) button.click();
  }
});
await sleep(1500);

// yaw 0 puts the camera behind the truck (the rear shutter), so the cardinals
// run rear, flank, front, flank. `dist` is pulled in for the hero so the cab
// reads at three-quarters.
const SHOTS = [
  { name: 'rear-portrait', yaw: 0, pitch: 0.16, dist: 6.5 },
  { name: 'flank-left', yaw: Math.PI / 2, pitch: 0.14, dist: 6.5 },
  { name: 'front-badge', yaw: Math.PI, pitch: 0.14, dist: 6.5 },
  { name: 'flank-right', yaw: (3 * Math.PI) / 2, pitch: 0.14, dist: 6.5 },
  { name: 'hero-three-quarter', yaw: Math.PI * 1.28, pitch: 0.2, dist: 6 },
];

for (const shot of SHOTS) {
  await page.evaluate(
    (yaw, pitch, dist) => {
      const input = window.__game.input;
      if (input) {
        input.camYaw = yaw;
        input.camPitch = pitch;
        input.camDist = dist;
      }
    },
    shot.yaw,
    shot.pitch,
    shot.dist,
  );
  await sleep(1800);
  const file = path.join(OUT, `${shot.name}.png`);
  try {
    await page.screenshot({ path: file });
  } catch {
    await sleep(1200);
    await page.screenshot({ path: file });
  }
  console.log(`${shot.name}: ${file}`);
}

await browser.close();
