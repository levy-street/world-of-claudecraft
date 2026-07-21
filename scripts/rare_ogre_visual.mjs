// Screenshots of the new rare ogre (Brutok Skullsmasher) for the PR.
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
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.click('#btn-offline');
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Thorgar');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 3000));

// Level the player up to match the lvl-17 rare (so the nameplate isn't red-capped),
// stand beside Brutok in the Thornpeak crags, and target him so the elite
// nameplate + name show. recalcPlayerStats runs every tick and would reset an
// hp override, so we re-pin level/hp each frame via a setInterval in-page.
const found = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  const b = [...sim.entities.values()].find((e) => e.templateId === 'brutok_skullsmasher' && !e.dead);
  if (!b) return false;
  p.pos.x = b.pos.x + 4.5; p.pos.z = b.pos.z + 4.5;
  p.pos.y = b.pos.y;
  p.facing = Math.atan2(b.pos.x - p.pos.x, b.pos.z - p.pos.z);
  window.__pin = setInterval(() => {
    p.level = 20;
    p.maxHp = 999999; p.hp = 999999;
    // Offset the camera yaw from the facing so the ogre sits off-centre and
    // isn't occluded by the player sprite; pull in a little for a readable name.
    g.input.camYaw = p.facing + 0.55;
    g.input.camPitch = 0.26;
    g.input.camDist = 10;
  }, 16);
  sim.targetEntity(b.id);
  return { name: b.name, level: b.level, hp: b.maxHp };
});
console.log('brutok:', JSON.stringify(found));
await new Promise((r) => setTimeout(r, 1400));
await page.screenshot({ path: 'tmp/brutok_01_nameplate.png' });

// Engage for a combat shot — pinned god-mode means he can't win, and his
// Skull Smash pulse / enrage fire while we trade blows.
await page.evaluate(() => { window.__game.sim.startAutoAttack(); });
await new Promise((r) => setTimeout(r, 2800));
await page.screenshot({ path: 'tmp/brutok_02_combat.png' });

console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 15).join('\n') : 'no page errors');
await browser.close();
