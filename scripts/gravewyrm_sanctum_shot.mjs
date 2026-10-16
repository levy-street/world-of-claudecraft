// Evidence shots of the rebuilt Gravewyrm Sanctum (the Ice Tomb of the Wyrm)
// in a live offline world: the first vista from the Gate Landing (the whole
// cirque, the aurora rising from the ice, the lake far below, the dragon in
// the Calving Face), every area of the route, the gates shut and then
// opening, each of the face's crack stages as it rises (bursts of frames:
// `/dev sanctum face <step>`), the chains, the lake, the vault, the Thaw
// Works, the mountains and the M map. Evidence tooling, not a repo test. A
// shot id or an id prefix after the out dir filters the run.
//
//   node scripts/gravewyrm_sanctum_shot.mjs [outDir] [shotId ...]
//
// Env: SHOT_URL (http://127.0.0.1:5241/), SHOT_PRESET (4), SHOT_W / SHOT_H
// (1600x900), SHOT_GPU=0 to force SwiftShader, SHOT_PREFIX (default
// "santuario_"). The shots marked `closed` run first, before the gates open
// (`/dev sanctum gates`); a shot with `burst` writes one frame per offset (ms
// after its commands).
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5241/';
const OUT = process.argv[2] ?? path.join('tmp', 'gravewyrm_sanctum');
const ONLY = process.argv.slice(3);
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const PREFIX = process.env.SHOT_PREFIX ?? 'santuario_';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PI = Math.PI;

