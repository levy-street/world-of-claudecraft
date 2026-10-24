// Evidence shots for the Sunken Bastion's third pass, next to the player for
// scale: boots an offline world on an already-running dev server, enters the
// Bastion, clears it, then on the Cistern Yard paving either
//   solo <type ...>   frames each creature beside the player (idle),
//   lineup            stands the drowned garrison in a row beside the player,
//   burst <type>      lets one creature engage and takes a timed series of
//                     shots (the arbalest's aim, loose and bolts in flight).
// Evidence tooling, not a repo test.
//
//   node scripts/sunken_bastion_pass3_shot.mjs <outDir> solo arbalest turnkey
//   node scripts/sunken_bastion_pass3_shot.mjs <outDir> lineup
//   node scripts/sunken_bastion_pass3_shot.mjs <outDir> burst arbalest
//
// Env: SHOT_URL (http://127.0.0.1:5199/), SHOT_PRESET (4), SHOT_W / SHOT_H
// (1600x900), SHOT_PREFIX (default "pasada3_"), SHOT_YAW / SHOT_DIST /
// SHOT_PITCH (the chase camera), BURST_N / BURST_MS / BURST_DZ / BURST_HPFRAC
// (the series, the creature's distance and a health share to drop it to).
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5199/';
const OUT = process.argv[2] ?? path.join('tmp', 'sunken_bastion_pass3');
const MODE = process.argv[3] ?? 'solo';
const ARGS = process.argv.slice(4);
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const PREFIX = process.env.SHOT_PREFIX ?? 'pasada3_';
const LINEUP = ['prisoner', 'revenant', 'watchman', 'arbalest', 'sergeant', 'turnkey'];
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function camera(page, yaw, dist, pitch) {
  await page.evaluate(
    ([y, d, p]) => {
      const input = window.__game.input;
      input.camYaw = y;
      input.camPitch = p;
      input.camDist = d;
    },
    [yaw, dist, pitch],
  );
}

/** Every mob (and corpse) sent far away. */
async function clearStage(page) {
  await page.evaluate(() => {
    window.__hold?.clear();
    for (const e of window.__game.world.entities.values()) {
      if (e.kind !== 'mob') continue;
      e.pos.x += 400;
      e.prevPos = { ...e.pos };
      e.hp = 0;
    }
  });
  await sleep(600);
}

/** Raise one creature and hold it at (dx, dz) from the player, idle and
 *  turned `facing` radians off the player (or engaged when `pull`). */
