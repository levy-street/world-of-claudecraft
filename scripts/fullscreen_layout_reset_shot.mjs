// Proof harness for the fullscreen<->windowed HUD layout reset bug fix.
//
// Player report: drag a HUD window/panel (chat box, bags, the DPS meter
// window) to a custom spot, leave fullscreen (or resize the browser), then
// return: the window used to stay wherever the shrink-time clamp had left it
// instead of returning to the exact spot the player chose. Boots an offline
// warrior at a large (4K-ish) viewport, opens the bags window and the meters
// (damage) window, drags both plus the chat box into custom corners, shrinks
// to 1080p (leaving fullscreen), then grows back to the original size
// (re-entering fullscreen) and asserts every window lands EXACTLY where it
// was dragged.
//
// Needs `npm run dev` on :5173 (override with GAME_URL). Writes to tmp/ (or
// SHOTS_DIR).
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.SHOTS_DIR ?? 'tmp';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LARGE = { width: 3840, height: 2160 };
const SMALL = { width: 1920, height: 1080 };

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    `--window-size=${LARGE.width},${LARGE.height}`,
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  defaultViewport: LARGE,
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
const media = await page.createCDPSession();

// Seed the lowest graphics preset before the app boots (standing capture rule).
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
  } catch {
    /* ignore */
  }
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
const booted = await enterOfflineGame(page, { charClass: 'warrior', charName: 'Anchor' });
if (!booted) throw new Error('offline world did not boot');
await sleep(500);

await page.evaluate(() => {
  const dismiss = [...document.querySelectorAll('button')].find(
    (b) => b.textContent.trim() === 'Dismiss',
  );
  dismiss?.click();
});

// Open the bags window and the meters (damage) window.
await page.evaluate(() => window.__game?.hud?.toggleBags?.());
await page.waitForFunction(
  () => {
    const el = document.querySelector('#bags .panel-title');
    return !!el && el.getBoundingClientRect().width > 0;
  },
  { timeout: 10000 },
);
await page.evaluate(() => window.__game?.hud?.toggleMeters?.());
await page.waitForFunction(
  () => getComputedStyle(document.querySelector('#meters-window')).display !== 'none',
  { timeout: 10000 },
);
await sleep(200);

// Drag `handleSelector`'s current position toward (targetX, targetY) via real
// mouse events (Chromium synthesizes PointerEvents from these, which is what
// every drag controller in src/ui/ listens for).
async function dragTo(handleSelector, targetX, targetY) {
  const origin = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + 12, y: r.top + 12 };
  }, handleSelector);
  if (!origin) throw new Error(`drag handle not found: ${handleSelector}`);
  await page.mouse.move(origin.x, origin.y);
  await page.mouse.down();
  await page.mouse.move(targetX, targetY, { steps: 15 });
  await page.mouse.up();
  await sleep(150);
}

async function rectOf(selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), top: Math.round(r.top) };
  }, selector);
}

async function setViewport(size) {
  await media.send('Emulation.setDeviceMetricsOverride', {
    width: size.width,
    height: size.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await sleep(500); // clear the 200ms post-resize settle-timer pass too
}

async function snapshot(label) {
  const chat = await rectOf('#chatlog-wrap');
  const bags = await rectOf('#bags');
  const meters = await rectOf('#meters-window');
  console.log(label, JSON.stringify({ chat, bags, meters }));
  return { chat, bags, meters };
}

// Custom layout at the large viewport: chat bottom-left, bags bottom-right,
// meters top-right (matching the bug report's "chat box in bottom left").
await dragTo('#chatlog-tabs', 60, LARGE.height - 140);
await dragTo('#bags .panel-title', LARGE.width - 220, LARGE.height - 260);
await dragTo('#meters-window .mt-view', LARGE.width - 260, 80);
await sleep(300);
const before = await snapshot('LARGE viewport, after drag:');
await page.screenshot({ path: `${OUT}/01-large-after-drag.png` });

// Leave fullscreen: shrink to 1080p.
await setViewport(SMALL);
const shrunk = await snapshot('SMALL viewport, after shrink:');
await page.screenshot({ path: `${OUT}/02-small-after-shrink.png` });

// Return to fullscreen: growing back must restore the exact spots above.
await setViewport(LARGE);
const restored = await snapshot('LARGE viewport, after growing back:');
await page.screenshot({ path: `${OUT}/03-large-after-regrow.png` });

const same = (a, b) => a && b && a.left === b.left && a.top === b.top;
const results = {
  chat: same(before.chat, restored.chat),
  bags: same(before.bags, restored.bags),
  meters: same(before.meters, restored.meters),
};
console.log('RESULT', JSON.stringify(results));
console.log('(shrunk snapshot, for reference, must differ from `before` on at least one window):');
console.log(
  JSON.stringify({
    chatMoved: !same(before.chat, shrunk.chat),
    bagsMoved: !same(before.bags, shrunk.bags),
    metersMoved: !same(before.meters, shrunk.meters),
  }),
);

await browser.close();
process.exit(Object.values(results).every(Boolean) ? 0 : 1);
