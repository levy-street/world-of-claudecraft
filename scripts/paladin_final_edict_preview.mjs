// Side-by-side visual check for the stock Paladin 1H attack and Final Edict.
//
// Usage:
//   npm run dev
//   node scripts/paladin_final_edict_preview.mjs
//   node scripts/paladin_final_edict_preview.mjs --interactive
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const BASE = process.env.WOC_DEV_BASE ?? 'http://127.0.0.1:5173';
const interactive = process.argv.includes('--interactive');
const requestedTime = Number(
  process.argv.find((argument) => argument.startsWith('--time='))?.slice('--time='.length) ?? 0.4,
);
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: !interactive,
  args: [
    '--window-size=1600,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
  ],
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(`PAGEERROR: ${error.message}`));
page.on('console', (message) => {
  if (message.type() !== 'error') return;
  const text = message.text();
  if (text.includes('502') || text.includes('Failed to fetch project stats')) return;
  errors.push(`CONSOLE: ${text}`);
});

await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 45_000 });
await page.evaluate(async () => {
  const previewModule = await import('/src/render/characters/paladin_templars_verdict_preview.ts');
  window.__paladinFinalEdictPreview = await previewModule.mountPaladinTemplarsVerdictPreview();
});

if (interactive) {
  console.log('Final Edict preview ready. Press Space or click Repetir to replay.');
  console.log('Close the browser or press Ctrl+C when finished.');
  await new Promise((resolve) => browser.on('disconnected', resolve));
} else {
  await page.evaluate(
    (seconds) => window.__paladinFinalEdictPreview.pauseAt(seconds),
    requestedTime,
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  const screenshot = 'tmp/paladin_final_edict_comparison.png';
  await page.screenshot({ path: screenshot });
  if (errors.length > 0) throw new Error(errors.join('\n'));
  console.log(`Final Edict comparison captured at ${requestedTime.toFixed(2)} s: ${screenshot}`);
  console.log('Authored impact: 0.40 s, normalized 0.50.');
  await browser.close();
}
