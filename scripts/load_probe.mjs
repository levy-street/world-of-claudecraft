// Loading-time probe: measures the game's POST-DOWNLOAD boot cost repeatably in a
// real browser, and attributes it to the phases the client stamps itself.
//
// The client marks every boot phase with performance.mark/measure spans named
// 'woc:load:<phase>' (src/game/load_profiler.ts + src/render/load_marks.ts) and, at
// world reveal, publishes window.__loadProfile = { context, summary, prewarm }. This
// script enters the offline world N times, reads that blob per run, and folds the
// runs into a median phase tree, so a boot change is judged on a median rather than
// on one noisy launch.
//
//   npm run dev                                   # :5173 (required)
//   node scripts/load_probe.mjs [options]
//
// Options:
//   --runs N            number of measured runs (default 3; 0 prints the plan and exits)
//   --preset NAME       low|medium|high|ultra|insane (default: the game's own default)
//   --url URL           game origin (default http://localhost:5173)
//   --cold              fresh browser profile per run (empty HTTP cache + localStorage)
//   --out FILE          JSON artifact path (default tmp/load_probe_<preset>_<stamp>.json)
//   --headed            headed browser on the real GPU (default: headless swiftshader)
//   --help              print this text
//   BROWSER_PATH=...    browser binary override (see browser_path.mjs)
//
// Two caveats worth stating out loud before quoting a number from this:
//   1. The default headless path rasterizes in software (swiftshader), exactly like
//      perf_tour.mjs. Phase SHARES stay meaningful there; absolute milliseconds do
//      not represent any real device. Use --headed for device-shaped totals.
//   2. Warm mode reuses one persistent browser profile (tmp/.load_probe_profile), so
//      the FIRST run against a brand new profile is still a cold-cache run. Do a
//      throwaway run, or pass --runs with one extra, when the profile dir is new.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

import { enterOfflineGame } from './enter_offline_game.mjs';

const DEFAULT_URL = 'http://localhost:5173';
const DEFAULT_RUNS = 3;
// The root span main.ts opens at entry; every other phase nests inside it.
const ROOT_PHASE = 'entry';
const CHAR_NAME = 'perfprobe';
const CHAR_CLASS = 'warrior';
const PROFILE_TIMEOUT_MS = 120_000;
const NAV_TIMEOUT_MS = 60_000;
const LAUNCHER_TIMEOUT_MS = 60_000;
// Must outlast the profile wait: a CDP call that outlives protocolTimeout kills the run.
const PROTOCOL_TIMEOUT_MS = 240_000;
const WARM_PROFILE_DIR = path.join('tmp', '.load_probe_profile');
const VIEWPORT = {
  width: 1600,
  height: 900,
  deviceScaleFactor: 1,
  isMobile: false,
  hasTouch: false,
};
// Maps the preset label to the woc_settings numeric value (src/render/gfx.ts
// PRESET_LOW..PRESET_ULTRA). 5 is the Advanced custom profile and is never a probe
// target; 6 is Insane. Same table as perf_tour.mjs.
const PRESET_VALUES = { low: 1, medium: 2, high: 3, ultra: 4, insane: 6 };
const PRESET_NAMES = Object.keys(PRESET_VALUES);

const USAGE = `load_probe: measure post-download loading time in a real browser.

  node scripts/load_probe.mjs [--runs N] [--preset ${PRESET_NAMES.join('|')}]
                              [--url URL] [--cold] [--out FILE] [--headed]

  --runs N       measured runs, median-aggregated (default ${DEFAULT_RUNS}; 0 = print the plan only)
  --preset NAME  force a graphics preset (default: the game's persisted/auto default)
  --url URL      game origin (default ${DEFAULT_URL}); needs "npm run dev" running
  --cold         fresh browser profile per run: empty HTTP cache and localStorage
  --out FILE     JSON artifact path (default tmp/load_probe_<preset>_<stamp>.json)
  --headed       headed browser on the real GPU (default: headless swiftshader)
  --help         print this text`;

// ---------------------------------------------------------------------------
// Pure helpers (no browser, no fs): argument parsing plus the run aggregation.
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const args = {
    runs: DEFAULT_RUNS,
    preset: null,
    url: DEFAULT_URL,
    cold: false,
    out: null,
    headed: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new Error(`${token} needs a value.`);
      i++;
      return next;
    };
    switch (token) {
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--runs':
        args.runs = parseRuns(value());
        break;
      case '--preset':
        args.preset = parsePreset(value());
        break;
      case '--url':
        args.url = parseUrl(value());
        break;
      case '--out':
        args.out = value();
        break;
      case '--cold':
        args.cold = true;
        break;
      case '--headed':
        args.headed = true;
        break;
      default:
        throw new Error(`Unknown argument ${token}. Run with --help.`);
    }
  }
  return args;
}

