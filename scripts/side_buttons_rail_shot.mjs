// Captures the #side-buttons rail together with #right-tracker-stack at a
// maximized 1366x768 laptop viewport (the target machine for the two-column
// rail split), with quests tracked so the tracker's real vertical span is
// visible against the rail. Used for the PR #2177 review follow-up: the
// original screenshots showed no quests tracked, so the rail/tracker overlap
// this PR's width increase can cause was never shown.
// Output: docs/screenshots/side-buttons-rail-split/{before,after}-laptop.png

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT_NAME = process.argv[2] ?? 'after-laptop.png';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(ROOT, '..', 'docs', 'screenshots', 'side-buttons-rail-split');
fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1366,768', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1366, height: 660 },
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
await enterOfflineGame(page);

await page.evaluate(() => {
  const ql = window.__game.world.questLog;
  ql.clear();
  ql.set('q_wolves', { questId: 'q_wolves', counts: [3], state: 'active' });
  ql.set('q_murlocs', { questId: 'q_murlocs', counts: [2], state: 'active' });
  ql.set('q_boars', { questId: 'q_boars', counts: [1], state: 'active' });
});
await page
  .waitForFunction(() => document.querySelectorAll('#quest-tracker .qt-title').length === 3, {
    timeout: 8000,
  })
  .catch(() => {});
await page.evaluate(() => {
  for (const b of document.querySelectorAll('button')) {
    if (b.textContent.trim() === 'Dismiss') b.click();
  }
});
await new Promise((r) => setTimeout(r, 400));

await page.screenshot({ path: path.join(OUT_DIR, OUT_NAME) });
await browser.close();
console.log('wrote', path.join(OUT_DIR, OUT_NAME));
