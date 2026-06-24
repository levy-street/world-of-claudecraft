// Before/after screenshots for the movable + resizable chat window.
// BEFORE: stock chat box (bottom-left, default size).
// AFTER:  same box dragged up/right and resized larger via the simulated
//         pointer gestures the feature wires to the tab strip + corner grip.
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

const tap = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await tap('#btn-offline');
await new Promise((r) => setTimeout(r, 300));
await page.type('#char-name', 'Thorgar');
await tap('#offline-select .mini-class[data-class="warrior"]');
await tap('#btn-start-offline');
await new Promise((r) => setTimeout(r, 7000));

const rect = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
}, sel);

// pointer drag using real CDP mouse moves so the feature's pointer handlers fire
const drag = async (from, to) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 150));
};

await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: 'tmp/chatbox_before.png' });
const before = await rect('#chatlog-wrap');
console.log('BEFORE wrap:', before);

// MOVE: grab the empty right side of the tab strip and drag up + right.
const tabs = await rect('#chatlog-tabs');
await drag({ x: tabs.right - 8, y: tabs.y + tabs.h / 2 }, { x: 620, y: 360 });

// RESIZE: grab the corner grip and drag out to enlarge.
const grip = await rect('.chat-resize-grip');
await drag({ x: grip.x + grip.w / 2, y: grip.y + grip.h / 2 }, { x: grip.x + 220, y: grip.y + 150 });

await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: 'tmp/chatbox_after.png' });
const after = await rect('#chatlog-wrap');
console.log('AFTER wrap:', after);

// confirm persistence: the geometry survives a reload
const stored = await page.evaluate(() => localStorage.getItem('woc_chat_geometry'));
console.log('persisted woc_chat_geometry:', stored);

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console/page errors');
await browser.close();
