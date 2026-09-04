// Mobile screenshot tour: boots the game in a phone-sized touch viewport so the
// on-screen touch controls (body.mobile-touch) activate, then captures the touch
// HUD, the expanded "More" tray, and the new Haptics toggle in both states.
// Needs `npm run dev` (:5173). Writes PNGs into tmp/.
//
// The More tray is reached through the REAL gesture, not page.click: #mobile-more
// is item 9 of the Quick Actions strip (src/ui/hud/menu/menu_strip_core.ts), so it
// is unrendered while that strip is closed and has no clickable point at all. The
// player's own route is a hold on #mobile-menu-anchor to open the row, a drag onto
// the item, and a release there, which is what dragPick below reproduces.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
// The strip's reveal is a page-side timer; hold past it before measuring an item.
const TOUCH_REVEAL_HOLD_MS = 500;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync('tmp', { recursive: true });

/** Viewport centre of `selector`, or null when it is missing or has no box. */
async function touchPoint(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, selector);
}

/** Hold the anchor past the reveal timer, drag the SAME finger onto the revealed
 *  item, and release there: the pick runs on the release. The item is measured
 *  only after the hold, because it has no box until the row opens. */
async function dragPick(page, anchorSelector, itemSelector) {
  const anchor = await touchPoint(page, anchorSelector);
  if (!anchor) throw new Error(`no live touch target for ${anchorSelector}`);
  const touch = await page.touchscreen.touchStart(anchor.x, anchor.y);
  await wait(TOUCH_REVEAL_HOLD_MS);
  const item = await touchPoint(page, itemSelector);
  if (!item) throw new Error(`no live row item for ${itemSelector}`);
  await touch.move(item.x, item.y);
  await wait(400);
  await touch.end();
  await wait(400);
}

/** A real tap through the input pipeline. The tray's controls are pointer-bound
 *  (src/ui/touch_tap.ts bindTouchTap), so drive them the way a thumb does.
 *  Scrolls the control into view first: #mobile-extra-controls is a SCROLLING
 *  panel (max-height 300px, overflow-y auto) whose content is taller than the
 *  panel on a landscape phone, so the last rows sit below the fold and a tap on
 *  their reported box centre lands on the clipped-away region, reaching
 *  #game-canvas instead of the button. Re-measure after the scroll. */
async function tapEl(page, selector) {
  await page.evaluate((sel) => {
    document.querySelector(sel)?.scrollIntoView({ block: 'center' });
  }, selector);
  await wait(200);
  const pt = await touchPoint(page, selector);
  if (!pt) throw new Error(`no live tap target for ${selector}`);
  const reached = await page.evaluate(
    (p) => {
      const el = document.querySelector(p.sel);
      const hit = document.elementFromPoint(p.x, p.y);
      return !!el && !!hit && (hit === el || el.contains(hit));
    },
    { sel: selector, x: pt.x, y: pt.y },
  );
  if (!reached) throw new Error(`${selector} is not hit-testable at its own box centre`);
  await page.touchscreen.tap(pt.x, pt.y);
}

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=900,440', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
// Landscape phone: coarse pointer + small enough to satisfy PHONE_TOUCH_QUERY.
await page.emulate({
  name: 'phone-landscape',
  userAgent:
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
  viewport: {
    width: 900,
    height: 420,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    isLandscape: true,
  },
});

// Seed the LOWEST graphics preset before the app boots, so the captured HUD is
// the cheap, comparable tier rather than whatever this machine happens to
// detect. graphicsDefaultApplied is seeded with it and is the load-bearing half:
// main.ts runs firstRunGraphicsPreset(settings.get('graphicsDefaultApplied'))
// BEFORE the renderer reads the preset, so a seed carrying the preset alone
// leaves the device probe free to persist its own tier straight over it.
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem(
      'woc_settings',
      JSON.stringify({ graphicsPreset: 1, graphicsDefaultApplied: true }),
    );
  } catch {
    // Storage may be unavailable; the capture still runs, just at the detected tier.
  }
});

const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text());
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
const booted = await enterOfflineGame(page, {
  charClass: 'warrior',
  charName: 'Touchscreen',
  settleMs: 2800,
});
// enterOfflineGame RETURNS whether the world hook came up; every read below
// assumes a live HUD, so say so here rather than failing later on a missing box.
if (!booted) {
  console.log('world boot: FAIL (window.__game never appeared)');
  await browser.close();
  process.exit(1);
}

// Dismiss the landscape/fullscreen preflight if it's up.
await page.evaluate(() => {
  document.getElementById('mobile-preflight-continue')?.click();
});
await new Promise((r) => setTimeout(r, 600));

const touchOn = await page.evaluate(() => document.body.classList.contains('mobile-touch'));
console.log('mobile-touch active:', touchOn ? 'OK' : 'FAIL');
await page.screenshot({ path: 'tmp/mobile_01_hud.png' });

// Open the "More" tray to reveal the extra controls incl. Haptics. Quick Actions
// seats #mobile-more as its last strip item, so this is a hold-and-swipe pick on
// the anchor, not a click on a button that is only rendered mid-gesture.
await dragPick(page, '#mobile-menu-anchor', '#mobile-more');
await new Promise((r) => setTimeout(r, 700));
const trayOpen = await page.evaluate(() => document.body.classList.contains('mobile-more-open'));
console.log('more tray open:', trayOpen ? 'OK' : 'FAIL');
await page.screenshot({ path: 'tmp/mobile_02_more_tray.png' });

const before = await page.evaluate(() => {
  const b = document.getElementById('mobile-haptics');
  return {
    exists: !!b,
    pressed: b?.getAttribute('aria-pressed'),
    label: b?.querySelector('.mobile-label')?.textContent,
  };
});
console.log('haptics button (default):', JSON.stringify(before));

// Toggle haptics off: tray stays open, button dims + relabels.
await tapEl(page, '#mobile-haptics');
await new Promise((r) => setTimeout(r, 300));
const after = await page.evaluate(() => {
  const b = document.getElementById('mobile-haptics');
  return {
    pressed: b?.getAttribute('aria-pressed'),
    label: b?.querySelector('.mobile-label')?.textContent,
    persisted: localStorage.getItem('woc_haptics_on'),
  };
});
console.log('haptics button (after toggle):', JSON.stringify(after));
await page.screenshot({ path: 'tmp/mobile_03_haptics_off.png' });

const ok =
  trayOpen &&
  before.exists &&
  before.pressed === 'true' &&
  after.pressed === 'false' &&
  after.persisted === '0';
console.log('haptics toggle:', ok ? 'OK' : 'FAIL');

if (errors.length) {
  console.log('\n=== PAGE ERRORS ===');
  for (const e of errors.slice(0, 20)) console.log(e);
} else {
  console.log('no page errors');
}
await browser.close();
process.exit(ok && touchOn ? 0 : 1);
