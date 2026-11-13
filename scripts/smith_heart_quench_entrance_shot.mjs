// Evidence captures for the Guardian of the Quench's entrance, "Under the
// ice" (docs/design/raid/smith_heart.md section 7.3, "The entrance";
// src/render/smith_heart_fx/quench_entrance_core.ts): a fresh claim's
// guardian lying frozen under the lake, then a raider stepping onto the ice
// wakes her and the scene is filmed (a CDP screencast at the page's own
// pace) from the raid's side of the lake, with a few dev-only stand-in
// raiders on the ice for scale and for her blades to point at. Writes the
// frames, a still per beat and an mp4 with the scene's sound laid on its
// beats (the voiced line and the scene's own samples: a headless page plays
// no audio). Evidence tooling, not a repo test. Needs a dev Vite serving the
// worktree (ALLOW_DEV_COMMANDS is implied offline).
//
//   node scripts/smith_heart_quench_entrance_shot.mjs <outDir>
//
// Env: SHOT_URL (http://127.0.0.1:5223/), SHOT_W / SHOT_H (1600x900),
// SHOT_PRESET (4), SHOT_SECONDS (16), SHOT_VIEW (raid | high | side | close),
// SHOT_STILLS (1: write one still per beat).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5223/';
const OUT = process.argv[2] ?? path.join('tmp', 'smith_heart_quench_entrance');
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const SECONDS = Number(process.env.SHOT_SECONDS ?? 16);
const VIEW = process.env.SHOT_VIEW ?? 'raid';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The scene's beats and sounds, straight off the core the page runs. */
async function loadCore() {
  const build = await esbuild.build({
    stdin: {
      contents:
        "export { QUENCH_ENTRANCE, QUENCH_ENTRANCE_SOUNDS, QUENCH_EMERGE_CLIP } from './src/render/smith_heart_fx/quench_entrance_core.ts';" +
        "export { QUENCH_INTRO } from './src/sim/encounters/smith_heart/quench_intro_plan.ts';",
      resolveDir: process.cwd(),
      sourcefile: 'quench-entrance-shot-entry.ts',
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
const QE = core.QUENCH_ENTRANCE;

/** The guardian (the lake's middle) and where the raid waits on the shelf,
 *  then steps onto the ice (instance-local). */
const BOSS = { x: 198, z: -2 };
const ICE = { x: 194, z: -22 };
/** Camera holds per view: [yaw off the player's facing, pitch (positive
 *  looks down), distance]. */
const VIEWS = {
  raid: [0.18, 0.42, 15],
  high: [0.2, 0.7, 30],
  side: [1.1, 0.24, 20],
  close: [0.4, 0.2, 9],
};
/** The scene's beats for the stills (seconds from the wake; the core's
 *  QUENCH_ENTRANCE, read back from the page below). */
const STILLS = [
  ['1_dormida_bajo_el_hielo', 'dormant'],
  ['2_abre_los_ojos', 'eyes'],
  ['3_grietas_y_escarcha', 'web'],
  ['4_la_tension_bajo_el_hielo', 'gather'],
  ['5_rompe_el_hielo', 'breach'],
  ['6_se_alza', 'rise'],
  ['7_las_espadas_se_alzan', 'blades'],
  ['8_las_espadas_apuntan', 'point'],
];

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
    charName: 'Lakewitness',
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
  await chat('/dev heart tp ice', 4000);
  await page.waitForFunction(
    () => {
      let found = false;
      window.__game.renderer.scene.traverse((o) => {
        if (o.name === 'smith-heart-quench-entrance') found = true;
      });
      return found;
    },
    { timeout: 180000, polling: 1000 },
  );
  await page.addStyleTag({ content: '#ui { display: none !important; }' });
  // The slot's origin from where the ice sheet's anchor set us down.
  const O = await page.evaluate(() => {
    const p = window.__game.world.player;
    return { x: p.pos.x - 156, z: p.pos.z - -86 };
  });
  console.log('origin', O);
  // Stand on the shelf (out of her reach), the raid round us, the camera held.
  const [yaw, pitch, dist] = VIEWS[VIEW] ?? VIEWS.raid;
  await page.evaluate(
    ([ox, oz, sx, sz, bx, bz, yaw, pitch, dist]) => {
      const w = window.__game.world;
      const p = w.player;
      const put = (e, x, z) => {
        const g = w.ctx.groundPos(ox + x, oz + z);
        e.pos = { ...g };
        e.prevPos = { ...g };
        e.facing = Math.atan2(bx - x, bz - z);
        e.prevFacing = e.facing;
        w.ctx.rebucket(e);
      };
      put(p, sx, sz);
      // A ghost wakes nothing (quench_intro.ts): the witness stands on the
      // ice to film her frozen, then steps in as a living raider.
      p.ghost = true;
      const input = window.__game.input;
      const hold = () => {
        input.zoomMax = Math.max(input.zoomMax, dist);
        input.camYaw = p.facing + yaw;
        input.camPitch = pitch;
        input.camDist = dist;
        requestAnimationFrame(hold);
      };
      requestAnimationFrame(hold);
    },
    [O.x, O.z, ICE.x, ICE.z, BOSS.x, BOSS.z, yaw, pitch, dist],
  );
  await sleep(1500);
  await page.waitForFunction(
    () => !document.querySelector('#loading-screen')?.classList.contains('visible'),
    { timeout: 240000, polling: 500 },
  );
  await sleep(Number(process.env.SHOT_SETTLE ?? 6000));
  fs.mkdirSync(OUT, { recursive: true });
  const B = {
    dormant: 0.04,
    eyes: QE.eyesAt + 0.3,
    web: QE.webAt + 1.4,
    gather: QE.breachAt - 0.5,
    breach: QE.breachAt + 0.12,
    rise: QE.breachAt + core.QUENCH_EMERGE_CLIP.stood * 0.6,
    blades: QE.bladesAt + 1.1,
    point: QE.pointAt + 0.45,
  };
  // SHOT_LOOK=1: only the frozen guardian, from every view (a quick look).
  if (process.env.SHOT_LOOK === '1') {
    for (const [name, [vy, vp, vd]] of Object.entries(VIEWS)) {
      await page.evaluate(
        ([vy, vp, vd]) => {
          const p = window.__game.world.player;
          const input = window.__game.input;
          const hold = () => {
            input.zoomMax = Math.max(input.zoomMax, vd);
            input.camYaw = p.facing + vy;
            input.camPitch = vp;
            input.camDist = vd;
            requestAnimationFrame(hold);
          };
          requestAnimationFrame(hold);
        },
        [vy, vp, vd],
      );
      await sleep(1200);
      fs.writeFileSync(path.join(OUT, `look_${name}.png`), await page.screenshot());
      // And her, close: a crop round where she lies on screen.
      const box = await page.evaluate(() => {
        const g = window.__game;
        for (const e of g.world.entities.values()) {
          if (e.templateId !== 'heart_quench_guardian') continue;
          const v = { x: e.pos.x, y: e.pos.y + 1, z: e.pos.z };
          const cam = g.renderer.camera;
          const p = new cam.position.constructor(v.x, v.y, v.z).project(cam);
          return { x: (p.x * 0.5 + 0.5) * innerWidth, y: (1 - (p.y * 0.5 + 0.5)) * innerHeight };
        }
        return null;
      });
      if (box) {
        const cw = 560;
        const ch = 315;
        const clip = {
          x: Math.max(0, Math.min(W - cw, box.x - cw / 2)),
          y: Math.max(0, Math.min(H - ch, box.y - ch / 2)),
          width: cw,
          height: ch,
        };
        fs.writeFileSync(path.join(OUT, `look_${name}_her.png`), await page.screenshot({ clip }));
      }
    }
    await browser.close();
    process.exit(0);
  }
  // The screencast: every frame the page paints, with its own timestamp.
  const cdp = await page.createCDPSession();
  // The screencast films the window, not the emulated viewport: size it.
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
  await sleep(700);
  // A raider steps onto the ice: she wakes.
  await page.evaluate(
    ([ox, oz, ix, iz, bx, bz]) => {
      const w = window.__game.world;
      const move = (e, x, z) => {
        const g = w.ctx.groundPos(ox + x, oz + z);
        e.pos = { ...g };
        e.prevPos = { ...g };
        e.facing = Math.atan2(bx - x, bz - z);
        e.prevFacing = e.facing;
        w.ctx.rebucket(e);
      };
      w.player.ghost = false;
      ['paladin', 'mage', 'priest', 'rogue', 'hunter'].forEach((c, i) => {
        const id = w.addPlayer(c, `Raider${i + 1}`);
        const e = w.entities.get(id);
        e.devGod = true;
        move(e, ix + (i - 2) * 3.4, iz - 3 - (i % 2) * 2.2);
      });
    },
    [O.x, O.z, ICE.x, ICE.z, BOSS.x, BOSS.z],
  );
  // The moment the scene starts (the aura flips to waking).
  let t0 = 0;
  for (let i = 0; i < 100 && !t0; i++) {
    const waking = await page.evaluate(() => {
      for (const e of window.__game.world.entities.values()) {
        if (e.templateId !== 'heart_quench_guardian') continue;
        return e.auras.some((a) => a.id === 'heart_quench_intro' && Math.round(a.value) === 1);
      }
      return false;
    });
    if (waking) t0 = Date.now() / 1000;
    else await sleep(40);
  }
  console.log('scene start', t0);
  await sleep(SECONDS * 1000);
  await cdp.send('Page.stopScreencast');
  console.log('frames', frames.length);
  const dir = path.join(OUT, `frames_${VIEW}`);
  fs.mkdirSync(dir, { recursive: true });
  const files = frames.map((f, i) => {
    const file = path.join(dir, `f_${String(i).padStart(4, '0')}.jpg`);
    fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
    return { file, t: f.t - t0 };
  });
  // One still per beat: the frame nearest it.
  if (process.env.SHOT_STILLS !== '0') {
    for (const [name, key] of STILLS) {
      const at = B[key];
      let best = files[0];
      for (const f of files) if (Math.abs(f.t - at) < Math.abs(best.t - at)) best = f;
      if (best) fs.copyFileSync(best.file, path.join(OUT, `${name}_${VIEW}.jpg`));
    }
  }
  const require = createRequire(import.meta.url);
  const ffmpeg = require('ffmpeg-static');
  const list = path.join(OUT, `frames_${VIEW}.txt`);
  const lines = [];
  const start = files.findIndex((f) => f.t >= -0.6);
  const use = files.slice(Math.max(0, start));
  for (let i = 0; i < use.length; i++) {
    const d = i + 1 < use.length ? use[i + 1].t - use[i].t : 0.05;
    lines.push(`file '${path.resolve(use[i].file).replace(/\\/g, '/')}'`, `duration ${d}`);
  }
  lines.push(`file '${path.resolve(use[use.length - 1].file).replace(/\\/g, '/')}'`);
  fs.writeFileSync(list, lines.join('\n'));
  const silent = path.join(OUT, `entrada_${VIEW}_sin_sonido.mp4`);
  execFileSync(ffmpeg, [
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    list,
    '-vf',
    'fps=30,format=yuv420p',
    '-c:v',
    'libx264',
    '-crf',
    '18',
    silent,
  ]);
  // The sound on its beats: the video starts `lead` before the wake.
  const lead = -(use[0]?.t ?? 0);
  const sounds = core.QUENCH_ENTRANCE_SOUNDS;
  const voice = path.resolve(
    'public/audio/voice/heart_quench_guardian/yell__hush_the_lake_was_sleeping_you_have_woken_the_cold_and_the_c.mp3',
  );
  const speakAt = core.QUENCH_INTRO.speakAt;
  const inputs = [['-i', voice]];
  const parts = [`[1:a]adelay=${Math.round((lead + speakAt) * 1000)}:all=1,volume=1.0[a0]`];
  sounds.forEach((s, i) => {
    inputs.push(['-i', path.resolve(`public/audio/sfx/${s.key}.mp3`)]);
    const ms = Math.round((lead + s.at) * 1000);
    parts.push(
      `[${i + 2}:a]asetrate=44100*${s.rate},aresample=44100,volume=${(s.gain * 0.7).toFixed(2)},adelay=${ms}:all=1[a${i + 1}]`,
    );
  });
  const mix = `${parts.join(';')};${parts.map((_, i) => `[a${i}]`).join('')}amix=inputs=${parts.length}:normalize=0,alimiter=limit=0.9[aout]`;
  const final = path.join(OUT, `entrada_${VIEW}.mp4`);
  execFileSync(ffmpeg, [
    '-y',
    '-i',
    silent,
    ...inputs.flat(),
    '-filter_complex',
    mix,
    '-map',
    '0:v',
    '-map',
    '[aout]',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    final,
  ]);
  console.log('VIDEO', final);
} finally {
  await browser.close();
}
