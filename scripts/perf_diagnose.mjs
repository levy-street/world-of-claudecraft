// One-command local bottleneck diagnosis (headed, real GPU, vsync off).
//
// Launches the real game against a running dev server, runs a FIXED scenario
// (20s town idle at the frozen waypoint, then a 20s forward walk), and folds
// three signal sources into one verdict: the harness frame collector (wall
// frame times), the renderer's perfStats() surface (draw counters, phase
// spans, prewarm, and the GPU section timer where this branch exposes it), and
// the cross-platform system sampler (whole-system GPU utilization plus the
// browser process-tree CPU). The verdict logic here is deliberately simple:
// the authoritative classifier lives client-side (src/render/bottleneck_core.ts).
//
//   npm run dev                          # :5173
//   node scripts/perf_diagnose.mjs      (or: npm run perf:diagnose)
//
// Env: WOC_URL game origin (default http://localhost:5173); PERF_PRESET
// low|medium|high|ultra|insane (default high); BROWSER_PATH as in the other
// browser scripts. Writes the full JSON report to tmp/perf_diagnose/.
import fs from 'node:fs';
import path from 'node:path';
import { aggregateSystemWindow } from './lib/perf_baseline_store.mjs';
import { Profiler } from './profiler/harness.mjs';
import { frameStats } from './profiler/metrics.mjs';
import { startSystemSampler } from './profiler/system_sampler.mjs';

const GAME_URL = process.env.WOC_URL ?? 'http://localhost:5173';
const PRESET = process.env.PERF_PRESET ?? 'high';
// woc_settings numeric values per preset label (src/render/gfx.ts
// PRESET_LOW..PRESET_INSANE; 5 is the Advanced custom profile, never a bench
// target). Same mapping as scripts/perf_baseline.mjs and scripts/perf_tour.mjs.
const PRESET_VALUES = { low: 1, medium: 2, high: 3, ultra: 4, insane: 6 };
const STEP_MS = 20000;
const TARGET_FPS = 60;
// The frozen town-idle waypoint the other perf scripts park at
// (scripts/perf_attrib.mjs TOWN) and the open-field walk start from
// scripts/profile.mjs scenarioFps open-run.
const TOWN = { x: 0, z: -14, facing: 0 };
const WALK = { x: 0, z: 60, facing: Math.PI };

// Verdict thresholds, mirroring the src/render/bottleneck_core.ts tunables.
const GPU_DOMINANT_RATIO = 0.8;
const GPU_MINOR_RATIO = 0.55;
const SUBMIT_DOMINANT_RATIO = 0.5;
const COMPILE_STALL_PROGRAM_DELTA = 6;
const COMPILE_STALL_LONG_TASK_MS = 50;

// The heavy tiers spend well over the profiler's default 30s in boot
// prewarm/shader compile on a cold cache; widen unless the caller already did.
if (!process.env.PROF_BOOT_TIMEOUT_MS) process.env.PROF_BOOT_TIMEOUT_MS = '120000';

// Absolute backstop: a wedged browser must never hang the diagnosis silently.
const WATCHDOG_MS = 10 * 60000;
setTimeout(() => {
  console.error(`watchdog: run exceeded ${WATCHDOG_MS / 60000} minutes; force exit`);
  process.exit(3);
}, WATCHDOG_MS).unref();

function die(msg) {
  console.error(msg);
  process.exit(1);
}

async function preflight() {
  let text = '';
  try {
    const res = await fetch(GAME_URL, { signal: AbortSignal.timeout(10000) });
    text = await res.text();
  } catch (e) {
    die(`dev server not reachable at ${GAME_URL}; start it with 'npm run dev' (${e.message})`);
  }
  if (!/claudecraft/i.test(text)) {
    die(
      `the server at ${GAME_URL} does not look like World of ClaudeCraft (another app on this port?); set WOC_URL to the right origin`,
    );
  }
}

// Seed the persisted settings before any app script runs (the same pre-boot
// woc_settings seeding perf_baseline.mjs and perf_tour.mjs use): fullscreen
// off so the bench window stays a parked window, and graphicsPreset so the HUD
// effect profile matches the benched tier (?gfx= forces only the renderer tier).
async function seedSettings(p) {
  await p.page.evaluateOnNewDocument((presetValue) => {
    try {
      const key = 'woc_settings';
      const cur = JSON.parse(localStorage.getItem(key) ?? '{}');
      cur.fullscreen = 0;
      if (presetValue) cur.graphicsPreset = presetValue;
      localStorage.setItem(key, JSON.stringify(cur));
    } catch {
      /* storage unavailable */
    }
  }, PRESET_VALUES[PRESET] ?? 0);
}

