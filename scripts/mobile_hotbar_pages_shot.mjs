// Screenshot tour for the mobile 5-slot paged hotbar (page 1 = slots 1-5,
// page 2 = slots 6-10). Needs `npm run dev` (:5173).
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=900,440', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.emulate({
  name: 'phone-landscape',
  userAgent:
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
  viewport: {
    width: 900,
    height: 420,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    isLandscape: true,
  },
});

const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text());
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await enterOfflineGame(page, { charClass: 'mage', charName: 'Touchscreen', settleMs: 2800 });

await page.evaluate(() => {
  document.getElementById('mobile-preflight-continue')?.click();
});
await new Promise((r) => setTimeout(r, 600));
// Skip the first-spawn intro cinematic, which hides #mobile-controls until
// dismissed (Escape skips immediately; touch needs several taps).
await page.evaluate(() =>
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
);
await new Promise((r) => setTimeout(r, 300));

// Level up to 20 via the real grantXp path so abilities are learned normally
// (not a cheat -- this is offline-only debug reachable via the exposed
// window.__game hook, same as the other mobile_*_shot.mjs scripts).
await page.evaluate(() => {
  const sim = window.__game.sim;
  const meta = sim.meta(sim.playerId);
  for (let i = 0; i < 25; i++) sim.grantXp(999999, meta);
});
await new Promise((r) => setTimeout(r, 400));

// Dismiss the "Find Your Footing" tutorial dialog so it doesn't cover the shots.
await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button'));
  btns.find((b) => b.textContent?.includes('Skip Tutorial'))?.click();
});
await new Promise((r) => setTimeout(r, 300));

const touchOn = await page.evaluate(() => document.body.classList.contains('mobile-touch'));
console.log('mobile-touch active:', touchOn ? 'OK' : 'FAIL');

const level = await page.evaluate(() => window.__game?.sim?.player?.level);
console.log('player level:', level);

await page.screenshot({ path: 'tmp/mobile_hotbar_page1.png' });

const rects = async () =>
  page.evaluate(() => {
    const els = [
      '#mobile-attack-nearest',
      '#mobile-autorun',
      '#mobile-chat',
      '#mobile-more',
      '#mobile-jump',
      '#mobile-target',
      '#mobile-interact',
      '#mobile-hotbar-page',
      ...Array.from(document.querySelectorAll('#actionbar .action-btn'))
        .filter((el) => getComputedStyle(el).display !== 'none')
        .map((el, i) => `#actionbar .action-btn:nth-visible-${i}`),
    ];
    const out = {};
    for (const sel of els) {
      let el;
      if (sel.startsWith('#actionbar .action-btn:nth-visible-')) continue;
      el = document.querySelector(sel);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      out[sel] = { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
    }
    const visibleSlots = Array.from(document.querySelectorAll('#actionbar .action-btn'))
      .filter((el) => getComputedStyle(el).display !== 'none')
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          id: el.id,
          x: r.x,
          y: r.y,
          w: r.width,
          h: r.height,
          right: r.right,
          bottom: r.bottom,
        };
      });
    return { fixed: out, visibleSlots };
  });

function overlaps(a, b) {
  return a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
}

function checkOverlaps(data, label) {
  const boxes = [...Object.values(data.fixed), ...data.visibleSlots];
  console.log(
    `${label}: visible hotbar slots =`,
    data.visibleSlots.map((s) => s.id),
  );
  let bad = 0;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (overlaps(boxes[i], boxes[j])) {
        bad++;
        console.log('OVERLAP:', boxes[i].id ?? i, boxes[j].id ?? j);
      }
    }
  }
  console.log(`${label}: overlap count = ${bad}`);
  return bad;
}

let bad = 0;
bad += checkOverlaps(await rects(), 'page1');

await page.evaluate(() => document.getElementById('mobile-hotbar-page')?.click());
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: 'tmp/mobile_hotbar_page2.png' });
bad += checkOverlaps(await rects(), 'page2');

await page.evaluate(() => document.getElementById('mobile-more')?.click());
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: 'tmp/mobile_hotbar_more_tray.png' });
await page.evaluate(() => document.getElementById('mobile-more')?.click());
await new Promise((r) => setTimeout(r, 300));

// Left-handed mirror: toggle via the More tray's Menu -> settings is a lot of
// clicks, so flip the class directly (same effect the settings toggle has).
await page.evaluate(() => document.body.classList.add('mobile-left-handed'));
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: 'tmp/mobile_hotbar_left_handed.png' });
bad += checkOverlaps(await rects(), 'left-handed page2');
await page.evaluate(() => document.body.classList.remove('mobile-left-handed'));

if (errors.length) {
  console.log('\n=== PAGE ERRORS ===');
  for (const e of errors.slice(0, 20)) console.log(e);
} else {
  console.log('no page errors');
}
await browser.close();
process.exit(touchOn && bad === 0 ? 0 : 1);
