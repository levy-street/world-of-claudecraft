// Offline screenshot of the /talents chat readout for the PR.
// Boots the game headless, levels to 20, picks Arms + spends points, then
// types /talents in the real chat box and captures the chat log.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.click('#btn-offline');
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Talia');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 2500));

// Level to 20 and spend a representative Arms build.
await page.evaluate(() => {
  const g = window.__game;
  g.sim.setPlayerLevel(20);
  g.sim.applyTalents({
    spec: 'arms',
    ranks: { war_toughness: 3, war_cruelty: 2, arms_imp_overpower: 2, arms_deep_wounds: 3 },
    choices: {},
  });
});
await new Promise((r) => setTimeout(r, 400));

// Type the command through the actual chat input (Enter opens it). The readout
// is delivered as a self-only `error` event, which the HUD shows as a centered
// banner (#error-msg) that fades after ~1.6s — capture inside that window.
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 150));
await page.type('#chat-input', '/talents', { delay: 12 });
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 250));

const banner = await page.evaluate(() => document.querySelector('#error-msg')?.textContent);
console.log('readout banner:', JSON.stringify(banner));
await page.screenshot({ path: 'tmp/talents_command.png' });

// Re-issue so the banner is at full opacity, then crop it tight for legibility.
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 150));
await page.type('#chat-input', '/talents', { delay: 12 });
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 120));
const box = await page.evaluate(() => {
  const r = document.querySelector('#error-msg').getBoundingClientRect();
  return { x: Math.max(0, r.x - 30), y: Math.max(0, r.y - 16), width: Math.min(1600, r.width + 60), height: r.height + 32 };
});
await page.screenshot({ path: 'tmp/talents_command_banner.png', clip: box });

await browser.close();
console.log('saved tmp/talents_command.png');
