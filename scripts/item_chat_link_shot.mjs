// Screenshot harness for shift-click-to-link-an-item-in-chat.
// Boots the offline world, gives the player a few items, opens the bags, shift-clicks
// an item (inserting a readable [Name] into the chat input), then sends it and captures
// the rendered, quality-colored chat item link plus its inspect tooltip on hover.
// Needs a dev server (default :5173, override GAME_URL). Renders at ?gfx=ultra.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = `${process.env.GAME_URL ?? 'http://localhost:5173'}/?gfx=ultra`;
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--window-size=1600,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-background-timer-throttling',
  ],
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE:', m.text());
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#btn-offline', { timeout: 60000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(300);
await page.type('#char-name', 'Sortwyn');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await page.waitForFunction(() => window.__game?.hud, { timeout: 60000 });
await sleep(2500);

// A couple of quality-varied items so the link color is visible.
await page.evaluate(() => {
  const sim = window.__game.sim;
  for (const id of ['eastbrook_arming_sword', 'minor_healing_potion', 'cryptbone_helm'])
    sim.addItem(id, 1);
});

// Open the bags, then shift-click the first item to insert a [Name] chat link.
await page.evaluate(() => {
  const el = document.querySelector('#bags');
  el.style.display = 'none';
  window.__game.hud.toggleBags();
});
await sleep(500);
await page.evaluate(() => {
  // The 3rd bag row is the uncommon (green) Cryptbone Helm: a colored link reads best.
  const rows = document.querySelectorAll('#bags .bag-item');
  const row = rows[2] ?? rows[0];
  row.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
});
await sleep(300);
await page.screenshot({ path: 'tmp/item-link-1-insert.png' });

// Send what is in the chat input: composeChatSend swaps [Name] -> [[i:id]] token.
await page.evaluate(() => {
  const hud = window.__game.hud;
  const input = document.querySelector('#chat-input');
  window.__game.sim.chat(hud.composeChatSend(input.value));
  input.value = '';
});
await sleep(400);
await page.screenshot({ path: 'tmp/item-link-2-rendered.png' });

// Hover the rendered link to surface the inspect tooltip. Drive real mouse events at
// the link center so attachTooltip's mouseenter + mousemove position it deterministically.
await page.evaluate(() => {
  const el = document.querySelector('.chat-item-link');
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const opts = { bubbles: true, clientX: x, clientY: y };
  el.dispatchEvent(new MouseEvent('mouseenter', opts));
  el.dispatchEvent(new MouseEvent('mousemove', opts));
});
await sleep(400);
await page.screenshot({ path: 'tmp/item-link-3-tooltip.png' });

const report = await page.evaluate(() => ({
  inputAfterShiftClick: document.querySelector('#chat-input')?.value ?? null,
  linkText: document.querySelector('.chat-item-link')?.textContent ?? null,
  linkColor: document.querySelector('.chat-item-link')?.style.color ?? null,
  tooltipShown: !!document.querySelector('.tooltip, #tooltip, .tt'),
}));
console.log('REPORT', JSON.stringify(report));
fs.writeFileSync('tmp/item-link-report.json', JSON.stringify(report, null, 2));

await browser.close();
