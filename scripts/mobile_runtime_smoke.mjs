// Strict mobile runtime smoke: preflight, loading-screen sizing, More tray,
// autorun, and pinch zoom. No screenshots are written; this is for CI/local QA.
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL || process.env.URL || 'http://localhost:5173/';
const BOOT_TIMEOUT_MS = Number(process.env.MOBILE_SMOKE_BOOT_TIMEOUT_MS || 60000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function nonProjectStatsError(text) {
  return !/project stats|project-stats|502|Bad Gateway/i.test(text);
}

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.setUserAgent('Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36');
  const client = await page.target().createCDPSession();
  await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }] });

  const errors = [];
  page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`CONSOLE: ${msg.text()}`);
  });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#btn-offline', { timeout: 30000 });
  await page.evaluate(() => document.querySelector('#btn-offline')?.click());
  await page.waitForSelector('#char-name', { visible: true, timeout: 30000 });
  await page.evaluate(() => {
    const n = document.querySelector('#char-name');
    if (n) {
      n.value = 'MobileSmoke';
      n.dispatchEvent(new Event('input', { bubbles: true }));
    }
    document.querySelector('#offline-select .mini-class[data-class="warrior"]')?.click();
  });
  await page.evaluate(() => document.querySelector('#btn-start-offline')?.click());
  await page.waitForFunction(() => {
    const prompt = document.querySelector('#mobile-preflight');
    return Boolean(prompt && getComputedStyle(prompt).display !== 'none');
  }, { timeout: 15000 });
  const preflightVisible = await page.evaluate(() => getComputedStyle(document.querySelector('#mobile-preflight')).display !== 'none');
  await page.evaluate(() => document.querySelector('#mobile-preflight-continue')?.click());
  await page.waitForFunction(() => {
    const loading = document.querySelector('#loading-screen');
    return Boolean(loading && loading.classList.contains('visible'));
  }, { timeout: 15000 });
  const loading = await page.evaluate(() => {
    const el = document.querySelector('#loading-screen');
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      left: Math.round(r.left),
      top: Math.round(r.top),
      width: Math.round(r.width),
      height: Math.round(r.height),
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      backgroundSize: cs.backgroundSize,
    };
  });

  await page.waitForFunction(
    () => Boolean(window.__game?.input?.camDist && document.body.classList.contains('mobile-touch')),
    { timeout: BOOT_TIMEOUT_MS },
  );
  await sleep(1200);

  await page.evaluate(() => document.querySelector('#mobile-more')?.click());
  await sleep(250);
  const tray = await page.evaluate(() => {
    const tray = document.querySelector('#mobile-extra-controls');
    const buttons = [...tray.querySelectorAll('.mobile-btn')];
    const clipped = buttons
      .map((b) => {
        const r = b.getBoundingClientRect();
        return { id: b.id, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      })
      .filter((r) => r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1);
    const style = getComputedStyle(tray);
    return { visible: style.display !== 'none', overflowY: style.overflowY, maxHeight: style.maxHeight, clipped };
  });
  await page.evaluate(() => document.querySelector('#mobile-more')?.click());

  const autorun = await page.evaluate(async () => {
    const before = window.__game.input.autorun;
    document.querySelector('#mobile-autorun')?.click();
    await new Promise((r) => setTimeout(r, 100));
    const afterClick = {
      autorun: window.__game.input.autorun,
      active: document.querySelector('#mobile-autorun')?.classList.contains('active') ?? false,
      move: window.__game.input.readMoveInput(),
    };
    const zone = document.querySelector('#mobile-move-zone');
    const r = zone.getBoundingClientRect();
    zone.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch',
      clientX: r.left + r.width / 2, clientY: r.bottom - 20, buttons: 1,
    }));
    zone.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch',
      clientX: r.left + r.width / 2, clientY: r.top + 20, buttons: 1,
    }));
    await new Promise((r) => setTimeout(r, 100));
    const afterMove = {
      autorun: window.__game.input.autorun,
      active: document.querySelector('#mobile-autorun')?.classList.contains('active') ?? false,
      move: window.__game.input.readMoveInput(),
    };
    zone.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch',
      clientX: r.left + r.width / 2, clientY: r.top + 20, buttons: 0,
    }));
    return { before, afterClick, afterMove };
  });

  const pinch = await page.evaluate(async () => {
    const canvas = document.querySelector('#game-canvas');
    const cx = innerWidth / 2;
    const cy = innerHeight / 2;
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
    const run = async (fromGap, toGap) => {
      fire('pointerdown', 1, fromGap);
      fire('pointerdown', 2, fromGap);
      for (let i = 1; i <= 12; i++) {
        const gap = fromGap + (toGap - fromGap) * (i / 12);
        fire('pointermove', 1, gap);
        fire('pointermove', 2, gap);
        await new Promise((r) => setTimeout(r, 16));
      }
      fire('pointerup', 1, toGap);
      fire('pointerup', 2, toGap);
    };
    const before = window.__game.input.camDist;
    await run(280, 60);
    await new Promise((r) => setTimeout(r, 100));
    const afterPinchTogether = window.__game.input.camDist;
    await run(60, 320);
    await run(60, 320);
    await new Promise((r) => setTimeout(r, 100));
    const afterSpread = window.__game.input.camDist;
    return { before, afterPinchTogether, afterSpread };
  });

  const failed = [];
  if (!preflightVisible) failed.push('mobile preflight was not visible');
  if (loading.left !== 0 || loading.top !== 0 || loading.width !== loading.viewportWidth || loading.height !== loading.viewportHeight) {
    failed.push(`loading screen not viewport-sized: ${JSON.stringify(loading)}`);
  }
  if (loading.backgroundSize !== '100% 100%') failed.push(`loading background-size changed: ${loading.backgroundSize}`);
  if (!tray.visible || tray.overflowY !== 'auto' || tray.clipped.length > 0) failed.push(`More tray clipping/scroll failed: ${JSON.stringify(tray)}`);
  if (!(autorun.before === false && autorun.afterClick.autorun === true && autorun.afterClick.active === true && autorun.afterClick.move.forward === true && autorun.afterMove.autorun === false && autorun.afterMove.active === false)) {
    failed.push(`autorun failed: ${JSON.stringify(autorun)}`);
  }
  if (!(pinch.afterPinchTogether > pinch.before && pinch.afterSpread < pinch.afterPinchTogether)) {
    failed.push(`pinch zoom failed: ${JSON.stringify(pinch)}`);
  }
  const relevantErrors = errors.filter(nonProjectStatsError);
  if (relevantErrors.length) failed.push(`browser errors: ${relevantErrors.join(' | ')}`);

  const report = { preflightVisible, loading, tray, autorun, pinch, errors };
  console.log(JSON.stringify(report, null, 2));
  if (failed.length) {
    console.error(`MOBILE RUNTIME SMOKE FAILED:\n${failed.join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log('MOBILE RUNTIME SMOKE OK');
  }
} finally {
  await browser.close();
}
