// Graphics-preset performance baseline harness: one command to measure a preset
// (average FPS first, plus 1% lows, frame percentiles, browser-tree CPU and
// system GPU), persist every run to a history, freeze a baseline, and judge any
// later run against it. Wraps the existing Profiler (scripts/profiler/harness.mjs:
// headed, real GPU, vsync off) with a FIXED scenario suite so runs stay comparable
// over time; pure record/compare/report logic lives in
// scripts/lib/perf_baseline_store.mjs (pinned by tests/perf_baseline_store.test.mjs).
//
//   npm run dev                                            # :5173 (offline world, no game server)
//   node scripts/perf_baseline.mjs baseline --preset low   # record + freeze the target baseline
//   node scripts/perf_baseline.mjs run --preset insane     # measure, append history, compare
//   node scripts/perf_baseline.mjs report                  # performance history over time
//   node scripts/perf_baseline.mjs compare --preset insane --baseline low   # stored records only
//   node scripts/perf_baseline.mjs shots --preset insane --out tmp/perf-parity/before
//   node scripts/perf_baseline.mjs diff-shots --a tmp/perf-parity/before --b tmp/perf-parity/after
//   node scripts/perf_baseline.mjs clear [--baselines]
//
// Options: --ms N per-scenario sample window (default 5000); --gate exit 1 on a
// failed comparison; --note "text"; --fps-tol / --sys-tol tolerance percents;
// GAME_URL / BROWSER_PATH as in the other browser scripts.
// Data: docs/perf/baseline/history.jsonl and baseline-<preset>.json (commit these
// for a durable history); full raw runs land in tmp/perf-baseline/ (gitignored).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import {
  aggregateSystemWindow,
  compareRuns,
  formatCompare,
  historyTable,
  makeRunRecord,
  parseHistoryJsonl,
  SUITE_LABELS,
  summarizeScenario,
} from './lib/perf_baseline_store.mjs';
import { Profiler } from './profiler/harness.mjs';
import { startSystemSampler } from './profiler/system_sampler.mjs';

// Scenario labels come from the store module (the tested, pinned home of the
// suite contract) so history rows can never fork from the comparison keys.
const [L_TOWN_IDLE, L_TOWN_LOOK, L_OPEN_RUN, L_EAST_RUN, L_COMBAT_VFX] = SUITE_LABELS;

const GAME_URL = process.env.GAME_URL ?? 'http://localhost:5173';
// FIXED bench viewport. 1280x720 is deliberate twice over: numbers are only
// comparable at one resolution (it is stamped into every record and checked at
// compare time), and the insane tier's boot floods GPU context creation hard
// enough at 1920+ with vsync off that Chrome kills the WebGL contexts and the
// world never boots. The window is also parked at the screen edge so a bench
// leaves room to work; it must stay VISIBLE (fully covering it lets the OS
// throttle rendering and poisons the numbers).
const BENCH_W = 1280;
const BENCH_H = 720;
const BENCH_VIEWPORT = `${BENCH_W}x${BENCH_H}`;
const PROFILER_OPTS = {
  width: BENCH_W,
  height: BENCH_H,
  // The world boots off requestAnimationFrame, so a backgrounded tab or an
  // occluded window (Chrome throttles both) stalls boot forever and poisons any
  // sample. Every run also keeps the game tab fronted (bringToFront below).
  extraArgs: [
    '--disable-backgrounding-occluded-windows',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--mute-audio',
  ],
};

// A wedged browser must never hang the harness silently (a failed boot once sat
// in browser.close() forever with the error unprinted): close with a deadline,
// then kill the process outright.
async function closeSafely(p) {
  const proc = p.browser?.process() ?? null;
  let timer;
  await Promise.race([
    p.close().finally(() => clearTimeout(timer)),
    new Promise((r) => {
      timer = setTimeout(r, 8000);
      timer.unref?.();
    }),
  ]);
  try {
    if (proc && proc.exitCode == null) proc.kill('SIGKILL');
  } catch {
    /* already gone */
  }
}

// woc_settings numeric values for each preset label (src/render/gfx.ts
// PRESET_LOW..PRESET_INSANE; 5 is the Advanced custom profile, never a bench
// target). Same mapping as scripts/perf_tour.mjs.
const PRESET_VALUES = { low: 1, medium: 2, high: 3, ultra: 4, insane: 6 };

