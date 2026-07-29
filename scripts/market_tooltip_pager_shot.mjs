// Reproduction + verification for issue #2456's residual gap: the World Market
// Browse-tab pager (Prev/Next) tears down and rebuilds every `.mkt-row` node
// (renderBrowse's `list.innerHTML = ''`, driven from the pager click handler's own
// `pushQuery()` + `renderContent()`), the same row-teardown shape refreshIfChanged()
// and render() already guard with hideTooltip(). A row destroyed this way fires no
// mouseleave, so a tooltip claimed by a page-1 row would otherwise still be showing
// once page 2's different rows are on screen.
//
// The repro shows the tooltip (a real mouseenter/mousemove on desktop, a touch peek
// on mobile; see below), then activates the pager button via its own .click() in-page
// rather than a second hover/move. That mirrors the interaction model the residual gap
// is about (assistive-tech activation, a synthetic/keyboard activation, or any path
// that lands on the button without the pointer physically leaving the old row first):
// the virtual mouse cursor never moves off the old row, so no mouseleave fires on its
// own, and only the fix's explicit hideTooltip() call in the pager handler closes the
// tooltip. The capture also no-ops the periodic 500ms-band refreshIfChanged() poll
// (the #2582 fix, unrelated to this change) so the shot isolates what the pager
// handler itself does, rather than that unrelated poll self-healing the gap a moment
// later.
//
// Run with `npm run dev` already up.
//   LABEL=before|after   purely cosmetic, only affects the output filenames
//   VIEWPORT=desktop|mobile
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';
import { buildFillerListings, summarizeListingIds } from './lib/market_filler_listings.mjs';

const LABEL = process.env.LABEL ?? 'after';
const VIEWPORT = process.env.VIEWPORT ?? 'desktop';
const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = 'tmp/market_tooltip_pager';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (cond, msg) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'}  ${msg}`);
  if (!cond) fails.push(msg);
};

const isMobile = VIEWPORT === 'mobile';
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    isMobile ? '--window-size=844,390' : '--window-size=1280,800',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
  ],
  defaultViewport: isMobile
    ? { width: 844, height: 390, isMobile: true, hasTouch: true, isLandscape: true }
    : { width: 1280, height: 800 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => fails.push(`PAGEERROR: ${e.message}`));
// This capture runs Chromium on swiftshader (software rendering), which the client
// itself detects and surfaces as a one-time "software rendering notice" toast
// (src/ui/gpu_notice_toast.ts). That toast is an environment artifact of running
// headless with --use-angle=swiftshader, unrelated to the market tooltip bug this
// script captures, and its fixed-position box can overlap the market window on the
// small mobile viewport; pre-dismiss it via the same localStorage key the toast's
// own dismiss button writes, before any page script runs.
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('woc_gpu_notice_dismissed', '1');
  } catch {
    // Storage unavailable in this context; nothing to pre-dismiss.
  }
});
if (isMobile) {
  // Mobile is landscape-only in-game on the web client: emulate a landscape phone.
  await page.emulate({
    name: 'phone-landscape',
    userAgent:
      'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
    viewport: {
      width: 844,
      height: 390,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      isLandscape: true,
    },
  });
}

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await enterOfflineGame(page, {
  charClass: 'warrior',
  charName: 'Bidder',
  settleMs: isMobile ? 2800 : 2200,
});
if (isMobile) {
  await page.evaluate(() => document.getElementById('mobile-preflight-continue')?.click());
  await sleep(400);
}
// Clear the new-adventurer tutorial overlay and any auto-opened window so the
// screenshot shows only the Market.
await page.evaluate(() => {
  document.querySelector('.tut-skip')?.click();
  const hud = window.__game?.hud;
  for (let i = 0; i < 20 && hud?.closeAll?.(); i++) {}
});
await sleep(300);

// Seed a two-page Browse result: MARKET_PAGE_SIZE is 50, so 70 distinctly named
// other-seller listings gives page 1 (50 rows) and page 2 (20 rows) with different
// items on each, which is what makes "the tooltip still describes the old page"
// visible in the capture rather than merely stale.
const seeded = await page.evaluate(() => {
  const { sim } = window.__game;
  const merch = [...sim.entities.values()].find((e) => e.templateId === 'the_merchant');
  const pe = sim.player;
  pe.pos = sim.groundPos(merch.pos.x, merch.pos.z);
  pe.prevPos = { ...pe.pos };
  sim.players.get(sim.playerId).copper = 500000;
  return { takenIds: sim.marketListings.map((l) => l.id), now: sim.time };
});
const fillers = buildFillerListings({ count: 70, takenIds: seeded.takenIds, now: seeded.now });
const setup = await page.evaluate((rows) => {
  const { sim } = window.__game;
  sim.marketListings.push(...rows);
  return { total: sim.marketListings.length, bookIds: sim.marketListings.map((l) => l.id) };
}, fillers);
const ids = summarizeListingIds(setup.bookIds);
console.log(`[${LABEL}/${VIEWPORT}]`, JSON.stringify({ total: setup.total, ids }));
if (ids.unusable > 0 || ids.duplicated > 0 || setup.total < 60) {
  console.error(`[${LABEL}/${VIEWPORT}] seeded book is unfit for capture:`, JSON.stringify(setup));
  process.exitCode = 1;
}

