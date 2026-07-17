// Screenshots of the new All-view chat category filter strip (issue #1670),
// for the PR body: desktop, mobile portrait, and mobile landscape. Not wired
// into CI; run manually against a local `npm run dev`.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5185';
const OUT = process.env.SHOTS_DIR ?? 'docs/screenshots';
fs.mkdirSync(OUT, { recursive: true });

const { BROWSER_PATH } = await import('./browser_path.mjs');

const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36';

async function seedAndDismiss(page) {
  // Skip the spawn cinematic (it hides #ui, the whole HUD chrome, until it
  // finishes or is skipped via Escape) -- only if it is still showing; the
  // cinematic may already be done by settleMs, and Escape then opens the
  // Game Menu instead, which must be closed again rather than left open.
  const introHidesUi = await page.evaluate(
    () => document.getElementById('ui')?.style.display === 'none',
  );
  if (introHidesUi) {
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 500));
  }
  const menuOpen = await page.evaluate(() => {
    const menu = document.getElementById('options-menu');
    return !!menu && getComputedStyle(menu).display !== 'none' && menu.childElementCount > 0;
  });
  if (menuOpen) {
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 300));
  }
  // Dismiss the "Find Your Footing" tutorial card so it doesn't cover the shot.
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    btns.find((b) => b.textContent?.includes('Skip Tutorial'))?.click();
  });
  await new Promise((r) => setTimeout(r, 300));
  // Seed a few lines across categories so the strip has something to show/hide.
  await page.evaluate(() => {
    const hud = window.__game?.hud;
    if (!hud) return;
    hud.log('You loot [[i:iron_ore]].', '#7fdc4f', 'loot');
    hud.log('You gain 42 experience.', '#a980d8', 'xp');
    hud.log('Quest updated: Forest Wolf slain (3/8)', '#dcd29f', 'quest');
    hud.log('The Ashen Coliseum: your match has been found!', '#ffa040', 'event');
    hud.log('Welcome to Sowfield Hollow.', '#ffd100', 'game');
  });
  await new Promise((r) => setTimeout(r, 300));
}

async function hideLootAndXp(page) {
  await page.evaluate(() => {
    const strip = document.getElementById('chat-category-strip');
    const buttons = [...strip.querySelectorAll('.chat-category-toggle')];
    for (const b of buttons) if (b.dataset.cat === 'loot' || b.dataset.cat === 'xp') b.click();
  });
  await new Promise((r) => setTimeout(r, 200));
}

async function shootDesktop(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await enterOfflineGame(page, { settleMs: 2000 });
  await seedAndDismiss(page);
  await page.screenshot({ path: `${OUT}/chat-category-strip-desktop-all.png` });
  await hideLootAndXp(page);
  await page.screenshot({ path: `${OUT}/chat-category-strip-desktop-filtered.png` });
  await page.close();
}

async function shootMobile(browser, { name, width, height, isLandscape }) {
  const page = await browser.newPage();
  await page.emulate({
    name,
    userAgent: MOBILE_UA,
    viewport: { width, height, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape },
  });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await enterOfflineGame(page, { settleMs: 2800 });
  await page.evaluate(() => document.getElementById('mobile-preflight-continue')?.click());
  await new Promise((r) => setTimeout(r, 400));
  await seedAndDismiss(page);
  // Open the mobile chat overlay directly (the button binds a pointerdown
  // handler that toggles this class, which a plain .click() does not fire).
  await page.evaluate(() => document.body.classList.add('mobile-chat-open'));
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: `${OUT}/chat-category-strip-mobile-${name}.png` });
  await page.close();
}

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1280,800', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 800 },
});

try {
  await shootDesktop(browser);
  // Portrait is deliberately skipped: the game locks mobile play to landscape
  // (a "Rotate to Landscape" gate covers the world in portrait), so there is
  // no portrait HUD to shoot.
  await shootMobile(browser, { name: 'landscape', width: 844, height: 390, isLandscape: true });
  console.log(`wrote screenshots to ${OUT}/chat-category-strip-*.png`);
} finally {
  await browser.close();
}