// Seed the persisted settings before any app script runs (the same pre-boot
// woc_settings seeding perf_tour.mjs uses). Two seeds matter for honest runs:
// fullscreen off (the game fullscreens itself on world entry by default, and a
// bench window must stay a parked window), and graphicsPreset to the benched
// preset, because the ?gfx= query forces only the RENDERER tier while the HUD
// effect profile resolves from settings (src/main.ts applier); without the seed
// a low-vs-insane comparison holds the HUD half of frame cost constant.
async function seedBenchSettings(p, preset) {
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
  }, PRESET_VALUES[preset] ?? 0);
}

// Park the headed bench window against the top-right screen edge instead of the
// default centered near-fullscreen placement.
async function parkWindow(p) {
  try {
    const session = await p.page.createCDPSession();
    const { windowId } = await session.send('Browser.getWindowForTarget');
    await session.send('Browser.setWindowBounds', {
      windowId,
      bounds: { left: 340, top: 30, width: BENCH_W, height: BENCH_H + 120 },
    });
    await session.detach();
  } catch {
    /* window placement is cosmetic; never fail a bench over it */
  }
}
const DATA_DIR = path.join('docs', 'perf', 'baseline');
const RAW_DIR = path.join('tmp', 'perf-baseline');
const HISTORY = path.join(DATA_DIR, 'history.jsonl');
const PRESETS = ['low', 'medium', 'high', 'ultra', 'insane'];

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--'))
      a[t.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    else a._.push(t);
  }
  return a;
}
const args = parseArgs(process.argv.slice(2));
const cmd = args._[0] ?? 'help';

// A bare numeric flag (`--ms` with no value) parses as boolean true and
// Number(true) is 1, which silently means a 1ms sample window or a 1 minute
// watchdog; demand a real value instead.
function numOpt(name, def) {
  const v = args[name];
  if (v === undefined) return def;
  const n = Number(v);
  if (v === true || !Number.isFinite(n)) die(`--${name} needs a numeric value, got ${v}`);
  return n;
}

const SAMPLE_MS = numOpt('ms', 5000);
// The heavy tiers spend well over the profiler's default 30s in boot
// prewarm/shader compile on a cold cache; widen unless the caller already did.
// Headless shots run on SwiftShader (software raster), so give them longer still.
if (!process.env.PROF_BOOT_TIMEOUT_MS) {
  process.env.PROF_BOOT_TIMEOUT_MS = cmd === 'shots' ? '300000' : '120000';
}

// Absolute backstop: force-exit if a whole invocation overruns (default 12 min;
// a healthy suite is 2 to 3). unref so it never keeps a finished run alive.
const WATCHDOG_MS = numOpt('watchdog-min', 12) * 60000;
setTimeout(() => {
  console.error(`watchdog: run exceeded ${WATCHDOG_MS / 60000} minutes; force exit`);
  process.exit(3);
}, WATCHDOG_MS).unref();

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function requirePreset() {
  const preset = args.preset;
  if (!PRESETS.includes(preset)) die(`--preset must be one of: ${PRESETS.join(', ')}`);
  return preset;
}

function baselinePath(preset) {
  return path.join(DATA_DIR, `baseline-${preset}.json`);
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
      `the server at ${GAME_URL} does not look like World of ClaudeCraft (another app on this port?); set GAME_URL to the right origin`,
    );
  }
}

function gitMeta() {
  const run = (cmdArgs) => {
    try {
      return execFileSync('git', cmdArgs, { encoding: 'utf8' }).trim();
    } catch {
      return null;
    }
  };
  const commit = run(['rev-parse', '--short=12', 'HEAD']);
  const branch = run(['rev-parse', '--abbrev-ref', 'HEAD']);
  const dirty = (run(['status', '--porcelain']) ?? '') !== '';
  return { commit, branch, dirty };
}

function machineLabel() {
  const cpu = os.cpus()[0]?.model ?? 'unknown-cpu';
  return `${cpu} ${os.arch()} ${Math.round(os.totalmem() / 2 ** 30)}GB`;
}

