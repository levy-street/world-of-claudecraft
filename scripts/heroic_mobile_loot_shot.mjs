// Mobile Heroic loot regression capture: one unanswered roll plus one answered
// watch row, then open Bags at the short landscape phone size from the player
// report. The screenshot and hit-test show whether the pointer-active roll rail
// sits above the managed bag sheet.

import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = `${process.env.GAME_URL ?? 'http://localhost:5173'}/?gfx=low`;
const OUTPUT_PATH = process.env.OUTPUT_PATH ?? 'tmp/heroic_mobile_loot.png';
fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: {
    width: 1600,
    height: 900,
    deviceScaleFactor: 2,
  },
});
const page = await browser.newPage();
page.on('pageerror', (error) => console.log('PAGEERROR:', error.message));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForSelector('#btn-offline', { timeout: 60_000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(300);
await page.type('#char-name', 'Lootguard');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await page.waitForFunction(() => window.__game?.hud, { timeout: 60_000 });
await sleep(1_500);
await page.keyboard.press('Escape');
await page.waitForFunction(
  () => {
    const ui = document.getElementById('ui');
    return ui && getComputedStyle(ui).display !== 'none';
  },
  { timeout: 30_000 },
);
await page.evaluate(() => document.querySelector('.tut-skip')?.click());
await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2 });
await page.evaluate(() => document.body.classList.add('mobile-touch'));
await sleep(300);

await page.evaluate(() => {
  const { hud, sim, world } = window.__game;
  for (const itemId of [
    'morthens_cryptforged_hauberk',
    'shadowpulse_handwraps',
    'wolf_fang',
    'minor_healing_potion',
  ]) {
    sim.addItem(itemId, 1);
  }
  const expiresAt = (world.time ?? 0) + 45;
  const entries = (selfChoice) => [
    { pid: world.playerId, name: 'Lootguard', choice: selfChoice },
    { pid: 900_001, name: 'Tank', choice: 'need' },
    { pid: 900_002, name: 'Healer', choice: null },
    { pid: 900_003, name: 'Rogue', choice: 'greed' },
    { pid: 900_004, name: 'Hunter', choice: 'pass' },
  ];
  world.lootRollGroupStatus = () => [
    {
      rollId: 81_001,
      itemId: 'morthens_cryptforged_hauberk',
      itemName: "Morthen's Cryptforged Hauberk",
      quality: 'epic',
      expiresAt,
      entries: entries('need'),
    },
    {
      rollId: 81_002,
      itemId: 'shadowpulse_handwraps',
      itemName: 'Shadowpulse Handwraps',
      quality: 'epic',
      expiresAt,
      entries: entries(null),
    },
  ];
  hud.handleEvents([
    {
      type: 'lootRoll',
      rollId: 81_002,
      itemId: 'shadowpulse_handwraps',
      itemName: 'Shadowpulse Handwraps',
      quality: 'epic',
      expiresAt,
    },
  ]);
  hud.toggleBags();
});

await page.waitForFunction(
  () =>
    getComputedStyle(document.getElementById('bags')).display !== 'none' &&
    document.querySelector('#loot-rolls .loot-roll') &&
    document.querySelector('#bags .item-cell:not(.is-empty), #bags .bag-item:not(.empty)'),
  { timeout: 30_000 },
);
await page.evaluate(() => document.fonts?.ready);
await sleep(1_000);

const diagnostics = await page.evaluate(() => {
  const bags = document.getElementById('bags');
  const rail = document.getElementById('loot-rolls');
  const roll = rail.querySelector('.loot-roll');
  const rect = roll.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + Math.min(rect.height / 2, 48);
  const hit = document.elementFromPoint(x, y);
  return {
    bagsInlineZ: bags.style.zIndex,
    bagsComputedZ: getComputedStyle(bags).zIndex,
    railZ: getComputedStyle(rail).zIndex,
    watchRows: rail.querySelectorAll('.loot-roll.watch').length,
    promptRows: rail.querySelectorAll('.loot-roll:not(.watch)').length,
    hasBagTitle: !!bags.querySelector('.window-title'),
    bagChildClasses: [...bags.children].map((child) => child.className),
    hitId: hit?.id ?? '',
    hitClass: hit?.className ?? '',
    hitInsideBags: !!hit && bags.contains(hit),
  };
});

await page.screenshot({ path: OUTPUT_PATH, fullPage: false });
console.log(JSON.stringify({ output: OUTPUT_PATH, ...diagnostics }, null, 2));
await browser.close();
