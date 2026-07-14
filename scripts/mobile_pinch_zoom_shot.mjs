// Mobile screenshot/check for guarded two-finger camera zoom.
// Drives the offline world in a phone-emulated viewport (no server/Postgres),
// then dispatches REAL two-finger touch events on the game canvas via CDP to
// prove small jitter is ignored while intentional pinch/spread changes camDist.
//
// Usage: node scripts/mobile_pinch_zoom_shot.mjs   (requires `npm run dev` on :5173)
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = 'http://localhost:5173/';
const OUT = 'tmp/shots';
const CHAR_NAME = 'PinchCheck';
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
  await page.evaluate((name) => {
    localStorage.setItem(`woc_spawn_intro_seen:offline:warrior:${name}`, '1');
  }, CHAR_NAME);

  // Offline flow: Play Offline -> name -> pick class -> Start.
  await enterOfflineGame(page, { charClass: 'warrior', charName: CHAR_NAME, settleMs: 2500 });
  await page.waitForSelector('#mobile-controls', { timeout: 15000 });
  await page.waitForFunction(() => Number.isFinite(window.__game?.input?.camDist), {
    timeout: 15000,
  });

  const camDist = () => page.evaluate(() => window.__game?.input?.camDist);

  // A two-finger pinch is a series of touchStart to touchMove(s) to touchEnd with
  // two touch points. Small gap changes should be ignored as hand jitter; larger
  // gap changes should adjust camera distance.
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

  const start = await page.evaluate(() => {
    const input = window.__game.input;
    input.camDist = 12;
    return input.camDist;
  });
  console.log('camDist (start):', start);
  await page.screenshot({ path: `${OUT}/mobile-pinch-guarded-start.png` });

  // Small hand jitter under the gesture threshold should not move the camera.
  await pinch(180, 181, 4);
  await sleep(250);
  const afterJitter = await camDist();
  console.log('camDist (after jitter):', afterJitter);
  await page.screenshot({ path: `${OUT}/mobile-pinch-guarded-after-jitter.png` });
  console.log('saved mobile-pinch-guarded-after-jitter.png');

  // Pinch fingers together, zooming out.
  await pinch(280, 60);
  await sleep(400);
  const afterPinchIn = await camDist();
  console.log('camDist (after pinch in):', afterPinchIn);
  await page.screenshot({ path: `${OUT}/mobile-pinch-guarded-after-pinch-in.png` });
  console.log('saved mobile-pinch-guarded-after-pinch-in.png');

  // Spread fingers apart, zooming in.
  await pinch(60, 320);
  await sleep(400);
  const afterSpread = await camDist();
  console.log('camDist (after spread):', afterSpread);
  await page.screenshot({ path: `${OUT}/mobile-pinch-guarded-after-spread.png` });
  console.log('saved mobile-pinch-guarded-after-spread.png');

  if (Math.abs(afterJitter - start) > 0.1) {
    throw new Error(
      `small pinch jitter changed camera distance by ${Math.abs(afterJitter - start).toFixed(3)} yards`,
    );
  }
  if (afterPinchIn <= start + 0.1) {
    throw new Error(`pinch-in did not zoom out enough (${start} -> ${afterPinchIn})`);
  }
  if (afterSpread >= afterPinchIn - 0.1) {
    throw new Error(`spread did not zoom in enough (${afterPinchIn} -> ${afterSpread})`);
  }
} finally {
  await browser.close();
}
