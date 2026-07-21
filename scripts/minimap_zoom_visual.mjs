// Captures the minimap zoom control at each preset (1x / 1.5x / 2x / 3x) plus a
// full-HUD shot, driving the real offline client via window.__game. Screenshots
// land in tmp/. Run the dev client first (npm run dev), then:
//   GAME_URL=http://localhost:5173 node scripts/minimap_zoom_visual.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  protocolTimeout: 60000,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 800 },
});

const page = await browser.newPage();
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await sleep(800);

// offline boot: btn-offline -> name -> class -> start (input id is char-name)
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(400);
await page.evaluate(() => {
  document.querySelector('#char-name').value = 'Scout';
  document.querySelector('#offline-select .mini-class[data-class="hunter"]').click();
  document.querySelector('#btn-start-offline').click();
});
await page.waitForFunction(() => window.__game?.sim?.entities?.size > 5, { timeout: 20000, polling: 400 });
await sleep(500);
// dismiss the mobile preflight if it appears
await page.evaluate(() => document.querySelector('#mobile-preflight-continue')?.click());
await sleep(400);

// crop tight to the minimap (+ its zoom pill, which hangs ~6px below the canvas)
async function clipMinimap(name) {
  const rect = await page.evaluate(() => {
    const r = document.querySelector('#minimap-wrap').getBoundingClientRect();
    return { x: r.x - 6, y: r.y - 6, width: r.width + 12, height: r.height + 22 };
  });
  await page.screenshot({ path: `tmp/${name}.png`, clip: rect });
}

// reset to a known state, then step the control like a player would
await page.evaluate(() => { localStorage.removeItem('minimapZoom'); });
for (const [z, file] of [[1, 'mmzoom-1x'], [1.5, 'mmzoom-1_5x'], [2, 'mmzoom-2x'], [3, 'mmzoom-3x']]) {
  await page.evaluate((target) => {
    // drive through the public buttons so the readout + disabled states update
    document.querySelector('#minimap-zoom-out').click(); // floor to 1x
    document.querySelector('#minimap-zoom-out').click();
    const steps = [1, 1.5, 2, 3].indexOf(target);
    for (let i = 0; i < steps; i++) document.querySelector('#minimap-zoom-in').click();
  }, z);
  await sleep(500);
  await clipMinimap(file);
  const shown = await page.evaluate(() => document.querySelector('#minimap-zoom-label').textContent);
  console.log(`zoom ${z}x -> label "${shown}"`);
}

// a full-HUD shot at 2x so the control reads in context
await page.evaluate(() => {
  document.querySelector('#minimap-zoom-out').click();
  document.querySelector('#minimap-zoom-out').click();
  document.querySelector('#minimap-zoom-in').click();
  document.querySelector('#minimap-zoom-in').click();
});
await sleep(500);
await page.screenshot({ path: 'tmp/mmzoom-full-hud.png' });

console.log(errors.length ? 'PAGE ERRORS:\n' + errors.slice(0, 8).join('\n') : 'no page errors');
await browser.close();
