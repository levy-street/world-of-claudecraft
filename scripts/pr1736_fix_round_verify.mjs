// Verification harness for the PR #1736 fix round (handed-off maintainer fixes):
// (1) settings Overview: language pin first + the touch shell's 2-column pins
//     grid actually fills both columns, (2) vendor Sell tab: a real gap between
//     Sell Junk and the item list, (3) static dialogs (quest dialog) no longer
//     drag by their titlebar, (4) bags: the desktop item grid tracks grew to the
//     56px --slot-cell floor. Boots the offline world once; writes tmp/ shots
//     and exits non-zero on any failed assertion.
// Needs a dev server (default :5199, override GAME_URL). Renders at ?gfx=ultra.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = (process.env.GAME_URL ?? 'http://localhost:5199') + '/?gfx=ultra';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures.push(name);
};

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => {
  console.log('PAGEERROR:', e.message);
  pageErrors.push(e.message);
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#btn-offline', { timeout: 60000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(300);
await page.type('#char-name', 'Fixwright');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await page.waitForFunction(() => window.__game?.hud, { timeout: 60000 });
await sleep(2500);

// ---------------------------------------------------------------------------
// (4) Bags: desktop grid tracks at the 56px floor, sockets grown to match.
// ---------------------------------------------------------------------------
await page.evaluate(() => {
  const sim = window.__game.sim;
  for (const id of ['baked_bread', 'boar_hide', 'minor_healing_potion']) sim.addItem(id, 3);
  window.__game.hud.toggleBags();
});
await sleep(500);
const bag = await page.evaluate(() => {
  const cell = document.querySelector('#bags .bag-grid .item-cell');
  const socket = document.querySelector('#bags .bag-socket');
  const grid = document.querySelector('#bags .bag-grid');
  return {
    cellW: cell ? cell.getBoundingClientRect().width : 0,
    socketW: socket ? socket.getBoundingClientRect().width : 0,
    track: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ')[0] : '',
  };
});
check('bags cell >= 56px', bag.cellW >= 56, `cell ${bag.cellW.toFixed(1)}px`);
check('bag socket >= 56px', bag.socketW >= 56, `socket ${bag.socketW.toFixed(1)}px`);
// The grown sockets must not clip the capacity counter at the default width:
// the bar wraps, so the counter stays inside the window body's content box.
const cap = await page.evaluate(() => {
  const counter = document.querySelector('#bags .bag-capacity');
  const body = document.querySelector('#bags .window-body');
  if (!counter || !body) return null;
  const c = counter.getBoundingClientRect();
  const b = body.getBoundingClientRect();
  return { fits: c.right <= b.right + 1 && c.width > 0, cr: c.right, br: b.right };
});
check(
  'bag capacity counter not clipped',
  cap?.fits === true,
  cap ? `counter right ${cap.cr.toFixed(0)} vs body right ${cap.br.toFixed(0)}` : 'nodes missing',
);
await page.screenshot({ path: 'tmp/fix_bags_desktop.png' });
await page.evaluate(() => window.__game.hud.toggleBags());
await sleep(300);

// ---------------------------------------------------------------------------
// (2) Vendor Sell tab: Sell Junk button keeps a real margin above the list.
// ---------------------------------------------------------------------------
const vendorOpened = await page.evaluate(() => {
  const g = window.__game;
  const npc = [...g.sim.entities.values()].find((e) => e.vendorItems && e.vendorItems.length);
  if (!npc) return false;
  g.sim.player.pos.x = npc.pos.x + 1;
  g.sim.player.pos.z = npc.pos.z;
  g.hud.openVendor(npc.id);
  return true;
});
await sleep(600);
if (vendorOpened) {
  await page.evaluate(() => {
    document.querySelector('#vendor-window [data-window-tab="sell"]')?.click();
  });
  await sleep(400);
  const vend = await page.evaluate(() => {
    const btn = document.querySelector('#vendor-window .btn.vendor-sell');
    if (!btn) return null;
    return { marginBottom: getComputedStyle(btn).marginBottom };
  });
  check(
    'sell-junk margin-bottom 16px',
    vend?.marginBottom === '16px',
    vend ? vend.marginBottom : 'no sell rows in bags (button absent)',
  );
  await page.screenshot({ path: 'tmp/fix_vendor_sell.png' });
  await page.evaluate(() => document.querySelector('#vendor-window [data-window-close]')?.click());
  await sleep(300);
} else {
  check('vendor found', false, 'no vendor entity in range');
}

// ---------------------------------------------------------------------------
// (3) Quest dialog: a titlebar drag must NOT move the window.
// ---------------------------------------------------------------------------
await page.evaluate(() => {
  const g = window.__game;
  g.sim.player.pos.x = 4;
  g.sim.player.pos.z = 3;
});
await sleep(200);
await page.keyboard.press('f');
await sleep(500);
const questOpen = await page.evaluate(() => {
  const d = document.querySelector('#quest-dialog');
  return !!d && getComputedStyle(d).display !== 'none';
});
if (questOpen) {
  const beforeRect = await page.evaluate(() => {
    const r = document.querySelector('#quest-dialog').getBoundingClientRect();
    return { left: r.left, top: r.top };
  });
  const handle = await page.evaluate(() => {
    const t =
      document.querySelector('#quest-dialog .panel-title') ??
      document.querySelector('#quest-dialog .window-titlebar');
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (handle) {
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(handle.x + 120, handle.y + 90, { steps: 6 });
    await page.mouse.up();
    await sleep(200);
    const afterRect = await page.evaluate(() => {
      const r = document.querySelector('#quest-dialog').getBoundingClientRect();
      return { left: r.left, top: r.top };
    });
    const moved =
      Math.abs(afterRect.left - beforeRect.left) > 1 ||
      Math.abs(afterRect.top - beforeRect.top) > 1;
    check('quest dialog does not drag', !moved, `moved ${moved}`);
  } else {
    check('quest dialog handle found', false);
  }
  await page.screenshot({ path: 'tmp/fix_quest_dialog.png' });
  await page.evaluate(() => document.querySelector('#quest-dialog [data-close]')?.click());
  await sleep(200);
} else {
  check('quest dialog opened', false);
}

// ---------------------------------------------------------------------------
// (1a) Desktop Esc menu Overview: the language pin renders FIRST.
// ---------------------------------------------------------------------------
await page.keyboard.press('Escape');
await sleep(600);
const desktopOverview = await page.evaluate(() => {
  const pins = [...document.querySelectorAll('#options-menu .opt-pin')];
  const firstLabel = pins[0]?.querySelector('.opt-row-label')?.textContent ?? '';
  const hasLangDd = !!pins[0]?.querySelector('.set-lang-select');
  const customColorsOnOverview = !!document.querySelector('#options-menu .theme-color-grid');
  return { pinCount: pins.length, firstLabel, hasLangDd, customColorsOnOverview };
});
check(
  'language pin first (desktop)',
  desktopOverview.hasLangDd,
  `first pin "${desktopOverview.firstLabel}", ${desktopOverview.pinCount} pins`,
);
check(
  'custom colors NOT on Overview',
  !desktopOverview.customColorsOnOverview,
  'mirror-only theme pin',
);
await page.screenshot({ path: 'tmp/fix_options_overview_desktop.png' });
await page.keyboard.press('Escape');
await sleep(400);

// ---------------------------------------------------------------------------
// (1b) Touch shell Overview: pins actually fill BOTH columns of the 2-col grid.
// ---------------------------------------------------------------------------
await page.evaluate(() => document.body.classList.add('mobile-touch'));
await page.keyboard.press('Escape');
await sleep(700);
const shell = await page.evaluate(() => {
  const content = document.querySelector('#options-menu .opt-mshell-content');
  if (!content) return null;
  // The landing hosts the pins section; find the .opt-pin cells and record
  // their horizontal starts: a working 2-col grid has at least two distinct
  // column offsets among consecutive pins.
  const pins = [...content.querySelectorAll('.opt-pin')];
  const lefts = pins.map((p) => Math.round(p.getBoundingClientRect().left));
  const firstHasLang = !!pins[0]?.querySelector('.set-lang-select');
  return { pinCount: pins.length, distinctLefts: [...new Set(lefts)], firstHasLang };
});
if (shell) {
  check('shell landing shows pins', shell.pinCount >= 4, `${shell.pinCount} pins`);
  check(
    'pins fill both columns',
    shell.distinctLefts.length >= 2,
    `column offsets ${shell.distinctLefts.join(',')}`,
  );
  check('language pin first (touch shell)', shell.firstHasLang);
} else {
  check('touch shell rendered', false);
}
await page.screenshot({ path: 'tmp/fix_options_overview_touch.png' });

// A theme-preset tap on the shell must repaint (renderDetail used to deref the
// missing desktop pane and throw, leaving the pin stale).
const errsBeforeTap = pageErrors.length;
const themeTap = await page.evaluate(() => {
  const seg = document.querySelector('#options-menu .theme-presets');
  if (!seg) return null;
  const target = [...seg.querySelectorAll('button')].find((b) => !b.classList.contains('active'));
  if (!target) return null;
  const label = target.textContent;
  target.click();
  return label;
});
await sleep(600);
const themeState = await page.evaluate(() => {
  const seg = document.querySelector('#options-menu .theme-presets');
  const active = seg?.querySelector('button.active');
  return active ? active.textContent : null;
});
check(
  'theme preset tap repaints on the shell',
  !!themeTap && themeState === themeTap && pageErrors.length === errsBeforeTap,
  `tapped "${themeTap}", active "${themeState}", new page errors ${pageErrors.length - errsBeforeTap}`,
);

await browser.close();
check('no page errors across the run', pageErrors.length === 0, pageErrors.join(' | '));
if (failures.length) {
  console.log(`\n${failures.length} FAILURE(S): ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nALL CHECKS PASSED');
