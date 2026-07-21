// Screenshot harness for the "Death Throes" content: a volatile Bog Bloat whose
// corpse swells for a telegraphed delay, then bursts for area damage. Drives the
// offline client via window.__game.sim — no server needed. Saves PNGs to shots/.
//
// Usage: with `npm run dev` running, `node scripts/shot_death_throes.mjs`.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('shots', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
  protocolTimeout: 180000,
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Aria');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 2500));

// Repurpose the nearest wild mob into a Bog Bloat right beside the player so the
// death-throes mechanic fires in view (reaching the marsh proper isn't needed to
// demonstrate the mechanic). The sim auto-ticks via the render loop.
const setup = await page.evaluate(() => {
  const sim = window.__game.sim;
  const p = sim.player;
  let mob = null, best = 1e9;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && e.ownerId === null && !e.dead) {
      const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (d < best) { best = d; mob = e; }
    }
  }
  mob.templateId = 'bog_bloat';
  mob.name = 'Bog Bloat';
  mob.pos.x = p.pos.x; mob.pos.z = p.pos.z + 5; // 5yd in front, inside the 8yd blast
  mob.prevPos = { ...mob.pos };
  mob.maxHp = 600; mob.hp = 600;
  sim.targetEntity(mob.id);
  return { id: mob.id, hp: p.hp, maxHp: p.maxHp };
});
console.log('setup:', JSON.stringify(setup));

// Zoom the third-person camera in close so the corpse + VFX fill the frame.
const cv = await page.$('canvas');
const box = await cv.boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
await page.mouse.move(cx, cy);
for (let i = 0; i < 14; i++) { await page.mouse.wheel({ deltaY: -120 }); await new Promise((r) => setTimeout(r, 30)); }
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: 'shots/01_bog_bloat.png' });

// Slay it: this arms the fuse and emits the "begins to swell — get clear!" log.
await page.evaluate((id) => {
  const sim = window.__game.sim;
  const mob = sim.entities.get(id);
  sim.dealDamage(sim.player, mob, mob.hp + 1000, false, 'physical', null, 'hit', true);
}, setup.id);
await new Promise((r) => setTimeout(r, 700)); // mid-fuse: the swelling telegraph
await page.screenshot({ path: 'shots/02_swelling.png' });

// Poll for the HP drop so we catch the burst frame while the nova is still lit.
let took = false;
for (let i = 0; i < 40; i++) {
  const hp = await page.evaluate(() => window.__game.sim.player.hp);
  if (hp < setup.hp) { took = true; break; }
  await new Promise((r) => setTimeout(r, 50));
}
await page.screenshot({ path: 'shots/03_burst.png' });

// Tight crop of the combat log showing the two new lines.
const log = await page.$('#chatlog-wrap');
if (log) await log.screenshot({ path: 'shots/04_combatlog.png' });

const after = await page.evaluate(() => {
  const p = window.__game.sim.player;
  return { hp: p.hp, maxHp: p.maxHp };
});
console.log('player hp after burst:', JSON.stringify(after), took ? 'TOOK BLAST' : 'no damage seen');

await browser.close();
console.log('saved shots/01_bog_bloat.png, shots/02_swelling.png, shots/03_burst.png');
