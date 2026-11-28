// Evidence captures for the Guardian of the Heat's Wheel of the Hearth (the
// polish pass of 2026-11-18; docs/design/raid/smith_heart.md section 7.4): a
// round's warning (molten cracks spreading through the doomed slices, the safe
// slice calm), its eruption (geysers, the flame sheet, embers, smoke) and the
// scorch fading, from a raid camera, a low camera over the floor (no
// z-fighting), straight above, and on the low graphics tier, plus a frame
// sequence for the video. Dev-only stand-in players stand on the shore.
// Evidence tooling, not a repo test. Needs a dev Vite serving the worktree.
//
//   node scripts/smith_heart_heat_wheel_shot.mjs <outDir>
//
// Env: SHOT_URL (http://127.0.0.1:5192/), SHOT_W / SHOT_H (1600x900),
// SHOT_PRESET (4), SHOT_ONLY (comma list of scene names), SHOT_FRAMES (frames a
// sequence takes, 0 for none), SHOT_TIER (normal | heroic), SHOT_PREFIX (a
// prefix for every file name, e.g. "antes_").
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5192/';
const OUT = process.argv[2] ?? path.join('tmp', 'smith_heart_heat_wheel');
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const ONLY = process.env.SHOT_ONLY ? new Set(process.env.SHOT_ONLY.split(',')) : null;
const FRAMES = Number(process.env.SHOT_FRAMES ?? 0);
const HEROIC = process.env.SHOT_TIER === 'heroic';
const PREFIX = process.env.SHOT_PREFIX ?? '';
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
  /** The Wheel's rounds on the guardian (state, seconds left, safe slice). */
  const rounds = () =>
    page.evaluate(() => {
      for (const e of window.__game.world.entities.values())
        if (e.smithHeartHeat)
          return e.smithHeartHeat.wheelRounds.map((r) => ({
            state: r.state,
            remaining: r.remaining,
            safe: r.safe,
          }));
      return [];
    });
  /** Wait until the first round is in `state` with at most `left` seconds to go. */
  const roundAt = async (state, left) => {
    for (let i = 0; i < 600; i++) {
      const rs = await rounds();
      const r = rs.find((x) => x.state === state);
      if (r && r.remaining <= left) return r;
      await sleep(20);
    }
    return null;
  };
  /** A fresh Wheel run on the tier, the guardian held still and quiet. */
  const wheel = async () => {
    await chat('/dev heart heat reset', 800);
    await chat(`/dev heart heat heroic ${HEROIC ? 'on' : 'off'}`, 300);
    await chat('/dev heart heat phase 1', 600);
    await page.evaluate(() => {
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
    await chat('/dev heart heat wheel', 50);
    let rs = await rounds();
    for (let i = 0; i < 50 && rs.length === 0; i++) {
      await sleep(20);
      rs = await rounds();
    }
    // The raid on the shore: most in the safe slice, a few still crossing.
    const safe = rs[0]?.safe ?? 0;
    const mids = [-22, 67, 112, 202].map((d) => (d * Math.PI) / 180);
    for (let i = 0; i < 8; i++) {
      const b = mids[i < 6 ? safe : (safe + 1 + i) % 4] + ((i % 3) - 1) * 0.12;
      const r = 15 + (i % 4) * 3;
      await raider(i, BOSS.x + Math.sin(b) * r, BOSS.z + Math.cos(b) * r);
    }
    return safe;
  };
  const shoot = async (name) => {
    const buf = await page.screenshot({ type: 'jpeg', quality: 90 });
    fs.mkdirSync(OUT, { recursive: true });
    const file = path.join(OUT, `${PREFIX}${name}.jpg`);
    fs.writeFileSync(file, buf);
    console.log('SHOT', file);
  };
  const sequence = async (name, n) => {
    const dir = path.join(OUT, `${PREFIX}${name}`);
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < n; i++) {
      const buf = await page.screenshot({ type: 'jpeg', quality: 85 });
      fs.writeFileSync(path.join(dir, `f${String(i).padStart(4, '0')}.jpg`), buf);
      await sleep(20);
    }
    console.log('SEQ', dir, n);
  };

  await place([-190, 0], [-220, 0], 0, 0.4, 20);
  await sleep(8000);
  const RAID_CAM = [[-188, 14], [-220, 0], 0, 0.55, 30];

  const scenes = {
    async w01_aviso() {
      await wheel();
      await place(...RAID_CAM);
      await roundAt('warn', HEROIC ? 2.4 : 3.4);
      await shoot('w01_aviso_temprano');
      await roundAt('warn', 0.5);
      await shoot('w02_aviso_final');
      await roundAt('burn', 1.4);
      await shoot('w03_erupcion');
      await roundAt('burn', 0.8);
      await shoot('w04_erupcion_llamas');
      await sleep(900);
      await shoot('w05_quemado_se_apaga');
    },
    async w06_baja() {
      await wheel();
      await place([-200, -6], [-220, 4], 0.3, 0.04, 6);
      await roundAt('warn', 0.6);
      await shoot('w06_camara_baja_aviso');
      await roundAt('burn', 1.2);
      await shoot('w07_camara_baja_erupcion');
    },
    async w08_cenital() {
      await wheel();
      await place([-205, 0], [-220, 0], 0, 1.35, 70);
      await roundAt('warn', 1.0);
      await shoot('w08_cenital_aviso');
      await roundAt('burn', 1.1);
      await shoot('w09_cenital_erupcion');
    },
    async v_rueda() {
      if (!FRAMES) return;
      await wheel();
      await place(...RAID_CAM);
      await sleep(200);
      await sequence('v_rueda', FRAMES);
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
