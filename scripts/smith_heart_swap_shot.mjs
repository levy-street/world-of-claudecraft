// Evidence captures for the Smith's Heart tank swaps (docs/design/raid/
// smith_heart.md 7.2 and 7.3; encounters/smith_heart/quench_temper.ts and
// breath_blow.ts): the Quench tank's Rime-Tempered alert and debuff at the
// swap count, Bellows Blow's wedge under the tank (the ruinous one, and the
// tank's alert), and a blow's throw mid-slide. The local player is the tank;
// a few dev-only stand-ins make the raid. Evidence tooling, not a repo test.
// Needs a dev Vite serving the worktree (ALLOW_DEV_COMMANDS is implied
// offline).
//
//   node scripts/smith_heart_swap_shot.mjs <outDir>
//
// Env: SHOT_URL (http://127.0.0.1:5197/), SHOT_W / SHOT_H (1600x900),
// SHOT_PRESET (4), SHOT_ONLY (comma list of shot names).
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5197/';
const OUT = process.argv[2] ?? path.join('tmp', 'smith_heart_swap');
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const ONLY = process.env.SHOT_ONLY ? new Set(process.env.SHOT_ONLY.split(',')) : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Where `/dev heart enter` sets us down (instance-local), the lake's middle,
 *  the Cornice's middle. */
