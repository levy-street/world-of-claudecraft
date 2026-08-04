// Phase 3 visual proof: raw fishing catches as cooking reagents.
// Needs `npm run dev` on :5173 (or GAME_URL).
// Captures (desktop):
//   1) raw Mirror Trout tooltip (Material + cooking-ingredient line)
//   2) cooked Pan-Seared River Perch tooltip (food, sit-heal)
//   3) bags Materials chip with fish icons
//
//   node scripts/raw_fish_cooking_shots.mjs
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

// gfx=low under SwiftShader: ultra can take longer than the boot wait and leave
// __game unset; low is enough for bag/tooltip chrome proof.
const URL = (process.env.GAME_URL ?? 'http://localhost:5173') + '/?gfx=low';
const OUT_DIR = process.env.SHOTS_DIR ?? 'docs/screenshots/raw-fish-cooking-reagents';
fs.mkdirSync(OUT_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE:', m.text());
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
// Prefer the shared entry helper; fall back to a non-visible class-card wait if
// icon paint leaves cards at 0x0 under headless SwiftShader.
let booted = await enterOfflineGame(page, {
  charClass: 'warrior',
  charName: 'Anglerwyn',
  settleMs: 2000,
  gameBootTimeoutMs: 60000,
  selectorTimeoutMs: 45000,
}).catch((err) => {
  console.log('enterOfflineGame threw:', err.message);
  return false;
});
if (!booted) {
  console.log('retrying manual offline entry...');
  await page.evaluate(() => document.querySelector('#btn-offline')?.click());
  await page.waitForFunction(
    () => document.querySelectorAll('#offline-select .mini-class').length >= 9,
    { timeout: 30000 },
  );
  await page.evaluate(() => {
    const n = document.querySelector('#char-name');
    if (n) {
      n.value = 'Anglerwyn';
      n.dispatchEvent(new Event('input', { bubbles: true }));
    }
    document.querySelector('#offline-select .mini-class[data-class="warrior"]')?.click();
    document.querySelector('#btn-start-offline')?.click();
  });
  booted = await page
    .waitForFunction(() => window.__game?.sim?.player, { timeout: 60000 })
    .then(() => true)
    .catch(() => false);
  await sleep(2000);
}
if (!booted) {
  console.error('world did not boot');
  await browser.close();
  process.exit(1);
}

await page.evaluate(() => {
  document.querySelector('#gpu-notice')?.remove();
  document.querySelector('.camera-prompt-confirm')?.click();
  const banner = document.querySelector('#banner');
  if (banner) banner.style.opacity = '0';
  const sim = window.__game?.sim;
  // Clear noise so Materials chip and tooltips read cleanly.
  const inv = sim?.inventory;
  if (Array.isArray(inv)) inv.length = 0;
  sim?.addItem?.('raw_mirror_trout', 4);
  sim?.addItem?.('raw_river_perch', 3);
  sim?.addItem?.('raw_marsh_pike', 2);
  sim?.addItem?.('pan_seared_perch', 2);
  sim?.addItem?.('game_meat', 3);
  sim?.addItem?.('copper_ore', 2);
  const el = document.querySelector('#bags');
  if (el) el.style.display = 'none';
  window.__game?.hud?.toggleBags?.();
});
await sleep(600);

async function focusBagByLabel(fragment) {
  await page.mouse.move(10, 10);
  await sleep(80);
  const found = await page.evaluate((frag) => {
    const cell = Array.from(document.querySelectorAll('#bags button')).find((b) =>
      b.getAttribute('aria-label')?.includes(frag),
    );
    if (!cell) return false;
    cell.scrollIntoView({ block: 'center' });
    cell.focus();
    const r = cell.getBoundingClientRect();
    for (const type of ['mouseenter', 'mouseover', 'mousemove']) {
      cell.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          clientX: r.x + r.width / 2,
          clientY: r.y + r.height / 2,
        }),
      );
    }
    return true;
  }, fragment);
  if (!found) throw new Error(`bag cell not found for: ${fragment}`);
  await page.waitForFunction(
    () => {
      const tt = document.querySelector('#tooltip');
      if (!tt) return false;
      const style = window.getComputedStyle(tt);
      return style.display !== 'none' && tt.getBoundingClientRect().width > 20;
    },
    { timeout: 5000 },
  );
  await sleep(250);
  return page.evaluate(() => {
    const tt = document.querySelector('#tooltip');
    return (tt?.innerText || '').replace(/\s+/g, ' ').trim();
  });
}

async function shotFrame(name) {
  const dest = path.join(OUT_DIR, name);
  await page.screenshot({ path: dest, type: 'png' });
  console.log('wrote', dest);
}

// 1) Raw Mirror Trout tooltip
const troutTip = await focusBagByLabel('Mirror Trout');
console.log('trout tip:', troutTip);
await shotFrame('raw-mirror-trout-tooltip-desktop.png');

// 2) Cooked Pan-Seared River Perch tooltip
const perchTip = await focusBagByLabel('Pan-Seared');
console.log('perch tip:', perchTip);
await shotFrame('cooked-pan-seared-perch-tooltip-desktop.png');

// Clear hover, then Materials chip with fish.
await page.mouse.move(10, 10);
await sleep(100);
await page.evaluate(() => {
  const chips = [...document.querySelectorAll('#bags .bag-chip')];
  const materials = chips.find((c) => /material/i.test(c.textContent || ''));
  if (!materials) throw new Error('Materials chip not found');
  materials.click();
});
await sleep(400);
const materialsReport = await page.evaluate(() => {
  const chips = [...document.querySelectorAll('#bags .bag-chip')].map((c) =>
    (c.textContent || '').trim(),
  );
  const rows = [...document.querySelectorAll('#bags .bag-item, #bags button')].map((r) =>
    (r.getAttribute('aria-label') || r.textContent || '').trim(),
  );
  return { chips, rows: rows.filter(Boolean).slice(0, 20) };
});
console.log('materials chip report:', JSON.stringify(materialsReport));
await shotFrame('bags-materials-chip-fish-desktop.png');

// Sanity: tooltip copy claims we care about
if (!/cooking ingredient|material/i.test(troutTip)) {
  console.warn('WARN: raw trout tooltip missing Material/cooking copy:', troutTip);
}
if (!/restor|health|food|eat/i.test(perchTip)) {
  console.warn('WARN: cooked perch tooltip missing food heal copy:', perchTip);
}

await browser.close();
console.log('done');
