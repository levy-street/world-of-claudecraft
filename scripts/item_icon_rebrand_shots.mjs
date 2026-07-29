// Visual proof for the item icon rebrand. Boots the real offline client, grants a
// representative spread of formerly procedural items, opens Bags, and captures
// the same inventory surface on desktop and mobile.
//
// Needs `npm run dev`. Set SHOT_STATE=before or after and optionally GAME_URL.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';
import { suppressGpuNotice } from './lib/gpu_notice_suppress.mjs';

const URL = process.env.GAME_URL ?? 'http://127.0.0.1:5173';
const STATE = process.env.SHOT_STATE ?? 'after';
const VARIANT = process.env.SHOT_VARIANT ?? 'both';
const OUT = process.env.SHOTS_DIR ?? `docs/screenshots/icons-rebrand/${STATE}`;
const ITEMS = [
  'minor_mana_potion',
  'thorium_ore',
  'ashwood_log',
  'goldleaf_herb',
  'spider_leg',
  'arcane_shard',
  'ironreel_fishing_rod',
  'cryptbone_pauldrons',
  'wardweave_cowl',
  'thoriumscale_cuirass',
  'fenbridge_hide_boots',
  'seal_of_the_nine_oaths',
  'valefire_lantern',
  'waterlogged_idol',
];

fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});

async function capture(key, mobile) {
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.log(`PAGEERROR(${key}):`, error.message));
  await suppressGpuNotice(page);
  if (mobile) {
    await page.emulate({
      viewport: { width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
        '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });
  }
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
  if (mobile) await page.evaluate(() => document.body.classList.add('mobile-touch'));
  await enterOfflineGame(page, { charClass: 'warrior', charName: 'Iconproof', settleMs: 3000 });
  const inventory = await page.evaluate((ids) => {
    const game = window.__game;
    const pid = game?.sim?.player?.id;
    for (const id of ids) game?.sim?.addItem(id, 1, pid);
    const bags = document.querySelector('#bags');
    if (bags) bags.style.display = 'none';
    game?.hud?.toggleBags?.();
    game?.hud?.renderBags?.();
    return game?.sim?.inventory?.map((slot) => slot?.itemId).filter(Boolean) ?? [];
  }, ITEMS);
  if (!ITEMS.every((id) => inventory.includes(id))) {
    throw new Error(`representative inventory incomplete: ${JSON.stringify(inventory)}`);
  }
  await wait(700);
  const bags = await page.$('#bags');
  if (!bags) throw new Error('Bags window did not open');
  await bags.screenshot({ path: `${OUT}/inventory-${key}.png` });
  await page.close();
}

try {
  if (VARIANT === 'both' || VARIANT === 'desktop') await capture('desktop', false);
  if (VARIANT === 'both' || VARIANT === 'mobile') await capture('mobile', true);
  console.log(`captured item icon ${STATE} screenshots in ${OUT}`);
} finally {
  await browser.close();
}
