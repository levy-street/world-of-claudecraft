// Evidence shots of the Gravewyrm Sanctum's creatures in a live offline world:
// the Sledge Tusker with its sledge (hauling, the pull's Unhitch, the Tusk
// Sweep, the Trample lane and charge, the Spilled Braziers, the enrage, its
// death), every trash look next to the player, and every trash telegraph (the
// Cinder Breath, the Goad, the Warming Rite, the Soul Brazier's pulse, the Ice
// Block Toss, the Shatter, the Hoarfrost Pop). Evidence tooling, not a repo
// test. A shot id or an id prefix after the out dir filters the run.
//
//   node scripts/sanctum_creatures_shot.mjs [outDir] [shotId ...]
//
// Env: SHOT_URL (http://127.0.0.1:5242/), SHOT_PRESET (4), SHOT_W / SHOT_H
// (1600x900), SHOT_GPU=0 to force SwiftShader, SHOT_PREFIX (default
// "santuario_").
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5242/';
const OUT = process.argv[2] ?? path.join('tmp', 'sanctum_creatures');
const ONLY = process.argv.slice(3);
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const PREFIX = process.env.SHOT_PREFIX ?? 'santuario_';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PI = Math.PI;

// Each shot: `tp` a /dev sanctum area; `spawn` creatures raised ahead of the
// player (one /dev sanctum spawn each); `stage` [templateId, yards, angle]
// pulls that mob and stands the player there facing it; `cmds` /dev commands;
// `waitCast` [templateId, castId, share]; `kill` a template to kill; `hurt`
// [templateId, share] wounds one; `burst` frame offsets (ms) after the last
// step; the camera orbits at yaw/pitch/dist round the player's facing.
const SHOTS = [
  // ---- the Sledge Tusker ----
  // Its road's first leg, instance-local: from the court's foot (A) up to the
  // upper bend (B). `puppet` walks it down the leg (capture only: see
  // pagePuppet); `tusk` places it at a share of the leg and stands the player
  // at A, then pulls it.
  {
    id: 'colmilludo_arrastre',
    puppet: 0.1,
    view: [0.75, 6, 0.35],
    pitch: 0.32,
    dist: 26,
    yaw: 0.5,
    burst: [600, 2600, 4600],
  },
  {
    id: 'colmilludo_arrastre_cerca',
    puppet: 0.2,
    view: [0.6, 5, -0.3],
    pitch: 0.16,
    dist: 15,
    yaw: -0.7,
    burst: [1800],
  },
  {
    id: 'colmilludo_arrastre_detras',
    puppet: 0.2,
    view: [0.25, 6, -PI * 0.85],
    pitch: 0.3,
    dist: 20,
    burst: [1500],
  },
  {
    id: 'colmilludo_arrastre_alto',
    puppet: 0.15,
    view: [0.35, 4, PI],
    pitch: 1.3,
    dist: 30,
    burst: [2200],
  },
  {
    id: 'colmilludo_desenganche',
    tusk: 0.55,
    pitch: 0.3,
    dist: 30,
    yaw: 0.7,
    hud: true,
    burst: [500, 1400, 2600, 4000],
  },
  {
    id: 'colmilludo_desenganche_alto',
    tusk: 0.55,
    pitch: 1.15,
    dist: 34,
    yaw: 0.7,
    burst: [3000],
  },
  {
    id: 'colmilludo_barrido',
    tusk: 0.32,
    pre: 2500,
    cmds: ['/dev sanctum trigger sweep'],
    cmdWait: 50,
    pitch: 0.62,
    dist: 32,
    yaw: 0.6,
    hud: true,
    burst: [500, 1150, 1520, 1750],
  },
  {
    id: 'colmilludo_pisoteo',
    tusk: 0.85,
    pre: 600,
    cmds: ['/dev sanctum trigger trample'],
    cmdWait: 50,
    pitch: 0.62,
    dist: 40,
    yaw: 0.9,
    hud: true,
    burst: [600, 1500, 2050, 2350, 2700],
  },
  {
    id: 'colmilludo_braseros',
    tusk: 0.45,
    pre: 3000,
    cmds: ['/dev sanctum trigger spill'],
    cmdWait: 50,
    faceSledge: true,
    pitch: 0.42,
    dist: 26,
    yaw: 0.35,
    hud: true,
    burst: [300, 900, 1400, 2400, 5000],
  },
  {
    id: 'colmilludo_braseros_cerca',
    tusk: 0.45,
    pre: 2500,
    cmds: ['/dev sanctum trigger spill'],
    cmdWait: 50,
    faceSledge: true,
    pitch: 1.1,
    dist: 30,
    burst: [500, 1250, 2600],
  },
  {
    id: 'colmilludo_enfurecer',
    tusk: 0.4,
    pre: 3000,
    cmds: ['/dev sanctum trigger enrage'],
    cmdWait: 50,
    pitch: 0.22,
    dist: 26,
    yaw: 1.2,
    hud: true,
    burst: [800, 1850, 3200],
  },
  {
    id: 'colmilludo_muerte',
    tusk: 0.4,
    pre: 3000,
    kill: 'sledge_tusker',
    pitch: 0.3,
    dist: 28,
    yaw: 1.3,
    burst: [1200, 2300, 4000],
  },
  // ---- every trash look next to the player ----
  ...[
    'boneguard',
    'scaleguard',
    'thawcaller',
    'goadsmith',
    'pyretender',
    'whelp',
    'ogre',
    'splinter',
    'bonewalker',
  ].map((type) => ({
    id: `aspecto_${type}`,
    tp: 'fork',
    spawn: [type],
    lineup: true,
    pitch: 0.1,
    dist: 13,
    yaw: 1.45,
    wait: 300,
  })),
  {
    id: 'aspecto_brasero',
    tp: 'fork',
    spawn: ['pyretender'],
    waitNew: 'soul_brazier',
    lineup: true,
    pitch: 0.12,
    dist: 12,
    yaw: 1.45,
    wait: 300,
  },
  // ---- the trash telegraphs ----
  {
    id: 'aliento_de_cenizas',
    tp: 'fork',
    spawn: ['scaleguard'],
    waitCast: ['sanctum_drakonid', 'sanctum_cinder_breath', 0.6],
    pitch: 0.6,
    dist: 20,
    yaw: 0.8,
    hud: true,
    burst: [0, 950],
  },
  {
    id: 'aguijon',
    tp: 'fork',
    spawn: ['goadsmith', 'boneguard'],
    spread: 'sanctum_boneguard',
    waitCast: ['broodsworn_goadsmith', 'sanctum_goad', 0.5],
    pitch: 0.4,
    dist: 20,
    yaw: 0.9,
    hud: true,
    burst: [0, 1100, 2200],
  },
  {
    id: 'rito_calido',
    tp: 'fork',
    spawn: ['thawcaller', 'boneguard'],
    spread: 'sanctum_boneguard',
    hurt: ['sanctum_boneguard', 0.4],
    waitCast: ['broodsworn_thawcaller', 'sanctum_warming_rite', 0.5],
    pitch: 0.4,
    dist: 20,
    yaw: 0.9,
    hud: true,
    burst: [0],
  },
  {
    id: 'brasero_pulso',
    tp: 'fork',
    spawn: ['pyretender', 'boneguard'],
    waitNew: 'soul_brazier',
    pitch: 0.5,
    dist: 24,
    yaw: 0.9,
    hud: true,
    burst: [1600, 2200, 2700, 3400],
  },
  {
    id: 'bloque_de_hielo',
    tp: 'fork',
    spawn: ['ogre'],
    away: 16,
    waitCast: ['ogre_sledge_hauler', 'sanctum_ice_block_toss', 0.15],
    pitch: 0.5,
    dist: 26,
    yaw: 1.2,
    hud: true,
    burst: [0, 900, 1350, 1650, 1950, 2300],
  },
  {
    id: 'astilla_estallido',
    tp: 'fork',
    spawn: ['splinter'],
    pre: 1500,
    kill: 'glacier_splinter',
    pitch: 0.5,
    dist: 20,
    yaw: 0.9,
    hud: true,
    burst: [400, 1300, 2250, 2450, 2800, 3400],
  },
  {
    id: 'cria_escarcha',
    tp: 'fork',
    spawn: ['whelp'],
    pre: 1500,
    kill: 'rime_whelp',
    pitch: 0.4,
    dist: 16,
    yaw: 0.9,
    burst: [80, 400],
  },
];

