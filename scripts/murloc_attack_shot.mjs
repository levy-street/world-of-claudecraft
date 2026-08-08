// Before/after capture for mob_murloc's bespoke Murloc_Attack clip (issue
// #2889 round 2, scripts/build_murloc_anims.mjs). Spawns a bog_bloat (the
// MOB_KEYS template that resolves to the mob_murloc visual) next to an
// offline player and lets it close in and swing.
//   BROWSER_PATH=... MODE=before node scripts/murloc_attack_shot.mjs
//   BROWSER_PATH=... MODE=after  node scripts/murloc_attack_shot.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const MODE = process.env.MODE ?? 'after';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--window-size=1280,760',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  defaultViewport: { width: 1280, height: 760 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
const booted = await enterOfflineGame(page, { charClass: 'warrior', charName: 'Fenwick' });
console.log('offline boot:', booted);
await page.evaluate(() => document.querySelector('.gpu-notice-dismiss')?.click());
await sleep(600);

await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.setPlayerLevel(15);
  sim.player.gm = true;
  sim.player.maxHp = 99999;
  sim.player.hp = 99999;
  sim.chat('/dev spawn bog_bloat');
});
await sleep(500);

await page.evaluate(() => {
  const sim = window.__game.sim;
  const me = sim.player;
  let nearest = null;
  let best = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead) continue;
    const d = (e.pos.x - me.pos.x) ** 2 + (e.pos.z - me.pos.z) ** 2;
    if (d < best) {
      best = d;
      nearest = e;
    }
  }
  if (nearest) {
    nearest.pos = {
      x: me.pos.x + Math.sin(me.facing) * 3,
      y: me.pos.y,
      z: me.pos.z + Math.cos(me.facing) * 3,
    };
    sim.targetEntity(nearest.id);
    nearest.autoAttack = true;
    nearest.targetId = me.id;
  }
});
await sleep(1200);

await page.screenshot({ path: `tmp/murloc-attack-${MODE}.png` });
console.log(`wrote tmp/murloc-attack-${MODE}.png`);
await browser.close();
