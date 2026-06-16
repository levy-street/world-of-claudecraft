// Mobile screenshot for the two-finger pinch-to-zoom touch camera gesture.
// Drives the offline world in a phone-emulated viewport (no server/Postgres),
// then dispatches real pointer events on the game canvas to pinch the camera in
// and out, capturing each state. Logs input.camDist so the
// gesture is proven end-to-end (not faked by setting the field directly).
//
// Usage: node scripts/mobile_pinch_zoom_shot.mjs   (requires `npm run dev` on :5173)
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL || process.env.URL || 'http://localhost:5173/';
const OUT = process.env.OUT || 'tmp/shots';
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
  const client = await page.target().createCDPSession();
  // Satisfy PHONE_TOUCH_QUERY (coarse pointer) so body.mobile-touch turns on.
  await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }] });

  await page.goto(URL, { waitUntil: 'networkidle2' });

  // Offline flow: Play Offline → name → pick class → Start.
  await page.waitForSelector('#btn-offline', { timeout: 15000 });
  await page.evaluate(() => document.querySelector('#btn-offline').click());
  await page.waitForSelector('#char-name', { visible: true });
  await page.evaluate(() => {
    const n = document.querySelector('#char-name');
    n.value = 'Thorgar';
    n.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.mini-class[data-class="warrior"]')?.click();
  });
  await page.evaluate(() => document.querySelector('#btn-start-offline').click());
  await page.waitForSelector('#mobile-preflight-continue', { timeout: 15000 }).catch(() => undefined);
  await page.evaluate(() => document.querySelector('#mobile-preflight-continue')?.click());
  await page.waitForFunction(
    () => Boolean(window.__game?.input?.camDist && document.body.classList.contains('mobile-touch')),
    { timeout: 45000 },
  );
  await sleep(1200);

  const camDist = () => page.evaluate(() => window.__game?.input?.camDist);

  // A two-finger pinch is a series of pointerdown -> pointermove -> pointerup
  // events with pointerType=touch. Spreading apart zooms IN; bringing together
  // zooms OUT. Centre the gesture on the game view.
  const cx = 422, cy = 195;
  const pinch = async (fromGap, toGap, steps = 12) => {
    await page.evaluate(async ({ cx, cy, fromGap, toGap, steps }) => {
      const canvas = document.querySelector('#game-canvas');
      if (!canvas) throw new Error('missing game canvas');
      const fire = (type, id, gap) => {
        const side = id === 1 ? -1 : 1;
        canvas.dispatchEvent(new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: id,
          pointerType: 'touch',
          clientX: cx + side * gap / 2,
          clientY: cy,
          buttons: type === 'pointerup' ? 0 : 1,
        }));
      };
      fire('pointerdown', 1, fromGap);
      fire('pointerdown', 2, fromGap);
      for (let i = 1; i <= steps; i++) {
        const gap = fromGap + (toGap - fromGap) * (i / steps);
        fire('pointermove', 1, gap);
        fire('pointermove', 2, gap);
        await new Promise((r) => setTimeout(r, 16));
      }
      fire('pointerup', 1, toGap);
      fire('pointerup', 2, toGap);
    }, { cx, cy, fromGap, toGap, steps });
  };

  const defaultDist = await camDist();
  console.log('camDist (default):', defaultDist);

  // Zoom OUT: pinch the fingers together (gap shrinks) → camDist grows toward 22.
  await pinch(280, 60);
  await sleep(400);
  const zoomedOut = await camDist();
  console.log('camDist (zoomed out):', zoomedOut);
  await page.screenshot({ path: `${OUT}/mobile-pinch-zoomed-out.png` });
  console.log('saved mobile-pinch-zoomed-out.png');

  // Zoom IN: spread the fingers apart (gap grows) → camDist shrinks toward 3.
  await pinch(60, 320);
  await pinch(60, 320);
  await sleep(400);
  const zoomedIn = await camDist();
  console.log('camDist (zoomed in):', zoomedIn);
  await page.screenshot({ path: `${OUT}/mobile-pinch-zoomed-in.png` });
  console.log('saved mobile-pinch-zoomed-in.png');

  if (!(zoomedOut > defaultDist && zoomedIn < zoomedOut)) {
    throw new Error(`pinch zoom did not change camera distance correctly: ${defaultDist} -> ${zoomedOut} -> ${zoomedIn}`);
  }
} finally {
  await browser.close();
}
