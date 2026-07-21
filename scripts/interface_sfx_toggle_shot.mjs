// Evidence for the interface-sfx-toggle PR: open the Esc > Audio options and
// screenshot the new "Interface and Feedback Sounds" toggle (on by default, so
// nothing changes out of the box). The toggle gates the discrete event cues
// (loot, level-up, quest, whisper, miss/dodge/parry) without touching the SFX
// volume, spatial world sounds, or the gameplay-timing cues.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = 'tmp/interface_sfx_toggle';
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#btn-offline', { timeout: 60000 });
// Suppress the one-shot first-run camera prompt so it does not overlay the menu.
await page.evaluate(() => localStorage.setItem('woc.cameraModePrompt.shown', '1'));
const tap = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
await tap('#btn-offline'); // reveals #offline-select and auto-selects the warrior card
await wait(600);
await page.evaluate(() => {
  document.querySelector('#char-name').value = 'Strider';
});
await tap('#btn-start-offline');
// Poll for the HUD via setTimeout (headless rAF-based waitForFunction stalls here);
// skip the spawn cinematic with Escape once, then wait for #ui to be live.
let ready = false;
for (let i = 0; i < 25 && !ready; i++) {
  await wait(2000);
  if (i === 1) await page.keyboard.press('Escape');
  ready = await page.evaluate(() => !!window.__game?.hud);
}
if (!ready) throw new Error('HUD never became ready');
await wait(1500);

// Open the Esc menu (main view is a category list) and go to the Audio panel,
// where the new toggle lives.
const LABEL = /Interface and Feedback Sounds/i;
await page.evaluate(() => window.__game.hud.toggleOptionsMenu());
await wait(300);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('#options-menu .opt-btn')].find(
    (b) => (b.textContent ?? '').trim() === 'Audio',
  );
  btn?.click();
});
await wait(400);
await page.evaluate((src) => {
  const re = new RegExp(src, 'i');
  const rows = [...document.querySelectorAll('#options-menu .set-row')];
  const row = rows.find((r) => re.test(r.querySelector('.set-name')?.textContent ?? ''));
  row?.scrollIntoView({ block: 'center' });
}, LABEL.source);
await wait(300);
await page.screenshot({ path: `${OUT}/audio_options_full.png` });
const box = await page.evaluate(() => {
  const el = document.querySelector('#options-menu');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    x: Math.round(r.x),
    y: Math.round(r.y),
    width: Math.round(r.width),
    height: Math.round(r.height),
  };
});
if (box && box.width > 0)
  await page.screenshot({ path: `${OUT}/audio_options_panel.png`, clip: box });

// Flip it OFF by clicking the real toggle button (not a fake setting write), then
// re-screenshot so the pair shows the on -> off states.
const state = await page.evaluate((src) => {
  const re = new RegExp(src, 'i');
  const hud = window.__game.hud;
  const rows = [...document.querySelectorAll('#options-menu .set-row')];
  const row = rows.find((r) => re.test(r.querySelector('.set-name')?.textContent ?? ''));
  const before = hud.optionsHooks.settings.get('interfaceSfx');
  row?.querySelector('.set-toggle')?.click();
  const after = hud.optionsHooks.settings.get('interfaceSfx');
  return { before, after, found: !!row };
}, LABEL.source);
await wait(300);
await page.screenshot({ path: `${OUT}/audio_options_disabled.png` });
console.log('interfaceSfx default/after-toggle:', JSON.stringify(state));
await browser.close();
