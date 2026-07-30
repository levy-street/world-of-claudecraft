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

// Open the Esc game menu, then the Interface settings page.
async function openInterface() {
  await page.evaluate(() => document.querySelector('#mm-options').click());
  await sleep(300);
  // Click the "Interface" option (label localized; match by the panel button order is
  // brittle, so find the button whose handler routes to interface via its text).
  const clicked = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('#options-menu .opt-btn')];
    // Interface is the 3rd menu entry; click the one matching its current label.
    const target = btns.find((b) =>
      /Interface|Interfaz|Interfaccia|Benutzer|界面|인터페이스|インターフェース|Интерфейс/i.test(
        b.textContent || '',
      ),
    );
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

// Switch to Spanish via the picker and dispatch the change event.
await page.evaluate(() => {
  const sel = document.querySelector('#options-menu .set-lang-select');
  sel.value = 'es';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
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
  const names = [...document.querySelectorAll('#options-menu .set-name')].map((n) => n.textContent);
  const sel = document.querySelector('#options-menu .set-lang-select');
  return {
    firstRow: names[0],
    selectValue: sel?.value,
    title: document.querySelector('#options-menu .panel-title span')?.textContent,
  };
});
console.log('after switch:', JSON.stringify(labels));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console/page errors');
await browser.close();
