// Evidence shots of the Gravewyrm Sanctum's three bosses in a live offline
// world (phase B): Korgath on the Lock Terrace (his four chains, Strain, the
// Stomp, a chain breaking and each freed ability), Velkhar in the Ritual Vault
// (Waking Thaw, the Soulfire Trench and its meltwater strip, the Volley, a Held
// and an Unquenched Bonewalker, Warm Hands), and Korzul on the Wyrm's Hollow
// (the plate floor, Grave Breath, the Tail Sweep, Grave Inferno, the flights
// with the Wyrm's Eye, Plunging Fire, the brood and the Crashing Descent).
// Evidence tooling, not a repo test. A shot id or an id prefix after the out
// dir filters the run.
//
//   node scripts/sanctum_bosses_shot.mjs [outDir] [shotId ...]
//
// Env: SHOT_URL (http://127.0.0.1:5243/), SHOT_PRESET (4), SHOT_W / SHOT_H
// (1600x900), SHOT_GPU=0 to force SwiftShader, SHOT_PREFIX (default
// "santuario_"), SHOT_HEROIC=1 to enter on heroic.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5243/';
const OUT = process.argv[2] ?? path.join('tmp', 'sanctum_bosses');
const ONLY = process.argv.slice(3);
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const PREFIX = process.env.SHOT_PREFIX ?? 'santuario_';
const HEROIC = process.env.SHOT_HEROIC === '1';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PI = Math.PI;
const KORGATH = 'korgath_the_bound';
const VELKHAR = 'grand_necromancer_velkhar';
const KORZUL = 'korzul_the_gravewyrm';
const T = (what) => `/dev sanctum trigger ${what}`;

