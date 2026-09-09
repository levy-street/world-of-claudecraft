// Before/after proof for the perf-overlay UI-Scale corner bug: at a reduced UI
// Scale, #perf-overlay (src/ui/perf_overlay.ts) wrote its clamped VISUAL position
// straight to style.left/top with no author-space division, so #ui's `zoom:
// var(--ui-scale)` shrank the write again and the panel fell short of the true
// screen corner. Fixed movable windows (movable_frame.ts) always divided by
// getUiScale() and reached the edge fine; the perf overlay did not.
//
// Seeds a reduced UI Scale (0.85) plus the FPS overlay pinned to the bottom-right
// corner (posX/posY: 1) BEFORE the app boots, so the very first paint already
// shows the bug (or its absence) with no drag interaction required. Captures a
// full-viewport context shot plus a zoomed crop of the bottom-right corner where
// the gap (or its absence) is obvious.
//
// Needs `npm run dev` on :5173 (override with GAME_URL). Writes to tmp/.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT_PREFIX = process.env.SHOT_PREFIX ?? 'tmp/perf_overlay_corner';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const VW = 1600;
const VH = 900;
const REDUCED_UI_SCALE = 0.85; // UI_SCALE_MIN (src/ui/ui_scale.ts): the smallest, most "reduced" interface

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [`--window-size=${VW},${VH}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: VW, height: VH },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

// Seed the lowest graphics preset (the standing capture rule) plus a reduced UI
// Scale, and pin the FPS overlay on with a persisted bottom-right corner position,
// all BEFORE the document loads so the very first paint already reflects it.
await page.evaluateOnNewDocument((uiScale) => {
  try {
    localStorage.setItem(
      'woc_settings',
      JSON.stringify({ graphicsPreset: 1, uiScale, showFps: true }),
    );
    localStorage.setItem('woc_perf_overlay', JSON.stringify({ posX: 1, posY: 1 }));
  } catch {
    /* ignore */
  }
}, REDUCED_UI_SCALE);

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
const booted = await enterOfflineGame(page, { charClass: 'warrior', charName: 'Scaler' });
if (!booted) throw new Error('offline world did not boot');

// The overlay is positioned synchronously by the startup apply-all loop
// (main.ts, applySetting('showFps', ...) -> perfOverlay.setEnabled(true) ->
// reposition()), so a short settle covers only the world's own paint.
await sleep(800);
await page.waitForFunction(
  () => {
    const el = document.getElementById('perf-overlay');
    return !!el && getComputedStyle(el).display !== 'none';
  },
  { timeout: 10000 },
);

const geom = await page.evaluate(() => {
  const el = document.getElementById('perf-overlay');
  const r = el.getBoundingClientRect();
  return {
    left: r.left,
    top: r.top,
    right: r.right,
    bottom: r.bottom,
    viewportW: window.innerWidth,
    viewportH: window.innerHeight,
    styleLeft: el.style.left,
    styleTop: el.style.top,
    uiScale: getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim(),
  };
});
console.log('perf-overlay geometry:', geom);
console.log(
  'gap from true corner (px): right=',
  geom.viewportW - geom.right,
  'bottom=',
  geom.viewportH - geom.bottom,
  '(expect ~8px flush margin when fixed; a large gap reproduces the bug)',
);

await page.screenshot({ path: `${OUT_PREFIX}_full.png` });

// Zoomed crop of the bottom-right corner: wide enough to show the true corner
// AND the overlay's actual position, whichever side of the gap it lands on.
const cropW = 420;
const cropH = 260;
await page.screenshot({
  path: `${OUT_PREFIX}_corner.png`,
  clip: { x: VW - cropW, y: VH - cropH, width: cropW, height: cropH },
});

await browser.close();
console.log('wrote', `${OUT_PREFIX}_full.png`, 'and', `${OUT_PREFIX}_corner.png`);
