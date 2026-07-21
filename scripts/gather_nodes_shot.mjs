// Screenshot of gatherable world nodes (src/render/gather_nodes.ts) for the
// PR that adds them (#1120). Boots the offline world, teleports the player
// next to the Eastbrook Vale ore cluster, and captures the node markers.
// Needs `npm run dev` running. Browser via scripts/browser_path.mjs.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = 'docs/screenshots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Prospector');
await page.evaluate(() =>
  document.querySelector('#offline-select .mini-class[data-class="warrior"]').click(),
);
await page.evaluate(() => document.querySelector('#btn-start-offline').click());
await page.waitForFunction(() => window.__game && window.__game.sim, { timeout: 20000 });
await new Promise((r) => setTimeout(r, 1500));

// Ore cluster near Boar Meadow (see sim/content/gather_nodes.ts).
await page.evaluate(() => {
  const g = window.__game;
  const p = g.sim.player;
  p.pos.x = 65;
  p.pos.z = 5;
  p.facing = Math.atan2(72 - 65, 8 - 5);
  g.input.camYaw = p.facing;
  g.input.camPitch = -0.1;
});
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: `${OUT}/gather_nodes_ore.png` });

await browser.close();
console.log('wrote screenshot to', OUT);
