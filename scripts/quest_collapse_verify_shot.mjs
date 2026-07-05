// Verifies the SHIPPED collapsible quest tracker end to end: boots the offline
// game, injects the reference-image quests straight into the live questLog, then
// drives the real header toggle (the delegated click handler in hud.ts) by BOTH
// mouse and keyboard, captures expanded + collapsed, and asserts the round-trip,
// the "Quests (N)" collapsed header, the persisted setting, and that keyboard
// activation keeps focus on the rebuilt header. Exits non-zero on any failed
// check so a regression cannot pass silently in CI.
// Output: tmp/qt_real_{expanded,collapsed}.png (+ _full).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, '..', 'tmp');
fs.mkdirSync(OUT, { recursive: true });
const CROP = { x: 1300, y: 250, width: 296, height: 320 };

const fails = [];
const check = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,1000', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 1000 },
});
const page = await browser.newPage();
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (e) => pageErrors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('CONSOLE: ' + m.text()); });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
await page.waitForSelector('#btn-offline', { timeout: 120000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await new Promise((r) => setTimeout(r, 250));
await page.type('#char-name', 'Adventurer');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await page.waitForFunction(() => window.__game && window.__game.hud && window.__game.world, { timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));

// Inject the reference-image quests directly into the live quest log (acceptQuest
// needs a nearby giver NPC; this bypasses that for a deterministic tracker).
const injected = await page.evaluate(() => {
  const ql = window.__game.world.questLog;
  ql.clear();
  ql.set('q_wolves', { questId: 'q_wolves', counts: [3], state: 'active' });
  ql.set('q_murlocs', { questId: 'q_murlocs', counts: [2], state: 'active' });
  ql.set('q_spiders', { questId: 'q_spiders', counts: [6, 4], state: 'ready' }); // complete
  ql.set('q_boars', { questId: 'q_boars', counts: [1], state: 'active' });
  ql.set('q_mine', { questId: 'q_mine', counts: [4], state: 'active' });
  return ql.size;
});
console.log('injected quests:', injected);

const headerText = () => page.evaluate(() => document.querySelector('#quest-tracker .qt-header')?.textContent?.trim());
const rowCount = () => page.evaluate(() => document.querySelector('#quest-tracker')?.querySelectorAll('.qt-title').length);
const headerFocused = () => page.evaluate(() => document.activeElement?.classList.contains('qt-header') === true);

// --- Expanded (default) ---
// Poll for the per-frame update() to paint the rows rather than sleeping a fixed
// delay: the rAF render loop can be throttled while the headless tab is unfocused.
const painted = await page.waitForFunction(
  () => document.querySelectorAll('#quest-tracker .qt-title').length === 5,
  { timeout: 8000 },
).then(() => true).catch(() => false);
const expandedRows = await rowCount();
console.log('expanded header:', await headerText(), '| quest rows:', expandedRows);
check(painted && expandedRows === 5, `expanded shows all 5 quests (got ${expandedRows})`);
await page.screenshot({ path: path.join(OUT, 'qt_real_expanded.png'), clip: CROP });
await page.screenshot({ path: path.join(OUT, 'qt_real_expanded_full.png') });

// --- Click the header -> collapsed (exercises the real delegated click handler) ---
await page.click('#quest-tracker .qt-header');
await new Promise((r) => setTimeout(r, 300));
const collapsedHeader = await headerText();
const collapsedRows = await rowCount();
console.log('collapsed header:', collapsedHeader, '| quest rows:', collapsedRows);
check(collapsedRows === 0, `collapse hides the quest rows (got ${collapsedRows})`);
check(/\(\s*5\s*\)/.test(collapsedHeader || ''), `collapsed header shows the (5) count (got "${collapsedHeader}")`);
await page.screenshot({ path: path.join(OUT, 'qt_real_collapsed.png'), clip: CROP });
await page.screenshot({ path: path.join(OUT, 'qt_real_collapsed_full.png') });

// --- Click again -> expands back (round-trip) ---
await page.click('#quest-tracker .qt-header');
await new Promise((r) => setTimeout(r, 300));
const reExpandedRows = await rowCount();
console.log('re-expanded quest rows:', reExpandedRows);
check(reExpandedRows === 5, `mouse re-expand restores all 5 quests (got ${reExpandedRows})`);

// --- Keyboard path: focus the header, toggle with Enter then Space ---
// The container's keydown handler activates the toggle and stops the event before
// the window-level keybinds (Enter=chat, Space=jump) hijack it, and the toggle
// refocuses the rebuilt header so keyboard users keep their place.
await page.focus('#quest-tracker .qt-header');
check(await headerFocused(), 'header receives keyboard focus (Tab target)');
await page.keyboard.press('Enter'); // collapse
await new Promise((r) => setTimeout(r, 300));
const kbCollapsedRows = await rowCount();
const kbFocusAfterCollapse = await headerFocused();
console.log('keyboard (Enter) collapsed rows:', kbCollapsedRows, '| header still focused:', kbFocusAfterCollapse);
check(kbCollapsedRows === 0, `Enter collapses the tracker (got ${kbCollapsedRows} rows)`);
check(kbFocusAfterCollapse, 'focus stays on the rebuilt header after keyboard collapse');

await page.keyboard.press('Space'); // expand
await new Promise((r) => setTimeout(r, 300));
const kbExpandedRows = await rowCount();
const kbFocusAfterExpand = await headerFocused();
console.log('keyboard (Space) re-expanded rows:', kbExpandedRows, '| header still focused:', kbFocusAfterExpand);
check(kbExpandedRows === 5, `Space re-expands the tracker (got ${kbExpandedRows} rows)`);
check(kbFocusAfterExpand, 'focus stays on the rebuilt header after keyboard expand');

// --- Verify persistence: the setting reflects the final (expanded) state ---
const persisted = await page.evaluate(() => window.__game.hud.optionsHooks.settings.get('questTrackerCollapsed'));
console.log('persisted questTrackerCollapsed (final, expanded):', persisted);
check(persisted === false, `setting persists and matches the final expanded state (got ${persisted})`);

await browser.close();

console.log('\n=== console / page errors ===');
if (pageErrors.length) { console.log(`${pageErrors.length} page error(s):`); pageErrors.slice(0, 10).forEach((e) => console.log('  ' + e)); }
if (consoleErrors.length) { console.log(`${consoleErrors.length} console error(s) (informational):`); consoleErrors.slice(0, 10).forEach((e) => console.log('  ' + e)); }
if (!pageErrors.length && !consoleErrors.length) console.log('none');
check(pageErrors.length === 0, `no uncaught page errors (got ${pageErrors.length})`);

console.log(fails.length === 0 ? '\nALL QUEST-TRACKER COLLAPSE CHECKS PASSED' : `\n${fails.length} CHECK(S) FAILED:\n - ` + fails.join('\n - '));
process.exit(fails.length === 0 ? 0 : 1);
