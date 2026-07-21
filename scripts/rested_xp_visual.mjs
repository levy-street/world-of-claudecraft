// Visual capture for the Rested XP feature (#308). Boots the offline client,
// gives the player a rested pool, and screenshots the XP-bar rested overlay
// (hover label) plus the "+rested" floating combat text on a rested kill award.
// Requires `npm run dev` running. Output → tmp/rested/.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = 'tmp/rested';
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
await page.click('#btn-offline');
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Innkeeper');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 2500));

// Seed a partial XP bar (25%) with a rested pool ahead of it so the blue
// rested overlay reads clearly mid-bar.
await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.xp = 40;
  sim.meta(sim.playerId).restedXp = 120;
});
await new Promise((r) => setTimeout(r, 300));
await page.hover('#xpbar');
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: `${OUT}/01_rested_bar.png`, clip: { x: 480, y: 760, width: 640, height: 130 } });

// Trigger a rested kill award to show the blue "+rested" floating text.
await page.evaluate(() => {
  const sim = window.__game.sim;
  const meta = sim.meta(sim.playerId);
  meta.restedXp = 200;
  sim.grantXp(60, meta, { fromKill: true });
});
await new Promise((r) => setTimeout(r, 120));
await page.screenshot({ path: `${OUT}/02_rested_fct.png`, clip: { x: 560, y: 170, width: 480, height: 260 } });

const state = await page.evaluate(() => {
  const sim = window.__game.sim;
  return { xp: sim.xp, restedXp: sim.restedXp, level: sim.player.level };
});
console.log('final state:', JSON.stringify(state));
console.log('saved screenshots to', OUT);
await browser.close();
