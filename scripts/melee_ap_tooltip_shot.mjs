// Screenshot of a warrior ability tooltip showing live Attack-Power-boosted
// damage. Boots the offline client, levels a warrior (so it has real melee
// Attack Power), opens the spellbook, and hovers Rend so its tooltip shows the
// (+N) Attack Power contribution folded into the bleed. Needs `npm run dev`.
// Writes PNGs to tmp/.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const ABILITY = process.env.ABILITY ?? 'Rend';
fs.mkdirSync('tmp', { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 });

await page
  .goto(URL, { waitUntil: 'load', timeout: 60000 })
  .catch((e) => console.log('goto:', e.message));
await page.waitForSelector('#btn-offline', { timeout: 40000 });
await wait(300);
await page.evaluate(() => document.querySelector('#btn-offline')?.click());
await page.waitForSelector('#offline-select [data-class="warrior"]', { timeout: 15000 });
await page.evaluate(() => {
  const n = document.querySelector('#char-name');
  if (n) {
    n.value = 'Garrosh';
    n.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
await page.evaluate(() =>
  document.querySelector('#offline-select [data-class="warrior"]')?.click(),
);
await wait(200);
await page.evaluate(() => document.querySelector('#btn-start-offline')?.click());
for (let i = 0; i < 40; i++) {
  if (await page.evaluate(() => !!window.__game?.sim)) break;
  await wait(500);
}
await page.evaluate(() => {
  for (const b of document.querySelectorAll('button'))
    if (/skip tutorial/i.test(b.textContent || '')) b.click();
});
await page.evaluate(() => window.__game.sim.setPlayerLevel(40));
await wait(500);

// Open the spellbook and hover the chosen ability row to surface its tooltip.
await page.evaluate(() => document.querySelector('#mm-spell')?.click());
await wait(500);
const hovered = await page.evaluate((name) => {
  const rows = [
    ...document.querySelectorAll(
      '#spellbook [draggable="true"], #spellbook .spell-row, #spellbook li, #spellbook .ability-row',
    ),
  ];
  const re = new RegExp(name, 'i');
  const row = rows.find((r) => re.test(r.textContent || ''));
  if (!row) return false;
  const rect = row.getBoundingClientRect();
  for (const type of ['mouseover', 'mouseenter', 'mousemove']) {
    row.dispatchEvent(
      new MouseEvent(type, { bubbles: true, clientX: rect.left + 10, clientY: rect.top + 5 }),
    );
  }
  return true;
}, ABILITY);
await wait(300);
const ap = await page.evaluate(() => window.__game.sim.player.attackPower);

await page.screenshot({ path: 'tmp/melee-ap-tooltip.png' });
// Cropped, legible shot of the spellbook panel where the selected ability's
// expanded description carries the damage line with its (+N) AP contribution.
const clip = await page.evaluate(() => {
  const t = document.querySelector('#spellbook');
  if (!t) return null;
  const r = t.getBoundingClientRect();
  return {
    x: Math.max(0, r.left - 6),
    y: Math.max(0, r.top - 6),
    width: r.width + 12,
    height: r.height + 12,
  };
}, ABILITY);
if (clip && clip.width > 20 && clip.height > 20) {
  await page.screenshot({ path: 'tmp/melee-ap-tooltip-crop.png', clip });
  console.log('cropped tooltip saved');
}
const tip = await page.evaluate((name) => {
  const re = new RegExp(name, 'i');
  const t = [...document.querySelectorAll('div')].find(
    (d) =>
      re.test(d.textContent || '') &&
      /damage/i.test(d.textContent || '') &&
      d.offsetParent !== null &&
      d.className.includes('tt'),
  );
  return t ? t.textContent.replace(/\s+/g, ' ').trim().slice(0, 240) : 'NO TOOLTIP';
}, ABILITY);
console.log(`hovered ${ABILITY} row:`, hovered, '| attackPower:', ap);
console.log('tooltip text:', tip);
await browser.close();
