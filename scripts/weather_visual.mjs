// Weather visual: screenshots of biome-driven ambient precipitation.
// Teleports to the marsh (rain) and the peaks (snow). Run with `npm run dev`
// up: `node scripts/weather_visual.mjs`. Output lands in tmp/ (gitignored).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const CLASS = process.env.GAME_CLASS ?? 'mage';
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
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.click('#btn-offline');
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Stormcaller');
await page.click(`#offline-select .mini-class[data-class="${CLASS}"]`);
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 3000));

const tp = async (x, z, yaw = 0, settle = 5500) => {
  await page.evaluate((x, z, yaw) => {
    const g = window.__game;
    const p = g.sim.player;
    if (p.dead) g.sim.releaseSpirit();
    p.maxHp = 99999; p.hp = 99999;
    p.pos.x = x; p.pos.z = z;
    p.facing = yaw;
    g.input.camYaw = yaw;
  }, x, z, yaw);
  // let the precipitation cross-fade ease in to its steady state
  await new Promise((r) => setTimeout(r, settle));
};

// Thornpeak Heights (biome 'peaks', z 540..900) -> drifting snow
await tp(0, 700, 0.3);
await page.screenshot({ path: 'tmp/weather_peaks_snow.png' });

// Mirefen Marsh (biome 'marsh', z 180..540) -> light rain
await tp(0, 300, 0.3);
await page.screenshot({ path: 'tmp/weather_marsh_rain.png' });

// Eastbrook Vale (biome 'vale') -> clear, for the before/after contrast
await tp(0, 60, 0.3);
await page.screenshot({ path: 'tmp/weather_vale_clear.png' });

await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('wrote tmp/weather_marsh_rain.png, tmp/weather_peaks_snow.png, tmp/weather_vale_clear.png');