async function raise(page, type, dx, dz, facing, pull, absolute = false) {
  await page.evaluate((t) => window.__game.world.chat(`/dev bastion spawn ${t}`), type);
  await sleep(400);
  return page.evaluate(
    ([dx, dz, facing, pull, seen, absolute]) => {
      const sim = window.__game.world;
      const me = sim.player;
      let mob = null;
      for (const e of sim.entities.values()) {
        if (e.kind === 'mob' && !e.dead && e.hp > 0 && !seen.includes(e.id)) mob = e;
      }
      if (!mob) return -1;
      mob.pos.x = me.pos.x + dx;
      mob.pos.z = me.pos.z + dz;
      mob.prevPos = { ...mob.pos };
      if (!pull) {
        mob.aggroTargetId = null;
        mob.threat?.clear?.();
        mob.aiState = 'idle';
        me.devNoAggro = true;
      }
      mob.facing = facing;
      mob.prevFacing = facing;
      if (!pull) {
        // Hold it turned `facing` off the player every frame (the idle AI
        // would turn it back to its post).
        window.__hold = window.__hold ?? new Map();
        window.__hold.set(mob.id, { off: facing, absolute, x: mob.pos.x, z: mob.pos.z });
        if (!window.__holdTimer)
          window.__holdTimer = setInterval(() => {
            const w = window.__game.world;
            const p = w.player;
            for (const [id, h] of window.__hold) {
              const e = w.entities.get(id);
              if (!e) continue;
              e.facing = h.absolute
                ? h.off
                : Math.atan2(p.pos.x - e.pos.x, p.pos.z - e.pos.z) + h.off;
              e.prevFacing = e.facing;
              e.pos.x = h.x;
              e.pos.z = h.z;
              e.prevPos = { ...e.pos };
            }
          }, 30);
      }
      return mob.id;
    },
    [dx, dz, facing, pull, globalThis.__seen ?? [], absolute],
  );
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: [
      `--window-size=${W},${H}`,
      '--use-angle=d3d11',
      '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization',
    ],
    defaultViewport: { width: W, height: H },
    protocolTimeout: 240000,
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
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
      charName: 'Tidewalker',
      gameBootTimeoutMs: 180000,
      selectorTimeoutMs: 90000,
      settleMs: 4000,
    });
    if (!booted) throw new Error('offline world did not boot');
    for (const cmd of [
      '/dev level 20',
      '/dev god',
      '/dev bastion enter',
      '/dev bastion gates',
      '/dev bastion kill all',
      '/dev bastion tp cisternyard',
    ]) {
      await page.evaluate((c) => window.__game.world.chat(c), cmd);
      await sleep(1300);
    }
    await page.waitForFunction(
      () => {
        let found = false;
        window.__game.renderer.scene.traverse((o) => {
          if (o.name === 'sunkenBastionField') found = true;
        });
        return found;
      },
      { timeout: 180000, polling: 1000 },
    );
    await sleep(5000);
    await page.addStyleTag({ content: '#ui, #nameplates { display: none !important; }' });
    await page.evaluate(() => {
      const p = window.__game.world.player;
      p.facing = 0;
      p.prevFacing = 0;
    });
    const yaw = Number(process.env.SHOT_YAW ?? 0.55);
    const pitch = Number(process.env.SHOT_PITCH ?? 0.2);
    if (MODE === 'solo') {
      for (const type of ARGS) {
        await clearStage(page);
        await raise(page, type, 1.8, 8, 0.45, false);
        await camera(page, yaw, Number(process.env.SHOT_DIST ?? 14), pitch);
        await sleep(2600);
        const file = path.join(OUT, `${PREFIX}${type}.png`);
        await page.screenshot({ path: file });
        console.log('SHOT', file);
      }
    } else if (MODE === 'lineup') {
      await clearStage(page);
      // The garrison in one row with the player in the middle of it, all
      // facing the camera, which looks back at the row from in front.
      const ids = [];
      const slots = [-15, -10, -5, 5, 10.5, 16.5];
      for (let i = 0; i < LINEUP.length; i++) {
        globalThis.__seen = ids;
        const id = await raise(page, LINEUP[i], -slots[i], 0, 0, false, true);
        ids.push(id);
      }
      await camera(
        page,
        Number(process.env.SHOT_YAW ?? Math.PI),
        Number(process.env.SHOT_DIST ?? 30),
        Number(process.env.SHOT_PITCH ?? 0.1),
      );
      await sleep(3200);
      const file = path.join(OUT, `${PREFIX}lineup.png`);
      await page.screenshot({ path: file });
      console.log('SHOT', file);
    } else if (MODE === 'burst') {
      const type = ARGS[0] ?? 'arbalest';
      await clearStage(page);
      await page.evaluate(() => {
        window.__game.world.player.devNoAggro = false;
      });
      await raise(page, type, 2.5, Number(process.env.BURST_DZ ?? 14), Math.PI, true);
      // BURST_HPFRAC drops it to that share of its health (the Turnkey opens
      // the cells at half).
      const frac = Number(process.env.BURST_HPFRAC ?? 0);
      if (frac > 0) {
        await sleep(Number(process.env.BURST_HPDELAY ?? 1500));
        await page.evaluate((f) => {
          for (const e of window.__game.world.entities.values())
            if (e.kind === 'mob' && !e.dead && e.hp > 0) e.hp = Math.round(e.maxHp * f);
        }, frac);
      }
      await camera(page, yaw, Number(process.env.SHOT_DIST ?? 14), pitch);
      const n = Number(process.env.BURST_N ?? 40);
      const every = Number(process.env.BURST_MS ?? 160);
      for (let i = 0; i < n; i++) {
        const file = path.join(OUT, `${PREFIX}${type}_burst_${String(i).padStart(3, '0')}.png`);
        await page.screenshot({ path: file });
        const cast = await page.evaluate(() => {
          for (const e of window.__game.world.entities.values())
            if (e.kind === 'mob' && !e.dead && e.hp > 0) return e.castingAbility ?? '';
          return '';
        });
        console.log('SHOT', file, cast);
        await sleep(every);
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
