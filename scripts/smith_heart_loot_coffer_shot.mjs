// Evidence captures for the Smith's Heart loot moment (the forge coffer,
// src/render/smith_heart_fx/loot_coffer_core.ts): one guardian woken in its
// room, killed for real (`/dev heart kill <boss>`), given a dev purse
// (`/dev heart loot <boss>`: the raid's drops are not wired yet), then the
// coffer filmed from its front as the death scene resolves: the rise, the
// lock, the lid, the shaft, the wait; then the corpse is looted through the
// real path and the coffer shuts. Also checks that a pick through the
// coffer resolves to the corpse. Writes the frames, a still per beat and an
// mp4 (silent: a headless page plays no audio). Evidence tooling, not a
// repo test. Needs a dev Vite serving the worktree (ALLOW_DEV_COMMANDS is
// implied offline).
//
//   node scripts/smith_heart_loot_coffer_shot.mjs <council|singer|breath|quench|heat|final> <outDir>
//
// Env: SHOT_URL (http://127.0.0.1:5196/), SHOT_W / SHOT_H (1600x900),
// SHOT_PRESET (4), SHOT_VIEW (front | side | high), SHOT_FILM (1: film the
// rise and the shut; 0: stills of the waiting coffer only), SHOT_LOOT (1:
// loot it at the end).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const WHO = process.argv[2] ?? 'heat';
const OUT = process.argv[3] ?? path.join('tmp', `smith_heart_loot_${WHO}`);
const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5196/';
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const VIEW = process.env.SHOT_VIEW ?? 'front';
const FILM = process.env.SHOT_FILM !== '0';
const LOOT = process.env.SHOT_LOOT !== '0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Each guardian: its template, where to step in, how to wake it, the kill
 *  and loot names. */
const BOSSES = {
  council: {
    tid: 'heart_hammer_guardian',
    tp: 'gallery',
    wake: ['/dev heart council pull', '/dev heart council reset'],
    kill: 'guardian',
  },
  singer: {
    tid: 'heart_seam_singer',
    tp: 'gallery',
    wake: ['/dev heart council pull', '/dev heart council reset'],
    kill: 'singer',
  },
  breath: {
    tid: 'heart_breath_guardian',
    tp: 'breath',
    wake: ['/dev heart breath pull', '/dev heart breath reset'],
    kill: 'breath',
  },
  quench: {
    tid: 'heart_quench_guardian',
    tp: 'ice',
    wake: ['/dev heart quench pull', '/dev heart quench reset'],
    kill: 'quench',
  },
  heat: {
    tid: 'heart_heat_guardian',
    tp: 'heat',
    wake: ['/dev heart heat pull', '/dev heart heat reset'],
    kill: 'heat',
  },
  final: { tid: 'heart_masterless_strength', tp: 'final', wake: [], kill: 'final' },
};
const B = BOSSES[WHO];
if (!B) throw new Error(`unknown boss ${WHO}`);
/** Camera holds per view: [yaw off looking at the coffer's front, pitch
 *  (positive looks down), distance]. */
const VIEWS = {
  front: [0.35, 0.16, 11],
  side: [1.05, 0.12, 12],
  high: [0.45, 0.5, 20],
  raid: [0.15, 0.28, 26],
};

