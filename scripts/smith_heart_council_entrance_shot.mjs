// Evidence captures for the Hammer Council's entrance, "The quarry wakes"
// (docs/design/raid/smith_heart.md section 7.1, "The entrance";
// src/render/smith_heart_fx/council_entrance_core.ts): a fresh claim's
// council asleep (the Guardian in its spur of rock, the Seam Singer in her
// crystal), then a few dev-only stand-in raiders come down into the quarry
// and wake it, and the scene is filmed (a CDP screencast at the page's own
// pace) from the raid's side of the pit. Writes the frames, a still per beat
// and an mp4 with the scene's sound laid on its beats (the two voiced lines
// and the scene's own samples: a headless page plays no audio). Evidence
// tooling, not a repo test. Needs a dev Vite serving the worktree
// (ALLOW_DEV_COMMANDS is implied offline).
//
//   node scripts/smith_heart_council_entrance_shot.mjs <outDir>
//
// Env: SHOT_URL (http://127.0.0.1:5231/), SHOT_W / SHOT_H (1600x900),
// SHOT_PRESET (4), SHOT_SECONDS (18), SHOT_VIEW (raid | high | side | close),
// SHOT_STILLS (1: write one still per beat), SHOT_LOOK (1: only the
// sleeping council, from every view), SHOT_SPOT_X / SHOT_SPOT_Z (where the
// witness stands, instance-local).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5231/';
const OUT = process.argv[2] ?? path.join('tmp', 'smith_heart_council_entrance');
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const SECONDS = Number(process.env.SHOT_SECONDS ?? 18);
const VIEW = process.env.SHOT_VIEW ?? 'raid';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The scene's beats and sounds, straight off the core the page runs. */
async function loadCore() {
  const build = await esbuild.build({
    stdin: {
      contents:
        "export { COUNCIL_ENTRANCE, COUNCIL_ENTRANCE_SOUNDS } from './src/render/smith_heart_fx/council_entrance_core.ts';" +
        "export { COUNCIL_INTRO } from './src/sim/encounters/smith_heart/council_intro_plan.ts';",
      resolveDir: process.cwd(),
      sourcefile: 'council-entrance-shot-entry.ts',
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
const CE = core.COUNCIL_ENTRANCE;

/** What the camera looks at (between the two, toward the Guardian), where
 *  the witness and the raid stand on the pit floor toward the Pit Mouth
 *  (instance-local). */
const BOSS = { x: 9, z: -166 };
const SPOT = {
  x: Number(process.env.SHOT_SPOT_X ?? -17),
  z: Number(process.env.SHOT_SPOT_Z ?? -168),
};
/** The Gallery: far out of the wake's reach (the teleport the claim's origin
 *  is read from). */
const GALLERY = { x: -98, z: -232 };
/** Camera holds per view: [yaw off the player's facing, pitch (positive
 *  looks down), distance], held back far enough to frame the Guardian's
 *  14.7 yd and its spur. */
const VIEWS = {
  raid: [0.12, 0.24, 24],
  high: [0.3, 0.74, 54],
  side: [1.0, 0.18, 30],
  close: [0.25, 0.14, 15],
};
/** One still per beat (the key into B below). */
const STILLS = [
  ['01_dormidos_en_la_roca_y_el_cristal', 'dormant'],
  ['02_el_zumbido_y_las_columnas', 'thrum'],
  ['03_grietas_por_la_roca', 'cracks'],
  ['04_el_guardian_se_arranca', 'tear'],
  ['05_las_losas_caen', 'slabs'],
  ['06_golpe_al_suelo_y_onda', 'punch'],
  ['07_la_veta_resuena', 'ring'],
  ['08_el_cristal_estalla', 'shatter'],
  ['09_ella_sale_flotando', 'float'],
  ['10_la_nota_aguda', 'note'],
  ['11_listos_para_luchar', 'ready'],
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
        if (o.name === 'smith-heart-council-entrance') found = true;
      });
      return found;
    },
    { timeout: 180000, polling: 1000 },
  );
  await page.addStyleTag({ content: '#ui { display: none !important; }' });
  // The slot's origin from where the Gallery's anchor set us down.
  const O = await page.evaluate(
    ([gx, gz]) => {
      const p = window.__game.world.player;
      return { x: p.pos.x - gx, z: p.pos.z - gz };
    },
    [GALLERY.x, GALLERY.z],
  );
  console.log('origin', O);
  // Stand on the pit floor (a ghost: it wakes nothing), the camera held.
  const [yaw, pitch, dist] = VIEWS[VIEW] ?? VIEWS.raid;
  await page.evaluate(
    ([ox, oz, sx, sz, bx, bz, yaw, pitch, dist]) => {
      const w = window.__game.world;
      const p = w.player;
      p.ghost = true;
      const g = w.ctx.groundPos(ox + sx, oz + sz);
      p.pos = { ...g };
      p.prevPos = { ...g };
      p.facing = Math.atan2(bx - sx, bz - sz);
      p.prevFacing = p.facing;
      w.ctx.rebucket(p);
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
  await sleep(Number(process.env.SHOT_SETTLE ?? 6000));
  fs.mkdirSync(OUT, { recursive: true });
  const B = {
    dormant: -0.3,
    thrum: CE.columnsAt + CE.columnStep * 3,
    cracks: CE.tearAt - 0.35,
    tear: CE.tearAt + 0.18,
    slabs: CE.tearAt + 0.75,
    punch: CE.punchAt + 0.35,
    ring: CE.shatterAt - 0.3,
    shatter: CE.shatterAt + 0.1,
    float: CE.shatterAt + 1.6,
    note: CE.noteAt + 0.45,
    ready: core.COUNCIL_INTRO.seconds + 0.6,
  };
  // SHOT_LOOK=1: only the sleeping council, from every view (a quick look).
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
  // The raid comes down into the quarry: it wakes.
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
        move(e, sx - 3 - (i % 2) * 2.4, sz + (i - 2) * 3.4);
      });
    },
    [O.x, O.z, SPOT.x, SPOT.z, BOSS.x, BOSS.z],
  );
  // The moment the scene starts (the aura flips to waking).
  let t0 = 0;
  for (let i = 0; i < 100 && !t0; i++) {
    const waking = await page.evaluate(() => {
      for (const e of window.__game.world.entities.values()) {
        if (e.templateId !== 'heart_hammer_guardian') continue;
        return e.auras.some((a) => a.id === 'heart_council_intro' && Math.round(a.value) === 1);
      }
      return false;
    });
    if (waking) t0 = Date.now() / 1000;
    else await sleep(40);
  }
  console.log('scene start', t0);
  await sleep(SECONDS * 1000);
  await cdp.send('Page.stopScreencast');
  if (process.env.SHOT_DUMP === '1') {
    const dump = await page.evaluate(() => {
      const g = window.__game;
      const out = [];
      for (const e of g.world.entities.values()) {
        if (e.kind !== 'mob' || !/hammer_guardian|seam_singer/.test(e.templateId)) continue;
        const objs = [];
        g.renderer.scene.traverse((o) => {
          if (o.userData?.entityId !== e.id) return;
          let vis = true;
          for (let p = o; p; p = p.parent) if (!p.visible) vis = false;
          const v = new o.position.constructor();
          o.getWorldPosition(v);
          objs.push({
            name: o.name,
            type: o.type,
            vis,
            y: v.y.toFixed(2),
            s: o.scale.x.toFixed(2),
          });
        });
        out.push({
          t: e.templateId,
          pos: e.pos,
          auras: e.auras.map((a) => a.id),
          objs: objs.slice(0, 6),
        });
      }
      return out;
    });
    console.log('DUMP', JSON.stringify(dump));
  }
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
  const start = files.findIndex((f) => f.t >= -0.8);
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
  const voices = [
    [
      'public/audio/voice/heart_hammer_guardian/yell__strangers_in_the_quarry_the_hammer_s_strength_does_not_yield.mp3',
      core.COUNCIL_INTRO.guardianSpeakAt,
    ],
    [
      'public/audio/voice/heart_seam_singer/yell__hear_the_seam_sing_it_has_waited_so_long_for_your_voices.mp3',
      core.COUNCIL_INTRO.singerSpeakAt,
    ],
  ];
  const inputs = [];
  const parts = [];
  for (const [file, at] of voices) {
    inputs.push(['-i', path.resolve(file)]);
    parts.push(
      `[${inputs.length}:a]adelay=${Math.round((lead + at) * 1000)}:all=1,volume=1.1[a${parts.length}]`,
    );
  }
  for (const s of core.COUNCIL_ENTRANCE_SOUNDS) {
    inputs.push(['-i', path.resolve(`public/audio/sfx/${s.key}.mp3`)]);
    const ms = Math.round((lead + s.at) * 1000);
    parts.push(
      `[${inputs.length}:a]asetrate=44100*${s.rate},aresample=44100,volume=${(s.gain * 0.6).toFixed(2)},adelay=${ms}:all=1[a${parts.length}]`,
    );
  }
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
