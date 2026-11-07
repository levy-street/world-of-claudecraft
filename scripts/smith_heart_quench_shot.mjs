// Evidence captures for the Smith's Heart's Guardian of the Quench (docs/
// design/raid/smith_heart.md sections 5.20 and 7.3): a huddle with its warmth
// glowing (and the cold on the loners), a freeze about to shatter, the ice
// cracking and a hole with a trapped player, the blades waking at half
// health, the echoes' footprints with a raider safe behind a blade, and
// heroic's crossing. A small raid of dev-only stand-in players is added to
// the offline world. Evidence tooling, not a repo test. Needs a dev Vite
// serving the worktree (ALLOW_DEV_COMMANDS is implied offline).
//
//   node scripts/smith_heart_quench_shot.mjs <outDir> [label]
//
// Env: SHOT_URL (http://127.0.0.1:5191/), SHOT_W / SHOT_H (1600x900),
// SHOT_PRESET (4), SHOT_ONLY (comma list of shot names).
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5191/';
const OUT = process.argv[2] ?? path.join('tmp', 'smith_heart_quench');
const LABEL = process.argv[3] ?? 'temple';
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const ONLY = process.env.SHOT_ONLY ? new Set(process.env.SHOT_ONLY.split(',')) : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ENTRY = { x: -196, z: -210 };
/** The lake's middle (instance-local) and the blades' homes. */
const MID = { x: 198, z: -2 };
const BLADES = [40, 130, 220, 310].map((deg) => {
  const a = (deg * Math.PI) / 180;
  return [MID.x + Math.sin(a) * 21, MID.z + Math.cos(a) * 19];
});

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
    if (m.type() === 'error' || /THREE\.|shader|WebGL/i.test(m.text()))
      console.log('CONSOLE:', m.type(), m.text().slice(0, 400));
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
    charName: 'Lakewalker',
    gameBootTimeoutMs: 180000,
    selectorTimeoutMs: 90000,
    settleMs: 4000,
  });
  if (!booted) throw new Error('offline world did not boot');
  const chat = async (c, wait = 900, pid) => {
    await page.evaluate(
      ([line, pid]) => window.__game.world.chat(line, pid === null ? undefined : pid),
      [c, pid ?? null],
    );
    await sleep(wait);
  };
  for (const c of ['/dev level 20', '/dev god', '/dev heart enter', '/dev noaggro'])
    await chat(c, 1500);
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
  await page.addStyleTag({ content: '#ui { display: none !important; }' });
  const O = await page.evaluate(
    ([ex, ez]) => {
      const p = window.__game.world.player;
      return { x: p.pos.x - ex, z: p.pos.z - ez };
    },
    [ENTRY.x, ENTRY.z],
  );
  console.log('origin', O);
  await page.evaluate(() => {
    const w = window.__game.world;
    const classes = ['warrior', 'paladin', 'mage', 'priest', 'rogue', 'hunter', 'druid', 'shaman'];
    window.__raid = classes.map((c, i) => {
      const id = w.addPlayer(c, `Raider${i + 1}`);
      const e = w.entities.get(id);
      e.devGod = true;
      return id;
    });
  });
  const place = async (at, look, yaw, pitch, dist) =>
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
  const raidId = (i) => page.evaluate((i) => window.__raid[i], i);
  /** Patch the live fight state (the clocks a shot parks). */
  const patch = (obj) =>
    page.evaluate((obj) => {
      for (const e of window.__game.world.entities.values())
        if (e.smithHeartQuench) Object.assign(e.smithHeartQuench, obj);
    }, obj);
  const setCold = (i, v) =>
    page.evaluate(
      ([i, v]) => {
        const id = window.__raid[i];
        for (const e of window.__game.world.entities.values()) {
          const st = e.smithHeartQuench;
          if (st) st.chill[id] = { cold: v, frozen: 0 };
        }
      },
      [i, v],
    );
  const pull = async () => {
    await chat('/dev heart quench reset', 800);
    await raider(0, MID.x, MID.z - 9);
    await page.evaluate(() => {
      const w = window.__game.world;
      const tank = w.entities.get(window.__raid[0]);
      for (const e of w.entities.values())
        if (e.templateId === 'heart_quench_guardian' && !e.dead) w.ctx.aggroMob(e, tank, false);
    });
    await sleep(3200);
    await patch({ breathTimer: 999 });
  };
  const shoot = async (name) => {
    const buf = await page.screenshot();
    fs.mkdirSync(OUT, { recursive: true });
    const file = path.join(OUT, `${name}_${LABEL}.png`);
    fs.writeFileSync(file, buf);
    console.log('SHOT', file);
  };

  const scenes = {
    // A huddle with its warmth, the loners frosting over.
    async '01_calor'() {
      await place([MID.x - 5, MID.z - 27], [MID.x - 6, MID.z - 15], 0.05, 0.62, 15);
      await pull();
      for (let i = 1; i < 5; i++)
        await raider(i, MID.x - 8 + (i % 2) * 2.2, MID.z - 16 + (i > 2 ? 2 : 0));
      await raider(5, MID.x + 6, MID.z - 18);
      await raider(6, MID.x - 18, MID.z - 12);
      await raider(7, MID.x + 2, MID.z - 24);
      await setCold(5, 88);
      await setCold(6, 60);
      await setCold(7, 35);
      await sleep(2600);
    },
    // A freeze, the ice about to shatter and its ring on the ice.
    async '02_estallido'() {
      await pull();
      await raider(1, MID.x - 8, MID.z - 16);
      await raider(2, MID.x - 4, MID.z - 17);
      await raider(3, MID.x - 11, MID.z - 20);
      await place([MID.x - 7, MID.z - 27], [MID.x - 8, MID.z - 16], 0.1, 0.55, 12);
      await chat('/dev heart quench burst', 2600, await raidId(1));
    },
    // The ice cracking under a huddle, a hole with a raider in the water.
    async '03_hielo'() {
      await pull();
      await raider(1, MID.x - 12, MID.z - 14);
      await chat('/dev heart quench hole', 1200, await raidId(1));
      await raider(2, MID.x - 2, MID.z - 18);
      await raider(3, MID.x - 0.5, MID.z - 19.5);
      await raider(4, MID.x + 1, MID.z - 17.5);
      await chat('/dev heart quench crack', 0, await raidId(2));
      await place([MID.x - 6, MID.z - 27], [MID.x - 6, MID.z - 15], 0.05, 0.7, 15);
      await sleep(1700);
    },
    // At half health the blades tear free.
    async '04_despertar'() {
      await pull();
      for (let i = 1; i < 8; i++) await raider(i, MID.x - 10 + i * 2.5, MID.z - 14);
      await place([MID.x + 2, MID.z - 34], [MID.x, MID.z], 0.0, 0.3, 30);
      await chat('/dev heart quench phase2', 3000);
    },
    // The echoes' footprints at every blade; one raider safe behind a blade.
    async '05_ecos'() {
      await pull();
      await chat('/dev heart quench blades', 1500);
      // The tank south of the guardian: the breath and its echoes run south.
      await raider(0, MID.x, MID.z - 8);
      const b = BLADES[2];
      await raider(1, b[0], b[1] + 3.5);
      await raider(2, b[0] + 6, b[1] - 6);
      for (let i = 3; i < 8; i++) await raider(i, MID.x + 14 + i, MID.z + 6);
      await place([MID.x - 4, MID.z - 26], [MID.x - 10, MID.z - 10], 0.0, 0.95, 34);
      await sleep(600);
      await chat('/dev heart quench breath', 2600);
    },
    // Heroic: two blades cross the lake, their lane telegraphed.
    async '06_danza'() {
      await pull();
      await chat('/dev heart quench heroic', 300);
      await chat('/dev heart quench blades', 1500);
      for (let i = 1; i < 8; i++) await raider(i, MID.x + 18, MID.z - 12 + i);
      await place([MID.x - 2, MID.z - 27], [MID.x, MID.z], 0.0, 0.95, 40);
      await chat('/dev heart quench dance', 2000);
    },
  };

  for (const [name, run] of Object.entries(scenes)) {
    if (ONLY && !ONLY.has(name)) continue;
    try {
      await run();
      await shoot(name);
    } catch (e) {
      console.log('SCENE FAILED', name, e.message);
    }
  }
} finally {
  await browser.close();
}
