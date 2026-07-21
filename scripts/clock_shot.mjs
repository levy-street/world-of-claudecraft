// Screenshots for the minimap clock feature: full HUD + a cropped close-up,
// in both 12-hour and 24-hour formats.
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
await page.click('#btn-offline');
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Thorgar');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 3000));

const clip = async (name) => {
  await new Promise((r) => setTimeout(r, 300));
  await page.screenshot({ path: `tmp/${name}_full.png` });
  const box = await page.evaluate(() => {
    const el = document.querySelector('#minimap-wrap');
    const r = el.getBoundingClientRect();
    return { x: r.x - 16, y: r.y - 8, w: r.width + 32, h: r.height + 28 };
  });
  await page.screenshot({ path: `tmp/${name}_clock.png`,
    clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
};

// default format (12-hour) then toggle to 24-hour via click
await clip('clock_12h');
await page.click('#minimap-clock');
await clip('clock_24h');

const text = await page.$eval('#minimap-clock', (e) => e.textContent);
console.log('clock now reads:', JSON.stringify(text));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console/page errors');
await browser.close();
