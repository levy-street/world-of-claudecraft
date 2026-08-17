// Character-creator Share tab shots: drives the landing page's Play console
// to the OFFLINE creator (dropdown -> Offline -> Play), opens the appearance
// customizer's Share tab when the build has one (an older build without it
// captures the four-tab panel, which is the "before" of the pair), and shoots
// the creator panel at a desktop and a landscape-phone viewport.
// Needs the dev server only (GAME_URL, default :5173); offline mode needs a
// DEV build, which the vite dev server is. SHOT_PREFIX names the outputs
// (tmp/<prefix>-creator-share-desktop.png / ...-mobile.png; default "after").
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { suppressGpuNotice } from './lib/gpu_notice_suppress.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const PREFIX = process.env.SHOT_PREFIX ?? 'after';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 60000,
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});

/** Drive one viewport to the offline creator and clip the creator stage. */
async function shoot(viewport, outfile) {
  const page = await browser.newPage();
  await suppressGpuNotice(page);
  await page.setViewport(viewport);
  page.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 200)));
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(900);

  // The headless swiftshader run trips the unsupported-browser interstitial;
  // dismiss it so it does not overlap the creator panel in the capture.
  await page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      if (b.textContent?.trim() === 'Continue in browser') b.click();
    }
  });
  await sleep(300);

  // Play console: pick Offline in the destination dropdown, then commit.
  await page.evaluate(() => {
    document.querySelector('#server-select-trigger')?.click();
  });
  await sleep(200);
  await page.evaluate(() => {
    document.querySelector('#server-opt-offline')?.click();
  });
  await sleep(200);
  await page.evaluate(() => {
    document.querySelector('#btn-play')?.click();
  });

  const deadline = Date.now() + 15000;
  for (;;) {
    const up = await page.evaluate(() => {
      const el = document.querySelector('#offline-select');
      return !!el && !el.hidden && getComputedStyle(el).display !== 'none';
    });
    if (up) break;
    if (Date.now() > deadline) throw new Error('offline creator never appeared');
    await sleep(300);
  }

  // Open the Share tab where the build has one; scroll the customizer into
  // view either way so the pair frames the same region.
  const hasShare = await page.evaluate(() => {
    const host = document.querySelector('#offline-appearance');
    if (!host) return false;
    host.scrollIntoView({ block: 'center', inline: 'center' });
    const share = [...host.querySelectorAll('.ac-tab')].find((b) => b.textContent === 'Share');
    if (!share) return false;
    share.click();
    return true;
  });
  // Let the turntable's first frames land so the stage is not an empty box.
  await sleep(2000);
  console.log(`${outfile}: share tab ${hasShare ? 'open' : 'absent (before-build)'}`);

  // Desktop: clip the whole offline creator stage. Phone: the stage is taller
  // than the viewport, so shoot the full viewport with the customizer
  // scrolled into view (that is also what verifies the 5-column tab rail at
  // phone width).
  if (viewport.isMobile) {
    await page.screenshot({ path: outfile });
  } else {
    const clip = await page.evaluate(() => {
      const r = document.querySelector('#offline-select')?.getBoundingClientRect();
      return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
    });
    const vp = { x: 0, y: 0, width: viewport.width, height: viewport.height };
    const region = clip
      ? {
          x: Math.max(vp.x, clip.x),
          y: Math.max(vp.y, clip.y),
          width: Math.min(vp.width - Math.max(0, clip.x), clip.width),
          height: Math.min(vp.height - Math.max(0, clip.y), clip.height),
        }
      : vp;
    await page.screenshot({ path: outfile, clip: region });
  }
  console.log('wrote', outfile);
  await page.close();
}

await shoot({ width: 1600, height: 900 }, `tmp/${PREFIX}-creator-share-desktop.png`);
await shoot(
  { width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  `tmp/${PREFIX}-creator-share-mobile.png`,
);

await browser.close();
