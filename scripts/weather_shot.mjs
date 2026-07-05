// Ambient precipitation: capture snowfall in the peaks and rain in the marsh.
// Verifies the precip sprites read as real flakes/drops, not boulders visible
// from across the map. Needs `npm run dev` (:5173). Writes PNGs into tmp/.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

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
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Flurry');
await page.evaluate(() => document.querySelector('#offline-select .mini-class[data-class="mage"]').click());
await page.evaluate(() => document.querySelector('#btn-start-offline').click());
await new Promise((r) => setTimeout(r, 3000));

await page.evaluate(() => { const p = window.__game.sim.player; p.maxHp = p.hp = 99999; });

// god-mode + teleport; let the precip field cross-fade in and animate.
const tp = async (x, z, yaw = 0) => {
  await page.evaluate((x, z, yaw) => {
    const g = window.__game;
    const p = g.sim.player;
    if (p.dead) g.sim.releaseSpirit();
    p.maxHp = p.hp = 99999;
    p.pos.x = x; p.pos.z = z; p.facing = yaw;
    g.input.camYaw = yaw;
  }, x, z, yaw);
  // precip cross-fades over ~2s; give it a few seconds to fill in + fall
  await new Promise((r) => setTimeout(r, 4000));
};

// peaks -> snow, marsh -> rain (same z bands the motes tour uses)
await tp(40, 720, 0.5);
await page.screenshot({ path: 'tmp/weather_snow_peaks.png' });
await tp(60, 360, 0.5);
await page.screenshot({ path: 'tmp/weather_rain_marsh.png' });

// report the live material size so the fix is verifiable in the log, not just by eye
const stats = await page.evaluate(() => {
  const w = window.__game.renderer.weather;
  return { mode: w.mode, size: w.material.size, opacity: +w.material.opacity.toFixed(2) };
});
console.log('weather:', JSON.stringify(stats));
console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 15).join('\n') : 'no page errors');
await browser.close();
