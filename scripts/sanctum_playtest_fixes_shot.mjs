// Evidence shots for the Gravewyrm Sanctum playtest fixes, in a live offline
// world: the Sledge Tusker on its road at the entrance, the meltwater quench
// pools on the upper bend, the Ogre Sledge-Hauler's Ice Slab and its cover
// hint, Korgath's shout down at the wings, his Maul Arc's floor shape, and
// Korzul waking without rushing anyone. Run once on the old build and once on
// the fix for a before/after pair (SHOT_PREFIX names them). Evidence tooling,
// not a repo test. A shot id or an id prefix after the out dir filters the run.
//
//   node scripts/sanctum_playtest_fixes_shot.mjs [outDir] [shotId ...]
//
// Env: SHOT_URL (http://127.0.0.1:5258/), SHOT_PRESET (4), SHOT_W / SHOT_H
// (1600x900), SHOT_GPU=0 to force SwiftShader, SHOT_PREFIX (default "fix_").
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5258/';
const OUT = process.argv[2] ?? path.join('tmp', 'sanctum_fixes');
const ONLY = process.argv.slice(3);
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const PREFIX = process.env.SHOT_PREFIX ?? 'fix_';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PI = Math.PI;

const KORGATH = 'korgath_the_bound';
const KORZUL = 'korzul_the_gravewyrm';
const TUSKER = 'sledge_tusker';

/** In-page: the instance-local position of the first living mob of a template. */
function pageMobAt([templateId, ox, oz]) {
  const sim = window.__game.world;
  for (const e of sim.entities.values())
    if (e.kind === 'mob' && !e.dead && e.templateId === templateId)
      return {
        x: e.pos.x - ox,
        z: e.pos.z - oz,
        f: e.facing,
        state: e.aiState,
        combat: e.inCombat,
        target: e.aggroTargetId,
        cast: e.castingAbility,
      };
  return null;
}

async function shot(page, name) {
  const file = path.join(OUT, `${PREFIX}${name}.png`);
  await page.screenshot({ path: file });
  console.log('SHOT', file);
}

async function camera(page, face, pitch, dist, yaw = 0) {
  await page.evaluate(
    (s) => {
      const p = window.__game.world.player;
      p.facing = s.face;
      p.prevFacing = s.face;
      const input = window.__game.input;
      input.camYaw = s.face + s.yaw;
      input.camPitch = s.pitch;
      input.camDist = s.dist;
    },
    { face, pitch, dist, yaw },
  );
}

async function hud(page, show) {
  await page.evaluate((on) => {
    let tag = document.getElementById('shot-hide-ui');
    if (!tag) {
      tag = document.createElement('style');
      tag.id = 'shot-hide-ui';
      document.head.appendChild(tag);
    }
    tag.textContent = on ? '' : '#ui, #nameplates { display: none !important; }';
  }, show);
}

