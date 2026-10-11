// Screenshots of the Hollow Crypt's hero creatures in a live offline world,
// each beside the player for scale: the Ossuary Drake on the wing against the
// moon, its Barrowflame Breath (the inhale and the torrent), tail sweep, wing
// buffet and landing; the Chapel Gargoyle perched, diving and shrieking; and
// the route over the Webbed Causeway and up the Bone Stair. Evidence tooling,
// not a repo test.
//
//   node scripts/hollow_crypt_creature_shot.mjs [outDir] [shotId ...]
//
// Env: SHOT_URL (http://127.0.0.1:5198/), SHOT_W / SHOT_H (1600x900).
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5198/';
const OUT = process.argv[2] ?? path.join('tmp', 'hollow_crypt_creatures');
const ONLY = process.argv.slice(3);
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// kind 'sky': from a spot, look at the drake on its patrol.
// kind 'spawn': raise a creature ahead (pulled), wait for a cast phase, shoot.
// kind 'place': stand somewhere in the run (gates opened) and shoot the view.
export const SHOTS = [
  // The patrol overhead, framed toward the moon (north), from the Processional.
  { id: 'dragon_vuelo_luna', kind: 'sky', at: [2, 30], window: [52, 80], pitch: -0.38, dist: 8 },
  { id: 'dragon_vuelo_alto', kind: 'sky', at: [-4, 44], window: [58, 76], pitch: -0.62, dist: 5 },
  {
    id: 'dragon_aterriza',
    kind: 'spawn',
    mob: 'drake',
    seconds: 1.2,
    pitch: 0.04,
    dist: 30,
    yaw: 0.5,
  },
  {
    id: 'dragon_escala',
    kind: 'spawn',
    mob: 'drake',
    seconds: 4.5,
    pitch: 0.1,
    dist: 26,
    yaw: 1.2,
  },
  {
    id: 'dragon_aliento_carga',
    kind: 'spawn',
    mob: 'drake',
    cast: 'crypt_barrowflame_breath',
    phase: 0.8,
    pitch: 0.16,
    dist: 30,
    yaw: 0.9,
  },
  {
    id: 'dragon_aliento_fuego',
    kind: 'spawn',
    mob: 'drake',
    cast: 'crypt_barrowflame_breath',
    after: 0.5,
    pitch: 0.3,
    dist: 30,
    yaw: 1.1,
  },
  // Pass four: the ghost fire up close, beside the player.
  {
    id: 'dragon_aliento_cerca',
    kind: 'spawn',
    mob: 'drake',
    cast: 'crypt_barrowflame_breath',
    after: 0.8,
    pitch: 0.12,
    dist: 20,
    yaw: 1.5,
  },
  {
    id: 'dragon_aliento_brasas',
    kind: 'spawn',
    mob: 'drake',
    cast: 'crypt_barrowflame_breath',
    after: 2.6,
    pitch: 0.7,
    dist: 30,
    yaw: 0.8,
  },
  {
    id: 'dragon_coletazo',
    kind: 'spawn',
    mob: 'drake',
    cast: 'crypt_tail_lash',
    after: 0.12,
    pitch: 0.4,
    dist: 32,
    yaw: 1.3,
  },
  {
    id: 'dragon_aletazo',
    kind: 'spawn',
    mob: 'drake',
    cast: 'crypt_wing_gust',
    after: 0.15,
    pitch: 0.3,
    dist: 30,
    yaw: 0.7,
  },
  { id: 'gargola_posada', kind: 'pack', pack: 'c3', pitch: -0.05, dist: 12, yaw: 0.35 },
  { id: 'gargola_arcada', kind: 'pack', pack: 'c1', pitch: 0.1, dist: 16, yaw: 0.6 },
  {
    id: 'gargola_despierta',
    kind: 'spawn',
    mob: 'gargoyle',
    seconds: 0.3,
    pitch: -0.1,
    dist: 14,
    yaw: 0.5,
  },
  {
    id: 'gargola_picado',
    kind: 'spawn',
    mob: 'gargoyle',
    seconds: 0.8,
    pitch: 0.0,
    dist: 14,
    yaw: 0.5,
  },
  {
    id: 'gargola_impacto',
    kind: 'spawn',
    mob: 'gargoyle',
    seconds: 1.2,
    pitch: 0.3,
    dist: 15,
    yaw: 0.6,
  },
  {
    id: 'gargola_chillido',
    kind: 'spawn',
    mob: 'gargoyle',
    cast: 'crypt_stone_shriek',
    phase: 0.6,
    pitch: 0.25,
    dist: 16,
    yaw: 0.7,
  },
  {
    id: 'gargola_chillido_onda',
    kind: 'spawn',
    mob: 'gargoyle',
    cast: 'crypt_stone_shriek',
    after: 0.12,
    pitch: 0.5,
    dist: 20,
    yaw: 0.7,
  },
  {
    id: 'gargola_escala',
    kind: 'spawn',
    mob: 'gargoyle',
    seconds: 3,
    pitch: 0.05,
    dist: 12,
    yaw: 1.3,
  },
  // The route: the Webbed Causeway back up out of the Great Web, then the Bone Stair.
  {
    id: 'ruta_calzada_telarana',
    kind: 'place',
    at: [60, 103],
    face: [20, 100],
    pitch: 0.3,
    dist: 14,
    yaw: -1.6,
  },
  {
    id: 'ruta_procesional_oeste',
    kind: 'place',
    at: [-12, 96],
    face: [-30, 100],
    pitch: 0.3,
    dist: 14,
    yaw: -1.4,
  },
  {
    id: 'ruta_rellano_escalera',
    kind: 'place',
    at: [44, 161],
    face: [60, 161],
    pitch: 0.28,
    dist: 16,
    yaw: 1.5,
  },
  {
    id: 'ruta_escalera_hueso',
    kind: 'place',
    at: [63, 176],
    face: [66, 208],
    pitch: 0.3,
    dist: 16,
    yaw: 0.1,
  },
  {
    id: 'ruta_escalera_cima',
    kind: 'place',
    at: [40, 239],
    face: [6, 234],
    pitch: 0.3,
    dist: 16,
    yaw: -1.6,
  },
];

