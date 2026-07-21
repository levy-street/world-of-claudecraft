// Screenshot tour: Wraithbinder Maldrec, the rare elite undead at the Fallen
// Chapel (Eastbrook Vale). Boots the offline client, teleports to the chapel,
// god-modes the player, and captures the encounter — the Grave Chill nova, the
// raised Restless Bones adds, and the elite nameplate. Needs `npm run dev`.
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
// Pick "Offline" from the server-select dropdown, then Play → offline char setup.
await page.click('#server-select-trigger');
await new Promise((r) => setTimeout(r, 150));
await page.click('#server-opt-offline');
await new Promise((r) => setTimeout(r, 150));
await page.click('#btn-play');
await new Promise((r) => setTimeout(r, 400));
await page.type('#char-name', 'Lightbringer');
const picked = await page.evaluate(() => {
  const el = document.querySelector('#offline-select [data-class="warrior"]');
  if (el) { el.click(); return true; }
  return false;
});
console.log('class picked:', picked);
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 1500));

// Level up so the lvl-7 elite is a fair fight to stand next to, then god-mode.
await page.evaluate(() => window.__game.sim.setPlayerLevel(12));

const setup = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  let boss = null;
  for (const e of sim.entities.values()) {
    if (e.templateId === 'wraithbinder_maldrec') boss = e;
  }
  if (!boss) return { ok: false };
  // Stand the player a short way off the boss so third-person camera frames both.
  p.pos.x = boss.pos.x - 6; p.pos.z = boss.pos.z - 6;
  p.pos.y = boss.pos.y;
  p.maxHp = 100000; p.hp = 100000; // god-mode the camera operator
  sim.targetEntity(boss.id);
  p.facing = Math.atan2(boss.pos.x - p.pos.x, boss.pos.z - p.pos.z);
  g.input.camYaw = p.facing;
  g.input.camDist = 11;
  return { ok: true, bossId: boss.id, name: boss.name, hp: boss.hp, level: boss.level };
});
console.log('boss found:', JSON.stringify(setup));
if (!setup.ok) { console.log('FAIL: wraithbinder_maldrec not spawned'); await browser.close(); process.exit(1); }

await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: 'tmp/wb_01_approach.png' });

// Engage: swing until the boss drops below the first summon threshold so the
// raised Restless Bones adds appear, and the Grave Chill nova has pulsed.
let adds = 0, pulses = 0, low = false;
for (let i = 0; i < 80; i++) {
  const s = await page.evaluate(({ id, i }) => {
    const g = window.__game;
    const sim = g.sim;
    const p = sim.player;
    const b = sim.entities.get(id);
    if (!b || b.dead) return { dead: true };
    p.hp = p.maxHp;
    if (p.targetId !== id) sim.targetEntity(id);
    p.facing = Math.atan2(b.pos.x - p.pos.x, b.pos.z - p.pos.z);
    // chip the boss down slowly so we linger in the add/nova phase
    if (i % 3 === 0) b.hp = Math.max(b.maxHp * 0.45, b.hp - b.maxHp * 0.05);
    let summoned = 0;
    for (const e of sim.entities.values()) {
      if (e.templateId === 'restless_bones' && !e.dead) {
        const d = Math.hypot(e.pos.x - b.pos.x, e.pos.z - b.pos.z);
        if (d < 10) summoned++;
      }
    }
    return { dead: false, hpPct: b.hp / b.maxHp, summoned };
  }, { id: setup.bossId, i });
  if (s.dead) break;
  adds = Math.max(adds, s.summoned);
  if (s.hpPct <= 0.5) low = true;
  if (low && adds >= 2) break;
  await new Promise((r) => setTimeout(r, 250));
}
console.log('phase reached — nearby restless bones:', adds);
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: 'tmp/wb_02_summons.png' });

// Tight nameplate/target-frame shot.
await page.evaluate(() => { window.__game.input.camDist = 8; });
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: 'tmp/wb_03_nameplate.png' });

console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 10).join('\n') : 'no page errors');
await browser.close();
