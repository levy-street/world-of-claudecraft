// Evidence shots of the reworked Wildheart Basin in a live offline world: the
// Idol Maw vista over the whole caldera (the falls and their rainbows, the
// river, the Great Saurian in the ford, the stone jaguar far off), every area
// of the route, the gates shut and then woven open, the Waterfall Walk behind
// its curtain, the Weeping Falls arena, the shrine under the jaguar head, the
// M map and the minimap, and the telegraphs (the Saurian's Stomp and Tail
// Swipe, the howdah breaking, the enrage, the Vine Lasher's lash, a Spore
// Toad's cloud), and the three bosses' mechanics (phase B: Pack Bond, Stalk,
// the Quake, Heel!, Seed Rain and the pods, Pollinate, Vine Lash, Gorge, the
// Pulse, Spirit of the Hunt, a sun glyph, the Ambush). Evidence tooling, not a
// repo test. A shot id or an id prefix
// after the out dir filters the run.
//
//   node scripts/wildheart_basin_shot.mjs [outDir] [shotId ...]
//
// Env: SHOT_URL (http://127.0.0.1:5210/), SHOT_PRESET (4), SHOT_W / SHOT_H
// (1600x900), SHOT_GPU=0 to force SwiftShader, SHOT_PREFIX (default
// "cuenca_").
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5210/';
const OUT = process.argv[2] ?? path.join('tmp', 'wildheart_basin');
const ONLY = process.argv.slice(3);
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const PREFIX = process.env.SHOT_PREFIX ?? 'cuenca_';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PI = Math.PI;
// at: instance-local spot the player stands on; face: sim radians (0 = +z,
// north up the basin); the camera orbits at yaw/pitch/dist. `closed`: taken
// before the gates open. `stage`: [templateId, yards, angle] pulls that mob
// and stands the player there facing it. `cmds`: /dev commands after staging.
// `waitCast`: wait until a mob of that template is casting that ability.
const SHOTS = [
  // ---- the gates shut (before /dev wildheart gates) ----
  { id: 'puentes_cerrados', closed: true, at: [0, -112], face: 0, pitch: 0.42, dist: 46 },
  { id: 'espinos_cerrados', closed: true, at: [-86, -2], face: 0, pitch: 0.3, dist: 16 },
  { id: 'arco_custodiado', closed: true, at: [0, 58], face: 0, pitch: 0.2, dist: 16 },
  // ---- the vistas and the route ----
  { id: 'vista_fauces_del_idolo', at: [0, -214], face: 0, pitch: 0.1, dist: 10 },
  { id: 'vista_fauces_alta', at: [-34, -176], face: 0.12, pitch: 0.36, dist: 30 },
  { id: 'escalones_de_helecho', at: [-34, -178], face: 0.6, pitch: 0.3, dist: 20 },
  { id: 'vado_y_saurio', at: [-20, -128], face: 0, pitch: 0.3, dist: 22 },
  { id: 'vado_escalones_basalto', at: [24, -134], face: 0.5, pitch: 0.32, dist: 20 },
  // The West Vine Bridge weaving itself (the gates open mid-shot).
  {
    id: 'puente_tejiendose',
    opensGates: true,
    at: [-44, -116],
    face: -PI / 4,
    pitch: 0.42,
    dist: 26,
    cmds: ['/dev wildheart gates'],
    cmdWait: 900,
    wait: 350,
  },
  { id: 'puente_oeste', at: [-44, -116], face: -PI / 4, pitch: 0.42, dist: 26 },
  { id: 'puente_este', at: [44, -116], face: PI / 4, pitch: 0.42, dist: 26 },
  { id: 'terrazas_de_caza', at: [-90, -64], face: 0, pitch: 0.32, dist: 22 },
  { id: 'terraza_alta_mira_al_vado', at: [-80, -18], face: PI * 0.85, pitch: 0.3, dist: 20 },
  { id: 'fosos_de_bestias', at: [-86, 14], face: 0, pitch: 0.42, dist: 26 },
  { id: 'paseo_cascada', at: [96, -66], face: 0, pitch: 0.24, dist: 20 },
  { id: 'tras_la_cortina', at: [104, -12], face: -PI / 2, pitch: 0.06, dist: 6 },
  { id: 'tras_la_cortina_lado', at: [100, -22], face: 0, pitch: 0.1, dist: 9, yaw: -0.6 },
  { id: 'tras_la_cortina_norte', at: [102, -22], face: -0.35, pitch: 0.08, dist: 8 },
  { id: 'cascada_llorona_arena', at: [74, 40], face: PI / 2, pitch: 0.22, dist: 22 },
  { id: 'calzada', at: [0, -88], face: 0, pitch: 0.3, dist: 18 },
  { id: 'isla_ruinas', at: [-10, -10], face: 0.2, pitch: 0.3, dist: 22 },
  { id: 'plaza_colonia', at: [24, 20], face: 0, pitch: 0.34, dist: 20 },
  { id: 'convergencia_escalera', at: [0, 100], face: 0, pitch: 0.18, dist: 18 },
  { id: 'terraza_santuario', at: [0, 202], face: 0, pitch: 0.02, dist: 16 },
  // The colossal jaguar head up close, and a Sunbone brazier's fire.
  { id: 'cabeza_jaguar', at: [0, 196], face: 0, pitch: -0.18, dist: 10 },
  { id: 'cabeza_jaguar_tres_cuartos', at: [-30, 214], face: 0.55, pitch: -0.12, dist: 12 },
  { id: 'brasero_fuego', at: [0, 200], face: Math.PI / 2, pitch: 0.12, dist: 6, yaw: -0.5 },
  { id: 'santuario_vista_atras', at: [0, 226], face: PI, pitch: 0.32, dist: 22 },
  // ---- the map and the minimap (HUD on) ----
  { id: 'mapa_m', at: [0, -40], face: 0, pitch: 0.3, dist: 18, map: true },
  { id: 'minimapa', at: [0, -104], face: 0, pitch: 0.35, dist: 18, hud: true },
  // ---- telegraphs and creature effects (HUD on: cast bars) ----
  {
    id: 'saurio_pisoton',
    stage: ['great_saurian', 9, PI * 0.25],
    cmds: ['/dev wildheart trigger stomp'],
    cmdWait: 1100,
    pitch: 0.62,
    dist: 32,
    hud: true,
    wait: 80,
  },
  {
    id: 'saurio_pisoton_impacto',
    stage: ['great_saurian', 9, PI * 0.25],
    cmds: ['/dev wildheart trigger stomp'],
    cmdWait: 2050,
    pitch: 0.5,
    dist: 30,
    hud: true,
    wait: 60,
  },
  {
    id: 'saurio_coletazo',
    stage: ['great_saurian', 9, PI * 0.5],
    cmds: ['/dev wildheart trigger tail'],
    cmdWait: 420,
    pitch: 0.62,
    dist: 32,
    hud: true,
    wait: 80,
  },
  {
    id: 'saurio_palanquin_roto',
    stage: ['great_saurian', 14, PI * 0.5],
    cmds: ['/dev wildheart trigger howdah'],
    cmdWait: 350,
    pitch: 0.25,
    dist: 26,
    hud: true,
    wait: 150,
  },
  // ---- the Great Saurian's Blender body: its clips' contact frames ----
  {
    id: 'saurio_cuerpo_palanquin',
    stage: ['great_saurian', 22, PI * 0.5],
    cmds: ['/dev wildheart trigger howdah'],
    cmdWait: 60,
    pitch: 0.22,
    dist: 30,
    hud: true,
    burst: [500, 950, 1250, 1600, 1900, 2600, 3800],
  },
  {
    id: 'saurio_cuerpo_pisoton',
    stage: ['great_saurian', 20, PI * 0.35],
    cmds: ['/dev wildheart trigger stomp'],
    cmdWait: 60,
    pitch: 0.3,
    dist: 34,
    hud: true,
    burst: [700, 1500, 2050, 2200, 2450, 2900],
  },
  {
    id: 'saurio_cuerpo_coletazo',
    stage: ['great_saurian', 20, PI * 0.5],
    cmds: ['/dev wildheart trigger tail'],
    cmdWait: 60,
    pitch: 0.42,
    dist: 36,
    hud: true,
    burst: [600, 900, 1000, 1120, 1300, 1700],
  },
  {
    id: 'saurio_cuerpo_furia',
    stage: ['great_saurian', 20, PI * 0.4],
    cmds: ['/dev wildheart trigger enrage'],
    cmdWait: 60,
    pitch: 0.3,
    dist: 32,
    hud: true,
    burst: [500, 900, 1400, 2000],
  },
  {
    id: 'saurio_cuerpo_muerte',
    stage: ['great_saurian', 24, PI * 0.5],
    cmds: ['/dev wildheart kill saurian'],
    cmdWait: 60,
    pitch: 0.3,
    dist: 34,
    hud: true,
    burst: [800, 1800, 2750, 2950, 3400, 4600],
  },
  {
    id: 'saurio_enfurecido',
    stage: ['great_saurian', 14, PI * 0.5],
    cmds: ['/dev wildheart trigger enrage'],
    cmdWait: 1500,
    pitch: 0.25,
    dist: 26,
    hud: true,
  },
  {
    id: 'latigo_enredador',
    at: [0, 40],
    face: 0,
    cmds: ['/dev wildheart kill trash', '/dev wildheart spawn lasher'],
    cmdWait: 1200,
    waitCast: ['vine_lasher', 'wildheart_entangling_lash', 0.45],
    pitch: 0.6,
    dist: 22,
    hud: true,
  },
  // The Snarlvine Lasher's Blender body: its LashCast from the bar's start
  // (the frames count from the cast opening), the tip on the lane at 1.5 s.
  {
    id: 'latigador_cuerpo',
    at: [0, 40],
    face: 0,
    cmds: ['/dev wildheart kill trash', '/dev wildheart spawn lasher'],
    cmdWait: 200,
    waitCast: ['vine_lasher', 'wildheart_entangling_lash', 0],
    burstFromCast: true,
    pitch: 0.3,
    dist: 20,
    yaw: 1.15,
    hud: true,
    burst: [600, 1250, 1500, 1600, 1750, 2100],
  },
  {
    id: 'pulso_totem',
    at: [0, 40],
    face: 0,
    cmds: [
      '/dev wildheart kill trash',
      '/dev wildheart spawn ravager',
      '/dev wildheart spawn totem',
    ],
    cmdWait: 1200,
    waitPulse: true,
    pitch: 0.55,
    dist: 20,
    hud: true,
    wait: 0,
  },
  {
    id: 'nube_de_esporas',
    at: [0, 40],
    face: 0,
    cmds: ['/dev wildheart kill trash', '/dev wildheart spawn toad'],
    cmdWait: 1800,
    killNearest: 'spore_toad',
    pitch: 0.5,
    dist: 16,
    hud: true,
    wait: 1200,
  }, // ---- phase B: the three bosses (HUD on: cast bars and the encounter alert) ----
  // The Fanglord Beastmaster and his Great Jaguar (Pack Bond, Stalk, the Quake,
  // Call of the Hunt, Thickhide Ward, Heel!). Alone, the jaguar's prey is the
  // player, so the alert reads Stalked.
  {
    id: 'jefe1_vinculo',
    stage: ['wildheart_beastmaster', 9, PI * 0.15],
    cmdWait: 600,
    pitch: 0.45,
    dist: 24,
    hud: true,
    wait: 400,
  },
  {
    id: 'jefe1_acecho',
    stage: ['wildheart_beastmaster', 16, PI * 0.2],
    cmds: ['/dev wildheart trigger stalk'],
    cmdWait: 1600,
    pitch: 0.4,
    dist: 20,
    hud: true,
    wait: 300,
  },
  {
    id: 'jefe1_temblor',
    stage: ['wildheart_beastmaster', 6, PI * 0.15],
    cmds: ['/dev wildheart trigger quake'],
    cmdWait: 950,
    pitch: 0.6,
    dist: 26,
    hud: true,
    wait: 60,
  },
  {
    id: 'jefe1_llamada_y_piel',
    stage: ['wildheart_beastmaster', 9, PI * 0.15],
    cmds: ['/dev wildheart trigger hunt', '/dev wildheart trigger ward'],
    cmdWait: 300,
    pitch: 0.4,
    dist: 22,
    hud: true,
    wait: 200,
  },
  // The Great Jaguar's Blender body: its Heel! leap and the bond cord.
  {
    id: 'jefe1_jaguar_salto',
    stage: ['wildheart_beastmaster', 12, PI * 0.15],
    placeMob: ['fanglord_jaguar', -86, 24],
    cmds: ['/dev wildheart trigger heel'],
    cmdWait: 60,
    pitch: 0.35,
    dist: 26,
    hud: true,
    burst: [600, 1300, 1700, 2000, 2150, 2500],
  },
  {
    id: 'jefe1_a_mi',
    stage: ['wildheart_beastmaster', 9, PI * 0.15],
    placeMob: ['fanglord_jaguar', -86, 24],
    cmds: ['/dev wildheart trigger heel'],
    cmdWait: 1100,
    pitch: 0.6,
    dist: 34,
    hud: true,
    wait: 60,
  },
  // The Gorgebloom (Seed Rain, the pods ripening and sprouting, Pollinate,
  // Vine Lash, Gorge).
  {
    id: 'jefe2_lluvia_de_semillas',
    stage: ['the_gorgebloom', 9, -PI * 0.5],
    cmds: ['/dev wildheart trigger seeds'],
    cmdWait: 1700,
    pitch: 0.55,
    dist: 30,
    hud: true,
    wait: 200,
  },
  {
    id: 'jefe2_vainas_maduras',
    stage: ['the_gorgebloom', 9, -PI * 0.5],
    cmds: ['/dev wildheart trigger pods'],
    cmdWait: 9000,
    pitch: 0.55,
    dist: 30,
    hud: true,
    wait: 100,
  },
  {
    id: 'jefe2_brotes_espinosos',
    stage: ['the_gorgebloom', 9, -PI * 0.5],
    cmds: ['/dev wildheart trigger pods'],
    cmdWait: 12600,
    pitch: 0.5,
    dist: 28,
    hud: true,
    wait: 200,
  },
  {
    id: 'jefe2_polinizado',
    stage: ['the_gorgebloom', 9, -PI * 0.5],
    cmds: ['/dev wildheart trigger pods', '/dev wildheart trigger pollinate'],
    cmdWait: 700,
    pitch: 0.42,
    dist: 18,
    hud: true,
    wait: 200,
  },
  {
    id: 'jefe2_latigo_de_liana',
    stage: ['the_gorgebloom', 14, -PI * 0.5],
    cmds: ['/dev wildheart trigger lash'],
    cmdWait: 950,
    pitch: 0.6,
    dist: 30,
    hud: true,
    wait: 60,
  },
  {
    id: 'jefe2_engullir',
    stage: ['the_gorgebloom', 7, -PI * 0.5],
    cmds: ['/dev wildheart trigger gorge'],
    cmdWait: 900,
    pitch: 0.4,
    dist: 20,
    hud: true,
    wait: 60,
  },
  // The Gorgebloom's Blender body: idle in its root pool at the falls, then
  // each clip's contact frames (Seed Rain's spit, Pollinate's burst, the Vine
  // Lash slam and its thorn wave, the Gorge bite, a Bloom Spit at range).
  { id: 'jefe2_flor_reposo', at: [79, 41], face: PI * 0.52, pitch: 0.1, dist: 14, yaw: 0.2 },
  {
    id: 'jefe2_flor_lluvia',
    stage: ['the_gorgebloom', 13, -PI * 0.42],
    cmds: ['/dev wildheart trigger seeds'],
    cmdWait: 60,
    pitch: 0.28,
    dist: 26,
    yaw: 0.35,
    hud: true,
    burst: [800, 1450, 1620, 1850, 2300],
  },
  {
    id: 'jefe2_flor_polinizar',
    stage: ['the_gorgebloom', 13, -PI * 0.5],
    cmds: ['/dev wildheart trigger pollinate'],
    cmdWait: 60,
    pitch: 0.22,
    dist: 24,
    yaw: 0.3,
    hud: true,
    burst: [300, 620, 800, 1300],
  },
  {
    id: 'jefe2_flor_latigo',
    stage: ['the_gorgebloom', 16, -PI * 0.5],
    cmds: ['/dev wildheart trigger lash'],
    cmdWait: 60,
    pitch: 0.4,
    dist: 30,
    yaw: -1.25,
    hud: true,
    burst: [700, 1250, 1500, 1580, 1700, 1900, 2300],
  },
  {
    id: 'jefe2_flor_engullir',
    stage: ['the_gorgebloom', 7, -PI * 0.5],
    cmds: ['/dev wildheart trigger gorge'],
    cmdWait: 60,
    pitch: 0.2,
    dist: 20,
    yaw: 0.75,
    hud: true,
    burst: [800, 1300, 1550, 1750, 2000, 2300],
  },
  // A Thorn Sprout bursting out of its pod (Emerge): the frames count from
  // the first new sprout appearing.
  {
    id: 'jefe2_brote_emerge',
    stage: ['the_gorgebloom', 13, -PI * 0.42],
    cmds: ['/dev wildheart trigger pods'],
    cmdWait: 60,
    waitNewMob: 'thorn_sprout',
    pitch: 0.3,
    dist: 16,
    yaw: 0.35,
    hud: true,
    burst: [60, 250, 420, 650, 1100, 1900],
  },
  {
    id: 'jefe2_flor_escupitajo',
    stage: ['the_gorgebloom', 26, -PI * 0.5],
    pitch: 0.2,
    dist: 22,
    yaw: 0.5,
    hud: true,
    burst: [1700, 2000, 2300, 2600, 3800],
  },
  {
    id: 'jefe2_flor_muerte',
    at: [78, 44],
    face: PI * 0.5,
    cmds: ['/dev wildheart kill gorgebloom'],
    cmdWait: 60,
    pitch: 0.14,
    dist: 15,
    yaw: 0.25,
    hud: true,
    burst: [400, 1200, 2000, 2750, 2900, 3300, 4600],
  },
  // Zulgar (the telegraphed Pulse, Spirit of the Hunt with the Prey alert and
  // the jaguar's burning eyes, a sun glyph going dark, the heroic Ambush).
  {
    id: 'jefe3_pulso',
    placeMob: ['wildheart_high_priest', 0, 220],
    stage: ['wildheart_high_priest', 6, PI],
    cmds: ['/dev wildheart trigger pulse'],
    cmdWait: 950,
    pitch: 0.6,
    dist: 30,
    hud: true,
    wait: 60,
  },
  {
    id: 'jefe3_espiritu_de_la_caza',
    placeMob: ['wildheart_high_priest', 0, 220],
    stage: ['wildheart_high_priest', 30, PI],
    cmds: ['/dev wildheart trigger spirit'],
    cmdWait: 1600,
    pitch: 0.25,
    dist: 30,
    hud: true,
    wait: 0,
  },
  // The jade spirit jaguar wrapping him through the hunt.
  {
    id: 'jefe3_avatar_jaguar',
    placeMob: ['wildheart_high_priest', 0, 220],
    stage: ['wildheart_high_priest', 16, PI * 0.8],
    cmds: ['/dev wildheart trigger spirit'],
    cmdWait: 60,
    pitch: 0.18,
    dist: 20,
    yaw: 1.1,
    hud: true,
    burst: [1700, 2400, 3200, 4200],
  },
  {
    id: 'jefe3_ojos_del_jaguar',
    placeMob: ['wildheart_high_priest', 0, 220],
    stage: ['wildheart_high_priest', 30, PI],
    cmds: ['/dev wildheart trigger prey'],
    cmdWait: 100,
    pitch: 0.05,
    dist: 12,
    hud: true,
    wait: 300,
  },
  {
    id: 'jefe3_glifo_solar',
    placeMob: ['wildheart_high_priest', 0, 220],
    stage: ['wildheart_high_priest', 30, PI],
    cmds: ['/dev wildheart trigger prey'],
    cmdWait: 100,
    placeMobAfter: ['wildheart_high_priest', 7, 230.1],
    pitch: 0.55,
    dist: 30,
    hud: true,
    wait: 150,
  },
  {
    id: 'jefe3_emboscada',
    placeMob: ['wildheart_high_priest', 0, 220],
    stage: ['wildheart_high_priest', 16, PI],
    cmds: ['/dev wildheart trigger ambush'],
    cmdWait: 900,
    pitch: 0.6,
    dist: 34,
    hud: true,
    wait: 60,
  },
];

