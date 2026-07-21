// Capture for PR #1059 follow-up: the Players/Guilds tabs now use a real WAI-ARIA
// tablist with a roving tabindex and a steady :focus-visible ring, and keyboard
// activation refocuses the active tab instead of dropping focus to <body>. Boots
// the offline world, opens the High Scores window, Tabs to the tab strip, then
// uses ArrowRight to move the roving focus, screenshotting the focused tab so the
// focus ring is visible. Run with `npm run dev` up (override port via GAME_URL=).
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = 'docs/pr-assets/guild-highscores';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1280,860', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 860 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await enterOfflineGame(page, { charClass: 'warrior', charName: 'Ranker', settleMs: 2800 });
await sleep(400);
await page.evaluate(() => {
  document.querySelector('.tut-skip')?.click();
  const hud = window.__game?.hud;
  for (let i = 0; i < 20 && hud?.closeAll?.(); i++) {}
});
await page.evaluate(() => window.__game.hud.toggleLeaderboard());
await sleep(500);
await page.evaluate(() => {
  for (const w of document.querySelectorAll('.window')) {
    if (w.id !== 'leaderboard-window') w.style.display = 'none';
  }
});
// Keyboard-focus the active tab, then ArrowRight to roam to Guilds; the focus ring
// follows the selection and the board switches.
await page.evaluate(() => {
  const t = document.querySelector('#leaderboard-window .lb-tab-active');
  t?.focus();
});
await sleep(150);
await page.keyboard.press('ArrowRight');
await sleep(500);
const focused = await page.evaluate(() => {
  const a = document.activeElement;
  return { tag: a?.tagName, cls: a?.className, text: a?.textContent };
});
console.log('focused after ArrowRight:', JSON.stringify(focused));
const box = await page.evaluate(() => {
  const w = document.querySelector('#leaderboard-window');
  const r = w.getBoundingClientRect();
  return {
    x: Math.round(r.x),
    y: Math.round(r.y),
    width: Math.round(r.width),
    height: Math.round(r.height),
  };
});
await page.screenshot({
  path: `${OUT}/tabs-keyboard-focus.png`,
  clip: { x: box.x, y: box.y, width: box.width, height: box.height },
});
console.log('captured ->', OUT);
await browser.close();
