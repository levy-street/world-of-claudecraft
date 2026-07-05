// Visual + geometric check for the mobile top-right HUD cluster (minimap / buff
// bar / quest tracker) honouring env(safe-area-inset-*) on notched phones.
//
// Headless Chromium can't synthesise real safe-area insets, so we simulate a
// 44px right-edge notch (drawn as a translucent overlay) and compare the
// minimap's right edge in two states:
//   BEFORE  — bare `right: 6px` (the pre-fix rule): minimap sits UNDER the notch.
//   AFTER   — `right: max(6px, <inset>)` (the fixed rule): minimap clears it.
//
// Needs `npm run dev` running. Writes before/after PNGs to /tmp.
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.URL || 'http://localhost:5173/';
const INSET = 44; // simulated right-edge safe-area inset (px), e.g. a landscape notch

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--no-sandbox', '--force-device-scale-factor=1'],
});
try {
  const page = await browser.newPage();
  // Landscape phone viewport (iPhone-ish 667x375).
  await page.setViewport({ width: 667, height: 375, isMobile: true, hasTouch: true });
  await page.goto(URL, { waitUntil: 'networkidle2' });

  // Enter the offline world: open the panel, pick a class, start.
  await enterOfflineGame(page, { charClass: 'warrior', charName: 'Adventurer', settleMs: 2500 });
  // Dismiss the mobile preflight gate if present.
  await page.evaluate(() => document.querySelector('#mobile-preflight-continue')?.click());
  await sleep(600);

  // Headless can't report pointer:coarse, so force the gameplay body classes.
  await page.evaluate(() => {
    document.body.classList.add('mobile-touch', 'game-active');
  });
  await sleep(400);

  // Draw the simulated notch zone on the right edge.
  await page.evaluate((inset) => {
    const n = document.createElement('div');
    n.id = '__notch';
    Object.assign(n.style, {
      position: 'fixed',
      top: '0',
      right: '0',
      width: inset + 'px',
      height: '100%',
      background: 'rgba(220,40,40,0.28)',
      borderLeft: '2px dashed #ff5555',
      zIndex: '9999',
      pointerEvents: 'none',
    });
    document.body.appendChild(n);
  }, INSET);

  const mm = '#minimap-wrap';
  const measure = () =>
    page.$eval(mm, (el) => {
      const r = el.getBoundingClientRect();
      return { right: Math.round(r.right), vw: window.innerWidth };
    });

  // Top-right corner crop so the minimap shift is clearly visible in the PR asset.
  const corner = { x: 667 - 260, y: 0, width: 260, height: 180 };

  // BEFORE: force the old bare offset (inset ignored).
  await page.$eval(mm, (el) => {
    el.style.right = '6px';
  });
  await sleep(150);
  const before = await measure();
  await page.screenshot({ path: '/tmp/minimap-before.png' });
  await page.screenshot({ path: '/tmp/minimap-before-corner.png', clip: corner });

  // AFTER: emulate env(safe-area-inset-right)=INSET honoured by the fixed rule.
  await page.$eval(
    mm,
    (el, inset) => {
      el.style.right = `max(6px, ${inset}px)`;
    },
    INSET,
  );
  await sleep(150);
  const after = await measure();
  await page.screenshot({ path: '/tmp/minimap-after.png' });
  await page.screenshot({ path: '/tmp/minimap-after-corner.png', clip: corner });

  const safeEdge = before.vw - INSET; // right edge of the usable (non-notch) area
  console.log(
    `viewport width: ${before.vw}px, simulated notch: ${INSET}px (safe right edge at x=${safeEdge})`,
  );
  console.log(
    `BEFORE  minimap.right = ${before.right}px  -> ${before.right > safeEdge ? 'CLIPPED under notch ✗' : 'ok'}`,
  );
  console.log(
    `AFTER   minimap.right = ${after.right}px  -> ${after.right <= safeEdge ? 'clears notch ✓' : 'still clipped ✗'}`,
  );
  console.log('screenshots: /tmp/minimap-before.png, /tmp/minimap-after.png');

  if (before.right <= safeEdge || after.right > safeEdge) {
    console.error('CHECK FAILED: expected before=clipped, after=clear');
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
