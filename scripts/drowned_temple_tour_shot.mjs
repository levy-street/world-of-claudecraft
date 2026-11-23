// Screenshot tour of the reworked Drowned Temple (open-air lagoon temple):
// boots an offline world on an already-running dev server, enters the Temple
// through /dev temple, and captures each area, the Mere Hydra and each boss
// arena from a framed camera. Evidence tooling, not a repo test.
//
//   node scripts/drowned_temple_tour_shot.mjs [outDir] [shotId ...]
//
// Env: SHOT_URL (http://127.0.0.1:5200/), BROWSER_PATH, SHOT_PRESET (4),
// SHOT_W / SHOT_H (1600x900), SHOT_GPU=0 to force SwiftShader, SHOT_PREFIX
// (file prefix, default "templo_").
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5200/';
const OUT = process.argv[2] ?? path.join('tmp', 'drowned_temple_tour');
const ONLY = process.argv.slice(3);
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const PREFIX = process.env.SHOT_PREFIX ?? 'templo_';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// at: instance-local spot the player stands on; face: sim radians (0 = +z);
// the camera orbits at yaw/pitch/dist (input.camYaw is relative to facing).
// `cmds` run after the teleport (a boss mechanic trigger, a spawn, a pull).
export const SHOTS = [
  // The first vista from the Moongate Landing: the whole crater, the moon, the
  // falls, the temple and the Moon Altar's column.
  { id: 'entrada_vista', at: [0, -226], face: 0, pitch: 0.06, dist: 10 },
  { id: 'entrada_vista_alta', at: [0, -210], face: -0.12, pitch: 0.34, dist: 18 },
  { id: 'escalinata_peregrinos', at: [-20, -176], face: 0.5, pitch: 0.24, dist: 16 },
  { id: 'calzada_reflejos', at: [-6, -150], face: 0.1, pitch: 0.16, dist: 14 },
  { id: 'calzada_estatuas', at: [-2, -118], face: 1.3, pitch: 0.12, dist: 12 },
  { id: 'columnata_mareas', at: [0, -84], face: 0, pitch: 0.2, dist: 14 },
  { id: 'velo_del_coro', at: [0, -42], face: 0, pitch: 0.08, dist: 7 },
  { id: 'jefe1_patio_coro', at: [0, -16], face: 0, pitch: 0.3, dist: 20, wait: 5000 },
  { id: 'caracola_gigante', at: [-16, 4], face: 0.55, pitch: 0.12, dist: 12 },
  { id: 'terrazas_marea', at: [-42, 16], face: -0.9, pitch: 0.28, dist: 16 },
  { id: 'terraza_alta', at: [-64, 52], face: 0.3, pitch: 0.26, dist: 16 },
  { id: 'paseo_cascada', at: [62, 34], face: 0.55, pitch: 0.14, dist: 11 },
  { id: 'gruta_cascada', at: [76, 58], face: -2.4, pitch: 0.2, dist: 13 },
  { id: 'estanque_hidra', at: [0, 70], face: 0, pitch: 0.2, dist: 16, wait: 4000 },
  { id: 'hidra_cerca', at: [0, 80], face: 0, pitch: 0.02, dist: 8, wait: 3000 },
  { id: 'escalera_prisma', at: [30, 125], face: 0.8, pitch: 0.26, dist: 16 },
  { id: 'jefe2_terraza_prisma', at: [80, 190], face: 0.3, pitch: 0.28, dist: 20, wait: 4000 },
  { id: 'puente_lunar', at: [60, 208], face: -Math.PI / 2, pitch: 0.2, dist: 14 },
  { id: 'rellano_altar', at: [36, 208], face: -Math.PI / 2, pitch: 0.3, dist: 16 },
  { id: 'jefe3_altar_lunar', at: [4, 206], face: -Math.PI / 2, pitch: 0.28, dist: 22, wait: 4000 },
  { id: 'columna_plateada', at: [6, 198], face: -1.3, pitch: 0.12, dist: 14 },
  // Each boss mechanic next to the player, for scale.
  {
    id: 'mecanica_selthe_coro_solo',
    at: [0, -4],
    face: 0,
    pitch: 0.5,
    dist: 20,
    js: 'pull:choirmother_selthe',
    cmds: ['/dev temple kill trash', '/dev temple trigger duet'],
    wait: 1500,
  },
  {
    id: 'mecanica_hidra_aliento',
    at: [4, 82],
    face: 0,
    pitch: 0.36,
    dist: 20,
    js: 'pull:mere_hydra_head_left',
    cmds: ['/dev temple trigger breath'],
    cmdWait: 200,
    wait: 700,
  },
  {
    id: 'mecanica_hidra_escupitajo',
    at: [-2, 80],
    face: 0,
    pitch: 0.42,
    dist: 18,
    js: 'pull:mere_hydra_head_center',
    cmds: ['/dev temple trigger spit'],
    cmdWait: 200,
    wait: 500,
  },
  {
    id: 'mecanica_coloso_reflejo',
    at: [84, 196],
    face: 0.2,
    yaw: 1.1,
    pitch: 0.3,
    dist: 12,
    js: 'pull:tideglass_colossus',
    cmds: ['/dev temple trigger reflections'],
    wait: 2200,
  },
  {
    id: 'mecanica_coloso_lanza',
    at: [84, 196],
    face: 0.2,
    pitch: 0.36,
    dist: 18,
    js: 'pull:tideglass_colossus',
    cmds: ['/dev temple trigger lance'],
    cmdWait: 200,
    wait: 600,
  },
  {
    id: 'mecanica_ysolei_marea',
    at: [-16, 206],
    face: -Math.PI / 2,
    pitch: 0.62,
    dist: 32,
    js: 'pull:ysolei',
    cmds: ['/dev temple trigger flood'],
    wait: 2500,
  },
  {
    id: 'mecanica_ysolei_resaca',
    at: [-16, 206],
    face: -Math.PI / 2,
    pitch: 0.4,
    dist: 20,
    js: 'pull:ysolei',
    cmds: ['/dev temple trigger undertow'],
    cmdWait: 200,
    wait: 1200,
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
      charName: 'Moonwader',
      gameBootTimeoutMs: 180000,
      selectorTimeoutMs: 90000,
      settleMs: 4000,
    });
    if (!booted) throw new Error('offline world did not boot');
    const cmds = [
      '/dev level 20',
      '/dev god',
      '/dev noaggro',
      '/dev temple enter',
      '/dev temple gates',
    ];
    for (const cmd of cmds) {
      await page.evaluate((c) => window.__game.world.chat(c), cmd);
      await sleep(1300);
    }
    await page.waitForFunction(
      () => {
        let found = false;
        window.__game.renderer.scene.traverse((o) => {
          if (o.name === 'drownedTempleField') found = true;
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
    await page.evaluate(() => window.__game.world.chat('/dev temple tp landing'));
    await sleep(900);
    // The landing arrival is instance-local (0, -230): recover the slot origin.
    const origin = await page.evaluate(() => {
      const p = window.__game.world.player;
      return { x: p.pos.x, z: p.pos.z + 230 };
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
        await sleep(shot.cmdWait ?? 1300);
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
              fight: e.templeFight?.kind,
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
