// Showcase shots for the non-Flamestrike ground spells:
// Rain of Fire, Volley and Hurricane mid-channel, plus Earthquake with its
// lingering zone. Needs `npm run dev` (GAME_URL, default :5173). Shots land in
// tmp/pr2_ground_<spell>.png.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const VIEWPORT = { width: 1600, height: 900 };
const userDataDir = '/tmp/woc-pr2-ground-spells-profile';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const scenes = [
  {
    spell: 'rain_of_fire',
    label: 'Rain of Fire',
    cls: 'warlock',
    name: 'Ember',
    shot: 'tmp/pr2_ground_rain_of_fire.png',
    waitMs: 1250,
    kind: 'channel',
  },
  {
    spell: 'volley',
    label: 'Volley',
    cls: 'hunter',
    name: 'Arrow',
    shot: 'tmp/pr2_ground_volley.png',
    waitMs: 700,
    kind: 'channel',
  },
  {
    spell: 'hurricane',
    label: 'Hurricane',
    cls: 'druid',
    name: 'Gale',
    shot: 'tmp/pr2_ground_hurricane.png',
    waitMs: 1250,
    kind: 'channel',
  },
  {
    spell: 'earthquake',
    label: 'Earthquake',
    cls: 'shaman',
    name: 'Quake',
    shot: 'tmp/pr2_ground_earthquake.png',
    waitMs: 300,
    kind: 'zone',
  },
];

fs.mkdirSync('tmp', { recursive: true });
fs.rmSync(userDataDir, { recursive: true, force: true });

let browser;
const fails = [];
const sceneJson = {};

async function jsClick(page, sel) {
  await page.evaluate((s) => document.querySelector(s)?.click(), sel);
}

async function openOfflineClass(scene) {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => {
    pageErrors.push(e.message);
    console.log(`[${scene.spell}] PAGEERROR:`, e.message);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`[${scene.spell}] CONSOLEERROR:`, msg.text());
  });
  await page.setViewport(VIEWPORT);
  await page.bringToFront();
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 180000 });
  await page.waitForSelector('#btn-offline', { timeout: 60000 });
  await jsClick(page, '#btn-offline');
  await sleep(400);
  await page.waitForSelector('#char-name', { timeout: 30000 });
  await page.type('#char-name', scene.name);
  await jsClick(page, `#offline-select .mini-class[data-class="${scene.cls}"]`);
  await sleep(300);
  await jsClick(page, '#btn-start-offline');
  await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 60000 });
  await sleep(1500);
  return { page, pageErrors };
}

async function stageAndCast(page, scene) {
  return page.evaluate((s) => {
    const g = window.__game;
    const sim = g.sim;
    const me = sim.player;
    sim.setPlayerLevel(20);
    document.querySelector('#tutorial-hint .btn, #tutorial-hint button')?.click();

    const known = sim.known?.find?.((k) => k.def.id === s.spell);
    if (!known) return { fail: `${s.spell} not known at level 20` };
    const ability = known.def;

    let best = Infinity;
    let mob = null;
    for (const e of sim.entities.values()) {
      if (e.id === me.id || e.dead || !e.hostile) continue;
      const d = Math.hypot(e.pos.x - me.pos.x, e.pos.z - me.pos.z);
      if (d < best) {
        best = d;
        mob = e;
      }
    }
    if (!mob) return { fail: 'no hostile mob found' };

    const range = ability.range > 0 ? ability.range : 5;
    const desired = Math.max(2, range - 7);
    const d = Math.hypot(mob.pos.x - me.pos.x, mob.pos.z - me.pos.z);
    if (d > desired) {
      const t = (d - desired) / d;
      me.pos.x += (mob.pos.x - me.pos.x) * t;
      me.pos.z += (mob.pos.z - me.pos.z) * t;
      me.prevPos = { ...me.pos };
    }
    me.facing = Math.atan2(mob.pos.x - me.pos.x, mob.pos.z - me.pos.z);
    sim.targetEntity(mob.id);
    me.resource = me.maxResource;
    me.gcdRemaining = 0;
    me.cooldowns.delete(s.spell);

    const hp0 = mob.hp;
    const aim = { x: mob.pos.x, z: mob.pos.z };
    sim.castAbilityAt(s.spell, aim);
    const zoneCount = (sim.groundAoEs ?? []).filter((z) => z.ability === ability.name).length;
    return {
      spell: s.spell,
      ability: ability.name,
      class: s.cls,
      mobId: mob.id,
      mobName: mob.name,
      hp0,
      range,
      aim,
      player: { x: me.pos.x, z: me.pos.z },
      channeling: me.channeling,
      castingAbility: me.castingAbility,
      castRemaining: me.castRemaining,
      zoneCount,
      fired: me.channeling || me.gcdRemaining > 0 || zoneCount > 0,
    };
  }, scene);
}