// Narrow read of window.__game.renderer.perfStats() (the same surface the
// harness collector and perf_tour.mjs read). The gpu block and the
// gpuTimerSupported flag are being added on this branch; both stay null where
// the client does not expose them yet, and every failure degrades to null.
function readPerfStats(page) {
  return page
    .evaluate(() => {
      try {
        const r = window.__game?.renderer;
        if (!r || typeof r.perfStats !== 'function') return null;
        const ps = r.perfStats();
        if (!ps) return null;
        return {
          tier: ps.tier ?? null,
          calls: ps.calls ?? null,
          triangles: ps.triangles ?? null,
          programs: ps.programs ?? null,
          prewarm: ps.prewarm
            ? {
                elapsedMs: ps.prewarm.elapsedMs,
                maxMs: ps.prewarm.maxMs,
                timedOut: ps.prewarm.timedOut,
                budgetUsedRatio: ps.prewarm.budgetUsedRatio,
                compileMode: ps.prewarm.compileMode,
                compileMs: ps.prewarm.compileMs,
                programsBefore: ps.prewarm.programsBefore,
                programsAfter: ps.prewarm.programsAfter,
                manifestPlanned: ps.prewarm.manifestPlanned,
                manifestCompleted: ps.prewarm.manifestCompleted,
                manifestTimedOut: ps.prewarm.manifestTimedOut,
                manifestFailed: ps.prewarm.manifestFailed,
              }
            : null,
          phaseMs: ps.phaseMs ?? null,
          gpu: ps.gpu ?? null,
          gpuTimerSupported:
            typeof ps.gpuTimerSupported === 'boolean' ? ps.gpuTimerSupported : null,
        };
      } catch {
        return null;
      }
    })
    .catch(() => null);
}

// One harness sample plus the raw per-frame deltas behind it. sample() folds
// frames into stats and drops the raw array; window.__prof.frames still holds
// the window's deltas until the next start(), so grab them for the combined
// whole-run frameStats.
async function runStep(p, rawFrames, opts) {
  const sample = await p.sample(opts);
  const frames = await p.page.evaluate(() => (window.__prof?.frames ?? []).slice()).catch(() => []);
  rawFrames.push(...frames);
  return sample;
}

// Local, deliberately simple bottleneck call. Order mirrors the client core:
// compile stalls trump throughput, then the GPU-timer verdicts, then the
// inferred low-confidence arm for machines without the timer extension.
function computeVerdict({ wallP95, gpuP95, programGrowth, longTaskP95, submitP95 }) {
  const r1 = (v) => Math.round(v * 10) / 10;
  if (!Number.isFinite(wallP95) || wallP95 <= 0) {
    return { verdict: 'unknown', confidence: 'low', detail: 'no frame data collected' };
  }
  if (programGrowth >= COMPILE_STALL_PROGRAM_DELTA && longTaskP95 >= COMPILE_STALL_LONG_TASK_MS) {
    return {
      verdict: 'compile-stalls',
      confidence: 'high',
      detail: `${programGrowth} programs linked mid-run with long tasks (p95 ${r1(longTaskP95)}ms)`,
    };
  }
  if (Number.isFinite(gpuP95) && gpuP95 > 0) {
    if (gpuP95 >= GPU_DOMINANT_RATIO * wallP95) {
      return {
        verdict: 'gpu-bound',
        confidence: 'high',
        detail: `gpu frame p95 ${r1(gpuP95)}ms of wall p95 ${r1(wallP95)}ms`,
      };
    }
    if (gpuP95 < GPU_MINOR_RATIO * wallP95) {
      return {
        verdict: 'cpu-bound',
        confidence: 'medium',
        detail: `gpu frame p95 ${r1(gpuP95)}ms well under wall p95 ${r1(wallP95)}ms`,
      };
    }
    return {
      verdict: 'balanced',
      confidence: 'medium',
      detail: `gpu ${r1(gpuP95)}ms and cpu share the ${r1(wallP95)}ms frame`,
    };
  }
  if (Number.isFinite(submitP95) && submitP95 >= SUBMIT_DOMINANT_RATIO * wallP95) {
    return {
      verdict: 'inferred-gpu-bound',
      confidence: 'low',
      detail: `no gpu timer; submit phase p95 ${r1(submitP95)}ms dominates wall p95 ${r1(wallP95)}ms`,
    };
  }
  return {
    verdict: 'unknown',
    confidence: 'low',
    detail: 'no gpu timer and no dominant submit phase',
  };
}