// Every step gets an individual deadline so a wedged renderer surfaces as a
// named failure in seconds, not a silent stall the global watchdog reaps at the
// 12 minute mark.
function withDeadline(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}: exceeded ${ms}ms step deadline`)), ms);
      timer.unref?.();
    }),
  ]);
}

// A fully covered or minimized headed window stops producing frames (Chrome
// throttles it), which freezes rAF sampling and wedges screenshots. Rather than
// hang, tell the operator what to fix and fail if it stays hidden.
async function requireWindowVisible(p, where) {
  const deadline = Date.now() + 60000;
  let warned = false;
  while (Date.now() < deadline) {
    const state = await p.page.evaluate(() => document.visibilityState).catch(() => 'unknown');
    if (state === 'visible') return;
    if (!warned) {
      console.error(
        `  ${where}: the bench window is hidden or fully covered; uncover it to continue (waiting up to 60s)`,
      );
      warned = true;
    }
    await p.page.bringToFront().catch(() => {});
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`${where}: bench window stayed hidden; a covered window cannot render honestly`);
}

// The insane tier can kill the page's WebGL contexts under pressure (observed as
// a context-loss cascade at boot on large windows). A run where the renderer
// died mid-way must FAIL loudly, never record a sample of a dead canvas.
async function assertRendererAlive(p, where) {
  const lost = await withDeadline(
    p.page.evaluate(() => window.__game?.perf?.report()?.renderer?.contextLost ?? 0),
    20000,
    `${where}: renderer health check`,
  ).catch((e) => {
    throw new Error(`${where}: renderer health check failed (${e.message})`);
  });
  if (lost) throw new Error(`${where}: WebGL context lost ${lost} time(s); run is invalid`);
}

// The FIXED scenario suite. Labels and waypoints are the comparison key across
// history rows and presets: never edit them casually, add a new label instead.
// Waypoints follow scripts/profile.mjs (town / open field / east biome, combat
// spot from its combat scenario); interactions come from the Profiler primitives.
async function runSuite(p, ms, sampler) {
  const out = [];
  const timed = async (label, prep, fn) => {
    await requireWindowVisible(p, label);
    if (prep) await withDeadline(prep(), 45000, `${label}: setup`);
    const t0 = Date.now();
    const sample = await withDeadline(fn(label), ms + 60000, label);
    const t1 = Date.now();
    await assertRendererAlive(p, label);
    out.push({ sample, window: aggregateSystemWindow(sampler.points, t0, t1) });
    console.log(
      `  ${label.padEnd(12)} fps ${sample.frame?.fpsMean ?? '-'} (1%low ${sample.frame?.fpsLow1 ?? '-'}) p95 ${sample.frame?.p95Ms ?? '-'}ms`,
    );
  };
  await timed(
    L_TOWN_IDLE,
    () => p.teleport(0, -14, 0),
    (l) => p.sample({ ms, label: l }),
  );
  await timed(L_TOWN_LOOK, null, async (l) => {
    const sweeps = (async () => {
      for (let i = 0; i < 4; i++) await p.lookSweep({ yaw: i % 2 ? -1 : 1, frames: 22 });
    })();
    const s = await p.sample({ ms, label: l });
    await sweeps;
    return s;
  });
  await timed(
    L_OPEN_RUN,
    async () => {
      await p.teleport(0, 60, Math.PI);
      await p.setMove({ forward: true });
    },
    (l) => p.sample({ ms, label: l }),
  );
  await p.stopMove();
  await timed(
    L_EAST_RUN,
    async () => {
      await p.teleport(120, 80, Math.PI / 2);
      await p.setMove({ forward: true });
    },
    (l) => p.sample({ ms, label: l }),
  );
  await p.stopMove();
  await timed(
    L_COMBAT_VFX,
    () => p.teleport(30, 90, Math.PI),
    async (l) => {
      const fire = p.combat({ ms });
      const s = await p.sample({ ms, label: l });
      await fire;
      return s;
    },
  );
  return out;
}

async function measurePreset(preset) {
  await preflight();
  console.log(
    `measuring preset '${preset}' (headed, real GPU, vsync off, ${SAMPLE_MS}ms/scenario)`,
  );
  const p = new Profiler(PROFILER_OPTS);
  let suite = [];
  let sampler = null;
  try {
    await p.launch();
    await seedBenchSettings(p, preset);
    await parkWindow(p);
    await p.page.bringToFront();
    const browserPid = p.browser?.process()?.pid ?? null;
    sampler = startSystemSampler({ browserPid });
    // governor=0 pins the adaptive render governor OFF (src/render/gfx.ts
    // shouldUseAutoGovernor): armed, it sheds visual density under load, so a
    // slow preset would report better FPS than its honest fixed-visuals cost.
    await p.enter({
      mode: 'offline',
      tier: preset,
      selectorTimeoutMs: 60000,
      extraQuery: '&governor=0',
    });
    await parkWindow(p);
    await p.page.bringToFront();
    suite = await runSuite(p, SAMPLE_MS, sampler);
  } catch (e) {
    console.error(`bench failed: ${e.message}`);
    throw e;
  } finally {
    sampler?.stop();
    await closeSafely(p);
  }
  if (sampler && !sampler.macmonAvailable()) {
    console.log('note: macmon not available; GPU and system CPU columns will be empty');
  }
  const scenarios = suite.map(({ sample, window }) => summarizeScenario(sample, window));
  const meta = {
    at: new Date().toISOString(),
    ...gitMeta(),
    preset,
    note: typeof args.note === 'string' ? args.note : '',
    machine: machineLabel(),
    sampleMs: SAMPLE_MS,
    viewport: BENCH_VIEWPORT,
  };
  const record = makeRunRecord(meta, scenarios);
  if (record.flags.tierMismatch || record.flags.governorEngaged) {
    console.error(
      `WARNING: run is not comparable (tierMismatch=${record.flags.tierMismatch} governorEngaged=${record.flags.governorEngaged}); comparisons against it will FAIL`,
    );
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.appendFileSync(HISTORY, `${JSON.stringify(record)}\n`);
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const rawPath = path.join(RAW_DIR, `run-${preset}-${meta.at.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(rawPath, JSON.stringify({ record, suite }, null, 2));
  console.log(
    `recorded run: overall fps ${record.overall.fpsMean} (min scenario ${record.overall.fpsMin})`,
  );
  console.log(`history: ${HISTORY}  raw: ${rawPath}`);
  return record;
}

