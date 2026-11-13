// Evidence captures for the Guardian of the Breath's death, "The storm loses
// its anchor" (src/render/smith_heart_fx/breath_death_core.ts): the guardian
// woken and floating on the Storm Cornice, then its death replayed on the
// living body with `/dev heart breath death` (or, with SHOT_KILL=1, the real
// trigger: `/dev heart kill breath`), filmed as a CDP screencast at the
// page's own pace from the raid's side of the Cornice. Writes the frames, a still per beat and an mp4 with the
// scene's sounds laid on their beats (a headless page plays no audio).
// Evidence tooling, not a repo test. Needs a dev Vite serving the worktree
// (ALLOW_DEV_COMMANDS is implied offline).
//
//   node scripts/smith_heart_breath_death_shot.mjs <outDir>
//
// Env: SHOT_URL (http://127.0.0.1:5196/), SHOT_W / SHOT_H (1600x900),
// SHOT_PRESET (4), SHOT_SECONDS (11), SHOT_VIEW (raid | high | close),
// SHOT_KILL (0), SHOT_SPOT_X / SHOT_SPOT_Z (where the witness stands,
// instance-local).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5196/';
const OUT = process.argv[2] ?? path.join('tmp', 'smith_heart_breath_death');
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const SECONDS = Number(process.env.SHOT_SECONDS ?? 11);
const VIEW = process.env.SHOT_VIEW ?? 'raid';
const KILL = process.env.SHOT_KILL === '1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The scenes' beats and sounds, straight off the core the page runs. */
async function loadCore() {
  const build = await esbuild.build({
    stdin: {
      contents: "export * from './src/render/smith_heart_fx/breath_death_core.ts';",
      resolveDir: process.cwd(),
      sourcefile: 'breath-death-shot-entry.ts',
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
const D = core.BREATH_DEATH;

/** The guardian's spot on the Cornice, where the witness stands on the
 *  raid's west side, the landing the claim's origin is read from
 *  (instance-local). */
const BOSS = { x: 0, z: 198 };
const SPOT = {
  x: Number(process.env.SHOT_SPOT_X ?? -40),
  z: Number(process.env.SHOT_SPOT_Z ?? 194),
};
const ENTRY = { x: 0, z: 100 };
/** Camera holds per view: [yaw off the player's facing, pitch (positive
 *  looks down), distance]. */
const VIEWS = {
  raid: [0.3, -0.18, 16],
  // High over the Cornice: the cloud parting and the shaft on the isle.
  high: [0.3, 0.42, 48],
  close: [0.15, 0.05, 12],
};

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
    charName: 'Stormwitness',
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
  await chat('/dev heart tp breath', 4000);
  // The slot's origin from where the landing's anchor set us down.
  const O = await page.evaluate(
    ([ex, ez]) => {
      const p = window.__game.world.player;
      return { x: p.pos.x - ex, z: p.pos.z - ez };
    },
    [ENTRY.x, ENTRY.z],
  );
  console.log('origin', O);
  await page.waitForFunction(
    () => {
      let found = false;
      window.__game.renderer.scene.traverse((o) => {
        if (o.name === 'smith-heart-breath-death') found = true;
      });
      return found;
    },
    { timeout: 180000, polling: 1000 },
  );
  await page.addStyleTag({ content: '#ui { display: none !important; }' });
  // The guardian awake on the Cornice (the entrance spent, no fight).
  await chat('/dev heart breath pull', 800);
  await chat('/dev heart breath reset', 800);
  const [yaw, pitch, dist] = VIEWS[VIEW] ?? VIEWS.raid;
  await page.evaluate(
    ([ox, oz, sx, sz, bx, bz, yaw, pitch, dist]) => {
      const w = window.__game.world;
      const p = w.player;
      const move = (e, x, z) => {
        const g = w.ctx.groundPos(ox + x, oz + z);
        e.pos = { ...g };
        e.prevPos = { ...g };
        e.facing = Math.atan2(bx - x, bz - z);
        e.prevFacing = e.facing;
        w.ctx.rebucket(e);
      };
      // A ghost (and no aggro): the witness never pulls the council again
      // (a stand-in raider would: mobs aggro on it).
      p.ghost = true;
      move(p, sx, sz);
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
    [O.x, O.z, SPOT.x, SPOT.z, BOSS.x, BOSS.z, yaw, pitch, dist],
  );
  await sleep(1500);
  await page.waitForFunction(
    () => !document.querySelector('#loading-screen')?.classList.contains('visible'),
    { timeout: 240000, polling: 500 },
  );
  await sleep(Number(process.env.SHOT_SETTLE ?? 7000));
  fs.mkdirSync(OUT, { recursive: true });
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
  await sleep(700);
  // The scene: replayed on the living bodies, or the real deaths.
  const t0 = Date.now() / 1000;
  await chat(KILL ? '/dev heart kill breath' : '/dev heart breath death', 0);
  await sleep(SECONDS * 1000);
  await cdp.send('Page.stopScreencast');
  console.log('frames', frames.length);
  const dir = path.join(OUT, `frames_${VIEW}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const files = frames.map((f, i) => {
    const file = path.join(dir, `f_${String(i).padStart(4, '0')}.jpg`);
    fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
    return { file, t: f.t - t0 };
  });
  // One still per beat: the frame nearest it.
  const B = [
    ['01_el_viento_vuelve_a_el', 0.6],
    ['02_espirales_de_viento', 1.3],
    ['03_rayos_salvajes', 1.9],
    ['04_los_rayos_chisporrotean', D.sputterFrom + 0.7],
    ['05_se_deshace_en_nube', D.unravelFrom + 1.3],
    ['06_ultimo_trueno', D.clapAt + 0.08],
    ['07_las_nubes_se_abren', D.partFrom + 1.1],
    ['08_rayo_de_luz', D.shaftFull + 0.5],
    ['09_calma', D.end - 0.8],
  ];
  for (const [name, at] of B) {
    let best = files[0];
    for (const f of files) if (Math.abs(f.t - at) < Math.abs(best.t - at)) best = f;
    if (best) fs.copyFileSync(best.file, path.join(OUT, `${name}_${VIEW}.jpg`));
  }
  const require = createRequire(import.meta.url);
  const ffmpeg = require('ffmpeg-static');
  const list = path.join(OUT, `frames_${VIEW}.txt`);
  const lines = [];
  const start = files.findIndex((f) => f.t >= -0.5);
  const use = files.slice(Math.max(0, start));
  for (let i = 0; i < use.length; i++) {
    const d = i + 1 < use.length ? use[i + 1].t - use[i].t : 0.05;
    lines.push(`file '${path.resolve(use[i].file).replace(/\\/g, '/')}'`, `duration ${d}`);
  }
  lines.push(`file '${path.resolve(use[use.length - 1].file).replace(/\\/g, '/')}'`);
  fs.writeFileSync(list, lines.join('\n'));
  const silent = path.join(OUT, `muerte_${VIEW}_sin_sonido.mp4`);
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
  // The sounds on their beats (the video starts `lead` before t0).
  const lead = -(use[0]?.t ?? 0);
  const inputs = [];
  const parts = [];
  const lay = (list, from) => {
    for (const s of list) {
      inputs.push(['-i', path.resolve(`public/audio/sfx/${s.key}.mp3`)]);
      const ms = Math.max(0, Math.round((lead + from + s.at) * 1000));
      parts.push(
        `[${inputs.length}:a]asetrate=44100*${s.rate},aresample=44100,volume=${(s.gain * 0.6).toFixed(2)},adelay=${ms}:all=1[a${parts.length}]`,
      );
    }
  };
  // No voice: wind and thunder only (as its entrance).
  lay(core.BREATH_DEATH_SOUNDS, 0);
  const mix = `${parts.join(';')};${parts.map((_, i) => `[a${i}]`).join('')}amix=inputs=${parts.length}:normalize=0,alimiter=limit=0.9[aout]`;
  const final = path.join(OUT, `muerte_${VIEW}.mp4`);
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
