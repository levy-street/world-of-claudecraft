// Screenshot harness for the "Invert Look (Touch)" camera setting (mobile PR).
// Needs `npm run dev` (or pass GAME_URL). Emulates a landscape phone and forces
// the (pointer:coarse) match so the touch-only Graphics toggle renders, then
// captures the Graphics options panel showing the new toggle.
//
//   node scripts/mobile_invert_look_shot.mjs
//
// Writes tmp/mobile-invert-look-graphics.png + tmp/mobile-invert-look-game.png.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const GAME_URL = process.env.GAME_URL || 'http://localhost:5173';
const OUT = path.resolve('tmp');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
  ],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
  // Headless Chromium reports pointer:fine even on a mobile viewport, so the
  // PHONE_TOUCH_QUERY (pointer:coarse) never matches and the touch-only setting
  // won't render. Override matchMedia for coarse-pointer queries before any
  // app code runs — this activates the whole mobile path natively.
  await page.evaluateOnNewDocument(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (q) =>
      /coarse/.test(q)
        ? {
            matches: true,
            media: q,
            addEventListener() {},
            removeEventListener() {},
            addListener() {},
            removeListener() {},
            onchange: null,
            dispatchEvent: () => false,
          }
        : real(q);
  });

  await page.goto(GAME_URL, { waitUntil: 'domcontentloaded' });
  await sleep(1200);

  // Offline entry: Play Offline -> type a name -> pick a class -> Enter World.
  await enterOfflineGame(page, { charClass: 'warrior', charName: 'Aethel', settleMs: 2500 });
  await page.evaluate(() => document.getElementById('mobile-preflight-continue')?.click());
  await sleep(1500);

  await page.screenshot({ path: path.join(OUT, 'mobile-invert-look-game.png') });

  // Open options → Graphics via the HUD API, then click the Graphics button.
  await page.evaluate(() => window.__game?.hud?.toggleOptionsMenu?.());
  await sleep(500);
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('#options-menu .btn, #options-menu button')];
    btns.find((b) => /graphics/i.test(b.textContent || ''))?.click();
  });
  await sleep(600);

  const hasToggle = await page.evaluate(() =>
    [...document.querySelectorAll('#options-menu .set-row .set-name')].some((n) =>
      /invert look/i.test(n.textContent || ''),
    ),
  );
  console.log('Invert Look toggle present:', hasToggle);

  await page.screenshot({ path: path.join(OUT, 'mobile-invert-look-graphics.png') });

  // Toggle it On and capture the active state.
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('#options-menu .set-row')].find((r) =>
      /invert look/i.test(r.querySelector('.set-name')?.textContent || ''),
    );
    row?.querySelector('.set-toggle')?.click();
  });
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, 'mobile-invert-look-graphics-on.png') });
  console.log('Wrote screenshots to', OUT);
} finally {
  await browser.close();
}