// aggregateSystemWindow folds the four cross-platform keys; the Windows
// sampler also carries GPU memory, folded here the same way.
function foldMetric(points, key, t0, t1) {
  const vals = (points ?? [])
    .filter((pt) => pt && pt.t >= t0 && pt.t <= t1)
    .map((pt) => pt[key])
    .filter((v) => Number.isFinite(v));
  if (!vals.length) return null;
  return {
    avg: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10,
    max: Math.round(Math.max(...vals) * 10) / 10,
    n: vals.length,
  };
}

function frameLine(label, f) {
  if (!f) return `  ${label.padEnd(12)} no frames`;
  return (
    `  ${label.padEnd(12)} fps ${f.fpsMean} (1%low ${f.fpsLow1})  ` +
    `p50 ${f.p50Ms}ms p95 ${f.p95Ms}ms p99 ${f.p99Ms}ms max ${f.maxMs}ms  jank ${f.jankPct}%`
  );
}

function fmtFold(fold, unit = '') {
  return fold ? `avg ${fold.avg}${unit} max ${fold.max}${unit} (n=${fold.n})` : 'n/a';
}

function printGpuBlock(gpu, gpuTimerSupported) {
  if (!gpu || !Number.isFinite(gpu.frameP95Ms)) {
    const why = gpuTimerSupported === false ? ' (extension unsupported)' : '';
    console.log(`gpu timer: unavailable${why}`);
    return;
  }
  console.log(
    `gpu frame: avg ${gpu.frameAvgMs}ms p50 ${gpu.frameP50Ms}ms p95 ${gpu.frameP95Ms}ms ` +
      `max ${gpu.frameMaxMs}ms (${gpu.frames} frames, ${gpu.disjoints} disjoints, ` +
      `${gpu.starvedFrames} starved)`,
  );
  const sections = gpu.sections ?? [];
  if (sections.length) {
    console.log(
      `  ${'section'.padEnd(16)} ${'avg ms'.padStart(8)} ${'p95 ms'.padStart(8)} ${'samples'.padStart(8)}`,
    );
    for (const s of sections) {
      console.log(
        `  ${String(s.label).padEnd(16)} ${String(s.avgMs).padStart(8)} ` +
          `${String(s.p95Ms).padStart(8)} ${String(s.samples).padStart(8)}`,
      );
    }
  }
}

