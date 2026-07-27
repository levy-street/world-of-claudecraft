// Headless screenshot + interaction driver for the picker page.
// Usage: node shot.mjs <out.png> [charTileIndex] [clicks...]
//   clicks: "set:<variant>" (full-set chip) or "<Piece>:<variant>" (piece chip)
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from '../../browser_path.mjs';

const [out, tileIndex = '0', ...clicks] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--use-angle=swiftshader', '--no-sandbox', '--window-size=1680,1000'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1000 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
await page.goto('http://localhost:5181/', { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForSelector('.char-tile', { timeout: 30000 });
const tiles = await page.$$('.char-tile');
if (Number(tileIndex) > 0) await tiles[Number(tileIndex)].click();
await page.waitForFunction(() => document.getElementById('loading').classList.contains('hidden'), {
  timeout: 60000,
});
for (const c of clicks) {
  const [target, variant] = c.split(':');
  if (target === 'set') {
    await page.click(`#setrow .chip.${variant}`);
  } else {
    await page.click(`.piece-row[data-piece="${target}"] .chip.${variant}`);
  }
  await new Promise((r) => setTimeout(r, 600));
}
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: out });
await browser.close();
console.log('shot ->', out, errors.length ? `ERRORS: ${errors.join(' | ')}` : '(no page errors)');
