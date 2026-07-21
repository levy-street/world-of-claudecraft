// Screenshot the player-frame combat indicator (crossed swords + red portrait
// ring) in its out-of-combat and in-combat states. Boots the offline world,
// aggroes a nearby wild mob onto the player to engage combat, and crops the
// player unit frame for a clean before/after comparison.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

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
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.click('#btn-offline');
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Valdris');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 1500));

const clip = async (name) => {
  const el = await page.$('#player-frame');
  const box = await el.boundingBox();
  const pad = 14;
  await page.screenshot({
    path: `tmp/${name}.png`,
    clip: { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 },
  });
  console.log(`wrote tmp/${name}.png`);
};

// out of combat
await new Promise((r) => setTimeout(r, 400));
await clip('combat_indicator_off');

// aggro the nearest wild mob onto the player to enter combat
const ok = await page.evaluate(() => {
  const sim = window.__game.sim;
  const p = sim.player;
  let mob = null, d = 1e9;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead && e.hostile) {
      const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (dd < d) { d = dd; mob = e; }
    }
  }
  if (!mob) return false;
  mob.pos.x = p.pos.x + 4; mob.pos.z = p.pos.z;
  mob.aggroTargetId = p.id;
  sim.targetEntity(mob.id);
  return true;
});
console.log('aggroed mob:', ok);

// let the HUD update loop pick up the combat state and start the pulse
await new Promise((r) => setTimeout(r, 700));
await clip('combat_indicator_on');

if (errors.length) console.log('errors:', errors.join('\n'));
await browser.close();
