// Visual proof of the archetype title (#1130). Boots the offline game, opens
// the character window (no title yet, pre-acceptance-quest), then calls the
// zone-1 acceptance quest's stub entry point directly (acceptArchetypeQuest,
// since the real quest content is a stub per src/sim/professions/archetype.ts)
// and re-opens the character window to show the granted title.
//   node scripts/archetype_title_shot.mjs    (needs `npm run dev` on :5173)
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

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
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
const jsClick = (sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) throw new Error(`missing ${s}`);
    el.click();
  }, sel);
await new Promise((r) => setTimeout(r, 400));
await jsClick('#btn-offline');
await new Promise((r) => setTimeout(r, 300));
await page.type('#char-name', 'Anvil');
await jsClick('#offline-select .mini-class[data-class="warrior"]');
await jsClick('#btn-start-offline');
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 40000 });
await new Promise((r) => setTimeout(r, 2000));

// Dismiss the new-adventurer tutorial overlay, which otherwise intercepts input.
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) =>
    /skip tutorial/i.test(b.textContent || ''),
  );
  btn?.click();
});
await new Promise((r) => setTimeout(r, 400));

// Before the acceptance quest: no title.
await page.keyboard.press('c'); // open character window
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: 'tmp/archetype_title_none.png' });
const before = await page.evaluate(
  () => document.querySelector('.char-archetype-title')?.textContent ?? null,
);
console.log('before acceptance quest:', before);
await page.keyboard.press('c'); // close character window

// Directly call the acceptance quest's stub entry point (real quest content is
// a stub per src/sim/professions/archetype.ts). Choose weaponcrafting.
await page.evaluate(() => {
  window.__game.sim.acceptArchetypeQuest('weaponcrafting');
});
await new Promise((r) => setTimeout(r, 300));

await page.keyboard.press('c'); // re-open character window
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: 'tmp/archetype_title_granted.png' });
const after = await page.evaluate(
  () => document.querySelector('.char-archetype-title')?.textContent ?? null,
);
console.log('after acceptance quest (weaponcrafting):', after);

await browser.close();
