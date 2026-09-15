// Visual proof for the Hexcraft (warlock affliction) example-abilities fix.
// Boots the offline game as a warlock, opens Talents -> Specialization, and
// screenshots the Hexcraft spec card so the "Example abilities" row can be
// diffed before/after the src/ui/class_details_data.ts change.
//   node scripts/hexcraft_examples_shot.mjs    (needs `npm run dev` on :5173)
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.SHOT_OUT ?? 'tmp/hexcraft_examples.png';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1000,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1000, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
const booted = await enterOfflineGame(page, { charClass: 'warlock', charName: 'Hexweaver' });
console.log('booted:', booted);

// Open Talents (defaults to the Specialization tab) and let the spec grid paint.
await page.evaluate(() => window.__game.hud.toggleTalents());
await page.waitForSelector('.ts-panel', { visible: true, timeout: 10000 });
await new Promise((r) => setTimeout(r, 300));

const cls = await page.evaluate(() => document.querySelector('.ts-panel .ts-name')?.textContent);
console.log('first spec panel name:', cls);

const clip = await page.evaluate(() => {
  const panel = document.querySelectorAll('.ts-panel')[0];
  const r = panel.getBoundingClientRect();
  return {
    x: Math.round(r.x) - 8,
    y: Math.round(r.y) - 8,
    width: Math.round(r.width) + 16,
    height: Math.round(r.height) + 16,
  };
});
console.log('clip:', JSON.stringify(clip));
await page.screenshot({ path: OUT, clip });
console.log('saved', OUT);

await browser.close();