await page.evaluate(() => window.__game.hud.openMarket());
await sleep(500);
// Presentation only: hide every other window so the capture shows just the Market.
await page.evaluate(() => {
  for (const w of document.querySelectorAll('.window')) {
    if (w.id !== 'market-window') w.style.display = 'none';
  }
});
await page.waitForFunction(() => document.querySelectorAll('#market-window .mkt-row').length > 0, {
  timeout: 10000,
});
check(
  await page.evaluate(
    () => document.querySelectorAll('#market-window [data-market-page]').length === 2,
  ),
  'the pager rendered (page 1 of more than one)',
);

// Show the tooltip on the first row. Desktop: dispatch mouseenter/mouseover/mousemove
// in-page (the idiom other tooltip capture scripts use, e.g.
// armor_type_tooltip_shot.mjs), so the row's own mouseenter listener fires and the
// tooltip box claims it, exactly like a player pausing over a listing. attachTooltip
// ignores mouse events on `body.mobile-touch` (see src/ui/hud.ts attachTooltip): mobile
// shows a tooltip via a touch PEEK instead, a pointerdown held past TOOLTIP_PEEK_MS
// (950ms, src/ui/touch_peek.ts) without a pointerup, so mobile dispatches that instead.
// Either way this is one atomic evaluate() rather than puppeteer's own page.hover
// (which round-trips through scrollIntoViewIfNeeded and can find the row already torn
// down by the offline sim's own per-frame refresh).
const hovered = await page.evaluate((useTouchPeek) => {
  const row = document.querySelector('#market-window .mkt-row');
  if (!row) return false;
  const r = row.getBoundingClientRect();
  const x = r.x + r.width / 2;
  const y = r.y + r.height / 2;
  if (useTouchPeek) {
    row.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: x,
        clientY: y,
        pointerType: 'touch',
      }),
    );
  } else {
    for (const type of ['mouseenter', 'mouseover', 'mousemove']) {
      row.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
    }
  }
  return true;
}, isMobile);
check(hovered, 'a page-1 row was found to hover');
if (isMobile) {
  // The peek fires from a setTimeout(TOOLTIP_PEEK_MS) armed by the pointerdown above;
  // wait past it (real time, not sim time) before the tooltip is expected to show.
  await sleep(1100);
}
await page.waitForFunction(() => document.querySelector('#tooltip')?.style.display !== 'none', {
  timeout: 5000,
});
check(
  await page.evaluate(() => document.querySelector('#tooltip')?.style.display !== 'none'),
  'the tooltip is showing over the page-1 row',
);
const clip = await page.evaluate(() => {
  const el = document.querySelector('#market-window');
  const r = el.getBoundingClientRect();
  return {
    x: Math.max(0, Math.round(r.x) - 4),
    y: Math.max(0, Math.round(r.y) - 4),
    width: Math.round(r.width) + 8,
    height: Math.round(r.height) + 8,
  };
});

// Hud.update() polls marketWindow.refreshIfChanged() on its own 500ms band
// (tests/hud_update_drive.test.ts), independently of the pager click. That poll
// already hides the tooltip on its own (the #2582 fix this PR does not touch),
// which would otherwise self-heal the bug within half a second and hide the very
// gap this capture is about. No-op it for this capture only, isolating exactly
// what the pager click handler itself does (which is the residual gap #2456's
// tracking issue is closed by): a screen reader or synthetic activation of the
// pager reaching it well within that 500ms window sees this exact frame.
await page.evaluate(() => {
  window.__game.hud.marketWindow.refreshIfChanged = () => {};
});

// Activate the pager's Next button in-page (its own .click()), NOT a second
// page.hover/page.mouse.move: the virtual cursor stays where it was (over the
// now-destroyed page-1 row), so no mouseleave fires on the way to page 2. That is
// the exact gap the fix closes: only the pager handler's own hideTooltip() call
// (not a mouseleave the interaction never produced) can close the tooltip here.
await page.evaluate(() => {
  document.querySelector('#market-window [data-market-page="next"]')?.click();
});
await sleep(150);

const tooltipStillShowing = await page.evaluate(
  () => document.querySelector('#tooltip')?.style.display !== 'none',
);
console.log(
  `[${LABEL}/${VIEWPORT}] tooltip still visible after the pager click: ${tooltipStillShowing}`,
);
const outPath = `${OUT}/${LABEL}-${VIEWPORT}.png`;
await page.screenshot({ path: outPath, clip });
console.log(`saved ${outPath}`);

await browser.close();
if (fails.length > 0) {
  console.error('FAILURES:', fails.join('; '));
  process.exitCode = 1;
}
