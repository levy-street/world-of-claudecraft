// Before/after capture for the warlock demon pet family's bespoke
// Demon_Attack clip (issue #2889 round 2, scripts/build_demon_anims.mjs).
// Spawns an emberkin (mob_demon) and a warlock_voidwalker (mob_demonalt),
// the two MOB_KEYS templates the new attack now serves, next to an offline
// player and lets each close in and swing.
//   BROWSER_PATH=... MODE=before node scripts/demon_attack_shot.mjs
//   BROWSER_PATH=... MODE=after  node scripts/demon_attack_shot.mjs
//
// Framing (fix-round finding): the default chase camera sits directly
// behind the player looking along its facing, so a mob placed straight
// ahead along that same facing line renders almost entirely behind the
// player's own body. Offsetting the mob to the player's side (not just
// forward) AND rotating the camera to a 3/4 angle keeps the mob's full
// silhouette in frame instead of hidden behind the player. setPlayerLevel
// above also queues several deed-unlock celebration banners that land on
// the HUD's single #banner slot in sequence, and an ambient banner (a
// "new mail" notice, a zone name) can claim the same slot the instant an
// older one is hidden: a one-shot opacity flip right before the screenshot
// still raced a fresh arrival in testing. A permanent CSS override
// (injected once, right after boot) keeps the slot invisible for the rest
// of the session instead of chasing each new banner.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const MODE = process.env.MODE ?? 'after';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shootOne(page, templateId, label) {
  await page.evaluate((id) => {
    const sim = window.__game.sim;
    sim.chat(`/dev despawn spawned`);
    sim.chat(`/dev spawn ${id}`);
  }, templateId);
  await sleep(500);

  await page.evaluate(() => {
    const sim = window.__game.sim;
    const g = window.__game;
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
      const fwdX = Math.sin(me.facing);
      const fwdZ = Math.cos(me.facing);
      const rightX = Math.cos(me.facing);
      const rightZ = -Math.sin(me.facing);
      nearest.pos = {
        x: me.pos.x + fwdX * 2.2 + rightX * 2.0,
        y: me.pos.y,
        z: me.pos.z + fwdZ * 2.2 + rightZ * 2.0,
      };
      sim.targetEntity(nearest.id);
      nearest.autoAttack = true;
      nearest.targetId = me.id;

      // Rotate to a 3/4 view and pull in a touch so the mob's full body and
      // its attack silhouette read clearly instead of sitting small and
      // dead-center behind the player.
      g.input.camYaw = me.facing - 0.85;
      g.input.camPitch = 0.22;
      g.input.camDist = 8.5;
    }
  });
  await sleep(1200);

  await page.screenshot({ path: `tmp/demon-attack-${label}-${MODE}.png` });
  console.log(`wrote tmp/demon-attack-${label}-${MODE}.png`);
}

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
const booted = await enterOfflineGame(page, { charClass: 'warlock', charName: 'Mortcaller' });
console.log('offline boot:', booted);
await page.evaluate(() => document.querySelector('.gpu-notice-dismiss')?.click());
await sleep(600);

// Permanently suppress the HUD's single #banner slot: setPlayerLevel below
// queues several deed-unlock celebration banners, and once one is hidden an
// ambient banner (new mail, zone name) can claim the freed slot the very
// next frame, so a one-shot hide right before the screenshot still raced a
// fresh arrival. A standing CSS override needs no timing at all.
await page.evaluate(() => {
  const style = document.createElement('style');
  style.textContent = '#banner { opacity: 0 !important; }';
  document.head.appendChild(style);
});

await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.setPlayerLevel(15);
  sim.player.gm = true;
  sim.player.maxHp = 99999;
  sim.player.hp = 99999;
});

await shootOne(page, 'emberkin', 'emberkin');
await shootOne(page, 'warlock_voidwalker', 'voidwalker');

await browser.close();