function parseRuns(raw) {
  const runs = Number(raw);
  if (!Number.isInteger(runs) || runs < 0)
    throw new Error(`--runs must be an integer >= 0 (got ${raw}).`);
  return runs;
}

function parsePreset(raw) {
  if (!(raw in PRESET_VALUES))
    throw new Error(`--preset must be one of ${PRESET_NAMES.join(', ')} (got ${raw}).`);
  return raw;
}

function parseUrl(raw) {
  try {
    new URL(raw);
  } catch {
    throw new Error(`--url must be an absolute URL (got ${raw}).`);
  }
  return raw;
}

/** The navigated URL: ?gfx forces the render tier the same way the profiler harness does. */
export function probeUrl(baseUrl, preset) {
  const url = new URL(baseUrl);
  if (preset) url.searchParams.set('gfx', preset);
  return url.toString();
}

export function defaultOutPath(preset, now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return path.join('tmp', `load_probe_${preset ?? 'auto'}_${stamp}.json`);
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

export function median(values) {
  const sorted = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function summarize(values) {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return { median: 0, min: 0, max: 0, samples: 0 };
  return {
    median: round2(median(finite)),
    min: round2(Math.min(...finite)),
    max: round2(Math.max(...finite)),
    samples: finite.length,
  };
}

/**
 * Fold one LoadPhaseNode[] per run into a single tree whose every node carries
 * median/min/max across the runs that recorded it. Nodes are matched by name at
 * each depth (the client's own summarizer already deduped names per level), and
 * a node missing from a run simply lowers that node's sample count rather than
 * dragging the median toward zero.
 */
export function mergePhaseTrees(runPhaseLists) {
  const totalRuns = runPhaseLists.length;
  const mergeLevel = (lists, parentPath) => {
    const order = [];
    const byName = new Map();
    for (const list of lists) {
      for (const node of list ?? []) {
        let acc = byName.get(node.name);
        if (!acc) {
          acc = {
            name: node.name,
            path: parentPath ? `${parentPath} > ${node.name}` : node.name,
            ms: [],
            selfMs: [],
            startMs: [],
            counts: [],
            childLists: [],
          };
          byName.set(node.name, acc);
          order.push(acc);
        }
        acc.ms.push(node.ms);
        acc.selfMs.push(node.selfMs);
        acc.startMs.push(node.startMs);
        acc.counts.push(node.count);
        acc.childLists.push(node.children ?? []);
      }
    }
    const merged = order.map((acc) => ({
      name: acc.name,
      path: acc.path,
      runs: acc.ms.length,
      totalRuns,
      ms: summarize(acc.ms),
      selfMs: summarize(acc.selfMs),
      startMs: summarize(acc.startMs),
      count: summarize(acc.counts),
      children: mergeLevel(acc.childLists, acc.path),
    }));
    // Chronological, like the client's summary: the tree should read as the boot did.
    merged.sort((a, b) => a.startMs.median - b.startMs.median);
    return merged;
  };
  return mergeLevel(runPhaseLists, '');
}

export function flattenMergedPhases(nodes, out = []) {
  for (const node of nodes) {
    out.push(node);
    flattenMergedPhases(node.children, out);
  }
  return out;
}

/** The per-zone prepare spans the renderer stamps, heaviest first. */
export function zoneSpans(mergedPhases) {
  return flattenMergedPhases(mergedPhases)
    .filter((node) => node.name.startsWith('zone:'))
    .sort((a, b) => b.ms.median - a.ms.median);
}

/** Median per prewarm manifest entry across runs, heaviest first. */
export function aggregatePrewarmEntries(prewarmPerRun) {
  const byId = new Map();
  for (const prewarm of prewarmPerRun) {
    for (const entry of prewarm?.manifestEntries ?? []) {
      let acc = byId.get(entry.id);
      if (!acc) {
        acc = {
          id: entry.id,
          category: entry.category ?? '',
          required: Boolean(entry.required),
          statuses: new Set(),
          elapsedMs: [],
          programDelta: [],
          textureDelta: [],
        };
        byId.set(entry.id, acc);
      }
      acc.statuses.add(entry.status ?? 'unknown');
      acc.elapsedMs.push(entry.elapsedMs);
      acc.programDelta.push(entry.programDelta);
      acc.textureDelta.push(entry.textureDelta);
    }
  }
  return [...byId.values()]
    .map((acc) => ({
      id: acc.id,
      category: acc.category,
      required: acc.required,
      statuses: [...acc.statuses].sort(),
      runs: acc.elapsedMs.length,
      elapsedMs: summarize(acc.elapsedMs),
      programDelta: summarize(acc.programDelta),
      textureDelta: summarize(acc.textureDelta),
    }))
    .sort((a, b) => b.elapsedMs.median - a.elapsedMs.median);
}

export function aggregateRuns(runs) {
  const ok = runs.filter((run) => run.ok);
  const summaries = ok.map((run) => run.loadProfile?.summary ?? null);
  const merged = mergePhaseTrees(summaries.map((s) => s?.phases ?? []));
  return {
    runs: ok.length,
    attempted: runs.length,
    wallClockMs: summarize(ok.map((run) => run.wallClockMs)),
    inPageMs: summarize(ok.map((run) => run.inPageMs)),
    totalMs: summarize(summaries.map((s) => s?.totalMs)),
    unattributedMs: summarize(summaries.map((s) => s?.unattributedMs)),
    longTasks: {
      count: summarize(ok.map((run) => run.longTasks.count)),
      totalMs: summarize(ok.map((run) => run.longTasks.totalMs)),
      maxMs: summarize(ok.map((run) => run.longTasks.maxMs)),
    },
    phases: merged,
    zoneSpans: zoneSpans(merged),
    prewarmEntries: aggregatePrewarmEntries(ok.map((run) => run.loadProfile?.prewarm ?? null)),
    context: ok.at(-1)?.loadProfile?.context ?? null,
  };
}

// ---------------------------------------------------------------------------
// Console rendering (pure: returns lines, prints nothing).
// ---------------------------------------------------------------------------

const NAME_COLUMN = 48;

function padName(label) {
  if (label.length <= NAME_COLUMN) return label.padEnd(NAME_COLUMN);
  return `${label.slice(0, NAME_COLUMN - 1)}~`;
}

function msCell(value) {
  return value.toFixed(1).padStart(9);
}

export function formatPhaseTable(mergedPhases, totalMedianMs) {
  const rows = [];
  const walk = (nodes, depth) => {
    for (const node of nodes) {
      const repeats = node.count.median > 1 ? ` x${node.count.median}` : '';
      rows.push({ label: `${'  '.repeat(depth)}${node.name}${repeats}`, node });
      walk(node.children, depth + 1);
    }
  };
  walk(mergedPhases, 0);
  const lines = [
    `${padName('phase')}${'median'.padStart(9)}${'min'.padStart(9)}${'max'.padStart(9)}${'share'.padStart(8)}${'runs'.padStart(7)}`,
  ];
  for (const row of rows) {
    const share =
      totalMedianMs > 0 ? `${((row.node.ms.median / totalMedianMs) * 100).toFixed(1)}%` : '-';
    lines.push(
      `${padName(row.label)}${msCell(row.node.ms.median)}${msCell(row.node.ms.min)}${msCell(row.node.ms.max)}${share.padStart(8)}${`${row.node.runs}/${row.node.totalRuns}`.padStart(7)}`,
    );
  }
  return lines;
}

export function formatPrewarmTable(entries, limit = 10) {
  if (entries.length === 0) return ['prewarm: no manifest entries recorded'];
  const lines = [
    `${padName('prewarm entry')}${'median'.padStart(9)}${'min'.padStart(9)}${'max'.padStart(9)}  status`,
  ];
  for (const entry of entries.slice(0, limit)) {
    const label = entry.category ? `${entry.id} (${entry.category})` : entry.id;
    lines.push(
      `${padName(label)}${msCell(entry.elapsedMs.median)}${msCell(entry.elapsedMs.min)}${msCell(entry.elapsedMs.max)}  ${entry.statuses.join(',')}`,
    );
  }
  return lines;
}

export function formatZoneTable(spans, limit = 5) {
  if (spans.length === 0) return ['zone spans: none recorded'];
  const lines = [
    `${padName('zone span')}${'median'.padStart(9)}${'min'.padStart(9)}${'max'.padStart(9)}${'runs'.padStart(7)}`,
  ];
  for (const span of spans.slice(0, limit)) {
    lines.push(
      `${padName(span.name)}${msCell(span.ms.median)}${msCell(span.ms.min)}${msCell(span.ms.max)}${`${span.runs}/${span.totalRuns}`.padStart(7)}`,
    );
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Browser orchestration.
// ---------------------------------------------------------------------------

async function assertServerReachable(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(5000) });
  } catch (err) {
    throw new Error(
      `Cannot reach ${url}. Start the dev server first: npm run dev (then re-run, or pass --url).`,
      { cause: err },
    );
  }
}

// Installed before any app script runs. Three jobs: stamp the exact in-page moment
// __loadProfile is published (an accessor trap, so the measurement does not depend on
// polling cadence), record long tasks during boot, and seed the STATIC graphics preset
// so the per-tier UI knobs resolve the same preset the ?gfx tier forces (perf_tour.mjs
// seeds woc_settings the same way).
function installProbeHooks(presetValue) {
  const state = {
    clickAtMs: null,
    profileAtMs: null,
    longTasks: [],
    observerFailed: false,
    trapFailed: false,
  };
  window.__loadProbe = state;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (state.longTasks.length >= 500) return;
        state.longTasks.push({ startMs: entry.startTime, ms: entry.duration });
      }
    });
    observer.observe({ entryTypes: ['longtask'] });
  } catch {
    state.observerFailed = true;
  }
  try {
    let published;
    Object.defineProperty(window, '__loadProfile', {
      configurable: true,
      get() {
        return published;
      },
      set(value) {
        published = value;
        if (state.profileAtMs === null) state.profileAtMs = performance.now();
      },
    });
  } catch {
    // Without the trap the run still measures wall clock; only the in-page delta is lost.
    state.trapFailed = true;
  }
  if (presetValue !== null) {
    try {
      const key = 'woc_settings';
      const current = JSON.parse(localStorage.getItem(key) ?? '{}');
      current.graphicsPreset = presetValue;
      localStorage.setItem(key, JSON.stringify(current));
    } catch {
      // Storage unavailable: the ?gfx tier override still applies.
    }
  }
}

