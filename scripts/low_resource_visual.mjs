// Captures the low-mana / low-energy warning on the player resource bar.
// Boots the OFFLINE client, drains the player's resource via window.__game.sim,
// and element-clips #player-frame at three resource levels.
// Run the dev client first (npm run dev → :5173), then:
//   node scripts/low_resource_visual.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH as CHROME } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = 'tmp/low-resource';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('PAGEERR', e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await sleep(800);
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(300);
await page.type('#char-name', 'Pyra');
await page.evaluate(() => document.querySelector('#offline-select .mini-class[data-class="mage"]').click());
await page.evaluate(() => document.querySelector('#btn-start-offline').click());
await page.waitForFunction(() => window.__game?.sim?.entities?.size > 3, { timeout: 20000, polling: 300 });
await sleep(1500);
await page.evaluate(() => document.querySelector('#mobile-preflight-continue')?.click());
await sleep(800);

// Pin the player's resource each frame so out-of-combat regen can't refill it
// before the clip lands. frac is a fraction of maxResource.
async function shot(name, frac) {
  await page.evaluate((f) => {
    clearInterval(window.__lrPin);
    const p = window.__game.sim.player;
    window.__lrPin = setInterval(() => { p.resource = Math.round(p.maxResource * f); }, 16);
  }, frac);
  await sleep(700);
  const rect = await page.evaluate(() => {
    const el = document.querySelector('#player-frame');
    const r = el.getBoundingClientRect();
    return { x: Math.max(0, r.x - 10), y: Math.max(0, r.y - 18), width: r.width + 20, height: r.height + 24 };
  });
  await page.screenshot({ path: `${OUT}/${name}.png`, clip: rect });
  console.log('shot', name, frac);
}

await shot('full-mana', 0.85);
await shot('low-mana', 0.18);
await shot('critical-mana', 0.04);

// Full-HUD context shot at low mana.
await page.evaluate(() => { clearInterval(window.__lrPin); const p = window.__game.sim.player; window.__lrPin = setInterval(() => { p.resource = Math.round(p.maxResource * 0.12); }, 16); });
await sleep(700);
await page.screenshot({ path: `${OUT}/full-hud-low-mana.png` });
console.log('shot full-hud');

await browser.close();
console.log('done →', OUT);
