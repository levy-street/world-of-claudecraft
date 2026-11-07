// Evidence captures for the Smith's Heart raid's Hammer vein (phases 2B and
// 2C, docs/design/raid/smith_heart.md): the Cleft, the Gallery and its
// collapse spot, the Smith's Quarry from above and from the play camera with
// the guardian's Mountain's Wrath on its bar, the quarry's back wall close,
// the Ring with both stairs to the seal dais, and the Slab breaking.
// Evidence tooling, not a repo test. Needs a dev Vite serving the worktree
// (ALLOW_DEV_COMMANDS is implied offline).
//
//   node scripts/smith_heart_hammer_shot.mjs <outDir> [label]
//
// Env: SHOT_URL (http://127.0.0.1:5186/), SHOT_W / SHOT_H (1600x900),
// SHOT_PRESET (4), SHOT_ONLY (comma list of shot names), SHOT_JSON (a JSON
// list of ad-hoc shots in the SHOTS row format, replacing the list),
// SHOT_MOSAIC=1 (four shots to a 2x2 sheet at half size).
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5186/';
const OUT = process.argv[2] ?? path.join('tmp', 'smith_heart_hammer');
const LABEL = process.argv[3] ?? 'fase2c';
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const ONLY = process.env.SHOT_ONLY ? new Set(process.env.SHOT_ONLY.split(',')) : null;
const MOSAIC = process.env.SHOT_MOSAIC === '1';
// SHOT_GUARDIAN / SHOT_CAST: the guardian a 'wrath' or 'blast' shot pulls
// and the cast it waits for (phase 2G: the Breath guardian's casts).
const GUARDIAN = process.env.SHOT_GUARDIAN ?? 'heart_hammer_guardian';
const CAST = new RegExp(process.env.SHOT_CAST ?? 'wrath', 'i');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The instance-local entry (content/smith_heart_layout.ts SMITH_HEART_ANCHORS).
const ENTRY = { x: -196, z: -210 };

// [name, stand (instance-local x, z), look-at (x, z), camera yaw offset,
//  pitch, distance, action]. Actions: '' a still; 'wrath' pulls the Hammer
// guardian and shoots while Mountain's Wrath is on its bar; 'hammerfall'
// shoots just after a Hammerfall; 'slab' kills the guardian and shoots the
// Slab breaking `SHOT_SLAB_MS` after; 'alive' revives the guardian first;
// 'seq:<steps>' runs chat lines and waits ('c:/dev heart portal;w:1400');
// 'mesh:<name>' waits for a named effect mesh to show, then shoots;
// 'clock:<mesh>:<period>:<at>' waits for a cycled set piece's moment.
const SHOTS = [
  ['01_grieta', [-194, -208], [-213, -225], 0.0, 0.2, 15, ''],
  ['02_galeria', [-146, -224], [-96, -230], 0.2, 0.24, 18, ''],
  ['03_cantera_vista', [-30, -176], [40, -176], 0.0, 0.42, 40, ''],
  ['04_cantera_onda', [-20, -160], [8, -170], 0.25, 0.32, 14, 'wrath'],
  ['05_pared_fondo', [20, -190], [60, -205], 0.3, 0.02, 16, ''],
  ['06_anillo_escaleras', [0, 74], [0, 0], 0.0, 0.42, 36, ''],
  ['07_losa_rompe', [0, -146], [0, -124], 0.0, 0.2, 16, 'slab'],
];

