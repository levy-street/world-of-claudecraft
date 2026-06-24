// Visual capture motivating the "dead party members lose all loot" fix.
// Boots the offline game at MAX graphics (?gfx=ultra), slays a nearby mob so a
// lootable corpse is present, downs the player (corpse on the ground), and
// frames both: the moment a fallen group member returns to claim the loot the
// old eligibility gate silently denied them.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = (process.env.GAME_URL ?? 'http://localhost:5173') + '/?gfx=ultra';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('#btn-offline', { timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await new Promise((r) => setTimeout(r, 900));
await page.evaluate(() => {
  const cn = document.querySelector('#char-name');
  cn.value = 'Aelricc';
  cn.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('#offline-select .mini-class[data-class="warrior"]').click();
});
await new Promise((r) => setTimeout(r, 200));
await page.evaluate(() => document.querySelector('#btn-start-offline').click());

let booted = false;
for (let i = 0; i < 120; i++) {
  await new Promise((r) => setTimeout(r, 600));
  try {
    const ok = await page.evaluate(() => !!window.__game && window.__game.sim.entities.size > 0);
    if (ok) { booted = true; break; }
  } catch { /* context torn down during boot navigation; keep polling */ }
}
if (!booted) { console.log('world never booted'); await browser.close(); process.exit(1); }

// dismiss the first-run tutorial banner so it does not cover the frame
await page.evaluate(() => {
  const skip = [...document.querySelectorAll('button, .tut-skip, a')].find((el) => /skip tutorial/i.test(el.textContent || ''));
  if (skip) skip.click();
});
await new Promise((r) => setTimeout(r, 400));

const staged = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  // nearest hostile mob
  const mob = [...sim.entities.values()]
    .filter((e) => e.kind === 'mob' && e.hostile && !e.dead)
    .sort((a, b) => Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z) - Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z))[0];
  if (!mob) return { error: 'no mob found' };
  // slay it and leave a guaranteed lootable corpse
  mob.tappedById = p.id;
  mob.dead = true; mob.hp = 0; mob.aiState = 'dead';
  mob.corpseTimer = 9999; mob.lootable = true;
  mob.loot = { copper: 137, items: [] };
  // stand the player on the corpse, camera looking down at the loot moment
  p.pos.x = mob.pos.x + 1.5;
  p.pos.z = mob.pos.z - 4;
  p.prevPos = { ...p.pos };
  p.facing = 0;
  g.input.camYaw = 0;
  g.input.camPitch = 0.55;
  g.input.camDist = 7;
  window.__mobId = mob.id;
  return { mob: mob.name, id: mob.id };
});
console.log('staged:', JSON.stringify(staged));

await new Promise((r) => setTimeout(r, 1600));
await page.evaluate(() => {
  const g = window.__game;
  const p = g.sim.player;
  const mob = g.sim.entities.get(window.__mobId);
  if (mob) { p.pos.x = mob.pos.x + 1.5; p.pos.z = mob.pos.z - 4; }
  p.facing = 0;
  g.input.camYaw = 0;
  g.input.camPitch = 0.55;
  g.input.camDist = 7;
});
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: 'tmp/dead_party_loot.png' });
console.log('saved tmp/dead_party_loot.png');
await browser.close();
