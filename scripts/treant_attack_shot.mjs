// Before/after capture for mob_treant's bespoke Treant_Attack clip (issue
// #2889 round 2, scripts/build_treant_anims.mjs). Spawns an orchard_treant
// (the MOB_KEYS template that resolves to the mob_treant visual) next to an
// offline player and lets it close in and swing.
//   BROWSER_PATH=... MODE=before node scripts/treant_attack_shot.mjs
//   BROWSER_PATH=... MODE=after  node scripts/treant_attack_shot.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5186';
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

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
const booted = await enterOfflineGame(page, {
  charClass: 'warrior',
  charName: 'Fenwick',
  gameBootTimeoutMs: 90000,
  selectorTimeoutMs: 60000,
  settleMs: 4000,
});
console.log('offline boot:', booted);
if (!booted) {
  await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 60000 });
}
await page.evaluate(() => document.querySelector('.gpu-notice-dismiss')?.click());
await sleep(4000); // let any deed-accomplished toasts from world entry clear first

await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.setPlayerLevel(15);
  sim.player.gm = true;
  sim.player.maxHp = 99999;
  sim.player.hp = 99999;
  sim.chat('/dev spawn orchard_treant 1');
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
      x: me.pos.x + Math.sin(me.facing) * 5,
      y: me.pos.y,
      z: me.pos.z + Math.cos(me.facing) * 5,
    };
    sim.targetEntity(nearest.id);
    nearest.autoAttack = true;
    nearest.targetId = me.id;
  }
  window.__game.input.camPitch = 0.1;
  window.__game.input.camDist = 11;
});
await sleep(1500);

await page.screenshot({ path: `tmp/treant-attack-${MODE}.png` });
console.log(`wrote tmp/treant-attack-${MODE}.png`);
await browser.close();
