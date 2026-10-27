// Evidence captures for the Smith's Heart's Guardian of the Heat (docs/
// design/raid/smith_heart.md section 7.4): the heat building with the body
// glowing, a Kindled Crystal's ray on a raider, Crystal Burn on a body, the
// channel flowing and splitting the floor, the overheat's wind-up, heroic's
// embers. A small raid of dev-only stand-in players is added to the offline
// world. Evidence tooling, not a repo test. Needs a dev Vite serving the
// worktree (ALLOW_DEV_COMMANDS is implied offline).
//
//   node scripts/smith_heart_heat_shot.mjs <outDir>
//
// Env: SHOT_URL (http://127.0.0.1:5191/), SHOT_W / SHOT_H (1600x900),
// SHOT_PRESET (4), SHOT_ONLY (comma list of shot names), SHOT_HUD (1: keep the
// HUD, for the heat gauge's shot 07_medidor).
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5191/';
const OUT = process.argv[2] ?? path.join('tmp', 'smith_heart_heat');
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const HUD = process.env.SHOT_HUD === '1';
const ONLY = process.env.SHOT_ONLY ? new Set(process.env.SHOT_ONLY.split(',')) : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ENTRY = { x: -196, z: -210 };
/** The guardian's spot and the channel's line (instance-local). */
const BOSS = { x: -210, z: 0 };
const CHANNEL_X = -215;

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
    charName: 'Hearthwalker',
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
  // The HUD hidden for the scenes, unless SHOT_HUD asks for it (the heat
  // gauge over the action bar is part of what a shot shows).
  if (!HUD) await page.addStyleTag({ content: '#ui { display: none !important; }' });
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
  /** The crystals standing now (instance-local). */
  const crystals = () =>
    page.evaluate(() => {
      for (const e of window.__game.world.entities.values())
        if (e.smithHeartHeat) return e.smithHeartHeat.crystals.map((c) => [c.x, c.z]);
      return [];
    });
  /** Hold the guardian's kit casts and the fight's clocks (a shot asks). */
  const holdAll = () =>
    page.evaluate(() => {
      for (const e of window.__game.world.entities.values())
        if (e.smithHeartHeat && e.trashKit) {
          e.trashKit.timers.line = 999;
          e.trashKit.timers.screech = 999;
          e.smithHeartHeat.shedTimer = 999;
          e.smithHeartHeat.channel.remaining = 999;
          e.smithHeartHeat.stokeTimer = 999;
        }
    });
  const pull = async () => {
    await chat('/dev heart heat reset', 800);
    await raider(0, BOSS.x + 6, BOSS.z + 1);
    await page.evaluate(() => {
      const w = window.__game.world;
      const tank = w.entities.get(window.__raid[0]);
      for (const e of w.entities.values())
        if (e.templateId === 'heart_heat_guardian' && !e.dead) w.ctx.aggroMob(e, tank, false);
    });
    await sleep(1500);
    await holdAll();
  };
  const shoot = async (name) => {
    const buf = await page.screenshot();
    fs.mkdirSync(OUT, { recursive: true });
    const file = path.join(OUT, `${name}.png`);
    fs.writeFileSync(file, buf);
    console.log('SHOT', file);
  };

  const scenes = {
    // The heat building: the body up close burning toward white, the raid
    // round it.
    async '01_calor'() {
      await pull();
      for (let i = 1; i < 5; i++) await raider(i, BOSS.x + 5 + (i % 2) * 2, BOSS.z - 6 + i * 3);
      await place([BOSS.x + 9, BOSS.z + 2], [BOSS.x, BOSS.z], 0.25, 0.08, 6);
      await chat('/dev heart heat heat 84', 2400);
    },
    // A Kindled Crystal's ray on the raider standing in its reach.
    async '02_rayo'() {
      await pull();
      await chat('/dev heart heat heat 55', 300);
      await chat('/dev heart heat crystals', 400);
      const cs = await crystals();
      const [cx, cz] = cs[0] ?? [-190, 0];
      await raider(1, cx + 7, cz);
      for (let i = 2; i < 7; i++) await raider(i, BOSS.x + 4 + i, BOSS.z - 14);
      await place([cx + 4, cz + 15], [cx + 3.5, cz], 0.0, 0.32, 10);
      await sleep(3300);
    },
    // Crystal Burn climbing a soaker who has taken too many rays.
    async '03_quemadura'() {
      await pull();
      await chat('/dev heart heat crystals', 400);
      const cs = await crystals();
      const [cx, cz] = cs[0] ?? [-190, 0];
      await raider(1, cx + 4, cz + 1);
      await raider(2, cx + 9, cz + 3);
      await chat('/dev heart heat burn 11', 300, await raidId(1));
      await chat('/dev heart heat burn 4', 300, await raidId(2));
      await place([cx + 6, cz + 10], [cx + 5, cz + 1], 0.0, 0.25, 7);
      await sleep(2600);
    },
    // The channel flowing, the floor split in two, soakers either side.
    async '04_canal'() {
      await pull();
      await chat('/dev heart heat crystals', 400);
      await raider(1, CHANNEL_X + 9, 12);
      await raider(2, CHANNEL_X - 9, -10);
      await raider(3, CHANNEL_X + 12, -16);
      await raider(4, CHANNEL_X - 14, 18);
      await place([CHANNEL_X + 26, -30], [CHANNEL_X, 0], 0.15, 0.62, 30);
      await chat('/dev heart heat channel', 5600);
    },
    // The overheat's wind-up: the body flashing white, the floor beating.
    async '05_sobrecalor'() {
      await pull();
      for (let i = 1; i < 8; i++)
        await raider(i, BOSS.x + 9 + (i % 3) * 2.5, BOSS.z - 10 + i * 2.6);
      await place([BOSS.x + 20, BOSS.z - 6], [BOSS.x, BOSS.z], 0.2, 0.38, 18);
      await chat('/dev heart heat heat 96', 2200);
    },
    // The heat gauge over the action bar in the wind-up (run with SHOT_HUD=1):
    // the raid's shared heat, flashing, and the body white with the rings of
    // heat drawn into it.
    async '07_medidor'() {
      await pull();
      for (let i = 1; i < 8; i++) await raider(i, BOSS.x + 8 + (i % 3) * 2.5, BOSS.z - 9 + i * 2.6);
      await place([BOSS.x + 15, BOSS.z - 3], [BOSS.x, BOSS.z], 0.2, 0.3, 13);
      await chat('/dev heart heat heat 97', 1500);
    },
    // Heroic: three crystals, the knell's embers under the melee.
    async '06_brasas'() {
      await pull();
      await chat('/dev heart heat heroic', 300);
      await chat('/dev heart heat crystals', 400);
      const spots = [
        [BOSS.x + 4, BOSS.z + 3],
        [BOSS.x + 3, BOSS.z - 4],
        [BOSS.x - 2, BOSS.z + 5],
        [BOSS.x + 7, BOSS.z],
      ];
      for (let i = 0; i < spots.length; i++) {
        await raider(i + 1, spots[i][0], spots[i][1]);
        await chat('/dev heart heat embers', 150, await raidId(i + 1));
      }
      for (let i = 1; i < 5; i++) await raider(i, BOSS.x + 12 + i * 2, BOSS.z - 6 + i * 3);
      await place([BOSS.x + 24, BOSS.z + 10], [BOSS.x, BOSS.z], 0.2, 0.55, 24);
      await sleep(2400);
    },
  };

  for (const [name, run] of Object.entries(scenes)) {
    if (ONLY && !ONLY.has(name)) continue;
    try {
      await run();
      if (process.env.SHOT_DUMP)
        console.log(
          'DUMP',
          await page.evaluate(() => {
            const out = [];
            window.__game.renderer.scene.traverse((o) => {
              if (
                !/smithHeartHeat(Crystal|Ray)$|smith-heart-heat-body|smithHeartHeatBody/.test(
                  o.name,
                )
              )
                return;
              const p = o.getWorldPosition(new o.position.constructor());
              out.push(
                `${o.name} vis=${o.visible} at=${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)} sc=${o.scale.x.toFixed(2)},${o.scale.y.toFixed(2)} kids=${o.children.length}`,
              );
            });
            const w = window.__game.world;
            for (const e of w.entities.values())
              if (e.kind === 'object' && e.templateId.startsWith('sh_heat'))
                out.push(
                  `obj ${e.id} ${e.templateId} at=${e.pos.x.toFixed(1)},${e.pos.y.toFixed(1)},${e.pos.z.toFixed(1)}`,
                );
            return out.join(' | ');
          }),
        );
      await shoot(name);
    } catch (e) {
      console.log('SCENE FAILED', name, e.message);
    }
  }
} finally {
  await browser.close();
}
