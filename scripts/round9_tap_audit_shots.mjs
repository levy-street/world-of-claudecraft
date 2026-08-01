// Ultra parallax tap audit: capture the parallax-heavy near-field shots on
// two builds (6-tap vs 4-tap) plus a control re-capture, for pixel diffing.
// Usage: node scripts/round9_tap_audit_shots.mjs (TAP6_URL vs TAP4_URL previews)
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const OUT = process.env.SHOT_OUT ?? 'tmp/tapaudit';
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

// Grazing angles are where refinement-count differences band or swim; the
// fronts and the street are the coverage shots.
const SHOTS = [
  { name: 'keep_graze', x: 12.2, z: -13, yaw: 0.12, pitch: 0.05, dist: 4 },
  { name: 'keep_front24', x: -7, z: -6, yaw: Math.PI / 2, pitch: 0.02, dist: 4 },
  { name: 'boulder_close', x: 30, z: 700, yaw: 0.5, pitch: 0.3, dist: 6 },
  { name: 'boulder_graze', x: 30, z: 700, yaw: 0.5, pitch: 0.02, dist: 4 },
  { name: 'town_street', x: 13, z: 15, yaw: 2.45, pitch: -0.2, dist: 12 },
  { name: 'great_tree_trunk', x: -33, z: 1020, yaw: -0.86, pitch: 0.15, dist: 8 },
];

const ONLY = process.env.SHOT_ONLY ? process.env.SHOT_ONLY.split(',') : null;
const ACTIVE = SHOTS.filter((s) => !ONLY || ONLY.includes(s.name));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function captureVariant(tag, baseUrl) {
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
  await page.goto(`${baseUrl}/?gfx=ultra`, { waitUntil: 'domcontentloaded', timeout: 120000 });
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
    charName: 'TapProbe',
    settleMs: 2500,
    gameBootTimeoutMs: 120000,
  });
  await page.waitForFunction(() => Boolean(window.__game?.sim?.player), { timeout: 120000 });
  await sleep(6000);
  for (const shot of ACTIVE) {
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

const TAP6_URL = process.env.TAP6_URL ?? 'http://localhost:5193';
const TAP4_URL = process.env.TAP4_URL ?? 'http://localhost:5195';
await captureVariant('t6', TAP6_URL);
await captureVariant('t4', TAP4_URL);
await captureVariant('t6b', TAP6_URL);
console.log('done');