/** The Tusker's road: its first leg, instance-local (A the court's foot, B the
 *  upper bend), and the world origin read off its own patrol points. */
const ROAD_A = { x: -12, z: -164 };
const ROAD_B = { x: -36, z: -144 };

/** In-page: the instance origin from the Tusker's patrol (its first point is
 *  ROAD_A, instance-local). */
function pageTuskerOrigin([ax, az]) {
  for (const e of window.__game.world.entities.values()) {
    if (e.templateId !== 'sledge_tusker' || !e.dungeonPatrol) continue;
    const p = e.dungeonPatrol.points[0];
    return { x: p.x - ax, z: p.z - az };
  }
  return null;
}

/**
 * In-page, CAPTURE ONLY: walk the Tusker as a puppet down its road's first leg
 * at its patrol pace (2.7 yd/s), so the hauling sledge can be judged. Its own
 * patrol is parked (idleStationary) while the puppet holds it.
 */
function pagePuppet([ax, az, bx, bz, share]) {
  const sim = window.__game.world;
  let t = null;
  for (const e of sim.entities.values()) if (e.templateId === 'sledge_tusker' && !e.dead) t = e;
  if (!t) return null;
  if (window.__puppet) clearInterval(window.__puppet);
  t.idleStationary = true;
  const len = Math.hypot(bx - ax, bz - az);
  const dir = Math.atan2(bx - ax, bz - az);
  let d = len * share;
  const place = () => {
    const at = sim.groundPos(ax + Math.sin(dir) * d, az + Math.cos(dir) * d);
    t.prevPos = { ...t.pos };
    t.pos.x = at.x;
    t.pos.y = at.y;
    t.pos.z = at.z;
    t.prevFacing = dir;
    t.facing = dir;
  };
  place();
  t.prevPos = { ...t.pos };
  window.__puppet = setInterval(() => {
    d = Math.min(len, d + 2.7 * 0.05);
    place();
  }, 50);
  return { dir, len };
}