const list = process.env.SHOT_JSON ? JSON.parse(process.env.SHOT_JSON) : SHOTS;

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [`--window-size=${W},${H}`, '--use-angle=d3d11', '--ignore-gpu-blocklist'],
  defaultViewport: { width: W, height: H },
  protocolTimeout: 240000,
});
const taken = [];
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
  for (const c of ['/dev level 20', '/dev god', '/dev noaggro', '/dev heart enter'])
    await chat(c, 1500);
  for (const p of ['h1', 'h2', 'h3']) await chat(`/dev heart kill pack ${p}`, 300);
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
  // The Hammer guardian's cast state (null when it is not casting).
  const guardianCast = () =>
    page.evaluate((guardian) => {
      const w = window.__game.world;
      for (const e of w.entities.values()) {
        if (e.templateId !== guardian || e.dead) continue;
        return e.castingAbility ? { id: e.castingAbility, left: e.castRemaining } : 'idle';
      }
      return null;
    }, GUARDIAN);
  let pulled = false;
  for (const [name, at, look, yaw, pitch, dist, action] of list) {
    if (ONLY && !ONLY.has(name)) continue;
    await place(at, look, yaw, pitch, dist);
    if (action === 'wrath' || action === 'blast') {
      // Pull the guardian (noaggro off, step into its reach), then stand
      // where the shot stands; it follows, plants and casts.
      if (!pulled) {
        pulled = true;
        await chat('/dev noaggro', 300);
        const g = await page.evaluate(
          ([ox, oz, guardian]) => {
            for (const e of window.__game.world.entities.values())
              if (e.templateId === guardian && !e.dead) return { x: e.pos.x - ox, z: e.pos.z - oz };
            return null;
          },
          [O.x, O.z, GUARDIAN],
        );
        if (g) await place([g.x - 8, g.z], [g.x, g.z], yaw, pitch, dist);
        await sleep(2500);
        await place(at, look, yaw, pitch, dist);
      }
      // Wait for Mountain's Wrath's bar, then shoot a moment into it (or,
      // for 'blast', just after it lands).
      const until = Date.now() + 70000;
      let seen = null;
      while (Date.now() < until) {
        seen = await guardianCast();
        if (seen && seen !== 'idle' && CAST.test(String(seen.id))) break;
        await sleep(100);
      }
      console.log('cast', JSON.stringify(seen));
      if (action === 'blast') {
        while (Date.now() < until) {
          const c = await guardianCast();
          if (!c || c === 'idle') break;
          await sleep(40);
        }
        await sleep(Number(process.env.SHOT_BLAST_MS ?? 260));
      } else {
        await sleep(Number(process.env.SHOT_WRATH_MS ?? 1800));
      }
      await place(at, look, yaw, pitch, dist);
    } else if (action.startsWith('mesh:')) {
      // Phase 2H: wait (up to SHOT_MESH_WAIT_MS) for a named effect mesh to
      // show (a guardian's swing ice, a creak), then shoot SHOT_MESH_MS in.
      const want = action.slice(5);
      const until = Date.now() + Number(process.env.SHOT_MESH_WAIT_MS ?? 40000);
      while (Date.now() < until) {
        const shown = await page.evaluate((name) => {
          let on = false;
          window.__game.renderer.scene.traverse((o) => {
            if (o.name === name && o.visible) on = true;
          });
          return on;
        }, want);
        if (shown) break;
        await sleep(40);
      }
      await sleep(Number(process.env.SHOT_MESH_MS ?? 120));
    } else if (action.startsWith('clock:')) {
      // Phase 2I: 'clock:<mesh>:<period>:<at>' waits (up to a period and a
      // half) until the shared clock a named mesh's material reads sits `at`
      // seconds into its `period` (a cycled set piece: the Heat's pour).
      const [, mesh, period, at] = action.split(':');
      const until = Date.now() + Number(period) * 1500 + 5000;
      while (Date.now() < until) {
        const since = await page.evaluate(
          ([name, per]) => {
            let t = null;
            window.__game.renderer.scene.traverse((o) => {
              if (o.name === name && o.material?.uniforms?.uTime)
                t = o.material.uniforms.uTime.value;
            });
            return t === null ? null : ((t % per) + per) % per;
          },
          [mesh, Number(period)],
        );
        if (since !== null && Math.abs(since - Number(at)) < 0.12) break;
        await sleep(30);
      }
    } else if (action.startsWith('seq:')) {
      // A scripted moment (phase 2F, the Ring): 'seq:' then steps split by
      // ';', each 'c:<chat line>' or 'w:<ms>' (the still is taken after).
      for (const step of action.slice(4).split(';')) {
        if (step.startsWith('c:')) await chat(step.slice(2), 0);
        else if (step.startsWith('w:')) await sleep(Number(step.slice(2)));
      }
      await place(at, look, yaw, pitch, dist);
    } else if (action === 'slab') {
      await sleep(5000);
      await chat('/dev heart kill hammer', 0);
      await sleep(Number(process.env.SHOT_SLAB_MS ?? 900));
    } else {
      await sleep(6000);
    }
    // SHOT_EVAL: an ad-hoc renderer tweak run right before each still (look
    // tuning only, never part of an evidence capture).
    if (process.env.SHOT_EVAL) {
      await page.evaluate(process.env.SHOT_EVAL);
      await sleep(400);
    }
    const where = await page.evaluate(() => {
      const p = window.__game.world.player;
      return `${p.pos.x.toFixed(1)} ${p.pos.y.toFixed(1)} ${p.pos.z.toFixed(1)}`;
    });
    console.log(name, 'at', where);
    const buf = await page.screenshot();
    if (MOSAIC) {
      taken.push({ name, buf });
    } else {
      fs.mkdirSync(OUT, { recursive: true });
      const file = path.join(OUT, `${name}_${LABEL}.png`);
      fs.writeFileSync(file, buf);
      console.log('SHOT', file);
    }
  }
} finally {
  await browser.close();
}
if (MOSAIC && taken.length) {
  fs.mkdirSync(OUT, { recursive: true });
  const hw = Math.round(W / 2);
  const hh = Math.round(H / 2);
  for (let s = 0; s < taken.length; s += 4) {
    const tiles = await Promise.all(
      taken.slice(s, s + 4).map(async (t, i) => ({
        input: await sharp(t.buf).resize(hw, hh).png().toBuffer(),
        left: (i % 2) * hw,
        top: Math.floor(i / 2) * hh,
      })),
    );
    const file = path.join(OUT, `mosaic_${s / 4 + 1}_${LABEL}.png`);
    await sharp({ create: { width: W, height: H, channels: 3, background: '#000' } })
      .composite(tiles)
      .png()
      .toFile(file);
    console.log(
      'MOSAIC',
      file,
      taken
        .slice(s, s + 4)
        .map((t) => t.name)
        .join(' '),
    );
  }
}
