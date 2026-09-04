// Visual proof for the PR #3668 follow-up (player feedback): short-timed buffs get
// display priority over long ones when the LOW graphics preset's buff cap must shed
// something, and Stormsurge Ready now renders as a debuff (red border, debuff bar)
// instead of a buff. Needs `npm run dev` already running. Screenshots land in tmp/.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT_PREFIX = process.env.OUT_PREFIX ?? 'tmp/priority';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--window-size=1600,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
  ],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

// Standing capture rule: seed the LOWEST graphics preset before the app boots (the
// preset whose aura cap this shot is specifically about).
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
  } catch {
    // ignore
  }
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 45000 });
await enterOfflineGame(page, { charClass: 'shaman', charName: 'Stormcaller' });
await page.evaluate(() => document.querySelector('.tut-skip')?.click());
await sleep(300);

async function screenshotSelector(selector, path, pad = { x: 20, top: 10, bottom: 30 }) {
  const box = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, selector);
  if (!box) {
    console.log(`MISSING selector for screenshot: ${selector}`);
    return;
  }
  await page.screenshot({
    path,
    clip: {
      x: Math.max(0, box.x - pad.x),
      y: Math.max(0, box.y - pad.top),
      width: box.width + pad.x * 2,
      height: Math.max(box.height, 40) + pad.top + pad.bottom,
    },
  });
}

// --- Scenario 1: short-buff priority under the low-tier cap -----------------
// 8 long (1800s) raid buffs applied FIRST, then a 6s active-mitigation buff
// (Raised Guard's own DR aura) applied LAST. Before this fix, a flat first-N
// cap sheds whichever buff is last in application order -- the short,
// timing-critical one. After, a long buff sheds in its place.
const staged = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const me = sim.entities.get(g.world.playerId);
  const LONG_BUFFS = [
    ['buff_ap', 'Battle Shout'],
    ['buff_armor', 'Thorns'],
    ['buff_int', 'Arcane Intellect'],
    ['buff_spellpower', 'Blessing of Kings'],
    ['buff_haste', 'Trueshot Aura'],
    ['buff_dodge', 'Fortitude'],
    ['buff_healing_done', 'Blessing of Wisdom'],
    ['buff_agi', 'Mark of the Wild'],
  ];
  for (const [kind, name] of LONG_BUFFS) {
    me.auras.push({
      id: `test_${name.toLowerCase().replace(/[^a-z]+/g, '_')}`,
      name,
      kind,
      remaining: 1800,
      duration: 1800,
      value: 10,
      sourceId: me.id,
      school: 'physical',
    });
  }
  me.auras.push({
    id: 'raised_guard_dr',
    name: 'Raised Guard',
    kind: 'buff_dr_phys',
    remaining: 6,
    duration: 6,
    value: 0.5,
    sourceId: me.id,
    school: 'physical',
  });
  return { fxLevel: document.documentElement.dataset.fxLevel, count: me.auras.length };
});
console.log('staged (priority scenario)', staged);
await sleep(200);
await page.screenshot({ path: `${OUT_PREFIX}-full.png` });
await screenshotSelector('#buff-bar', `${OUT_PREFIX}-crop.png`);

// Identity read from the visible countdown text (.dur), not a native `title`
// (the pooled nodes use the custom attachTooltip hover system instead): Raised
// Guard is the only single-digit-second buff staged (6s, ticking down), every
// raid buff reads 30m.
const priorityCheck = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('#buff-bar .buff:not(.buff-overflow)')];
  return {
    renderedCount: nodes.length,
    hasRaisedGuard: nodes.some((n) => /^[1-6]s$/.test(n.querySelector('.dur')?.textContent ?? '')),
  };
});
console.log('priorityCheck', priorityCheck);

