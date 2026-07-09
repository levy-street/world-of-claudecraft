// Visual capture for the ability-tooltip parity fix: boots the offline game per
// class at max level, opens the spellbook, hovers the audited abilities, and
// screenshots #tooltip for each. Run against a dev server of the before AND
// after builds to produce the PR's comparison shots. Needs `npm run dev`.
//
// Env: GAME_URL (default http://localhost:5173), SHOT_PREFIX (default
// tooltip_parity) for the tmp/ output filenames.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const PREFIX = process.env.SHOT_PREFIX ?? 'tooltip_parity';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The audited tooltips worth showing: the hybrid DoT fix, the empty groundAoE
// number, the rank-drifting buff/heal values, and the lifeTap conversion.
const SHOTS = [
  { cls: 'warlock', abilities: ['immolate', 'life_tap', 'rain_of_fire'] },
  { cls: 'paladin', abilities: ['consecration', 'lay_on_hands', 'devotion_aura'] },
];

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});

for (const { cls, abilities } of SHOTS) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.bringToFront();
  const jsClick = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#btn-offline', { timeout: 30000 });
  await jsClick('#btn-offline');
  await sleep(400);
  await page.waitForSelector('#char-name', { timeout: 30000 });
  await page.type('#char-name', 'Auditor');
  await jsClick(`#offline-select .mini-class[data-class="${cls}"]`);
  await sleep(300);
  await jsClick('#btn-start-offline');
  await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 60000 });
  await sleep(1500);
  // Skip any intro cinematic so the HUD is interactable, then max the level so
  // the tooltips show top-rank numbers (where the old hardcoded text drifted).
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__game.sim.setPlayerLevel?.(20));
  await sleep(500);

  await jsClick('#mm-spell');
  await sleep(600);
  for (const id of abilities) {
    const hovered = await page.evaluate((abilityId) => {
      const toggle = document.querySelector(`.spell-hotbar-toggle[data-ability-id="${abilityId}"]`);
      const row = toggle?.closest('.spell-row');
      if (!row) return false;
      row.scrollIntoView({ block: 'center' });
      row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      return true;
    }, id);
    if (!hovered) {
      console.log(`MISS: ${cls}.${id} row not found`);
      continue;
    }
    await sleep(400);
    const tip = await page.$('#tooltip');
    const visible = tip && (await tip.evaluate((el) => el.style.display !== 'none'));
    if (!visible) {
      console.log(`MISS: ${cls}.${id} tooltip not visible`);
      continue;
    }
    const path = `tmp/${PREFIX}_${cls}_${id}.png`;
    await tip.screenshot({ path });
    console.log('WROTE', path);
  }
  await page.close();
}

await browser.close();
