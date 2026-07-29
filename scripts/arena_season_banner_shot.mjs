// Arena season banner evidence shots for the six-month-seasons feature.
//
// Captures the new banner at the top of the Ashen Coliseum window on the two
// committed PR evidence tiers (desktop 1600x900, phone landscape 844x390),
// from the OFFLINE world: the offline Sim serves a real ArenaInfo, so the live
// panel (and therefore the banner) renders with no server and no Postgres. The
// settled-champions tail needs a realm that has closed a season and is
// deliberately absent here; every one of its states is pinned instead by
// tests/arena_season_view.test.ts.
//
// The season clock is the CLIENT's clock, so the page clock is pinned just
// inside Season 1 rather than left on the machine's real date: that is the
// state the feature ships into, and it makes the capture reproducible instead
// of quietly showing a different season every month.
//
// Needs `npm run dev` (GAME_URL to point elsewhere, default :5173).
//   node scripts/arena_season_banner_shot.mjs

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = `${process.env.GAME_URL ?? 'http://localhost:5173'}/?gfx=ultra`;
const OUT = process.env.OUT_DIR ?? 'docs/screenshots/arena-seasons';
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The phone tier follows the repo's own mobile recipe (mobile_leaderboard_shot.mjs):
// setViewport with isMobile/hasTouch PLUS a coarse-pointer emulated media feature,
// which is what satisfies the client's PHONE_TOUCH_QUERY. A bare
// Emulation.setDeviceMetricsOverride does not, and the world then never boots.
async function applyViewport(page, { width, height, dsf, touch }) {
  await page.setViewport({
    width,
    height,
    deviceScaleFactor: dsf,
    isMobile: touch,
    hasTouch: touch,
  });
  if (touch) {
    const cdp = await page.target().createCDPSession();
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'pointer', value: 'coarse' }],
    });
  }
  await sleep(400);
  return { x: 0, y: 0, width, height };
}

// Headless has no GPU, so the client's software-rendering notice
// (#gpu-notice) is up and overlaps the panel on the narrow tier. It is a real
// toast with a real dismiss button, so dismiss it the way a player would rather
// than hiding it with injected CSS.
async function dismissGpuNotice(page) {
  await page.evaluate(() => {
    document.querySelector('#gpu-notice .gpu-notice-dismiss')?.click();
  });
  await sleep(200);
}

async function openArena(page) {
  // Through the shipped surface, not a private hook: the window's own toggle.
  await page.evaluate(() => window.__game?.hud?.toggleArena?.());
  await sleep(600);
  return page.evaluate(() => {
    const el = document.querySelector('#arena-window');
    const banner = el?.querySelector('.arena-season');
    const box = banner?.getBoundingClientRect();
    return {
      open: el?.style.display === 'block',
      hasBanner: !!banner,
      // The world is still loaded: a page that fell back to the pre-game shell
      // keeps the window markup but loses the game hook, and the DOM-only check
      // reported OK on exactly that frame once.
      inWorld: !!window.__game?.sim,
      preGameVisible: !!document.querySelector('#btn-offline')?.offsetParent,
      // On screen inside the capture clip, not scrolled or laid out off it.
      onScreen: !!box && box.width > 100 && box.top >= 0 && box.bottom <= window.innerHeight,
      heading: el?.querySelector('.arena-season-name')?.textContent ?? '',
      clock: el?.querySelector('.arena-season-clock')?.textContent ?? '',
      title: el?.querySelector('.arena-season-title')?.textContent ?? '',
    };
  });
}

const results = [];
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  defaultViewport: null,
  args: ['--no-sandbox', '--window-size=1600,900'],
});
try {
  // One FRESH page per tier, viewport set before navigation. Flipping the
  // viewport mid-session and re-entering was flaky: a reload between tiers left
  // the pre-game shell on screen, and the close-the-window step then raced a
  // destroyed execution context. A fresh load per tier has no cross-tier state
  // to get wrong, and two page loads cost less than one wrong screenshot.
  for (const tier of [
    { name: 'desktop', width: 1600, height: 900, dsf: 1, touch: false },
    { name: 'phone-landscape', width: 844, height: 390, dsf: 3, touch: true },
  ]) {
    const page = await browser.newPage();
    // Pin the clock just inside Season 1 so the shot shows the shipping state
    // rather than whatever season the machine's real date falls in. Installed
    // before any app code runs, so the banner's first render already sees it.
    await page.evaluateOnNewDocument(() => {
      const FIXED = Date.UTC(2026, 7, 20); // 19 days into Season 1
      const RealDate = Date;
      Date.now = () => FIXED;
      // Argument-less `new Date()` only; every parsed/explicit form stays real.
      globalThis.Date = new Proxy(RealDate, {
        construct: (target, args) => (args.length === 0 ? new target(FIXED) : new target(...args)),
      });
    });
    const clip = await applyViewport(page, tier);
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await enterOfflineGame(page, { charClass: 'warrior', charName: 'Kaevar', settleMs: 3000 });
    await dismissGpuNotice(page);
    const state = await openArena(page);
    results.push({ tier: tier.name, ...state });
    await page.mouse.move(0, 0);
    await sleep(250);
    await page.screenshot({ path: `${OUT}/arena-season-banner-${tier.name}.png`, clip });
    await page.close();
  }
} finally {
  await browser.close();
}

let bad = 0;
for (const r of results) {
  const ok =
    r.open &&
    r.hasBanner &&
    r.inWorld &&
    !r.preGameVisible &&
    r.onScreen &&
    r.heading.length > 0 &&
    r.clock.length > 0;
  if (!ok) bad++;
  console.log(
    `${ok ? 'OK  ' : 'FAIL'}  ${r.tier}: open=${r.open} banner=${r.hasBanner} ` +
      `inWorld=${r.inWorld} preGame=${r.preGameVisible} onScreen=${r.onScreen} ` +
      `heading=${JSON.stringify(r.heading)} clock=${JSON.stringify(r.clock)} ` +
      `title=${JSON.stringify(r.title)}`,
  );
}
console.log(`wrote ${results.length} shots to ${OUT}`);
process.exit(bad === 0 ? 0 : 1);
