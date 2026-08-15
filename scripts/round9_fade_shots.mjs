// Round-9 distance-fade verification: capture the same shot list under
// ?wornfade=off (fade bands pushed out of range: the pre-fade image), the
// default build, and a SECOND ?wornfade=off control run, then diff. The
// fade is imperceptible when |off vs on| sits at the |off vs off| noise
// floor. Shots bracket each family's fade band by camera distance.
// Usage: GAME_URL=<preview url> node scripts/round9_fade_shots.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const BASE_URL = process.env.GAME_URL ?? 'http://localhost:5193';
const OUT = process.env.SHOT_OUT ?? 'tmp/round9';
fs.mkdirSync(OUT, { recursive: true });

const LAUNCH_ARGS = [
  '--window-size=1600,900',
  '--ignore-gpu-blocklist',
  '--enable-gpu-rasterization',
  '--use-gl=angle',
  '--use-angle=gl',
  '--enable-webgl',
  '--no-sandbox',
];

// Keep front wall plane sits near x=13 (the Grand Armoury at 17.5,-5.5).
// Player at x = 13 - D + camDist puts the CAMERA roughly D from the wall.
const keepShot = (D) => ({
  name: `keep_d${D}`,
  x: 13 - D + 4,
  z: -6,
  yaw: Math.PI / 2,
  pitch: 0.02,
  dist: 4,
});
// Peaks boulder field at (30, 700): camera pulled back along -yaw.
const boulderShot = (D) => ({
  name: `boulder_d${D}`,
  x: 30 - Math.sin(0.5) * (D - 8),
  z: 700 - Math.cos(0.5) * (D - 8),
  yaw: 0.5,
  pitch: 0.12,
  dist: 8,
});
// Meadow tree line around (15, 45): pull back along -z.
const treeShot = (D) => ({
  name: `tree_d${D}`,
  x: 15,
  z: 45 - (D - 9),
  yaw: 0.0,
  pitch: 0.15,
  dist: 9,
});

const SHOTS = [
  // stone: par band 23.4-42.6, det band 38.0-63.3
  keepShot(12),
  keepShot(24),
  keepShot(33),
  keepShot(45),
  keepShot(60),
  keepShot(75),
  // rock: par band 30.6-55.7, det band 49.7-82.8
  boulderShot(12),
  boulderShot(30),
  boulderShot(45),
  boulderShot(62),
  boulderShot(85),
  // canopy: band 34-55
  treeShot(12),
  treeShot(30),
  treeShot(45),
  treeShot(60),
  // gameplay composites: the bench waypoints themselves
  { name: 'town_street', x: 13, z: 15, yaw: 2.45, pitch: -0.2, dist: 12 },
  { name: 'keep_graze', x: 12.2, z: -13, yaw: 0.12, pitch: 0.05, dist: 4 },
  { name: 'great_tree_trunk', x: -33, z: 1020, yaw: -0.86, pitch: 0.15, dist: 8 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A cross-zone teleport can raise the loading screen; a capture taken through
// it poisons the diff (the round-9 great-tree lesson), so wait it out.
async function waitForWorldVisible(page, timeoutMs = 60000) {
  const t0 = Date.now();
  const up = () =>
    page
      .evaluate(() =>
        Boolean(document.querySelector('#loading-screen')?.classList.contains('visible')),
      )
      .catch(() => false);
  if (!(await up())) return;
  while (Date.now() - t0 < timeoutMs) {
    await sleep(1000);
    if (!(await up())) break;
  }
  await sleep(6000);
}

async function captureVariant(tag, query) {
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: LAUNCH_ARGS,
    defaultViewport: { width: 1600, height: 900 },
  });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem(
      'woc_settings',
      JSON.stringify({
        graphicsPreset: 5,
        terrainDetail: 1,
        foliageDensity: 1,
        effectsQuality: 1,
        shadowQuality: 1,
        renderScale: 1,
        browserEffects: 1,
      }),
    );
  });
  await page.goto(`${BASE_URL}/?gfx=ultra${query}`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });
  const hasEntry = await page
    .waitForSelector('#btn-offline', { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  if (!hasEntry) {
    await page.evaluate(() => document.querySelector('#btn-play')?.click());
    await page.waitForSelector('#btn-offline', { timeout: 60000 });
  }
  await enterOfflineGame(page, {
    charClass: 'warrior',
    charName: 'FadeProbe',
    settleMs: 2500,
    gameBootTimeoutMs: 120000,
  });
  await page.waitForFunction(() => Boolean(window.__game?.sim?.player), { timeout: 120000 });
  await sleep(6000);
  for (const shot of SHOTS) {
    await page.evaluate((p) => {
      const g = window.__game;
      g.sim.player.gm = true;
      g.sim.player.hp = g.sim.player.maxHp;
      g.sim.chat(`/dev tp ${p.x} ${p.z}`);
      g.sim.player.pos.x = p.x;
      g.sim.player.pos.z = p.z;
      g.sim.player.facing = p.yaw;
      g.input.camYaw = p.yaw;
      g.input.camPitch = p.pitch;
      g.input.camDist = p.dist;
      if (g.renderer) g.renderer.camDist = p.dist;
    }, shot);
    await sleep(7000);
    await waitForWorldVisible(page);
    await page.screenshot({ path: `${OUT}/${shot.name}.${tag}.png` });
    console.log(`${tag} ${shot.name} captured`);
  }
  await browser.close();
}

await captureVariant('off', '&wornfade=off');
await captureVariant('on', '');
await captureVariant('off2', '&wornfade=off');
console.log('done');
