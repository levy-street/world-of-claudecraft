// Mobile screenshots for the touch "More" tray Emotes button.
// Runs the offline flow (no server/Postgres) on a landscape-phone viewport.
// Needs `npm run dev` running. Writes PNGs to tmp/.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const CLASS = process.env.GAME_CLASS ?? 'warrior';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
// Satisfy PHONE_TOUCH_QUERY: (pointer: coarse) ...
const cdp = await page.target().createCDPSession();
await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }] });

const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('CONSOLE: ' + m.text());
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
// Menu buttons fail puppeteer's clickable-point check on mobile menus → click in-page.
const tap = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);

await enterOfflineGame(page, { charClass: CLASS, charName: 'Thorgar', settleMs: 3000 });

// Don't get eaten while posing for the camera.
await page.evaluate(() => {
  const p = window.__game.sim.player;
  p.maxHp = 99999;
  p.hp = 99999;
});

// 1) Open the "More" tray — shows the new Emotes button.
await tap('#mobile-more');
await wait(400);
await page.screenshot({ path: 'tmp/mobile_more_tray.png' });

// 2) Tap Emotes — opens the radial emote wheel (pinned so a tap selects a slice).
await tap('#mobile-emote');
await wait(500);
await page.screenshot({ path: 'tmp/mobile_emote_wheel.png' });

if (errors.length) console.log('PAGE ERRORS:\n' + errors.join('\n'));
console.log('wrote tmp/mobile_more_tray.png, tmp/mobile_emote_wheel.png');
await browser.close();
