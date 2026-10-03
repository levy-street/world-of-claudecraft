// Evidence shots of the world map (M) and the minimap inside a dungeon
// instance: boots an offline world on an already-running dev server, enters a
// dungeon (the Sunken Bastion by default, SHOT_DUNGEON=crypt for the Hollow
// Crypt), stands at a few spots with the HUD visible, and captures the
// minimap corner and the open world map. Evidence tooling, not a test.
//
//   node scripts/sunken_bastion_map_shot.mjs [outDir]
//
// Env: SHOT_URL (http://127.0.0.1:5199/), SHOT_PREFIX (default "mapa_"),
// SHOT_DUNGEON (bastion | crypt).
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5199/';
const OUT = process.argv[2] ?? path.join('tmp', 'dungeon_maps');
const PREFIX = process.env.SHOT_PREFIX ?? 'mapa_';
const CRYPT = process.env.SHOT_DUNGEON === 'crypt';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SPOTS = CRYPT
  ? [['entrada', '/dev crypt tp landing']]
  : [
      ['patio', '/dev bastion tp bailey'],
      ['muralla', '/dev bastion tp rampart'],
    ];

async function main() {
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: ['--window-size=1600,900', '--use-angle=d3d11', '--ignore-gpu-blocklist'],
    defaultViewport: { width: 1600, height: 900 },
    protocolTimeout: 240000,
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
    await page.evaluateOnNewDocument(() => {
      try {
        localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 4 }));
      } catch {
        /* ignore */
      }
    });
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 180000 });
    if (
      !(await enterOfflineGame(page, {
        charClass: 'warrior',
        charName: 'Tidewalker',
        gameBootTimeoutMs: 180000,
        selectorTimeoutMs: 90000,
        settleMs: 4000,
      }))
    )
      throw new Error('offline world did not boot');
    const enter = CRYPT
      ? ['/dev level 20', '/dev god', '/dev crypt enter']
      : ['/dev level 20', '/dev god', '/dev bastion enter'];
    for (const cmd of enter) {
      await page.evaluate((c) => window.__game.world.chat(c), cmd);
      await sleep(1300);
    }
    await sleep(6000);
    for (const [name, cmd] of SPOTS) {
      await page.evaluate((c) => window.__game.world.chat(c), cmd);
      await sleep(2500);
      const file = path.join(OUT, `${PREFIX}minimapa_${name}.png`);
      await page.screenshot({ path: file, clip: { x: 1600 - 330, y: 0, width: 330, height: 300 } });
      console.log('SHOT', file);
      await page.keyboard.press('KeyM');
      await sleep(1800);
      const map = path.join(OUT, `${PREFIX}mapa_${name}.png`);
      await page.screenshot({ path: map });
      console.log('SHOT', map);
      await page.keyboard.press('KeyM');
      await sleep(600);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
