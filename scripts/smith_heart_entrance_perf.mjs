// Performance evidence for the Smith's Heart's five boss entrances (the
// Hammer Council's "The quarry wakes", the Breath's "Calm before the storm",
// the Quench's "Under the ice", the Heat's cold hearth, the Masterless
// Strength's arrival; docs/design/raid/smith_heart.md sections 7.x). One
// offline page per run, at one graphics preset: it walks the raid room by
// room, puts each guardian back to sleep with its dev replay, wakes it with
// the player standing where the raid would, and samples every frame of the
// scene: frame time (worst, worst in the first 2.5 s, p95, mean), draw calls
// and triangles, the raid fx meshes drawn, live particles, lit lights,
// shadow casters, and the programs the driver linked inside a live frame
// (`live-program`, src/render/CLAUDE.md "GPU work"). Writes one JSON per run
// and a still at each scene's peak. Evidence tooling, not a repo test. Needs
// a dev Vite serving the worktree (ALLOW_DEV_COMMANDS is implied offline);
// launches Chrome on the d3d11 ANGLE backend, never SwiftShader.
//
//   node scripts/smith_heart_entrance_perf.mjs <outDir>
//
// Evidence class: headless smoke (counts are the evidence; frame times are
// indicative only, compare runs taken under the same conditions). Refuses a
// software renderer. Add `&gputimer=1` to SHOT_URL for the GPU's own time.
//
// Env: SHOT_URL (http://127.0.0.1:5241/?governor=off), SHOT_W / SHOT_H (1280x720),
// SHOT_PRESET (1 low, 3 high), SHOT_ONLY (comma list of council, breath,
// quench, heat, final), SHOT_SECONDS (16).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5241/?governor=off';
const OUT = process.argv[2] ?? path.join('tmp', 'smith_heart_entrance_perf');
const W = Number(process.env.SHOT_W ?? 1280);
const H = Number(process.env.SHOT_H ?? 720);
const PRESET = Number(process.env.SHOT_PRESET ?? 1);
const SECONDS = Number(process.env.SHOT_SECONDS ?? 16);
const ONLY = (process.env.SHOT_ONLY ?? 'council,breath,quench,heat,final').split(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The Gallery's anchor (instance-local): the claim's origin is read from it. */
const GALLERY = { x: -98, z: -232 };
/** Per entrance: the room's teleport, where the player stands (it wakes the
 *  guardian), what the camera looks at, the camera hold [yaw off facing,
 *  pitch, distance], the replay verb, and the scene's peak (a still). */
/** SHOT_VIEWS=1: framings for the stills (the numbers are only comparable
 *  between runs on the same framing). */
const SHOTS = process.env.SHOT_VIEWS === '1';
const SHOT_VIEWS = {
  council: { cam: [0.12, 0.3, 26] },
  breath: { stand: { x: -30, z: 170 }, cam: [1.0, 0.1, 30], peak: 7.2 },
  quench: { cam: [0.2, 0.5, 18], peak: 8.5 },
  heat: { stand: { x: -192, z: -26 }, cam: [-0.35, 0.5, 30], peak: 9 },
  final: { cam: [-0.2, 0.22, 24], peak: 8 },
};
const SCENES = {
  council: {
    tp: 'gallery',
    stand: { x: -17, z: -168 },
    look: { x: 9, z: -166 },
    cam: [0.12, 0.24, 24],
    replay: '/dev heart council intro',
    peak: 9.5,
  },
  breath: {
    tp: 'breath',
    stand: { x: -42, z: 192 },
    look: { x: 0, z: 198 },
    cam: [0.38, -0.05, 18],
    replay: '/dev heart breath intro',
    peak: 9,
  },
  quench: {
    tp: 'ice',
    stand: { x: 194, z: -22 },
    look: { x: 198, z: -2 },
    cam: [0.18, 0.42, 15],
    replay: '/dev heart quench intro',
    peak: 8,
  },
  heat: {
    tp: 'heat',
    stand: { x: -200, z: -34 },
    look: { x: -220, z: 0 },
    cam: [0.2, 0.3, 26],
    replay: '/dev heart heat intro',
    peak: 9,
  },
  final: {
    tp: 'final',
    stand: { x: 139, z: 123 },
    look: { x: 188, z: 172 },
    cam: [-0.2, 0.04, 17],
    replay: null,
    peak: 8,
  },
};

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [`--window-size=${W},${H}`, '--use-angle=d3d11', '--ignore-gpu-blocklist'],
  defaultViewport: { width: W, height: H },
  protocolTimeout: 300000,
});
const report = {
  evidence: 'headless-smoke',
  preset: PRESET,
  width: W,
  height: H,
  url: URL,
  sha: (() => {
    try {
      return execFileSync('git', ['rev-parse', '--short', 'HEAD']).toString().trim();
    } catch {
      return 'unknown';
    }
  })(),
  dirty: (() => {
    try {
      return execFileSync('git', ['status', '--porcelain']).toString().trim().length > 0;
    } catch {
      return null;
    }
  })(),
  scenes: {},
};
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 300));
  });
  await page.evaluateOnNewDocument((preset) => {
    try {
      localStorage.setItem(
        'woc_settings',
        JSON.stringify({ graphicsPreset: preset, graphicsDefaultApplied: true }),
      );
    } catch {
      /* ignore */
    }
  }, PRESET);
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 240000 });
  const booted = await enterOfflineGame(page, {
    charClass: 'warrior',
    charName: 'Perfwitness',
    gameBootTimeoutMs: 240000,
    selectorTimeoutMs: 120000,
    settleMs: 4000,
  });
  if (!booted) throw new Error('offline world did not boot');
  const gl = await page.evaluate(() => {
    const s = window.__game.renderer.perfStats();
    return {
      tier: s.tier,
      glRenderer: s.glRenderer,
      shadowMap: s.qualityBuckets.features.shadowMap,
    };
  });
  console.log('renderer', gl);
  report.renderer = gl;
  report.browser = await browser.version();
  report.dpr = await page.evaluate(() => window.devicePixelRatio);
  // The same pattern as src/render/software_renderer.ts: a software
  // rasterizer's numbers say nothing about a GPU.
  if (/swiftshader|llvmpipe|softpipe|software|microsoft basic render/i.test(gl.glRenderer ?? ''))
    throw new Error(`software renderer: ${gl.glRenderer}`);
  const wantTier = { 1: 'low', 2: 'medium', 3: 'high', 4: 'ultra', 6: 'insane' }[PRESET];
  if (wantTier && gl.tier !== wantTier) throw new Error(`preset ${PRESET} resolved to ${gl.tier}`);
  const chat = async (c, wait = 900) => {
    await page.evaluate((line) => window.__game.world.chat(line), c);
    await sleep(wait);
  };
  for (const c of ['/dev level 20', '/dev god', '/dev heart enter', '/dev noaggro'])
    await chat(c, 1500);
  await chat('/dev heart kill trash', 600);
  await chat('/dev heart gates', 600);
  await chat('/dev heart tp gallery', 4000);
  const O = await page.evaluate(
    ([gx, gz]) => {
      const p = window.__game.world.player;
      return { x: p.pos.x - gx, z: p.pos.z - gz };
    },
    [GALLERY.x, GALLERY.z],
  );
  console.log('origin', O);
  await page.addStyleTag({ content: '#ui { display: none !important; }' });
  // The page-side sampler: every frame's time and draw counts, the scene's
  // particles, lights and casters at 5 Hz.
  await page.evaluate(() => {
    const g = window.__game;
    const S = {
      on: false,
      frames: [],
      samples: [],
      last: performance.now(),
    };
    window.__perfS = S;
    const raidRoot = (o) => {
      for (let p = o; p; p = p.parent) if (/^smith-heart-/.test(p.name)) return true;
      return false;
    };
    const shown = (o) => {
      for (let p = o; p; p = p.parent) if (!p.visible) return false;
      return true;
    };
    let tick = 0;
    const loop = (now) => {
      const dt = now - S.last;
      S.last = now;
      if (S.pause) S.skip = 2;
      else if (S.skip > 0) S.skip--;
      else if (S.on) {
        const r = g.renderer;
        const st = r.drawStats ? r.drawStats.currentFrame() : r.webgl.info.render;
        S.frames.push([now, dt, st.calls, st.triangles]);
        if (tick++ % 12 === 0) {
          let particles = 0;
          const pools = {};
          let fxMeshes = 0;
          let fxCasters = 0;
          const lights = { point: 0, spot: 0, directional: 0, hemisphere: 0, other: 0 };
          g.renderer.scene.traverse((o) => {
            if (o.isLight) {
              if (!shown(o) || o.intensity <= 0) return;
              const k = o.isPointLight
                ? 'point'
                : o.isSpotLight
                  ? 'spot'
                  : o.isDirectionalLight
                    ? 'directional'
                    : o.isHemisphereLight
                      ? 'hemisphere'
                      : 'other';
              lights[k]++;
              return;
            }
            if (!o.isMesh || !shown(o) || !raidRoot(o)) return;
            fxMeshes++;
            if (o.castShadow) fxCasters++;
            const life = o.geometry?.attributes?.aLife;
            const uT = o.material?.uniforms?.uTime;
            if (life && uT) {
              const a = life.array;
              const t = uT.value;
              for (let i = 0; i < a.length; i += 4) {
                const age = t - a[i];
                if (age >= 0 && age < a[i + 1]) {
                  particles++;
                  const k = o.material.name || 'pool';
                  pools[k] = (pools[k] ?? 0) + 1;
                }
              }
            }
          });
          // ?gputimer=1 only: the GPU's own frame time (rolling 120 frames).
          const gt = r.gpuTimerProbe?.snapshot();
          const gpu = gt?.available ? +gt.frameSum.avg.toFixed(2) : null;
          S.samples.push([now, particles, fxMeshes, fxCasters, lights, gpu, pools]);
        }
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  const liveProgramCount = () =>
    page.evaluate(() => {
      const e = window.__game.renderer.perfStats().gpuPrep.events;
      return {
        n: e.counts['live-program'] ?? 0,
        keys: e.events.filter((x) => x.kind === 'live-program').map((x) => [x.atMs, x.key]),
      };
    });
  fs.mkdirSync(OUT, { recursive: true });
  for (const name of ONLY) {
    const S = SHOTS ? { ...SCENES[name], ...SHOT_VIEWS[name] } : SCENES[name];
    if (!SCENES[name]) continue;
    console.log('---', name);
    await chat(`/dev heart tp ${S.tp}`, 4000);
    // The witness: a ghost (it wakes nothing) where the raid stands.
    await page.evaluate(
      ([ox, oz, sx, sz, lx, lz, yaw, pitch, dist]) => {
        const w = window.__game.world;
        const p = w.player;
        p.ghost = true;
        const g = w.ctx.groundPos(ox + sx, oz + sz);
        p.pos = { ...g };
        p.prevPos = { ...g };
        p.facing = Math.atan2(lx - sx, lz - sz);
        p.prevFacing = p.facing;
        w.ctx.rebucket(p);
        const input = window.__game.input;
        window.__perfCam = [yaw, pitch, dist];
        if (!window.__perfHold) {
          window.__perfHold = true;
          const hold = () => {
            const [y, pi, d] = window.__perfCam;
            input.zoomMax = Math.max(input.zoomMax, d);
            input.camYaw = w.player.facing + y;
            input.camPitch = pi;
            input.camDist = d;
            requestAnimationFrame(hold);
          };
          requestAnimationFrame(hold);
        }
      },
      [O.x, O.z, S.stand.x, S.stand.z, S.look.x, S.look.z, ...S.cam],
    );
    if (S.replay) await chat(S.replay, 800);
    await sleep(1500);
    await page.waitForFunction(
      () => !document.querySelector('#loading-screen')?.classList.contains('visible'),
      { timeout: 240000, polling: 500 },
    );
    await sleep(7000);
    // Baseline: the room asleep, 3 s.
    await page.evaluate(() => {
      const S = window.__perfS;
      S.frames = [];
      S.samples = [];
      S.on = true;
    });
    await sleep(3000);
    const base = await page.evaluate(() => {
      const S = window.__perfS;
      S.on = false;
      return { frames: S.frames, samples: S.samples };
    });
    const lp0 = await liveProgramCount();
    // Wake it.
    const wakeAt = await page.evaluate(() => {
      const S = window.__perfS;
      S.frames = [];
      S.samples = [];
      S.on = true;
      return performance.now();
    });
    if (S.replay) await page.evaluate(() => (window.__game.world.player.ghost = false));
    else await chat('/dev heart arrival', 0);
    await sleep(S.peak * 1000);
    // The still stalls the page: its frames are left out of the sample.
    await page.evaluate(() => (window.__perfS.pause = true));
    fs.writeFileSync(path.join(OUT, `${name}_p${PRESET}.png`), await page.screenshot());
    await page.evaluate(() => (window.__perfS.pause = false));
    await sleep(Math.max(0, SECONDS - S.peak) * 1000);
    const scene = await page.evaluate(() => {
      const S = window.__perfS;
      S.on = false;
      return { frames: S.frames, samples: S.samples };
    });
    const lp1 = await liveProgramCount();
    // Back to a ghost so the next room's walk wakes nothing on the way.
    await page.evaluate(() => (window.__game.world.player.ghost = true));
    const sum = (fr, from, to) => {
      const use = fr.filter((f) => f[0] - wakeAt >= from && f[0] - wakeAt < to).slice(1);
      const dts = use.map((f) => f[1]).sort((a, b) => a - b);
      if (!dts.length) return null;
      return {
        frames: dts.length,
        meanMs: +(dts.reduce((a, b) => a + b, 0) / dts.length).toFixed(1),
        p95Ms: +dts[Math.floor(dts.length * 0.95)].toFixed(1),
        worstMs: +dts[dts.length - 1].toFixed(1),
        over50: dts.filter((d) => d > 50).length,
        spikes: use
          .filter((f) => f[1] > 50)
          .map((f) => [+((f[0] - wakeAt) / 1000).toFixed(2), +f[1].toFixed(0)]),
        maxCalls: Math.max(...use.map((f) => f[2])),
        maxTris: Math.max(...use.map((f) => f[3])),
      };
    };
    const peakOf = (samples) => {
      const out = { particles: 0, fxMeshes: 0, fxCasters: 0, point: 0, spot: 0, gpuMs: null };
      out.pools = {};
      for (const [, p, m, c, l, gpu, pools] of samples) {
        for (const [k, v] of Object.entries(pools)) out.pools[k] = Math.max(out.pools[k] ?? 0, v);
        if (gpu !== null) out.gpuMs = Math.max(out.gpuMs ?? 0, gpu);
        out.particles = Math.max(out.particles, p);
        out.fxMeshes = Math.max(out.fxMeshes, m);
        out.fxCasters = Math.max(out.fxCasters, c);
        out.point = Math.max(out.point, l.point);
        out.spot = Math.max(out.spot, l.spot);
      }
      return out;
    };
    const bFrames = base.frames
      .slice(1)
      .map((f) => f[1])
      .sort((a, b) => a - b);
    const r = {
      baseline: {
        meanMs: +(bFrames.reduce((a, b) => a + b, 0) / Math.max(1, bFrames.length)).toFixed(1),
        worstMs: +(bFrames[bFrames.length - 1] ?? 0).toFixed(1),
        calls: Math.max(...base.frames.map((f) => f[2])),
        tris: Math.max(...base.frames.map((f) => f[3])),
        ...peakOf(base.samples),
      },
      start: sum(scene.frames, 0, 2500),
      whole: sum(scene.frames, 0, SECONDS * 1000),
      peak: peakOf(scene.samples),
      liveProgramsInScene: lp1.n - lp0.n,
      liveProgramKeys: lp1.keys.filter((k) => k[0] >= wakeAt - 50).map((k) => k[1]),
    };
    console.log(JSON.stringify(r));
    report.scenes[name] = r;
  }
  fs.writeFileSync(path.join(OUT, `perf_p${PRESET}.json`), JSON.stringify(report, null, 2));
  console.log('WROTE', path.join(OUT, `perf_p${PRESET}.json`));
} finally {
  await browser.close();
}
