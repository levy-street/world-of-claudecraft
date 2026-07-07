// Screenshots for issue #1518 (terrain/feature-aware water): confirms each
// declared lake still renders as its own water body after switching water.ts
// from one flat plane per zone to one plane per declared lake footprint.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('CONSOLE: ' + m.text());
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Delverbot');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 3000));
await page.waitForFunction(() => Boolean(window.__game?.sim), { timeout: 15000 });

const tp = async (x, z, yaw = 0) => {
  await page.evaluate(
    (x, z, yaw) => {
      const g = window.__game;
      const p = g.sim.player;
      if (p.dead) g.sim.releaseSpirit();
      p.maxHp = 99999;
      p.hp = 99999;
      p.pos.x = x;
      p.pos.z = z;
      p.facing = yaw;
      g.input.camYaw = yaw;
    },
    x,
    z,
    yaw,
  );
  await new Promise((r) => setTimeout(r, 700));
};

// Zone 1 lake (Eastbrook Vale): x -92, z 88, radius 30.
await tp(-58, 50, -0.9);
await page.screenshot({ path: 'tmp/w1518_01_zone1_lake.png' });

// Zone 2 lake (Deepfen Shallows): x 60, z 380, radius 25.
await tp(30, 400, -0.7);
await page.screenshot({ path: 'tmp/w1518_02_zone2_lake.png' });

// Zone 3 lake: x -70, z 760, radius 18.
await tp(-100, 730, -0.7);
await page.screenshot({ path: 'tmp/w1518_03_zone3_lake.png' });

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'OK: no console/page errors');
await browser.close();
