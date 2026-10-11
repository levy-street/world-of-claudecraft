// Run against a local Vite dev or preview server; no account or game backend required.
// GAME_URL selects / or /play. SHOT_DIR optionally retains desktop/mobile screenshots.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const screenshots = process.env.SHOT_DIR || 'tmp/website-navigation-check';
mkdirSync(screenshots, { recursive: true });
try {
  for (const [label, width, height] of [
    ['desktop', 1440, 1000],
    ['mobile', 390, 844],
    ['narrow', 320, 740],
    ['landscape', 844, 390],
  ]) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewport({ width, height, isMobile: width < 900, hasTouch: width < 900 });
    await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5186/', {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });
    async function clickNav(id) {
      const toggle = await page.$('#mobile-menu-toggle');
      const collapsed = await toggle.evaluate(
        (e) => getComputedStyle(e).display !== 'none' && e.getAttribute('aria-expanded') !== 'true',
      );
      if (collapsed) {
        await new Promise((r) => setTimeout(r, 300));
        await toggle.click();
      }
      await page.waitForSelector('#' + id, { visible: true, timeout: 5000 });
      await page.click('#' + id);
    }
    async function visible(id) {
      await page.waitForFunction(
        (id) => {
          const e = document.getElementById(id);
          if (!e) return false;
          for (let p = e; p; p = p.parentElement) {
            const s = getComputedStyle(p);
            if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 0.95)
              return false;
          }
          return e.getBoundingClientRect().height > 0;
        },
        { timeout: 5000 },
        id,
      );
    }
    await visible('mode-select');
    if (['desktop', 'mobile'].includes(label))
      await page.screenshot({ path: `${screenshots}/after-${label}.png`, fullPage: true });
    for (const [nav, view] of [
      ['highscores', 'highscores-view'],
      ['news', 'news-view'],
      ['download', 'download-view'],
    ]) {
      await clickNav('nav-btn-' + nav);
      await visible(view);
      await clickNav('nav-btn-play');
      await visible('mode-select');
    }
    await page.click('#btn-play');
    await visible('login-panel');
    await clickNav('nav-btn-play');
    await visible('mode-select');
    await clickNav('nav-btn-login');
    await visible('login-panel');
    if (await page.$('#btn-forgot-open')) {
      await page.click('#btn-forgot-open');
      await visible('forgot-panel');
    }
    await clickNav('nav-btn-play');
    await visible('mode-select');
    await page.evaluate(() => {
      document.getElementById('nav-btn-news').click();
      document.getElementById('nav-btn-play').click();
    });
    await visible('mode-select');
    await page.evaluate(() => {
      document.getElementById('nav-btn-login').click();
      document.getElementById('nav-btn-play').click();
    });
    await new Promise((r) => setTimeout(r, 500));
    await visible('mode-select');
    await clickNav('nav-btn-news');
    await visible('news-view');
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await clickNav('nav-btn-play');
    await visible('mode-select');
    if (label === 'desktop') {
      await clickNav('nav-btn-news');
      await visible('news-view');
      await page.focus('#nav-btn-play');
      await page.keyboard.press('Enter');
      await visible('mode-select');
    }
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      `${label} overflow`,
    );
    assert.deepEqual(errors, [], `${label} page errors`);
    console.log(
      'PASS',
      label,
      'nav round trips, available login/recovery controls, rapid return, reduced motion, no horizontal overflow',
    );
    await page.close();
  }
} finally {
  await browser.close();
}
