// Screenshot harness for the painted bag icons.
// Boots the offline world, gives the player every bag, equips four of them into the bag
// sockets, and captures the bag bar (backpack + the 4 sockets) plus the item grid, on desktop
// and in mobile LANDSCAPE (the client gates portrait behind a rotate prompt). Compare against
// the same shots on the base branch to see the procedural sacks give way to the painted art.
// Needs a dev server (default :5173, override GAME_URL). Renders at ?gfx=ultra.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = `${process.env.GAME_URL ?? 'http://localhost:5173'}/?gfx=ultra`;
const OUT = process.env.SHOT_DIR ?? 'tmp';
const TAG = process.env.SHOT_TAG ?? 'after';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The 4 equip sockets take the 4 bags the player can actually loot/buy; the 5th (epic)
// stays loose in the inventory so its icon also shows in the item grid.
const BAGS = [
  'linen_pouch',
  'travelers_knapsack',
  'wolfhide_satchel',
  'gravewoven_bag',
  'mistcallers_duffel',
];

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

// One fresh page per viewport: puppeteer RELOADS the page when isMobile flips, which would
// drop the world we just set up, so the mobile pass boots its own world instead.
async function shoot(label, viewport) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  if (viewport.isMobile) {
    // Satisfy the HUD's phone-touch media query (pointer: coarse / no hover), so the mobile
    // bag layout is what we shoot, not the desktop one at a narrow width.
    const cdp = await page.target().createCDPSession();
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [
        { name: 'pointer', value: 'coarse' },
        { name: 'hover', value: 'none' },
      ],
    });
  }

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // The shared entry flow: it fires the hidden #btn-offline hook, fills name/class, and
  // dismisses the mobile "tap to continue" preflight that otherwise gates the touch boot.
  await enterOfflineGame(page, { charClass: 'warrior', charName: 'Baggins', settleMs: 3000 });
  await page.waitForFunction(() => window.__game?.hud, { timeout: 60000 });

  await page.evaluate((bags) => {
    const sim = window.__game.sim;
    for (const id of bags) sim.addItem(id, 1);
    // socket 0..3: common, common, uncommon, rare; the epic duffel stays in the grid
    bags.slice(0, 4).forEach((id, i) => {
      sim.equipBag(id, i);
    });
  }, BAGS);

  await page.evaluate(() => {
    const bags = document.querySelector('#bags');
    if (!bags) throw new Error('#bags window not in the DOM: the HUD did not boot');
    bags.style.display = 'none';
    window.__game.hud.toggleBags();
  });
  await sleep(700);

  await page.screenshot({ path: `${OUT}/bag-icons-${TAG}-${label}.png` });
  const barEl = await page.$('#bags .bag-bar');
  if (barEl) await barEl.screenshot({ path: `${OUT}/bag-icons-${TAG}-${label}-bar.png` });

  // What the bag bar and the item grid actually resolved to: an /ui/items/*.webp url is the
  // painted art, a data: url is the procedural fallback.
  const report = await page.evaluate(() => {
    const src = (img) => (img.src.startsWith('data:') ? 'procedural-data-url' : img.src);
    return {
      bagBar: [...document.querySelectorAll('#bags .bag-socket .item-icon')].map(src),
      grid: [...document.querySelectorAll('#bags .bag-item .item-icon')].map(src),
    };
  });
  console.log(`REPORT ${label}`, JSON.stringify(report, null, 2));
  fs.writeFileSync(`${OUT}/bag-icons-${TAG}-${label}-report.json`, JSON.stringify(report, null, 2));
  await page.close();
}

await shoot('desktop', { width: 1600, height: 900, deviceScaleFactor: 2 });
// Mobile LANDSCAPE (iPhone-class viewport, 3x DPR: the icons are upscaled hardest here).
// The client blocks portrait with a "Rotate to Landscape" gate, so landscape is the only
// mobile layout there is to shoot.
await shoot('mobile', {
  width: 844,
  height: 390,
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});

await browser.close();
