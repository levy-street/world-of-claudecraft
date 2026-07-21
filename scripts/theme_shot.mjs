// Screenshot harness for the UI theming feature. Boots the offline world,
// opens the chatbox + quest tracker + map, then captures the HUD under each
// preset (and a custom-override sample). Renders at max graphics (?gfx=ultra).
// Needs a dev server (default :5173, override with GAME_URL). Writes to tmp/.
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

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#btn-offline', { timeout: 60000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(300);
await page.type('#char-name', 'Hueforge');
await page.click('#offline-select .mini-class[data-class="mage"]');
await page.click('#btn-start-offline');
await page.waitForFunction(() => window.__game?.hud, { timeout: 60000 });
await sleep(3000);

// Seed some chat lines and open the map so the themed surfaces are all visible.
await page.evaluate(() => {
  const hud = window.__game.hud;
  hud.addChat?.('Welcome to World of ClaudeCraft!', 'system');
  hud.addChat?.('Ironhart: anyone running the dungeon?', 'say');
  hud.addChat?.('You gain 25 experience.', 'system');
  if (document.querySelector('#map-window')?.style.display === 'none') hud.toggleMap?.();
});
await sleep(800);

// Per-shot try/catch: swiftshader occasionally drops a CDP screenshot under
// load, and we don't want one hiccup to lose the whole run.
async function shot(name, fn) {
  try {
    await fn();
    await sleep(700);
    await page.screenshot({ path: `tmp/theme-${name}.png` });
    console.log('captured', name);
  } catch (e) { console.log('FAILED', name, e.message); }
}

const setPreset = (id) => page.evaluate((p) => window.__game.hud.optionsHooks.theme.setPreset(p), id);

for (const p of ['classic', 'midnight', 'parchment', 'highContrast']) {
  await shot(p, () => setPreset(p));
}

// Custom override sample: teal accent on the midnight base.
await shot('custom', () => page.evaluate(() => {
  const t = window.__game.hud.optionsHooks.theme;
  t.setPreset('midnight'); t.setCustom('accent', '#39d3c0'); t.setCustom('border', '#1f6f66');
}));

// The Options > Interface panel itself, showing the preset + picker grid.
await shot('options-panel', () => page.evaluate(() => {
  const hud = window.__game.hud;
  hud.optionsHooks.theme.resetCustom();
  hud.optionsHooks.theme.setPreset('classic');
  hud.toggleOptionsMenu();
  hud.optionsView = 'interface';
  hud.renderOptions();
}));

await browser.close();
console.log('done');
