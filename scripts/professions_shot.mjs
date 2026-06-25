// Screenshot harness for the Professions (gathering + crafting) window.
// Boots the offline world, learns professions and stocks a few reagents through
// the live Sim, opens the Professions window, and captures two states:
// (1) Mining learned (smelting recipes) + the "available to learn" list,
// (2) Blacksmithing added (crafting recipes with reagents, difficulty colours,
//     Craft buttons). Needs a dev server (default :5173, override GAME_URL).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = (process.env.GAME_URL ?? 'http://localhost:5173') + '/?gfx=ultra';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#btn-offline', { timeout: 120000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await page.waitForSelector('#char-name', { timeout: 120000 });
await sleep(400);
await page.type('#char-name', 'Forgewyn');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await page.waitForFunction(() => window.__game?.hud, { timeout: 120000 });
await sleep(3500);

// State 1: learn Mining, give some ore, bump skill so the bar + colours show.
await page.evaluate(() => {
  const sim = window.__game.sim;
  const pid = sim.primaryId;
  sim.learnProfession('mining', pid);
  const ps = sim.players.get(pid).professions.get('mining');
  if (ps) ps.skill = 35;
  sim.addItem('copper_ore', 12, pid);
  window.__game.hud.toggleProfessions();
});
await sleep(700);
await page.screenshot({ path: 'tmp/professions-1-mining.png' });

// State 2: also learn Blacksmithing and stock bars, so crafting recipes + Craft
// buttons + reagent have/need + difficulty dots are all visible.
await page.evaluate(() => {
  const sim = window.__game.sim;
  const pid = sim.primaryId;
  sim.learnProfession('blacksmithing', pid);
  const ps = sim.players.get(pid).professions.get('blacksmithing');
  if (ps) ps.skill = 20;
  sim.addItem('copper_bar', 12, pid);
});
await sleep(800); // the HUD re-renders the open window each frame
await page.screenshot({ path: 'tmp/professions-2-crafting.png' });

const report = await page.evaluate(() => {
  const win = document.querySelector('#professions-window');
  return {
    visible: win ? getComputedStyle(win).display !== 'none' : false,
    sections: [...document.querySelectorAll('#professions-window .prof-name')].map((n) => n.textContent),
    recipes: [...document.querySelectorAll('#professions-window .prof-recipe-name')].map((n) => n.textContent),
    available: [...document.querySelectorAll('#professions-window .prof-avail-name')].map((n) => n.textContent),
  };
});
console.log('REPORT', JSON.stringify(report, null, 2));
fs.writeFileSync('tmp/professions-report.json', JSON.stringify(report, null, 2));

await browser.close();
