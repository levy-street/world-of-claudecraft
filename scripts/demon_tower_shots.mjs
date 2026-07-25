// Demon Tower PR screenshots: the tower door in Thornpeak Heights and a floor
// arena mid-wave, on desktop and on a phone viewport.
//
// Drives the real offline game through window.__game (the pattern every other
// shot script here uses) rather than faking a scene: the arena, the core, the
// waves, and the demons are all produced by the shipping sim + renderer, so a
// broken wiring shows up in the capture instead of being hidden by a fixture.
//
// Needs `npm run dev` on :5173. Writes PNGs into docs/screenshots/demon-tower/.

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const GAME_URL = process.env.GAME_URL ?? 'http://localhost:5173/';
const OUT = path.resolve('docs/screenshots/demon-tower');
// Must match DEMON_TOWER_SEED in src/sim/content/rift/demon_tower.ts.
const DEMON_TOWER_SEED = 0x70b3_0000;

const DESKTOP = { width: 1600, height: 900, deviceScaleFactor: 1 };
const MOBILE = { width: 430, height: 932, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Put the player at the tower door and settle the camera. */
async function gotoTowerDoor(page) {
  return page.evaluate(() => {
    const sim = window.__game.sim;
    const p = sim.player;
    sim.setPlayerLevel(20);
    p.devGod = true;
    // The door is minted lazily on the first overworld rift trigger; tick once
    // so it exists, then walk the player onto it.
    sim.tick();
    const door = [...sim.entities.values()].find(
      (e) => e.templateId === 'rift_portal' && e.riftSeed === 0x70b30000,
    );
    if (!door) return { ok: false, why: 'no tower door' };
    p.pos = { x: door.pos.x, y: door.pos.y, z: door.pos.z - 9 };
    p.prevPos = { ...p.pos };
    p.facing = 0;
    for (let i = 0; i < 4; i++) sim.tick();
    return { ok: true, x: door.pos.x, z: door.pos.z };
  });
}

/** Enter the tower and advance to `floorIndex`, leaving a live wave on screen. */
async function enterTowerFloor(page, floorIndex) {
  return page.evaluate((target) => {
    const sim = window.__game.sim;
    const p = sim.player;
    p.devGod = true;
    sim.enterRift(0x70b30000, 28, p.id);
    const inst = sim.riftInstances.find((i) => i.partyKey !== null);
    if (!inst) return { ok: false, why: 'no instance' };
    // Climb by clearing floors outright; we only want the CAMERA on `target`.
    let guard = 0;
    while (inst.floorIndex < target && guard++ < 400) {
      for (let i = 0; i < 22; i++) sim.tick();
      for (const id of inst.towerWaveMobIds) {
        const e = sim.entities.get(id);
        if (e) {
          e.hp = 0;
          e.dead = true;
        }
      }
      if (inst.towerBossId !== null) {
        const b = sim.entities.get(inst.towerBossId);
        if (b) {
          b.hp = 0;
          b.dead = true;
        }
      }
      if (inst.descentOpen && inst.descentId !== null) {
        const d = sim.entities.get(inst.descentId);
        if (d) {
          p.pos = { ...d.pos };
          p.prevPos = { ...p.pos };
        }
      }
    }
    // Let the floor send a live wave, then stand the player INSIDE the arena,
    // south of the core and facing it, so the shot frames the centrepiece and
    // the ring of demons rather than the outside of the wall.
    for (let i = 0; i < 26; i++) sim.tick();
    const core = inst.towerCoreId != null ? sim.entities.get(inst.towerCoreId) : null;
    if (core) {
      p.pos = { x: core.pos.x, y: core.pos.y, z: core.pos.z - 13 };
      p.prevPos = { ...p.pos };
      p.facing = 0; // north, toward the core
    }
    for (let i = 0; i < 8; i++) sim.tick();
    return {
      ok: true,
      floor: inst.floorIndex + 1,
      wave: inst.towerWave,
      alive: inst.towerWaveMobIds.filter((id) => {
        const e = sim.entities.get(id);
        return e && !e.dead;
      }).length,
    };
  }, floorIndex);
}

async function shoot(page, name) {
  mkdirSync(OUT, { recursive: true });
  // The headless swiftshader path raises a "no GPU acceleration" notice; that is
  // an artifact of the capture environment, not of this change, so it never
  // belongs in a committed shot.
  await page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      const label = (b.textContent ?? '').trim().toLowerCase();
      // "dismiss" is the software-rendering notice; "confirm" is the camera
      // prompt, which can re-appear after a reload. Neither belongs in a shot.
      if (label === 'dismiss' || label === 'confirm') b.click();
    }
  });
  await sleep(1600);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  wrote ${name}.png`);
}

async function run(label, viewport) {
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    args: ['--use-angle=swiftshader', '--no-sandbox', '--enable-unsafe-swiftshader'],
    defaultViewport: viewport,
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));
  await page.goto(GAME_URL, { waitUntil: 'networkidle2', timeout: 90000 });
  await enterOfflineGame(page, {});
  await sleep(2500);

  const door = await gotoTowerDoor(page);
  console.log(`${label} door:`, JSON.stringify(door));
  await shoot(page, `after-${label}-door`);

  const floor1 = await enterTowerFloor(page, 0);
  console.log(`${label} floor1:`, JSON.stringify(floor1));
  await shoot(page, `after-${label}-floor1`);

  await page.reload({ waitUntil: 'networkidle2', timeout: 90000 });
  await enterOfflineGame(page, {});
  await sleep(2500);
  const floor8 = await enterTowerFloor(page, 7);
  console.log(`${label} floor8:`, JSON.stringify(floor8));
  await shoot(page, `after-${label}-floor8`);

  await browser.close();
}

await run('desktop', DESKTOP);
await run('mobile', MOBILE);
console.log(`done -> ${OUT}`);
