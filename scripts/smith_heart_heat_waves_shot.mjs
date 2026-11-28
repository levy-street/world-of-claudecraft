// Evidence captures for the Guardian of the Heat's lava waves (the rework of
// 2026-11-18; docs/design/raid/smith_heart.md section 7.4): the overflow's rings
// of lava as walls of fire, close and far, the corridors glowing ahead of them, a
// low camera over the floor (no flicker), the low graphics tier, and short frame
// sequences for the videos. A small raid of dev-only stand-in players stands in
// the corridors. Evidence tooling, not a repo test. Needs a dev Vite serving the
// worktree (ALLOW_DEV_COMMANDS is implied offline).
//
//   node scripts/smith_heart_heat_waves_shot.mjs <outDir>
//
// Env: SHOT_URL (http://127.0.0.1:5191/), SHOT_W / SHOT_H (1600x900),
// SHOT_PRESET (4), SHOT_ONLY (comma list of scene names), SHOT_FRAMES (frames a
// sequence takes, 0 for none), SHOT_TIER (normal | heroic).
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5191/';
const OUT = process.argv[2] ?? path.join('tmp', 'smith_heart_heat_waves');
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const ONLY = process.env.SHOT_ONLY ? new Set(process.env.SHOT_ONLY.split(',')) : null;
const FRAMES = Number(process.env.SHOT_FRAMES ?? 0);
const HEROIC = process.env.SHOT_TIER === 'heroic';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ENTRY = { x: -196, z: -210 };
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
      console.log('CONSOLE:', m.type(), m.text().slice(0, 600));
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
  const chat = async (c, wait = 900) => {
    await page.evaluate((line) => window.__game.world.chat(line), c);
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
  // Spend the guardian's entrance (a forced mechanic starts the fight), then
  // stand it whole again: every scene pulls a guardian already awake.
  await chat('/dev heart heat phase 1', 600);
  await chat('/dev heart heat reset', 600);
  const O = await page.evaluate(
    ([ex, ez]) => {
      const p = window.__game.world.player;
      return { x: p.pos.x - ex, z: p.pos.z - ez };
    },
    [ENTRY.x, ENTRY.z],
  );
  await page.evaluate(() => {
    const w = window.__game.world;
    const classes = ['warrior', 'paladin', 'mage', 'priest', 'rogue', 'hunter', 'druid', 'shaman'];
    window.__raid = classes.map((c, i) => {
      const id = w.addPlayer(c, `Raider${i + 1}`);
      w.entities.get(id).devGod = true;
      return id;
    });
  });
  // The camera held on the player at a yaw (off its facing), pitch and distance.
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
  /** The fight's state on the guardian. */
  const state = () =>
    page.evaluate(() => {
      for (const e of window.__game.world.entities.values())
        if (e.smithHeartHeat) {
          const st = e.smithHeartHeat;
          const o = st.overflow;
          return {
            stage: st.stage,
            rings: o ? o.rings.map((r) => ({ front: r.front, gaps: r.gaps })) : [],
            next: o?.next ? { gaps: o.next.gaps, launchIn: o.next.launchIn } : null,
          };
        }
      return null;
    });
  /** Freeze or free the sim (the world's tick; the renderer keeps drawing). */
  const freeze = (on) =>
    page.evaluate((on) => {
      const w = window.__game.world;
      if (on && !w.__realTick) {
        w.__realTick = w.tick.bind(w);
        w.tick = () => [];
      } else if (!on && w.__realTick) {
        w.tick = w.__realTick;
        w.__realTick = null;
      }
    }, on);
  /** Pull, drop to 69 percent, wait for the guardian to go under. */
  const overflow = async () => {
    await freeze(false);
    await chat('/dev heart heat reset', 800);
    await chat(`/dev heart heat heroic ${HEROIC ? 'on' : 'off'}`, 300);
    await raider(0, BOSS.x + 12, BOSS.z + 1);
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
    await page.evaluate(() => {
      for (const e of window.__game.world.entities.values())
        if (e.smithHeartHeat) {
          const st = e.smithHeartHeat;
          st.fistTimer = 999;
          st.flareTimer = 999;
          st.seedTimer = 999;
          st.zoneTimer = 999;
          st.wheelTimer = 999;
          st.cinderTimer = 999;
          e.hp = Math.floor(e.maxHp * 0.69);
        }
    });
    for (let i = 0; i < 40; i++) {
      const s = await state();
      if (s?.stage === 'under') return;
      await sleep(250);
    }
  };
  /** Wait until the newest ring's front is `r` yards out (or the first ring if none). */
  const ringAt = async (r, which = 'newest') => {
    for (let i = 0; i < 400; i++) {
      const s = await state();
      if (s?.rings.length) {
        const fronts = s.rings.map((x) => x.front);
        const f = which === 'newest' ? Math.min(...fronts) : Math.max(...fronts);
        if (f >= r) return s;
      }
      await sleep(30);
    }
    return state();
  };
  /** The raid stood in a ring's corridors (or the next one's), `r` out. */
  const inCorridors = async (gaps, r = 15) => {
    for (let i = 1; i < 8; i++) {
      const g = gaps[i % gaps.length] + ((i % 3) - 1) * 0.08;
      const rr = r + (i % 4) * 2.5;
      await raider(i, BOSS.x + Math.sin(g) * rr, BOSS.z + Math.cos(g) * rr);
    }
  };
  const shoot = async (name) => {
    const buf = await page.screenshot({ type: 'jpeg', quality: 90 });
    fs.mkdirSync(OUT, { recursive: true });
    const file = path.join(OUT, `${name}.jpg`);
    fs.writeFileSync(file, buf);
    console.log('SHOT', file);
  };
  /** `n` frames at about 15 a second into OUT/<name>/ for a video. */
  const sequence = async (name, n) => {
    const dir = path.join(OUT, name);
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < n; i++) {
      const buf = await page.screenshot({ type: 'jpeg', quality: 85 });
      fs.writeFileSync(path.join(dir, `f${String(i).padStart(4, '0')}.jpg`), buf);
      await sleep(30);
    }
    console.log('SEQ', dir, n);
  };
  /** A spot `r` out on bearing `b` from the wellspring (instance-local). */
  const out = (b, r) => [BOSS.x + Math.sin(b) * r, BOSS.z + Math.cos(b) * r];

  // Stand in the Hearth once and let it load before the first scene.
  await place([-190, 0], [-220, 0], 0, 0.4, 20);
  await sleep(8000);

  const scenes = {
    // From the shore's far end: a whole ring of fire rolling across the Hearth,
    // the raid in its corridors.
    async '01_lejos_anillo_entero'() {
      await overflow();
      const s = await ringAt(17);
      if (s?.rings.length) await inCorridors(s.rings[0].gaps, 24);
      await place([-182, 0], [-220, 0], 0, 0.42, 30);
      await sleep(400);
      await freeze(true);
      await sleep(600);
      await shoot('01_lejos_anillo_entero');
      await freeze(false);
    },
    // Close on the wall as it comes: a player in a corridor, the flames parted
    // either side, the floor lit ahead of it.
    async '02_cerca_hueco'() {
      await overflow();
      const s = await ringAt(14);
      const g = s.rings[0].gaps[0];
      await inCorridors(s.rings[0].gaps, 22);
      const me = out(g, 22);
      await place(me, out(g, 10), 0.35, 0.16, 9);
      await sleep(500);
      await freeze(true);
      await sleep(600);
      await shoot('02_cerca_hueco');
      await freeze(false);
    },
    // Close on the wall's burning face, away from the corridors.
    async '03_cerca_muro'() {
      await overflow();
      const s = await ringAt(18);
      const g = s.rings[0].gaps[0] + Math.PI / 2;
      const me = out(g, 25);
      await place(me, out(g, 10), 0, 0.1, 9);
      await sleep(500);
      await freeze(true);
      await sleep(600);
      await shoot('03_cerca_muro');
      await freeze(false);
    },
    // The next ring's corridors glowing on the floor before it leaves the lip.
    async '04_aviso_huecos'() {
      await overflow();
      await sleep(800);
      const s = await state();
      if (s?.next) await inCorridors(s.next.gaps, 15);
      await place([-186, 18], [-220, 0], 0, 0.75, 30);
      await sleep(400);
      await freeze(true);
      await sleep(600);
      await shoot('04_aviso_huecos');
      await freeze(false);
    },
    // Low camera over the floor: the wall's foot, the scorch, the corridors, the
    // wellspring's lip (no flicker, no z-fighting).
    async '05_camara_baja_suelo'() {
      await overflow();
      const s = await ringAt(20);
      const g = s.rings[0].gaps[0] + 0.9;
      const me = out(g, 30);
      await place(me, out(g, 5), 0.25, 0.03, 5);
      await sleep(500);
      await freeze(true);
      await sleep(600);
      await shoot('05_camara_baja_suelo');
      await page.evaluate(() => {
        window.__shotHold.yaw += 0.35;
      });
      await sleep(500);
      await shoot('05b_camara_baja_girada');
      await freeze(false);
    },
    // From high above: two rings at once, every corridor stretch.
    async '06_cenital_dos_anillos'() {
      await overflow();
      await ringAt(30, 'oldest');
      const s = await state();
      if (s?.rings.length) await inCorridors(s.rings[s.rings.length - 1].gaps, 15);
      await place([-196, 0], [-220, 0], 0, 1.2, 55);
      await sleep(400);
      await freeze(true);
      await sleep(600);
      await shoot('06_cenital_dos_anillos');
      await freeze(false);
    },
    // The Wheel of the Hearth on Normal in phase 1 (every tier since the
    // rework): three slices red, the safe one cool.
    async '07_rueda_normal'() {
      await freeze(false);
      await chat('/dev heart heat reset', 800);
      await chat(`/dev heart heat heroic ${HEROIC ? 'on' : 'off'}`, 300);
      await chat('/dev heart heat phase 1', 600);
      await chat('/dev heart heat wheel', 1800);
      await place([-190, 6], [-220, 0], 0, 0.6, 30);
      await sleep(1200);
      await shoot('07_rueda_normal');
    },
    // The wall lighting the raid (heat_lava_wall_light.ts): the camera in
    // front of the raid as a wall comes on, then the same frame with the
    // wall's lights cut (their reach shrunk to nothing) for the comparison.
    async '09_luz_en_la_banda'() {
      await overflow();
      const s = await ringAt(15);
      const g = s.rings[0].gaps[0] + Math.PI / 2;
      for (let i = 1; i < 6; i++) {
        const [x, z] = out(g + (i - 3) * 0.06, 21 + (i % 2) * 1.5);
        await raider(i, x, z);
      }
      await place(out(g, 24), out(g, 10), 1.35, 0.1, 11);
      await ringAt(17);
      await freeze(true);
      await sleep(700);
      await shoot('09_luz_en_la_banda');
      const n = await page.evaluate(() => {
        let n = 0;
        window.__game.renderer.scene.traverse((o) => {
          if (o.isPointLight && o.name.startsWith('smithHeartHeatWallLight')) {
            o.userData.__shotDistance = o.distance;
            o.distance = 0.001;
            n++;
          }
        });
        return n;
      });
      console.log('wall lights', n);
      await sleep(500);
      await shoot('09b_sin_luz_del_muro');
      await page.evaluate(() => {
        window.__game.renderer.scene.traverse((o) => {
          if (o.isPointLight && o.userData.__shotDistance) o.distance = o.userData.__shotDistance;
        });
      });
      await freeze(false);
    },
    // A video's frames: the raid at the shore, two rings rolling past.
    async v01_olas() {
      if (!FRAMES) return;
      await overflow();
      const s = await ringAt(11);
      await inCorridors(s.rings[0].gaps, 20);
      const g = s.rings[0].gaps[0];
      await place(out(g, 24), out(g, 8), 0.5, 0.3, 16);
      await sleep(300);
      await sequence('v01_olas', FRAMES);
    },
    async v02_cerca() {
      if (!FRAMES) return;
      await overflow();
      const s = await ringAt(11);
      const g = s.rings[0].gaps[0];
      await inCorridors(s.rings[0].gaps, 20);
      await place(out(g, 21), out(g, 8), 0.3, 0.12, 7);
      await sleep(300);
      await sequence('v02_cerca', FRAMES);
    },
  };
  for (const [name, fn] of Object.entries(scenes)) {
    if (ONLY && !ONLY.has(name)) continue;
    try {
      await fn();
    } catch (e) {
      console.log('SCENE FAILED', name, e.message);
    }
  }
} finally {
  await browser.close();
}
