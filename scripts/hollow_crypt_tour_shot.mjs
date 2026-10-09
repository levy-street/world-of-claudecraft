// Screenshot tour of the reworked Hollow Crypt (open-air necropolis): boots an
// offline world on an already-running dev server, enters the crypt through
// /dev crypt, and captures each area and boss arena from a framed camera.
// Evidence tooling, not a repo test.
//
//   node scripts/hollow_crypt_tour_shot.mjs [outDir] [shotId ...]
//
// Env: SHOT_URL (http://127.0.0.1:5198/), BROWSER_PATH, SHOT_PRESET (4),
// SHOT_W / SHOT_H (1600x900), SHOT_GPU=0 to force SwiftShader.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5198/';
const OUT = process.argv[2] ?? path.join('tmp', 'hollow_crypt_tour');
const ONLY = process.argv.slice(3);
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// area: /dev crypt tp target; the player then faces `face` (sim radians, 0 = +z)
// and the camera orbits at yaw/pitch/dist (input.camYaw is relative to facing).
export const SHOTS = [
  { id: 'entrada_vista', area: 'landing', at: [0, -117], face: 0, pitch: 0.26, dist: 13 },
  { id: 'escalera_capilla', area: 'landing', at: [0, -108], face: 0, pitch: 0.42, dist: 20 },
  { id: 'claustro', area: 'cloister', at: [0, -70], face: 0, pitch: 0.3, dist: 18 },
  { id: 'reja_osario', area: 'grille', at: [0, 4], face: 0, pitch: 0.22, dist: 14 },
  { id: 'procesional', area: 'processional', at: [0, 36], face: 0, pitch: 0.28, dist: 18 },
  { id: 'patio_sacristan', area: 'yard', at: [-62, 42], face: -Math.PI / 2, pitch: 0.3, dist: 18 },
  { id: 'jefe1_marrow_campana', area: 'bellyard', at: [-82, 100], face: 0, pitch: 0.3, dist: 18 },
  { id: 'galeria_viuda', area: 'gallery', at: [60, 30], face: 0.6, pitch: 0.3, dist: 18 },
  { id: 'pasarela_alta', area: 'rim', at: [105, 44], face: 0, pitch: 0.35, dist: 16 },
  { id: 'jefe2_rimeweb_telarana', area: 'web', at: [80, 96], face: 0, pitch: 0.28, dist: 18 },
  { id: 'coro', area: 'choir', at: [0, 120], face: 0, pitch: 0.25, dist: 16 },
  { id: 'jefe3_ilvane_balcon', area: 'loft', at: [0, 152], face: 0, pitch: 0.3, dist: 16 },
  { id: 'escalera_hueso', area: 'bonestair', at: [64, 186], face: 0, pitch: 0.3, dist: 18 },
  { id: 'jefe4_morthen_anillo', area: 'ring', at: [4, 228], face: Math.PI, pitch: 0.3, dist: 20 },
  // Floating-geometry pass: the spots the owner reported, and every fixed piece.
  { id: 'fix_rampa_capilla', area: 'landing', at: [5, -92], face: Math.PI, pitch: 0.18, dist: 11 },
  { id: 'fix_arcada_sur', area: 'cloister', at: [16, -58], face: Math.PI, pitch: 0.12, dist: 12 },
  {
    id: 'fix_arcada_oeste',
    area: 'cloister',
    at: [-26, -30],
    face: -Math.PI / 2,
    pitch: 0.12,
    dist: 12,
  },
  {
    id: 'fix_columna_textura',
    area: 'cloister',
    at: [-33, -12],
    face: -Math.PI / 2,
    pitch: 0.05,
    dist: 5,
  },
  { id: 'fix_escalera_hueso', area: 'bonestair', at: [61, 168], face: 0.25, pitch: 0.28, dist: 12 },
  {
    id: 'fix_puente_este',
    area: 'processional',
    at: [30, 101],
    face: Math.PI / 2,
    pitch: 0.22,
    dist: 12,
  },
  { id: 'fix_telarana', area: 'web', at: [80, 104], face: 0, pitch: 0.12, dist: 16 },
  { id: 'fix_corona_anillo', area: 'ring', at: [0, 188], face: 0, pitch: 0.1, dist: 22 },
  {
    id: 'fix_capilla_entrada',
    area: 'landing',
    at: [0, -124],
    face: Math.PI,
    pitch: 0.12,
    dist: 14,
  },
  { id: 'fix_ventanal_coro', area: 'loft', at: [0, 160], face: 0, pitch: 0.15, dist: 14 },
];

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
    protocolTimeout: 180000,
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
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 120000 });
    const booted = await enterOfflineGame(page, {
      charClass: 'warrior',
      charName: 'Cryptwalker',
      gameBootTimeoutMs: 120000,
      selectorTimeoutMs: 60000,
      settleMs: 4000,
    });
    if (!booted) throw new Error('offline world did not boot');
    for (const cmd of [
      '/dev level 20',
      '/dev god',
      '/dev noaggro',
      '/dev crypt enter',
      '/dev crypt gates',
    ]) {
      await page.evaluate((c) => window.__game.world.chat(c), cmd);
      await sleep(1200);
    }
    // Wait for the interior group.
    await page.waitForFunction(
      () => {
        let found = false;
        window.__game.renderer.scene.traverse((o) => {
          if (o.name === 'hollowCryptField') found = true;
        });
        return found;
      },
      { timeout: 120000, polling: 1000 },
    );
    await sleep(4000);
    // Debug aid: SHOT_HIDE=name,name hides named scene objects.
    if (process.env.SHOT_HIDE) {
      await page.evaluate((names) => {
        window.__game.renderer.scene.traverse((o) => {
          if (names.includes(o.name)) o.visible = false;
        });
      }, process.env.SHOT_HIDE.split(','));
    }
    // Hide the HUD for clean frames.
    await page.addStyleTag({
      content: '#ui, #nameplates { display: none !important; }',
    });
    // The slot origin: the landing's arrival point is instance-local (0, -130).
    await page.evaluate(() => window.__game.world.chat('/dev crypt tp landing'));
    await sleep(800);
    const origin = await page.evaluate(() => {
      const p = window.__game.world.player;
      return { x: p.pos.x, z: p.pos.z + 130 };
    });
    for (const shot of SHOTS) {
      if (ONLY.length && !ONLY.includes(shot.id)) continue;
      await sleep(1600); // clear of the chat throttle
      const [lx, lz] = shot.at;
      await page.evaluate(
        (c) => window.__game.world.chat(c),
        `/dev tp ${origin.x + lx} ${origin.z + lz}`,
      );
      await sleep(600);
      await page.evaluate((s) => {
        const w = window.__game.world;
        const p = w.player;
        const o = { x: p.pos.x, z: p.pos.z };
        // Recover the slot origin from the dev area anchor (tp just placed us).
        const base = window.__hcBase ?? null;
        void base;
        p.facing = s.face;
        p.prevFacing = s.face;
        const input = window.__game.input;
        input.camYaw = s.yaw ?? 0;
        input.camPitch = s.pitch;
        input.camDist = s.dist;
        return o;
      }, shot);
      await sleep(2500);
      const perf = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const info = window.__game.renderer.webgl.info.render;
            let frames = 0;
            const t0 = performance.now();
            const tick = () => {
              frames++;
              if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
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
      const file = path.join(OUT, `hollow_crypt_${shot.id}.png`);
      await page.screenshot({ path: file });
      console.log('SHOT', file);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