const ENTRY = { x: -196, z: -210 };
const LAKE = { x: 198, z: -2 };
const CORNICE = { x: 0, z: 196 };

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
    charName: 'Swaptank',
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
  await page.waitForFunction(
    () => {
      let found = false;
      window.__game.renderer.scene.traverse((o) => {
        if (o.name === 'smithHeartField') found = true;
      });
      return found;
    },
    { timeout: 180000, polling: 1000 },
  );
  const O = await page.evaluate(
    ([ex, ez]) => {
      const p = window.__game.world.player;
      return { x: p.pos.x - ex, z: p.pos.z - ez };
    },
    [ENTRY.x, ENTRY.z],
  );
  await page.evaluate(() => {
    const w = window.__game.world;
    window.__raid = ['paladin', 'priest', 'mage', 'rogue'].map((c, i) => {
      const id = w.addPlayer(c, `Raider${i + 1}`);
      w.entities.get(id).devGod = true;
      return id;
    });
  });
  /** Me at local (x, z) facing (fx, fz), the camera held at `yaw` off my
   *  facing, `pitch`, `dist`. */
  const place = (at, look, yaw, pitch, dist) =>
    page.evaluate(
      ([ox, oz, x, z, fx, fz, yaw, pitch, dist]) => {
        const w = window.__game.world;
        const p = w.player;
        const g = w.ctx.groundPos(ox + x, oz + z);
        p.pos = { ...g };
        p.prevPos = { ...g };
        p.facing = Math.atan2(fx - x, fz - z);
        p.prevFacing = p.facing;
        w.ctx.rebucket(p);
        const input = window.__game.input;
        window.__shotHold = { yaw: p.facing + yaw, pitch, dist };
        if (!window.__shotHoldLoop) {
          window.__shotHoldLoop = true;
          const hold = () => {
            const h = window.__shotHold;
            if (h) {
              input.zoomMax = Math.max(input.zoomMax, h.dist);
              input.camYaw = h.yaw;
              input.camPitch = h.pitch;
              input.camDist = h.dist;
            }
            requestAnimationFrame(hold);
          };
          requestAnimationFrame(hold);
        }
      },
      [O.x, O.z, at[0], at[1], look[0], look[1], yaw, pitch, dist],
    );
  const raider = (i, x, z) =>
    page.evaluate(
      ([ox, oz, i, x, z]) => {
        const w = window.__game.world;
        const e = w.entities.get(window.__raid[i]);
        const g = w.ctx.groundPos(ox + x, oz + z);
        e.pos = { ...g };
        e.prevPos = { ...g };
        w.ctx.rebucket(e);
      },
      [O.x, O.z, i, x, z],
    );
  /** The guardian `tid` at local (x, z), its aggro on me. */
  const holdBoss = (tid, x, z) =>
    page.evaluate(
      ([ox, oz, tid, x, z]) => {
        const w = window.__game.world;
        for (const e of w.entities.values()) {
          if (e.templateId !== tid || e.dead) continue;
          const g = w.ctx.groundPos(ox + x, oz + z);
          e.pos = { ...g };
          e.prevPos = { ...g };
          w.ctx.rebucket(e);
          w.ctx.aggroMob(e, w.player, false);
          e.threat?.set?.(w.player.id, 1e9);
          e.aggroTargetId = w.player.id;
        }
      },
      [O.x, O.z, tid, x, z],
    );
  const shoot = async (name) => {
    const buf = await page.screenshot();
    fs.mkdirSync(OUT, { recursive: true });
    const file = path.join(OUT, `${name}.png`);
    fs.writeFileSync(file, buf);
    console.log('SHOT', file);
  };

  const scenes = {
    // The Quench tank at three stacks on Heroic: the alert over the cold
    // bar, the debuff with its count.
    async '01_templadora_aviso'() {
      await chat('/dev heart quench heroic', 300);
      await chat('/dev heart quench reset', 800);
      await chat('/dev heart quench pull', 1500);
      await place([LAKE.x, LAKE.z - 7], [LAKE.x, LAKE.z], 0.5, 0.35, 16);
      for (let i = 0; i < 4; i++) await raider(i, LAKE.x - 2 + i * 1.3, LAKE.z - 9);
      await holdBoss('heart_quench_guardian', LAKE.x, LAKE.z);
      await page.evaluate(() => {
        for (const e of window.__game.world.entities.values())
          if (e.smithHeartQuench) Object.assign(e.smithHeartQuench, { breathTimer: 999 });
      });
      await chat('/dev heart quench temper 3', 1600);
    },
    // Bellows Blow at four stacks on Heroic: the wedge runs off the Cornice
    // in the lethal tone, the tank's alert says so.
    async '02_aliento_cuna'() {
      await chat('/dev heart quench reset', 600);
      await chat('/dev heart breath heroic', 300);
      await chat('/dev heart breath reset', 800);
      await chat('/dev heart breath pull', 1200);
      await place([CORNICE.x + 20, CORNICE.z], [CORNICE.x + 14, CORNICE.z], 2.6, 0.75, 26);
      for (let i = 0; i < 4; i++) await raider(i, CORNICE.x - 4, CORNICE.z - 6 + i * 3);
      await holdBoss('heart_breath_guardian', CORNICE.x + 14, CORNICE.z);
      await page.evaluate(() => {
        for (const e of window.__game.world.entities.values())
          if (e.smithHeartBreath)
            Object.assign(e.smithHeartBreath, {
              inhaleTimer: 999,
              circleTimer: 999,
              heartTimer: 999,
              blowTimer: 999,
            });
      });
      await chat('/dev heart breath swap 4', 900);
    },
    // A blow's throw mid-slide (two stacks: 15 yd), its burst and its trail.
    async '03_aliento_empujon'() {
      await chat('/dev heart breath reset', 800);
      await chat('/dev heart breath pull', 1200);
      await place([CORNICE.x - 6, CORNICE.z], [CORNICE.x, CORNICE.z], 1.9, 0.5, 22);
      await holdBoss('heart_breath_guardian', CORNICE.x, CORNICE.z);
      await page.evaluate(() => {
        for (const e of window.__game.world.entities.values())
          if (e.smithHeartBreath)
            Object.assign(e.smithHeartBreath, {
              inhaleTimer: 999,
              circleTimer: 999,
              heartTimer: 999,
              blowTimer: 999,
            });
      });
      await chat('/dev heart breath swap 2', 1500 + 350);
    },
  };
  for (const [name, run] of Object.entries(scenes)) {
    if (ONLY && !ONLY.has(name)) continue;
    await run();
    await shoot(name);
  }
} finally {
  await browser.close();
}
