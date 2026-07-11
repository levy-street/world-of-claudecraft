// Screenshots for the in-game language switcher (Options > Interface).
// Enters the offline world, opens the Esc menu, navigates to Interface, captures the
// new Language picker, then switches to Spanish to prove the live in-game relocalization.

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
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('CONSOLE: ' + m.text());
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(300);
await page.type('#char-name', 'Thorgar');
await page.evaluate(() =>
  document.querySelector('#offline-select .mini-class[data-class="warrior"]').click(),
);
await sleep(200);
await page.evaluate(() => document.querySelector('#btn-start-offline').click());
await sleep(3500);

// Open the Esc game menu, then the Interface settings category.
async function openInterface() {
  await page.evaluate(() => document.querySelector('#mm-options').click());
  await sleep(300);
  // The redesigned menu is a category rail; the Interface tab carries a stable
  // data-category id, so no localized-label matching is needed.
  const clicked = await page.evaluate(() => {
    const target = document.querySelector('#options-menu .opt-tab[data-category="interface"]');
    if (target) {
      target.click();
      return true;
    }
    return false;
  });
  await sleep(400);
  return clicked;
}

await openInterface();
await page.screenshot({ path: 'tmp/lang_interface_en.png' });

// Close-up of the options panel (English).
const box = await page.evaluate(() => {
  const el = document.querySelector('#options-menu');
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
await page.screenshot({
  path: 'tmp/lang_picker_en.png',
  clip: { x: box.x, y: box.y, width: box.w, height: box.h },
});

// Switch to Spanish via the picker. The Language control is the shared custom
// dropdown (.ui-dd), not a native <select>: open the trigger, then click the
// Spanish option (its data-val carries the locale id).
await page.evaluate(() => {
  document.querySelector('#options-menu .set-lang-select .ui-dd-btn')?.click();
});
await sleep(200);
await page.evaluate(() => {
  document.querySelector('#options-menu .set-lang-select .ui-dd-item[data-val="es"]')?.click();
});
await sleep(800);
await page.screenshot({ path: 'tmp/lang_interface_es.png' });
const box2 = await page.evaluate(() => {
  const el = document.querySelector('#options-menu');
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
await page.screenshot({
  path: 'tmp/lang_picker_es.png',
  clip: { x: box2.x, y: box2.y, width: box2.w, height: box2.h },
});

const labels = await page.evaluate(() => {
  const names = [...document.querySelectorAll('#options-menu .opt-row-label')].map(
    (n) => n.textContent,
  );
  const sel = document.querySelector('#options-menu .set-lang-select');
  return {
    firstRow: names[0],
    selectValue: sel?.dataset.value,
    title: document.querySelector('#options-menu .window-title')?.textContent,
  };
});
console.log('after switch:', JSON.stringify(labels));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console/page errors');
await browser.close();
