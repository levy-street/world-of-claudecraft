// Far-tree LOD visual check: stand where the tree line sits in the 300-500u band
// and shoot it, desktop + mobile. That band is exactly where the real GLB tree
// used to be swapped for its impostor (a cone for pines, a blob for oaks) while
// the zone's fog was still thin enough to show it off.
//
// Run once per revision and diff the pairs:
//   npm run dev            (offline enables devCommands in the vite dev server)
//   node scripts/foliage_lod_shots.mjs
//
// The wait before each shot is load-bearing: the adaptive frame budget starts
// starved while assets decode and shaders compile, and the detail radius used to
// ride it, so an early shot shows a different (worse) frame than a settled one.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const LABEL = process.env.SHOT_LABEL ?? 'after';
const OUT = process.env.SHOT_DIR ?? 'docs/screenshots/foliage-lod';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

// Long, open sightlines with a tree line at distance. z/x are world coords; facing
// is the yaw (radians) that points the camera down the vista.
const VANTAGES = [
  { id: 'vale-treeline', x: 40, z: -40, facing: Math.PI },
  { id: 'vale-ridge', x: -120, z: 90, facing: Math.PI * 0.5 },
];

const VIEWPORTS = {
  desktop: { width: 1600, height: 900, isMobile: false },
  mobile: { width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 },
};

const errors = [];

for (const [device, viewport] of Object.entries(VIEWPORTS)) {
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    protocolTimeout: 240000,
    args: [
      `--window-size=${viewport.width},${viewport.height}`,
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
    defaultViewport: viewport,
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`);
  });

  console.log(`[${device}] loading + entering offline...`);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(800);
  await page.evaluate(() => {
    document.querySelector('#btn-offline')?.click();
  });
  await sleep(400);
  await page.evaluate(() => {
    // Enter World stays disabled until a class is picked and the name input has
    // actually fired its event, so a bare `value =` is not enough.
    [...document.querySelectorAll('button')]
      .find((b) => b.textContent.trim() === 'Warrior')
      ?.click();
    const n = document.querySelector('#char-name');
    if (n) {
      n.value = 'Forester';
      n.dispatchEvent(new Event('input', { bubbles: true }));
    }
    document.querySelector('#btn-start-offline')?.click();
  });
  await page.waitForFunction(() => !!window.__game?.world?.player, {
    timeout: 60000,
    polling: 250,
  });

  for (const v of VANTAGES) {
    await page.evaluate((vantage) => {
      const w = window.__game.world;
      w.chat(`/dev tp ${vantage.x} ${vantage.z}`, w.player.id);
      w.player.facing = vantage.facing;
    }, v);
    // Let the world stream in AND the frame budget climb back to its ceiling:
    // the shot must show the settled frame, not the starved one.
    await sleep(6000);
    await page.evaluate(async () => {
      for (let i = 0; i < 20; i++) await new Promise((r) => requestAnimationFrame(r));
    });

    // jpeg, not png: these land in docs/screenshots and a png of a 1600x900 3D
    // frame is ~1MB, a jpeg ~200KB for the same read.
    const path = `${OUT}/${LABEL}-${v.id}-${device}.jpg`;
    await page.screenshot({ path, type: 'jpeg', quality: 86 });
    console.log(`  wrote ${path}`);
  }

  await browser.close();
}

if (errors.length > 0) {
  console.error(`\n${errors.length} page error(s):`);
  for (const e of errors.slice(0, 10)) console.error(`  ${e}`);
  process.exit(1);
}
console.log('\ndone.');
