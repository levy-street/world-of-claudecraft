import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: [
    '--window-size=1600,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
  ],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 300)));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' || /webgl|shader|gl_|fail|error/i.test(t)) {
    console.log('CONSOLE[%s]: %s', m.type(), t.slice(0, 300));
  }
});
page.on('requestfailed', (r) => console.log('REQFAIL:', r.url().slice(0, 160), r.failure()?.errorText));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise((r) => setTimeout(r, 25000));

const state = await page.evaluate(() => ({
  title: document.title,
  hasOfflineBtn: !!document.querySelector('#btn-offline'),
  offlineBtnVisible: !!document.querySelector('#btn-offline')?.offsetParent,
  loadingVisible: !!document.querySelector('#loading')?.offsetParent,
  gameHandle: typeof window.__game,
  canvas: !!document.querySelector('canvas'),
  bodyClass: document.body.className,
  visibleText: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 400),
}));
console.log('STATE:', JSON.stringify(state, null, 2));
await page.screenshot({ path: 'tmp/diag.png' });
console.log('wrote tmp/diag.png');
await browser.close();
process.exit(0);