// at: instance-local spot the player stands on; face: sim radians (0 = +z,
// north toward the Calving Face); the camera orbits at yaw/pitch/dist.
// `face`: the crack step set before the shot; `rise`: set the step from the
// one below it so the stage's one-shot plays (burst frames).
const LISTED = [
  // ---- the gates shut (before /dev sanctum gates) ----
  {
    id: 'puerta_escarcha_cerrada',
    closed: true,
    at: [-2, -72],
    face: 2.6,
    yaw: 2.6,
    pitch: 0.22,
    dist: 14,
  },
  {
    id: 'escalera_cadenas_cerrada',
    closed: true,
    at: [-58, -30],
    face: 1.4,
    yaw: 1.4,
    pitch: 0.2,
    dist: 12,
  },
  { id: 'puente_cadena_cerrado', closed: true, at: [0, -12], face: 0, pitch: 0.42, dist: 26 },
  { id: 'guarda_boveda_cerrada', closed: true, at: [0, 74], face: 0, pitch: 0.18, dist: 12 },
  { id: 'puerta_tributo_cerrada', closed: true, at: [0, 116], face: 0, pitch: 0.18, dist: 12 },
  // ---- the first vista ----
  { id: 'vista_rellano', at: [0, -218], face: 0, pitch: 0.1, dist: 9 },
  { id: 'vista_rellano_alta', at: [0, -214], face: 0, pitch: 0.3, dist: 16 },
  { id: 'vista_rellano_cielo', at: [0, -218], face: 0, pitch: -0.2, dist: 9 },
  { id: 'tunel_de_la_puerta', at: [0, -218], face: PI, yaw: PI, pitch: 0.12, dist: 16 },
  // ---- the route ----
  { id: 'patio_de_la_clave', at: [-4, -186], face: 0.5, yaw: 0.5, pitch: 0.24, dist: 20 },
  { id: 'camino_del_trineo', at: [-30, -150], face: 0.9, yaw: 0.9, pitch: 0.3, dist: 22 },
  { id: 'camino_curva_baja', at: [18, -104], face: -0.4, yaw: -0.4, pitch: 0.24, dist: 20 },
  { id: 'bifurcacion', at: [0, -74], face: 0, pitch: 0.3, dist: 22 },
  { id: 'campo_de_seracs', at: [-66, -92], face: -0.3, yaw: -0.3, pitch: 0.18, dist: 18 },
  { id: 'puente_de_hielo', at: [-82, -84], face: 0, pitch: 0.3, dist: 16 },
  { id: 'seracs_desde_abajo', at: [-82, -40], face: PI, yaw: PI, pitch: 0.05, dist: 14 },
  { id: 'cornisa_del_ancla', at: [80, -92], face: 1.3, yaw: 1.3, pitch: 0.12, dist: 16 },
  { id: 'muro_de_runas', at: [96, -94], face: PI / 2, yaw: PI / 2, pitch: 0.08, dist: 14 },
  // The same, with the HUD shown: the rune wall's lore line in the chat (it is
  // read on approach, once per claim, so this shot runs right after the one above).
  {
    id: 'muro_de_runas_lore',
    ui: true,
    at: [96, -94],
    face: PI / 2,
    yaw: PI / 2,
    pitch: 0.08,
    dist: 14,
  },
  {
    id: 'gigantes_en_el_hielo',
    at: [96, -46],
    face: PI / 2 + 0.3,
    yaw: PI / 2 + 0.3,
    pitch: 0.1,
    dist: 12,
  },
  { id: 'terraza_del_cerrojo', at: [0, -40], face: 0, pitch: 0.35, dist: 26 },
  {
    id: 'martillo_del_herrero',
    at: [-8, -32],
    face: PI - 0.4,
    yaw: PI - 0.4,
    pitch: 0.25,
    dist: 12,
  },
  { id: 'cadenas_al_hielo', at: [0, -24], face: 0, pitch: -0.12, dist: 14 },
  { id: 'puente_cadena', at: [0, 30], face: PI, yaw: PI, pitch: 0.3, dist: 22 },
  { id: 'obras_del_deshielo', at: [0, 30], face: 0, pitch: 0.3, dist: 24 },
  { id: 'canal_de_deshielo', at: [20, 36], face: 0.6, yaw: 0.6, pitch: 0.45, dist: 14 },
  { id: 'obras_terraza_baja', at: [0, 64], face: 0, pitch: 0.3, dist: 22 },
  { id: 'boveda_ritual', at: [0, 92], face: 0, pitch: 0.45, dist: 24 },
  { id: 'pozas_de_deshielo', at: [6, 100], face: 0.3, yaw: 0.3, pitch: 0.6, dist: 14 },
  { id: 'orilla_de_los_retenidos', at: [-30, 150], face: 0.5, yaw: 0.5, pitch: 0.15, dist: 14 },
  { id: 'lago_y_cara', at: [0, 172], face: 0, pitch: 0.1, dist: 22 },
  { id: 'lago_placas', at: [0, 170], face: 0, pitch: 0.75, dist: 40 },
  { id: 'cara_desde_el_lago', at: [0, 214], face: 0, pitch: -0.08, dist: 14 },
  { id: 'cara_alta', at: [0, 192], face: 0, pitch: 0.3, dist: 60 },
  { id: 'montanas_oeste', at: [-60, -90], face: -PI / 2, yaw: -PI / 2, pitch: 0.02, dist: 12 },
  { id: 'montanas_este', at: [84, -40], face: PI / 2, yaw: PI / 2, pitch: 0.02, dist: 12 },
  { id: 'grieta_profunda', at: [-20, -130], face: -1.2, yaw: -1.2, pitch: 0.75, dist: 20 },
  { id: 'mapa_m', at: [0, -74], face: 0, pitch: 0.3, dist: 18, map: true },
  // ---- the Calving Face's stages (from the shore and from the landing) ----
  { id: 'cara_etapa0', at: [0, 176], face: 0, pitch: 0.06, dist: 18, step: 0 },
  {
    id: 'cara_etapa1_placa',
    at: [-30, 182],
    face: -0.2,
    yaw: -0.2,
    pitch: 0.06,
    dist: 14,
    rise: 1,
    burst: [200, 900, 1600, 2400, 3200, 4500, 6500],
  },
  {
    id: 'cara_etapa2_cadenas',
    at: [0, 176],
    face: 0,
    pitch: 0.12,
    dist: 30,
    rise: 3,
    burst: [200, 1200, 2400, 3600, 5000],
  },
  {
    id: 'cara_etapa2_cadenas_terraza',
    at: [0, -30],
    face: 0,
    pitch: 0.0,
    dist: 20,
    rise: 5,
    burst: [200, 1500, 3000, 4500],
  },
  {
    id: 'cara_etapa3_grieta',
    at: [0, 176],
    face: 0,
    pitch: 0.04,
    dist: 14,
    rise: 6,
    burst: [200, 1200, 2400, 4000],
  },
  {
    id: 'cara_etapa4_desprendida',
    at: [14, 182],
    face: 0.15,
    yaw: 0.15,
    pitch: 0.04,
    dist: 12,
    rise: 7,
    burst: [200, 1500, 3000, 4500, 7000],
  },
  {
    id: 'cara_etapa5_colapso',
    at: [0, 170],
    face: 0,
    pitch: 0.06,
    dist: 16,
    rise: 8,
    burst: [200, 1200, 2400, 3600, 5000, 7000, 9000],
  },
  { id: 'vista_rellano_etapa3', at: [0, -218], face: 0, pitch: 0.1, dist: 9, step: 6 },
  { id: 'vista_rellano_etapa4', at: [0, -218], face: 0, pitch: 0.1, dist: 9, step: 7 },
  // ---- the gates opening (after the closed shots: /dev sanctum gates) ----
  {
    id: 'puerta_escarcha_abriendose',
    closedThenOpen: true,
    at: [-2, -72],
    face: 2.6,
    yaw: 2.6,
    pitch: 0.2,
    dist: 18,
    burst: [300, 1000, 1800, 2600, 4200],
  },
  {
    id: 'puente_cadena_cayendo',
    closedThenOpen: true,
    at: [10, -14],
    face: 0.4,
    yaw: 0.4,
    pitch: 0.3,
    dist: 30,
    burst: [300, 1500, 2700, 3900, 5200, 7000],
  },
];