function isIgnorableConsoleError(text) {
  return (
    text.includes('/api/project-stats') || text.includes('project stats') || text.includes('502')
  );
}

async function bootState(page) {
  return page
    .evaluate(() => {
      const visiblePanel =
        [
          ...document.querySelectorAll(
            '#mode-select,#login-panel,#realm-panel,#charselect-panel,#offline-select',
          ),
        ].find((el) => !el.hasAttribute('hidden'))?.id ?? null;
      return {
        visiblePanel,
        loadingVisible:
          document.querySelector('#loading-screen')?.classList.contains('visible') ?? null,
        loadingStatus: document.querySelector('#ls-status')?.textContent ?? '',
        offlineError: document.querySelector('#offline-error')?.textContent ?? '',
        fatalText: document.querySelector('#fatal-overlay, .fatal-overlay')?.textContent ?? '',
        hasGame: Boolean(window.__game),
        hasProfile: Boolean(window.__loadProfile),
      };
    })
    .catch(() => ({ evaluateFailed: true }));
}

async function runOnce({ browser, url, presetValue, index }) {
  const page = await browser.newPage();
  const errors = [];
  const ignoredConsoleErrors = [];
  page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (isIgnorableConsoleError(text)) ignoredConsoleErrors.push(text);
    else errors.push(`CONSOLE: ${text}`);
  });
  try {
    await page.setViewport(VIEWPORT);
    await page.evaluateOnNewDocument(installProbeHooks, presetValue);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    // Wait for the launcher OUTSIDE the measured window: the probe measures entry
    // to world reveal, not how long Vite took to serve the start screen.
    await page.waitForSelector('#btn-offline', { timeout: LAUNCHER_TIMEOUT_MS });
    await page.evaluate(() => {
      window.__loadProbe.clickAtMs = performance.now();
    });

    const startedAtMs = Date.now();
    // The shared helper owns the whole entry flow, so it also owns the moment
    // __loadProfile appears. Run it CONCURRENTLY with the wait rather than awaiting
    // it first: the helper keeps working (overlay dismissal) past world reveal, and
    // folding that tail into the number would inflate every run.
    const entry = enterOfflineGame(page, {
      charClass: CHAR_CLASS,
      charName: CHAR_NAME,
      settleMs: 0,
      dismissMobilePreflight: false,
      gameBootTimeoutMs: PROFILE_TIMEOUT_MS,
      selectorTimeoutMs: LAUNCHER_TIMEOUT_MS,
    });
    let entryError = null;
    const entryFailure = entry.then(
      // Entry finishing is not the signal: only the profile is. Never settle on success.
      () => new Promise(() => {}),
      (err) => {
        entryError = err;
        throw err;
      },
    );
    entryFailure.catch(() => {});
    const waitForProfile = page.waitForFunction(() => Boolean(window.__loadProfile), {
      timeout: PROFILE_TIMEOUT_MS,
      polling: 100,
    });
    try {
      await Promise.race([waitForProfile, entryFailure]);
    } catch (err) {
      const state = await bootState(page);
      throw new Error(
        `run ${index + 1}: no window.__loadProfile after ${PROFILE_TIMEOUT_MS}ms: ${JSON.stringify(state)}`,
        { cause: entryError ?? err },
      );
    }
    const wallClockMs = Date.now() - startedAtMs;
    // Let the helper finish its overlay pass so the page is quiescent before we read.
    await entry.catch(() => {});

    const captured = await page.evaluate(() => {
      const probe = window.__loadProbe ?? null;
      const nav = performance.getEntriesByType('navigation')[0] ?? null;
      return {
        loadProfile: window.__loadProfile ?? null,
        clickAtMs: probe?.clickAtMs ?? null,
        profileAtMs: probe?.profileAtMs ?? null,
        longTasks: probe?.longTasks ?? [],
        longTaskObserverFailed: probe?.observerFailed ?? false,
        profileTrapFailed: probe?.trapFailed ?? false,
        navigation: nav
          ? {
              responseEndMs: nav.responseEnd,
              domContentLoadedMs: nav.domContentLoadedEventEnd,
              loadEventEndMs: nav.loadEventEnd,
            }
          : null,
        userAgent: navigator.userAgent,
      };
    });

    const { clickAtMs, profileAtMs } = captured;
    const inPageMs =
      clickAtMs !== null && profileAtMs !== null ? round2(profileAtMs - clickAtMs) : null;
    // Only the tasks that overlap the measured entry window: launcher-time jank is
    // not loading time.
    const windowTasks = captured.longTasks.filter((task) => {
      if (clickAtMs === null || profileAtMs === null) return true;
      return task.startMs + task.ms >= clickAtMs && task.startMs <= profileAtMs;
    });
    return {
      ok: true,
      index,
      wallClockMs,
      inPageMs,
      loadProfile: captured.loadProfile,
      navigation: captured.navigation,
      userAgent: captured.userAgent,
      longTasks: {
        count: windowTasks.length,
        totalMs: round2(windowTasks.reduce((sum, task) => sum + task.ms, 0)),
        maxMs: round2(windowTasks.reduce((max, task) => Math.max(max, task.ms), 0)),
        observerFailed: captured.longTaskObserverFailed,
        entries: windowTasks.map((task) => ({
          startMs: round2(task.startMs),
          ms: round2(task.ms),
        })),
      },
      profileTrapFailed: captured.profileTrapFailed,
      errors,
      ignoredConsoleErrors,
    };
  } finally {
    await page.close().catch(() => {});
  }
}

