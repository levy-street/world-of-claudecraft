// Screenshot tour of the Molten Abyss (id infernal_abyss): boots offline,
// levels to 20, walks the Stormcrag door, then tours the complete authored route
// including both branches, the minibosses, the lava (with a live damage-pulse
// check), a wall-collision probe, the lore objects, Azazel's arena, and the
// authored minimap. Saves tmp/abyss_*.png. Needs `npm run dev` running and a
// browser (set BROWSER_PATH or rely on scripts/browser_path.mjs autodetect).
// GFX_TIER=low re-runs the same tour on the low preset; MOBILE=1 uses a phone
// viewport.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const TIER = process.env.GFX_TIER ?? 'high';
const MOBILE = process.env.MOBILE === '1';
const TAG = `${MOBILE ? 'mobile_' : ''}${TIER}`;
const URL = `${process.env.GAME_URL ?? 'http://localhost:5173'}/?gfx=${TIER}`;
fs.mkdirSync('tmp', { recursive: true });

const viewport = MOBILE
  ? { width: 844, height: 390, isMobile: true, hasTouch: true }
  : { width: 1600, height: 900 };
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 120000,
  args: [
    `--window-size=${viewport.width},${viewport.height}`,
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  defaultViewport: viewport,
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`CONSOLE: ${msg.text()}`);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (name) => page.screenshot({ path: `tmp/abyss_${TAG}_${name}.png` });
let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`OK   ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name}${extra ? ` ${extra}` : ''}`);
  }
}

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#btn-offline', { timeout: 60000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await page.waitForSelector('#btn-start-offline', { timeout: 60000 });
await page.evaluate(() => {
  const name = document.querySelector('#char-name');
  if (name && !name.value) name.value = 'Abysstour';
  document.querySelector('#btn-start-offline').click();
});
// mobile interposes the landscape/fullscreen advisory before entering
await sleep(1000);
await page.evaluate(() => {
  for (const b of document.querySelectorAll('button')) {
    if (b.offsetParent && /continue to game/i.test(b.textContent ?? '')) b.click();
  }
});
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 60000 });
await sleep(2500);
// skip the tutorial card, then dismiss its 9s closing card
for (let i = 0; i < 2; i++) {
  await page.evaluate(() => document.querySelector('.tut-skip')?.click());
  await sleep(400);
}
await page.evaluate(() => document.querySelector('.tut-card')?.remove());

await page.evaluate(() => {
  const g = window.__game;
  g.sim.setPlayerLevel(20);
  const p = g.sim.player;
  p.maxHp = 999999;
  p.hp = 999999;
});

// 1) the Stormcrag door site
const door = await page.evaluate(() => {
  const g = window.__game;
  const d = [...g.sim.entities.values()].find(
    (e) => e.templateId === 'dungeon_door' && e.dungeonId === 'infernal_abyss',
  );
  return d ? { x: d.pos.x, z: d.pos.z } : null;
});
check('exterior door entity exists', !!door, JSON.stringify(door));
if (door) {
  await page.evaluate(
    (dx, dz) => {
      const g = window.__game;
      // Offset diagonally so the archway is not hidden dead-center behind
      // the player model from the chase camera.
      const pos = g.sim.groundPos(dx - 7, dz + 7);
      g.sim.player.pos = pos;
      g.sim.player.prevPos = { ...pos };
      // Engine facing: PI faces +z, 0 faces -z, so aim the OPPOSITE of the
      // player-to-door vector to look at the door.
      const yaw = Math.atan2(pos.x - dx, pos.z - dz);
      // Orbit a quarter turn so the gate and character share the frame instead
      // of the chase camera sitting inside the gate's deep horn silhouette.
      const framedYaw = yaw - Math.PI / 2;
      g.sim.player.facing = framedYaw;
      g.input.camYaw = framedYaw;
      g.input.camPitch = 0.1;
      g.input.camDist = 8;
    },
    door.x,
    door.z,
  );
  await sleep(6000);
  await page.evaluate(
    (yaw) => {
      const g = window.__game;
      g.sim.player.facing = yaw;
      g.input.camYaw = yaw;
    },
    Math.atan2(-7, 7) - Math.PI / 2,
  );
  await sleep(600);
  await shot('01_stormcrag_door');
}

// 2) enter and locate the instance origin from the player's landing spot.
// The authored entry is local (0, -10); every waypoint below is layout-local.
const origin = await page.evaluate(() => {
  const g = window.__game;
  g.sim.enterDungeon('infernal_abyss');
  const p = g.sim.player.pos;
  return { x: p.x - 0, z: p.z - -10 };
});
check('entered the instance band', origin.x > 4200, `origin ${JSON.stringify(origin)}`);
const tpLocal = async (x, z, yaw = 0, settle = 1100) => {
  await page.evaluate(
    (x, z, yaw) => {
      const g = window.__game;
      const p = g.sim.player;
      p.maxHp = 999999;
      p.hp = 999999;
      if (p.dead) g.sim.releaseSpirit();
      p.pos = { x, y: p.pos.y, z };
      const gp = g.sim.groundPos(x, z);
      p.pos = gp;
      p.prevPos = { ...gp };
      p.facing = yaw;
      g.input.camYaw = yaw;
      g.input.camPitch = 0.32;
      g.input.camDist = 10;
    },
    origin.x + x,
    origin.z + z,
    yaw,
  );
  await sleep(settle);
};

await tpLocal(0, -8, 0);
await shot('02_ashen_descent');
await tpLocal(0, 18, 0);
await shot('03_chainscar_descent');
await tpLocal(-20, 50, -0.7);
await shot('04_lava_maze');