// at: instance-local spot the player stands on first; face: sim radians (0 =
// +z, north toward the lake); the camera orbits at yaw/pitch/dist. `stage`:
// [templateId, yards, angle] pulls that boss and stands the player there
// facing it. `cmds`: /dev commands after staging. `waitCast`: [templateId,
// castId, share] waits until that bar is that far along. `burst`: frames at
// fixed offsets (ms) after the last command.
const SHOTS = [
  // ---- Korgath the Bound: the Lock Terrace ----
  { id: 'jefe1_terraza', at: [0, -48], face: 0, pitch: 0.5, dist: 44 },
  {
    id: 'jefe1_cadenas',
    at: [0, -36],
    stage: [KORGATH, 12, PI],
    pitch: 0.55,
    dist: 40,
    hud: true,
  },
  {
    id: 'jefe1_tension',
    at: [0, -36],
    stage: [KORGATH, 12, PI],
    cmds: [T('strain')],
    waitCast: [KORGATH, 'sanctum_korgath_strain', 0.6],
    pitch: 0.7,
    dist: 46,
    hud: true,
    wait: 60,
  },
  {
    id: 'jefe1_pisoton',
    at: [0, -36],
    stage: [KORGATH, 6, PI],
    cmds: [T('stomp')],
    waitCast: [KORGATH, 'sanctum_korgath_stomp', 0.6],
    pitch: 0.6,
    dist: 30,
    hud: true,
    wait: 60,
  },
  {
    id: 'jefe1_rotura',
    at: [0, -36],
    stage: [KORGATH, 12, PI * 0.75],
    cmds: [T('break hammer')],
    cmdWait: 50,
    burst: [80, 400, 900],
    pitch: 0.4,
    dist: 30,
    hud: true,
  },
  {
    id: 'jefe1_arco_del_mazo',
    at: [0, -36],
    stage: [KORGATH, 5, PI],
    cmds: [T('break hammer'), T('maul')],
    cmdWait: 300,
    waitCast: [KORGATH, 'sanctum_korgath_maul_arc', 0.5],
    pitch: 0.6,
    dist: 28,
    hud: true,
    wait: 60,
  },
  {
    id: 'jefe1_latigo',
    at: [0, -36],
    stage: [KORGATH, 16, PI],
    cmds: [T('break tongs'), T('flail')],
    cmdWait: 300,
    waitCast: [KORGATH, 'sanctum_korgath_chain_flail', 0.5],
    pitch: 0.65,
    dist: 36,
    hud: true,
    wait: 60,
  },
  {
    id: 'jefe1_carga',
    at: [0, -36],
    stage: [KORGATH, 18, PI],
    cmds: [T('break anvil'), T('charge')],
    cmdWait: 300,
    waitCast: [KORGATH, 'sanctum_korgath_threshold_charge', 0.5],
    pitch: 0.65,
    dist: 38,
    hud: true,
    wait: 60,
  },
  {
    id: 'jefe1_bramido',
    at: [0, -36],
    stage: [KORGATH, 8, PI],
    cmds: [T('break bellows'), T('bellow')],
    cmdWait: 300,
    waitCast: [KORGATH, 'sanctum_korgath_foremans_bellow', 0.6],
    pitch: 0.55,
    dist: 30,
    hud: true,
    wait: 60,
  },
  // ---- Grand Necromancer Velkhar: the Ritual Vault ----
  { id: 'jefe2_boveda', at: [0, 86], face: 0, pitch: 0.5, dist: 40 },
  {
    id: 'jefe2_deshielo',
    at: [0, 92],
    stage: [VELKHAR, 10, PI],
    cmds: [T('thaw')],
    cmdWait: 900,
    pitch: 0.6,
    dist: 36,
    hud: true,
    wait: 100,
  },
  {
    id: 'jefe2_zanja',
    at: [0, 92],
    stage: [VELKHAR, 14, PI],
    cmds: [T('trench')],
    waitCast: [VELKHAR, 'sanctum_velkhar_soulfire_trench', 0.5],
    pitch: 0.7,
    dist: 38,
    hud: true,
    wait: 60,
  },
  {
    id: 'jefe2_franja_de_deshielo',
    at: [0, 92],
    stage: [VELKHAR, 14, PI],
    cmds: [T('trench')],
    cmdWait: 3200,
    pitch: 0.7,
    dist: 38,
    hud: true,
    wait: 100,
  },
  {
    id: 'jefe2_descarga',
    at: [0, 92],
    stage: [VELKHAR, 10, PI],
    cmds: [T('volley')],
    waitCast: [VELKHAR, 'sanctum_velkhar_shadow_volley', 0.6],
    pitch: 0.45,
    dist: 22,
    hud: true,
    wait: 60,
  },
  {
    id: 'jefe2_sin_apagar',
    at: [0, 92],
    stage: [VELKHAR, 10, PI],
    cmds: [T('rise')],
    cmdWait: 600,
    pitch: 0.6,
    dist: 30,
    hud: true,
    wait: 100,
  },
  {
    id: 'jefe2_charco_tibio',
    at: [0, 92],
    stage: [VELKHAR, 10, PI],
    cmds: [T('warm')],
    cmdWait: 900,
    pitch: 0.6,
    dist: 30,
    hud: true,
    wait: 100,
  },
  // ---- Korzul the Gravewyrm: the Wyrm's Hollow ----
  { id: 'jefe3_lago', at: [0, 150], face: 0, pitch: 0.35, dist: 40 },
  {
    id: 'jefe3_despertar',
    at: [0, 176],
    stage: [KORZUL, 26, PI],
    burst: [200, 1200, 2600, 4200],
    pitch: 0.25,
    dist: 30,
    hud: true,
  },
  {
    id: 'jefe3_aliento',
    at: [0, 190],
    stage: [KORZUL, 10, PI],
    cmds: [T('breath')],
    waitCast: [KORZUL, 'sanctum_korzul_grave_breath', 0.6],
    pitch: 0.8,
    dist: 44,
    hud: true,
    wait: 60,
  },
  {
    id: 'jefe3_placas',
    at: [0, 190],
    stage: [KORZUL, 12, PI],
    cmds: [T('crack0'), T('crack1'), T('break2'), T('break8')],
    cmdWait: 200,
    pitch: 0.9,
    dist: 60,
    hud: true,
    wait: 800,
  },
  {
    id: 'jefe3_cola',
    at: [0, 190],
    stage: [KORZUL, 10, PI],
    cmds: [T('tail')],
    waitCast: [KORZUL, 'sanctum_korzul_tail_sweep', 0.6],
    pitch: 0.7,
    dist: 36,
    hud: true,
    wait: 60,
  },
  {
    id: 'jefe3_infierno',
    at: [0, 190],
    stage: [KORZUL, 18, PI],
    cmds: [T('inferno')],
    cmdWait: 3500,
    pitch: 0.6,
    dist: 40,
    hud: true,
    wait: 60,
  },
  {
    id: 'jefe3_vuelo',
    at: [0, 190],
    stage: [KORZUL, 18, PI],
    cmds: [T('flight')],
    burst: [500, 1500, 3500],
    pitch: 0.2,
    dist: 40,
    hud: true,
  },
  {
    id: 'jefe3_ojo_del_wyrm',
    at: [0, 190],
    stage: [KORZUL, 18, PI],
    cmds: [T('flight'), T('eye')],
    cmdWait: 3000,
    pitch: 0.4,
    dist: 26,
    hud: true,
    wait: 100,
  },
  {
    id: 'jefe3_fuego_en_picado',
    at: [0, 190],
    stage: [KORZUL, 18, PI],
    cmds: [T('flight'), T('plunge')],
    cmdWait: 1800,
    pitch: 0.7,
    dist: 44,
    hud: true,
    wait: 60,
  },
  {
    id: 'jefe3_cria',
    at: [0, 190],
    stage: [KORZUL, 18, PI],
    cmds: [T('break1'), T('break3'), T('flight'), T('brood')],
    cmdWait: 1600,
    pitch: 0.6,
    dist: 40,
    hud: true,
    wait: 100,
  },
  {
    id: 'jefe3_descenso',
    at: [0, 190],
    stage: [KORZUL, 18, PI],
    cmds: [T('flight'), T('descent')],
    cmdWait: 1800,
    pitch: 0.6,
    dist: 44,
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
      charName: 'Sealbreaker',
      gameBootTimeoutMs: 180000,
      selectorTimeoutMs: 90000,
      settleMs: 4000,
    });
    if (!booted) throw new Error('offline world did not boot');
    const enter = HEROIC ? '/dev sanctum enter heroic' : '/dev sanctum enter';
    for (const cmd of ['/dev level 20', '/dev god', enter]) {
      await page.evaluate((c) => window.__game.world.chat(c), cmd);
      await sleep(1300);
    }
    await sleep(12000);
    await page.evaluate(() => window.__game.world.chat('/dev sanctum tp landing'));
    await sleep(900);
    // The landing arrival is instance-local (0, -222): recover the slot origin.
    const origin = await page.evaluate(() => {
      const p = window.__game.world.player;
      return { x: p.pos.x, z: p.pos.z + 222 };
    });
    await page.evaluate(() => window.__game.world.chat('/dev sanctum gates'));
    await sleep(3000);
    for (const shot of SHOTS) {
      if (ONLY.length && !ONLY.some((o) => shot.id === o || shot.id.startsWith(o))) continue;
      await page.evaluate((hide) => {
        let tag = document.getElementById('shot-hide-ui');
        if (!tag) {
          tag = document.createElement('style');
          tag.id = 'shot-hide-ui';
          document.head.appendChild(tag);
        }
        tag.textContent = hide ? '#ui, #nameplates { display: none !important; }' : '';
      }, !shot.hud);
      // Strays from an earlier shot drop their fight (each boss resets; the
      // Seal Shackles are Korgath's parts and follow his fight).
      await page.evaluate(() => {
        const sim = window.__game.world;
        for (const e of [...sim.entities.values()]) {
          if (e.kind !== 'mob' || e.dead || e.templateId.startsWith('sanctum_shackle_')) continue;
          if (e.inCombat) {
            e.inCombat = false;
            e.aggroTargetId = null;
            e.aiState = 'evade';
          }
        }
        sim.player.devNoAggro = true;
      });
      await sleep(900);
      await page.evaluate(
        (c) => window.__game.world.chat(c),
        `/dev tp ${origin.x + shot.at[0]} ${origin.z + shot.at[1]}`,
      );
      await sleep(1500);
      if (shot.stage) {
        const spot = await page.evaluate(pageStage, shot.stage);
        console.log('STAGE', shot.id, JSON.stringify(spot));
        if (spot) {
          await page.evaluate((c) => window.__game.world.chat(c), `/dev tp ${spot.x} ${spot.z}`);
          shot.face = spot.face;
        }
        await sleep(1400);
      }
      let cmdAt = Date.now();
      for (const c of shot.cmds ?? []) {
        await page.evaluate(() => {
          window.__game.world.player.devNoAggro = false;
        });
        await page.evaluate((cmd) => window.__game.world.chat(cmd), c);
        cmdAt = Date.now();
        await sleep(shot.cmdWait ?? 1300);
      }
      if (shot.waitCast) {
        const t0 = Date.now();
        while (Date.now() - t0 < 20000) {
          if (await page.evaluate(pageCasting, shot.waitCast)) break;
          await sleep(80);
        }
      }
      await page.evaluate((s) => {
        const p = window.__game.world.player;
        p.facing = s.face ?? 0;
        p.prevFacing = s.face ?? 0;
        const input = window.__game.input;
        input.camYaw = (s.face ?? 0) + (s.yaw ?? 0);
        input.camPitch = s.pitch;
        input.camDist = s.dist;
      }, shot);
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
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