/** In-page: pull `templateId` and say where the player should stand. */
function pageStage([templateId, yards, angle]) {
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
  if (!best) return null;
  me.hp = me.maxHp;
  best.maxHp = Math.max(best.maxHp, 1e6);
  best.hp = best.maxHp;
  me.devNoAggro = false;
  sim.aggroMob(best, me, false);
  const a = best.facing + angle;
  return {
    x: best.pos.x + Math.sin(a) * yards,
    z: best.pos.z + Math.cos(a) * yards,
    face: a + Math.PI,
  };
}

/** In-page: where to stand to watch `templateId` go by, not pulled. */
function pageFollow([templateId, yards, angle]) {
  const sim = window.__game.world;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead || e.templateId !== templateId) continue;
    const a = e.facing + angle;
    return {
      x: e.pos.x + Math.sin(a) * yards,
      z: e.pos.z + Math.cos(a) * yards,
      face: a + Math.PI,
    };
  }
  return null;
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
  best.hp = Math.min(best.hp, best.maxHp);
  sim.dealDamage(me, best, best.hp + 10, false, 'physical', 'Shot', 'hit', true);
  return best.id;
}

/** In-page: wound the nearest living mob of `templateId` to `share` health. */
function pageHurt([templateId, share]) {
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
  if (!best) return null;
  best.hp = Math.max(1, Math.round(best.maxHp * share));
  return best.id;
}

/** In-page: the player and the newest mob of `templateId` side by side (the
 *  mob held in place, facing the camera's side). */
function pageLineup(templateId) {
  const sim = window.__game.world;
  const me = sim.player;
  let mob = null;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead || e.templateId !== templateId) continue;
    if (!mob || e.id > mob.id) mob = e;
  }
  if (!mob) return null;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && e.inCombat) {
      e.inCombat = false;
      e.aggroTargetId = null;
      e.aiState = 'idle';
    }
  }
  me.devNoAggro = true;
  // Face to face, a few yards apart: the camera takes them side on.
  const gap = 3 + (mob.bodyRadius ?? 1);
  const x = me.pos.x + Math.sin(me.facing) * gap;
  const z = me.pos.z + Math.cos(me.facing) * gap;
  const at = sim.groundPos(x, z);
  mob.pos.x = at.x;
  mob.pos.y = at.y;
  mob.pos.z = at.z;
  mob.prevPos = { ...mob.pos };
  mob.facing = me.facing + Math.PI;
  mob.prevFacing = mob.facing;
  mob.spawnPos = { ...mob.pos };
  return mob.id;
}

/**
 * In-page, CAPTURE ONLY: this branch carries the creatures, not the Ice Tomb's
 * environment (another branch builds the cirque), so the field draws as a
 * black void. Stand in a plain snowfield and a cold dusk light round the
 * shot (sampled off the sim's own floor) so the creatures can be judged. The
 * real terrain, sky and light rig replace all of it on integration.
 */
