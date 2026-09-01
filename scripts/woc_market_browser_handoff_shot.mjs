// Screenshot pair for the $WOC Exchange wrapped-shell browser hand-off. The
// launcher (#mm-wocmarket) is normally revealed only by the ONLINE entry in
// main.ts (attachWocMarketExchange, src/game/woc_market_wiring.ts), so like
// scripts/trade_money_shot.mjs this boots the OFFLINE game headless and drives
// window.__game.hud directly to reach the state an online session would
// produce, then interacts with the REAL rendered DOM from there.
//
// BEFORE: the offline boot's default state already IS the reported bug: the
// launcher stays `hidden` because nothing has attached it (unchanged by this
// fix; a wrapped shell never called anything on hud before it either).
// AFTER: hud.attachWocMarketBrowserOnlyNotice() (new in this change) reveals
// the SAME launcher, and a REAL click on it drives the REAL toggleWocMarket()
// -> promptWocMarketBrowserVisit() -> confirmDialog() chain.
//
// Desktop only: the mobile More-tray twin (#mobile-wocmarket) shares this
// exact reveal/toggle code path (revealWocMarketLauncher, toggleWocMarket)
// and is pinned by name in tests/woc_market_link.test.ts, but the offline
// character-creation flow this script drives does not reliably reach a
// playable state under a small touch viewport, so it is not captured here.
//
// Boots at the LOWEST graphics preset (the capture rule: these are DOM shots,
// not render-fidelity shots). Run with `npm run dev` already up.

import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT_DIR = process.env.SHOTS_DIR ?? 'tmp';
fs.mkdirSync(OUT_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (cond, msg) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'}  ${msg}`);
  if (!cond) fails.push(msg);
};

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--window-size=1600,1000',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
  ],
  defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument(
  `try { const k = 'woc_settings'; const s = JSON.parse(localStorage.getItem(k) || '{}'); s.graphicsPreset = 1; s.graphicsDefaultApplied = true; localStorage.setItem(k, JSON.stringify(s)); } catch {}`,
);
page.on('pageerror', (e) => fails.push('PAGEERROR: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE-ERR:', m.text());
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 40000 });
await page.waitForSelector('#btn-offline', { visible: true, timeout: 25000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await page.waitForSelector('#offline-select .mini-class[data-class="warrior"]', {
  visible: true,
  timeout: 25000,
});
await sleep(200);
await page.evaluate(() => {
  document.querySelector('#char-name').value = 'Hero';
  document.querySelector('#offline-select .mini-class[data-class="warrior"]').click();
  document.querySelector('#btn-start-offline').click();
});
await page.waitForFunction(() => window.__game?.sim?.entities?.size > 5, {
  timeout: 60000,
  polling: 300,
});
// The character-select overlay closes and the HUD lays out asynchronously
// after that; wait for the actual rail to have real geometry before shooting.
await page.waitForFunction(
  () => {
    const el = document.querySelector('#side-buttons');
    return !!el && el.getBoundingClientRect().width > 0;
  },
  { timeout: 60000, polling: 300 },
);
await sleep(1000); // let the scene settle

// The tutorial island greets a fresh offline character with its own note
// popup (independent of this fix); dismiss it so it cannot overlap the
// confirm dialog this script triggers later.
const dismissGreeting = () =>
  page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(
      (el) => el.textContent?.trim() === 'Understood',
    );
    if (btn) btn.click();
    return !!btn;
  });
for (let i = 0; i < 5; i++) {
  if (!(await dismissGreeting())) break;
  await sleep(300);
}

// BEFORE: the launcher's default state, unattached (the reported bug) - the
// right-side game menu (#side-buttons) the player described the icon missing
// from.
const before = await page.evaluate(() => {
  const btn = document.querySelector('#mm-wocmarket');
  return { hidden: btn?.hasAttribute('hidden'), exists: !!btn };
});
check(before.exists, '#mm-wocmarket exists in the DOM');
check(before.hidden, '#mm-wocmarket starts hidden (nothing has attached the Exchange)');
await sleep(300);
const railBefore = await page.$('#side-buttons');
await railBefore.screenshot({ path: path.join(OUT_DIR, 'before-launcher-hidden.png') });
console.log('wrote ' + path.join(OUT_DIR, 'before-launcher-hidden.png'));

// AFTER: reveal the SAME launcher via the new wrapped-shell notice, then
// drive the REAL click (not a debug hook) to open the REAL confirm dialog.
const revealed = await page.evaluate(() => {
  window.__game.hud.attachWocMarketBrowserOnlyNotice();
  const btn = document.querySelector('#mm-wocmarket');
  return { hidden: btn?.hasAttribute('hidden') };
});
check(!revealed.hidden, '#mm-wocmarket is revealed after attachWocMarketBrowserOnlyNotice()');
await sleep(300);
const railAfter = await page.$('#side-buttons');
await railAfter.screenshot({ path: path.join(OUT_DIR, 'after-launcher-revealed.png') });
console.log('wrote ' + path.join(OUT_DIR, 'after-launcher-revealed.png'));

for (let i = 0; i < 5; i++) {
  if (!(await dismissGreeting())) break;
  await sleep(300);
}
await page.evaluate(() => document.querySelector('#mm-wocmarket').click());
await page.waitForSelector('#confirm-dialog', { visible: true, timeout: 5000 });
await sleep(300);
const dialog = await page.evaluate(() => document.querySelector('#confirm-dialog')?.innerText);
check(
  !!dialog && dialog.includes('Open the $WOC Exchange in your browser?'),
  `confirm dialog shows the browser hand-off copy (got: ${JSON.stringify(dialog)})`,
);
const dlg = await page.$('#confirm-dialog');
await dlg.screenshot({ path: path.join(OUT_DIR, 'after-confirm-dialog.png') });
console.log('wrote ' + path.join(OUT_DIR, 'after-confirm-dialog.png'));

await browser.close();
console.log(
  fails.length === 0
    ? '\nALL WOC-MARKET-BROWSER-HANDOFF CHECKS PASSED'
    : `\n${fails.length} CHECK(S) FAILED:\n - ` + fails.join('\n - '),
);
process.exit(fails.length === 0 ? 0 : 1);
