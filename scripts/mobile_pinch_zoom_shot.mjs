// Mobile screenshot for the two-finger pinch-to-zoom touch camera gesture.
// Drives the offline world in a phone-emulated viewport (no server/Postgres),
// then dispatches REAL two-finger touch events on the game canvas via CDP to
// pinch the camera in and out, capturing each state. Logs input.camDist so the
// gesture is proven end-to-end (not faked by setting the field directly).
//
// Usage: node scripts/mobile_pinch_zoom_shot.mjs   (requires `npm run dev` on :5173)
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = 'http://localhost:5173/';
const OUT = 'tmp/shots';
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
  const client = await page.target().createCDPSession();
  // Satisfy PHONE_TOUCH_QUERY (coarse pointer) so body.mobile-touch turns on.
  await client.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'pointer', value: 'coarse' }],
  });

  await page.goto(URL, { waitUntil: 'networkidle2' });

  // Offline flow: Play Offline → name → pick class → Start.
  await enterOfflineGame(page, { charClass: 'warrior', charName: 'Thorgar', settleMs: 2500 });
  await page.waitForSelector('#mobile-controls', { timeout: 15000 });

  const camDist = () => page.evaluate(() => window.__game?.input?.camDist);

  // A two-finger pinch is a series of touchStart → touchMove(s) → touchEnd with
  // two touch points. Spreading them apart zooms IN; bringing them together
  // zooms OUT. Centre the gesture on the game view.
  const cx = 422,
    cy = 195;
  const pinch = async (fromGap, toGap, steps = 12) => {
    const pts = (gap) => [
      { x: cx - gap / 2, y: cy },
      { x: cx + gap / 2, y: cy },
    ];
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: pts(fromGap),
    });
    for (let i = 1; i <= steps; i++) {
      const gap = fromGap + (toGap - fromGap) * (i / steps);
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(gap) });
      await sleep(16);
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };

  console.log('camDist (default):', await camDist());

  // Zoom OUT: pinch the fingers together (gap shrinks) → camDist grows toward 22.
  await pinch(280, 60);
  await sleep(400);
  console.log('camDist (zoomed out):', await camDist());
  await page.screenshot({ path: `${OUT}/mobile-pinch-zoomed-out.png` });
  console.log('saved mobile-pinch-zoomed-out.png');

  // Zoom IN: spread the fingers apart (gap grows) → camDist shrinks toward 3.
  await pinch(60, 320);
  await pinch(60, 320);
  await sleep(400);
  console.log('camDist (zoomed in):', await camDist());
  await page.screenshot({ path: `${OUT}/mobile-pinch-zoomed-in.png` });
  console.log('saved mobile-pinch-zoomed-in.png');
} finally {
  await browser.close();
}