// SHOT_JSON: a JSON list of ad-hoc shots in the same shape (tuning runs).
const SHOTS = process.env.SHOT_JSON ? JSON.parse(process.env.SHOT_JSON) : LISTED;

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
      charName: 'Rimewalker',
      gameBootTimeoutMs: 180000,
      selectorTimeoutMs: 90000,
      settleMs: 4000,
    });
    if (!booted) throw new Error('offline world did not boot');
    const chat = (c) => page.evaluate((cmd) => window.__game.world.chat(cmd), c);
    for (const cmd of ['/dev level 20', '/dev god', '/dev sanctum enter']) {
      await chat(cmd);
      await sleep(1300);
    }
    await page.waitForFunction(
      () => {
        let found = false;
        window.__game.renderer.scene.traverse((o) => {
          if (o.name === 'gravewyrmSanctumField') found = true;
        });
        return found;
      },
      { timeout: 240000, polling: 1000 },
    );
    await sleep(6000);
    await chat('/dev sanctum tp landing');
    await sleep(900);
    // The landing arrival is instance-local (0, -222): recover the slot origin.
    const origin = await page.evaluate(() => {
      const p = window.__game.world.player;
      return { x: p.pos.x, z: p.pos.z + 222 };
    });
    // The packs stay put but never pull the camera player.
    await page.evaluate(() => {
      window.__game.world.player.devNoAggro = true;
    });
    const wanted = (s) => !ONLY.length || ONLY.some((o) => s.id === o || s.id.startsWith(o));
    const closed = SHOTS.filter((s) => s.closed && wanted(s));
    const open = SHOTS.filter((s) => !s.closed && !s.closedThenOpen && wanted(s));
    const opening = SHOTS.filter((s) => s.closedThenOpen && wanted(s));
    let gatesOpen = false;
    const take = async (shot) => {
      await page.evaluate((hide) => {
        let tag = document.getElementById('shot-hide-ui');
        if (!tag) {
          tag = document.createElement('style');
          tag.id = 'shot-hide-ui';
          document.head.appendChild(tag);
        }
        tag.textContent = hide ? '#ui, #nameplates { display: none !important; }' : '';
      }, !shot.map && !shot.ui);
      await chat(`/dev tp ${origin.x + shot.at[0]} ${origin.z + shot.at[1]}`);
      await sleep(900);
      if (shot.step !== undefined) {
        await chat(`/dev sanctum face ${shot.step}`);
        await sleep(400);
      }
      if (shot.rise !== undefined) {
        // From the step below, so the stage's one-shot plays.
        await chat(`/dev sanctum face ${Math.max(0, shot.rise - (shot.rise === 3 ? 2 : 1))}`);
        await sleep(2500);
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
      // `hide`: object name prefixes hidden for this shot (tuning runs).
      await page.evaluate((names) => {
        window.__shotHidden = [];
        if (!names) return;
        window.__game.renderer.scene.traverse((o) => {
          if (o.visible && names.some((n) => o.name.startsWith(n))) {
            o.visible = false;
            window.__shotHidden.push(o);
          }
        });
      }, shot.hide ?? null);
      await sleep(shot.burst ? 2500 : 3200);
      if (shot.map) {
        await page.keyboard.press('KeyM');
        await sleep(1500);
      }
      if (shot.burst) {
        if (shot.rise !== undefined) await chat(`/dev sanctum face ${shot.rise}`);
        if (shot.closedThenOpen && !gatesOpen) {
          await chat('/dev sanctum gates');
          gatesOpen = true;
        }
        const began = Date.now();
        for (const ms of shot.burst) {
          await sleep(Math.max(0, ms - (Date.now() - began)));
          const frame = path.join(OUT, `${PREFIX}${shot.id}_${ms}.png`);
          await page.screenshot({ path: frame });
          console.log('SHOT', frame);
        }
      } else {
        const file = path.join(OUT, `${PREFIX}${shot.id}.png`);
        await page.screenshot({ path: file });
        console.log('SHOT', file);
      }
      if (shot.map) {
        await page.keyboard.press('KeyM');
        await sleep(500);
      }
      await page.evaluate(() => {
        for (const o of window.__shotHidden ?? []) o.visible = true;
      });
      if (shot.step !== undefined || shot.rise !== undefined) {
        await chat('/dev sanctum face 0');
        await sleep(300);
      }
      const perf = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const info = window.__game.renderer.webgl.info.render;
            let frames = 0;
            const t0 = performance.now();
            const calls0 = info.calls;
            const tris0 = info.triangles;
            const tick = () => {
              frames++;
              if (performance.now() - t0 < 1200) requestAnimationFrame(tick);
              else
                resolve({
                  fps: Math.round((frames * 1000) / (performance.now() - t0)),
                  calls: Math.round((info.calls - calls0) / frames),
                  tris: Math.round((info.triangles - tris0) / frames),
                });
            };
            requestAnimationFrame(tick);
          }),
      );
      console.log('PERF', shot.id, JSON.stringify(perf));
    };
    for (const shot of closed) await take(shot);
    for (const shot of opening) await take(shot);
    if (!gatesOpen) {
      await chat('/dev sanctum gates');
      gatesOpen = true;
      await sleep(8000);
    }
    for (const shot of open) await take(shot);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