const chat = (page, c) => page.evaluate((cmd) => window.__game.world.chat(cmd), c);

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
  const want = (id) => !ONLY.length || ONLY.some((o) => id === o || id.startsWith(o));
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
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
    for (const cmd of ['/dev level 20', '/dev god', '/dev noaggro', '/dev sanctum enter']) {
      await chat(page, cmd);
      await sleep(1300);
    }
    await sleep(9000);
    await chat(page, '/dev sanctum tp landing');
    await sleep(900);
    const origin = await page.evaluate(() => {
      const p = window.__game.world.player;
      return { x: p.pos.x, z: p.pos.z + 222 };
    });
    const tp = (x, z) => chat(page, `/dev tp ${origin.x + x} ${origin.z + z}`);
    const mob = (id) => page.evaluate(pageMobAt, [id, origin.x, origin.z]);

    // 1. The Sledge Tusker on its road: three looks over its shoulder, from
    // 18 yd behind it on the ground it has just walked (outside its aggro
    // radius: under /dev noaggro a player inside it holds an idle mob still).
    if (want('tusker')) {
      await hud(page, false);
      for (const [i, wait] of [
        [1, 1500],
        [2, 5000],
        [3, 5000],
      ]) {
        await sleep(wait);
        const t = await mob(TUSKER);
        console.log('TUSKER', i, JSON.stringify(t));
        if (!t) continue;
        await tp(t.x - Math.sin(t.f) * 18, t.z - Math.cos(t.f) * 18);
        await sleep(500);
        await camera(page, t.f, 0.8, 30);
        await sleep(600);
        await shot(page, `tusker_${i}`);
      }
    }

    // 2. The quench pools on the upper bend, at a grazing look.
    if (want('quench')) {
      await hud(page, false);
      await chat(page, '/dev sanctum kill g2');
      await sleep(800);
      // On the upper bend's pad, the pool at (-37, -136) a few strides away.
      await tp(-29, -142);
      await sleep(1800);
      await camera(page, -0.95, 0.22, 12);
      await sleep(1200);
      await shot(page, 'quench_1');
      await camera(page, -0.6, 0.1, 16);
      await sleep(400);
      await shot(page, 'quench_2');
    }

    // 4. Korgath shouts down as the wing packs fall (the fork, in earshot).
    if (want('bark')) {
      await hud(page, true);
      await tp(0, -74);
      await sleep(1500);
      await chat(page, '/dev sanctum kill g4');
      await sleep(2500);
      await camera(page, 0, 0.35, 30);
      await sleep(600);
      await shot(page, 'korgath_bark_1');
      await chat(page, '/dev sanctum kill g6');
      await sleep(2500);
      await shot(page, 'korgath_bark_2');
    }

    // 5. Korgath's Maul Arc: the floor shape and his body reach.
    if (want('maul')) {
      await hud(page, true);
      await chat(page, '/dev sanctum gates');
      await sleep(800);
      await tp(0, -36);
      await sleep(1500);
      const spot = await page.evaluate((templateId) => {
        const sim = window.__game.world;
        const me = sim.player;
        me.devNoAggro = false;
        for (const e of sim.entities.values()) {
          if (e.kind !== 'mob' || e.dead || e.templateId !== templateId) continue;
          e.maxHp = Math.max(e.maxHp, 1e6);
          e.hp = e.maxHp;
          sim.aggroMob(e, me, false);
          return { x: e.pos.x, z: e.pos.z - 5 };
        }
        return null;
      }, KORGATH);
      if (spot) await chat(page, `/dev tp ${spot.x} ${spot.z}`);
      await sleep(1500);
      await chat(page, '/dev sanctum trigger break hammer');
      await sleep(600);
      await chat(page, '/dev sanctum trigger maul');
      await sleep(500);
      await camera(page, 0, 0.75, 34);
      await sleep(300);
      await shot(page, 'korgath_maul');
    }

    // 6. Korzul: a player walks out on the plates and wakes him.
    if (want('korzul')) {
      await hud(page, true);
      await chat(page, '/dev sanctum kill trash');
      await chat(page, '/dev sanctum kill korgath');
      await chat(page, '/dev sanctum kill velkhar');
      await chat(page, '/dev sanctum gates');
      await sleep(800);
      await page.evaluate(() => {
        window.__game.world.player.devNoAggro = false;
      });
      // Into the wake ring's edge (30 yd from the centre, 192): 28 yd out.
      await tp(0, 164);
      const t0 = Date.now();
      for (const at of [1500, 6000, 11000, 16000]) {
        await sleep(Math.max(0, t0 + at - Date.now()));
        const z = await mob(KORZUL);
        console.log('KORZUL', at, JSON.stringify(z));
        await camera(page, 0, 0.42, 34);
        await sleep(200);
        await shot(page, `korzul_${at}`);
      }
    }

    // 7. The Ogre's Ice Slab (last: it spawns a pulled ogre) and its cover hint.
    if (want('slab')) {
      await hud(page, true);
      await tp(0, 42);
      await sleep(1500);
      await page.evaluate(() => {
        window.__game.world.player.devNoAggro = false;
      });
      await chat(page, '/dev sanctum spawn ogre');
      // Wait for the thrown block to land (its wall object appears).
      const t0 = Date.now();
      let landed = false;
      while (!landed && Date.now() - t0 < 40000) {
        landed = await page.evaluate(() => {
          for (const e of window.__game.world.entities.values())
            if (e.templateId === 'sanctum_ice_slab') return true;
          return false;
        });
        if (!landed) await sleep(100);
      }
      console.log('SLAB LANDED', landed, Date.now() - t0);
      await sleep(700);
      await camera(page, PI, 0.45, 22, 0.6);
      await sleep(500);
      console.log(
        'SLAB',
        await page.evaluate(() => {
          const sim = window.__game.world;
          const me = sim.player;
          const out = [];
          for (const e of sim.entities.values())
            if (e.templateId === 'sanctum_ice_slab')
              out.push(Math.hypot(e.pos.x - me.pos.x, e.pos.z - me.pos.z).toFixed(1));
          const el = document.getElementById('sanctum-alert');
          return JSON.stringify({
            slabs: out,
            alert: el ? getComputedStyle(el).display : 'none-el',
            text: el?.textContent,
          });
        }),
      );
      await shot(page, 'slab_hint');
      await chat(page, '/dev sanctum kill trash');
      await sleep(400);
      await camera(page, PI, 0.3, 12, 0.6);
      await sleep(700);
      await shot(page, 'slab_body');
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
