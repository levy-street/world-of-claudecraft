// Quartermaster's Consignment screenshots: the 10 new gear pieces in the bags,
// a warrior wearing the new helmet/shoulder/waist/gloves on the paperdoll, and
// the eight consignment listings on the Merchant's World Market.
// Offline flow (no server). Needs `npm run dev`. Writes PNGs to tmp/.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });

const ALL = [
  'roadwardens_helm',
  'wayfarers_hood',
  'acolytes_circlet',
  'reinforced_pauldrons',
  'embroidered_mantle',
  'sturdy_belt',
  'silk_sash',
  'roughspun_gloves',
  'gorraks_cleaver',
  'mossy_handwraps',
];
// warrior-equippable subset, one per new armor slot + the weapon
const WORN = {
  helmet: 'roadwardens_helm',
  shoulder: 'reinforced_pauldrons',
  waist: 'sturdy_belt',
  gloves: 'roughspun_gloves',
  mainhand: 'gorraks_cleaver',
};

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });

const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`);
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tap = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
const clip = async (sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: Math.max(0, Math.round(r.x)),
      y: Math.max(0, Math.round(r.y)),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  }, sel);

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await tap('#btn-offline');
await wait(200);
await page.evaluate(() => {
  const n = document.querySelector('#char-name');
  if (n) {
    n.value = 'Quartermaster';
    n.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
await tap('#offline-select .mini-class[data-class="warrior"]');
await tap('#btn-start-offline');
await wait(3000);

await page.evaluate(
  ({ ALL }) => {
    const sim = window.__game.sim;
    const pid = sim.player.id;
    sim.player.maxHp = 99999;
    sim.player.hp = 99999;
    for (const id of ALL) sim.addItem(id, 1, pid);
  },
  { ALL },
);
await wait(300);

// 1) Bags — all 12 new pieces with procedural icons + quality borders.
await page.evaluate(() => {
  const el = document.querySelector('#bags');
  window.__game.hud.renderBags?.();
  if (el) el.style.display = 'flex';
});
await wait(600);
let box = await clip('#bags');
if (box && box.width > 0) await page.screenshot({ path: 'tmp/quartermaster_bags.png', clip: box });
await page.screenshot({ path: 'tmp/quartermaster_bags_full.png' });
await page.evaluate(() => {
  const el = document.querySelector('#bags');
  if (el) el.style.display = 'none';
});
await wait(200);

// equip the warrior-wearable subset for the paperdoll shot
const result = await page.evaluate(
  ({ WORN }) => {
    const sim = window.__game.sim;
    const pid = sim.player.id;
    for (const id of Object.values(WORN)) sim.equipItem(id, pid);
    return { equipment: sim.equipment };
  },
  { WORN },
);
await wait(300);

// 2) Character paperdoll — new helmet/shoulder/waist/gloves + Gorrak's Cleaver.
await page.evaluate(() => window.__game.hud.toggleChar());
await wait(500);
box = await clip('#char-window');
if (box && box.width > 0)
  await page.screenshot({ path: 'tmp/quartermaster_character.png', clip: box });
await page.evaluate(() => window.__game.hud.toggleChar());
await wait(200);

// 3) World Market — the eight standing consignment listings. Stand the player
// on the Merchant so the proximity gate passes, then open + browse.
await page.evaluate(() => {
  const sim = window.__game.sim;
  const pid = sim.player.id;
  let m = null;
  for (const e of sim.entities.values()) if (e.templateId === 'the_merchant') m = e;
  if (m) {
    const p = sim.entities.get(pid);
    p.pos.x = m.pos.x + 1;
    p.pos.z = m.pos.z;
    p.prevPos = { ...p.pos };
  }
});
await wait(300);
await page.evaluate(() => window.__game.hud.openMarket());
await wait(800);
box = await clip('#market-window');
if (box && box.width > 0)
  await page.screenshot({ path: 'tmp/quartermaster_market.png', clip: box });
await page.screenshot({ path: 'tmp/quartermaster_market_full.png' });

console.log('equipment:', JSON.stringify(result.equipment));
if (errors.length) console.log(`PAGE ERRORS:\n${errors.join('\n')}`);
console.log('wrote tmp/quartermaster_{bags,character,market}.png');
await browser.close();