async function inspectAfter(page, scene, setup) {
  return page.evaluate(
    (s, initial) => {
      const sim = window.__game.sim;
      const me = sim.player;
      const mob = sim.entities.get(initial.mobId);
      const zones = (sim.groundAoEs ?? [])
        .filter((z) => z.ability === initial.ability)
        .map((z) => ({
          x: z.pos.x,
          z: z.pos.z,
          radius: z.radius,
          remaining: z.remaining,
          tickTimer: z.tickTimer,
        }));
      return {
        damaged: mob ? mob.hp < initial.hp0 : true,
        hp: mob?.hp ?? null,
        channeling: me.channeling,
        castingAbility: me.castingAbility,
        castRemaining: me.castRemaining,
        zones,
        groundAimActive: !!window.__game.hud?.isGroundAimActive?.(),
        rendererRings: window.__game.renderer?.aoeRings?.length ?? null,
        expectedKind: s.kind,
      };
    },
    scene,
    setup,
  );
}

try {
  browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    args: [
      `--user-data-dir=${userDataDir}`,
      '--disable-crash-reporter',
      '--disable-crashpad',
      '--crash-dumps-dir=/tmp/woc-pr2-ground-spells-crash-dumps',
      '--window-size=1600,900',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
    defaultViewport: VIEWPORT,
  });

  for (const scene of scenes) {
    const { page, pageErrors } = await openOfflineClass(scene);
    try {
      const setup = await stageAndCast(page, scene);
      console.log(`[${scene.spell}] setup:`, JSON.stringify(setup));
      if (setup.fail || !setup.fired) {
        fails.push(`${scene.spell}: cast did not fire (${JSON.stringify(setup)})`);
      }
      if (scene.kind === 'channel' && !setup.channeling) {
        fails.push(`${scene.spell}: expected a channel after cast`);
      }
      if (scene.kind === 'zone' && setup.zoneCount < 1) {
        fails.push(`${scene.spell}: expected a lingering zone after cast`);
      }

      await sleep(scene.waitMs);
      await page.screenshot({ path: scene.shot });
      const after = await inspectAfter(page, scene, setup);
      console.log(`[${scene.spell}] after:`, JSON.stringify(after));
      sceneJson[scene.spell] = { setup, after, shot: scene.shot };

      if (scene.kind === 'channel' && !after.damaged) {
        fails.push(`${scene.spell}: target was not damaged by mid-channel pulse`);
      }
      if (scene.kind === 'zone' && after.zones.length < 1) {
        fails.push(`${scene.spell}: lingering zone missing after screenshot wait`);
      }
      if (pageErrors.length) {
        fails.push(`${scene.spell}: page errors ${JSON.stringify(pageErrors)}`);
      }
    } finally {
      await page.close().catch(() => {});
    }
  }
} finally {
  if (browser) await browser.close().catch(() => {});
}

for (const f of fails) console.error('FAIL:', f);
console.log('SCENES:', JSON.stringify(sceneJson));
if (fails.length) process.exit(1);
console.log('PASS: ground spell shots verified; shots in tmp/pr2_ground_*.png');
