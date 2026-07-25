// Captures the #side-buttons micro-menu rail for the "group the micromenu into
// sections" PR, at a maximized 1366x768 laptop viewport (the rail's target
// machine, same as scripts/side_buttons_rail_shot.mjs).
//
// Four states, because the interesting claim is not just "there are dividers"
// but "a divider never orphans itself when a conditional launcher is hidden":
//   rail            default boot: #mm-town-focus and #mm-discord both hidden
//   rail-all        every conditional launcher forced visible
//   rail-no-rewards the lone-chest rewards section emptied (daily rewards off),
//                   which must remove the section AND its keyline entirely
//   mobile          body.mobile-touch, where the whole rail is display:none
//
// Runs against either arm (before/after) unchanged: the state toggles address
// buttons by id and drive BOTH hidden mechanisms, so the pre-change markup
// (inline display:none on #mm-town-focus) reacts the same way.
//
// Usage: GAME_URL=http://localhost:5174 node scripts/micromenu_groups_shot.mjs before|after
// Output: docs/screenshots/micromenu-groups/<prefix>-*.png

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const PREFIX = process.argv[2] ?? 'after';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(ROOT, '..', 'docs', 'screenshots', 'micromenu-groups');
fs.mkdirSync(OUT_DIR, { recursive: true });

const PAD = 18;

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1366,768', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1366, height: 660 },
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
await enterOfflineGame(page);

// Clip to the rail plus a margin, so the sections and their keylines are
// legible at 1:1 instead of lost in a full-HUD shot.
async function shotRail(name) {
  await new Promise((r) => setTimeout(r, 350));
  const box = await page.evaluate(() => {
    const el = document.getElementById('side-buttons');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  if (!box) throw new Error('no #side-buttons in the DOM');
  await page.screenshot({
    path: path.join(OUT_DIR, `${PREFIX}-${name}.png`),
    clip: {
      x: Math.max(0, box.x - PAD * 4),
      y: Math.max(0, box.y - PAD),
      width: box.width + PAD * 5,
      height: box.height + PAD * 2,
    },
  });
  console.log('wrote', path.join(OUT_DIR, `${PREFIX}-${name}.png`));
}

// Default boot state.
await shotRail('rail');

// Every conditional launcher visible. Both mechanisms are driven so this works
// on the pre-change markup too (inline display:none) and on the new one.
await page.evaluate(() => {
  for (const id of ['mm-town-focus', 'mm-discord']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.hidden = false;
    el.style.display = '';
  }
});
await shotRail('rail-all');

// The rewards section emptied: its only entry is #daily-rewards-button, which
// the HUD hides on a build with daily rewards off. The section and its keyline
// must both disappear rather than leaving a rule with nothing under it.
await page.evaluate(() => {
  const chest = document.getElementById('daily-rewards-button');
  if (chest) chest.hidden = true;
});
await shotRail('rail-no-rewards');

// Mobile: the whole rail is display:none under body.mobile-touch (the
// launchers live in the More tray), so this shot is the evidence that the
// grouping never reaches a phone.
await page.evaluate(() => {
  const chest = document.getElementById('daily-rewards-button');
  if (chest) chest.hidden = false;
  document.body.classList.add('mobile-touch');
});
await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true });
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: path.join(OUT_DIR, `${PREFIX}-mobile.png`) });
console.log('wrote', path.join(OUT_DIR, `${PREFIX}-mobile.png`));

await browser.close();
