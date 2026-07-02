// Proof shot for the Talents 2.0 row picker: boots the offline client as a
// level 20 mage, opens the Talents window, switches to the Choices tab, picks
// Firestarter, asserts the pick landed in the live allocation, screenshots.
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
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
const jsClick = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 180000 });
await page.waitForSelector('#btn-offline', { timeout: 60000 });
await jsClick('#btn-offline');
await sleep(400);
await page.waitForSelector('#char-name', { timeout: 30000 });
await page.type('#char-name', 'Rowe');
await jsClick('#offline-select .mini-class[data-class="mage"]');
await sleep(300);
await jsClick('#btn-start-offline');
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 60000 });
await sleep(1500);
await page.evaluate(() => {
  window.__game.sim.setPlayerLevel(20);
  document.querySelector('#tutorial-hint button')?.click();
});
await sleep(400);
await page.keyboard.press('KeyN'); // open talents
await sleep(600);
const tabbed = await page.evaluate(() => {
  const tab = document.querySelector('.tal-tab[data-tab="choices"]');
  if (!tab) return { fail: 'no choices tab' };
  tab.click();
  return { ok: true };
});
await sleep(400);
const picked = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll('.tal-row-opt'));
  const target = cards.find((c) => c.textContent.includes('Firestarter'));
  if (!target) return { fail: 'no Firestarter card', cards: cards.length };
  target.click();
  return { ok: true, cards: cards.length };
});
await sleep(500);
const state = await page.evaluate(() => ({
  rows: window.__game.sim.talents.rows,
  scorchMobile: window.__game.sim.resolvedAbility('scorch')?.castWhileMoving ?? false,
}));
console.log(JSON.stringify({ tabbed, picked, state }));
await page.screenshot({ path: 'tmp/choice_rows_picker.png' });
await browser.close();
if (tabbed.fail || picked.fail || !state.rows[5] || !state.scorchMobile || errs.length) {
  console.error('FAIL', JSON.stringify({ tabbed, picked, state, errs }));
  process.exit(1);
}
console.log('PASS: picker tab renders, Firestarter picked via UI, scorch is mobile');
