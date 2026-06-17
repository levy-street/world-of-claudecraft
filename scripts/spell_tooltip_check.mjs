// Verify the 6 dual-component ability tooltips now show the over-time number.
// Offline flow. Needs `npm run dev`. Writes tmp/tip_<ability>.png and logs text.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });
const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 860 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tap = (s) => page.evaluate((x) => document.querySelector(x)?.click(), s);

// [class, ability display name, key word the tooltip must now contain a number near]
const CASES = [
  ['druid', 'Regrowth', 'regrowth'],
  ['druid', 'Rake', 'rake'],
  ['druid', 'Moonfire', 'moonfire'],
  ['mage', 'Fireball', 'fireball'],
  ['shaman', 'Flame Shock', 'flame_shock'],
  ['warlock', 'Immolate', 'immolate'],
];

async function startAs(cls) {
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
  await tap('#btn-offline');
  await wait(200);
  await page.evaluate(() => {
    const n = document.querySelector('#char-name');
    if (n) { n.value = 'Tester'; n.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await tap(`#offline-select .mini-class[data-class="${cls}"]`);
  await tap('#btn-start-offline');
  await wait(2500);
  await page.evaluate(() => { window.__game.sim.setPlayerLevel(20); });
  await wait(300);
}

let lastClass = null;
for (const [cls, name, key] of CASES) {
  if (cls !== lastClass) { await startAs(cls); lastClass = cls; }
  await page.evaluate(() => window.__game.hud.toggleSpellbook());
  await wait(400);
  // Hover the spell row whose name matches.
  const ok = await page.evaluate((abilityName) => {
    const rows = [...document.querySelectorAll('#spellbook .spell-row')];
    const row = rows.find((r) => r.querySelector('.spell-name')?.textContent?.trim().startsWith(abilityName));
    if (!row) return false;
    row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    row.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    return true;
  }, name);
  await wait(400);
  const text = await page.evaluate(() => document.querySelector('#tooltip')?.innerText ?? '(no tooltip)');
  console.log(`\n[${cls}] ${name} (found row: ${ok}):\n${text}`);
  const box = await page.evaluate(() => {
    const el = document.querySelector('#tooltip');
    if (!el || el.style.display === 'none') return null;
    const r = el.getBoundingClientRect();
    return r.width > 2 ? { x: Math.max(0, r.x - 4), y: Math.max(0, r.y - 4), width: r.width + 8, height: r.height + 8 } : null;
  });
  if (box) await page.screenshot({ path: `tmp/tip_${key}.png`, clip: box });
  await page.evaluate(() => window.__game.hud.toggleSpellbook());
  await wait(150);
}
await browser.close();
