// Evidence captures for the Smith's Heart's Guardian of the Heat (docs/
// design/raid/smith_heart.md section 7.4, "the well of the first flame"):
// the giant sunk in its wellspring with the raid before it, Basalt Fist's
// spot and lanes, the Molten Swells rolling, the overflow's rivers and the
// Wellspawn, the Hearthseeds and Wakefire, a Rolling Cinder on the hunt,
// heroic's second overflow with its Wellkeepers, the wellspring at the raid's
// height with the route seam and a wave of seeds. A small raid of dev-only stand-in
// players is added to the offline world. Evidence tooling, not a repo test.
// Needs a dev Vite serving the worktree (ALLOW_DEV_COMMANDS is implied
// offline).
//
//   node scripts/smith_heart_heat_shot.mjs <outDir>
//
// Env: SHOT_URL (http://127.0.0.1:5191/), SHOT_W / SHOT_H (1600x900),
// SHOT_PRESET (4), SHOT_ONLY (comma list of shot names), SHOT_HUD (1: keep
// the HUD).
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
/** The wellspring's middle, the guardian's spot (instance-local). */
const BOSS = { x: -220, z: 0 };

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
  /** Hold the fight's own clocks (a shot asks for what it shows). */
  const holdAll = () =>
    page.evaluate(() => {
      for (const e of window.__game.world.entities.values())
        if (e.smithHeartHeat) {
          const st = e.smithHeartHeat;
          st.fistTimer = 999;
          st.flareTimer = 999;
          st.seedTimer = 999;
          st.zoneTimer = 999;
          st.cinderTimer = 999;
        }
    });
  const pull = async (heroic = false) => {
    await chat('/dev heart heat reset', 800);
    await chat(`/dev heart heat heroic ${heroic ? 'on' : 'off'}`, 300);
    await raider(0, BOSS.x + 10, BOSS.z + 1);
    await page.evaluate(() => {
      const w = window.__game.world;
      const tank = w.entities.get(window.__raid[0]);
      for (const e of w.entities.values())
        if (e.templateId === 'heart_heat_guardian' && !e.dead) {
          w.ctx.aggroMob(e, tank, false);
          e.threat.set(tank.id, 1e6);
        }
    });
    await sleep(1500);
    await holdAll();
  };
  /** The raid in a loose crescent before the wellspring. */
  const crescent = async (from = 1, r = 14) => {
    for (let i = from; i < 8; i++) {
      const a = -0.9 + ((i - from) / Math.max(1, 7 - from)) * 1.8;
      await raider(i, BOSS.x + Math.cos(a) * r, BOSS.z + Math.sin(a) * r);
    }
  };
  const shoot = async (name) => {
    const buf = await page.screenshot();
    fs.mkdirSync(OUT, { recursive: true });
    const file = path.join(OUT, `${name}.png`);
    fs.writeFileSync(file, buf);
    console.log('SHOT', file);
  };

  const scenes = {
    // The giant sunk to its waist in the wellspring, the raid before it for
    // scale; Basalt Fist's spot and its three lanes over a raider.
    async '01_gigante'() {
      await pull();
      await crescent(1, 13);
      await place([BOSS.x + 34, BOSS.z - 8], [BOSS.x, BOSS.z], 0.06, 0.2, 14);
      await chat('/dev heart heat fist', 1900, await raidId(4));
    },
    // The Molten Swells rolling out from the crater.
    async '02_olas'() {
      await pull();
      await crescent(1, 12);
      await raider(3, BOSS.x + 22, BOSS.z + 6);
      await chat('/dev heart heat fist', 300, await raidId(3));
      await place([BOSS.x + 24, BOSS.z + 14], [BOSS.x + 22, BOSS.z + 6], 0.2, 0.55, 15);
      await sleep(3900);
    },
    // Heroic's first overflow: sunk under, the rivers out of the wellspring,
    // the Wellspawn walking in.
    async '03_desborde'() {
      await pull(true);
      await crescent(1, 18);
      await place([BOSS.x + 22, BOSS.z - 10], [BOSS.x + 4, BOSS.z], 0.1, 0.6, 16);
      await chat('/dev heart heat intermission', 6500);
    },
    // Phase 2: Hearthseeds under the raid and Wakefire's middle band.
    async '04_semillas'() {
      await pull();
      await chat('/dev heart heat phase 2', 400);
      await holdAll();
      await crescent(1, 12);
      await chat('/dev heart heat seeds', 300);
      await chat('/dev heart heat zones', 4800);
      await place([BOSS.x + 22, BOSS.z + 8], [BOSS.x + 4, BOSS.z], 0.1, 0.62, 17);
      await sleep(800);
    },
    // Phase 3: a Rolling Cinder hunting a raider over the shore.
    async '05_ascua'() {
      await pull();
      await chat('/dev heart heat phase 3', 400);
      await holdAll();
      await crescent(1, 12);
      await chat('/dev heart heat ember', 4200);
      // Stand behind the cinder, looking past it to the giant.
      const c = await page.evaluate(
        ([ox, oz]) => {
          for (const e of window.__game.world.entities.values())
            if (e.templateId === 'heart_heat_rolling_cinder' && !e.dead)
              return { x: e.pos.x - ox, z: e.pos.z - oz };
          return null;
        },
        [O.x, O.z],
      );
      const at = c ?? { x: BOSS.x + 20, z: BOSS.z - 14 };
      const dx = at.x - BOSS.x;
      const dz = at.z - BOSS.z;
      const d = Math.hypot(dx, dz) || 1;
      await place([at.x + (dx / d) * 9, at.z + (dz / d) * 9], [BOSS.x, BOSS.z], 0.05, 0.3, 12);
      await sleep(600);
    },
    // Heroic's second overflow: the Wellkeepers marking a raider who trails
    // fire, the Wellspawn walking in through the rivers.
    async '06_guardianes'() {
      await pull(true);
      await chat('/dev heart heat phase 2', 400);
      await holdAll();
      await crescent(1, 18);
      await chat('/dev heart heat intermission', 9000);
      await place([BOSS.x + 22, BOSS.z + 8], [BOSS.x + 6, BOSS.z], 0.1, 0.6, 17);
      await sleep(4000);
    },
    // The wellspring at the raid's height, phase 2's boil: the crust plates
    // drifting over the lava, the bubbles, the basalt lip and the shimmer;
    // the Heat's route seam running off east; the raid's Hearthseeds to the
    // north as one field.
    async '07_pozo'() {
      await pull();
      await chat('/dev heart heat phase 2', 400);
      await holdAll();
      for (let i = 1; i < 8; i++) await raider(i, BOSS.x + 6 + i * 2.2, BOSS.z + 13 + (i % 3) * 2);
      await chat('/dev heart heat seeds', 300);
      await place([BOSS.x + 19, BOSS.z - 12], [BOSS.x + 1, BOSS.z + 1], 0.12, 0.42, 14);
      await sleep(5200);
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
                !/smithHeartHeat(Cinder|Spirit|WellPool)|smith-heart-heat-body|smithHeartHeatBody/.test(
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
