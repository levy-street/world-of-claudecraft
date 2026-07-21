// Visual capture for the per-corpse focus picker (#1142): stages a slain
// forest_wolf corpse (componentTags: hide, fang; #1140), opens the loot
// window (which now composes the harvest picker below the loot rows since
// this corpse is harvestable and unclaimed), and screenshots the panel.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = (process.env.GAME_URL ?? 'http://localhost:5173') + '/?gfx=ultra';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('#btn-offline', { timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(900);
await page.evaluate(() => {
  const cn = document.querySelector('#char-name');
  cn.value = 'Harvestwyn';
  cn.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('#offline-select .mini-class[data-class="hunter"]')?.click();
});
await sleep(200);
await page.evaluate(() => document.querySelector('#btn-start-offline').click());

let booted = false;
for (let i = 0; i < 120; i++) {
  await sleep(600);
  try {
    const ok = await page.evaluate(() => !!window.__game && window.__game.sim.entities.size > 0);
    if (ok) {
      booted = true;
      break;
    }
  } catch {
    /* context torn down during boot navigation; keep polling */
  }
}
if (!booted) {
  console.log('world never booted');
  await browser.close();
  process.exit(1);
}

await page.evaluate(() => {
  const skip = [...document.querySelectorAll('button, .tut-skip, a')].find((el) =>
    /skip tutorial/i.test(el.textContent || ''),
  );
  if (skip) skip.click();
});
await sleep(400);

const staged = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  const mob = [...sim.entities.values()].find(
    (e) => e.kind === 'mob' && e.templateId === 'forest_wolf',
  );
  if (!mob) return { error: 'no forest_wolf found in loaded zone' };
  mob.tappedById = p.id;
  mob.dead = true;
  mob.hp = 0;
  mob.aiState = 'dead';
  mob.corpseTimer = 9999;
  mob.lootable = true;
  mob.harvestClaimedBy = null;
  mob.loot = { copper: 0, items: [] };
  p.pos.x = mob.pos.x + 1.5;
  p.pos.z = mob.pos.z - 4;
  p.prevPos = { ...p.pos };
  p.facing = 0;
  g.input.camYaw = 0;
  g.input.camPitch = 0.55;
  g.input.camDist = 6;
  window.__mobId = mob.id;
  // Open the loot window directly, at a fixed screen point, exactly as a
  // click-pick on the corpse would (src/game/interactions.ts handlePickedEntity).
  g.hud.openLoot(mob.id, 900, 500);
  return {
    mob: mob.name,
    id: mob.id,
    componentTags: sim.constructor === Object ? null : undefined,
  };
});
console.log('staged:', JSON.stringify(staged));
await sleep(700);

await page.screenshot({ path: 'tmp/corpse_harvest_focus_picker.png' });
const clip = await page.evaluate(() => {
  const el = document.getElementById('loot-window');
  const r = el.getBoundingClientRect();
  const pad = 16;
  return {
    x: Math.max(0, r.x - pad),
    y: Math.max(0, r.y - pad),
    width: r.width + pad * 2,
    height: r.height + pad * 2,
  };
});
await page.screenshot({ path: 'tmp/corpse_harvest_focus_picker_crop.png', clip });
console.log(
  'screenshots written to tmp/corpse_harvest_focus_picker.png and tmp/corpse_harvest_focus_picker_crop.png',
);

await browser.close();
