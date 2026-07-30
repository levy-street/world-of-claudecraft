import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: [
    '--window-size=1600,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
  ],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 200)));

// Force the cheapest graphics tier before the app reads it at startup: software
// WebGL cannot drive the default preset at a usable rate.
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('graphicsPreset', '1');
    localStorage.setItem('terrainDetail', '0');
    localStorage.setItem('foliageDensity', '0');
    localStorage.setItem('shadowQuality', '0');
    localStorage.setItem('effectsQuality', '0');
  } catch {}
});

const t0 = Date.now();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
console.log('nav done in', ((Date.now() - t0) / 1000).toFixed(1), 's');

const booted = await enterOfflineGame(page, {
  charClass: 'paladin',
  charName: 'Sigil',
  settleMs: 1000,
  gameBootTimeoutMs: 240000,
});
console.log('booted =', booted, 'at', ((Date.now() - t0) / 1000).toFixed(1), 's');

const state = await page.evaluate(() => ({
  gameHandle: typeof window.__game,
  player: window.__game?.sim?.player ? 'yes' : 'no',
  cls: window.__game?.sim?.player?.cls ?? null,
}));
console.log('STATE:', JSON.stringify(state));
await page.screenshot({ path: 'tmp/diag2.png' });
console.log('wrote tmp/diag2.png');
await browser.close();
process.exit(0);
