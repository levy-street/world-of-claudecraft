// Screenshot harness for the pet-combat health-regen fix.
// Boots the offline world as a level-20 warlock at max graphics (?gfx=ultra),
// summons a Pyre Colossus, drops the player to ~40% HP, and confirms out-of-combat
// health regen resumes even while the demon lingers at the owner's side.
// Captures the HUD before and after the regen ticks.
//
// Needs `npm run dev` (override with GAME_URL). Writes to tmp/.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = `${process.env.GAME_URL ?? 'http://localhost:5173'}/?gfx=ultra`;
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(200);
await page.type('#char-name', 'Ruanhx');
await page.click('#offline-select .mini-class[data-class="warlock"]');
await page.click('#btn-start-offline');
await page.waitForFunction(() => window.__game?.sim?.player, {
  timeout: 30000,
});
await sleep(1500);

// Level to 20, summon the Pyre Colossus, drop to 40% HP, force out of combat.
const before = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  sim.setPlayerLevel(20);
  sim.createDemonPet(p, 'pyre_colossus', false);
  p.hp = Math.floor(p.maxHp * 0.4);
  p.inCombat = false;
  p.combatTimer = 99;
  return { hp: p.hp, maxHp: p.maxHp, mana: p.resource, maxMana: p.maxResource };
});
console.log('before:', JSON.stringify(before));
await sleep(800);
await page.screenshot({ path: 'tmp/pet-regen-before.png' });

// Let the sim tick ~8 seconds of real out-of-combat time and re-read HP.
await sleep(8000);
const after = await page.evaluate(() => {
  const p = window.__game.sim.player;
  return { hp: p.hp, maxHp: p.maxHp, inCombat: p.inCombat };
});
console.log('after:', JSON.stringify(after));
await page.screenshot({ path: 'tmp/pet-regen-after.png' });

if (!(after.hp > before.hp)) {
  console.log('FAIL: hp did not regen');
} else console.log(`OK: hp ${before.hp} -> ${after.hp} out of combat`);

await browser.close();
