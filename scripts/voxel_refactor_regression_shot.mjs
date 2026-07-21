// Confirms the src/sim/voxel.ts refactor (additive engine, no renderer wiring)
// did not regress existing overworld terrain rendering. Boots the offline
// world and screenshots the default spawn view. Needs `npm run dev` running.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

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
await enterOfflineGame(page, { charClass: 'warrior', charName: 'Regression' });
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: `${OUT}/voxel_refactor_regression_check.png` });

await browser.close();
console.log('wrote screenshot to', OUT);
