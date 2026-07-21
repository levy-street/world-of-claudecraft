// In-app verification + screenshot for the Haste 3-set bonus PR. Boots the offline
// client, levels a mage, reads its Frostbolt tooltip cast time, then equips the
// 3-piece "Vale Arcanist's Regalia" caster set and shows the cast time drop (the
// tooltip and the real cast both shorten by the 15% spell haste). Needs `npm run
// dev`. Writes PNGs to tmp/.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });

await page
  .goto(URL, { waitUntil: 'load', timeout: 60000 })
  .catch((e) => console.log('goto:', e.message));
await page.waitForSelector('#btn-offline', { timeout: 40000 });
await wait(300);
await page.evaluate(() => document.querySelector('#btn-offline')?.click());
await page.waitForSelector('#offline-select [data-class="mage"]', { timeout: 15000 });
await page.evaluate(() => {
  const n = document.querySelector('#char-name');
  if (n) {
    n.value = 'Jaina';
    n.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
await page.evaluate(() => document.querySelector('#offline-select [data-class="mage"]')?.click());
await wait(200);
await page.evaluate(() => document.querySelector('#btn-start-offline')?.click());
for (let i = 0; i < 40; i++) {
  if (await page.evaluate(() => !!(window.__game && window.__game.sim))) break;
  await wait(500);
}
await page.evaluate(() => {
  for (const b of document.querySelectorAll('button'))
    if (/skip tutorial/i.test(b.textContent || '')) b.click();
});
await page.evaluate(() => window.__game.sim.setPlayerLevel(20));
await wait(500);

// Equip the 3-piece caster set and report the haste + measured cast times.
const result = await page.evaluate(() => {
  const sim = window.__game.sim;
  const p = sim.player;
  const before = p.spellHaste;
  for (const id of ['acolytes_circlet', 'woven_robe', 'silk_sash']) {
    sim.addItem(id, 1, p.id);
    sim.equipItem(id, p.id);
  }
  const fb = sim.known.find((k) => k.def.id === 'frostbolt');
  return {
    spellHasteBefore: before,
    spellHasteAfter: p.spellHaste,
    baseCast: fb.castTime,
    hastedCast: fb.castTime / (1 + p.spellHaste),
  };
});

// Open the spellbook and hover Frostbolt to show the hasted cast time in the tooltip.
await page.evaluate(() => document.querySelector('#mm-spell')?.click());
await wait(500);
await page.evaluate(() => {
  const rows = [
    ...document.querySelectorAll(
      '#spellbook [draggable="true"], #spellbook .spell-row, #spellbook li',
    ),
  ];
  const row = rows.find((r) => /frostbolt/i.test(r.textContent || ''));
  if (row) {
    const rect = row.getBoundingClientRect();
    for (const type of ['mouseover', 'mouseenter', 'mousemove'])
      row.dispatchEvent(
        new MouseEvent(type, { bubbles: true, clientX: rect.left + 10, clientY: rect.top + 5 }),
      );
  }
});
await wait(300);
const tip = await page.evaluate(() => {
  const t = [...document.querySelectorAll('div')].find(
    (d) =>
      /sec cast/.test(d.textContent || '') &&
      /Frostbolt/i.test(d.textContent || '') &&
      d.offsetParent !== null,
  );
  return t ? t.textContent.replace(/\s+/g, ' ').trim().slice(0, 160) : 'NO TOOLTIP';
});
await page.screenshot({ path: 'tmp/haste-tooltip.png' });
// the floating tooltip is the visible box carrying the spell's description prose
const clip = await page.evaluate(() => {
  const t = [...document.querySelectorAll('div')]
    .filter((d) => {
      const x = d.textContent || '';
      return /Launches a bolt of frost/i.test(x) && /sec cast/i.test(x) && d.offsetParent !== null;
    })
    .sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height)[0];
  if (!t) return null;
  const r = t.getBoundingClientRect();
  return {
    x: Math.max(0, r.left - 8),
    y: Math.max(0, r.top - 8),
    width: Math.min(560, r.width + 16),
    height: r.height + 16,
  };
});
if (clip && clip.width > 20 && clip.height > 20)
  await page.screenshot({ path: 'tmp/haste-tooltip-crop.png', clip });
else console.log('no floating tooltip crop');

console.log('Haste verification:', JSON.stringify(result));
console.log('tooltip text:', tip);
await browser.close();
