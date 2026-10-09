// Evidence shots of the Drowned Temple's sixth pass in a live offline world,
// each beside the player: the trash's second jobs (the Lagoon Eel's Lightning
// Spit and level-headed S-wave, the Templeguard's Skewering Trident, the
// Pearlguard's Pearl Slam, the Acolyte's Pale Mending), the elemental Mere
// Hydra (its tinted necks and element glows, the Crushing Torrent, the Venom
// Spit's pools, the Tsunami rising and rolling, a head regrowing), the walking
// Tideglass Colossus, the Prism Stair and the Moonbridge, and Ysolei (her
// scale beside the player, Lunar Tide, the Undertow's suction and crash, the
// Rising Tide). Evidence tooling, not a repo test.
//
//   node scripts/drowned_temple_pass6_shot.mjs [outDir] [shotId ...]
//
// Env: SHOT_URL (http://127.0.0.1:5200/), BROWSER_PATH, SHOT_PRESET (4),
// SHOT_W / SHOT_H (1600x900), SHOT_GPU=0 to force SwiftShader, SHOT_PREFIX
// (file prefix, default "pasada6_").
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5200/';
const OUT = process.argv[2] ?? path.join('tmp', 'drowned_temple_pass6');
const ONLY = process.argv.slice(3);
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const PREFIX = process.env.SHOT_PREFIX ?? 'pasada6_';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// at: instance-local spot the player stands on; face: sim radians (0 = +z);
// the camera orbits at yaw/pitch/dist. `js` steps: pull:<templateId> pulls
// the nearest onto the player; kill:<templateId> kills the nearest; low:<id>
// drops it under 60 percent (and hold: 29 percent for its enrage).
const SHOTS = [
  // ---- item 4: the stair after the Hydra and the Moonbridge after the Colossus
  { id: 'escalera_prisma', at: [30, 125], face: 0.8, pitch: 0.26, dist: 16 },
  { id: 'puente_lunar', at: [60, 208], face: -Math.PI / 2, pitch: 0.2, dist: 14 },
  {
    id: 'puente_lunar_desde_terraza',
    at: [66, 208],
    face: -Math.PI / 2,
    yaw: -Math.PI / 2,
    pitch: 0.12,
    dist: 9,
  },
  // ---- item 2: the Lagoon Eel
  {
    id: 'anguila_lanza_rayo',
    at: [0, -12],
    face: 0,
    pitch: 0.34,
    dist: 16,
    cmds: ['/dev temple spawn eel'],
    cmdWait: 7600,
    wait: 300,
  },
  {
    id: 'anguila_ondulacion',
    at: [0, -12],
    face: 0,
    pitch: 0.14,
    dist: 11,
    cmds: ['/dev temple spawn eel'],
    cmdWait: 1200,
    wait: 800,
    js: 'calm:ice_wraith',
  },
  // ---- item 1: the trash's second jobs
  {
    id: 'guardia_tridente',
    at: [0, -12],
    face: 0,
    pitch: 0.4,
    dist: 18,
    cmds: ['/dev temple spawn templeguard'],
    cmdWait: 7400,
    wait: 300,
  },
  {
    id: 'centinela_golpe_perla',
    at: [0, -12],
    face: 0,
    pitch: 0.4,
    dist: 16,
    cmds: ['/dev temple spawn sentinel'],
    cmdWait: 7600,
    wait: 200,
  },
  {
    id: 'acolita_sanacion',
    at: [0, -12],
    face: 0,
    pitch: 0.3,
    dist: 14,
    cmds: ['/dev temple spawn acolyte', '/dev temple spawn templeguard'],
    cmdWait: 400,
    js: 'hurt:drowned_templeguard',
    stepWait: 4600,
    wait: 300,
  },
  // ---- item 6: the Mere Hydra
  {
    id: 'hidra_elementos',
    at: [0, 74],
    face: 0,
    pitch: 0.12,
    dist: 16,
    js: 'pull:mere_hydra_head_center',
    wait: 3500,
  },
  {
    id: 'hidra_torrente',
    at: [6, 80],
    face: 0,
    pitch: 0.4,
    dist: 22,
    js: 'pull:mere_hydra_head_right',
    cmds: ['/dev temple trigger torrent'],
    cmdWait: 200,
    wait: 1700,
  },
  {
    id: 'hidra_veneno',
    at: [-4, 80],
    face: 0,
    pitch: 0.5,
    dist: 20,
    js: 'pull:mere_hydra_head_center',
    cmds: ['/dev temple trigger spit'],
    cmdWait: 200,
    wait: 2600,
  },
  {
    id: 'hidra_tsunami_se_alza',
    at: [-14, 80],
    face: Math.PI / 2,
    yaw: 0.4,
    pitch: 0.3,
    dist: 26,
    js: 'pull:mere_hydra_head_center',
    cmds: ['/dev temple trigger tsunami'],
    cmdWait: 200,
    wait: 2600,
  },
  {
    id: 'hidra_tsunami_rompe',
    at: [-14, 80],
    face: Math.PI / 2,
    yaw: 0.4,
    pitch: 0.3,
    dist: 26,
    js: 'pull:mere_hydra_head_center',
    cmds: ['/dev temple trigger tsunami'],
    cmdWait: 200,
    wait: 3900,
  },
  // The breaking wave (temple_tsunami_fx.ts): the lip curling over, the crash on the
  // middle line, the foam it leaves, and its profile from the north rim.
  ...[
    ['hidra_tsunami_crece', 1600],
    ['hidra_tsunami_rizo', 4300],
    ['hidra_tsunami_choque', 4900],
    ['hidra_tsunami_espuma', 7200],
  ].map(([id, wait]) => ({
    id,
    at: [-14, 80],
    face: Math.PI / 2,
    yaw: 0.4,
    pitch: 0.3,
    dist: 26,
    js: 'pull:mere_hydra_head_center',
    cmds: ['/dev temple trigger tsunami'],
    cmdWait: 200,
    wait,
  })),
  {
    id: 'hidra_tsunami_perfil',
    at: [0, 102],
    face: Math.PI,
    yaw: 0.0,
    pitch: 0.22,
    dist: 20,
    js: 'pull:mere_hydra_head_center',
    cmds: ['/dev temple trigger tsunami'],
    cmdWait: 200,
    wait: 4300,
  },
  {
    id: 'hidra_cabeza_rebrota',
    at: [0, 76],
    face: 0,
    pitch: 0.14,
    dist: 16,
    js: 'kill:mere_hydra_head_left',
    cmds: ['/dev temple trigger regrow'],
    cmdWait: 300,
    wait: 1200,
  },
  // A regrowing head mid-rise (it rises straight out of the pool), and the
  // last head falling after the other two (each stays down: nothing pops
  // back up), its breath cut with it.
  {
    id: 'hidra_rebrote_a_medias',
    at: [0, 76],
    face: 0,
    pitch: 0.14,
    dist: 16,
    js: 'kill:mere_hydra_head_left',
    cmds: ['/dev temple trigger regrow'],
    cmdWait: 300,
    wait: 350,
  },
  {
    id: 'hidra_ultima_cabeza_cae',
    at: [0, 76],
    face: 0,
    pitch: 0.14,
    dist: 16,
    js: 'slay:mere_hydra_head_left,mere_hydra_head_center',
    stepWait: 2500,
    js2: 'kill:mere_hydra_head_right',
    js2Wait: 150,
    wait: 150,
  },
  {
    id: 'hidra_ultima_cabeza_despues',
    at: [0, 76],
    face: 0,
    pitch: 0.14,
    dist: 16,
    js: 'slay:mere_hydra_head_left,mere_hydra_head_center',
    stepWait: 2500,
    js2: 'kill:mere_hydra_head_right',
    js2Wait: 1500,
    wait: 300,
  },
  // ---- item 3: the walking Colossus
  {
    id: 'coloso_persigue',
    at: [70, 200],
    face: 1.2,
    yaw: 0.9,
    pitch: 0.22,
    dist: 22,
    js: 'pull:tideglass_colossus',
    stepWait: 2600,
    wait: 200,
  },
  // ---- item 5: Ysolei
  { id: 'ysolei_escala', at: [-4, 207], face: -1.5, yaw: -1.5, pitch: 0.1, dist: 14, wait: 3000 },
  // Her dais, a melee swing from its rim, and the camera's boss zoom: the
  // wheel rolled all the way out (22 yd everywhere else, up to 40 with her).
  {
    id: 'ysolei_tarima_y_zoom',
    at: [-15.5, 206],
    face: -Math.PI / 2,
    yaw: -Math.PI / 2,
    pitch: 0.3,
    dist: 20,
    wheel: 100,
    js: 'pull:ysolei',
    stepWait: 2500,
    wait: 1500,
  },
  {
    id: 'ysolei_marea_lunar',
    at: [-10, 200],
    face: -1.3,
    yaw: -1.3,
    pitch: 0.3,
    dist: 20,
    js: 'pull:ysolei',
    stepWait: 4600,
    wait: 800,
  },
  {
    id: 'ysolei_resaca',
    at: [-9, 199],
    face: -1.2,
    yaw: -1.2,
    pitch: 0.42,
    dist: 20,
    js: 'pull:ysolei',
    cmds: ['/dev temple trigger undertow'],
    cmdWait: 200,
    wait: 1600,
  },
  {
    id: 'ysolei_choque',
    at: [-9, 199],
    face: -1.2,
    yaw: -1.2,
    pitch: 0.42,
    dist: 20,
    js: 'pull:ysolei',
    cmds: ['/dev temple trigger undertow'],
    cmdWait: 200,
    wait: 3150,
  },
  {
    id: 'ysolei_inundacion',
    at: [-8, 206],
    face: -Math.PI / 2,
    yaw: -Math.PI / 2,
    pitch: 0.72,
    dist: 22,
    js: 'pull:ysolei',
    cmds: ['/dev temple trigger flood'],
    wait: 2500,
  },
];

