// Border-crossing stall benchmark: the disciplined A/B harness for the
// travel-freeze work. Measures worst frame gaps, hitch causes, program-cache
// growth, GPU-queue unit timings (renderer.gpuQueue), and worst stall
// attributions while WALKING the player across a zone border, after a
// controlled warm-up, over several repetitions with a fresh page each (a
// fresh page resets the WebGL program cache, so every run pays first-draw
// costs the same way).
//
// The two lessons this harness exists to enforce:
//   - It starts its OWN vite dev server with --strictPort and records the
//     checked-out SHA it serves, so a measurement can never silently run
//     against another checkout's server (the 5173 trap: a main-checkout dev
//     server answering the port while the fixes lived in a worktree).
//   - It runs a HEADED browser on the real GPU and fails loudly when the GL
//     renderer string reports a software rasterizer (SwiftShader numbers do
//     not transfer to real GPUs).
//
// One invocation measures ONE code state. For an A/B, run it once per
// checkout/worktree (each starts its own server on the same port,
// sequentially) and compare the JSON outputs:
//   BENCH_LABEL=baseline node scripts/border_crossing_bench.mjs   # in the base worktree
//   BENCH_LABEL=fixes    node scripts/border_crossing_bench.mjs   # in the feature worktree
//
// Env: BENCH_PORT (default 5198, strict), BENCH_RUNS (default 3), BENCH_LABEL
//      (default 'run'), BENCH_OUT (default tmp/border-bench-<label>-<stamp>.json),
//      BENCH_HEAD_SHA (evidence pin: must match the checked-out HEAD),
//      BENCH_GFX (default ultra), BENCH_WARMUP_TIMEOUT_MS (default 240000),
//      BROWSER_PATH (see scripts/browser_path.mjs).
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const PORT = Number(process.env.BENCH_PORT ?? 5198);
const RUNS = Number(process.env.BENCH_RUNS ?? 3);
const LABEL = process.env.BENCH_LABEL ?? 'run';
const GFX = process.env.BENCH_GFX ?? 'ultra';
const WARMUP_TIMEOUT_MS = Number(process.env.BENCH_WARMUP_TIMEOUT_MS ?? 240000);
// warm: wait for the streaming lane to finish and the frame cadence to go
// quiet before crossing (the steady state; the existing idle prewarm largely
// covers it, so both arms of an A/B tend to converge here). cold: a fixed
// short settle only, crossing WHILE streaming still catches up: the transient
// regime real travel hits, where the border stalls actually live.
const SCENARIO = process.env.BENCH_SCENARIO ?? 'warm';
const COLD_SETTLE_MS = Number(process.env.BENCH_COLD_SETTLE_MS ?? 12000);
if (SCENARIO !== 'warm' && SCENARIO !== 'cold') {
  throw new Error(`BENCH_SCENARIO must be warm or cold, got "${SCENARIO}"`);
}
// First page load on a cold vite pays the whole client transform; orthogonal
// to the measurements (the warm-up gate owns readiness), so freely raisable.
const BOOT_TIMEOUT_MS = Number(process.env.BENCH_BOOT_TIMEOUT_MS ?? 240000);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const OUT =
  process.env.BENCH_OUT ?? path.join('tmp', `border-bench-${LABEL}-${SCENARIO}-${stamp}.json`);

