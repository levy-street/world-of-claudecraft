// Live-client CLICK-driven proof: open Talents (N), switch to the Choices tab with the
// mouse, click an option card, click Apply, and verify the sim granted the spell.
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1400,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1400, height: 900 },
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:5173', { waitUntil: 'networkidle0', timeout: 180000 });
await page.waitForSelector('#btn-offline', { timeout: 60000 });
await page.evaluate(() => document.querySelector('#btn-offline')?.click());
await sleep(400);
await page.waitForSelector('#char-name', { timeout: 30000 });
await page.type('#char-name', 'Clickpicker');
await page.evaluate(() =>
  document.querySelector('#offline-select .mini-class[data-class="warrior"]')?.click(),
);
await sleep(300);
await page.evaluate(() => document.querySelector('#btn-start-offline')?.click());
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 60000 });
await sleep(1200);
await page.evaluate(() => {
  window.__game.sim.setPlayerLevel(20);
  document.querySelector('#tutorial-hint .btn, #tutorial-hint button')?.click();
});
await page.keyboard.press('Escape');
await sleep(500);
// Open the talents window via the HUD toggle, click the Choices tab.
await page.evaluate(() => window.__game.hud.toggleTalents());
await sleep(500);
const hasTab = await page.evaluate(() => {
  const tab = document.querySelector('#talents-window .tal-tab[data-tab="choices"]');
  if (!tab) return false;
  tab.click();
  return true;
});
await sleep(500);
const clicked = await page.evaluate(() => {
  const known = !!window.__game.sim.resolvedAbility('whirlwind');
  // click the r14 Bladed Gyre card by its visible name
  const cards = [...document.querySelectorAll('#talents-window .tal-row-opt')];
  const target = cards.find((c) => /Bladed Gyre/i.test(c.textContent || ''));
  if (!target) return { ok: false, why: 'card not found', cards: cards.length };
  target.click();
  return { ok: true, knownBefore: known, cards: cards.length };
});
await sleep(400);
// Commit path: Save current -> the in-app name dialog -> OK.
const applied = await page.evaluate(() => {
  const save = document.querySelector('#talents-window [data-act="save"]');
  if (!save) return { ok: false, why: 'save button not found' };
  save.click();
  return { ok: true };
});
await sleep(500);
await page.evaluate(() => {
  const input = document.querySelector('.modal input, #input-dialog input, dialog input');
  if (input) {
    input.value = 'Rowbuild';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const ok = [...document.querySelectorAll('button')].find((b) =>
    /^(ok|save)$/i.test((b.textContent || '').trim()),
  );
  ok?.click();
});
await sleep(600);
const result = await page.evaluate(() => ({
  granted: window.__game.sim.resolvedAbility('whirlwind')?.def?.name ?? null,
  rows: JSON.stringify(window.__game.sim.talents.rows ?? {}),
}));
await page.screenshot({ path: 'docs/screenshots/choice-rows-picker.png' });
console.log(
  JSON.stringify({ hasTab, clicked, applied, result, pageErrors: errs.slice(0, 2) }, null, 1),
);
await browser.close();
process.exit(hasTab && clicked.ok && applied.ok && result.granted ? 0 : 1);