/** In-page helpers for a shot's js step (offline Sim only). */
function pageStep([step, origin]) {
  const sim = window.__game.world;
  const me = sim.player;
  const [verb, id] = step.split(':');
  if (verb === 'slay') {
    // Several heads at once (comma list), the fight held on the player.
    for (const e of sim.entities.values())
      if (e.kind === 'mob' && !e.dead && e.templateId.startsWith('mere_hydra'))
        sim.aggroMob(e, me, false);
    const out = [];
    for (const t of id.split(',')) {
      for (const e of sim.entities.values())
        if (e.kind === 'mob' && !e.dead && e.templateId === t) {
          sim.ctx.handleDeath(e, me);
          out.push(e.id);
          break;
        }
    }
    return out.join(',');
  }
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
  if (verb === 'kill') {
    for (const e of sim.entities.values())
      if (e.kind === 'mob' && !e.dead && e.templateId.startsWith('mere_hydra'))
        sim.aggroMob(e, me, false);
    sim.ctx.handleDeath(best, me);
    return best.id;
  }
  if (verb === 'hurt') {
    best.hp = Math.floor(best.maxHp * 0.4);
    return best.id;
  }
  if (verb === 'calm') {
    // Hold it idle (no casts) so the shot shows its idle S-wave.
    best.inCombat = false;
    best.aggroTargetId = null;
    best.aiState = 'idle';
    return best.id;
  }
  best.maxHp = Math.max(best.maxHp, 1e6);
  best.hp = best.maxHp;
  sim.aggroMob(best, me, false);
  void origin;
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
      '/dev temple enter',
      '/dev temple gates',
      '/dev temple kill trash',
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
      // Nothing from an earlier shot joins this one: every stray trash mob and
      // summon dies, every boss drops its fight.
      await page.evaluate(() => {
        const sim = window.__game.world;
        const keep = /^(choirmother_selthe|tideglass_colossus|ysolei|mere_hydra_head_)/;
        for (const e of [...sim.entities.values()]) {
          if (e.kind !== 'mob' || e.dead) continue;
          if (!keep.test(e.templateId)) sim.ctx.handleDeath(e, sim.player);
          else if (e.inCombat) {
            e.inCombat = false;
            e.aggroTargetId = null;
            e.aiState = 'evade';
          }
        }
      });
      await sleep(1200);
      if (shot.js) {
        console.log('STEP', shot.id, await page.evaluate(pageStep, [shot.js, origin]));
        await sleep(shot.stepWait ?? 900);
      }
      if (shot.js2) {
        console.log('STEP2', shot.id, await page.evaluate(pageStep, [shot.js2, origin]));
        await sleep(shot.js2Wait ?? 300);
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
        // A wheel roll (zoomBy honours the live zoom ceiling).
        if (s.wheel) input.zoomBy(s.wheel);
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
