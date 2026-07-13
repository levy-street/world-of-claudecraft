// Inventory 2.0 icon sheet: drops all 11 new items into the bags and screenshots
// the grid so the new procedural helm/belt/pauldron/gauntlet icons are visible.
// Needs `npm run dev`. Writes tmp/inv2_icons.png.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 860 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tap = (s) => page.evaluate((x) => document.querySelector(x)?.click(), s);

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await tap('#btn-offline');
await wait(200);
await page.evaluate(() => {
  const n = document.querySelector('#char-name');
  if (n) {
    n.value = 'Smith';
    n.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
await tap('#offline-select .mini-class[data-class="warrior"]');
await tap('#btn-start-offline');
await wait(3000);

await page.evaluate(() => {
  const sim = window.__game.sim;
  const pid = sim.player.id;
  sim.player.maxHp = 99999;
  sim.player.hp = 99999;
  const items = [
    'cryptbone_helm',
    'cryptbone_pauldrons',
    'mistveil_cord',
    'mistveil_grips',
    'boundstone_helm',
    'boundstone_girdle',
    'gravewyrm_mantle',
    'gravewyrm_gauntlets',
    'deathlords_dread_visage',
    'necromancers_soulspire_mantle',
    'wyrmshadow_talongrips',
  ];
  for (const id of items) sim.addItem(id, 1, pid);
});
await wait(200);
await page.evaluate(() => window.__game.hud.toggleBags());
await wait(700);
const box = await page.evaluate(() => {
  const el = document.querySelector('#bags');
  if (!el || el.style.display === 'none') return null;
  const r = el.getBoundingClientRect();
  if (r.width < 2) return null;
  return {
    x: Math.round(r.x),
    y: Math.round(r.y),
    width: Math.round(r.width),
    height: Math.round(r.height),
  };
});
await page.screenshot(
  box ? { path: 'tmp/inv2_icons.png', clip: box } : { path: 'tmp/inv2_icons.png' },
);
console.log('wrote tmp/inv2_icons.png');
await browser.close();
