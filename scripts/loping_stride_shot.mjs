// Visual proof for the Loping Stride fix: a talented druid shifts into Bear Form
// and the buff tooltip on the aura bar reads the real +60% (before the fix the
// buff_speed value was the bare 0.6 fraction, which the multiplier discarded
// and the tooltip rendered as 40%). Needs `npm run dev` already running.
// Logs the resolved aura value and the in-sim move multiplier alongside.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT_PREFIX = process.env.OUT_PREFIX ?? 'tmp/loping-stride';
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

// Standing capture rule: seed the LOWEST graphics preset before the app boots.
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
  } catch {
    // ignore
  }
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 45000 });
await enterOfflineGame(page, { charClass: 'druid', charName: 'Loper' });
await page.evaluate(() => {
  document.querySelector('.camera-prompt-confirm')?.click();
  document.querySelector('.tut-skip')?.click();
  document
    .querySelector('#tutorial-greeting [data-close], #tutorial-greeting [data-skip]')
    ?.click();
});
await page.evaluate(() => {
  for (const b of document.querySelectorAll('button'))
    if (b.textContent?.trim() === 'Dismiss') b.click();
});
await sleep(400);

const staged = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  sim.setPlayerLevel?.(20);
  const ok = sim.applyTalents({ spec: 'feral', rows: { 5: 'dru_r5_ferocity' } });
  const me = sim.entities.get(g.world.playerId);
  me.auras.length = 0;
  me.resource = me.maxResource;
  sim.castAbility('bear_form');
  const stride = me.auras.find((a) => a.id === 'loping_stride');
  return {
    talentApplied: ok,
    strideValue: stride?.value ?? null,
    forms: me.auras.map((a) => a.id),
  };
});
console.log('staged', staged);
await sleep(500);

// Hover the Loping Stride node on the buff bar (pooled attachTooltip nodes).
const point = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('#buff-bar .buff:not(.buff-overflow)')];
  const node =
    nodes.find((n) => n.getAttribute('data-aura-id') === 'loping_stride') ??
    nodes.find(
      (n) =>
        !/^\d+m$/.test(n.querySelector('.dur')?.textContent ?? '') &&
        /^[1-3]s$/.test(n.querySelector('.dur')?.textContent ?? ''),
    );
  if (!node) return null;
  const r = node.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
console.log('hoverPoint', point);
if (!point) throw new Error('Loping Stride buff node not found on #buff-bar');
await page.mouse.move(point.x, point.y);
await sleep(350);
const tip = await page.evaluate(() => {
  const t = document.querySelector('#tooltip');
  return { shown: !!t && getComputedStyle(t).display !== 'none', text: t?.textContent ?? '' };
});
console.log('tooltip', tip);

const clip = await page.evaluate(() => {
  const bar = document.querySelector('#buff-bar')?.getBoundingClientRect();
  const t = document.querySelector('#tooltip')?.getBoundingClientRect();
  const x0 = Math.min(bar.x, t?.x ?? bar.x) - 30;
  const y0 = Math.min(bar.y, t?.y ?? bar.y) - 20;
  const x1 = Math.max(bar.right, t?.right ?? bar.right) + 30;
  const y1 = Math.max(bar.bottom, t?.bottom ?? bar.bottom) + 30;
  return {
    x: Math.max(0, x0),
    y: Math.max(0, y0),
    width: x1 - Math.max(0, x0),
    height: y1 - Math.max(0, y0),
  };
});
// The sprint lasts 3s: shoot the crop first, the full frame after.
await page.screenshot({ path: `${OUT_PREFIX}-crop.png`, clip });
await page.screenshot({ path: `${OUT_PREFIX}-full.png` });
console.log('wrote', `${OUT_PREFIX}-crop.png`);
await browser.close();
