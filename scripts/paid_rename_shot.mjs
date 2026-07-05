// Proof shot for the paid rename editor: the burn-priced rename form as it
// renders on a character row, opened through the real module with stubbed
// deps (the burn flow itself needs a live wallet and the enabled server rail).
//
// Needs `npm run dev` (override with GAME_URL). Writes to docs/screenshots/identity/.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = 'docs/screenshots/identity';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=760,560', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 760, height: 560 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('#btn-offline', { timeout: 15000 });
await page.evaluate(async () => {
  const mod = await import('/src/ui/paid_rename.ts');
  const host = document.createElement('div');
  host.style.cssText =
    'position:fixed;inset:0;z-index:9999;background:#0d0a12;display:flex;align-items:center;justify-content:center;';
  const row = document.createElement('div');
  row.style.cssText =
    'width:520px;background:#171021;border:1px solid #3a2d1c;border-radius:8px;padding:16px;color:#e8dcc0;font-family:sans-serif;';
  row.innerHTML =
    '<div style="font-weight:700;color:#ffe9b8;margin-bottom:6px;">Thornwick, level 14 warrior</div>';
  host.appendChild(row);
  document.body.appendChild(host);
  mod.openPaidRenameEditor(
    row,
    { id: 1, name: 'Thornwick' },
    {
      priceWoc: 5000,
      formatWoc: (n) => n.toLocaleString('en-US'),
      pay: async () => ({ name: 'x' }),
      onRenamed: () => {},
      errorText: () => 'error',
    },
  );
});
await new Promise((r) => setTimeout(r, 500));
const el = await page.$('.paid-rename-editor');
if (!el) throw new Error('editor did not render');
const host = await page.evaluateHandle(
  () => document.querySelector('.paid-rename-editor').parentElement,
);
await host.screenshot({ path: `${OUT}/01-paid-rename-editor.png` });
console.log(`done -> ${OUT}/01-paid-rename-editor.png`);
await browser.close();
