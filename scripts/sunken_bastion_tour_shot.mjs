// Screenshot tour of the reworked Sunken Bastion (open-air sea fortress): boots
// an offline world on an already-running dev server, enters the Bastion through
// /dev bastion, and captures each area, the showpiece and each boss arena from
// a framed camera. Evidence tooling, not a repo test.
//
//   node scripts/sunken_bastion_tour_shot.mjs [outDir] [shotId ...]
//
// Env: SHOT_URL (http://127.0.0.1:5199/), BROWSER_PATH, SHOT_PRESET (4),
// SHOT_W / SHOT_H (1600x900), SHOT_GPU=0 to force SwiftShader, SHOT_PREFIX
// (file prefix, default "bastion_"), SHOT_KEEP_MOBS=1 to leave the packs alive.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5199/';
const OUT = process.argv[2] ?? path.join('tmp', 'sunken_bastion_tour');
const ONLY = process.argv.slice(3);
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const PREFIX = process.env.SHOT_PREFIX ?? 'bastion_';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// at: instance-local spot the player stands on; face: sim radians (0 = +z);
// the camera orbits at yaw/pitch/dist (input.camYaw is relative to facing).
// `cmds` run after the teleport (a boss mechanic trigger, a spawn, a pull).
export const SHOTS = [
  { id: 'entrada_vista', at: [-10, -222], face: 0.1, pitch: 0.12, dist: 12 },
  { id: 'marismas', at: [-30, -196], face: 0.35, pitch: 0.22, dist: 16 },
  { id: 'puerta_del_mar', at: [0, -160], face: 0, pitch: 0.18, dist: 16 },
  { id: 'patio_bajo_capilla', at: [-40, -70], face: 2.3, pitch: 0.2, dist: 15 },
  { id: 'ermitano_torreviejo', at: [36, -88], face: -Math.PI / 2, pitch: 0.18, dist: 18 },
  { id: 'patio_cisterna', at: [40, -96], face: 0, yaw: Math.PI, pitch: 0.32, dist: 16 },
  { id: 'puente_levadizo', at: [57, -60], face: 0, pitch: 0.22, dist: 14 },
  { id: 'muralla', at: [57, 14], face: 0, pitch: 0.22, dist: 14 },
  { id: 'muralla_vista_mar', at: [60, 50], face: 1.4, pitch: 0.12, dist: 12 },
  { id: 'jefe1_olen_bastion', at: [57, 110], face: 0, pitch: 0.3, dist: 18, wait: 6000 },
  { id: 'poterna', at: [30, 126], face: -1.8, pitch: 0.3, dist: 14 },
  { id: 'carcel_hundida', at: [4, 100], face: Math.PI, pitch: 0.3, dist: 18 },
  { id: 'jefe2_ossick_patio', at: [-2, 46], face: Math.PI, pitch: 0.34, dist: 18, wait: 6000 },
  { id: 'escalera_torreon', at: [-62, 40], face: 0, pitch: 0.3, dist: 16 },
  { id: 'balcon_vista', at: [-58, 86], face: 1.8, pitch: 0.26, dist: 14 },
  { id: 'patio_torreon', at: [-40, 140], face: -0.6, pitch: 0.24, dist: 16 },
  { id: 'jefe3_vael_corona', at: [-16, 190], face: 0.5, pitch: 0.3, dist: 20, wait: 6000 },
  { id: 'faro_desde_abajo', at: [-12, 184], face: 0.3, pitch: -0.05, dist: 10 },
  // The player standing IN the moat ring (the floor-height fix): feet on the
  // drawn moat floor, the bailey kerb and the chapel island's lip beside them.
  { id: 'foso_jugador', at: [-6, -113], face: 0.4, yaw: 2.4, pitch: 0.28, dist: 9 },
  { id: 'rampa_puerta_mar', at: [0, -129], face: Math.PI, yaw: 2.0, pitch: 0.3, dist: 10 },
  // The new patrols on their rounds (the tideline hunters, the bailey watch,
  // the court hounds).
  { id: 'patrulla_marismas', at: [-60, -176], face: 0, pitch: 0.3, dist: 14, wait: 5000 },
  { id: 'patrulla_patio_norte', at: [-45, -72], face: 0, pitch: 0.3, dist: 14, wait: 5000 },
  {
    id: 'patrulla_patio_torreon',
    at: [-45, 150],
    face: -Math.PI / 2,
    pitch: 0.3,
    dist: 14,
    wait: 5000,
  },
  // Each boss up close, idle at its post.
  { id: 'jefe1_olen_cerca', at: [57, 117], face: 0, yaw: 0, pitch: 0.15, dist: 9, wait: 3000 },
  {
    id: 'jefe2_ossick_cerca',
    at: [-2, 23],
    face: 0,
    yaw: Math.PI,
    pitch: 0.15,
    dist: 10,
    wait: 3000,
  },
  {
    id: 'jefe3_vael_cerca',
    at: [4, 219],
    face: 0,
    yaw: -0.85,
    pitch: 0.15,
    dist: 7,
    wait: 3000,
  },
  // The boss mechanics, live: pull the boss onto the player, fire the mechanic.
  {
    id: 'mecanica_olen_carga',
    at: [67, 128],
    face: 0,
    yaw: -0.5,
    pitch: 0.5,
    dist: 22,
    js: 'pull:knight_commander_olen',
    bossAt: [49, 128],
    stepWait: 150,
    cmds: ['/dev bastion trigger charge'],
    wait: 0,
  },
  {
    id: 'mecanica_olen_choque',
    at: [67, 128],
    face: 0,
    yaw: -0.5,
    pitch: 0.5,
    dist: 22,
    js: 'pull:knight_commander_olen',
    bossAt: [49, 128],
    stepWait: 150,
    cmds: ['/dev bastion trigger charge'],
    wait: 1750,
  },
  {
    id: 'mecanica_ossick_gancho',
    at: [10, 16],
    face: 0,
    yaw: -2.2,
    pitch: 0.5,
    dist: 22,
    js: 'pull:gaoler_ossick',
    bossAt: [-6, 30],
    stepWait: 150,
    cmds: ['/dev bastion trigger hook'],
    wait: 1400,
  },
  {
    id: 'mecanica_vael_velo',
    at: [-4, 184],
    face: 0,
    yaw: 0,
    pitch: 0.55,
    dist: 26,
    js: 'pull:vael_the_mistcaller',
    bossAt: [-4, 196],
    stepWait: 150,
    cmds: ['/dev bastion trigger veil'],
    wait: 6000,
  },
  {
    id: 'mecanica_vael_revelado',
    at: [-4, 184],
    face: 0,
    yaw: 0,
    pitch: 0.55,
    dist: 26,
    js: 'pull:vael_the_mistcaller',
    stepWait: 150,
    reveal: true,
    wait: 200,
  },
  {
    id: 'mecanica_ermitano_repliegue',
    at: [36, -78],
    face: 0,
    yaw: Math.PI,
    pitch: 0.35,
    dist: 24,
    js: 'withdraw:turretback_hermit',
    bossAt: [36, -96],
    wait: 1600,
  },
];

