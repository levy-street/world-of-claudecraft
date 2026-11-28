// Evidence captures for the Guardian of the Breath's entrance, "Calm before
// the storm" (docs/design/raid/smith_heart.md section 7.2, "The entrance";
// src/render/smith_heart_fx/breath_entrance_core.ts): a fresh claim's
// Cornice in its dead calm (the loose stone hanging in the air, no guardian
// yet), then a few dev-only stand-in raiders climb onto it and wake it, and
// the scene is filmed (a CDP screencast at the page's own pace) from the
// raid's side or from high over it. Writes the frames, a still per beat, a
// contact sheet of the stills and an mp4 with the scene's sound laid on its
// beats (its own samples and the howl's loop: a headless page plays no
// audio; no voice). Evidence tooling, not a repo test. Needs a dev Vite
// serving the worktree (ALLOW_DEV_COMMANDS is implied offline).
//
//   node scripts/smith_heart_breath_entrance_shot.mjs <outDir>
//
// Env: SHOT_URL (http://127.0.0.1:5241/), SHOT_W / SHOT_H (1600x900),
// SHOT_PRESET (4), SHOT_SECONDS (15), SHOT_VIEW (raid | high | side),
// SHOT_STILLS (1: write one still per beat and the contact sheet),
// SHOT_LOOK (1: only the calm, from every view), SHOT_SPOT_X / SHOT_SPOT_Z
// (where the witness stands, instance-local), SHOT_SUFFIX (the stills' and
// the video's view word).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5241/';
const OUT = process.argv[2] ?? path.join('tmp', 'smith_heart_breath_entrance');
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const SECONDS = Number(process.env.SHOT_SECONDS ?? 15);
const VIEW = process.env.SHOT_VIEW ?? 'raid';
const SUFFIX = process.env.SHOT_SUFFIX ?? (VIEW === 'high' ? 'vista_alta' : 'vista_raid');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The scene's beats and sounds, straight off the core the page runs. */
async function loadCore() {
  const build = await esbuild.build({
    stdin: {
      contents:
        "export { BREATH_ENTRANCE, BREATH_ENTRANCE_HOWL, BREATH_ENTRANCE_SOUNDS, BREATH_STRIKES } from './src/render/smith_heart_fx/breath_entrance_core.ts';" +
        "export { BREATH_INTRO } from './src/sim/encounters/smith_heart/breath_intro_plan.ts';",
      resolveDir: process.cwd(),
      sourcefile: 'breath-entrance-shot-entry.ts',
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
const CE = core.BREATH_ENTRANCE;

/** What the camera looks at (the guardian's spot), where the witness and the
 *  raid stand on the Cornice's west side past the climb's top
 *  (instance-local). */
const BOSS = { x: 0, z: 198 };
/** Each view's witness spot: the raid's a few strides in off the climb, the
 *  high view's nearer the middle so the eye and the funnel fill the frame. */
const SPOTS = { raid: { x: -42, z: 192 }, high: { x: -6, z: 188 }, side: { x: -30, z: 170 } };
const SPOT = {
  x: Number(process.env.SHOT_SPOT_X ?? (SPOTS[VIEW] ?? SPOTS.raid).x),
  z: Number(process.env.SHOT_SPOT_Z ?? (SPOTS[VIEW] ?? SPOTS.raid).z),
};
/** The Breath's first landing: far below the Cornice, out of the wake's
 *  band (the teleport the claim's origin is read from). */
const LANDING = { x: 0, z: 100 };
/** Camera holds per view: [yaw off the player's facing, pitch (positive
 *  looks down), distance]. */
const VIEWS = {
  raid: [0.38, -0.3, 13],
  high: [0.25, 1.0, 96],
  side: [1.0, 0.1, 30],
};
/** One still per beat (the key into B below). */
const STILLS = [
  ['01_la_calma_muerta', 'calm'],
  ['02_todo_empieza_a_subir', 'drift'],
  ['03_todo_corre_hacia_el_cielo', 'race'],
  ['04_el_ojo_de_la_tormenta', 'eye'],
  ['05_baja_el_tornado', 'descend'],
  ['06_el_tornado_toca_el_suelo', 'touch'],
  ['07_rayos_dentro_del_tornado', 'storm'],
  ['08_el_tornado_estalla', 'burst'],
  ['09_la_onda_de_viento', 'ring'],
  ['10_rayos_a_su_alrededor', 'strikes'],
  ['11_el_gran_rayo', 'bolt'],
  ['12_listo_para_luchar', 'ready'],
];

const holdCamera = async (page, yaw, pitch, dist) =>
  page.evaluate(
    ([yaw, pitch, dist]) => {
      const p = window.__game.world.player;
      const input = window.__game.input;
      window.__shotHold = (window.__shotHold ?? 0) + 1;
      const mine = window.__shotHold;
      const hold = () => {
        if (window.__shotHold !== mine) return;
        input.zoomMax = Math.max(input.zoomMax, dist);
        input.camYaw = p.facing + yaw;
        input.camPitch = pitch;
        input.camDist = dist;
        requestAnimationFrame(hold);
      };
      requestAnimationFrame(hold);
    },
    [yaw, pitch, dist],
  );

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
  await page.waitForFunction(
    () => {
      let found = false;
      window.__game.renderer.scene.traverse((o) => {
        if (o.name === 'smith-heart-breath-entrance') found = true;
      });
      return found;
    },
    { timeout: 180000, polling: 1000 },
  );
  await page.addStyleTag({ content: '#ui { display: none !important; }' });
  // The slot's origin from where the landing's anchor set us down.
  const O = await page.evaluate(
    ([gx, gz]) => {
      const p = window.__game.world.player;
      return { x: p.pos.x - gx, z: p.pos.z - gz };
    },
    [LANDING.x, LANDING.z],
  );
  console.log('origin', O);
  // Stand on the Cornice (a ghost: it wakes nothing), the camera held.
  const [yaw, pitch, dist] = VIEWS[VIEW] ?? VIEWS.raid;
  await page.evaluate(
    ([ox, oz, sx, sz, bx, bz]) => {
      const w = window.__game.world;
      const p = w.player;
      p.ghost = true;
      const g = w.ctx.groundPos(ox + sx, oz + sz);
      p.pos = { ...g };
      p.prevPos = { ...g };
      p.facing = Math.atan2(bx - sx, bz - sz);
      p.prevFacing = p.facing;
      w.ctx.rebucket(p);
    },
    [O.x, O.z, SPOT.x, SPOT.z, BOSS.x, BOSS.z],
  );
  await holdCamera(page, yaw, pitch, dist);
  await sleep(1500);
  await page.waitForFunction(
    () => !document.querySelector('#loading-screen')?.classList.contains('visible'),
    { timeout: 240000, polling: 500 },
  );
  await sleep(Number(process.env.SHOT_SETTLE ?? 6000));
  fs.mkdirSync(OUT, { recursive: true });
  const finale = core.BREATH_STRIKES.filter((s) => s.at > CE.burstAt && s.kind === 'ground');
  const B = {
    calm: 0.8,
    drift: CE.pullAt + 0.9,
    race: CE.pullAt + 1.9,
    eye: CE.descendFrom - 0.1,
    descend: (CE.descendFrom + CE.touchAt) / 2 + 0.15,
    touch: CE.touchAt + 0.08,
    storm: CE.touchAt + 1.37,
    burst: CE.burstAt + 0.14,
    ring: CE.burstAt + 0.75,
    strikes: (finale[1]?.at ?? CE.finalAt - 1) + 0.04,
    bolt: CE.finalAt + 0.06,
    ready: core.BREATH_INTRO.seconds + 0.6,
  };
  // SHOT_LOOK=1: only the calm, from every view (a quick look).
  if (process.env.SHOT_LOOK === '1') {
    for (const [name, [vy, vp, vd]] of Object.entries(VIEWS)) {
      await holdCamera(page, vy, vp, vd);
      await sleep(1200);
      fs.writeFileSync(path.join(OUT, `look_${name}.png`), await page.screenshot());
    }
    await browser.close();
    process.exit(0);
  }
  // The screencast: every frame the page paints, with its own timestamp.
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
  await sleep(900);
  // The raid climbs onto the Cornice: it wakes.
  await page.evaluate(
    ([ox, oz, sx, sz, bx, bz]) => {
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
        // Spread wide either side of the witness, a stride behind it, so
        // nobody stands between the camera and the storm.
        move(e, sx + 5 - (i % 2) * 2, sz + (i < 2 ? -7 - i * 3.5 : 7 + (i - 2) * 3.5));
      });
    },
    [O.x, O.z, SPOT.x, SPOT.z, BOSS.x, BOSS.z],
  );
  // The moment the scene starts (the aura flips to waking).
  let t0 = 0;
  for (let i = 0; i < 100 && !t0; i++) {
    const waking = await page.evaluate(() => {
      for (const e of window.__game.world.entities.values()) {
        if (e.templateId !== 'heart_breath_guardian') continue;
        return e.auras.some((a) => a.id === 'heart_breath_intro' && Math.round(a.value) === 1);
      }
      return false;
    });
    if (waking) t0 = Date.now() / 1000;
    else await sleep(40);
  }
  console.log('scene start', t0);
  // The guardian's drawn height once its Form has ended (its fight size):
  // the skinned body's skinned bounds, in yards.
  const measureAt = core.BREATH_INTRO.seconds + 0.5;
  await sleep(measureAt * 1000);
  const size = await page.evaluate(() => {
    const g = window.__game;
    let id = -1;
    for (const e of g.world.entities.values())
      if (e.templateId === 'heart_breath_guardian') id = e.id;
    let best = null;
    g.renderer.scene.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      let p = o;
      while (p && p.userData?.entityId !== id) p = p.parent;
      if (!p) return;
      o.computeBoundingBox();
      const box = o.boundingBox.clone().applyMatrix4(o.matrixWorld);
      const h = box.max.y - box.min.y;
      if (!best || h > best.h) best = { h, minY: box.min.y, maxY: box.max.y };
    });
    return best;
  });
  console.log('GUARDIAN', JSON.stringify(size));
  await sleep(Math.max(0, SECONDS - measureAt) * 1000);
  await cdp.send('Page.stopScreencast');
  console.log('frames', frames.length);
  const dir = path.join(OUT, `fotogramas_${VIEW === 'high' ? 'alta' : VIEW}`);
  fs.rmSync(dir, { recursive: true, force: true });
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
      if (best) fs.copyFileSync(best.file, path.join(OUT, `${name}_${SUFFIX}.jpg`));
    }
  }
  const require = createRequire(import.meta.url);
  const ffmpeg = require('ffmpeg-static');
  const list = path.join(OUT, `frames_${VIEW}.txt`);
  const lines = [];
  const start = files.findIndex((f) => f.t >= -0.8);
  const use = files.slice(Math.max(0, start));
  for (let i = 0; i < use.length; i++) {
    const d = i + 1 < use.length ? use[i + 1].t - use[i].t : 0.05;
    lines.push(`file '${path.resolve(use[i].file).replace(/\\/g, '/')}'`, `duration ${d}`);
  }
  lines.push(`file '${path.resolve(use[use.length - 1].file).replace(/\\/g, '/')}'`);
  fs.writeFileSync(list, lines.join('\n'));
  const silent = path.join(OUT, `entrada_aliento_${SUFFIX}_sin_sonido.mp4`);
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
  fs.rmSync(list, { force: true });
  // The sound on its beats: the video starts `lead` before the wake.
  const lead = -(use[0]?.t ?? 0);
  const inputs = [];
  const parts = [];
  // The howl: its loop from the pull to the burst, swelling, cut by it.
  {
    const HW = core.BREATH_ENTRANCE_HOWL;
    const len = CE.burstAt + 0.4 - CE.pullAt;
    const swell = CE.descendFrom + 0.6 - CE.pullAt;
    inputs.push(['-stream_loop', '4', '-i', path.resolve(`public/audio/sfx/${HW.key}.mp3`)]);
    parts.push(
      `[${inputs.length}:a]atrim=0:${len.toFixed(2)},afade=t=in:st=0:d=${swell.toFixed(2)},afade=t=out:st=${(len - 0.5).toFixed(2)}:d=0.5,volume=${(HW.gain * 0.55).toFixed(2)},adelay=${Math.round((lead + CE.pullAt) * 1000)}:all=1[a${parts.length}]`,
    );
  }
  for (const s of core.BREATH_ENTRANCE_SOUNDS) {
    inputs.push(['-i', path.resolve(`public/audio/sfx/${s.key}.mp3`)]);
    const ms = Math.round((lead + s.at) * 1000);
    parts.push(
      `[${inputs.length}:a]asetrate=44100*${s.rate},aresample=44100,volume=${(s.gain * 0.6).toFixed(2)},adelay=${ms}:all=1[a${parts.length}]`,
    );
  }
  const mix = `${parts.join(';')};${parts.map((_, i) => `[a${i}]`).join('')}amix=inputs=${parts.length}:normalize=0,alimiter=limit=0.9[aout]`;
  const final = path.join(OUT, `entrada_aliento_${SUFFIX}.mp4`);
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
  // The contact sheet: every still of this view on one page.
  if (process.env.SHOT_STILLS !== '0') {
    const sheet = path.join(OUT, `_sheet_${VIEW}`);
    fs.rmSync(sheet, { recursive: true, force: true });
    fs.mkdirSync(sheet, { recursive: true });
    STILLS.forEach(([name], i) => {
      const from = path.join(OUT, `${name}_${SUFFIX}.jpg`);
      if (fs.existsSync(from))
        fs.copyFileSync(from, path.join(sheet, `${String(i + 1).padStart(2, '0')}.jpg`));
    });
    const out = path.join(
      OUT,
      VIEW === 'high' ? 'resumen_desde_arriba.jpg' : `resumen_${SUFFIX}.jpg`,
    );
    execFileSync(ffmpeg, [
      '-y',
      '-i',
      path.join(sheet, '%02d.jpg'),
      '-vf',
      'scale=800:-1,tile=3x4:padding=4',
      '-frames:v',
      '1',
      '-update',
      '1',
      '-q:v',
      '3',
      out,
    ]);
    fs.rmSync(sheet, { recursive: true, force: true });
    console.log('SHEET', out);
  }
} finally {
  await browser.close();
}
