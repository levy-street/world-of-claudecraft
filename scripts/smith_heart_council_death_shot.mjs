// Evidence captures for the Hammer Council's deaths, "The quarry falls
// silent" (src/render/smith_heart_fx/council_death_core.ts): the council
// woken and stood home, then their deaths replayed on the living bodies with
// `/dev heart council death` (or, with SHOT_KILL=1, the real trigger: `/dev
// heart kill guardian`, then the Singer SHOT_GAP seconds later), filmed as a
// CDP screencast at the page's own pace from the raid's side of the pit.
// Writes the frames, a still per beat and an mp4 with the scene's sounds laid
// on their beats (a headless page plays no audio). Evidence tooling, not a
// repo test. Needs a dev Vite serving the worktree (ALLOW_DEV_COMMANDS is
// implied offline).
//
//   node scripts/smith_heart_council_death_shot.mjs <outDir>
//
// Env: SHOT_URL (http://127.0.0.1:5196/), SHOT_W / SHOT_H (1600x900),
// SHOT_PRESET (4), SHOT_SECONDS (13), SHOT_VIEW (raid | high | side | close),
// SHOT_WHO (both | guardian | singer), SHOT_KILL (0), SHOT_GAP (2.6),
// SHOT_SPOT_X / SHOT_SPOT_Z (where the witness stands, instance-local).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5196/';
const OUT = process.argv[2] ?? path.join('tmp', 'smith_heart_council_death');
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const SECONDS = Number(process.env.SHOT_SECONDS ?? 13);
const VIEW = process.env.SHOT_VIEW ?? 'raid';
const WHO = process.env.SHOT_WHO ?? 'both';
const KILL = process.env.SHOT_KILL === '1';
const GAP = Number(process.env.SHOT_GAP ?? 2.6);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The scenes' beats and sounds, straight off the core the page runs. */
async function loadCore() {
  const build = await esbuild.build({
    stdin: {
      contents: "export * from './src/render/smith_heart_fx/council_death_core.ts';",
      resolveDir: process.cwd(),
      sourcefile: 'council-death-shot-entry.ts',
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
const GD = core.GUARDIAN_DEATH;
const SD = core.SINGER_DEATH;

/** What the camera looks at (between the two), where the witness and the
 *  raid stand on the pit floor toward the Pit Mouth (instance-local). */
const BOSS = { x: 9, z: -166 };
const SPOT = {
  x: Number(process.env.SHOT_SPOT_X ?? -2),
  z: Number(process.env.SHOT_SPOT_Z ?? -169),
};
const GALLERY = { x: -98, z: -232 };
/** Camera holds per view: [yaw off the player's facing, pitch (positive
 *  looks down), distance]. */
const VIEWS = {
  raid: [0, 0.14, 20],
  high: [0.25, 0.62, 44],
  side: [0.9, 0.14, 24],
  close: [0.1, 0.06, 12],
  wide: [0.0, 0.36, 34],
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
    charName: 'Quarrywitness',
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
  await chat('/dev heart tp gallery', 4000);
  await page.waitForFunction(
    () => {
      let found = false;
      window.__game.renderer.scene.traverse((o) => {
        if (o.name === 'smith-heart-council-death') found = true;
      });
      return found;
    },
    { timeout: 180000, polling: 1000 },
  );
  await page.addStyleTag({ content: '#ui { display: none !important; }' });
  const O = await page.evaluate(
    ([gx, gz]) => {
      const p = window.__game.world.player;
      return { x: p.pos.x - gx, z: p.pos.z - gz };
    },
    [GALLERY.x, GALLERY.z],
  );
  console.log('origin', O);
  // The council awake and home (the entrance spent, out of the fight).
  await chat('/dev heart council pull', 800);
  await chat('/dev heart council reset', 800);
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
  /** When each member's scene starts (seconds after t0). */
  const starts = { guardian: -1, singer: -1 };
  if (KILL) {
    if (WHO !== 'singer') {
      await chat('/dev heart kill guardian', 0);
      starts.guardian = 0;
    }
    if (WHO !== 'guardian') {
      if (WHO === 'both') await sleep(GAP * 1000);
      starts.singer = Date.now() / 1000 - t0;
      await chat('/dev heart kill singer', 0);
    }
  } else {
    await chat(`/dev heart council death${WHO === 'both' ? '' : ` ${WHO}`}`, 0);
    if (WHO !== 'singer') starts.guardian = 0;
    if (WHO !== 'guardian') starts.singer = WHO === 'both' ? core.COUNCIL_REPLAY_STAGGER : 0;
  }
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
  const B = [];
  if (starts.guardian >= 0) {
    const g = starts.guardian;
    B.push(
      ['01_guardian_grietas_doradas', g + GD.blazeFull - 0.1],
      ['02_guardian_de_rodillas', g + GD.kneelAt + 0.25],
      ['03_guardian_se_parte', g + GD.splitAt + 0.15],
      ['04_guardian_losas_caen', g + GD.splitAt + 0.6],
      ['05_guardian_nucleo_se_apaga', g + GD.gutters[1]],
    );
  }
  if (starts.singer >= 0) {
    const s = starts.singer;
    B.push(
      ['06_cantora_ultima_nota', s + 0.6],
      ['07_cantora_luz_por_las_grietas', s + SD.shatterAt - 0.2],
      ['08_cantora_estalla', s + SD.shatterAt + 0.12],
      ['09_cantora_fragmentos_suspendidos', s + SD.shatterAt + 0.55],
      ['10_cantora_lluvia_de_cristal', s + SD.shatterAt + 1.5],
    );
  }
  if (starts.guardian >= 0 && starts.singer >= 0) {
    const second = starts.singer >= starts.guardian ? 'singer' : 'guardian';
    const e = starts[second] + core.COUNCIL_END_LEAD[second];
    B.push(
      ['11_columnas_se_encienden', e + 0.45],
      ['12_columnas_se_apagan', e + core.COUNCIL_END.firstAt + 2 * core.COUNCIL_END.step + 0.3],
      ['13_la_cantera_en_silencio', e + core.COUNCIL_END_SECONDS - 0.3],
    );
  }
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
  const voice = (file, at) => {
    inputs.push(['-i', path.resolve(file)]);
    parts.push(
      `[${inputs.length}:a]adelay=${Math.max(0, Math.round((lead + at) * 1000))}:all=1,volume=1.1[a${parts.length}]`,
    );
  };
  if (starts.guardian >= 0) lay(core.GUARDIAN_DEATH_SOUNDS, starts.guardian);
  if (starts.singer >= 0) lay(core.SINGER_DEATH_SOUNDS, starts.singer);
  if (KILL) {
    const vg = 'public/audio/voice/heart_hammer_guardian';
    const vs = 'public/audio/voice/heart_seam_singer';
    const pick = (dir, re) => fs.readdirSync(dir).find((f) => re.test(f));
    const gd = pick(vg, /my_strength/);
    const sd = pick(vs, /my_song_runs/);
    if (gd && starts.guardian >= 0) voice(path.join(vg, gd), starts.guardian + 0.1);
    if (sd && starts.singer >= 0) voice(path.join(vs, sd), starts.singer + 0.1);
  }
  if (starts.guardian >= 0 && starts.singer >= 0) {
    const second = starts.singer >= starts.guardian ? 'singer' : 'guardian';
    lay(core.COUNCIL_END_SOUNDS, starts[second] + core.COUNCIL_END_LEAD[second]);
  }
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
