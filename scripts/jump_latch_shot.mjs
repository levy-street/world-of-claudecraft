// Screenshot + proof harness for the keyboard jump-latch fix (input.ts).
// Boots an offline warrior at MAX graphics (preset 5 / advanced), then fires a
// batch of very fast Space taps (keydown+keyup a few ms apart) straight through
// the window event path the real game uses. Counts how many taps actually
// produced a jump, and captures the player mid-air at the apex.
// Needs `npm run dev` on :5173 (override with GAME_URL). Writes to tmp/.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });

// Seed MAX graphics before the app boots so the renderer inits at preset 5.
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('woc_settings', JSON.stringify({
      graphicsPreset: 5, terrainDetail: 1, effectsQuality: 1, shadowQuality: 1,
    }));
  } catch { /* ignore */ }
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(200);
await page.type('#char-name', 'Hopper');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
// wait for the offline world to attach and the player to exist
await page.waitForFunction(() => window.__game && window.__game.sim && window.__game.sim.player, { timeout: 30000 });
await sleep(1500);

const preset = await page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem('woc_settings')).graphicsPreset; } catch { return null; }
});
console.log('graphicsPreset =', preset, '(5 = advanced / max)');

// One fast Space tap (keydown+keyup, no gap) followed by `ticks` sim steps that
// pull movement through the REAL input path (input.readMoveInput) — exactly what
// main.ts's offline loop does. Headless throttles requestAnimationFrame, so we
// drive the ticks synchronously here instead of waiting on rAF; this keeps the
// whole sequence inside the latch window and faithfully exercises input.ts.
// Returns the peak height gained. With the fix a tap raises the player; without
// it (raw key-held read) the keyup clears Space before the tick and nothing
// happens. Stops near apex so the player is left mid-air for a screenshot.
async function tapAndStep(ticks) {
  return page.evaluate((ticks) => {
    const g = window.__game;
    const p = g.sim.player;
    // settle on the ground first
    for (let i = 0; i < 30 && !p.onGround; i++) g.sim.tick();
    const before = p.pos.y;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', repeat: false }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' })); // fast tap: released at once
    let peak = before;
    for (let i = 0; i < ticks; i++) {
      const mi = g.input.readMoveInput();          // <-- the latch lives here
      Object.assign(g.sim.moveInput, mi);
      g.sim.tick();
      if (p.pos.y > peak) peak = p.pos.y;
      if (p.vy <= 0) break;                         // stop at apex, stay airborne
    }
    return { gained: +(peak - before).toFixed(3), airborne: !p.onGround, y: +p.pos.y.toFixed(2), vy: +p.vy.toFixed(2) };
  }, ticks);
}

// grounded baseline frame
await sleep(300);
await page.screenshot({ path: 'tmp/jump-latch-grounded.png' });

// Count how many of N independent fast taps register a jump.
const N = 12;
let jumps = 0;
for (let i = 0; i < N; i++) {
  const r = await tapAndStep(10);
  if (r.gained > 0.3) jumps++;
  if (i === N - 1) {
    // hero shot: player left mid-air at the apex of the final tap
    await page.screenshot({ path: 'tmp/jump-latch-apex.png' });
    console.log('apex frame:', JSON.stringify(r));
  }
}
console.log(`fast Space taps: ${jumps}/${N} produced a jump (with the latch fix)`);

await browser.close();
console.log('done -> tmp/jump-latch-{grounded,apex}.png');
