// Evidence captures for the Smith's Heart's Hammer Council (docs/design/raid/
// smith_heart.md sections 5.18 and 7.1): the two on the Quarry floor, a
// Mountain's Wrath with the raid hiding behind the pillars, Wake the Stone
// raising a pillar, a Resonance spread ring, a Falling Rock soak, and the
// inheritance's light when one of them falls. A small raid of dev-only
// stand-in players is added to the offline world so the marks have someone
// to fall on. Evidence tooling, not a repo test. Needs a dev Vite serving the
// worktree (ALLOW_DEV_COMMANDS is implied offline).
//
//   node scripts/smith_heart_council_shot.mjs <outDir> [label]
//
// Env: SHOT_URL (http://127.0.0.1:5191/), SHOT_W / SHOT_H (1600x900),
// SHOT_PRESET (4), SHOT_ONLY (comma list of shot names), SHOT_HEROIC=1,
// SHOT_MYTHIC=1 (the mythic switch on, and only the m* Soul in the Stone
// shots), SHOT_UI=1 (keep the HUD: the raid warning banners), SHOT_SETTLE
// (ms to wait for the raid's loading curtain, 9000), SHOT_RUSH_CAM=behind
// (the Rush shots from behind the Guardian instead of from the side). The b*,
// c* and w* shots are Bond of the Stone, Mountain's Rush and the columns'
// warning (entregas consejo_flojos).
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5191/';
const OUT = process.argv[2] ?? path.join('tmp', 'smith_heart_council');
const LABEL = process.argv[3] ?? 'consejo';
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const ONLY = process.env.SHOT_ONLY ? new Set(process.env.SHOT_ONLY.split(',')) : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ENTRY = { x: -196, z: -210 };
const MID = { x: 8, z: -170 };

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
    charName: 'Heartwalker',
    gameBootTimeoutMs: 180000,
    selectorTimeoutMs: 90000,
    settleMs: 4000,
  });
  if (!booted) throw new Error('offline world did not boot');
  const chat = async (c, wait = 900) => {
    await page.evaluate((line) => window.__game.world.chat(line), c);
    await sleep(wait);
  };
  // The camera's own player is never the council's foe (/dev noaggro).
  for (const c of ['/dev level 20', '/dev god', '/dev heart enter', '/dev noaggro'])
    await chat(c, 1500);
  for (const p of ['h1', 'h2', 'h3']) await chat(`/dev heart kill pack ${p}`, 300);
  if (process.env.SHOT_HEROIC === '1') await chat('/dev heart council heroic on', 300);
  if (process.env.SHOT_MYTHIC === '1') await chat('/dev heart council mythic on', 300);
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
  if (process.env.SHOT_UI !== '1')
    await page.addStyleTag({ content: '#ui { display: none !important; }' });
  // Let the raid's own loading curtain clear before the first shot.
  await sleep(Number(process.env.SHOT_SETTLE ?? 9000));
  const O = await page.evaluate(
    ([ex, ez]) => {
      const p = window.__game.world.player;
      return { x: p.pos.x - ex, z: p.pos.z - ez };
    },
    [ENTRY.x, ENTRY.z],
  );
  console.log('origin', O);
  // The stand-in raid: eight players of several classes, god-moded.
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
  const RAID = await page.evaluate(() => window.__raid);
  // Place the camera's own player and hold the camera.
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
  // Put raider `i` at instance-local (x, z).
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
  // The council's shared state (a read of its live fight).
  const state = () =>
    page.evaluate(() => {
      for (const e of window.__game.world.entities.values()) {
        const st = e.smithHeartFight;
        if (st) return JSON.parse(JSON.stringify(st));
      }
      return null;
    });
  const pull = async () => {
    // The council pulls onto raider 1 (the tank), at the Quarry's middle.
    await raider(0, MID.x - 4, MID.z);
    await page.evaluate(() => {
      const w = window.__game.world;
      const tank = w.entities.get(window.__raid[0]);
      for (const e of w.entities.values())
        if (/^heart_(hammer_guardian|seam_singer)$/.test(e.templateId) && !e.dead)
          w.ctx.aggroMob(e, tank, false);
    });
    await sleep(800);
    const st = await state();
    if (st) {
      // Park the clocks: each shot calls its own mechanic.
      await page.evaluate(() => {
        for (const e of window.__game.world.entities.values()) {
          const st = e.smithHeartFight;
          if (!st) continue;
          Object.assign(st, {
            weightTimer: 999,
            wakeTimer: 999,
            rockTimer: 999,
            boltTimer: 999,
            songTimer: 999,
            songDue: null,
            energy: 0,
          });
          break;
        }
      });
    }
  };
  const reset = () => chat('/dev heart council reset', 1500);
  // Every council clock parked (no stray Song or Rush in a shot).
  const park = () =>
    page.evaluate(() => {
      for (const e of window.__game.world.entities.values()) {
        const st = e.smithHeartFight;
        if (!st) continue;
        Object.assign(st, {
          weightTimer: 999,
          wakeTimer: 999,
          rockTimer: 999,
          boltTimer: 999,
          songTimer: 999,
          rushTimer: 999,
          songDue: null,
        });
        break;
      }
    });
  // The first soul pillar's instance-local spot, and a write to its soul.
  const soulAt = () =>
    page.evaluate(
      ([ox, oz]) => {
        const w = window.__game.world;
        for (const e of w.entities.values()) {
          const st = e.smithHeartFight;
          const id = st?.souls?.[0]?.pillarId;
          if (id === undefined) continue;
          const p = w.entities.get(id);
          return p ? [p.pos.x - ox, p.pos.z - oz] : null;
        }
        return null;
      },
      [O.x, O.z],
    );
  const setSoul = (patch) =>
    page.evaluate((patch) => {
      for (const e of window.__game.world.entities.values()) {
        const s = e.smithHeartFight;
        if (s?.souls?.[0]) {
          Object.assign(s.souls[0], patch);
          return;
        }
      }
    }, patch);
  // Stand `back` yards from a spot toward the Quarry's middle, facing it.
  const aimAt = (at, back, yaw, pitch, dist, turn = 0) => {
    const d = Math.hypot(MID.x - at[0], MID.z - at[1]) || 1;
    const ux = (MID.x - at[0]) / d;
    const uz = (MID.z - at[1]) / d;
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    const p = [at[0] + (ux * c - uz * s) * back, at[1] + (ux * s + uz * c) * back];
    return place(p, at, yaw, pitch, dist);
  };
  const col = (k, out) => {
    const deg = [20, 92, 164, 236, 308][k];
    const a = (deg * Math.PI) / 180;
    return [MID.x + Math.sin(a) * (24 + out), MID.z + Math.cos(a) * (24 + out)];
  };
  // Put a council member at instance-local (x, z) and give it a tank.
  const member = (tpl, x, z, tankIdx) =>
    page.evaluate(
      ([ox, oz, tpl, x, z, tankId]) => {
        const w = window.__game.world;
        for (const e of w.entities.values()) {
          if (e.templateId !== tpl || e.dead) continue;
          const g = w.ctx.groundPos(ox + x, oz + z);
          e.pos = { ...g };
          e.prevPos = { ...g };
          w.ctx.rebucket(e);
          const tank = tankId === null ? null : w.entities.get(tankId);
          if (tank) {
            w.ctx.aggroMob(e, tank, false);
            e.threat.set(tank.id, 1e7);
          }
        }
      },
      [O.x, O.z, tpl, x, z, tankIdx === null ? null : RAID[tankIdx]],
    );
  const shoot = async (name) => {
    const buf = await page.screenshot();
    fs.mkdirSync(OUT, { recursive: true });
    const file = path.join(OUT, `${name}_${LABEL}.png`);
    fs.writeFileSync(file, buf);
    console.log('SHOT', file);
  };

  // A Rush led into the cursed pillar: the Guardian across the Quarry, the
  // marked player beyond the pillar on its line; shoot when `ready` reads
  // the live state true (then wait `after` ms).
  const rushScene = async (ready, after = 0) => {
    await reset();
    await pull();
    await member('heart_seam_singer', MID.x - 30, MID.z + 26, 1);
    await raider(1, MID.x - 31, MID.z + 27);
    for (let i = 2; i < 8; i++) await raider(i, MID.x - 26 + i, MID.z - 18 - (i % 2) * 2);
    const clearGap = () =>
      page.evaluate(() => {
        for (const e of window.__game.world.entities.values()) {
          const st = e.smithHeartFight;
          if (!st) continue;
          st.lastFloorAt = null;
          break;
        }
      });
    // Where the cursed pillar will rise: the sim's own pick (council_rush.ts
    // raiseCursed, the golden angle off the fight's cast count, which the
    // bar's start raises by one), with no pillar in the way.
    const casts = (await state())?.casts ?? 0;
    const ang = (casts + 1) * 2.39996;
    const cursedAt = [MID.x + Math.sin(ang) * 15, MID.z + Math.cos(ang) * 15];
    // The Guardian across the middle from it, its tank behind it.
    const ux = Math.sin(ang);
    const uz = Math.cos(ang);
    const g = [cursedAt[0] - ux * 24, cursedAt[1] - uz * 24];
    await raider(0, g[0] - ux * 2.5, g[1] - uz * 2.5);
    await member('heart_hammer_guardian', g[0], g[1], 0);
    await sleep(700);
    await member('heart_hammer_guardian', g[0], g[1], 0);
    await clearGap();
    await chat('/dev heart council rush', 200);
    // The Singer back to her own tank far off (no bond in the shot).
    await raider(1, MID.x - 31, MID.z + 27);
    await member('heart_seam_singer', MID.x - 30, MID.z + 26, 1);
    const target = await page.evaluate(() => {
      for (const e of window.__game.world.entities.values())
        if (e.templateId === 'heart_hammer_guardian' && !e.dead) return e.castTargetId;
      return null;
    });
    if (target === null) {
      console.log('rush: no bar');
      return;
    }
    await page.evaluate(
      ([ox, oz, id, x, z]) => {
        const w = window.__game.world;
        const e = w.entities.get(id);
        if (!e) return;
        const p = w.ctx.groundPos(ox + x, oz + z);
        e.pos = { ...p };
        e.prevPos = { ...p };
        w.ctx.rebucket(e);
      },
      [O.x, O.z, target, cursedAt[0] + ux * 6, cursedAt[1] + uz * 6],
    );
    // The camera off the line's side, looking across it at its middle.
    const mid = [(g[0] + cursedAt[0]) / 2, (g[1] + cursedAt[1]) / 2];
    const side = [-uz, ux];
    const cam = process.env.SHOT_RUSH_CAM ?? 'side';
    // 'mark': close on the marked player beyond the cursed pillar (the Rush's arrow).
    const marked = [cursedAt[0] + ux * 6, cursedAt[1] + uz * 6];
    if (cam === 'side')
      await place([mid[0] + side[0] * 12, mid[1] + side[1] * 12], mid, 0.0, 0.92, 26);
    else if (cam === 'mark')
      await place(
        [marked[0] - ux * 6 + side[0] * 9, marked[1] - uz * 6 + side[1] * 9],
        marked,
        0.0,
        0.5,
        17,
      );
    else await place([g[0] - ux * 8, g[1] - uz * 8], cursedAt, 0.0, 0.42, 16);
    const until = Date.now() + 9000;
    while (Date.now() < until) {
      const st = await state();
      if (st && ready(st)) {
        break;
      }
      await sleep(15);
    }
    if (after) await sleep(after);
  };

  const scenes = {
    // The three on the Quarry floor among the five columns.
    async '01_consejo'() {
      await reset();
      await place([-16, -177], [8, -170], 0.15, 0.22, 17);
      await sleep(5000);
    },
    // A Wrath with the raid hiding behind the pillars (one caught out).
    async '02_ira'() {
      await reset();
      await pull();
      for (let i = 1; i < 8; i++) {
        const [x, z] = i === 7 ? [MID.x - 16, MID.z + 6] : col(i % 5, 5 + (i > 5 ? 2.5 : 0));
        await raider(i, x, z);
      }
      await place([MID.x - 30, MID.z - 18], [MID.x, MID.z], 0.1, 0.62, 40);
      await sleep(1200);
      await chat('/dev heart council wrath', 0);
      await sleep(2600);
    },
    // Wake the Stone: a pillar bursting out of the floor under its player.
    async '03_despertar'() {
      await reset();
      await pull();
      await raider(1, MID.x - 14, MID.z + 10);
      await raider(2, MID.x - 6, MID.z - 15);
      for (let i = 3; i < 8; i++) await raider(i, MID.x + 14 + i, MID.z + 18);
      await place([MID.x - 26, MID.z + 4], [MID.x - 10, MID.z], -0.1, 0.24, 20);
      await chat('/dev heart council wake', 0);
      await sleep(1200 + 5000 + 230);
    },
    // Resonance's spread: the danger ring round its carrier, its shimmer.
    async '04_resonancia'() {
      await reset();
      await pull();
      for (let i = 1; i < 8; i++) await raider(i, MID.x - 10 - i, MID.z - 6 + i);
      await chat('/dev heart council resonance 1', 200);
      const st = await state();
      const pid = st?.resonance?.[0]?.playerId;
      const [x, z] = col(2, -4.5);
      await page.evaluate(
        ([ox, oz, pid, x, z]) => {
          const w = window.__game.world;
          const e = w.entities.get(pid);
          if (!e) return;
          const g = w.ctx.groundPos(ox + x, oz + z);
          e.pos = { ...g };
          e.prevPos = { ...g };
          w.ctx.rebucket(e);
        },
        [O.x, O.z, pid, x, z],
      );
      // From the Quarry's middle side (the council behind the camera).
      await place(col(2, -11), col(2, 0), 0.0, 0.42, 9);
      await sleep(2400);
    },
    // A Falling Rock: the soak with three under it, the boulder dropping.
    async '05_roca'() {
      await reset();
      await pull();
      for (let i = 1; i < 8; i++) await raider(i, MID.x - 12 - i * 0.3, MID.z + 12);
      await chat('/dev heart council rock', 1500);
      const st = await state();
      const pid = st?.rock?.playerId;
      const at = [MID.x - 14, MID.z + 12];
      await page.evaluate(
        ([ox, oz, pid, x, z, raid]) => {
          const w = window.__game.world;
          const ids = [pid, ...raid.slice(1, 4)];
          ids.forEach((id, k) => {
            const e = w.entities.get(id);
            if (!e) return;
            const g = w.ctx.groundPos(ox + x + (k % 2) * 1.6 - 0.8, oz + z + (k > 1 ? 1.4 : -0.6));
            e.pos = { ...g };
            e.prevPos = { ...g };
            w.ctx.rebucket(e);
          });
        },
        [O.x, O.z, pid, at[0], at[1], await page.evaluate(() => window.__raid)],
      );
      await place([at[0] - 12, at[1] - 4], at, 0.05, 0.34, 14);
      // Shoot as the boulder drops into the soak.
      const until = Date.now() + 8000;
      while (Date.now() < until) {
        const s2 = await state();
        if (!s2?.rock || s2.rock.remaining < 0.2) break;
        await sleep(25);
      }
    },
    // The stone remembers: the Seam Singer falls and its light flows on.
    async '06_herencia'() {
      await reset();
      await pull();
      for (let i = 1; i < 8; i++) await raider(i, MID.x - 12 - i, MID.z - 12 + i);
      await place([MID.x - 22, MID.z + 2], [MID.x, MID.z - 4], 0.0, 0.32, 18);
      await sleep(800);
      // The Singer a few strides from the Guardian, so its light arcs to it.
      await page.evaluate(
        ([ox, oz, x, z]) => {
          const w = window.__game.world;
          for (const e of w.entities.values()) {
            if (e.templateId !== 'heart_seam_singer' || e.dead) continue;
            const g = w.ctx.groundPos(ox + x, oz + z);
            e.pos = { ...g };
            e.prevPos = { ...g };
            w.ctx.rebucket(e);
          }
        },
        [O.x, O.z, MID.x - 2, MID.z - 15],
      );
      await chat('/dev heart kill singer', 0);
      await sleep(1000);
    },
    // Mythic (SHOT_MYTHIC=1): Soul in the Stone. The soul flowing into its
    // pillar, the Echo of Wrath with the raid hiding, the Endless Song grown
    // loud.
    async m1_alma() {
      await reset();
      await pull();
      for (let i = 1; i < 8; i++) await raider(i, MID.x - 12 - i, MID.z - 10 + i);
      await page.evaluate(
        ([ox, oz, x, z]) => {
          const w = window.__game.world;
          for (const e of w.entities.values()) {
            if (e.templateId !== 'heart_hammer_guardian' || e.dead) continue;
            const g = w.ctx.groundPos(ox + x, oz + z);
            e.pos = { ...g };
            e.prevPos = { ...g };
            w.ctx.rebucket(e);
          }
        },
        [O.x, O.z, MID.x - 4, MID.z + 8],
      );
      await place([MID.x - 24, MID.z + 4], [MID.x + 2, MID.z + 14], 0.0, 0.3, 22);
      await sleep(900);
      await chat('/dev heart kill guardian', 0);
      await sleep(1250);
    },
    async m2_eco() {
      await reset();
      await pull();
      await chat('/dev heart council soul guardian', 400);
      const at = await soulAt();
      if (at) {
        // The raid hides behind the columns away from the soul pillar; one
        // stands caught out in the open.
        for (let i = 1; i < 8; i++) {
          const k = [1, 4, 1, 4, 2, 3, 1][i - 1];
          const deg = [20, 92, 164, 236, 308][k];
          const a = (deg * Math.PI) / 180;
          const cx = MID.x + Math.sin(a) * 24;
          const cz = MID.z + Math.cos(a) * 24;
          const d = Math.hypot(cx - at[0], cz - at[1]);
          const out = i === 7 ? -12 : 4 + (i % 3) * 1.1;
          await raider(i, cx + ((cx - at[0]) / d) * out, cz + ((cz - at[1]) / d) * out);
        }
        if (process.env.SHOT_TOP === '1') await aimAt(at, 20, 0.0, 1.25, 55, 0);
        else await aimAt(at, 16, 0.0, 0.95, 46, 0.55);
      }
      await setSoul({ timer: 0.05 });
      await sleep(2300);
    },
    async m4_canto() {
      await reset();
      await pull();
      for (let i = 1; i < 8; i++) await raider(i, MID.x - 12 - i, MID.z - 10 + i);
      await chat('/dev heart council soul singer', 400);
      await setSoul({ pulses: 14 });
      const at = await soulAt();
      if (at) await aimAt(at, 14, 0.0, 0.9, 40, 0.4);
      // Shoot just after a pulse leaves the stone.
      const until = Date.now() + 9000;
      let last = null;
      while (Date.now() < until) {
        const s2 = await state();
        const t = s2?.souls?.[0]?.timer;
        if (last !== null && t > last + 1) break;
        last = t ?? last;
        await sleep(30);
      }
      await sleep(380);
    },
    // Polish (SHOT_MYTHIC=1 for the soul ones): the Echo's safe shadows from a
    // player's own camera at ground level, the Falling Rock's countdown, the council's nameplates round a shared tank.
    async p1_eco_suelo() {
      await reset();
      await pull();
      await chat('/dev heart council soul guardian', 400);
      const at = await soulAt();
      if (at) {
        // Two raiders behind column 1 (one at the edge of its shadow), one
        // in the open; the camera behind a hidden raider, low.
        const deg = 92;
        const a = (deg * Math.PI) / 180;
        const cx = MID.x + Math.sin(a) * 24;
        const cz = MID.z + Math.cos(a) * 24;
        const d = Math.hypot(cx - at[0], cz - at[1]);
        const ux = (cx - at[0]) / d;
        const uz = (cz - at[1]) / d;
        await raider(1, cx + ux * 5, cz + uz * 5);
        await raider(2, cx + ux * 8 - uz * 1.6, cz + uz * 8 + ux * 1.6);
        await raider(3, cx + ux * 6 + uz * 6, cz + uz * 6 - ux * 6);
        for (let i = 4; i < 8; i++) await raider(i, MID.x - 20 - i, MID.z - 12);
        await place([cx + ux * 14 + uz * 3, cz + uz * 14 - ux * 3], [cx, cz], 0.0, 0.28, 9);
      }
      await setSoul({ timer: 0.05 });
      await sleep(2300);
    },
    async p2_ira_suelo() {
      await reset();
      await pull();
      // The Guardian at the middle; raiders tucked behind column 2.
      const deg = 164;
      const a = (deg * Math.PI) / 180;
      const cx = MID.x + Math.sin(a) * 24;
      const cz = MID.z + Math.cos(a) * 24;
      const d = Math.hypot(cx - MID.x, cz - MID.z);
      const ux = (cx - MID.x) / d;
      const uz = (cz - MID.z) / d;
      await raider(1, cx + ux * 5, cz + uz * 5);
      await raider(2, cx + ux * 7 + uz * 1.5, cz + uz * 7 - ux * 1.5);
      await raider(3, cx + ux * 6 - uz * 6.5, cz + uz * 6 + ux * 6.5);
      for (let i = 4; i < 8; i++) await raider(i, MID.x + 18, MID.z - 14 + i);
      await place([cx + ux * 8 - uz * 2, cz + uz * 8 + ux * 2], [cx, cz], 0.0, 0.32, 8);
      await sleep(900);
      await chat('/dev heart council wrath', 0);
      await sleep(2400);
    },
    async p4_roca() {
      await reset();
      await pull();
      for (let i = 1; i < 8; i++) await raider(i, MID.x - 12 - i * 0.3, MID.z + 12);
      await chat('/dev heart council rock', 1500);
      const st = await state();
      const pid = st?.rock?.playerId;
      const at = [MID.x - 2, MID.z - 12];
      await page.evaluate(
        ([ox, oz, pid, x, z, raid]) => {
          const w = window.__game.world;
          const ids = [pid, ...raid.slice(1, 4)];
          ids.forEach((id, k) => {
            const e = w.entities.get(id);
            if (!e) return;
            const g = w.ctx.groundPos(ox + x + (k % 2) * 1.6 - 0.8, oz + z + (k > 1 ? 1.4 : -0.6));
            e.pos = { ...g };
            e.prevPos = { ...g };
            w.ctx.rebucket(e);
          });
        },
        [O.x, O.z, pid, at[0], at[1], await page.evaluate(() => window.__raid)],
      );
      await place([at[0] - 13, at[1] - 9], at, 0.0, 0.5, 19);
      // Mid-countdown: about two of its five seconds gone.
      const until = Date.now() + 8000;
      while (Date.now() < until) {
        const s2 = await state();
        if (!s2?.rock || s2.rock.remaining < 2.6) break;
        await sleep(25);
      }
    },
    async p5_placas() {
      await reset();
      await pull();
      // The three on the one tank, side by side, the Singer casting.
      await page.evaluate(
        ([ox, oz, x, z]) => {
          const w = window.__game.world;
          let k = 0;
          for (const e of w.entities.values()) {
            if (!/^heart_(hammer_guardian|seam_singer)$/.test(e.templateId) || e.dead) continue;
            const g = w.ctx.groundPos(ox + x + (k - 1) * 3.2, oz + z + (k % 2) * 1.5);
            e.pos = { ...g };
            e.prevPos = { ...g };
            w.ctx.rebucket(e);
            k++;
          }
        },
        [O.x, O.z, MID.x + 2, MID.z],
      );
      for (let i = 1; i < 8; i++) await raider(i, MID.x - 10 - i, MID.z - 6 + i);
      // After the pull's lines (their bubbles gone).
      await place([MID.x + 2, MID.z - 20], [MID.x + 2, MID.z], 0.0, 0.3, 20);
      await sleep(13000);
    },
    // Bond of the Stone (consejo_flojos): the two close together, then
    // apart inside the reach, then out of it (no tether).
    async b1_vinculo_juntos() {
      await reset();
      await pull();
      await raider(0, MID.x - 3, MID.z + 1);
      await raider(1, MID.x + 3, MID.z - 1);
      await member('heart_hammer_guardian', MID.x - 2.5, MID.z + 1, 0);
      await member('heart_seam_singer', MID.x + 3, MID.z - 2, 1);
      for (let i = 2; i < 8; i++) await raider(i, MID.x - 14 - i, MID.z + 10 + (i % 3) * 2);
      await place([MID.x - 8, MID.z - 9], [MID.x, MID.z], 0.0, 0.78, 26);
      await sleep(4200);
    },
    async b2_vinculo_lejos() {
      await reset();
      await pull();
      await raider(0, MID.x - 9, MID.z + 2);
      await raider(1, MID.x + 9, MID.z - 2);
      await member('heart_hammer_guardian', MID.x - 8, MID.z + 2, 0);
      await member('heart_seam_singer', MID.x + 8, MID.z - 2, 1);
      for (let i = 2; i < 8; i++) await raider(i, MID.x - 18 - i, MID.z + 14 + (i % 3) * 2);
      await place([MID.x - 2, MID.z - 12], [MID.x, MID.z], 0.0, 0.9, 32);
      await sleep(4200);
    },
    async b3_vinculo_roto() {
      await reset();
      await pull();
      await raider(0, MID.x - 14, MID.z + 2);
      await raider(1, MID.x + 14, MID.z - 2);
      await member('heart_hammer_guardian', MID.x - 13, MID.z + 2, 0);
      await member('heart_seam_singer', MID.x + 13, MID.z - 2, 1);
      for (let i = 2; i < 8; i++) await raider(i, MID.x - 18 - i, MID.z + 14 + (i % 3) * 2);
      await place([MID.x - 2, MID.z - 12], [MID.x, MID.z], 0.0, 0.9, 32);
      await sleep(4200);
    },
    // Mountain's Rush (consejo_flojos): the wind-up, the run, the stop on the
    // cursed pillar. The Singer parked far off (no bond), the raid aside.
    // The mark's bar running: the red arrow over the marked player (noche 1112).
    async c0_flecha_marca() {
      await rushScene((st) => !!st.bars?.guardian, 1800);
    },
    async c1_carga_preparacion() {
      await rushScene((st) => st.rush && st.rush.windup > 0 && st.rush.windup < 0.45);
    },
    async c2_carga_rastro() {
      await rushScene((st) => st.rush && st.rush.windup === 0 && st.rush.remaining < 0.55);
    },
    async c3_carga_impacto() {
      let seen = false;
      await rushScene((st) => {
        if (st.rush) seen = true;
        return seen && !st.rush;
      }, 90);
    },
    // Mountain's Wrath on the bare floor after the columns have fallen: the
    // reworded warning, a clear view of the rubble (07's replacement).
    async w1_aviso_columnas() {
      await reset();
      await pull();
      await member('heart_hammer_guardian', MID.x + 4, MID.z + 6, 0);
      await raider(0, MID.x + 2, MID.z + 4);
      for (let i = 1; i < 8; i++) {
        const [x, z] = col(i % 5, 5 + (i > 5 ? 2.5 : 0));
        await raider(i, x, z);
      }
      await place([MID.x - 8, MID.z - 10], [MID.x, MID.z], 0.0, 0.95, 30);
      await sleep(900);
      await park();
      await chat('/dev heart council wrath', 0);
      // Past the landing: the Song it queues parked too.
      await sleep(4150);
      await park();
      await sleep(2200);
    },
    async w2_ira_despues() {
      await reset();
      await pull();
      await member('heart_hammer_guardian', MID.x + 4, MID.z + 6, 0);
      await raider(0, MID.x + 2, MID.z + 4);
      for (let i = 1; i < 8; i++) {
        const [x, z] = col(i % 5, 5 + (i > 5 ? 2.5 : 0));
        await raider(i, x, z);
      }
      await place([MID.x - 2, MID.z - 12], [MID.x, MID.z], 0.0, 1.08, 38);
      await sleep(900);
      await park();
      await chat('/dev heart council wrath', 0);
      await sleep(4150);
      await park();
      await sleep(3200);
    },
    // Review only (never delivered): the two bodies close, the energy, the
    // Weight and a bolt.
    async r_cuerpos() {
      await reset();
      await place([MID.x - 9, MID.z + 3], [MID.x + 3, MID.z], 0.0, 0.12, 9);
      await sleep(3000);
    },
    async r_energia() {
      await reset();
      await pull();
      for (let i = 1; i < 8; i++) await raider(i, MID.x - 12 - i, MID.z - 12 + i);
      await chat('/dev heart council energy 92', 300);
      await place([MID.x - 16, MID.z + 6], [MID.x, MID.z], 0.0, 0.2, 14);
      await sleep(1500);
    },
    async r_peso() {
      await reset();
      await pull();
      await chat('/dev heart council weight', 0);
      await place([MID.x - 16, MID.z + 6], [MID.x - 4, MID.z], 0.0, 0.2, 12);
      await sleep(1500 + 1200);
    },
    async r_rayo() {
      await reset();
      await pull();
      for (let i = 1; i < 8; i++) await raider(i, MID.x - 12 - i, MID.z - 12 + i);
      await chat('/dev heart council bolt', 0);
      await place([MID.x - 16, MID.z - 12], [MID.x, MID.z], 0.0, 0.2, 14);
      await sleep(2050);
    },
  };
  for (const [name, run] of Object.entries(scenes)) {
    if (!ONLY && name.startsWith('r_')) continue;
    if (!ONLY && (process.env.SHOT_MYTHIC === '1') !== /^m\d/.test(name)) continue;
    if (ONLY && !ONLY.has(name)) continue;
    await run();
    await shoot(name);
  }
} finally {
  await browser.close();
}
