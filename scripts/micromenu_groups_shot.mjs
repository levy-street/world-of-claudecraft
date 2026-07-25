// Captures the #side-buttons micro-menu rail for the "group the micromenu into
// sections" PR, at a maximized 1366x768 laptop viewport (the rail's target
// machine, same as scripts/side_buttons_rail_shot.mjs).
//
// Four states, because the interesting claim is not just "there are dividers"
// but "a divider never orphans itself when a conditional launcher is hidden":
//   rail            default boot (#mm-town-focus hidden, out of town)
//   rail-all        every conditional launcher forced visible
//   rail-no-rewards the lone-chest rewards section emptied (daily rewards off),
//                   which must remove the section AND its keyline entirely
//   mobile          a real emulated phone, where the whole rail is display:none
//
// Runs against either arm (before/after) unchanged: the state toggles address
// buttons by id and drive BOTH hidden mechanisms, so the pre-change markup
// (inline display:none on #mm-town-focus) reacts the same way.
//
// Usage: GAME_URL=http://localhost:5173 node scripts/micromenu_groups_shot.mjs before|after
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

const PAD = 16;
const DESKTOP = { width: 1366, height: 660 };
// iphone-13-landscape from scripts/lib/overlap_geometry.mjs (in-game mobile is
// landscape-only on the web client).
const PHONE = { width: 844, height: 390, dsf: 3 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
// Enter at deviceScaleFactor 1: the pre-game class-select flow does not lay out
// reliably under a 2x boot, and enterOfflineGame then times out on its card.
// The rail shots bump the scale factor AFTER the world is up.
await page.setViewport({ ...DESKTOP, deviceScaleFactor: 1 });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
await enterOfflineGame(page, { settleMs: 2000 });

const cdp = await page.createCDPSession();

// Raw CDP with explicit screenWidth/screenHeight: puppeteer's setViewport omits
// them and headless then fit-scales, leaving window.innerWidth reporting the
// old viewport (the trap mobile_cluster_layout_check.mjs documents).
async function setMetrics({ width, height, dsf, mobile = false }) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: dsf,
    mobile,
    screenWidth: width,
    screenHeight: height,
    positionX: 0,
    positionY: 0,
  });
  await cdp.send('Emulation.resetPageScaleFactor').catch(() => {});
  await sleep(250);
}

// 2x for the desktop rail shots: the whole point is a 1px keyline between
// sections, which is not legible in a 1x capture.
await setMetrics({ ...DESKTOP, dsf: 2 });

// Clip to the rail plus a margin, so the sections and their keylines are
// legible instead of lost in a full-HUD shot.
async function shotRail(name) {
  await sleep(350);
  const box = await page.evaluate(() => {
    const el = document.getElementById('side-buttons');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  if (!box) throw new Error('no #side-buttons in the DOM');
  const out = path.join(OUT_DIR, `${PREFIX}-${name}.png`);
  await page.screenshot({
    path: out,
    clip: {
      x: Math.max(0, box.x - PAD),
      y: Math.max(0, box.y - PAD),
      width: box.width + PAD * 2,
      height: box.height + PAD * 2,
    },
  });
  console.log('wrote', out);
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
// Drive the real code path (the showDailyRewardsChest setting the options menu
// exposes) rather than only forcing the attribute: the HUD re-asserts the
// chest's visibility from that setting, and a hand-set attribute can be undone
// between the toggle and the capture. Falls back to the attribute when the
// hook is not reachable, so the script still works on either arm.
await page.evaluate(() => {
  const hud = window.__game?.hud;
  hud?.setDailyRewardsChestButtonPreference?.(false);
  const chest = document.getElementById('daily-rewards-button');
  if (chest && !chest.hidden) chest.hidden = true;
});
await shotRail('rail-no-rewards');

// The screenshot shows there is no orphaned keyline; this reads it back out of
// the live cascade so the claim does not rest on eyeballing a 1px line. Every
// collapsed section must be display:none with no border, and the LAST visible
// section of each column must carry no border either.
const sectionState = await page.evaluate(() =>
  [...document.querySelectorAll('.side-buttons-col')].map((col) => ({
    col: col.id,
    sections: [...col.querySelectorAll('.micro-group')].map((g) => {
      const cs = getComputedStyle(g);
      return {
        group: g.dataset.group,
        display: cs.display,
        borderBottom: cs.borderBottomWidth,
        borderTop: cs.borderTopWidth,
      };
    }),
  })),
);
console.log('rewards-off section state:', JSON.stringify(sectionState, null, 1));

// Mobile: the whole rail is display:none under body.mobile-touch (the launchers
// live in the More tray), so this shot is the evidence that the grouping never
// reaches a phone. Emulate a real coarse-pointer device so the runtime itself
// activates the touch UI, rather than only stamping the class by hand.
await page.evaluate(() => {
  const chest = document.getElementById('daily-rewards-button');
  if (chest) chest.hidden = false;
});
await cdp.send('Emulation.setEmulatedMedia', {
  features: [
    { name: 'pointer', value: 'coarse' },
    { name: 'hover', value: 'none' },
  ],
});
await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await setMetrics({ width: PHONE.width, height: PHONE.height, dsf: PHONE.dsf, mobile: true });
await page.evaluate(() => {
  document.body.classList.add('mobile-touch', 'game-active');
  window.dispatchEvent(new Event('resize'));
});
await sleep(600);
await page.evaluate(() => document.body.classList.add('mobile-touch', 'game-active'));
await page
  .waitForFunction(
    () => {
      const attack = document.getElementById('mobile-action-attack');
      return !!attack && attack.getBoundingClientRect().width > 0;
    },
    { timeout: 12000 },
  )
  .catch(() => console.warn('mobile controls never laid out; shooting anyway'));

// Report what the rail actually resolves to, so the shot is not the only claim.
const railOnPhone = await page.evaluate(() => {
  const el = document.getElementById('side-buttons');
  if (!el) return 'absent';
  return `${getComputedStyle(el).display} (${el.getBoundingClientRect().width}px wide)`;
});
console.log('mobile #side-buttons computed display:', railOnPhone);

const mobileOut = path.join(OUT_DIR, `${PREFIX}-mobile.png`);
await page.screenshot({ path: mobileOut });
console.log('wrote', mobileOut);

await browser.close();
