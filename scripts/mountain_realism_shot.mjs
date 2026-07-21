// Screenshot harness for the mountain-realism / draw-distance-haze pass.
// Boots an offline warrior, god-mode teleports to each zone hub (~"zone
// centre") plus a couple of up-close mountain vantage points, hides the HUD,
// and captures a frame at each. Needs `npm run dev` on :5173 (override with
// GAME_URL). Writes to tmp/, filenames prefixed by the LABEL env var (default
// "after") so before/after pairs don't collide.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

// ?gfx=ultra forces the top graphics tier regardless of the swiftshader
// software-GL auto-detect, so screenshots show the real max-quality look.
const URL = (process.env.GAME_URL ?? 'http://localhost:5173') + '?gfx=ultra';
const LABEL = process.env.LABEL ?? 'after';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// zone hubs (data.ts / content/zone*.ts), "standing at the centre of the
// zone" vantage points, plus two up-close mountain details.
const VANTAGE_POINTS = [
  { name: 'vale-hub', x: 0, z: 0, yaw: 0 },
  { name: 'marsh-hub', x: 0, z: 300, yaw: Math.PI / 2 },
  { name: 'peaks-hub', x: 0, z: 660, yaw: Math.PI },
  { name: 'ridge-closeup', x: 0, z: 160, yaw: 0 },
  { name: 'rim-closeup', x: 0, z: -140, yaw: 0 },
];

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE:', m.text());
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(200);
await page.type('#char-name', 'Aldwyn');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await page.waitForFunction(() => Boolean(window.__game?.sim), { timeout: 40000 });

// let the first-spawn intro cinematic (src/game/spawn_cinematic.ts) run its
// full course (9s) rather than screenshotting mid-pan; it also holds movement
// until it lands, so teleporting sooner would just get overridden by it.
await sleep(9500);

// god mode so the settle-fall from teleporting never kills the camera
await page.evaluate(() => {
  const p = window.__game.sim.player;
  p.maxHp = 99999;
  p.hp = 99999;
});

// dismiss the new-adventurer tutorial toast (button.tut-skip -> finish()) so
// it never appears in a shot; clicking it (rather than just hiding it with
// CSS) actually advances the tutorial state instead of leaving it pinned.
await page.evaluate(() => {
  document.querySelector('.tut-skip')?.click();
});
await sleep(300);

// hide every HUD chrome element so the screenshot is pure world/terrain
await page.evaluate(() => {
  const style = document.createElement('style');
  style.textContent = `
    #hud, #minimap, #chat, #bags, #action-bars, #nameplates, #cast-bar,
    #player-frame, #target-frame, #party-frame, .tut-card { display: none !important; }
  `;
  document.head.appendChild(style);
});

for (const v of VANTAGE_POINTS) {
  await page.evaluate((vp) => {
    const g = window.__game;
    const p = g.sim.player;
    p.pos.x = vp.x;
    p.pos.z = vp.z;
    p.facing = vp.yaw;
    for (let i = 0; i < 10; i++) g.sim.tick();
  }, v);
  await sleep(1200); // let terrain chunks + fog settle after the teleport
  await page.screenshot({ path: `tmp/mountains-${LABEL}-${v.name}.png` });
  console.log('captured', v.name);
}

await browser.close();