/** In-page: pull `templateId` and say where the player should stand. */
function pageStage([templateId, yards, angle]) {
  const sim = window.__game.world;
  const me = sim.player;
  let boss = null;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead && e.templateId === templateId) boss = e;
  }
  if (!boss) return null;
  me.hp = me.maxHp;
  boss.maxHp = Math.max(boss.maxHp, 1e6);
  boss.hp = boss.maxHp;
  if (boss.aiState === 'evade') {
    boss.aiState = 'idle';
    boss.inCombat = false;
  }
  me.devNoAggro = false;
  sim.aggroMob(boss, me, false);
  return {
    x: boss.pos.x + Math.sin(angle) * yards,
    z: boss.pos.z + Math.cos(angle) * yards,
    face: angle + Math.PI,
  };
}

/** In-page: is a mob of `templateId` casting `castId` past `share` of its bar? */
function pageCasting([templateId, castId, share]) {
  const sim = window.__game.world;
  for (const e of sim.entities.values()) {
    if (e.templateId !== templateId || e.dead || e.castingAbility !== castId) continue;
    if (e.castTotal > 0 && 1 - e.castRemaining / e.castTotal >= share) return true;
  }
  return false;
}

/** In-page: move the living mob of templateId to an instance-local spot. */
function pagePlaceMob([templateId, lx, lz, ox, oz]) {
  const sim = window.__game.world;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead || e.templateId !== templateId) continue;
    const at = sim.groundPos(ox + lx, oz + lz);
    e.pos.x = at.x;
    e.pos.y = at.y;
    e.pos.z = at.z;
    e.prevPos = { ...e.pos };
    return e.id;
  }
  return null;
}

