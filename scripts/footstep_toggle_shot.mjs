// Evidence for the footstep-sound-toggle PR: open the Esc > Audio options and
// screenshot the new "Footstep Sounds" toggle (off by default). The audio change
// itself is silent-by-default; the companion spectrogram pair (see
// scripts/footstep_toggle_spectrogram.mjs) shows what the toggle gates.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = 'tmp/footstep_toggle';
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
const tap = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
await tap('#btn-offline');
await wait(200);
await page.evaluate(() => {
  document.querySelector('#char-name').value = 'Strider';
  document.querySelector('#offline-select .mini-class[data-class="warrior"]')?.click();
});
await tap('#btn-start-offline');
await page.waitForFunction(() => window.__game?.hud, { timeout: 30000 });
await wait(1500);

// Open the Esc menu and switch to the Audio sub-view (where the toggle lives).
await page.evaluate(() => {
  const hud = window.__game.hud;
  hud.toggleOptionsMenu();
  hud.optionsView = 'audio';
  hud.renderOptions();
});
await wait(400);
await page.screenshot({ path: `${OUT}/audio_options_full.png` });
const box = await page.evaluate(() => {
  const el = document.querySelector('#options-menu');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
});
if (box && box.width > 0) await page.screenshot({ path: `${OUT}/audio_options_panel.png`, clip: box });

// Confirm the default state and the wiring round-trips through the setting.
const state = await page.evaluate(() => {
  const hud = window.__game.hud;
  const before = hud.optionsHooks.settings.get('footstepSfx');
  hud.optionsHooks.onSettingChange('footstepSfx', true);
  const after = hud.optionsHooks.settings.get('footstepSfx');
  hud.renderOptions();
  return { before, after };
});
await wait(300);
await page.screenshot({ path: `${OUT}/audio_options_enabled.png` });
console.log('footstepSfx default/after-toggle:', JSON.stringify(state));
await browser.close();
