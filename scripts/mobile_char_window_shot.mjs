// Before/after mobile screenshots for the off-screen character-window fix.
// Landscape-phone viewport, max graphics (?gfx=ultra), offline flow (no server).
// "before" re-injects the buggy inherited transform: translateX(-50%); "after"
// uses the shipped CSS. Needs `npm run dev`. Writes PNGs to tmp/.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = (process.env.GAME_URL ?? 'http://localhost:5173') + '/?gfx=ultra';
const CLASS = process.env.GAME_CLASS ?? 'paladin';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({
  width: 844,
  height: 390,
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});
const cdp = await page.target().createCDPSession();
await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }] });

const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('CONSOLE: ' + m.text());
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tap = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await enterOfflineGame(page, { charClass: CLASS, charName: 'Vorthos' });
// On a phone-touch device the world-entry flow first shows an "add to home
// screen" preflight that blocks until dismissed; tap Continue to proceed.
await page
  .waitForSelector('#mobile-preflight-continue', { visible: true, timeout: 10000 })
  .catch(() => {});
await tap('#mobile-preflight-continue');
// Wait for the offline world to boot (window.__game appears post-start).
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 30000 });
await wait(1500);

// God-mode so camp mobs don't kill the camera while posing, and give some gear
// so the equipment columns render filled like the bug report.
await page.evaluate(() => {
  const p = window.__game.sim.player;
  p.maxHp = 99999;
  p.hp = 99999;
  p.level = 6;
});

// Dismiss the onboarding tutorial overlay so it doesn't obscure the window.
await tap('.tut-skip');
await wait(300);

// Open the character sheet via the mobile "More" tray.
await tap('#mobile-more');
await wait(400);
await tap('#mobile-char');
await wait(600);

// AFTER (shipped fix): left-pinned, transform reset, fully on-screen.
await page.screenshot({ path: 'tmp/mobile_char_after.png' });

// BEFORE (the bug): re-introduce the inherited centering transform that the fix
// removes, so the window shifts half its width off the left edge.
await page.evaluate(() => {
  const el = document.querySelector('#char-window');
  el.style.transform = 'translateX(-50%)';
});
await wait(300);
await page.screenshot({ path: 'tmp/mobile_char_before.png' });

if (errors.length) console.log('PAGE ERRORS:\n' + errors.join('\n'));
console.log('wrote tmp/mobile_char_before.png (bug) and tmp/mobile_char_after.png (fixed)');
await browser.close();
