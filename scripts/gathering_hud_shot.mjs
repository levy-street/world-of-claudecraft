// Visual proof of the gathering HUD (issue 1124): the minimap gather-node
// indicator distinguishing ready (bright/outlined) from on-cooldown-for-me
// (dim/grey), plus the character sheet's new "Gathering" proficiency section.
// Boots the offline game, teleports next to a real ore node, harvests it once
// (putting it on cooldown for this player), then screenshots the minimap and
// the character window.
//   node scripts/gathering_hud_shot.mjs    (needs `npm run dev` on :5173)
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('docs/screenshots', { recursive: true });

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
await page.waitForSelector('#btn-offline', { timeout: 20000 });
await new Promise((r) => setTimeout(r, 400));
await jsClick('#btn-offline');
await new Promise((r) => setTimeout(r, 300));
await page.type('#char-name', 'Gatherer');
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

// Teleport next to a real ore node and harvest it once, putting it on
// cooldown-for-this-player specifically (another player's timer is untouched).
await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.chat('/dev tp 72 8');
});
await new Promise((r) => setTimeout(r, 400));
const harvestResult = await page.evaluate(() => {
  const sim = window.__game.sim;
  const nodeId = 'ore_eastbrook_1';
  const before = sim.nodeHarvestableByMe(nodeId);
  sim.harvestNode(nodeId);
  const after = sim.nodeHarvestableByMe(nodeId);
  return { nodeId, before, after };
});
console.log('harvest result:', JSON.stringify(harvestResult));
await new Promise((r) => setTimeout(r, 500));

// Zoom the minimap in so the nearby gather-node dots (ready vs on-cooldown) are
// clearly visible against the terrain.
await page.evaluate(() => {
  const mm = document.querySelector('#minimap');
  mm?.dispatchEvent(new WheelEvent('wheel', { deltaY: -400, bubbles: true }));
});
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: 'docs/screenshots/gathering_hud_minimap.png' });
console.log('captured docs/screenshots/gathering_hud_minimap.png');

// Open the character window: the new "Gathering" proficiency section.
await page.keyboard.press('c');
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: 'docs/screenshots/gathering_hud_proficiency.png' });
console.log('captured docs/screenshots/gathering_hud_proficiency.png');

await browser.close();
