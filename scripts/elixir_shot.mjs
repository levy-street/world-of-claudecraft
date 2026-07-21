// Screenshots for the Battle Elixir (Elixir of the Bear) content addition.
// Runs the offline flow (no server/Postgres) on a desktop viewport.
// Needs `npm run dev` running. Writes PNGs to tmp/.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const CLASS = process.env.GAME_CLASS ?? 'warrior';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });

const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('CONSOLE: ' + m.text());
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Crop a screenshot to an element's bounding box (+ padding), clamped to the viewport.
const cropTo = async (sel, path, pad = 16) => {
  const box = await page.evaluate(
    (s, p) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const x = Math.max(0, r.left - p),
        y = Math.max(0, r.top - p);
      return {
        x,
        y,
        width: Math.min(1280 - x, r.width + p * 2),
        height: Math.min(720 - y, r.height + p * 2),
      };
    },
    sel,
    pad,
  );
  if (box && box.width > 4 && box.height > 4) await page.screenshot({ path, clip: box });
};

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline')?.click());
await wait(200);
await page.evaluate(() => {
  const n = document.querySelector('#char-name');
  if (n) {
    n.value = 'Thorgar';
    n.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
await page.evaluate(
  (c) => document.querySelector(`#offline-select .mini-class[data-class="${c}"]`)?.click(),
  CLASS,
);
await page.evaluate(() => document.querySelector('#btn-start-offline')?.click());
await wait(3000);

// Stay alive for the camera, and stock a few elixirs.
await page.evaluate(() => {
  const p = window.__game.sim.player;
  p.maxHp = 99999;
  p.hp = 99999;
  window.__game.sim.addItem('elixir_of_the_bear', 5);
});
await wait(300);

// Dispatch hover events in-page (the menus fail puppeteer's clickable-point check).
const hoverInPage = (sel, pick) =>
  page.evaluate(
    (s, p) => {
      const els = [...document.querySelectorAll(s)];
      const el = p ? (els.find((e) => new RegExp(p, 'i').test(e.textContent)) ?? els[0]) : els[0];
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2,
        y = r.top + r.height / 2;
      for (const type of ['mouseover', 'mouseenter', 'mousemove']) {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
      }
      return true;
    },
    sel,
    pick ?? null,
  );

// 1) Open bags and hover the elixir to show its tooltip (name + "Elixir" kind).
await page.evaluate(() => window.__game.hud.toggleBags());
await wait(500);
await hoverInPage('#bags .bag-item', 'Elixir of the Bear');
await wait(400);
await page.screenshot({ path: 'tmp/elixir_tooltip.png' });
await cropTo('#tooltip', 'tmp/elixir_tooltip_crop.png', 12);

// 2) Use the elixir; capture the buff bar with the "Might of the Bear" buff.
await page.evaluate(() => window.__game.hud.toggleBags());
await wait(200);
await page.evaluate(() => window.__game.sim.useItem('elixir_of_the_bear'));
await wait(600);
await hoverInPage('#buff-bar > div');
await wait(400);
await page.screenshot({ path: 'tmp/elixir_buff.png' });
await cropTo('#tooltip', 'tmp/elixir_buff_crop.png', 12);

// 3) Full-frame shot for context.
await page.screenshot({ path: 'tmp/elixir_scene.png' });

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'OK: no page errors');
await browser.close();
