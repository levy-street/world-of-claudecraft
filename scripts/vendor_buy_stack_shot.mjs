// Before/after captures for the vendor bulk-purchase feature (#2374): buying a
// stack of items from a shopkeeper in one purchase (ctrl/cmd-click or the
// always-visible "Buy Stack" tile).
//   MODE=desktop node scripts/vendor_buy_stack_shot.mjs
//   MODE=mobile node scripts/vendor_buy_stack_shot.mjs
// GAME_URL points at whichever `npm run dev` server should be captured (the
// unmodified pre-fix build for a BEFORE shot, this branch's build for AFTER).
// Needs `npm run dev` running at GAME_URL.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const MODE = process.env.MODE ?? 'desktop';
const OUT = process.env.OUT ?? `tmp/vendor_buy_stack_${MODE}.png`;
fs.mkdirSync('tmp', { recursive: true });

const desktopArgs = { width: 1280, height: 800 };
const mobileArgs = { width: 844, height: 390 }; // landscape phone (game is landscape-only on touch)

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    `--window-size=${MODE === 'mobile' ? mobileArgs.width : desktopArgs.width},${MODE === 'mobile' ? mobileArgs.height : desktopArgs.height}`,
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-gpu-sandbox',
    '--disable-namespace-sandbox',
    '--disable-seccomp-filter-sandbox',
    '--disable-crash-reporter',
    '--disable-crashpad-for-testing',
    '--no-zygote',
    '--single-process',
    '--disable-gpu-compositing',
    '--in-process-gpu',
  ],
  defaultViewport: MODE === 'mobile' ? mobileArgs : desktopArgs,
});
const page = await browser.newPage();
if (MODE === 'mobile') {
  await page.setViewport({ ...mobileArgs, isMobile: true, hasTouch: true });
}
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
await enterOfflineGame(page, { charName: 'Stackbuyer' });

if (MODE === 'mobile') {
  await page.evaluate(() => document.body.classList.add('mobile-touch'));
}

// Stand at Trader Wilkes (sells minor_healing_potion, a genuinely stackable
// good: kind 'potion', no explicit stackSize, so its real bag stack size is
// 20, distinct from food/drink's fixed 5), fund the player well past a full
// stack's cost, and open the vendor.
await page.evaluate(() => {
  const g = window.__game;
  const wilkes = [...g.sim.entities.values()].find((e) => e.templateId === 'trader_wilkes');
  if (!wilkes) throw new Error('trader_wilkes not spawned');
  g.sim.player.pos.x = wilkes.pos.x + 2;
  g.sim.player.pos.z = wilkes.pos.z;
  g.sim.player.prevPos = { ...g.sim.player.pos };
  g.sim.copper = 5_000;
  g.sim.tick();
  g.hud.openVendor(wilkes.id);
});
await new Promise((r) => setTimeout(r, 700));

// Hover the potion row so its tooltip is visible in the capture (desktop
// only; touch has no hover). Falls back silently if the row is not found so
// the BEFORE capture (pre-fix build, no data-item hooks) still succeeds.
if (MODE === 'desktop') {
  const rows = await page.$$('.vendor-item');
  for (const row of rows) {
    const text = await row.evaluate((el) => el.textContent ?? '');
    if (text.includes('Healing Potion')) {
      const box = await row.boundingBox();
      if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      break;
    }
  }
  await new Promise((r) => setTimeout(r, 400));
}

await page.screenshot({ path: OUT });
console.log('shot:', OUT);

await browser.close();
