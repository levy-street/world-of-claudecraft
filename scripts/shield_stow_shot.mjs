// Capture the on-back sheathe pose for a shield offhand (back_grips.ts).
// Adapted from sheathe_family_shots.mjs.
//   OUT=tmp/shield_shots node scripts/shield_stow_shot.mjs

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.OUT ?? 'tmp/shield_shots';
fs.mkdirSync(OUT, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1280,800', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', e.message));

await page.evaluateOnNewDocument(() => {
  try {
    window.localStorage.setItem('woc.cameraModePrompt.shown', '1');
  } catch {
    /* private mode */
  }
});
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await wait(400);
await page.type('#char-name', 'Sheathe');
await page.evaluate(() => {
  document.querySelector('#offline-select .mini-class[data-class="warrior"]').click();
  document.querySelector('#btn-start-offline').click();
});
await page.waitForFunction(() => !!window.__game?.world?.player, { timeout: 90000 });
await wait(2500);

await page.evaluate(() => {
  document.querySelector('.camera-prompt-confirm')?.click();
  for (const b of document.querySelectorAll('button')) {
    if (/skip tutorial/i.test(b.textContent ?? '')) b.click();
  }
});
await wait(700);

async function park(pg) {
  await pg.evaluate(() => {
    const g = window.__game;
    g.input.camDist = 8;
    g.input.camPitch = 0.28;
    g.input.camYaw = g.sim.player.facing;
  });
  await wait(1400);
}

const applied = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  sim.setPlayerLevel?.(30);
  if (p.weaponStowed) g.world.toggleWeaponStow();
  sim.addItem('eastbrook_buckler', 1, p.id);
  try {
    g.world.equipItem('eastbrook_buckler');
  } catch (e) {
    return { error: String(e) };
  }
  return { offhand: p.equippedItems?.offhand ?? null, mainhand: p.equippedItems?.mainhand ?? null };
});
console.log('applied:', JSON.stringify(applied));

await park(page);
await page.screenshot({ path: `${OUT}/shield-drawn.png` });

await page.evaluate(() => window.__game.world.toggleWeaponStow());
await wait(1800);
await park(page);
await page.screenshot({ path: `${OUT}/shield-sheathed-front.png` });

// Turn the camera around to the character's back for the actual on-back pose.
await page.evaluate(() => {
  const g = window.__game;
  g.input.camYaw = g.sim.player.facing + Math.PI;
});
await wait(800);
await page.screenshot({ path: `${OUT}/shield-sheathed-back.png` });

await browser.close();
console.log(`wrote ${OUT}/`);
