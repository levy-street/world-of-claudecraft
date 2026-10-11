// Before/after stills of the WOC body's movement and autoattack clips
// (scripts/assets/woc_keyed_anims): the offline warrior seen from the front at
// idle, from the side mid-run, and from the front through a white swing at a
// training target placed in front of it. FIT=female seeds a female body.
//
// Needs `npm run dev` on :5173 (override with GAME_URL). Writes
// tmp/woc_keyed_anims_shots/<PREFIX>-<fit>-<pose>.png (PREFIX defaults to after).
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const FIT = process.env.FIT === 'female' ? 'female' : 'male';
const PREFIX = process.env.PREFIX ?? 'after';
const OUT = 'tmp/woc_keyed_anims_shots';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1280,800', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
// Lowest graphics preset (standing capture rule) and the body fit to show.
await page.evaluateOnNewDocument((gender) => {
  try {
    localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
    localStorage.setItem('woc.modularAppearance', JSON.stringify({ gender }));
  } catch {
    /* ignore */
  }
}, FIT);
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 120000 });
const booted = await enterOfflineGame(page, {
  charClass: 'warrior',
  charName: 'Keyed',
  gameBootTimeoutMs: 120000,
  selectorTimeoutMs: 60000,
});
if (!booted) throw new Error('offline world did not boot');
// The stills are of the body, so the HUD and the software-rendering notice are hidden.
await page.evaluate(() => {
  const ui = document.querySelector('#ui');
  if (ui) ui.style.visibility = 'hidden';
  for (const b of document.querySelectorAll('button'))
    if (b.textContent?.trim() === 'Dismiss') b.click();
});

/** Turns the camera to look at the player from `side` radians off its front (the
 *  camera yaw equal to the facing looks from behind). */
async function frameCamera(side, dist = 4.2) {
  await page.evaluate(
    (side, dist) => {
      const { input, sim } = window.__game;
      input.camYaw = sim.player.facing + Math.PI + side;
      input.camPitch = 0.12;
      input.camDist = dist;
    },
    side,
    dist,
  );
}
const shot = (pose) => page.screenshot({ path: `${OUT}/${PREFIX}-${FIT}-${pose}.png` });

// Idle, front on.
await frameCamera(0);
await sleep(2500);
await shot('idle');

// Running, from the side.
await page.keyboard.down('KeyW');
await sleep(1200);
// The follow camera swings back behind a runner, so the side view is set just before the shot.
await frameCamera(Math.PI / 2, 5);
await sleep(60);
await shot('run');
await page.keyboard.up('KeyW');
await sleep(1500);

// A white swing at the nearest hostile, brought in front of the player and held still.
const swung = await page.evaluate(() => {
  const { sim } = window.__game;
  const p = sim.player;
  let best = null;
  for (const e of sim.entities.values()) {
    if (e.id === p.id || !(e.hp > 0) || !sim.isHostileTo(p, e)) continue;
    const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
    if (!best || d < best.d) best = { e, d };
  }
  if (!best) return false;
  const m = best.e;
  m.pos.x = p.pos.x + Math.sin(p.facing) * 2;
  m.pos.z = p.pos.z + Math.cos(p.facing) * 2;
  m.pos.y = p.pos.y;
  m.prevPos = { ...m.pos };
  sim.targetEntity(m.id);
  sim.startAutoAttack();
  return true;
});
if (!swung) throw new Error('no hostile in range to swing at');
await frameCamera(-1.15, 5);
for (let i = 0; i < 8; i++) {
  await sleep(140);
  await shot(`swing-${i}`);
}
await browser.close();
console.log(`wrote ${OUT}/${PREFIX}-${FIT}-*.png`);
