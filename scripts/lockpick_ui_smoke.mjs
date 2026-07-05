// UI smoke for the lockpicking minigame panel. Feeds synthetic lockpick events
// into hud.handleEvents() (the real render path) and screenshots the ante
// selector + board. Needs npm run dev (:5173). Render-only — no real session,
// so we don't click action buttons (that would hit the sim with no session).

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const BROWSER_PATH =
  process.env.BROWSER_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  userDataDir: `C:/Users/Sud0S/AppData/Local/Temp/woc-lockpick-${Date.now()}`,
  args: [
    '--window-size=1280,800',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-first-run',
    '--no-default-browser-check',
  ],
  defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`);
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.click('#btn-offline');
await sleep(200);
await page.type('#char-name', 'Picker');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await sleep(2200);

// 1) Ante selector
await page.evaluate(() => window.__game.hud.handleEvents([{ type: 'lockpickOffer', objectId: 1 }]));
await sleep(300);
const anteDom = await page.evaluate(() => {
  const el = document.querySelector('#lockpick-panel');
  return {
    visible: el.style.display === 'block',
    anteBtns: el.querySelectorAll('[data-ante]').length,
    text: el.textContent.slice(0, 80),
  };
});
await page.screenshot({ path: 'tmp/lockpick_ante.png' });
console.log('ante selector:', JSON.stringify(anteDom));

// 2) Board (synthetic fogged view)
await page.evaluate(() => {
  const visible = [
    { col: 0, row: 1, kind: 'open' },
    { col: 0, row: 2, kind: 'open' },
    { col: 0, row: 3, kind: 'open' },
    { col: 1, row: 1, kind: 'open' },
    { col: 1, row: 2, kind: 'open' },
    { col: 1, row: 3, kind: 'open' },
    { col: 2, row: 2, kind: 'gate' },
    { col: 3, row: 1, kind: 'open' },
    { col: 3, row: 2, kind: 'open' },
    { col: 3, row: 3, kind: 'open' },
    { col: 4, row: 2, kind: 'open' },
    { col: 4, row: 3, kind: 'open' },
    { col: 4, row: 4, kind: 'open' },
  ];
  window.__game.hud.handleEvents([
    {
      type: 'lockpickSession',
      sessionId: 't1',
      objectId: 1,
      w: 11,
      h: 6,
      col: 0,
      row: 2,
      lives: 1,
      lootTier: 'premium',
      allowed: ['hardSet', 'set', 'steady', 'ease', 'drop'],
      visible,
    },
  ]);
});
await sleep(300);
const boardDom = await page.evaluate(() => {
  const el = document.querySelector('#lockpick-panel');
  return {
    visible: el.style.display === 'block',
    cells: el.querySelectorAll('.lp-cell').length,
    fog: el.querySelectorAll('.lp-fog').length,
    gate: el.querySelectorAll('.lp-gate').length,
    marker: el.querySelectorAll('.lp-marker').length,
    actions: el.querySelectorAll('.lp-action-btn').length,
    pips: el.querySelectorAll('.lp-pip').length,
  };
});
await page.screenshot({ path: 'tmp/lockpick_board.png' });
console.log('board:', JSON.stringify(boardDom));

// 3) A step (advance + a slip feedback)
await page.evaluate(() => {
  const visible = [
    { col: 0, row: 2, kind: 'open' },
    { col: 1, row: 2, kind: 'open' },
    { col: 2, row: 2, kind: 'gate' },
    { col: 3, row: 2, kind: 'open' },
    { col: 4, row: 3, kind: 'open' },
    { col: 5, row: 3, kind: 'open' },
  ];
  window.__game.hud.handleEvents([
    {
      type: 'lockpickStep',
      sessionId: 't1',
      col: 1,
      row: 2,
      lives: 1,
      result: 'advanced',
      visible,
    },
  ]);
});
await sleep(200);
await page.screenshot({ path: 'tmp/lockpick_step.png' });

console.log('errors:', errors.length ? errors.slice(0, 5).join(' | ') : 'none');
await browser.close();
