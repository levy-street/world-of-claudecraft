// Visual context for the footstep-audio PR: spawn offline, walk, and screenshot
// the character mid-stride. (The fix itself is audible; see the spectrograms.)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = 'tmp/sfx_pr';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Strider');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 2500));

// walk forward; screenshot mid-stride (footsteps are firing on this path)
await page.keyboard.down('w');
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: `${OUT}/walking.png` });
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: `${OUT}/walking2.png` });
await page.keyboard.up('w');

const st = await page.evaluate(() => {
  const p = window.__game.sim.player;
  return { x: +p.pos.x.toFixed(1), z: +p.pos.z.toFixed(1) };
});
console.log('walked to', JSON.stringify(st));
await browser.close();
