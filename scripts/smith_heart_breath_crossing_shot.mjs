// Evidence captures for the Guardian of the Breath's playtest pass of
// 2026-11-25: the landing at the climb's head and the Gale Crossing over the
// chasm to the Cornice, the wind's floor arrows and HUD badge on a LOW preset,
// a rider on the crossing, and Isle Lightning on an isle. Evidence tooling,
// not a repo test. Needs a dev Vite serving the worktree (offline world).
//
//   node scripts/smith_heart_breath_crossing_shot.mjs <outDir>
//
// Env: SHOT_URL (http://127.0.0.1:5197/), SHOT_W / SHOT_H (1600x900),
// SHOT_ONLY (comma list of scene names).
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5197/';
const OUT = process.argv[2] ?? path.join('tmp', 'smith_heart_breath_crossing');
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const ONLY = process.env.SHOT_ONLY ? new Set(process.env.SHOT_ONLY.split(',')) : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BOSS = { x: 0, z: 198 };
const ENTRY = { x: 0, z: 100 };
const OUT_PAD = { x: -59.5, z: 194 };

async function session(preset, fn) {
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
      if (m.type() === 'error' && /shader|WebGL|THREE|program/i.test(m.text()))
        console.log('CONSOLE:', m.text().slice(0, 600));
    });
    await page.evaluateOnNewDocument((p) => {
      try {
        localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: p }));
      } catch {
        /* ignore */
      }
    }, preset);
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 180000 });
    const booted = await enterOfflineGame(page, {
      charClass: 'warrior',
      charName: 'Galewalker',
      gameBootTimeoutMs: 180000,
      selectorTimeoutMs: 90000,
      settleMs: 4000,
    });
    if (!booted) throw new Error('offline world did not boot');
    const chat = async (c, wait = 900) => {
      await page.evaluate((line) => window.__game.world.chat(line), c);
      await sleep(wait);
    };
    for (const c of ['/dev level 20', '/dev god', '/dev heart enter']) await chat(c, 1500);
    await chat('/dev heart kill trash', 600);
    await chat('/dev heart gates', 600);
    await chat('/dev heart tp breath', 4000);
    const O = await page.evaluate(
      ([ex, ez]) => {
        const p = window.__game.world.player;
        return { x: p.pos.x - ex, z: p.pos.z - ez };
      },
      [ENTRY.x, ENTRY.z],
    );
    await page.waitForFunction(
      () => !document.querySelector('#loading-screen')?.classList.contains('visible'),
      { timeout: 240000, polling: 500 },
    );
    const hold = (yaw, pitch, dist) =>
      page.evaluate(
        ([yaw, pitch, dist]) => {
          const p = window.__game.world.player;
          window.__shotHold = { yaw: p.facing + yaw, pitch, dist };
          if (!window.__shotHoldLoop) {
            window.__shotHoldLoop = true;
            const input = window.__game.input;
            const step = () => {
              const h = window.__shotHold;
              if (h) {
                input.zoomMax = Math.max(input.zoomMax, h.dist);
                input.camYaw = h.yaw;
                input.camPitch = h.pitch;
                input.camDist = h.dist;
              }
              requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
          }
        },
        [yaw, pitch, dist],
      );
    const placeMe = (x, z, fx, fz) =>
      page.evaluate(
        ([ox, oz, x, z, fx, fz]) => {
          const w = window.__game.world;
          const p = w.player;
          const g = w.ctx.groundPos(ox + x, oz + z);
          p.pos = { ...g };
          p.prevPos = { ...g };
          p.facing = Math.atan2(fx - x, fz - z);
          p.prevFacing = p.facing;
          w.ctx.rebucket(p);
        },
        [O.x, O.z, x, z, fx, fz],
      );
    const shoot = async (name) => {
      const buf = await page.screenshot({ type: 'jpeg', quality: 90 });
      fs.mkdirSync(OUT, { recursive: true });
      const file = path.join(OUT, `${name}.jpg`);
      fs.writeFileSync(file, buf);
      console.log('SHOT', file);
    };
    await fn({ page, chat, hold, placeMe, shoot });
  } finally {
    await browser.close();
  }
}

const want = (name) => !ONLY || ONLY.has(name);

// 1 and 2 on the high preset: the landing and the road of wind; a rider on it.
if (want('crossing') || want('ride'))
  await session(4, async ({ page, chat, hold, placeMe, shoot }) => {
    await page.addStyleTag({ content: '#ui { display: none !important; }' });
    await chat('/dev heart breath reset', 1500);
    if (want('crossing')) {
      await placeMe(-62, 192, BOSS.x, BOSS.z);
      await hold(
        Number(process.env.SHOT_YAW ?? 1.25),
        Number(process.env.SHOT_PITCH ?? 0.42),
        Number(process.env.SHOT_DIST ?? 30),
      );
      await sleep(7000);
      await shoot('v01_rellano_puente_de_viento');
    }
    if (want('ride')) {
      await placeMe(OUT_PAD.x - 3, OUT_PAD.z, BOSS.x, BOSS.z);
      await hold(-1.2, 0.12, 14);
      await sleep(3000);
      await placeMe(OUT_PAD.x, OUT_PAD.z, BOSS.x, BOSS.z);
      await sleep(1300);
      await shoot('v02_cruzando_el_abismo');
    }
  });

// 3 on the LOW preset: a blow, its floor arrows and the HUD's wind badge.
if (want('wind'))
  await session(1, async ({ page, chat, hold, placeMe, shoot }) => {
    await placeMe(-14, 186, BOSS.x, BOSS.z);
    await hold(0.6, 0.45, 26);
    await sleep(5000);
    await chat('/dev heart breath pull', 1200);
    await chat('/dev heart breath blow 90', 1400);
    if (process.env.SHOT_PROBE)
      console.log(
        'PROBE',
        await page.evaluate(() => {
          const out = [];
          window.__game.renderer.scene.traverse((o) => {
            if (
              o.name === 'smithHeartBreathWindArrows' ||
              o.name === 'smithHeartBreathWindStreaks'
            ) {
              const wp = new o.position.constructor();
              o.getWorldPosition(wp);
              out.push({
                name: o.name,
                vis: o.visible,
                parentVis: o.parent?.visible,
                y: wp.y,
                count: o.geometry.instanceCount,
                strength: o.material.uniforms.uStrength.value,
                flow: o.material.uniforms.uFlow?.value,
                dir: o.material.uniforms.uDir.value,
                centre: o.material.uniforms.uCentre.value,
                progs: (window.__game.renderer.webgl?.info?.programs ?? [])
                  .filter((pr) => /Arrow/.test(pr.name))
                  .map((pr) => [pr.name, pr.diagnostics?.runnable]),
                attrs: Object.keys(o.geometry.attributes),
                idx: o.geometry.index?.count,
              });
            }
          });
          return JSON.stringify(out);
        }),
      );
    await shoot('v03_viento_flechas_preset_bajo');
  });

// 4: Isle Lightning on the first east isle (its adds up).
if (want('bolts'))
  await session(3, async ({ page, chat, hold, shoot }) => {
    await page.addStyleTag({ content: '#ui { display: none !important; }' });
    await chat('/dev heart breath pull', 1200);
    await chat('/dev heart breath isles', 1500);
    await chat('/dev heart breath ride 0', 300);
    await sleep(4500);
    await hold(0.4, 0.55, 20);
    await chat('/dev heart breath bolt 0', 300);
    await chat('/dev heart breath bolt 0', 900);
    await shoot('v04_rayos_en_la_isla');
  });
