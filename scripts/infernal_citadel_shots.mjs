// Infernal Citadel visual E2E: enter offline, open the authored set-piece rift via
// `/dev portal`, and screenshot each of its eight rooms plus both bosses and
// the Blood Orb states, to eyeball the layout and confirm the authored render path
// (rooms, doors, Tripo decor, pentagram) throws nothing.
// Needs `npm run dev` running (offline enables devCommands in the vite dev server).

import fs from 'node:fs';
import { chromium } from 'playwright';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5174';
const OUT = process.env.SHOT_DIR ?? 'tmp/citadel';
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
// One viewport per run (a mid-run setViewport with isMobile tears down the page
// context and loses window.__game): pass MOBILE=1 for the landscape-phone pass.
const mobile = process.env.MOBILE === '1';
const vp = mobile
  ? { width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
  : { width: 1280, height: 760 };
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [
    `--window-size=${vp.width},${vp.height}`,
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});
const context = await browser.newContext({
  viewport: { width: vp.width, height: vp.height },
  deviceScaleFactor: vp.deviceScaleFactor,
  isMobile: vp.isMobile ?? false,
  hasTouch: vp.hasTouch ?? false,
});
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`);
});

console.log('loading + entering offline...');
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
// The shared entry helper drives Play Offline -> name -> class -> Enter World and
// dismisses the touch preflight, which the phone viewport gates the world behind.
await enterOfflineGame(page, { charName: 'Pactbreaker', settleMs: 2500 });
await page.waitForFunction(() => !!window.__game?.world?.player, { timeout: 30000, polling: 200 });
await page
  .locator('.tut-skip')
  .click()
  .catch(() => {});
await page.evaluate(() => {
  const w = window.__game.world;
  w.chat('/dev level 22', w.player.id);
  w.chat('/dev god', w.player.id);
});

async function tick(frames = 40) {
  await page.evaluate(async (n) => {
    for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
  }, frames);
}

// Force the authored set piece through the same dev command a playtester uses, then
// cross the spawned portal. The command searches forward if the requested seed is
// not infernal, so read the resulting floor descriptor rather than assuming it.
const seed = Number(process.env.CITADEL_SEED ?? 5);
await page.evaluate((s) => {
  const w = window.__game.world;
  w.chat(`/dev portal ${s} 22 A infernal`, w.player.id);
  const portals = [...w.entities.values()].filter((e) => e.templateId === 'rift_portal');
  const portal = portals.at(-1);
  if (!portal) throw new Error('/dev portal did not spawn an entrance');
  w.player.pos = { ...portal.pos };
  w.player.prevPos = { ...portal.pos };
  w.rebucket(w.player);
}, seed);
await tick(70);

const floor = await page.evaluate(() => window.__game.world.riftFloor);
console.log(`entered: ${JSON.stringify(floor)}`);

/** Park the camera at an instance-local spot looking along `facing`, then shoot. */
async function shoot(label, lx, lz, facing = 0) {
  await page.evaluate(
    ({ x, z, f }) => {
      const w = window.__game.world;
      const origin = window.__riftOrigin;
      w.player.pos = { x: origin.x + x, y: w.player.pos.y, z: origin.z + z };
      w.player.prevPos = { ...w.player.pos };
      w.player.facing = f;
      w.player.hp = w.player.maxHp;
    },
    { x: lx, z: lz, f: facing },
  );
  await tick(35);
  const active = await page.evaluate(() => window.__game.world.riftFloor !== null);
  if (!active) throw new Error(`left the rift before ${label}`);
  await page.screenshot({ path: `${OUT}/${label}.png` });
  console.log(`shot ${label} at (${lx}, ${lz})`);
}

// Publish the instance origin once so `shoot` can work in instance-local coords.
await page.evaluate(() => {
  const w = window.__game.world;
  // The player spawned at the floor's entry (0, -24): origin = pos - entry.
  window.__riftOrigin = { x: w.player.pos.x, z: w.player.pos.z + 24 };
});

await shoot('01_entrance', 0, -20, 0);
await shoot('02_sacrificial_hall', 0, -8, 0);
await shoot('03_altar_orb_dormant', 0, 18, 0);
await shoot('04_relic_gallery', 27, -1, 0);
await shoot('05_west_gallery', -27, 0, 0);
await shoot('06_pentagram_miniboss', -27, 28, 0); // look north onto the sigil

// Clear the west wing through the real damage/death funnel. `/dev smite` makes
// each player hit lethal, preserving the same progression hooks as live combat.
await page.evaluate(() => {
  const w = window.__game.world;
  w.chat('/dev smite', w.player.id);
  const inst = w.riftInstances.find((i) => i.partyKey !== null);
  for (const id of inst.mobIds) {
    if (id === inst.bossId) continue;
    const mob = w.entities.get(id);
    if (mob && !mob.dead) {
      w.dealDamage(w.player, mob, 1, false, 'physical', 'Dev Smite', 'hit');
    }
  }
});
await tick(45); // let the 1 Hz driver arm the orb
await shoot('07_altar_orb_active', 0, 18, 0);

// Touch it: the portcullis opens. Both transitions ride 1 Hz driver slots, so
// poll rather than trust one fixed wait, and fail hard if they never land.
await shoot('08_gate_opens', 0, 21.8, 0);
let gate = { orbActive: false, gateOpen: false };
for (let i = 0; i < 30 && (!gate.orbActive || !gate.gateOpen); i++) {
  await tick(20);
  gate = await page.evaluate(() => {
    const w = window.__game.world;
    const inst = w.riftInstances.find((i) => i.partyKey !== null);
    return { orbActive: inst.orbActive, gateOpen: inst.gateOpen };
  });
}
console.log(`gate state: ${JSON.stringify(gate)}`);
if (!gate.orbActive || !gate.gateOpen) {
  throw new Error(`orb/gate never opened: ${JSON.stringify(gate)}`);
}

await shoot('09_bone_chamber', -27, 54, 0);
await shoot('10_stairhead_descent', 0, 33, 0);

// Ride the Rift Descent down to the pit floor: walk onto it and wait for the
// floor swap, then re-anchor instance-local coords on the new floor's entry.
const descended = await page.evaluate(async () => {
  const w = window.__game.world;
  const inst = w.riftInstances.find((i) => i.partyKey !== null);
  const descent = inst?.descentId != null ? w.entities.get(inst.descentId) : null;
  if (!descent) return { ok: false, why: 'descent object missing' };
  w.player.pos = { ...descent.pos };
  w.player.prevPos = { ...descent.pos };
  w.rebucket(w.player);
  for (let i = 0; i < 200 && inst.floorIndex === 0; i++) {
    await new Promise((r) => requestAnimationFrame(r));
  }
  if (inst.floorIndex !== 1) return { ok: false, why: 'floor swap never happened' };
  // Floor 1 entry is (0, -26): origin = pos - entry.
  window.__riftOrigin = { x: w.player.pos.x, z: w.player.pos.z + 26 };
  return { ok: true, floorIndex: inst.floorIndex };
});
console.log(`descent: ${JSON.stringify(descended)}`);
if (!descended.ok) throw new Error(`descent failed: ${descended.why}`);
await tick(60); // let the pit floor's interior + props build

await shoot('11_pit_landing', 0, -22, 0);
await shoot('12_pit_nave', 0, 0, 0);
await shoot('13_hell_forge', 25, 8, 0);
// Down the last stairs: the arena drops away below the nave tier.
await shoot('14_pit_arena', 0, 40, 0);
await shoot('15_demon_idol', 0, 63, 0);

const bossInfo = await page.evaluate(() => {
  const w = window.__game.world;
  const inst = w.riftInstances.find((i) => i.partyKey !== null);
  const boss = inst?.bossId != null ? w.entities.get(inst.bossId) : null;
  return { name: boss?.name, scale: boss?.scale, hp: boss?.maxHp, mobs: inst?.mobIds.length };
});
console.log(`boss: ${JSON.stringify(bossInfo)}`);

// Kill Azgorath through the same smite path, confirm the reward objects, then
// use the spawned egress and prove the run returns to the overworld cleanly.
await page.evaluate(() => {
  const w = window.__game.world;
  const inst = w.riftInstances.find((i) => i.partyKey !== null);
  const boss = inst?.bossId != null ? w.entities.get(inst.bossId) : null;
  if (!boss) throw new Error('Azgorath is missing');
  w.dealDamage(w.player, boss, 1, false, 'physical', 'Dev Smite', 'hit');
});
// The rift driver that opens the way home runs at 1 Hz, so one fixed frame wait
// can straddle its slot; poll until the exit and cache exist (or give up).
let victory = { bossDead: false, exitId: null, cacheId: null };
for (let i = 0; i < 30; i++) {
  await tick(20);
  victory = await page.evaluate(() => {
    const w = window.__game.world;
    const inst = w.riftInstances.find((i) => i.partyKey !== null);
    return {
      bossDead: inst?.bossId != null ? w.entities.get(inst.bossId)?.dead : false,
      exitId: inst?.exitId ?? null,
      cacheId: inst?.cacheId ?? null,
    };
  });
  if (victory.bossDead && victory.exitId !== null && victory.cacheId !== null) break;
}
if (!victory.bossDead || victory.exitId === null || victory.cacheId === null) {
  throw new Error(`citadel victory did not complete: ${JSON.stringify(victory)}`);
}
await shoot('16_victory_egress', 0, 50, 0);
await page.evaluate(() => {
  const w = window.__game.world;
  const inst = w.riftInstances.find((i) => i.partyKey !== null);
  const exit = inst?.exitId != null ? w.entities.get(inst.exitId) : null;
  if (!exit) throw new Error('Rift egress is missing');
  w.player.pos = { ...exit.pos };
  w.player.prevPos = { ...exit.pos };
  w.rebucket(w.player);
});
await tick(20);
const returnedHome = await page.evaluate(() => window.__game.world.riftFloor === null);
if (!returnedHome) throw new Error('Rift egress did not return the player home');
console.log(`victory: ${JSON.stringify(victory)}, returnedHome=${returnedHome}`);

await browser.close();
console.log(`\nerrors during run: ${errors.length}`);
for (const e of errors.slice(0, 12)) console.log(`  ${e}`);
process.exit(errors.length ? 1 : 0);
