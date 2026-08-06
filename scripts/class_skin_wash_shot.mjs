// Before/after capture for issue #2678 (default class skins rendering with a
// full-body color wash on character create). The offline OFFLINE CHARACTER
// screen runs before window.__game exists (no world, no sim), so it cannot be
// driven through pr_shot_targets.mjs's window.__game recipes; this is the
// sanctioned bespoke-script exception the pr-screenshots skill calls out for
// a screen the target framework genuinely cannot reach.
//
// Captures the class carousel at its default skin (index 0) for the three
// classes whose VisualDef carried the wash (player_priest, player_shaman,
// player_warlock), desktop and mobile (landscape, matching the client's
// mobile-only-landscape-in-game convention).
//
//   node scripts/class_skin_wash_shot.mjs           (needs `npm run dev` on :5173)
//   OUT_DIR=... GAME_URL=... to override defaults
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.OUT_DIR ?? 'docs/screenshots/class-skin-color-wash';
const PREFIX = process.env.SHOT_PREFIX ?? 'after';
fs.mkdirSync(OUT, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const CLASSES = ['shaman', 'priest', 'warlock', 'warrior'];

async function driveToCreateScreen(page, { mobile = false } = {}) {
  await page.goto(`${URL}/?gfx=ultra`, { waitUntil: 'networkidle0', timeout: 120000 });
  if (mobile) await page.evaluate(() => document.body.classList.add('mobile-touch'));
  await page.waitForSelector('#btn-offline', { timeout: 30000 });
  await page.evaluate(() => document.querySelector('#btn-offline')?.click());
  await page.waitForSelector('#offline-select .mini-class[data-class="warrior"]', {
    visible: true,
    timeout: 20000,
  });
  // The turntable keeps rendering every frame; give the first (default warrior)
  // model a moment to finish streaming in before any capture.
  await wait(800);
}

async function captureClasses(page, suffix) {
  for (const cls of CLASSES) {
    await page.evaluate((c) => {
      document.querySelector(`#offline-select .mini-class[data-class="${c}"]`)?.click();
    }, cls);
    await wait(900);
    await page.screenshot({ path: `${OUT}/${PREFIX}-${cls}-${suffix}.png` });
    console.log(`captured ${PREFIX}-${cls}-${suffix}.png`);
  }
}

// Desktop pass.
{
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 1600, height: 900 },
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await driveToCreateScreen(page);
  await captureClasses(page, 'desktop');
  await browser.close();
}

// Mobile pass (landscape, matching the client's mobile-only-landscape convention).
{
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: ['--window-size=844,390', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 844, height: 390, isMobile: true, hasTouch: true },
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await driveToCreateScreen(page, { mobile: true });
  await captureClasses(page, 'mobile');
  await browser.close();
}
