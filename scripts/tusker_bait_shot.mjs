// Evidence shots of the Sledge Tusker's bait rework in a live offline world
// (the ice outcrops on the Sledge Road, a Trample lane that ends in one, the
// tusks going in, Stuck in the Ice, the outcrop bursting, the soulfire trail a
// charge leaves, and the sledge tipping at half health). Evidence tooling, not
// a repo test: it stages each beat with the `/dev sanctum trigger ...`
// commands and by standing the bodies on the road. The L shots are the
// readability pass: the lane following its target (blue into the ice, red
// off it), the outcrops' floor circles, the target marker, the crash and a
// spent outcrop's dark circle.
//
//   node scripts/tusker_bait_shot.mjs [outDir] [shotId ...]
//
// Env: SHOT_URL (http://127.0.0.1:5184/), SHOT_PRESET (4; 1 is the low
// preset), SHOT_W / SHOT_H (1600x900), SHOT_GPU=0 to force SwiftShader,
// SHOT_PREFIX (default ""), SHOT_DIFFICULTY (normal).
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5184/';
const OUT = process.argv[2] ?? path.join('tmp', 'tusker_bait');
const ONLY = process.argv.slice(3);
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const PREFIX = process.env.SHOT_PREFIX ?? '';
const DIFFICULTY = process.env.SHOT_DIFFICULTY === 'heroic' ? 'heroic' : 'normal';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A spot on the Sledge Road's middle leg, instance-local: `s` yards down its
 *  centre line from its upper end, `side` yards toward the rim the fourth
 *  outcrop stands on (24 yd down the leg, 6 yd off the line). */
function leg(s, side = 0) {
  const d = Math.hypot(42, 21.8);
  const ux = 42 / d;
  const uz = 21.8 / d;
  return [-26 + ux * s + uz * side, -137.9 + uz * s - ux * side];
}