async function pageStandIn(radius) {
  // three's classes, borrowed off live objects (the page exposes no module).
  const game = window.__game;
  const scene0 = game.renderer.scene;
  const C = {};
  scene0.traverse((o) => {
    if (o.isMesh && !C.Mesh && o.constructor.name === 'Mesh') C.Mesh = o.constructor;
    if (o.isGroup && !C.Group) C.Group = o.constructor;
    if (o.isMesh && o.material?.isMeshStandardMaterial && !C.Std) {
      C.Std = o.material.constructor;
      C.Color = o.material.color.constructor;
    }
    const g = o.geometry;
    if (g?.isBufferGeometry && !g.isInstancedBufferGeometry && !C.Geo) {
      C.Geo = g.constructor;
      const at = g.getAttribute('position');
      if (at && !at.isInterleavedBufferAttribute) C.Attr = at.constructor;
    }
  });
  if (!C.Mesh || !C.Group || !C.Std || !C.Geo || !C.Attr) return `missing ${Object.keys(C)}`;
  const THREE = {
    Group: C.Group,
    Mesh: C.Mesh,
    MeshStandardMaterial: C.Std,
    BufferGeometry: C.Geo,
    BufferAttribute: C.Attr,
  };

  const scene = game.renderer.scene;
  const old = scene.getObjectByName('captureStandIn');
  if (old) {
    scene.remove(old);
    old.traverse((o) => o.geometry?.dispose?.());
  }
  const group = new THREE.Group();
  group.name = 'captureStandIn';
  const me = game.world.player.pos;
  const step = 2;
  const n = Math.round((radius * 2) / step);
  const pos = new Float32Array((n + 1) * (n + 1) * 3);
  const col = new Float32Array((n + 1) * (n + 1) * 3);
  let k = 0;
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = me.x - radius + i * step;
      const z = me.z - radius + j * step;
      const y = game.world.groundPos(x, z).y;
      pos[k * 3] = x;
      pos[k * 3 + 1] = y;
      pos[k * 3 + 2] = z;
      const s = 0.78 + 0.1 * Math.sin(x * 0.37) * Math.cos(z * 0.29);
      col[k * 3] = s * 0.86;
      col[k * 3 + 1] = s * 0.92;
      col[k * 3 + 2] = s;
      k++;
    }
  }
  const idx = [];
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      idx.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
  );
  ground.receiveShadow = true;
  group.add(ground);
  scene.add(group);
  // Re-grade the scene's own lights to a cold dusk (no light is added).
  scene.traverse((o) => {
    if (o.isHemisphereLight) {
      o.color.setHex(0xbfd8f0);
      o.groundColor.setHex(0x4a5058);
      o.intensity = 1.5;
    } else if (o.isDirectionalLight) {
      o.color.setHex(0xfff0e0);
      o.intensity = 2;
    } else if (o.isAmbientLight) {
      o.intensity = Math.max(o.intensity, 0.4);
    }
  });
  if (scene.fog) {
    scene.fog.color.setHex(0x9fb8cc);
    if ('near' in scene.fog) {
      scene.fog.near = 90;
      scene.fog.far = 260;
    } else scene.fog.density = 0.004;
  }
  scene.background = new C.Color(0x8fa9c2);
  return 'ok';
}