/** The coffer's plan, straight off the core the page runs. */
async function loadCore() {
  const build = await esbuild.build({
    stdin: {
      contents: "export * from './src/render/smith_heart_fx/loot_coffer_core.ts';",
      resolveDir: process.cwd(),
      sourcefile: 'loot-coffer-shot-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    logLevel: 'silent',
  });
  const url = `data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`;
  return import(url);
}
const core = await loadCore();
const boss = core.LOOT_COFFER_BOSSES[B.tid];
const R = core.LOOT_COFFER;

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
    charName: 'Lootwitness',
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
  await chat(`/dev heart tp ${B.tp}`, 4000);
  await page.waitForFunction(
    () => {
      let found = false;
      window.__game.renderer.scene.traverse((o) => {
        if (o.name === 'smith-heart-loot-coffer') found = true;
      });
      return found;
    },
    { timeout: 180000, polling: 1000 },
  );
  await page.addStyleTag({ content: '#ui { display: none !important; }' });
  for (const c of B.wake) await chat(c, 800);
  // The guardian, and a witness 18 yd in front of it (in the raid's claim,
  // in sight: the coffer follows a death it saw).
  const found = await page.evaluate((tid) => {
    const w = window.__game.world;
    for (const e of w.entities.values()) {
      if (e.kind === 'mob' && e.templateId === tid && !e.dead)
        return { id: e.id, x: e.pos.x, y: e.pos.y, z: e.pos.z, facing: e.facing };
    }
    return null;
  }, B.tid);
  if (!found) throw new Error(`no living ${B.tid}`);
  console.log('boss', found);
  await page.evaluate(
    ([bx, bz, f]) => {
      const w = window.__game.world;
      const p = w.player;
      const x = bx + Math.sin(f) * 18;
      const z = bz + Math.cos(f) * 18;
      const g = w.ctx.groundPos(x, z);

      p.pos = { ...g };
      p.prevPos = { ...g };
      p.facing = Math.atan2(bx - x, bz - z);
      p.prevFacing = p.facing;
      w.ctx.rebucket(p);
    },
    [found.x, found.z, found.facing],
  );
  await sleep(1500);
  await page.waitForFunction(
    () => !document.querySelector('#loading-screen')?.classList.contains('visible'),
    { timeout: 240000, polling: 500 },
  );
  await sleep(Number(process.env.SHOT_SETTLE ?? 5000));

  // The kill, the purse.
  await chat(`/dev heart kill ${B.kill}`, 300);
  await chat(`/dev heart loot ${B.kill}`, 300);
  const dead = await page.evaluate((id) => {
    const e = window.__game.world.entities.get(id);
    return (
      e && {
        dead: e.dead,
        lootable: e.lootable,
        loot: e.loot,
        x: e.pos.x,
        z: e.pos.z,
        facing: e.facing,
      }
    );
  }, found.id);
  console.log('corpse', dead);
  const spot = core.lootCofferSpot(B.tid, dead.x, dead.z, { x: 0, z: 0, yaw: 0 });
  // The witness stands on the coffer's spot, shrunk out of sight, looking
  // at its front: the camera hangs in front of the coffer, the husk behind.
  const [yaw, pitch, dist] = VIEWS[VIEW] ?? VIEWS.front;
  await page.evaluate(
    ([sx, sz, cy, yaw, pitch, dist]) => {
      const w = window.__game.world;
      const p = w.player;
      const g = w.ctx.groundPos(sx + Math.sin(cy) * 0.2, sz + Math.cos(cy) * 0.2);
      p.pos = { ...g };
      p.prevPos = { ...g };
      // The witness out of the shot: its body and its own nameplate.
      window.__game.renderer.showOwnNameplate = false;
      const hide = () => {
        const v = window.__game.renderer.views.get(p.id);
        if (v && !v.__lootHidden) {
          v.__lootHidden = true;
          Object.defineProperty(v.group, 'visible', { get: () => false, set: () => {} });
        }
        if (!v || !v.__lootHidden) requestAnimationFrame(hide);
      };
      hide();
      p.facing = cy + Math.PI;
      p.prevFacing = p.facing;
      w.ctx.rebucket(p);
      const input = window.__game.input;
      window.__lootCam = [yaw, pitch, dist];
      const hold = () => {
        const [cy2, cp, cd] = window.__lootCam;
        input.zoomMax = Math.max(input.zoomMax, cd);
        input.camYaw = p.facing + cy2;
        input.camPitch = cp;
        input.camDist = cd;
        requestAnimationFrame(hold);
      };
      requestAnimationFrame(hold);
    },
    [spot.x, spot.z, spot.yaw, yaw, pitch, dist],
  );
  const fxState = (id) =>
    page.evaluate((id) => {
      const fx = window.__game.renderer.riftDeathZoneVisuals?.lootCoffer;
      if (!fx) return null;
      const tr = fx.tracks.get(id);
      return { clock: fx.clock, deadAt: tr ? tr.deadAt : null, standing: fx.standing };
    }, id);
  // Wait for the scene to come within a beat of the rise.
  const t0 = Date.now();
  for (;;) {
    const s = await fxState(found.id);
    if (s && s.deadAt !== null && Number.isFinite(s.deadAt)) {
      if (s.clock >= s.deadAt + boss.revealAt - (FILM ? 1.0 : -R.end - 2.5)) break;
    } else if (s && s.deadAt === Number.NEGATIVE_INFINITY) {
      console.log('WARNING: the death was not seen live (no rise)');
      break;
    }
    if (Date.now() - t0 > 90000) throw new Error(`no coffer track: ${JSON.stringify(s)}`);
    await sleep(80);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const pickCheck = async () =>
    page.evaluate(
      ([sx, sz, id]) => {
        const g = window.__game;
        const cam = g.renderer.camera;
        const THREE_V = cam.position.constructor;
        const v = new THREE_V(sx, g.world.ctx.groundPos(sx, sz).y + 1.0, sz);
        v.project(cam);
        const vp = g.renderer.viewport;
        const x = (v.x * 0.5 + 0.5) * vp.width;
        const y = (-v.y * 0.5 + 0.5) * vp.height;
        const picked = g.renderer.picking.pickDirect(x, y);
        return { x, y, picked, corpse: id, ok: picked === id };
      },
      [spot.x, spot.z, found.id],
    );

  if (!FILM) {
    await sleep(1500);
    for (const v of Object.keys(VIEWS)) {
      const [yw, pt, ds] = VIEWS[v];
      await page.evaluate(
        (cam) => {
          window.__lootCam = cam;
        },
        [yw, pt, ds],
      );
      await sleep(900);
      await page.screenshot({
        path: path.join(OUT, `cofre_${WHO}_${v}.jpg`),
        type: 'jpeg',
        quality: 92,
      });
    }
    console.log('PICK', JSON.stringify(await pickCheck()));
    if (process.env.SHOT_DEBUG === '1') {
      // Which part draws what: each named part hidden in turn.
      for (const name of [
        'smithHeartLootInlays',
        'smithHeartLootFloor',
        'smithHeartLootLights',
        'smithHeartLootSparks',
        'smith-heart-loot-coffer',
      ]) {
        await page.evaluate((n) => {
          window.__game.renderer.scene.traverse((o) => {
            if (o.name === n) o.__keepHidden = true;
          });
          const hold = () => {
            window.__game.renderer.scene.traverse((o) => {
              if (o.__keepHidden) o.visible = false;
            });
            requestAnimationFrame(hold);
          };
          hold();
        }, name);
        await sleep(700);
        await page.screenshot({
          path: path.join(OUT, `debug_${WHO}_${name}.jpg`),
          type: 'jpeg',
          quality: 80,
        });
      }
    }
  } else {
    const cdp = await page.createCDPSession();
    try {
      const { windowId } = await cdp.send('Browser.getWindowForTarget');
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width: W, height: H } });
    } catch (e) {
      console.log('window bounds:', e.message);
    }
    const frames = [];
    cdp.on('Page.screencastFrame', async (f) => {
      frames.push({ data: f.data, t: f.metadata.timestamp });
      await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 90,
      maxWidth: W,
      maxHeight: H,
      everyNthFrame: 1,
    });
    const filmStart = Date.now() / 1000;
    // Mark the rise's start on the wall clock as the page sees it.
    let riseWall = null;
    const until = Date.now() + 1000 * (1.0 + R.end + 3.2);
    while (Date.now() < until) {
      const s = await fxState(found.id);
      if (riseWall === null && s && s.clock >= s.deadAt + boss.revealAt)
        riseWall = Date.now() / 1000;
      await sleep(60);
    }
    const pick = await pickCheck();
    console.log('PICK', JSON.stringify(pick));
    let lootWall = null;
    if (LOOT) {
      const looted = await page.evaluate((id) => {
        const w = window.__game.world;
        const ok = w.lootCorpse(id);
        const e = w.entities.get(id);
        return { ok, lootable: e?.lootable, loot: e?.loot ?? null };
      }, found.id);
      lootWall = Date.now() / 1000;
      console.log('LOOTED', JSON.stringify(looted));
      await sleep(2800);
    }
    await cdp.send('Page.stopScreencast');
    console.log('frames', frames.length);
    const dir = path.join(OUT, `frames_${WHO}_${VIEW}`);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const zero = riseWall ?? filmStart + 1;
    frames.sort((a, b) => a.t - b.t);
    const files = frames.map((f, i) => {
      const file = path.join(dir, `f_${String(i).padStart(4, '0')}.jpg`);
      fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
      return { file, t: f.t - zero };
    });
    const beats = [
      ['01_anillo_fundido', 0.3],
      ['02_sube_del_suelo', 0.85],
      ['03_encaja', R.lockAt + 0.05],
      ['04_se_abre_y_sale_la_luz', R.shaftAt + 0.3],
      ['05_espera', R.end + 0.8],
    ];
    if (lootWall !== null) beats.push(['06_saqueado_se_cierra', lootWall - zero + 1.6]);
    for (const [name, at] of beats) {
      let best = files[0];
      for (const f of files) if (Math.abs(f.t - at) < Math.abs(best.t - at)) best = f;
      if (best) fs.copyFileSync(best.file, path.join(OUT, `${WHO}_${name}_${VIEW}.jpg`));
    }
    const require = createRequire(import.meta.url);
    const ffmpeg = require('ffmpeg-static');
    const list = path.join(OUT, `frames_${WHO}_${VIEW}.txt`);
    const lines = [];
    for (let i = 0; i < files.length; i++) {
      const d = Math.max(0.001, i + 1 < files.length ? files[i + 1].t - files[i].t : 0.05);
      lines.push(`file '${path.resolve(files[i].file).replace(/\\/g, '/')}'`, `duration ${d}`);
    }
    lines.push(`file '${path.resolve(files[files.length - 1].file).replace(/\\/g, '/')}'`);
    fs.writeFileSync(list, lines.join('\n'));
    const video = path.join(OUT, `cofre_${WHO}_${VIEW}.mp4`);
    execFileSync(ffmpeg, [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      list,
      '-vf',
      'scale=1600:-2:flags=lanczos,fps=30,format=yuv420p',
      '-c:v',
      'libx264',
      '-crf',
      '18',
      video,
    ]);
    console.log('VIDEO', video);
  }
} finally {
  await browser.close();
}
