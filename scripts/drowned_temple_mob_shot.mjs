// Evidence shots of one Drowned Temple creature in a live offline world, from
// the normal MMO camera: its pack where the temple places it (optional), one
// raised and held idle, gliding in, its swings and casts while it fights a
// tanked player, its frenzy (if it has one) and its death. Evidence tooling,
// not a repo test.
//
//   MOB=<templateId> SPAWN=<'/dev temple spawn' name>
//     node scripts/drowned_temple_mob_shot.mjs [outDir] [shotId ...]
//
// PACK="x,z,face,yaw,pitch,dist" (instance-local) adds the pack shots;
// MOVE_WAIT (ms, default 250) is how long after the spawn the se_mueve shot
// is taken (raise it to catch a rusher on arrival, a Tidewisp bursting);
// LOW_WAIT (ms, default 300) how long after the drop to 25 percent the frenesi
// shot is taken (raise it for a slower low-health stance, a shell closing).
// CAST_WAIT (ms, default 6000) is how long the fight runs before the
// habilidad shots (raise it for a mob with a long cast cooldown).
// CASTS="castId:shotId:ms,..." adds one shot per entry, taken `ms` after that
// cast's bar opens (a windup, the strike on the bar's end, a play-out). A
// fourth field names an ally to raise beside it, hurt below half health (a
// heal such as Pale Mending only opens on a wounded packmate).
// Env: SHOT_URL (http://127.0.0.1:5242/), BROWSER_PATH, SHOT_PRESET (4),
// SHOT_W / SHOT_H (1600x900), SHOT_GPU=0 to force SwiftShader, SHOT_PREFIX,
// SHOT_DIST (a multiplier on every camera distance, for close-ups),
// SHOT_DEBUG=1 to log the nova spellfx cues the renderer received per shot.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5242/';
const OUT = process.argv[2] ?? path.join('tmp', 'drowned_temple_pilgrim');
const ONLY = process.argv.slice(3);
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const PREFIX = process.env.SHOT_PREFIX ?? '';
const DIST = Number(process.env.SHOT_DIST ?? 1);
const MOB = process.env.MOB ?? 'drowned_pilgrim';
const SPAWN = process.env.SPAWN ?? 'pilgrim';
const CAST_WAIT = Number(process.env.CAST_WAIT ?? 6000);
const MOVE_WAIT = Number(process.env.MOVE_WAIT ?? 250);
const LOW_WAIT = Number(process.env.LOW_WAIT ?? 300);
const PACK = process.env.PACK?.split(',').map(Number);
const CASTS = (process.env.CASTS ?? '')
  .split(',')
  .filter(Boolean)
  .map((c) => c.split(':'));
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// at: instance-local spot the player stands on; face: sim radians (0 = +z).
// spawn: raise one pilgrim 10 yd ahead (it is pulled onto the player).
// js: calm (hold it idle), tank (huge health, fights on), low (drop it to
// 25 percent: its frenzy fires), kill.
const SHOTS = [
  ...(PACK
    ? [
        {
          id: 'grupo',
          at: [PACK[0], PACK[1]],
          face: PACK[2],
          yaw: PACK[3],
          pitch: PACK[4],
          dist: PACK[5],
          noAggro: true,
        },
        {
          id: 'grupo_cerca',
          at: [PACK[0], PACK[1]],
          face: PACK[2],
          yaw: PACK[3],
          pitch: 0.28,
          dist: PACK[5] * 0.65,
          noAggro: true,
        },
      ]
    : []),
  {
    id: 'reposo',
    at: [0, -12],
    face: 0,
    pitch: 0.3,
    dist: 12,
    spawn: true,
    js: 'calm',
    wait: 2500,
  },
  {
    id: 'se_mueve',
    at: [0, -12],
    face: 0,
    yaw: 0.9,
    pitch: 0.32,
    dist: 13,
    spawn: true,
    spawnWait: MOVE_WAIT,
    wait: 450,
  },
  {
    id: 'ataque',
    at: [0, -12],
    face: 0,
    yaw: 1.0,
    pitch: 0.3,
    dist: 12,
    spawn: true,
    js: 'tank',
    stepWait: 3000,
    wait: 900,
  },
  {
    id: 'ataque_2',
    at: [0, -12],
    face: 0,
    yaw: 1.0,
    pitch: 0.3,
    dist: 12,
    spawn: true,
    js: 'tank',
    stepWait: 5200,
    wait: 900,
  },
  {
    id: 'habilidad',
    at: [0, -12],
    face: 0,
    yaw: 0.6,
    pitch: 0.34,
    dist: 14,
    spawn: true,
    js: 'cast',
    stepWait: 300,
    wait: 300,
  },
  ...CASTS.map(([castId, id, ms, ally]) => ({
    id,
    at: [0, -12],
    face: 0,
    yaw: 0.6,
    pitch: 0.3,
    dist: 13,
    spawn: true,
    js: 'cast',
    castId,
    ally,
    stepWait: Number(ms),
    wait: 40,
  })),
  {
    id: 'frenesi',
    at: [0, -12],
    face: 0,
    yaw: 1.0,
    pitch: 0.3,
    dist: 12,
    spawn: true,
    js: 'low',
    stepWait: LOW_WAIT,
    wait: 300,
  },
  {
    id: 'muerte',
    at: [0, -12],
    face: 0,
    yaw: 1.0,
    pitch: 0.3,
    dist: 12,
    spawn: true,
    js: 'kill',
    stepWait: 900,
    wait: 400,
  },
  {
    id: 'muerte_final',
    at: [0, -12],
    face: 0,
    yaw: 1.0,
    pitch: 0.3,
    dist: 12,
    spawn: true,
    js: 'kill',
    stepWait: 2600,
    wait: 900,
  },
];

