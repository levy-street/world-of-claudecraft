// One-off screenshot for PR #1825's uiScale should-fix: fitBodyToWindow must un-zoom
// its rect measurements before writing an author-space cap, or the Talents window's
// Create-build foot panel clips again at non-default UI Scale.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.OUT_DIR ?? 'docs/screenshots/pr-1825';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await enterOfflineGame(page, { charClass: 'paladin', charName: 'Scaley' });
// First-spawn intro cinematic hides #ui until the camera lands; Escape skips straight
// to the end (main.ts's setIntroUiHidden).
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 300));

// Level up and spend a tall Specialization build (spec picker + Mastery banner + tree,
// the exact combination that pushed #tal-body past the window's max-height budget).
await page.evaluate(() => {
  const g = window.__game;
  g.sim.setPlayerLevel(60);
});
await new Promise((r) => setTimeout(r, 300));

// Set UI Scale to 0.85 (the slider's minimum) the same way Options does: persist the
// setting and apply the live --ui-scale custom property main.ts reads it from.
await page.evaluate(() => {
  localStorage.setItem('woc_settings', JSON.stringify({ uiScale: 0.85 }));
  document.documentElement.style.setProperty('--ui-scale', '0.85');
});
await new Promise((r) => setTimeout(r, 150));

const isTalentsOpen = () =>
  page.evaluate(() => {
    const w = document.querySelector('.tal-window, .tal-tree')?.closest('.window');
    return !!w && getComputedStyle(w).display !== 'none';
  });

if (await isTalentsOpen()) {
  await page.evaluate(() => window.__game.hud.toggleTalents());
  await new Promise((r) => setTimeout(r, 200));
}
await page.evaluate(() => window.__game.hud.toggleTalents());
await new Promise((r) => setTimeout(r, 400));

// Land on the Specialization tab (index 1 in the tab strip) to reproduce the tall layout.
await page.evaluate(() => {
  const tabs = document.querySelectorAll('.tal-tabs [role="tab"], .tal-tab');
  for (const el of tabs) {
    if (/specialization/i.test(el.textContent || '')) {
      el.click();
      return;
    }
  }
});
await new Promise((r) => setTimeout(r, 400));

await page.screenshot({ path: `${OUT}/desktop-09-talents-uiscale-085-fit.png` });
console.log(`saved ${OUT}/desktop-09-talents-uiscale-085-fit.png`);

await browser.close();