// --- Scenario 2: Stormsurge Ready renders as a debuff -----------------------
// Clear the staged buffs, then stage Stormsurge Ready alone: it should now
// live in #debuff-bar (red border) instead of #buff-bar.
const stormsurgeStaged = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const me = sim.entities.get(g.world.playerId);
  me.auras.length = 0;
  me.auras.push({
    id: 'shaman_stormsurge_ready',
    name: 'Stormsurge',
    kind: 'internal_cd',
    remaining: 6,
    duration: 6,
    value: 1,
    sourceId: me.id,
    school: 'nature',
  });
  return { auraCount: me.auras.length, auraKind: me.auras[0]?.kind };
});
console.log('stormsurgeStaged', stormsurgeStaged);
await sleep(600);
// #debuff-bar alone: with #buff-bar now empty (0 children, a collapsed rect),
// unioning the two boxes swept in unrelated overlapping UI. #debuff-bar sits
// directly below #buff-bar (index.html), so a fixed downward pad keeps both
// bars in frame without relying on the empty one's rect.
await screenshotSelector('#debuff-bar', `${OUT_PREFIX}-stormsurge-crop.png`, {
  x: 20,
  top: 50,
  bottom: 20,
});
// Also capture #buff-bar: before the fix Stormsurge Ready renders there
// instead (a buff, not a debuff); after the fix it is empty.
await screenshotSelector('#buff-bar', `${OUT_PREFIX}-stormsurge-buffbar-crop.png`, {
  x: 20,
  top: 10,
  bottom: 30,
});

// The pooled aura nodes use the custom attachTooltip hover system, not a native
// `title` attribute (auras_painter.ts), so identity is read from node COUNT
// (only Stormsurge Ready is staged, so each bar's real content is unambiguous)
// and the `debuff` class the painter toggles per frame.
const stormsurgeCheck = await page.evaluate(() => {
  const buffNodes = [...document.querySelectorAll('#buff-bar .buff:not(.buff-overflow)')];
  const debuffNodes = [...document.querySelectorAll('#debuff-bar .buff')];
  return {
    buffBarCount: buffNodes.length,
    debuffBarCount: debuffNodes.length,
    debuffBarNodeIsDebuffClassed: debuffNodes[0]?.classList.contains('debuff') ?? false,
  };
});
console.log('stormsurgeCheck', stormsurgeCheck);

// --- Scenario 3: the new "Always Show All Buffs" interface setting ----------
// Mirrors scripts/pr_shot_targets.mjs's 'interface-options-tabs' target: the
// main options menu's 4th button (offline: Key Bindings, Controller,
// Graphics, Interface, ...) opens Interface, defaulting to its 'general' tab;
// INTERFACE_TAB_ORDER = ['general', 'frames', 'chat', 'combat'] puts Frames
// at .opt-tab index 1.
await page.evaluate(() => {
  const g = window.__game;
  g.sim.entities.get(g.world.playerId).auras.length = 0;
  // Dismiss a tutorial NPC greeting if one popped (e.g. the Ferryman Odo
  // arrival note), so it does not overlap the options panel in the shot.
  document
    .querySelector('#tutorial-greeting [data-close], #tutorial-greeting [data-skip]')
    ?.click();
});
await sleep(200);
const framesTabClicked = await page.evaluate(() => {
  const hud = window.__game?.hud;
  if (!hud) return false;
  const win = document.querySelector('#options-menu');
  if (win && getComputedStyle(win).display !== 'none') hud.toggleOptionsMenu();
  hud.toggleOptionsMenu();
  const buttons = Array.from(document.querySelectorAll('#options-menu .opt-btn'));
  buttons[3]?.click();
  const framesTab = document.querySelectorAll('#options-menu .opt-tab')[1];
  framesTab?.click();
  return !!framesTab;
});
console.log('framesTabClicked', framesTabClicked);
await sleep(300);
// Scroll the new row into view so the crop centers on it (settingBoolToggle
// stamps the toggle button with data-setting-key, options_window.ts).
await page.evaluate(() => {
  document
    .querySelector('#options-menu [data-setting-key="alwaysShowAllBuffs"]')
    ?.closest('.set-row')
    ?.scrollIntoView({ block: 'center' });
});
await sleep(150);
await screenshotSelector('#options-menu', `${OUT_PREFIX}-settings-full.png`, {
  x: 20,
  top: 20,
  bottom: 20,
});

await browser.close();