// Each shot: `tusker` and `player` where they stand (instance-local), `look`
// the spot the camera faces from behind the player, the orbit (`pitch`,
// `dist`), `steps` the beats played in order (a dev trigger, a wait in ms, a
// health share to set, the player moved, or `fresh` to stand the outcrops up),
// then the frame.
const SHOTS = [
  {
    // The road before the pull: the outcrops on its rim, the beast hauling.
    id: '1_salientes',
    tusker: leg(30),
    player: leg(-2, -2),
    look: leg(24, 2),
    pitch: 0.3,
    dist: 13,
    pull: false,
    steps: [{ wait: 1500 }],
  },
  {
    // A Trample aimed into the fourth outcrop: the lane ends in the ice, the
    // outcrop burns warm inside its gold ring.
    id: '2_carril_al_hielo',
    tusker: leg(8),
    player: leg(15, -6),
    look: leg(17, 4),
    pitch: 0.52,
    dist: 20,
    steps: [{ trigger: 'bait' }, { wait: 1350 }],
  },
  {
    // The tusks going in.
    id: '3_colmillos_clavados',
    tusker: leg(8),
    player: leg(20, -2.5),
    look: leg(22.5, 6),
    pitch: 0.3,
    dist: 12,
    steps: [{ trigger: 'bait' }, { until: 'stuck' }, { wait: 240 }],
  },
  {
    // Stuck in the Ice, two seconds in: the cracks, the gold window, the alert.
    id: '4_atascado',
    tusker: leg(8),
    player: leg(18, -5),
    look: leg(21, 5),
    pitch: 0.36,
    dist: 13,
    steps: [{ trigger: 'bait' }, { until: 'stuck' }, { wait: 2000 }],
  },
  {
    // It wrenches free: the outcrop bursts.
    id: '5_estallido',
    tusker: leg(8),
    player: leg(20, -2.5),
    look: leg(22.5, 6),
    pitch: 0.3,
    dist: 13,
    steps: [{ trigger: 'bait' }, { until: 'stuck' }, { until: 'free' }, { wait: 330 }],
  },
  {
    // A plain 30 yd charge: the lane it ran burns.
    id: '6_rastro',
    tusker: leg(4),
    player: leg(40),
    look: leg(18, 0),
    pitch: 0.5,
    dist: 24,
    steps: [
      { trigger: 'trample' },
      { until: 'trail' },
      { wait: 500 },
      { move: leg(19, -6.3), look: leg(19, 3) },
      { wait: 1900 },
    ],
  },
  {
    // Half health: the traces snap and the sledge tips beside the trail.
    id: '7_volcado',
    tusker: leg(4),
    player: leg(40),
    look: leg(24, 0),
    pitch: 0.46,
    dist: 20,
    steps: [
      { trigger: 'trample' },
      { until: 'trail' },
      { wait: 1400 },
      { move: leg(27, -6.3), look: leg(27, 3) },
      { hp: 0.49 },
      { wait: 1700 },
    ],
  },
  // ---- the readability pass (round 2): run these with the ids L1 to L5 ----
  {
    // A Trample following the player who stands behind the fourth outcrop:
    // the lane reads ice blue and ends in a shard burst, every intact outcrop
    // glows on its circle (the fourth hardest), the marker floats over the
    // player; the third outcrop is spent first, its circle dark and broken.
    id: 'L1_carril_azul',
    tusker: leg(8),
    player: leg(27.5, 4.5),
    look: leg(8, 0),
    pitch: 0.95,
    dist: 30,
    steps: [
      { place: leg(8) },
      { trigger: 'burst' },
      { place: leg(8) },
      { trigger: 'trample' },
      { wait: 1100 },
    ],
  },
  {
    // The same Trample on a player out on open road: red, a plain arrow.
    id: 'L2_carril_rojo',
    tusker: leg(8),
    player: leg(27.5, -5),
    look: leg(8, 0),
    pitch: 0.62,
    dist: 24,
    steps: [{ trigger: 'trample' }, { wait: 1100 }],
  },
  {
    // The lock, close up: the marker's two side arrows (step aside).
    id: 'L3_marcador',
    tusker: leg(8),
    player: leg(27.5, 4.5),
    look: leg(8, 0),
    pitch: 0.28,
    dist: 9,
    steps: [{ trigger: 'trample' }, { until: 'locked' }, { wait: 150 }],
  },
  {
    // Led into the ice: the crash.
    id: 'L4_choque',
    tusker: leg(8),
    player: leg(27.5, 4.5),
    look: leg(22.5, 6),
    pitch: 0.34,
    dist: 15,
    steps: [
      { trigger: 'trample' },
      { until: 'locked' },
      { move: leg(22, -5), look: leg(22.5, 6) },
      { until: 'stuck' },
      { wait: 220 },
    ],
  },
  {
    // A spent outcrop: its circle dark and broken among the lit ones.
    id: 'L5_roto',
    tusker: leg(20),
    player: leg(48, -2),
    look: leg(22, 2),
    pitch: 0.62,
    dist: 22,
    steps: [{ trigger: 'burst' }, { wait: 900 }],
  },
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
    protocolTimeout: 240000,
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && !m.text().includes('Vite server'))
        console.log('CONSOLE:', m.text().slice(0, 300));
    });
    // Other work in the same tree edits files while the shots run: a dead HMR
    // socket keeps the dev server's full reloads off the page.
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
      charName: 'Roadwalker',
      gameBootTimeoutMs: 180000,
      selectorTimeoutMs: 90000,
      settleMs: 4000,
    });
    if (!booted) throw new Error('offline world did not boot');
    const chat = (c) => page.evaluate((cmd) => window.__game.world.chat(cmd), c);
    for (const cmd of [
      '/dev level 20',
      '/dev god',
      `/dev sanctum enter ${DIFFICULTY}`,
      '/dev sanctum gates',
      '/dev sanctum kill g1',
      '/dev sanctum kill g2',
      '/dev sanctum kill g3',
      '/dev sanctum tp road',
    ]) {
      await chat(cmd);
      await sleep(1300);
    }
    await page.waitForFunction(
      () => {
        let found = false;
        window.__game.renderer.scene.traverse((o) => {
          if (o.name === 'gravewyrm-sanctum-fx') found = true;
        });
        return found;
      },
      { timeout: 180000, polling: 1000 },
    );
    await sleep(6000);
    // The first outcrop stands at instance-local (-12, -156.5): the slot origin.
    const origin = await page.evaluate(() => {
      const sim = window.__game.world;
      for (const e of sim.entities.values())
        if (e.templateId === 'sanctum_ice_outcrop') return { x: e.pos.x + 12, z: e.pos.z + 156.5 };
      return null;
    });
    if (!origin) throw new Error('no ice outcrop on the road');
    const place = (who, at, look) =>
      page.evaluate(
        ([w, x, z, lx, lz]) => {
          const sim = window.__game.world;
          let e = sim.player;
          if (w === 'tusker')
            for (const m of sim.entities.values())
              if (m.kind === 'mob' && !m.dead && m.templateId === 'sledge_tusker') e = m;
          const p = sim.groundPos(x, z);
          e.pos.x = p.x;
          e.pos.y = p.y;
          e.pos.z = p.z;
          e.prevPos = { ...e.pos };
          if (lx !== null) {
            e.facing = Math.atan2(lx - x, lz - z);
            e.prevFacing = e.facing;
          }
        },
        [
          who,
          origin.x + at[0],
          origin.z + at[1],
          look ? origin.x + look[0] : null,
          look ? origin.z + look[1] : null,
        ],
      );
    const camera = (shot, look) =>
      page.evaluate(
        ([lx, lz, pitch, dist]) => {
          const p = window.__game.world.player;
          const face = Math.atan2(lx - p.pos.x, lz - p.pos.z);
          p.facing = face;
          p.prevFacing = face;
          const input = window.__game.input;
          input.camYaw = face;
          input.camPitch = pitch;
          input.camDist = dist;
        },
        [origin.x + look[0], origin.z + look[1], shot.pitch, shot.dist],
      );
    const state = () =>
      page.evaluate(() => {
        const sim = window.__game.world;
        for (const e of sim.entities.values()) {
          if (e.kind !== 'mob' || e.templateId !== 'sledge_tusker') continue;
          const st = e.sanctumFight;
          const outcrops = [];
          for (const o of sim.entities.values())
            if (o.templateId?.startsWith('sanctum_ice_outcrop'))
              outcrops.push(o.templateId.slice(19) || 'whole');
          return {
            cast: e.castingAbility,
            hp: Math.round((e.hp / e.maxHp) * 100),
            auras: e.auras.map((a) => a.id).join(','),
            stuck: st?.stuck ? Number(st.stuck.left.toFixed(2)) : null,
            trails: st?.trails?.length ?? 0,
            patches: st?.patches?.length ?? 0,
            outcrops: outcrops.join(' '),
          };
        }
        return null;
      });
    for (const shot of SHOTS) {
      if (ONLY.length && !ONLY.some((o) => shot.id === o || shot.id.startsWith(o))) continue;
      await place('tusker', shot.tusker, shot.pull === false ? null : leg(24, 6));
      await place('player', shot.player, shot.look);
      if (shot.pull !== false) {
        // Pull it with a pool that lasts, hold its own clocks off the picture
        // and stand every outcrop up.
        await page.evaluate(() => {
          const sim = window.__game.world;
          const me = sim.player;
          for (const e of sim.entities.values()) {
            if (e.kind !== 'mob' || e.dead || e.templateId !== 'sledge_tusker') continue;
            e.maxHp = Math.max(e.maxHp, 1e6);
            e.hp = e.maxHp;
            e.dungeonPatrol = undefined;
            sim.aggroMob(e, me, false);
          }
        });
        await sleep(300);
        await page.evaluate(() => {
          const sim = window.__game.world;
          for (const e of sim.entities.values()) {
            const st = e.sanctumFight;
            if (st?.kind !== 'tusker') continue;
            st.sweepTimer = 999;
            st.trampleTimer = 999;
          }
        });
        await chat('/dev sanctum trigger outcrops');
        await sleep(400);
        await place('tusker', shot.tusker, leg(24, 6));
        await place('player', shot.player, shot.look);
      }
      await camera(shot, shot.look);
      await sleep(900);
      await camera(shot, shot.look);
      for (const step of shot.steps) {
        // Stand the beast back where the shot wants it (its chase walks it).
        if (step.place) await place('tusker', step.place, leg(24, 6));
        if (step.trigger) await chat(`/dev sanctum trigger ${step.trigger}`);
        if (step.until)
          await page.waitForFunction(
            (until) => {
              const sim = window.__game.world;
              for (const e of sim.entities.values()) {
                const st = e.sanctumFight;
                if (st?.kind !== 'tusker') continue;
                if (until === 'stuck') return st.stuck !== null;
                if (until === 'free') return st.stuck === null && st.baits > 0;
                if (until === 'trail') return st.trails.length > 0 && !st.charge;
                if (until === 'locked')
                  return (
                    e.castingAbility === 'sanctum_tusker_trample' && e.castRemaining <= 0.9 + 1e-9
                  );
              }
              return false;
            },
            { timeout: 30000, polling: 30 },
            step.until,
          );
        if (step.move) {
          await place('player', step.move, step.look);
          await camera(shot, step.look);
        }
        if (step.hp !== undefined)
          await page.evaluate((share) => {
            const sim = window.__game.world;
            for (const e of sim.entities.values())
              if (e.kind === 'mob' && !e.dead && e.templateId === 'sledge_tusker')
                e.hp = Math.floor(e.maxHp * share);
          }, step.hp);
        if (step.wait) await sleep(step.wait);
      }
      console.log('STATE', shot.id, JSON.stringify(await state()));
      const file = path.join(OUT, `${PREFIX}${shot.id}.png`);
      await page.screenshot({ path: file });
      console.log('SHOT', file);
      // Drop the fight before the next shot (an evade resets the road).
      await page.evaluate(() => {
        const sim = window.__game.world;
        for (const e of sim.entities.values()) {
          if (e.kind !== 'mob' || e.dead || !e.inCombat) continue;
          e.inCombat = false;
          e.aggroTargetId = null;
          e.aiState = 'evade';
          e.hp = e.maxHp;
        }
      });
      await sleep(2200);
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