// The crossing: deep Thornpeak (peaks) south across the Mirefen border at
// z=540 into marsh, the reproduced production travel freeze. 2 yd per 66 ms
// is a fast run; slow enough that streaming keeps up in the healthy case.
const CROSSING = { x: 0, fromZ: 700, toZ: 470, stepYd: 2, stepMs: 66 };
const WARMUP_QUIET_MS = 5000;
const WARMUP_QUIET_GAP_MS = 100;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function gitOutput(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

const headSha = gitOutput(['rev-parse', 'HEAD']);
const dirty = (gitOutput(['status', '--porcelain']) ?? '') !== '';
if (process.env.BENCH_HEAD_SHA && process.env.BENCH_HEAD_SHA.trim() !== headSha) {
  throw new Error(`BENCH_HEAD_SHA=${process.env.BENCH_HEAD_SHA} does not match HEAD ${headSha}`);
}

async function startVite() {
  const vite = spawn(
    process.execPath,
    [path.join('node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  vite.stdout.on('data', (chunk) => {
    output += chunk;
  });
  vite.stderr.on('data', (chunk) => {
    output += chunk;
  });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (vite.exitCode !== null) {
      throw new Error(
        `vite exited before ready (port ${PORT} busy? --strictPort refuses fallback):\n${output}`,
      );
    }
    try {
      const res = await fetch(`http://localhost:${PORT}/`);
      if (res.ok) return vite;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  vite.kill('SIGTERM');
  throw new Error(`vite did not become ready on :${PORT} within 30s:\n${output}`);
}

async function warmUp(page) {
  await page.evaluate(
    ({ x, z }) => {
      const g = window.__game;
      const me = g.sim.entities.get(g.sim.playerId);
      me.pos.x = x;
      me.pos.z = z;
      me.prevPos = { ...me.pos };
      me.hp = me.maxHp;
    },
    { x: CROSSING.x, z: CROSSING.fromZ },
  );
  const deadline = Date.now() + WARMUP_TIMEOUT_MS;
  for (;;) {
    if (Date.now() > deadline) throw new Error('warm-up did not settle within the timeout');
    const settled = await page.evaluate(
      async ({ quietMs, quietGapMs }) => {
        const g = window.__game;
        const zs = g.renderer.zoneStreamingStats();
        if (zs.pending > 0) return { settled: false, reason: `pending=${zs.pending}` };
        // Quiet window: no frame gap above the threshold for quietMs.
        const gaps = [];
        let last = performance.now();
        let raf = true;
        const tick = () => {
          const now = performance.now();
          gaps.push(now - last);
          last = now;
          if (raf) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        await new Promise((r) => setTimeout(r, quietMs));
        raf = false;
        const worst = Math.max(...gaps);
        return { settled: worst < quietGapMs, reason: `worstGap=${Math.round(worst)}` };
      },
      { quietMs: WARMUP_QUIET_MS, quietGapMs: WARMUP_QUIET_GAP_MS },
    );
    if (settled.settled) return;
    console.log(`  warm-up: not quiet yet (${settled.reason})`);
    await sleep(2000);
  }
}

async function measureCrossing(page) {
  return page.evaluate(async ({ x, fromZ, toZ, stepYd, stepMs }) => {
    const g = window.__game;
    g.perf.reset();
    const me = g.sim.entities.get(g.sim.playerId);
    const gaps = [];
    let last = performance.now();
    let raf = true;
    const tick = () => {
      const now = performance.now();
      gaps.push(now - last);
      last = now;
      if (raf) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    for (let z = fromZ; z >= toZ; z -= stepYd) {
      me.pos.x = x;
      me.pos.z = z;
      me.prevPos = { ...me.pos };
      await new Promise((r) => setTimeout(r, stepMs));
    }
    raf = false;
    await new Promise((r) => setTimeout(r, 4000));
    const s = g.perf.report();
    const stats = g.renderer.perfStats();
    const sorted = [...gaps].sort((a, b) => b - a);
    return {
      frames: gaps.length,
      worstGaps: sorted.slice(0, 10).map((v) => Math.round(v * 10) / 10),
      stallsOver150: gaps.filter((v) => v >= 150).length,
      stallsOver50: gaps.filter((v) => v >= 50).length,
      programsAdded: s.hitches?.programsAdded ?? null,
      hitchByCause: s.hitches?.byCause ?? null,
      biome: stats.lastFrame?.biome ?? null,
      gpuQueueSlowest: (stats.gpuQueue?.slowest ?? [])
        .slice(0, 10)
        .map((u) => ({ label: u.label, syncMs: u.syncMs, wallMs: u.wallMs })),
      topStalls: (s.devTrace?.frames ?? [])
        .filter((f) => f.stallAttribution)
        .slice(0, 3)
        .map((f) => ({
          submitMs: f.stallAttribution.submitMs,
          programDelta: f.stallAttribution.programDelta,
          firstVisible: f.stallAttribution.diagnostics.firstVisibleObjects.slice(0, 4),
        })),
    };
  }, CROSSING);
}

async function benchRun(browser, runIndex) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
    await page.goto(`http://localhost:${PORT}/?perfTrace=1&perf&gfx=${GFX}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    const entered = await enterOfflineGame(page, {
      charName: 'perfprobe',
      settleMs: 4000,
      gameBootTimeoutMs: BOOT_TIMEOUT_MS,
      selectorTimeoutMs: 60000,
    });
    if (!entered) throw new Error('offline world did not boot');
    const gl = await page.evaluate(() => window.__game.renderer.perfStats().glRenderer ?? '');
    if (/swiftshader|llvmpipe|software/i.test(gl)) {
      throw new Error(`software GL renderer ("${gl}"): numbers would not transfer to real GPUs`);
    }
    // Offline dev world: god mode keeps the probe alive through mob territory
    // (a death mid-crossing would truncate the walk). Best effort: the per-step
    // hp refill in measureCrossing still covers a build without the command.
    await page.evaluate(() => {
      try {
        window.__game.sim.chat('/dev god');
      } catch {
        /* dev command unavailable; hp refill covers it */
      }
    });
    console.log(`run ${runIndex + 1}/${RUNS}: gl="${gl.slice(0, 60)}", scenario=${SCENARIO}`);
    if (SCENARIO === 'warm') {
      await warmUp(page);
    } else {
      await page.evaluate(
        ({ x, z }) => {
          const g = window.__game;
          const me = g.sim.entities.get(g.sim.playerId);
          me.pos.x = x;
          me.pos.z = z;
          me.prevPos = { ...me.pos };
          me.hp = me.maxHp;
        },
        { x: CROSSING.x, z: CROSSING.fromZ },
      );
      await sleep(COLD_SETTLE_MS);
    }
    console.log(`run ${runIndex + 1}/${RUNS}: crossing`);
    const result = await measureCrossing(page);
    console.log(
      `  worst=${result.worstGaps[0]}ms stalls>150=${result.stallsOver150} programsAdded=${result.programsAdded}`,
    );
    return { glRenderer: gl, ...result };
  } finally {
    await page.close().catch(() => {});
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return sorted[Math.floor(sorted.length / 2)];
}

async function main() {
  const vite = await startVite();
  let browser = null;
  try {
    browser = await puppeteer.launch({
      executablePath: BROWSER_PATH,
      headless: false,
      args: [
        '--window-size=1600,900',
        '--ignore-gpu-blocklist',
        '--enable-gpu-rasterization',
        '--use-gl=angle',
        '--use-angle=gl',
        '--enable-webgl',
        '--no-sandbox',
        '--disable-infobars',
        '--mute-audio',
      ],
    });
    const runs = [];
    for (let i = 0; i < RUNS; i++) runs.push(await benchRun(browser, i));
    const evidence = {
      label: LABEL,
      headSha,
      dirty,
      gfx: GFX,
      port: PORT,
      scenario: SCENARIO,
      startedAt: stamp,
      crossing: CROSSING,
      runs,
      aggregate: {
        medianWorstGapMs: median(runs.map((r) => r.worstGaps[0])),
        maxWorstGapMs: Math.max(...runs.map((r) => r.worstGaps[0])),
        medianStallsOver150: median(runs.map((r) => r.stallsOver150)),
        medianProgramsAdded: median(runs.map((r) => r.programsAdded ?? 0)),
      },
    };
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(evidence, null, 2));
    console.log(`\n${LABEL} @ ${headSha}${dirty ? ' (dirty)' : ''}`);
    console.log(JSON.stringify(evidence.aggregate, null, 2));
    console.log(`evidence: ${OUT}`);
  } finally {
    await browser?.close().catch(() => {});
    vite.kill('SIGTERM');
  }
}

await main();
