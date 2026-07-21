// Desktop character-select chrome shots: registers a throwaway account, creates
// three characters, lands on the roster, and captures the screen at a wide and
// a narrow desktop width. Verifies the site menu bar stays visible above the
// full-screen stage and the $WOC Wallet / Developer cards lay out sanely.
// Needs the dev server (GAME_URL, default :5173) and the game server on :8787.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync('tmp', { recursive: true });

const uniq = Date.now().toString(36).slice(-6);
const alpha = uniq.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]);
const USER = `uishot_${uniq}`;
const CHARS = [
  { name: `Ashot${alpha}`, cls: 'warrior' },
  { name: `Bshot${alpha}`, cls: 'mage' },
  { name: `Cshot${alpha}`, cls: 'druid' },
];

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 60000,
  args: ['--window-size=2000,1150', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 2000, height: 1150 },
});
const page = await browser.newPage();
await page.setViewport({ width: 2000, height: 1150 });
page.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 200)));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await sleep(900);
await page.evaluate(() => document.querySelector('#btn-online')?.click());
await sleep(500);
await page.evaluate(
  (u, p) => {
    // Register mode: the login form toggles via the Create Account link and
    // submits through the same #btn-login submit button.
    document.querySelector('#btn-auth-toggle')?.click();
    const set = (id, v) => {
      const el = document.querySelector(id);
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('#login-user', u);
    set('#login-pass', p);
    set('#login-email', `${u}@example.com`);
    document.querySelector('#btn-login').click();
  },
  USER,
  'hunter22',
);
// Fresh accounts land on the World List first: click through whichever
// screen shows up until a character screen is visible.
const deadline = Date.now() + 25000;
for (;;) {
  const state = await page.evaluate(() => {
    const vis = (sel) => {
      const el = document.querySelector(sel);
      return !!el && !el.hidden && getComputedStyle(el).display !== 'none';
    };
    if (vis('#charselect-panel') || vis('#charcreate-panel')) return 'chars';
    const row = document.querySelector('#realm-list .realm-row');
    if (row && vis('#realm-panel')) {
      row.click();
      return 'realm-clicked';
    }
    return 'waiting';
  });
  if (state === 'chars') break;
  if (state !== 'waiting') console.log(state);
  if (Date.now() > deadline) throw new Error(`stuck before character screen (${state})`);
  await sleep(400);
}
console.log('registered, on character screen');

for (const c of CHARS) {
  // Fresh accounts can land on either the roster or the create screen.
  const onCreate = await page.evaluate(() => {
    const el = document.querySelector('#charcreate-panel');
    return !!el && !el.hidden && getComputedStyle(el).display !== 'none';
  });
  if (!onCreate) {
    await page.evaluate(() => document.querySelector('#btn-new-character')?.click());
    await sleep(400);
  }
  await page.evaluate(
    (name, cls) => {
      const input = document.querySelector('#new-char-name');
      input.value = name;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector(`#charcreate-panel .mini-class[data-class="${cls}"]`)?.click();
      document.querySelector('#btn-create-char')?.click();
    },
    c.name,
    c.cls,
  );
  await sleep(900);
  console.log('created', c.name);
}

await page.waitForFunction(
  () => {
    const el = document.querySelector('#charselect-panel');
    return !!el && !el.hidden && getComputedStyle(el).display !== 'none';
  },
  { timeout: 8000, polling: 200 },
);
await sleep(1600); // let the 3D preview settle

const chrome = await page.evaluate(() => {
  const header = document.querySelector('.homepage-header');
  const r = header?.getBoundingClientRect();
  return {
    headerVisible: !!header && getComputedStyle(header).visibility !== 'hidden',
    headerRect: r ? { top: r.top, height: r.height } : null,
    headerZ: header ? getComputedStyle(header).zIndex : null,
  };
});
console.log('site header:', JSON.stringify(chrome));

await page.screenshot({ path: 'tmp/charselect_desktop_wide.png' });
await page.setViewport({ width: 1100, height: 800 });
await sleep(700);
await page.screenshot({ path: 'tmp/charselect_desktop_narrow.png' });
await page.setViewport({ width: 1500, height: 950 });
await sleep(700);
await page.screenshot({ path: 'tmp/charselect_desktop_mid.png' });
console.log('wrote tmp/charselect_desktop_{wide,narrow,mid}.png');
await browser.close();
