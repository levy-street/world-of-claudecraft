// Before/after captures for the vendor Goods window follow-up (PR #2101):
// desktop 4-column grid + full-height mobile sheet.
//   MODE=desktop node scripts/vendor_grid_shot.mjs
//   MODE=mobile node scripts/vendor_grid_shot.mjs
// Needs `npm run dev` on :5173.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const MODE = process.env.MODE ?? 'desktop';
const OUT = process.env.OUT ?? `tmp/vendor_${MODE}.png`;
fs.mkdirSync('tmp', { recursive: true });

const desktopArgs = { width: 1400, height: 900 };
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
await enterOfflineGame(page, { charName: 'Vexbuyer' });

if (MODE === 'mobile') {
  await page.evaluate(() => document.body.classList.add('mobile-touch'));
}

// The Heroic Marks quartermaster shares #vendor-window with the copper trader
// but does NOT pair the bags companion (openHeroicVendor never adds
// body.vendor-open), so on mobile it is the plain centered #vendor-window sheet
// this change targets, rather than the already-full-height vendor-open split.
const HEROIC = process.env.HEROIC === '1';

await page.evaluate((heroic) => {
  const g = window.__game;
  if (heroic) {
    const npc = [...g.sim.entities.values()].find((e) => e.templateId === 'heroic_quartermaster');
    if (!npc) throw new Error('heroic_quartermaster not spawned');
    g.sim.player.pos = { x: npc.pos.x + 1.5, y: npc.pos.y, z: npc.pos.z + 1.5 };
    g.sim.player.prevPos = { ...g.sim.player.pos };
    g.sim.addItem('heroic_mark', 14, g.sim.player.id);
    g.sim.tick();
    g.hud.openHeroicVendor(npc.id);
    return;
  }
  const wilkes = [...g.sim.entities.values()].find((e) => e.templateId === 'trader_wilkes');
  if (!wilkes) throw new Error('trader_wilkes not spawned');
  g.sim.player.pos.x = wilkes.pos.x + 2;
  g.sim.player.pos.z = wilkes.pos.z;
  g.sim.player.prevPos = { ...g.sim.player.pos };
  g.sim.copper = 500;
  g.sim.tick();
  g.hud.openVendor(wilkes.id);
}, HEROIC);
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: OUT });
console.log('shot:', OUT);

await browser.close();
