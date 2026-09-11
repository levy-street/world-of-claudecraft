// Before/after screenshots for the pet boss body-pull fix: a DEFENSIVE pet heeling a
// couple of yards ahead of its owner used to body-pull an idle boss on its own
// (pullNearbyMobs in src/sim/pet/pet_ai.ts ran the mob detection formula from the
// PET's position, boss templates included), so the boss chased the pet and the pet
// "defended" against the fight it had just started as the group walked into the room.
// Bosses are now excluded from the pet's proximity pull; the encounter still starts on
// a player, or on a deliberate pet order.
//
// Offline flow (no server). Needs `npm run dev`. Writes PNGs to tmp/.
// GAME_URL, e.g.: GAME_URL=http://localhost:5279 SHOT_TAG=after node
// scripts/pet_boss_body_pull_shot.mjs
// The script is identical for both arms: the BEFORE shot is captured with
// src/sim/pet/pet_ai.ts checked out from the base commit (restart Vite with --force
// after the flip, its transform cache is otherwise stale), the AFTER shot on the branch.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const TAG = process.env.SHOT_TAG ?? 'shot';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
// Standing capture rule: seed the LOWEST graphics preset before the app boots.
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
});
await page.setViewport({ width: 1600, height: 960 });
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`);
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await enterOfflineGame(page, { charClass: 'hunter', charName: 'Wren', settleMs: 3000 });
await new Promise((r) => setTimeout(r, 500));
await page
  .waitForFunction(
    () => !document.querySelector('#loading-screen')?.classList.contains('visible'),
    { timeout: 30000 },
  )
  .catch(() => {});

// Stage the room entry: the hunter stops one step OUTSIDE the boss's 20 yd detection
// cap, the defensive pet heels two yards ahead (INSIDE its own 20 yd pull floor), and
// every other wild mob nearby is removed so the shot isolates the pet-vs-boss rule.
const staged = await page.evaluate(() => {
  const { sim } = window.__game;
  const player = sim.player;
  const dist2d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const wild = [...sim.entities.values()].filter(
    (e) => e.kind === 'mob' && !e.dead && e.ownerId === null && !e.templateId.startsWith('vision_'),
  );
  if (wild.length < 2) return null;
  let pet = [...sim.entities.values()].find((e) => e.kind === 'mob' && e.ownerId === player.id);
  const petSrc = pet ?? wild.shift();
  petSrc.ownerId = player.id;
  petSrc.hostile = false;
  petSrc.petMode = 'defensive';
  petSrc.hp = petSrc.maxHp;
  pet = petSrc;
  const boss = wild.find((e) => e.id !== pet.id);
  boss.templateId = 'nythraxis_scourge_of_thornpeak';
  boss.level = 40;
  boss.hostile = true;
  boss.aiState = 'idle';
  boss.aggroTargetId = null;
  boss.inCombat = false;
  boss.hp = boss.maxHp;
  player.level = 40;
  pet.level = 40;
  // Lay the scene out along the camera's look direction so the boss is in frame.
  const { renderer } = window.__game;
  const fwd = { x: 0, z: 0 };
  {
    const v = renderer.camera.getWorldDirection(new renderer.camera.position.constructor());
    const len = Math.hypot(v.x, v.z) || 1;
    fwd.x = v.x / len;
    fwd.z = v.z / len;
  }
  const base = player.pos;
  const at = (d) => sim.groundPos(base.x + fwd.x * d, base.z + fwd.z * d);
  const pPos = at(0);
  const petPos = at(2);
  const bPos = at(21);
  player.pos = { ...pPos };
  player.prevPos = { ...pPos };
  player.facing = Math.atan2(fwd.x, fwd.z);
  pet.pos = { ...petPos };
  pet.prevPos = { ...petPos };
  boss.pos = { ...bPos };
  boss.prevPos = { ...bPos };
  boss.spawnPos = { ...bPos }; // the Nythraxis idle branch snaps to spawnPos each tick
  boss.leashAnchor = { ...bPos };
  boss.facing = Math.atan2(-fwd.x, -fwd.z);
  // The GPU-acceleration notice is a headless-only artifact: dismiss it for the shot.
  for (const b of document.querySelectorAll('button')) {
    if (b.textContent?.trim() === 'Dismiss') b.click();
  }
  for (const [id, e] of sim.entities) {
    if (
      e.kind === 'mob' &&
      e.id !== boss.id &&
      e.id !== pet.id &&
      e.ownerId === null &&
      dist2d(e.pos, player.pos) < 80
    )
      sim.entities.delete(id);
  }
  sim.grid.refresh(sim.entities.values());
  player.targetId = boss.id; // show the boss in the target frame
  return { petId: pet.id, bossId: boss.id };
});
if (!staged) throw new Error('not enough wild mobs to stage a pet and a boss');

// 4 s of ticks: plenty for the pet's proximity pull (or its absence) to resolve and
// for a pulled pet to have visibly closed on the boss.
await new Promise((r) => setTimeout(r, 4200));
await page.evaluate(() => {
  document.querySelector('#loading-screen')?.classList.remove('visible', 'fade');
});

await page.screenshot({ path: `tmp/pet_boss_body_pull_${TAG}_wide.png` });

const state = await page.evaluate((ids) => {
  const { sim } = window.__game;
  const pet = sim.entities.get(ids.petId);
  const boss = sim.entities.get(ids.bossId);
  const dist2d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  return {
    petMode: pet?.petMode,
    petInCombat: pet?.inCombat,
    petTarget: pet?.aggroTargetId,
    petToBossYd: pet && boss ? Number(dist2d(pet.pos, boss.pos).toFixed(1)) : null,
    ownerToBossYd: boss ? Number(dist2d(sim.player.pos, boss.pos).toFixed(1)) : null,
    bossAiState: boss?.aiState,
    bossTarget: boss?.aggroTargetId,
    bossInCombat: boss?.inCombat,
    playerInCombat: sim.player.inCombat,
  };
}, staged);
console.log(TAG, JSON.stringify(state));

if (errors.length) console.log(`PAGE ERRORS:\n${errors.join('\n')}`);
await browser.close();
console.log('done');