// Lava damage probe: normal hp, stand in a central maze fissure.
const lava = await page.evaluate(
  (x, z) => {
    const g = window.__game;
    const p = g.sim.player;
    p.maxHp = 1500;
    p.hp = 1500;
    p.pos = { x, y: p.pos.y, z };
    p.prevPos = { ...p.pos };
    return new Promise((resolve) => {
      const h0 = p.hp;
      setTimeout(() => resolve({ before: h0, after: p.hp, max: p.maxHp }), 3600);
    });
  },
  origin.x - 47,
  origin.z + 61,
);
check(
  'lava pool pulses real damage',
  lava.after < lava.before,
  `hp ${lava.before} -> ${lava.after} of ${lava.max}`,
);
await shot('05_lava_pool_damage');

// Wall-collision probe: drive the real input path into the maze shell.
await tpLocal(-50, 45, -Math.PI / 2, 400);
const startX = await page.evaluate(() => window.__game.sim.player.pos.x);
await page.keyboard.down('w');
await sleep(1500);
await page.keyboard.up('w');
const endX = await page.evaluate(() => window.__game.sim.player.pos.x);
check(
  'west wall blocks movement out of the maze',
  endX >= origin.x - 54.5 && endX < startX,
  `x ${startX.toFixed(1)} -> ${endX.toFixed(1)} (wall at ${(origin.x - 54).toFixed(1)})`,
);

// 3) Lost Armory (west branch) + its lore object and weapon racks
await tpLocal(-66, 59, -1.4);
await shot('06_lost_armory');
// 4) Infernal Forge + Forgekeeper + anvil + tablet objects
await tpLocal(0, 108, 0.2);
await shot('07_forge');
const forgekeeper = await page.evaluate(() => {
  const g = window.__game;
  const m = [...g.sim.entities.values()].find((e) => e.templateId === 'forgekeeper' && !e.dead);
  return m ? { name: m.name, level: m.level, hp: m.maxHp } : null;
});
check('Forgekeeper is up in the forge', !!forgekeeper, JSON.stringify(forgekeeper));
// 5) Gladiator Pit (east branch) + Pyre Golem
await tpLocal(40, 116, Math.PI / 2);
await page.evaluate(() => {
  window.__game.input.camDist = 7;
  window.__game.input.camPitch = 0.35;
});
await sleep(500);
await shot('08_gladiator_pit');
const golem = await page.evaluate((origin) => {
  const g = window.__game;
  const m = [...g.sim.entities.values()].find((e) => e.templateId === 'pyre_golem' && !e.dead);
  return m
    ? { name: m.name, level: m.level, hp: m.maxHp, x: m.pos.x - origin.x, z: m.pos.z - origin.z }
    : null;
}, origin);
check(
  'Pyre Golem is up in the maze crucible',
  !!golem && golem.x < -45 && golem.z >= 70 && golem.z <= 95,
  JSON.stringify(golem),
);
// 6) Maw Approach and Bridge
await tpLocal(0, 143, 0);
await page.evaluate(() => {
  window.__game.input.camDist = 7;
  window.__game.input.camPitch = 0.28;
});
await sleep(400);
await shot('09_maw_approach');
await tpLocal(0, 149, 0);
await page.evaluate(() => {
  window.__game.input.camDist = 10;
  window.__game.input.camPitch = 0.42;
});
await sleep(400);
await shot('10_maw_bridge');
// 7) Vestibule then the Heart Cairn arena
await tpLocal(0, 184, Math.PI / 2);
await page.evaluate(() => {
  window.__game.input.camDist = 6;
  window.__game.input.camPitch = 0.3;
});
await sleep(400);
await shot('11_vestibule');
await tpLocal(0, 199, 0);
await page.evaluate(() => {
  window.__game.input.camDist = 8;
  window.__game.input.camPitch = 0.36;
});
await sleep(400);
await shot('12_heart_cairn_azazel');
const azazel = await page.evaluate(() => {
  const g = window.__game;
  const m = [...g.sim.entities.values()].find(
    (e) => e.templateId === 'azazel_infernal_lord' && !e.dead,
  );
  return m ? { name: m.name, level: m.level, hp: m.maxHp, boss: true } : null;
});
check('Azazel is up in the arena', !!azazel, JSON.stringify(azazel));

// interactable lore objects present as entities
const LORE_IDS = [
  'charred_legion_tablet',
  'brands_of_the_first_flame',
  'forgekeepers_ledger',
  'azazels_broken_covenant',
];
const objects = await page.evaluate(
  (ids) =>
    [...window.__game.sim.entities.values()]
      .filter((e) => e.kind === 'object' && ids.includes(e.objectItemId))
      .map((e) => e.objectItemId),
  LORE_IDS,
);
check('four lore objects placed', new Set(objects).size === 4, JSON.stringify(objects));

// 8) authored minimap schematic + world map
await shot('13_minimap_closeup');
await page.keyboard.press('m');
await sleep(600);
await shot('14_world_map');
await page.keyboard.press('Escape');

// 9) a real Azazel pull for the encounter view
await tpLocal(0, 204, 0);
await page.evaluate(() => {
  const g = window.__game;
  const m = [...g.sim.entities.values()].find(
    (e) => e.templateId === 'azazel_infernal_lord' && !e.dead,
  );
  if (m) {
    g.sim.targetEntity(m.id);
    g.sim.startAutoAttack();
  }
});
await sleep(3500);
await shot('15_azazel_pull');

console.log(`\nerrors: ${errors.length}`);
for (const e of errors.slice(0, 8)) console.log(`  ${e}`);
console.log(`\n${pass} OK, ${fail} FAIL`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