const DEV_NAMES = {
  boneguard: 'sanctum_boneguard',
  scaleguard: 'sanctum_drakonid',
  thawcaller: 'broodsworn_thawcaller',
  goadsmith: 'broodsworn_goadsmith',
  pyretender: 'broodsworn_pyre_tender',
  whelp: 'rime_whelp',
  ogre: 'ogre_sledge_hauler',
  splinter: 'glacier_splinter',
  bonewalker: 'raised_bonewalker',
};

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
  const chat = (page, c) => page.evaluate((cmd) => window.__game.world.chat(cmd), c);
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 300));
    });
    // A dead HMR socket keeps the dev server's full reloads off the page.
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
      charName: 'Icewalker',
      gameBootTimeoutMs: 180000,
      selectorTimeoutMs: 90000,
      settleMs: 4000,
    });
    if (!booted) throw new Error('offline world did not boot');
    for (const cmd of ['/dev level 20', '/dev god', '/dev sanctum enter']) {
      await chat(page, cmd);
      await sleep(1500);
    }
    await sleep(12000);
    await chat(page, '/dev sanctum gates');
    await sleep(2000);
    for (const shot of SHOTS) {
      if (ONLY.length && !ONLY.some((o) => shot.id === o || shot.id.startsWith(o))) continue;
      // A fresh run per shot: every pack where it stands, nothing pulled.
      await chat(page, '/dev sanctum reset');
      await sleep(2500);
      await chat(page, '/dev sanctum gates');
      await sleep(600);
      await page.evaluate((hide) => {
        let tag = document.getElementById('shot-hide-ui');
        if (!tag) {
          tag = document.createElement('style');
          tag.id = 'shot-hide-ui';
          document.head.appendChild(tag);
        }
        tag.textContent = hide ? '#ui, #nameplates { display: none !important; }' : '';
      }, !shot.hud);
      await chat(page, `/dev sanctum tp ${shot.tp}`);
      await sleep(1500);
      await page.evaluate(() => {
        const sim = window.__game.world;
        sim.player.devNoAggro = true;
        sim.player.hp = sim.player.maxHp;
      });
      if (process.env.SHOT_STANDIN !== '0')
        console.log('STANDIN', await page.evaluate(pageStandIn, 90));
      if (shot.puppet !== undefined || shot.tusk !== undefined) {
        // The road's own packs stand clear (they would join every pull).
        for (const pack of ['g1', 'g2', 'g3']) {
          await chat(page, `/dev sanctum kill ${pack}`);
          await sleep(150);
        }
        const o = await page.evaluate(pageTuskerOrigin, [ROAD_A.x, ROAD_A.z]);
        const A = { x: o.x + ROAD_A.x, z: o.z + ROAD_A.z };
        const B = { x: o.x + ROAD_B.x, z: o.z + ROAD_B.z };
        const dir = Math.atan2(B.x - A.x, B.z - A.z);
        if (shot.puppet !== undefined) {
          const share = shot.view[0];
          const len = Math.hypot(B.x - A.x, B.z - A.z);
          const cx = A.x + Math.sin(dir) * len * share;
          const cz = A.z + Math.cos(dir) * len * share;
          const a = dir + shot.view[2];
          const px = cx + Math.sin(a) * shot.view[1];
          const pz = cz + Math.cos(a) * shot.view[1];
          await chat(page, `/dev tp ${px} ${pz}`);
          await sleep(500);
          await page.evaluate(() => {
            window.__game.world.player.devNoAggro = true;
          });
          console.log('PUPPET', await page.evaluate(pagePuppet, [A.x, A.z, B.x, B.z, shot.puppet]));
          shot.face = Math.atan2(cx - px, cz - pz);
        } else {
          await chat(page, `/dev tp ${A.x} ${A.z}`);
          await sleep(500);
          const len = Math.hypot(B.x - A.x, B.z - A.z);
          await page.evaluate(
            ([x, z, f]) => {
              const sim = window.__game.world;
              for (const e of sim.entities.values()) {
                if (e.templateId !== 'sledge_tusker' || e.dead) continue;
                const at = sim.groundPos(x, z);
                e.pos.x = at.x;
                e.pos.y = at.y;
                e.pos.z = at.z;
                e.prevPos = { ...e.pos };
                e.facing = f;
                e.prevFacing = f;
              }
            },
            [
              A.x + Math.sin(dir) * len * shot.tusk,
              A.z + Math.cos(dir) * len * shot.tusk,
              dir + PI,
            ],
          );
          await sleep(700);
          const spot = await page.evaluate(pageStage, ['sledge_tusker', 0, 0]);
          console.log('PULL', shot.id, JSON.stringify(spot));
          shot.face = dir;
        }
        await sleep(shot.pre ?? 600);
      }
      if (shot.follow) {
        const spot = await page.evaluate(pageFollow, shot.follow);
        if (spot) {
          await chat(page, `/dev tp ${spot.x} ${spot.z}`);
          shot.face = spot.face;
        }
        await sleep(1200);
      }
      if (shot.stage) {
        const spot = await page.evaluate(pageStage, shot.stage);
        console.log('STAGE', shot.id, JSON.stringify(spot));
        if (spot) {
          await chat(page, `/dev tp ${spot.x} ${spot.z}`);
          shot.face = spot.face;
        }
        await sleep(shot.pre ?? 600);
      }
      let cmdAt = Date.now();
      for (const type of shot.spawn ?? []) {
        await page.evaluate(() => {
          window.__game.world.player.devNoAggro = false;
        });
        await chat(page, `/dev sanctum spawn ${type}`);
        await sleep(400);
      }
      if (shot.spawn && !shot.lineup) {
        // Face the spawns (they stand 10 yd ahead).
        shot.face = await page.evaluate(() => window.__game.world.player.facing);
      }
      if (shot.away) {
        const at = await page.evaluate((d) => {
          const p = window.__game.world.player;
          return { x: p.pos.x - Math.sin(p.facing) * d, z: p.pos.z - Math.cos(p.facing) * d };
        }, shot.away);
        await chat(page, `/dev tp ${at.x} ${at.z}`);
      }
      if (shot.spread) {
        // The second creature stands a few yards aside (a tether reads).
        await page.evaluate((templateId) => {
          const sim = window.__game.world;
          const me = sim.player;
          let mob = null;
          for (const e of sim.entities.values())
            if (e.kind === 'mob' && !e.dead && e.templateId === templateId) {
              if (!mob || e.id > mob.id) mob = e;
            }
          if (!mob) return;
          const at = sim.groundPos(
            mob.pos.x + Math.cos(me.facing) * 7,
            mob.pos.z - Math.sin(me.facing) * 7,
          );
          mob.pos.x = at.x;
          mob.pos.y = at.y;
          mob.pos.z = at.z;
          mob.prevPos = { ...mob.pos };
        }, shot.spread);
      }
      if (shot.hurt) await page.evaluate(pageHurt, shot.hurt);
      if (shot.waitNew) {
        const t0 = Date.now();
        while (Date.now() - t0 < 20000) {
          const found = await page.evaluate(
            (t) => [...window.__game.world.entities.values()].some((e) => e.templateId === t),
            shot.waitNew,
          );
          if (found) break;
          await sleep(100);
        }
        cmdAt = Date.now();
      }
      if (shot.lineup) {
        const want = shot.waitNew ?? DEV_NAMES[shot.spawn[0]];
        console.log('LINEUP', shot.id, await page.evaluate(pageLineup, want));
        await sleep(600);
      }
      if (shot.pre && !shot.stage && shot.tusk === undefined) await sleep(shot.pre);
      for (const c of shot.cmds ?? []) {
        await chat(page, c);
        cmdAt = Date.now();
        await sleep(shot.cmdWait ?? 1300);
      }
      if (shot.kill) {
        console.log('KILL', shot.id, await page.evaluate(pageKill, shot.kill));
        cmdAt = Date.now();
      }
      if (shot.waitCast) {
        const t0 = Date.now();
        let ok = false;
        while (Date.now() - t0 < 30000) {
          if (await page.evaluate(pageCasting, shot.waitCast)) {
            ok = true;
            break;
          }
          await sleep(60);
        }
        console.log('CAST', shot.id, ok);
        cmdAt = Date.now();
      }
      if (shot.nearSledge) {
        // Stand beyond the sledge from the Tusker, looking back over it.
        const spot = await page.evaluate((d) => {
          let sl = null;
          window.__game.renderer.scene.traverse((o) => {
            if (o.name === 'sanctumSledge') sl = o;
          });
          let t = null;
          for (const e of window.__game.world.entities.values())
            if (e.templateId === 'sledge_tusker') t = e;
          if (!sl || !t) return null;
          const dx = sl.position.x - t.pos.x;
          const dz = sl.position.z - t.pos.z;
          const n = Math.hypot(dx, dz) || 1;
          return { x: sl.position.x + (dx / n) * d, z: sl.position.z + (dz / n) * d };
        }, shot.nearSledge);
        if (spot) await chat(page, `/dev tp ${spot.x} ${spot.z}`);
      }
      if (shot.faceSledge) {
        const f = await page.evaluate(() => {
          let sl = null;
          window.__game.renderer.scene.traverse((o) => {
            if (o.name === 'sanctumSledge') sl = o;
          });
          if (!sl) return null;
          const p = window.__game.world.player.pos;
          return Math.atan2(sl.position.x - p.x, sl.position.z - p.z);
        });
        if (f !== null) shot.face = f;
      }
      await page.evaluate((s) => {
        const p = window.__game.world.player;
        p.facing = s.face ?? p.facing;
        p.prevFacing = p.facing;
        const input = window.__game.input;
        input.camYaw = p.facing + (s.yaw ?? 0);
        input.camPitch = s.pitch;
        input.camDist = s.dist;
      }, shot);
      const frames = shot.burst ?? [shot.wait ?? 1500];
      for (const at of frames) {
        await sleep(Math.max(0, cmdAt + at - Date.now()));
        const file = path.join(
          OUT,
          `${PREFIX}${shot.id}${shot.burst && shot.burst.length > 1 ? `_${at}` : ''}.png`,
        );
        await page.screenshot({ path: file });
        console.log('SHOT', file);
      }
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
