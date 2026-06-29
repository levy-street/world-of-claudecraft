// In-app verification + screenshot for the Spell Power PR. Boots the offline
// client, levels a mage, stages a target dummy, casts Frostbolt, and captures the
// boosted hit as floating combat text. Prints the base-vs-Spell-Power breakdown.
// Needs `npm run dev`. Writes PNGs to tmp/.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`);
});

await page
  .goto(URL, { waitUntil: 'load', timeout: 60000 })
  .catch((e) => console.log('goto:', e.message));
await page.waitForSelector('#btn-offline', { timeout: 40000 });
await wait(300);
await page.evaluate(() => document.querySelector('#btn-offline')?.click());
await page.waitForSelector('#offline-select [data-class="mage"]', { timeout: 15000 });
await page.evaluate(() => {
  const n = document.querySelector('#char-name');
  if (n) {
    n.value = 'Jaina';
    n.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
await page.evaluate(() => document.querySelector('#offline-select [data-class="mage"]')?.click());
await wait(200);
await page.evaluate(() => document.querySelector('#btn-start-offline')?.click());
// wait for the offline sim to come up
for (let i = 0; i < 40; i++) {
  const ready = await page.evaluate(() => !!window.__game?.sim);
  if (ready) break;
  await wait(500);
}
// dismiss the new-character tutorial overlay so it doesn't cover the scene
await page.evaluate(() => {
  for (const b of document.querySelectorAll('button')) {
    if (/skip tutorial/i.test(b.textContent || '')) b.click();
  }
});
await page.evaluate(() => window.__game.sim.setPlayerLevel(20));
await wait(600);

// Stage an immortal Gravecaller Cultist dummy in front, then repeatedly cast
// Frostbolt, refreshing facing/mana, until hits land. Report the first landed hit.
const result = await page.evaluate(async () => {
  const sim = window.__game.sim;
  const p = sim.player;
  let mob = null,
    best = 1e9;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead) continue;
    const dx = e.pos.x - p.pos.x,
      dz = e.pos.z - p.pos.z;
    const d = dx * dx + dz * dz;
    if (d < best) {
      best = d;
      mob = e;
    }
  }
  if (!mob) return { ok: false, why: 'no mob nearby' };
  mob.templateId = 'gravecaller_cultist';
  mob.name = 'Training Dummy';
  mob.hostile = true;
  mob.maxHp = 1e7;
  mob.hp = 1e7;
  mob.pos.x = p.pos.x;
  mob.pos.z = p.pos.z + 10;
  mob.pos.y = p.pos.y;
  sim.targetEntity(mob.id, p.id);

  const hits = [];
  for (let c = 0; c < 10 && hits.length < 3; c++) {
    p.resource = p.maxResource;
    p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
    if (!p.castingAbility && p.gcdRemaining <= 0) sim.castAbility('frostbolt', p.id);
    const b = mob.hp;
    for (let i = 0; i < 180 && mob.hp === b; i++) await new Promise((r) => setTimeout(r, 20));
    if (mob.hp < b) hits.push(b - mob.hp);
  }
  return { ok: hits.length > 0, hits, spellPower: p.spellPower, int: p.stats.int };
});

await wait(60); // catch the latest floating combat text mid-flight
await page.screenshot({ path: 'tmp/spellpower-frostbolt.png' });

console.log('Spell Power verification:', JSON.stringify(result));
if (errors.length) console.log('PAGE ERRORS:', errors.slice(0, 5));
await browser.close();
