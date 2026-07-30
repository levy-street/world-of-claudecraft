// Visual capture for the buff/debuff split: buffs render to #buff-bar (top row),
// debuffs to #debuff-bar (the row beneath). Boots the offline game, stamps a mix
// of helpful and harmful auras onto the player (fresh chars can't cast them all),
// and screenshots the two rows together. Needs `npm run dev` on :5173.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.bringToFront();
// JS-click through any landing overlay (geometry-based clicks can miss when the
// button is briefly covered by a fading intro layer).
const jsClick = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
await page.waitForSelector('#btn-offline', { timeout: 30000 });
await jsClick('#btn-offline');
await sleep(400);
await page.type('#char-name', 'Mixer');
await jsClick('#offline-select .mini-class[data-class="warrior"]');
await jsClick('#btn-start-offline');
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 40000 });
await sleep(1500);

// Stamp a realistic mix: helpful buffs and harmful debuffs (incl. a negative-value
// stat buff that classifies as a debuff). Data only, no eval.
await page.evaluate(() => {
  const p = window.__game.sim.player;
  const mk = (id, name, kind, value = 0, remaining = 30) => ({
    id,
    name,
    kind,
    remaining,
    duration: remaining,
    value,
    sourceId: 0,
    school: 'physical',
  });
  p.auras = [
    // buffs (top row)
    mk('battle_shout', 'Battle Shout', 'buff_ap', 50, 120),
    mk('mark_of_the_wild', 'Mark of the Wild', 'buff_allstats', 12, 600),
    mk('thorns', 'Thorns', 'thorns', 18, 300),
    mk('renew', 'Renew', 'hot', 40, 15),
    // debuffs (second row)
    mk('deep_wounds', 'Gaping Wounds', 'dot', 22, 6),
    mk('hamstring', 'Hamstring', 'slow', 0.5, 12),
    mk('silence', 'Silenced', 'silence', 0, 4),
    mk('sapped_might', 'Sapped Might', 'buff_ap', -40, 8),
  ];
});
await sleep(600);

// Clip a screenshot to the union of the buff + debuff rows.
const b = await page.evaluate(() => {
  const buff = document.querySelector('#buff-bar').getBoundingClientRect();
  const debuff = document.querySelector('#debuff-bar').getBoundingClientRect();
  const x = Math.min(buff.x, debuff.x);
  const y = Math.min(buff.y, debuff.y);
  const right = Math.max(buff.right, debuff.right);
  const bottom = Math.max(buff.bottom, debuff.bottom);
  return { x, y, w: right - x, h: bottom - y };
});
const pad = 16;
await page.screenshot({
  path: 'tmp/debuff_separation.png',
  clip: {
    x: Math.max(0, b.x - pad),
    y: Math.max(0, b.y - pad),
    width: b.w + pad * 2,
    height: b.h + pad * 2,
  },
});
console.log('captured tmp/debuff_separation.png');

await browser.close();