function launchOptions({ browserPath, headed, userDataDir }) {
  return {
    executablePath: browserPath,
    userDataDir,
    headless: headed ? false : 'new',
    protocolTimeout: PROTOCOL_TIMEOUT_MS,
    args: headed
      ? [
          `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
          '--ignore-gpu-blocklist',
          '--enable-gpu',
          ...(process.env.WAYLAND_DISPLAY && process.env.DISPLAY ? ['--ozone-platform=x11'] : []),
        ]
      : [
          `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
          '--use-angle=swiftshader',
          '--enable-unsafe-swiftshader',
        ],
  };
}

function planLines(args, outPath, url) {
  return [
    `url        ${url}`,
    `runs       ${args.runs}`,
    `preset     ${args.preset ?? 'auto (the game default)'}`,
    `cache      ${args.cold ? 'cold (fresh browser profile per run)' : `warm (persistent profile ${WARM_PROFILE_DIR})`}`,
    `browser    ${args.headed ? 'headed, real GPU' : 'headless, swiftshader (software raster)'}`,
    `out        ${outPath}`,
  ];
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`${err.message}\n\n${USAGE}`);
    return 1;
  }
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  const url = probeUrl(args.url, args.preset);
  const outPath = args.out ?? defaultOutPath(args.preset);
  if (args.runs === 0) {
    console.log(
      ['load_probe plan (no runs requested):', ...planLines(args, outPath, url)].join('\n'),
    );
    return 0;
  }

  try {
    await assertServerReachable(args.url);
  } catch (err) {
    // An unreachable dev server is an operator condition, not a defect: say what to
    // do, without a stack trace.
    console.error(err.message);
    return 1;
  }
  // Imported lazily so --help and --runs 0 work on a machine with no browser installed
  // (browser_path.mjs throws at module load by design).
  const { BROWSER_PATH } = await import('./browser_path.mjs');
  const presetValue = args.preset ? PRESET_VALUES[args.preset] : null;

  console.log(['load_probe:', ...planLines(args, outPath, url)].join('\n  '));

  const startedAt = new Date().toISOString();
  const runs = [];
  let warmBrowser = null;
  if (!args.cold) {
    fs.mkdirSync(WARM_PROFILE_DIR, { recursive: true });
    warmBrowser = await puppeteer.launch(
      launchOptions({
        browserPath: BROWSER_PATH,
        headed: args.headed,
        userDataDir: WARM_PROFILE_DIR,
      }),
    );
  }
  try {
    for (let index = 0; index < args.runs; index++) {
      let coldBrowser = null;
      let coldProfileDir = null;
      try {
        if (args.cold) {
          coldProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'woc-load-probe-'));
          coldBrowser = await puppeteer.launch(
            launchOptions({
              browserPath: BROWSER_PATH,
              headed: args.headed,
              userDataDir: coldProfileDir,
            }),
          );
        }
        const run = await runOnce({
          browser: coldBrowser ?? warmBrowser,
          url,
          presetValue,
          index,
        });
        runs.push(run);
        const total = run.loadProfile?.summary?.totalMs ?? 0;
        console.log(
          `run ${index + 1}/${args.runs}: wall ${run.wallClockMs}ms  entry ${total.toFixed(0)}ms  ` +
            `in-page ${run.inPageMs === null ? 'n/a' : `${run.inPageMs.toFixed(0)}ms`}  ` +
            `longtasks ${run.longTasks.count} (max ${run.longTasks.maxMs}ms)  errors ${run.errors.length}`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        runs.push({ ok: false, index, error: message });
        console.error(`run ${index + 1}/${args.runs} FAILED: ${message}`);
      } finally {
        await coldBrowser?.close().catch(() => {});
        if (coldProfileDir) fs.rmSync(coldProfileDir, { recursive: true, force: true });
      }
    }
  } finally {
    await warmBrowser?.close().catch(() => {});
  }

  const aggregate = aggregateRuns(runs);
  const artifact = {
    generatedAt: startedAt,
    args: {
      runs: args.runs,
      preset: args.preset,
      url: args.url,
      cold: args.cold,
      headed: args.headed,
      out: outPath,
    },
    url,
    browserPath: BROWSER_PATH,
    gpuMode: args.headed ? 'real-gpu-headed' : 'swiftshader-headless',
    cacheMode: args.cold ? 'cold' : 'warm',
    rootPhase: ROOT_PHASE,
    aggregate,
    runs,
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`);

  if (aggregate.runs > 0) {
    const totalMedian = aggregate.totalMs.median;
    console.log(
      [
        '',
        `median of ${aggregate.runs}/${aggregate.attempted} runs` +
          `  preset ${args.preset ?? 'auto'}  ${args.cold ? 'cold' : 'warm'} cache  ` +
          `${args.headed ? 'real GPU' : 'swiftshader (software raster: shares are meaningful, absolute ms are not)'}`,
        `  wall clock   ${aggregate.wallClockMs.median.toFixed(0)}ms  (min ${aggregate.wallClockMs.min.toFixed(0)}, max ${aggregate.wallClockMs.max.toFixed(0)})`,
        `  entry total  ${totalMedian.toFixed(0)}ms  unattributed ${aggregate.unattributedMs.median.toFixed(0)}ms`,
        `  long tasks   ${aggregate.longTasks.count.median} (total ${aggregate.longTasks.totalMs.median.toFixed(0)}ms, max ${aggregate.longTasks.maxMs.median.toFixed(0)}ms)`,
        '',
        ...formatPhaseTable(aggregate.phases, totalMedian),
        '',
        ...formatPrewarmTable(aggregate.prewarmEntries),
        '',
        ...formatZoneTable(aggregate.zoneSpans),
      ].join('\n'),
    );
  }
  console.log(`\nwrote ${outPath}`);

  const failed = runs.filter((run) => !run.ok);
  if (failed.length > 0) {
    console.error(`${failed.length}/${runs.length} run(s) failed.`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main().catch((err) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    return 1;
  });
}