/** In-page: kill the nearest living mob of `templateId` through the sim. */
function pageKill(templateId) {
  const sim = window.__game.world;
  const me = sim.player;
  let best = null;
  let bestD = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead || e.templateId !== templateId) continue;
    const d = Math.hypot(e.pos.x - me.pos.x, e.pos.z - me.pos.z);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  if (!best) return 'none';
  sim.dealDamage(me, best, best.hp + 10, false, 'physical', 'Shot', 'hit', true);
  return best.id;
}

async function main() {
  const gpu = process.env.SHOT_GPU !== '0';
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: [
      `--window-size=${W},${H}`,
      ...(gpu
        ? ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization']
        : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
    ],
    defaultViewport: { width: W, height: H },
    protocolTimeout: 240000,
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 300));
    });
    // Other work in the same tree edits files while the shots run: a dead
    // HMR socket keeps the dev server's full reloads off the page.
    await page.evaluateOnNewDocument(() => {
      const Native = window.WebSocket;
      window.WebSocket = (url, protocols) => {
        if (String(protocols ?? '').includes('vite')) {
          return {
            readyState: 0,
            addEventListener() {},
            removeEventListener() {},
            send() {},
            close() {},
          };
        }
        return new Native(url, protocols);
      };
      Object.assign(window.WebSocket, Native);
      window.WebSocket.prototype = Native.prototype;
    });
    await page.evaluateOnNewDocument((preset) => {
      try {
        localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: preset }));
      } catch {
        /* ignore */
      }
    }, PRESET);
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 180000 });
    const booted = await enterOfflineGame(page, {
      charClass: 'warrior',
      charName: 'Basinwalker',
      gameBootTimeoutMs: 180000,
      selectorTimeoutMs: 90000,
      settleMs: 4000,
    });
    if (!booted) throw new Error('offline world did not boot');
    for (const cmd of ['/dev level 20', '/dev god', '/dev wildheart enter']) {
      await page.evaluate((c) => window.__game.world.chat(c), cmd);
      await sleep(1300);
    }
    await page.waitForFunction(
      () => {
        let found = false;
        window.__game.renderer.scene.traverse((o) => {
          if (o.name === 'wildheartBasinField') found = true;
        });
        return found;
      },
      { timeout: 180000, polling: 1000 },
    );
    await sleep(5000);
    await page.evaluate(() => window.__game.world.chat('/dev wildheart tp landing'));
    await sleep(900);
    // The landing arrival is instance-local (0, -217): recover the slot origin.
    const origin = await page.evaluate(() => {
      const p = window.__game.world.player;
      return { x: p.pos.x, z: p.pos.z + 217 };
    });
    let gatesOpen = false;
    const rank = (s) => (s.closed ? 0 : s.opensGates ? 1 : 2);
    const shots = [...SHOTS].sort((a, b) => rank(a) - rank(b));
    for (const shot of shots) {
      if (ONLY.length && !ONLY.some((o) => shot.id === o || shot.id.startsWith(o))) continue;
      for (const c of shot.pre ?? []) {
        await page.evaluate((cmd) => window.__game.world.chat(cmd), c);
        await sleep(1200);
      }
      if (shot.opensGates) gatesOpen = true;
      if (!shot.closed && !gatesOpen) {
        await page.evaluate(() => window.__game.world.chat('/dev wildheart gates'));
        gatesOpen = true;
        // The bridges weave and the hedges sink (a few seconds of reveal).
        await sleep(6000);
      }
      await page.evaluate((hide) => {
        let tag = document.getElementById('shot-hide-ui');
        if (!tag) {
          tag = document.createElement('style');
          tag.id = 'shot-hide-ui';
          document.head.appendChild(tag);
        }
        tag.textContent = hide ? '#ui, #nameplates { display: none !important; }' : '';
      }, !shot.map && !shot.hud);
      await sleep(900);
      if (shot.at) {
        await page.evaluate(
          (c) => window.__game.world.chat(c),
          `/dev tp ${origin.x + shot.at[0]} ${origin.z + shot.at[1]}`,
        );
      } else {
        await page.evaluate(() => window.__game.world.chat('/dev wildheart tp saurian'));
      }
      await sleep(700);
      // Strays from an earlier shot drop their fight (the placed packs stay).
      await page.evaluate(() => {
        const sim = window.__game.world;
        for (const e of [...sim.entities.values()]) {
          if (e.kind !== 'mob' || e.dead) continue;
          if (e.inCombat) {
            e.inCombat = false;
            e.aggroTargetId = null;
            e.aiState = 'evade';
          }
        }
        sim.player.devNoAggro = true;
      });
      await sleep(1000);
      if (shot.placeMob) {
        await page.evaluate(pagePlaceMob, [...shot.placeMob, origin.x, origin.z]);
        await sleep(300);
      }
      if (shot.stage) {
        const spot = await page.evaluate(pageStage, shot.stage);
        console.log('STAGE', shot.id, JSON.stringify(spot));
        if (spot) {
          await page.evaluate((c) => window.__game.world.chat(c), `/dev tp ${spot.x} ${spot.z}`);
          shot.face = spot.face;
        }
        await sleep(1400);
      }
      const before = shot.waitNewMob
        ? await page.evaluate(
            (t) =>
              [...window.__game.world.entities.values()]
                .filter((e) => e.templateId === t)
                .map((e) => e.id),
            shot.waitNewMob,
          )
        : [];
      let cmdAt = Date.now();
      for (const c of shot.cmds ?? []) {
        await page.evaluate(() => {
          window.__game.world.player.devNoAggro = false;
        });
        await page.evaluate((cmd) => window.__game.world.chat(cmd), c);
        cmdAt = Date.now();
        await sleep(shot.cmdWait ?? 1300);
      }
      if (shot.placeMobAfter) {
        await page.evaluate(pagePlaceMob, [...shot.placeMobAfter, origin.x, origin.z]);
        await sleep(400);
      }
      if (shot.waitCast) {
        const t0 = Date.now();
        while (Date.now() - t0 < 20000) {
          if (await page.evaluate(pageCasting, shot.waitCast)) break;
          await sleep(80);
        }
        // A burst may count its frames from the cast opening, not the command.
        if (shot.burstFromCast) cmdAt = Date.now();
      }
      // Or from a new mob of a template appearing (a sprout rising from its pod),
      // the camera turned onto it.
      if (shot.waitNewMob) {
        const t0 = Date.now();
        while (Date.now() - t0 < 30000) {
          const spot = await page.evaluate(
            ([t, old]) => {
              for (const e of window.__game.world.entities.values())
                if (e.templateId === t && !e.dead && !old.includes(e.id))
                  return { x: e.pos.x, z: e.pos.z };
              return null;
            },
            [shot.waitNewMob, before],
          );
          if (spot) {
            cmdAt = Date.now();
            const me = await page.evaluate(() => {
              const p = window.__game.world.player.pos;
              return { x: p.x, z: p.z };
            });
            shot.face = Math.atan2(spot.x - me.x, spot.z - me.z);
            break;
          }
          await sleep(40);
        }
      }
      // Catch a Sunbone Totem's pulse ring mid-flight: wait for its beat.
      if (shot.waitPulse) {
        await page.evaluate(() => {
          window.__shotPulse = 0;
          const fx = window.__game.renderer;
          void fx;
        });
        await sleep(2000 - 400);
      }
      if (shot.killNearest) {
        console.log('KILL', shot.id, await page.evaluate(pageKill, shot.killNearest));
      }
      await page.evaluate((s) => {
        const p = window.__game.world.player;
        p.facing = s.face ?? 0;
        p.prevFacing = s.face ?? 0;
        const input = window.__game.input;
        // camYaw is the view's own heading (sim radians): it defaults to the
        // player's facing, so the camera sits behind the player.
        input.camYaw = (s.face ?? 0) + (s.yaw ?? 0);
        input.camPitch = s.pitch;
        input.camDist = s.dist;
      }, shot);
      // A burst: frames at fixed offsets (ms) after the last command, for the
      // clip contact frames (the howdah bursting at 0.9 s, the rider at 1.8 s).
      if (shot.burst) {
        for (const at of shot.burst) {
          await sleep(Math.max(0, cmdAt + at - Date.now()));
          const file = path.join(OUT, `${PREFIX}${shot.id}_${at}.png`);
          await page.screenshot({ path: file });
          console.log('SHOT', file);
        }
        continue;
      }
      await sleep(shot.wait ?? 2600);
      if (shot.map) {
        await page.keyboard.press('KeyM');
        await sleep(1500);
      }
      if (shot.hud) {
        const auras = await page.evaluate(() =>
          window.__game.world.player.auras.map((x) => x.id).join(','),
        );
        console.log('AURAS', shot.id, auras);
      }
      const file = path.join(OUT, `${PREFIX}${shot.id}.png`);
      await page.screenshot({ path: file });
      console.log('SHOT', file);
      if (shot.map) {
        await page.keyboard.press('KeyM');
        await sleep(500);
      }
      const perf = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const info = window.__game.renderer.webgl.info.render;
            let frames = 0;
            const t0 = performance.now();
            const tick = () => {
              frames++;
              if (performance.now() - t0 < 1200) requestAnimationFrame(tick);
              else
                resolve({
                  fps: Math.round((frames * 1000) / (performance.now() - t0)),
                  calls: info.calls,
                  tris: info.triangles,
                });
            };
            requestAnimationFrame(tick);
          }),
      );
      console.log('PERF', shot.id, JSON.stringify(perf));
    }
    const gpuPrep = await page.evaluate(() => {
      const s = window.__game.renderer.perfStats?.().gpuPrep;
      const raw = s?.events ?? s?.ring ?? [];
      const events = Array.isArray(raw) ? raw : [];
      return {
        livePrograms: events.filter((e) => e.kind === 'live-program').length,
        gateTimeouts: events.filter((e) => e.kind === 'gate-timeout').length,
      };
    });
    console.log('GPUPREP', JSON.stringify(gpuPrep));
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
