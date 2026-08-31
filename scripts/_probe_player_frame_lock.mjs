// Live check of lockPlayerFrameToActionBar: with combined bars MOVED, turning
// the lock on docks the frame into the group; dragging the group carries the
// frame; adding/removing bar rows keeps the frame glued to the top while bar 1
// stays pixel-fixed; and while docked (bars unmoved) the stock stack already
// moves the frame when a bar row is added. Off restores the frame's own spot.
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5391';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ` ${JSON.stringify(extra)}` : ''}`);
  if (!cond) fail += 1;
};
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 240000,
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.setDefaultNavigationTimeout(180000);
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.evaluateOnNewDocument(() => {
  const s = JSON.parse(localStorage.getItem('woc_settings') ?? '{}');
  s.graphicsPreset = 4;
  s.graphicsDefaultApplied = true;
  s.combineActionBars = true;
  localStorage.setItem('woc_settings', JSON.stringify(s));
});
await page.goto(URL, { waitUntil: 'domcontentloaded' });
console.log(
  'booted:',
  await enterOfflineGame(page, {
    charClass: 'warrior',
    charName: 'BarLockProbe',
    gameBootTimeoutMs: 120000,
    settleMs: 5000,
  }),
);

const rectOf = (id) =>
  page.evaluate((elId) => {
    const r = document.getElementById(elId).getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width };
  }, id);
const setLock = (on) =>
  page.evaluate((v) => {
    window.__game.hud.setLockPlayerFrameToActionBar(v);
    const s = JSON.parse(localStorage.getItem('woc_settings') ?? '{}');
    s.lockPlayerFrameToActionBar = v;
    localStorage.setItem('woc_settings', JSON.stringify(s));
  }, on);

// 1) Stock (nothing moved), lock ON: frame stays in the stack, and adding
// bar 2 pushes it up by the new row's height (the stock flex column).
await setLock(true);
await sleep(200);
const stockParent = await page.evaluate(
  () => document.getElementById('player-frame').parentElement.id,
);
const beforeBar2 = await rectOf('player-frame');
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.bar-toggle .bar-toggle-btn')].find(
    (x) => x.textContent === '+',
  );
  b.click();
});
await sleep(300);
const afterBar2 = await rectOf('player-frame');
check(
  'docked + lock on: frame stays in the stack and rides up when bar 2 appears',
  stockParent === 'actionbar-stack' && afterBar2.top < beforeBar2.top - 20,
  { stockParent, beforeTop: beforeBar2.top, afterTop: afterBar2.top },
);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.bar-toggle .bar-toggle-btn')].find(
    (x) => x.textContent === '-',
  );
  b.click();
});
await sleep(300);

// 2) Move the combined group while editing: the frame hops inside and rides.
await page.evaluate(() => window.__game.hud.toggleInterfaceUnlock());
await sleep(600);
const groupRect = await rectOf('actionbar-group');
await page.mouse.move((groupRect.left + groupRect.right) / 2, groupRect.bottom - 10);
await page.mouse.down();
await page.mouse.move((groupRect.left + groupRect.right) / 2 - 300, groupRect.bottom - 210, {
  steps: 10,
});
await page.mouse.up();
await sleep(300);
const ride = await page.evaluate(() => {
  const frame = document.getElementById('player-frame');
  const group = document.getElementById('actionbar-group');
  const f = frame.getBoundingClientRect();
  const bar = document.getElementById('actionbar').getBoundingClientRect();
  return {
    parent: frame.parentElement.id,
    frameAboveBar: f.bottom <= bar.top + 1,
    detached: group.classList.contains('hud-frame-detached'),
  };
});
check(
  'moving the combined group pulls the locked frame inside it, above the bars',
  ride.parent === 'actionbar-group' && ride.frameAboveBar && ride.detached,
  ride,
);

// 3) Drag the group again: the frame moves by the same delta.
const f0 = await rectOf('player-frame');
const g0 = await rectOf('actionbar-group');
await page.mouse.move((g0.left + g0.right) / 2, g0.bottom - 10);
await page.mouse.down();
await page.mouse.move((g0.left + g0.right) / 2 + 150, g0.bottom - 10 + 80, { steps: 8 });
await page.mouse.up();
await sleep(300);
const f1 = await rectOf('player-frame');
const g1 = await rectOf('actionbar-group');
const delta = { dx: g1.left - g0.left, dy: g1.top - g0.top };
check(
  'dragging the group carries the frame by the same offset',
  Math.abs(f1.left - f0.left - delta.dx) < 2 && Math.abs(f1.top - f0.top - delta.dy) < 2,
  { frame: { dx: f1.left - f0.left, dy: f1.top - f0.top }, group: delta },
);

// 4) Add bar 2 while moved: bar 1 stays pixel-fixed, the frame rides UP.
const bar1Before = await rectOf('actionbar');
const frameBefore = await rectOf('player-frame');
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.bar-toggle .bar-toggle-btn')].find(
    (x) => x.textContent === '+',
  );
  b.click();
});
await sleep(300);
const bar1After = await rectOf('actionbar');
const frameAfter = await rectOf('player-frame');
check(
  'adding bar 2 to the moved group: bar 1 fixed, frame glued on top rides up',
  Math.abs(bar1After.top - bar1Before.top) < 2 && frameAfter.top < frameBefore.top - 20,
  { bar1: [bar1Before.top, bar1After.top], frame: [frameBefore.top, frameAfter.top] },
);
await page.screenshot({ path: 'tmp/player_frame_lock.png' });

// 5) Lock off: the frame leaves the group and returns to the stack (it never
// had a dragged spot of its own in this run).
await setLock(false);
await sleep(300);
const off = await page.evaluate(() => ({
  parent: document.getElementById('player-frame').parentElement.id,
}));
check('lock off: frame returns home', off.parent === 'actionbar-stack', off);

await browser.close();
process.exit(fail > 0 ? 1 : 0);