function loadBaseline(preset) {
  const file = baselinePath(preset);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function lastRunFor(preset) {
  if (!fs.existsSync(HISTORY)) return null;
  const { records } = parseHistoryJsonl(fs.readFileSync(HISTORY, 'utf8'));
  const runs = records.filter((r) => r.preset === preset);
  return runs[runs.length - 1] ?? null;
}

function printCompare(baseRecord, candRecord, baseLabel, candLabel) {
  const cmp = compareRuns(baseRecord, candRecord, {
    fpsTolerancePct: numOpt('fps-tol', 3),
    sysTolerancePct: numOpt('sys-tol', 15),
  });
  for (const line of formatCompare(cmp, baseLabel, candLabel)) console.log(line);
  if (!cmp.ok && args.gate) process.exitCode = 1;
  return cmp;
}

async function cmdBaseline() {
  const preset = requirePreset();
  const record = await measurePreset(preset);
  if (record.flags.tierMismatch || record.flags.governorEngaged) {
    die('refusing to freeze a non-comparable run as the baseline (see WARNING above)');
  }
  fs.writeFileSync(baselinePath(preset), `${JSON.stringify(record, null, 2)}\n`);
  console.log(`baseline frozen: ${baselinePath(preset)}`);
}

async function cmdRun() {
  const preset = requirePreset();
  const record = await measurePreset(preset);
  const basePreset = typeof args.baseline === 'string' ? args.baseline : 'low';
  const base = loadBaseline(basePreset);
  if (!base) {
    console.log(
      `no baseline for '${basePreset}' yet; record one with: node scripts/perf_baseline.mjs baseline --preset ${basePreset}`,
    );
    return;
  }
  printCompare(base, record, `${basePreset} (frozen ${base.at})`, `${preset} (this run)`);
}

function cmdReport() {
  if (!fs.existsSync(HISTORY)) die(`no history at ${HISTORY}; record a run first`);
  const { records, skipped } = parseHistoryJsonl(fs.readFileSync(HISTORY, 'utf8'));
  for (const line of historyTable(records)) console.log(line);
  if (skipped) console.log(`(${skipped} corrupt history line(s) skipped)`);
}

function cmdCompare() {
  const preset = requirePreset();
  const basePreset = typeof args.baseline === 'string' ? args.baseline : 'low';
  const base = loadBaseline(basePreset);
  if (!base) die(`no frozen baseline for '${basePreset}'; run the baseline subcommand first`);
  const cand = lastRunFor(preset);
  if (!cand) die(`no recorded run for preset '${preset}' in ${HISTORY}`);
  printCompare(base, cand, `${basePreset} (frozen ${base.at})`, `${preset} (last run ${cand.at})`);
}

// Visual-parity screenshots: fixed waypoints, fixed camera, DOM HUD hidden, no
// profiler overlay. Diff two shot sets (same preset, before vs after a change)
// with diff-shots; calibrate the noise floor by diffing two runs of the SAME
// build first (the world animates, so identical builds never diff to zero).
const SHOT_POINTS = [
  { name: 'town', x: 0, z: -14, f: 0 },
  { name: 'open', x: 0, z: 60, f: Math.PI },
  { name: 'east', x: 120, z: 80, f: Math.PI / 2 },
  { name: 'combat', x: 30, z: 90, f: Math.PI },
];

async function cmdShots() {
  const preset = requirePreset();
  const outDir = typeof args.out === 'string' ? args.out : path.join('tmp', 'perf-parity', preset);
  await preflight();
  fs.mkdirSync(outDir, { recursive: true });
  // Headless SwiftShader on purpose: parity shots need correct pixels, not real
  // performance, and a headed window stops producing frames the moment other
  // work covers it (Page.captureScreenshot then wedges). Software raster is also
  // the more deterministic pixel source for diffing (same trade as the wiki
  // stills; see scripts/wiki/render_model_stills.mjs).
  const p = new Profiler({ ...PROFILER_OPTS, headless: true });
  console.log(`parity shots: preset '${preset}' -> ${outDir} (headless swiftshader)`);
  try {
    await p.launch();
    console.log('  browser up');
    await seedBenchSettings(p, preset);
    console.log('  entering world (heavy tiers can take minutes on software raster)');
    await p.enter({
      mode: 'offline',
      tier: preset,
      selectorTimeoutMs: 60000,
      gameBootTimeoutMs: Number(process.env.PROF_BOOT_TIMEOUT_MS),
      extraQuery: '&governor=0',
    });
    console.log('  world booted');
    await p.page.evaluate(() => {
      const ui = document.querySelector('#ui');
      if (ui) ui.style.visibility = 'hidden';
      document.querySelector('#__prof_overlay')?.remove();
      // The ?perf flag mounts the live stats overlay as an anonymous div on
      // document.body (src/game/perf.ts mountOverlay); its fps/heap text varies
      // every frame and would pollute the pixel diff. The title is its one
      // stable selector hook.
      document.querySelector('div[title="Click to copy a JSON perf report"]')?.remove();
    });
    for (const wp of SHOT_POINTS) {
      await withDeadline(
        (async () => {
          await p.teleport(wp.x, wp.z, wp.f);
          await new Promise((r) => setTimeout(r, 900));
          await p.screenshot(path.join(outDir, `${wp.name}.png`));
        })(),
        120000,
        `shot ${wp.name}`,
      );
      await assertRendererAlive(p, `shot ${wp.name}`);
      console.log(`  shot ${wp.name}.png`);
    }
    fs.writeFileSync(
      path.join(outDir, 'meta.json'),
      `${JSON.stringify({ preset, at: new Date().toISOString(), ...gitMeta() }, null, 2)}\n`,
    );
  } catch (e) {
    console.error(`shots failed: ${e.message}`);
    throw e;
  } finally {
    await closeSafely(p);
  }
  console.log(`parity shots written to ${outDir}`);
}

async function cmdDiffShots() {
  const aDir = args.a;
  const bDir = args.b;
  if (typeof aDir !== 'string' || typeof bDir !== 'string') die('need --a <dir> and --b <dir>');
  const names = fs
    .readdirSync(aDir)
    .filter((f) => f.endsWith('.png') && fs.existsSync(path.join(bDir, f)));
  if (!names.length) die(`no matching .png files between ${aDir} and ${bDir}`);
  const browser = await puppeteer.launch({
    executablePath: process.env.BROWSER_PATH ?? BROWSER_PATH,
    headless: 'new',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    const page = await browser.newPage();
    console.log(`${'shot'.padEnd(12)} ${'meanAbsDiff'.padStart(12)} ${'pxOver24'.padStart(10)}`);
    let worst = 0;
    for (const name of names) {
      const a = fs.readFileSync(path.join(aDir, name)).toString('base64');
      const b = fs.readFileSync(path.join(bDir, name)).toString('base64');
      const r = await page.evaluate(
        async (aB64, bB64) => {
          const load = (src) =>
            new Promise((res, rej) => {
              const img = new Image();
              img.onload = () => res(img);
              img.onerror = rej;
              img.src = src;
            });
          const [ia, ib] = await Promise.all([
            load(`data:image/png;base64,${aB64}`),
            load(`data:image/png;base64,${bB64}`),
          ]);
          if (ia.width !== ib.width || ia.height !== ib.height)
            return { sizeMismatch: `${ia.width}x${ia.height} vs ${ib.width}x${ib.height}` };
          const w = ia.width;
          const h = ia.height;
          const cv = document.createElement('canvas');
          cv.width = w;
          cv.height = h;
          const ctx = cv.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(ia, 0, 0);
          const da = ctx.getImageData(0, 0, w, h).data;
          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(ib, 0, 0);
          const db = ctx.getImageData(0, 0, w, h).data;
          let sum = 0;
          let over = 0;
          const n = w * h;
          for (let i = 0; i < n * 4; i += 4) {
            const d =
              Math.abs(da[i] - db[i]) +
              Math.abs(da[i + 1] - db[i + 1]) +
              Math.abs(da[i + 2] - db[i + 2]);
            sum += d;
            if (d > 24) over++;
          }
          return {
            meanAbsDiff: Math.round((sum / (n * 3)) * 100) / 100,
            pctOver: Math.round(((100 * over) / n) * 100) / 100,
          };
        },
        a,
        b,
      );
      if (r.sizeMismatch) {
        console.log(`${name.padEnd(12)} SIZE MISMATCH ${r.sizeMismatch}`);
        worst = Number.POSITIVE_INFINITY;
      } else {
        console.log(
          `${name.padEnd(12)} ${String(r.meanAbsDiff).padStart(12)} ${String(`${r.pctOver}%`).padStart(10)}`,
        );
        worst = Math.max(worst, r.meanAbsDiff);
      }
    }
    console.log(
      `worst meanAbsDiff ${worst}. Calibrate: diff two runs of the SAME build first; a change is visually suspect only when it clearly exceeds that noise floor.`,
    );
  } finally {
    await browser.close();
  }
}

function cmdClear() {
  let removed = 0;
  if (fs.existsSync(HISTORY)) {
    fs.rmSync(HISTORY);
    removed++;
    console.log(`removed ${HISTORY}`);
  }
  if (args.baselines) {
    for (const preset of PRESETS) {
      const file = baselinePath(preset);
      if (fs.existsSync(file)) {
        fs.rmSync(file);
        removed++;
        console.log(`removed ${file}`);
      }
    }
  }
  console.log(removed ? `cleared ${removed} file(s)` : 'nothing to clear');
}

function cmdHelp() {
  console.log(
    [
      'usage: node scripts/perf_baseline.mjs <subcommand>',
      '  baseline --preset low             measure and freeze the baseline',
      '  run --preset insane [--baseline low] [--gate]   measure, record, compare',
      '  report                            print the run history over time',
      '  compare --preset insane [--baseline low] [--gate]  stored records, no browser',
      '  shots --preset insane [--out dir] visual-parity screenshots (HUD hidden)',
      '  diff-shots --a dir --b dir        pixel-diff two shot sets',
      '  clear [--baselines]               wipe history (and frozen baselines)',
      'options: --ms N  --note text  --fps-tol pct  --sys-tol pct;  env GAME_URL, BROWSER_PATH',
    ].join('\n'),
  );
}

const COMMANDS = {
  baseline: cmdBaseline,
  run: cmdRun,
  report: cmdReport,
  compare: cmdCompare,
  shots: cmdShots,
  'diff-shots': cmdDiffShots,
  clear: cmdClear,
  help: cmdHelp,
};

const handler = COMMANDS[cmd];
if (!handler) {
  cmdHelp();
  process.exit(1);
}
await handler();