function stampNow() {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-` +
    `${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`
  );
}

async function main() {
  if (!PRESET_VALUES[PRESET]) {
    die(`PERF_PRESET must be one of: ${Object.keys(PRESET_VALUES).join(', ')} (got '${PRESET}')`);
  }
  await preflight();
  console.log(
    `perf diagnose: url=${GAME_URL} preset=${PRESET} ` +
      `(headed, real GPU, vsync off, 2 x ${STEP_MS / 1000}s steps)`,
  );
  const p = new Profiler({
    gameUrl: GAME_URL,
    width: 1280,
    height: 720,
    // Same anti-throttling switches as perf_baseline.mjs: a backgrounded or
    // occluded headed window stops producing frames and poisons the numbers.
    extraArgs: [
      '--disable-backgrounding-occluded-windows',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--mute-audio',
    ],
  });
  let sampler = null;
  const samples = [];
  const rawFrames = [];
  let statsBefore = null;
  let statsAfter = null;
  let t0 = 0;
  let t1 = 0;
  try {
    await p.launch();
    await seedSettings(p);
    await p.page.bringToFront();
    sampler = startSystemSampler({ browserPid: p.browser?.process()?.pid ?? null });
    // governor=0 pins the adaptive render governor OFF so it cannot shed
    // visual density mid-diagnosis (same trade as scripts/perf_baseline.mjs).
    await p.enter({
      mode: 'offline',
      tier: PRESET,
      selectorTimeoutMs: 60000,
      extraQuery: '&governor=0',
    });
    await p.page.bringToFront();
    const visible = await p.page
      .evaluate(() => document.visibilityState === 'visible')
      .catch(() => false);
    if (!visible) {
      console.error('  WARNING: the bench window is hidden or covered; numbers will be dishonest');
    }
    statsBefore = await readPerfStats(p.page);
    t0 = Date.now();
    console.log(`  sampling town idle (${STEP_MS / 1000}s at the frozen waypoint)`);
    await p.teleport(TOWN.x, TOWN.z, TOWN.facing);
    samples.push(await runStep(p, rawFrames, { ms: STEP_MS, label: 'town-idle' }));
    console.log(`  sampling walk (${STEP_MS / 1000}s forward run)`);
    await p.teleport(WALK.x, WALK.z, WALK.facing);
    await p.setMove({ forward: true });
    samples.push(await runStep(p, rawFrames, { ms: STEP_MS, label: 'walk' }));
    await p.stopMove();
    t1 = Date.now();
    statsAfter = await readPerfStats(p.page);
  } finally {
    sampler?.stop();
    await p.close();
  }

  const overallFrame = frameStats(rawFrames, TARGET_FPS);
  const points = sampler?.points ?? [];
  const sysWindow = aggregateSystemWindow(points, t0, t1);
  const gpuMemUsed = foldMetric(points, 'gpuMemUsedMb', t0, t1);
  const gpuMemTotal = foldMetric(points, 'gpuMemTotalMb', t0, t1);

  const newPrograms = samples.flatMap((s) => s.newPrograms ?? []);
  const progBefore = statsBefore?.programs ?? null;
  const progAfter = statsAfter?.programs ?? null;
  const programGrowth =
    Number.isFinite(progBefore) && Number.isFinite(progAfter)
      ? Math.max(0, progAfter - progBefore)
      : newPrograms.length;
  const longTaskP95 = Math.max(0, ...samples.map((s) => s.longTaskP95 ?? 0));
  const gpu = statsAfter?.gpu ?? null;
  const submitP95 = statsAfter?.phaseMs?.submit?.p95 ?? null;
  const verdict = computeVerdict({
    wallP95: overallFrame?.p95Ms ?? null,
    gpuP95: gpu?.frameP95Ms ?? null,
    programGrowth,
    longTaskP95,
    submitP95,
  });

  console.log('\n========== DIAGNOSIS ==========');
  for (const s of samples) console.log(frameLine(s.label, s.frame));
  console.log(frameLine('overall', overallFrame));
  if (statsAfter) {
    const tris = Number.isFinite(statsAfter.triangles)
      ? `${(statsAfter.triangles / 1e6).toFixed(2)}M`
      : '?';
    console.log(
      `renderer: tier ${statsAfter.tier}  calls ${statsAfter.calls}  tris ${tris}  ` +
        `programs ${statsAfter.programs}`,
    );
    const pw = statsAfter.prewarm;
    if (pw) {
      console.log(
        `prewarm: ${pw.elapsedMs}ms of ${pw.maxMs}ms budget (${pw.compileMode} compile ` +
          `${pw.compileMs}ms), ${pw.manifestCompleted}/${pw.manifestPlanned} entries, ` +
          `${pw.manifestTimedOut} timed out, ${pw.manifestFailed} failed` +
          (pw.timedOut ? ', EXCEEDED BUDGET' : ''),
      );
    }
    const phase = statsAfter.phaseMs ?? {};
    const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : '?');
    const ph = (k) => (phase[k] ? `${k} ${r1(phase[k].avg)}/${r1(phase[k].p95)}ms` : `${k} n/a`);
    console.log(
      `renderer phases (avg/p95): ${['entities', 'world', 'submit', 'total'].map(ph).join('  ')}`,
    );
  } else {
    console.log('renderer perfStats: unavailable');
  }
  printGpuBlock(gpu, statsAfter?.gpuTimerSupported ?? null);
  console.log(
    `program growth during run: ${progBefore ?? '?'} -> ${progAfter ?? '?'} ` +
      `(${newPrograms.length} new shader cacheKeys linked in the sampled windows)`,
  );
  for (const key of newPrograms.slice(0, 8)) {
    console.log(`    - ${String(key).replace(/\s+/g, ' ').slice(0, 140)}`);
  }
  console.log(
    `system: proc-tree cpu ${fmtFold(sysWindow.procCpuPct, '%')}  ` +
      `system cpu ${fmtFold(sysWindow.cpuPct, '%')}  gpu ${fmtFold(sysWindow.gpuPct, '%')}  ` +
      `gpu power ${fmtFold(sysWindow.gpuPowerW, 'W')}` +
      (gpuMemUsed ? `  gpu mem avg ${gpuMemUsed.avg}/${gpuMemTotal?.avg ?? '?'}MB` : ''),
  );
  console.log(`\nverdict: ${verdict.verdict} [${verdict.confidence} confidence] ${verdict.detail}`);

  const report = {
    at: new Date().toISOString(),
    gameUrl: GAME_URL,
    preset: PRESET,
    stepMs: STEP_MS,
    platform: process.platform,
    verdict,
    frame: {
      perStep: samples.map((s) => ({ label: s.label, ...s.frame })),
      overall: overallFrame,
    },
    renderer: { before: statsBefore, after: statsAfter },
    programs: { before: progBefore, after: progAfter, growth: programGrowth, newPrograms },
    gpuTimer: gpu,
    gpuTimerSupported: statsAfter?.gpuTimerSupported ?? null,
    system: {
      window: sysWindow,
      gpuMemUsedMb: gpuMemUsed,
      gpuMemTotalMb: gpuMemTotal,
      points,
    },
    samples,
  };
  const outDir = path.join('tmp', 'perf_diagnose');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `report-${stampNow()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`report: ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