/** In-page helpers for a shot's js step: pull a boss onto the player (offline
 *  Sim only), or pull the Hermit and knock it under its withdraw line. */
function pageStep([step, origin, bossAt]) {
  const sim = window.__game.world;
  const me = sim.player;
  const [verb, id] = step.split(':');
  let best = null;
  let bestD = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead || e.templateId !== id) continue;
    const d = Math.hypot(e.pos.x - me.pos.x, e.pos.z - me.pos.z);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  if (!best) return 'none';
  me.hp = me.maxHp;
  me.devNoAggro = false;
  if (bossAt) {
    best.pos.x = origin.x + bossAt[0];
    best.pos.z = origin.z + bossAt[1];
    best.prevPos = { ...best.pos };
  }
  sim.aggroMob(best, me, false);
  if (verb === 'withdraw') best.hp = Math.floor(best.maxHp * 0.2);
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
      charName: 'Tidewalker',
      gameBootTimeoutMs: 180000,
      selectorTimeoutMs: 90000,
      settleMs: 4000,
    });
    if (!booted) throw new Error('offline world did not boot');
    const cmds = [
      '/dev level 20',
      '/dev god',
      '/dev noaggro',
      '/dev bastion enter',
      '/dev bastion gates',
    ];
    for (const cmd of cmds) {
      await page.evaluate((c) => window.__game.world.chat(c), cmd);
      await sleep(1300);
    }
    await page.waitForFunction(
      () => {
        let found = false;
        window.__game.renderer.scene.traverse((o) => {
          if (o.name === 'sunkenBastionField') found = true;
        });
        return found;
      },
      { timeout: 180000, polling: 1000 },
    );
    await sleep(5000);
    if (process.env.SHOT_HIDE) {
      await page.evaluate((names) => {
        window.__game.renderer.scene.traverse((o) => {
          if (names.includes(o.name)) o.visible = false;
        });
      }, process.env.SHOT_HIDE.split(','));
    }
    await page.addStyleTag({ content: '#ui, #nameplates { display: none !important; }' });
    await page.evaluate(() => window.__game.world.chat('/dev bastion tp landing'));
    await sleep(900);
    // The landing arrival is instance-local (-10, -230): recover the slot origin.
    const origin = await page.evaluate(() => {
      const p = window.__game.world.player;
      return { x: p.pos.x + 10, z: p.pos.z + 230 };
    });
    for (const shot of SHOTS) {
      if (ONLY.length && !ONLY.includes(shot.id)) continue;
      await sleep(1600);
      const [lx, lz] = shot.at;
      await page.evaluate(
        (c) => window.__game.world.chat(c),
        `/dev tp ${origin.x + lx} ${origin.z + lz}`,
      );
      await sleep(700);
      if (shot.js) {
        console.log(
          'STEP',
          shot.id,
          await page.evaluate(pageStep, [shot.js, origin, shot.bossAt ?? null]),
        );
        await sleep(shot.stepWait ?? 900);
      }
      for (const c of shot.cmds ?? []) {
        await page.evaluate((cmd) => window.__game.world.chat(cmd), c);
        await sleep(1300);
      }
      await page.evaluate((s) => {
        const p = window.__game.world.player;
        p.facing = s.face;
        p.prevFacing = s.face;
        const input = window.__game.input;
        input.camYaw = s.yaw ?? 0;
        input.camPitch = s.pitch;
        input.camDist = s.dist;
      }, shot);
      await sleep(shot.wait ?? 2800);
      if (shot.reveal) {
        // Wait for the Fogbeacon's beam to find the REAL Vael.
        await page
          .waitForFunction(
            () => {
              const sim = window.__game.world;
              let vael = null;
              let lamp = null;
              for (const e of sim.entities.values()) {
                if (e.templateId === 'vael_the_mistcaller' && !e.dead) vael = e;
                if (e.templateId === 'bastion_beacon_lamp') lamp = e;
              }
              if (!vael || !lamp) return false;
              const a = Math.atan2(vael.pos.x - lamp.pos.x, vael.pos.z - lamp.pos.z);
              let d = a - lamp.facing;
              while (d > Math.PI) d -= Math.PI * 2;
              while (d < -Math.PI) d += Math.PI * 2;
              return d > -0.05 && d < 0.02;
            },
            { timeout: 15000, polling: 30 },
          )
          .catch(() => console.log('reveal wait timed out'));
      }
      if (shot.js) {
        const probe = await page.evaluate((step) => {
          const sim = window.__game.world;
          const id = step.split(':')[1];
          const me = sim.player;
          const out = [];
          for (const e of sim.entities.values()) {
            if (e.templateId !== id) continue;
            out.push({
              ai: e.aiState,
              cast: e.castingAbility,
              dead: e.dead,
              x: Math.round(e.pos.x - me.pos.x),
              z: Math.round(e.pos.z - me.pos.z),
              aggro: e.aggroTargetId,
              fight: e.bastionFight?.kind,
            });
          }
          return JSON.stringify({ me: me.id, out });
        }, shot.js);
        console.log('PROBE', shot.id, probe);
      }
      if (process.env.SHOT_RAY) {
        // Debug: name what sits under a screen point (NDC "x,y").
        const hits = await page.evaluate((ndc) => {
          const r = window.__game.renderer;
          const cam = r.camera;
          const [x, y] = ndc.split(',').map(Number);
          const Vec = r.scene.position.constructor;
          const origin = new Vec().setFromMatrixPosition(cam.matrixWorld);
          const dir = new Vec(x, y, 0.5).unproject(cam).sub(origin).normalize();
          const out = [];
          r.scene.traverse((o) => {
            if ((!o.isMesh && !o.isSprite && !o.isPoints) || !o.geometry) return;
            let vis = true;
            for (let q = o; q; q = q.parent) if (!q.visible) vis = false;
            if (!vis) return;
            if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
            const s = o.geometry.boundingSphere.clone().applyMatrix4(o.matrixWorld);
            const toC = s.center.clone().sub(origin);
            const t = toC.dot(dir);
            if (t < 0) return;
            const d = toC.sub(dir.clone().multiplyScalar(t)).length();
            if (d > s.radius || s.radius > 40) return;
            out.push(
              `${t.toFixed(1)} ${o.type} ${o.name || '-'} < ${o.parent?.name || '-'} < ${o.parent?.parent?.name || '-'} r=${s.radius.toFixed(1)} mat=${o.material?.name || o.material?.type}`,
            );
          });
          return out.sort((a, b) => Number.parseFloat(a) - Number.parseFloat(b)).slice(0, 25);
        }, process.env.SHOT_RAY);
        console.log(`RAY\n${hits.join('\n')}`);
      }
      const file = path.join(OUT, `${PREFIX}${shot.id}.png`);
      await page.screenshot({ path: file });
      console.log('SHOT', file);
      const perf = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const info = window.__game.renderer.webgl.info.render;
            let frames = 0;
            const t0 = performance.now();
            const tick = () => {
              frames++;
              if (performance.now() - t0 < 1500) requestAnimationFrame(tick);
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
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
