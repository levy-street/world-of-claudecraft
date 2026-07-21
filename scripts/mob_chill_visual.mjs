// Visual capture for the Stormcrag Elemental's "Numbing Chill" on-hit slow.
// Boots the offline game, finds a Stormcrag Elemental, god-modes the player,
// forces swings until the chill debuff lands, and screenshots the HUD.
// Needs `npm run dev` (:5173). Writes PNGs to tmp/.
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
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Frostbit');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 2500));

// Find a Stormcrag Elemental, stand in melee, and go invulnerable so the
// camera survives the beating while we wait for the proc.
const setup = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  let mob = null, d = 1e9;
  for (const e of sim.entities.values()) {
    if (e.templateId === 'stormcrag_elemental' && !e.dead) {
      const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (dd < d) { d = dd; mob = e; }
    }
  }
  if (!mob) return { found: false };
  p.pos.x = mob.pos.x + 2; p.pos.z = mob.pos.z;
  p.pos.y = mob.pos.y;
  p.maxHp = 100000; p.hp = 100000; // survive the swings
  sim.targetEntity(mob.id);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  g.input.camYaw = p.facing;
  return { found: true, mobId: mob.id, mobLevel: mob.level, mobName: mob.name };
});
console.log('setup:', JSON.stringify(setup));
if (!setup.found) { console.log('No Stormcrag Elemental found in the offline world'); await browser.close(); process.exit(1); }

// Force swings until the Numbing Chill debuff appears on the player.
const proc = await page.evaluate((mobId) => {
  const sim = window.__game.sim;
  const mob = sim.entities.get(mobId);
  const p = sim.player;
  for (let i = 0; i < 400; i++) {
    sim.mobSwing(mob, p);
    p.hp = p.maxHp; // keep topped up
    const a = p.auras.find((x) => x.name === 'Numbing Chill');
    if (a) {
      // Step clear of the elemental so the live loop stops the beating; the
      // 6-second chill aura rides along and stays on the buff bar for the shot.
      p.pos.z += 60; p.prevPos = { ...p.pos };
      return { chilled: true, swings: i + 1, remaining: a.remaining, value: a.value };
    }
  }
  return { chilled: false };
}, setup.mobId);
console.log('proc:', JSON.stringify(proc));

await new Promise((r) => setTimeout(r, 150));
await page.screenshot({ path: 'tmp/chill_full.png' });
// Crop tightly around the player buff/debuff bar so the Numbing Chill icon reads.
const rect = await page.evaluate(() => {
  const el = document.querySelector('#buff-bar');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});
console.log('buff-bar rect:', JSON.stringify(rect));
if (rect && rect.width > 4 && rect.height > 4) {
  await page.screenshot({ path: 'tmp/chill_hud.png', clip: {
    x: 1300, y: 0, width: 300, height: 130,
  } });
}
console.log('saved tmp/chill_full.png and tmp/chill_hud.png');

await browser.close();
process.exit(proc.chilled ? 0 : 2);
