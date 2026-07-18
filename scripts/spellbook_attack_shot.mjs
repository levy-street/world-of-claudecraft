// Visual proof of the pinned Attack row in the spellbook. Boots the offline
// game as a WARRIOR, skips the tutorial, opens the spellbook, and captures the
// window; a second shot shows the toggle after removing Attack from the bar.
//   node scripts/spellbook_attack_shot.mjs [suffix]   (needs `npm run dev` on :5173)
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const SUFFIX = process.argv[2] ?? 'after';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
const jsClick = (sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) throw new Error(`missing ${s}`);
    el.click();
  }, sel);
await new Promise((r) => setTimeout(r, 400));
await jsClick('#btn-offline');
await new Promise((r) => setTimeout(r, 300));
await page.type('#char-name', 'Bookish');
await jsClick('#offline-select .mini-class[data-class="warrior"]');
await jsClick('#btn-start-offline');
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 60000 });
await new Promise((r) => setTimeout(r, 2000));

// Skip the intro cinematic; #ui stays display:none until it ends.
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 800));

// Dismiss the new-adventurer tutorial overlay, which otherwise intercepts input.
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) =>
    /skip tutorial/i.test(b.textContent || ''),
  );
  btn?.click();
});
await new Promise((r) => setTimeout(r, 400));

// Confirm the first-run camera-mode dialog so it never overlays the shot; it
// can appear a beat after the tutorial skip, so poll it away.
for (let i = 0; i < 10; i++) {
  const dismissed = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(
      (b) => /confirm/i.test(b.textContent || '') && b.offsetParent !== null,
    );
    if (btn) btn.click();
    return !btn;
  });
  await new Promise((r) => setTimeout(r, 500));
  if (dismissed && i > 2) break;
}

await page.evaluate(() => window.__game.hud.toggleSpellbook());
await new Promise((r) => setTimeout(r, 600));
const rect = await page.evaluate(() => {
  const el = document.querySelector('#spellbook');
  if (!el || el.style.display !== 'block') return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});
if (!rect || rect.width === 0) throw new Error('spellbook did not open or is not visible');
const probe = await page.evaluate(() => ({
  attackToggle: !!document.querySelector('#spellbook [data-attack-toggle]'),
  firstRow: document.querySelector('#spellbook .spell-row .spell-name')?.textContent ?? null,
}));
console.log('probe:', JSON.stringify(probe));
await page.screenshot({ path: `tmp/spellbook-attack-${SUFFIX}.png`, clip: rect });
console.log(`wrote tmp/spellbook-attack-${SUFFIX}.png`);

await browser.close();
process.exit(0);
