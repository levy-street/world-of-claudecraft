// Mobile leg of the PR #1965 crafted caster-stat gear capture (see
// caster_gear_shot.mjs for the desktop tooltip/paperdoll captures). Split into its
// own script to keep browser memory footprint minimal, matching the repo's
// established greyjaw_pet_tap_shot.mjs / greyjaw_pet_tap_mobile.mjs split. The web
// client is landscape-only in-game on mobile, so this uses landscape device metrics.
//   node scripts/caster_gear_shot_mobile.mjs    (needs `npm run dev` on :5173)
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.OUT_DIR ?? 'docs/screenshots/crafting-caster-gear';
fs.mkdirSync(OUT, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=844,390', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 844, height: 390, isMobile: true, hasTouch: true },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 120000 });
await page.evaluate(() => document.body.classList.add('mobile-touch'));
// Shared entry flow: dismisses the intro cinematic, the new-adventurer tutorial,
// and the camera-mode-choice prompt so every capture below is clean gameplay only.
await enterOfflineGame(page, { charClass: 'priest', charName: 'Wardweavem', settleMs: 2000 });

const overlayState = await page.evaluate(() => {
  const visible = (el) => !!el && getComputedStyle(el).display !== 'none';
  return {
    introLogo: visible(document.getElementById('intro-logo')),
    tutorial: visible(document.querySelector('button.tut-skip')),
    cameraPrompt: visible(document.querySelector('.camera-prompt-backdrop')),
    uiHidden: document.getElementById('ui')?.style.display === 'none',
  };
});
console.log(
  'mobile overlay state after entry (all should be false):',
  JSON.stringify(overlayState),
);

// Grant reagents and the new caster-stat gear, then open crafting and shoot it.
await page.evaluate(() => {
  const sim = window.__game?.sim;
  for (const id of ['bone_fragments', 'linen_scrap', 'spider_leg']) {
    try {
      sim?.addItem(id, 10);
    } catch {}
  }
  for (const id of ['wardweave_cowl', 'duskhide_wraps', 'sootscale_mantle']) {
    try {
      sim?.addItem(id, 1, sim.player.id);
    } catch {}
  }
});

await page.evaluate(() => window.__game?.hud?.toggleCrafting?.());
await wait(1000);
const craftingOpen = await page.evaluate(() => {
  const el = document.querySelector('#crafting-window');
  return !!el && getComputedStyle(el).display !== 'none';
});
console.log('mobile crafting window open:', craftingOpen);
if (craftingOpen) {
  await page.screenshot({ path: `${OUT}/after-crafting-window-mobile.png` });
}
await page.evaluate(() => window.__game?.hud?.toggleCrafting?.());
await wait(300);

// Equip the hub-tier Wardweave Cowl and shoot the mobile character sheet.
await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.setPlayerLevel?.(20, sim.player.id);
  try {
    sim.equipItem?.('wardweave_cowl', sim.player.id);
  } catch {}
});
await page.evaluate(() => window.__game?.hud?.toggleChar?.());
await wait(900);
const sheetOpen = await page.evaluate(() => {
  const el = document.querySelector('#char-window');
  return !!el && getComputedStyle(el).display !== 'none';
});
console.log('mobile char sheet open:', sheetOpen);
if (sheetOpen) {
  await page.screenshot({ path: `${OUT}/after-paperdoll-wardweave-cowl-mobile.png` });
} else {
  await page.screenshot({ path: `${OUT}/after-paperdoll-wardweave-cowl-mobile.png` });
}

await browser.close();