async function main() {
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: [`--window-size=${W},${H}`, '--use-angle=d3d11', '--ignore-gpu-blocklist'],
    defaultViewport: { width: W, height: H },
    protocolTimeout: 240000,
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' || /THREE\.WebGLProgram|shader/i.test(m.text()))
        console.log('CONSOLE:', m.text().slice(0, 400));
    });
    await page.evaluateOnNewDocument(() => {
      try {
        localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 4 }));
      } catch {
        /* ignore */
      }
    });
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 120000 });
    const booted = await enterOfflineGame(page, {
      charClass: 'warrior',
      charName: 'Cryptwalker',
      gameBootTimeoutMs: 120000,
      selectorTimeoutMs: 60000,
      settleMs: 4000,
    });
    if (!booted) throw new Error('offline world did not boot');
    const chat = async (c) => {
      await page.evaluate((line) => window.__game.world.chat(line), c);
      await sleep(1300);
    };
    for (const c of ['/dev level 20', '/dev god', '/dev crypt enter']) await chat(c);
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
    await sleep(5000);
    await page.addStyleTag({ content: '#ui { display: none !important; }' });
    const frame = async (s) =>
      page.evaluate((shot) => {
        const input = window.__game.input;
        input.camYaw = shot.yaw ?? 0;
        input.camPitch = shot.pitch;
        input.camDist = shot.dist;
      }, s);
    const faceTo = async (x, z) =>
      page.evaluate(
        (tx, tz) => {
          const w = window.__game.world;
          const p = w.player;
          p.facing = Math.atan2(tx - p.pos.x, tz - p.pos.z);
          p.prevFacing = p.facing;
        },
        x,
        z,
      );
    const place = async (x, z) =>
      page.evaluate(
        (tx, tz) => {
          const w = window.__game.world;
          const p = w.player;
          const g = w.ctx.groundPos(tx, tz);
          p.pos = { ...g };
          p.prevPos = { ...g };
          w.rebucket?.(p);
        },
        x,
        z,
      );
    let noAggro = false;
    const setNoAggro = async (on) => {
      if (noAggro === on) return;
      await chat('/dev noaggro');
      noAggro = on;
    };
    const origin = async () =>
      page.evaluate(() => {
        const w = window.__game.world;
        const p = w.player;
        // The crypt anchors are instance-local: the landing sits at (0, -130).
        return { x: p.pos.x, z: p.pos.z };
      });
    await chat('/dev crypt tp landing');
    const land = await origin();
    const O = { x: land.x - 0, z: land.z + 130 };
    // The standing views first (packs, the patrol, the route), then clear the
    // run so each raised creature fights alone on an open floor.
    const order = [...SHOTS].sort((a, b) => (a.kind === 'spawn') - (b.kind === 'spawn'));
    let cleared = false;
    for (const shot of order) {
      if (ONLY.length && !ONLY.includes(shot.id)) continue;
      if (shot.kind === 'spawn' && !cleared) {
        await chat('/dev crypt kill all');
        cleared = true;
      }
      await setNoAggro(shot.kind !== 'spawn');
      if (shot.kind === 'pack') {
        await chat(`/dev crypt pack ${shot.pack}`);
        await page.evaluate(() => {
          const w = window.__game.world;
          const p = w.player;
          let best = null;
          for (const e of w.entities.values()) {
            if (e.kind !== 'mob' || e.dead || e.templateId !== 'crypt_chapel_gargoyle') continue;
            const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
            if (d < 40 && (!best || d < best.d)) best = { e, d };
          }
          if (best) {
            p.facing = Math.atan2(best.e.pos.x - p.pos.x, best.e.pos.z - p.pos.z);
            p.prevFacing = p.facing;
          }
        });
        await frame(shot);
        await sleep(2500);
      } else if (shot.kind === 'sky') {
        await place(O.x + shot.at[0], O.z + shot.at[1]);
        // Wait for the drake to fly into the window of its loop north of us.
        await page
          .waitForFunction(
            (oz, lo, hi) => {
              for (const e of window.__game.world.entities.values()) {
                if (e.templateId !== 'crypt_ossuary_drake' || e.dead) continue;
                const z = e.pos.z - oz;
                return z > lo && z < hi;
              }
              return false;
            },
            { timeout: 90000, polling: 100 },
            O.z,
            shot.window[0],
            shot.window[1],
          )
          .catch(() => console.log('NO DRAKE WINDOW', shot.id));
        const yaw = await page.evaluate(() => {
          const w = window.__game.world;
          const p = w.player;
          for (const e of w.entities.values()) {
            if (e.templateId !== 'crypt_ossuary_drake' || e.dead) continue;
            p.facing = Math.atan2(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
            p.prevFacing = p.facing;
            return p.facing;
          }
          return 0;
        });
        shot.yaw = yaw;
        await frame(shot);
        await sleep(200);
      } else if (shot.kind === 'place') {
        await chat('/dev crypt gates');
        await place(O.x + shot.at[0], O.z + shot.at[1]);
        await sleep(2500);
        await faceTo(O.x + shot.face[0], O.z + shot.face[1]);
        await frame(shot);
        await sleep(1500);
      } else {
        await chat('/dev crypt tp processional');
        await place(O.x, O.z + 62);
        await faceTo(O.x, O.z + 90);
        await sleep(400);
        await chat(`/dev crypt spawn ${shot.mob}`);
        await frame(shot);
        if (shot.cast) {
          // Wait for the bar (and past it for `after` seconds into the effect).
          await page
            .waitForFunction(
              (cast, phase, end) => {
                for (const e of window.__game.world.entities.values())
                  if (
                    e.castingAbility === cast &&
                    e.castTotal > 0 &&
                    (end ? e.castRemaining <= 0.18 : 1 - e.castRemaining / e.castTotal >= phase)
                  )
                    return true;
                return false;
              },
              { timeout: 60000, polling: 'raf' },
              shot.cast,
              shot.phase ?? 0.5,
              shot.after !== undefined,
            )
            .catch(() => console.log('NO CAST', shot.id));
          if (shot.behind) {
            // Step behind the drake so the sweep has someone to hit.
            await page.evaluate(() => {
              const w = window.__game.world;
              const p = w.player;
              for (const e of w.entities.values()) {
                if (e.templateId !== 'crypt_ossuary_drake' || e.dead) continue;
                p.facing = Math.atan2(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
              }
            });
          }
          if (shot.after !== undefined) await sleep(180 + shot.after * 1000);
        } else {
          await sleep((shot.seconds ?? 1) * 1000);
        }
      }
      await frame(shot);
      await sleep(120);
      const file = path.join(OUT, `${shot.id}.png`);
      await page.screenshot({ path: file });
      console.log('SHOT', file);
      if (shot.kind === 'spawn') {
        // A fresh run each time: no corpses of earlier takes in frame.
        await chat('/dev crypt reset');
        await chat('/dev crypt kill all');
        await sleep(1500);
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