function pageStep([verb, mob, castWait, castId]) {
  const sim = window.__game.world;
  const me = sim.player;
  let best = null;
  let bestD = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead || e.templateId !== mob) continue;
    const d = Math.hypot(e.pos.x - me.pos.x, e.pos.z - me.pos.z);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  if (!best) return 'none';
  me.hp = me.maxHp;
  if (verb === 'kill') {
    sim.ctx.handleDeath(best, me);
    return best.id;
  }
  if (verb === 'calm') {
    best.inCombat = false;
    best.aggroTargetId = null;
    best.aiState = 'idle';
    me.devNoAggro = true;
    return best.id;
  }
  if (verb === 'low') {
    best.maxHp = Math.max(best.maxHp, 1e6);
    best.hp = Math.floor(best.maxHp * 0.25);
    return best.id;
  }
  best.maxHp = Math.max(best.maxHp, 1e6);
  best.hp = best.maxHp;
  if (verb === 'cast') {
    // Let it fight until it opens a cast bar (or the wait runs out).
    return new Promise((resolve) => {
      const t0 = performance.now();
      const tick = () => {
        if (best.castingAbility && (!castId || best.castingAbility === castId))
          resolve(`${best.id} casting ${best.castingAbility}`);
        else if (performance.now() - t0 > castWait) resolve(`${best.id} no cast`);
        else setTimeout(tick, 50);
      };
      tick();
    });
  }
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
    for (const cmd of ['/dev level 20', '/dev temple enter', '/dev temple gates']) {
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
    await page.addStyleTag({ content: '#ui, #nameplates { display: none !important; }' });
    await page.evaluate(() => window.__game.world.chat('/dev temple tp landing'));
    await sleep(900);
    const origin = await page.evaluate(() => {
      const p = window.__game.world.player;
      return { x: p.pos.x, z: p.pos.z + 230 };
    });
    for (const shot of SHOTS) {
      if (ONLY.length && !ONLY.includes(shot.id)) continue;
      await sleep(1200);
      const [lx, lz] = shot.at;
      await page.evaluate((noAggro) => {
        window.__game.world.player.devNoAggro = noAggro;
      }, !!shot.noAggro);
      await page.evaluate(
        (c) => window.__game.world.chat(c),
        `/dev tp ${origin.x + lx} ${origin.z + lz}`,
      );
      await sleep(700);
      // Every spawned pilgrim from an earlier shot dies first.
      if (shot.spawn) {
        await page.evaluate(() => {
          const sim = window.__game.world;
          const me = sim.player;
          for (const e of [...sim.entities.values()]) {
            if (e.kind !== 'mob' || e.dead) continue;
            if (Math.hypot(e.pos.x - me.pos.x, e.pos.z - me.pos.z) < 40) sim.ctx.handleDeath(e, me);
          }
          // and their corpses leave the frame
          for (const e of sim.entities.values())
            if (
              e.kind === 'mob' &&
              e.dead &&
              Math.hypot(e.pos.x - me.pos.x, e.pos.z - me.pos.z) < 40
            )
              e.pos.x += 400;
        });
        await sleep(1500);
      }
      await page.evaluate((s) => {
        const p = window.__game.world.player;
        p.facing = s.face;
        p.prevFacing = s.face;
      }, shot);
      if (shot.spawn) {
        await page.evaluate((n) => window.__game.world.chat(`/dev temple spawn ${n}`), SPAWN);
        await sleep(shot.spawnWait ?? 1200);
        if (shot.js !== 'kill') await page.evaluate(pageStep, ['tank', MOB, 0]);
        if (shot.ally) {
          await page.evaluate((n) => window.__game.world.chat(`/dev temple spawn ${n}`), shot.ally);
          await sleep(900);
          await page.evaluate((mob) => {
            const sim = window.__game.world;
            const me = sim.player;
            for (const e of sim.entities.values()) {
              if (e.kind !== 'mob' || e.dead || e.templateId === mob) continue;
              if (Math.hypot(e.pos.x - me.pos.x, e.pos.z - me.pos.z) > 30) continue;
              e.maxHp = Math.max(e.maxHp, 1e6);
              e.hp = Math.floor(e.maxHp * 0.4);
            }
          }, MOB);
        }
      }
      if (process.env.SHOT_DEBUG && !globalThis.__hooked) {
        globalThis.__hooked = true;
        await page.evaluate(() => {
          const r = window.__game.renderer;
          const orig = r.handleEvent.bind(r);
          window.__evlog = [];
          r.handleEvent = (ev) => {
            if (ev.type === 'spellfx' && ev.fx === 'nova') window.__evlog.push(JSON.stringify(ev));
            return orig(ev);
          };
        });
      }
      if (shot.js) {
        console.log(
          'STEP',
          shot.id,
          await page.evaluate(pageStep, [shot.js, MOB, CAST_WAIT, shot.castId ?? null]),
        );
        await sleep(shot.stepWait ?? 900);
      }
      await page.evaluate(
        (s) => {
          const input = window.__game.input;
          input.camYaw = s.yaw ?? 0;
          input.camPitch = s.pitch;
          input.camDist = s.dist * s.mul;
        },
        { ...shot, mul: DIST },
      );
      await sleep(shot.wait ?? 2800);
      const file = path.join(OUT, `${PREFIX}${shot.id}.png`);
      await page.screenshot({ path: file });
      console.log('SHOT', file);
      if (process.env.SHOT_DEBUG)
        console.log(
          'EVLOG',
          await page.evaluate(() => {
            const r = window.__game.renderer;
            const z = r.riftDeathZoneVisuals;
            return `${window.__evlog.join(' | ')} zone=${!!z} temple=${!!z?.templeFx} world=${!!z?.templeFx?.world} g=${!!z?.templeFx?.playGesture}`;
          }),
        );
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
