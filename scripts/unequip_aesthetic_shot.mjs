// Unequip aesthetic pass screenshots: the corner × affordance revealed on a
// paperdoll slot, and the slot left empty after unequipping. Offline (no
// server). Needs `npm run dev`. Writes PNGs to tmp/.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

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
await page.setViewport({ width: 1280, height: 860 });

const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tap = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await tap('#btn-offline');
await wait(200);
await page.evaluate(() => {
  const n = document.querySelector('#char-name');
  if (n) { n.value = 'Ironbrand'; n.dispatchEvent(new Event('input', { bubbles: true })); }
});
await tap(`#offline-select .mini-class[data-class="${CLASS}"]`);
await tap('#btn-start-offline');
await page.waitForFunction(() => !!window.__game?.sim, { timeout: 20000 });
await wait(1500);

// Equip a full set so every slot is filled.
await page.evaluate(() => {
  const sim = window.__game.sim;
  const pid = sim.player.id;
  sim.player.maxHp = 99999; sim.player.hp = 99999;
  const set = {
    mainhand: 'worn_sword', helmet: 'cryptbone_helm', shoulder: 'gravewyrm_mantle',
    chest: 'recruit_tunic', waist: 'boundstone_girdle', legs: 'quilted_trousers',
    gloves: 'mistveil_grips', feet: 'oiled_boots',
  };
  for (const id of Object.values(set)) { sim.addItem(id, 1, pid); sim.equipItem(id, pid); }
});
await wait(300);

await page.evaluate(() => window.__game.hud.toggleChar());
await wait(500);

const charClip = async () => page.evaluate(() => {
  const el = document.querySelector('#char-window');
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
});

// BEFORE: hover the helmet slot so its corner × reveals.
const helmBox = await page.evaluate(() => {
  const slots = [...document.querySelectorAll('#char-window .equip-slot')];
  const helm = slots.find((s) => s.querySelector('.slot-item')?.textContent?.trim());
  if (!helm) return null;
  const r = helm.getBoundingClientRect();
  return { x: r.x + r.width - 24, y: r.y + r.height / 2 };
});
if (helmBox) { await page.mouse.move(helmBox.x, helmBox.y); await wait(300); }
await page.screenshot({ path: 'tmp/pr_unequip_before.png', clip: await charClip() });

// ACTION: unequip the first filled slot via the corner × button.
const armorBefore = await page.evaluate(() => window.__game.sim.player.stats.armor ?? null);
await page.evaluate(() => {
  const slots = [...document.querySelectorAll('#char-window .equip-slot')];
  const filled = slots.find((s) => s.querySelector('.slot-item')?.textContent?.trim());
  filled?.querySelector('.equip-unequip-btn')?.click();
});
await wait(400);
await page.mouse.move(640, 60); // move cursor off the slot
await wait(200);
await page.screenshot({ path: 'tmp/pr_unequip_after.png', clip: await charClip() });
const armorAfter = await page.evaluate(() => window.__game.sim.player.stats.armor ?? null);

console.log('armor before/after unequip:', armorBefore, '->', armorAfter);
if (errors.length) console.log('PAGE ERRORS:\n' + errors.join('\n'));
console.log('wrote tmp/pr_unequip_before.png, tmp/pr_unequip_after.png');
await browser.close();
