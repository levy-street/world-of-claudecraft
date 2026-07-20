// Browser perf tour: boots offline mode with ?perf and writes structured
// window.__game.perf.report() samples to tmp/ for desktop/mobile comparison.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';
import { perfTourEntryOptions } from './perf_tour_entry_options.mjs';

const BASE_URL = process.env.GAME_URL ?? 'http://localhost:5173';
const VIEWPORT_MODE = process.env.PERF_VIEWPORT ?? 'both';
const PERF_SCENARIO = process.env.PERF_SCENARIO ?? 'bench_perf_tour';
const STEP_MS = Number(process.env.PERF_STEP_MS ?? 2500);
const SETTLE_MS = Number(process.env.PERF_SETTLE_MS ?? 600);
const BOOT_TIMEOUT_MS = Number(process.env.PERF_BOOT_TIMEOUT_MS ?? 120000);
const NAV_TIMEOUT_MS = Number(process.env.PERF_NAV_TIMEOUT_MS ?? 30000);
const OUTPUT =
  process.env.PERF_OUT ??
  path.join('tmp', `perf-tour-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
// PERF_PRESET seeds the STATIC graphics preset before boot so the applier stamps
// data-fx-level and the per-element tier knobs engage (the per-tier perf gate). Unset
// = the app's own default (ultra). Maps the preset label to the woc_settings numeric value
// (src/render/gfx.ts PRESET_LOW..PRESET_ULTRA).
const PERF_PRESET = process.env.PERF_PRESET ?? null;
const PRESET_VALUES = { low: 1, medium: 2, high: 3, ultra: 4 };

const THRESHOLDS = {
  maxFrameP95: numberEnv('PERF_MAX_FRAME_P95'),
  maxFrameLong50: numberEnv('PERF_MAX_LONG50'),
  maxLongTasks: numberEnv('PERF_MAX_LONGTASKS'),
  maxLongTaskP95: numberEnv('PERF_MAX_LONGTASK_P95'),
  maxLongTaskMax: numberEnv('PERF_MAX_LONGTASK_MAX'),
  maxPreloadTasks: numberEnv('PERF_MAX_PRELOAD_TASKS'),
  maxGltfCount: numberEnv('PERF_MAX_GLTF'),
  maxTextureCount: numberEnv('PERF_MAX_TEXTURES'),
  maxBootMib: numberEnv('PERF_MAX_BOOT_MIB'),
  maxBootGltfMib: numberEnv('PERF_MAX_BOOT_GLTF_MIB'),
  maxBootTextureMib: numberEnv('PERF_MAX_BOOT_TEXTURE_MIB'),
  maxBootHdrMib: numberEnv('PERF_MAX_BOOT_HDR_MIB'),
  maxCalls: numberEnv('PERF_MAX_CALLS'),
  maxTriangles: numberEnv('PERF_MAX_TRIANGLES'),
  maxSampleCalls: numberEnv('PERF_MAX_SAMPLE_CALLS'),
  maxSampleTriangles: numberEnv('PERF_MAX_SAMPLE_TRIANGLES'),
  maxViews: numberEnv('PERF_MAX_VIEWS'),
  maxInputIntentToFrameP95: numberEnv('PERF_MAX_INPUT_FRAME_P95'),
  maxInputIntentToVisibleP95: numberEnv('PERF_MAX_INPUT_VISIBLE_P95'),
  maxPrewarmMs: numberEnv('PERF_MAX_PREWARM_MS'),
  maxPrewarmBudgetRatio: numberEnv('PERF_MAX_PREWARM_BUDGET_RATIO'),
  maxPrewarmTimedOut: numberEnv('PERF_MAX_PREWARM_TIMED_OUT'),
  maxPrewarmFailed: numberEnv('PERF_MAX_PREWARM_FAILED'),
  minPrewarmCompleted: numberEnv('PERF_MIN_PREWARM_COMPLETED'),
  minPrewarmEntries: numberEnv('PERF_MIN_PREWARM_ENTRIES'),
};

const VIEWPORTS = {
  desktop: {
    label: 'desktop',
    width: 1600,
    height: 900,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
  },
  mobile: {
    // LANDSCAPE on purpose: the in-game world is landscape-only on web mobile,
    // so a portrait 390x844 surfaces the #rotate-device gate and the
    // world never boots. A landscape 844x390 (an iPhone-class phone rotated) keeps the
    // rotate gate hidden while still matching PHONE_TOUCH_QUERY (max-width 940 /
    // max-height 760 under pointer:coarse), so the touch HUD is what gets measured.
    label: 'mobile',
    width: 844,
    height: 390,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function numberEnv(name) {
  if (process.env[name] === undefined || process.env[name] === '') return null;
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a finite number.`);
  return value;
}

function perfUrl() {
  const url = new URL(BASE_URL);
  url.searchParams.set('perf', '');
  url.searchParams.set('perfScenario', PERF_SCENARIO);
  return url.toString();
}

function selectedViewports() {
  if (VIEWPORT_MODE === 'both') return [VIEWPORTS.desktop, VIEWPORTS.mobile];
  const viewport = VIEWPORTS[VIEWPORT_MODE];
  if (!viewport)
    throw new Error(`Unknown PERF_VIEWPORT=${VIEWPORT_MODE}; use desktop, mobile, or both.`);
  return [viewport];
}

function isIgnorableConsoleError(text) {
  return (
    text.includes('/api/project-stats') || text.includes('project stats') || text.includes('502')
  );
}

async function bootOffline(page, viewport) {
  await page.setViewport(viewport);
  await page.goto(perfUrl(), { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  const gameBooted = await enterOfflineGame(page, perfTourEntryOptions(viewport, BOOT_TIMEOUT_MS));
  if (!gameBooted) {
    const state = await page.evaluate(() => {
      const visiblePanel =
        [
          ...document.querySelectorAll(
            '#mode-select,#login-panel,#realm-panel,#charselect-panel,#offline-select',
          ),
        ].find((el) => !el.hasAttribute('hidden'))?.id ?? null;
      const loading = document.querySelector('#loading-screen');
      const fatal = document.querySelector('#fatal-overlay, .fatal-overlay');
      return {
        visiblePanel,
        startScreenDisplay: getComputedStyle(document.querySelector('#start-screen')).display,
        loadingVisible: loading?.classList.contains('visible') ?? false,
        loadingStatus: document.querySelector('#ls-status')?.textContent ?? '',
        offlineError: document.querySelector('#offline-error')?.textContent ?? '',
        selectedClass:
          document.querySelector('#offline-select .mini-class.sel')?.getAttribute('data-class') ??
          null,
        name: document.querySelector('#char-name')?.value ?? '',
        hasGame: Boolean(window.__game),
        bodyClass: document.body.className,
        fatalText: fatal?.textContent ?? '',
      };
    });
    throw new Error(`Timed out waiting for offline world boot: ${JSON.stringify(state)}`);
  }
  await sleep(SETTLE_MS);
}

async function driveMove(page, move, ms = STEP_MS) {
  await page.evaluate((move) => {
    window.__game.input.setTouchMove(move);
  }, move);
  await sleep(ms);
  await page.evaluate(() => window.__game.input.clearTouchMove());
  await sleep(SETTLE_MS);
}

async function driveLook(page, vector, ms = STEP_MS) {
  await page.evaluate((vector) => {
    window.__game.input.setTouchLook(true);
    window.__game.input.setTouchLookVector(vector);
  }, vector);
  await sleep(ms);
  await page.evaluate(() => {
    window.__game.input.setTouchLookVector({ x: 0, y: 0 });
    window.__game.input.setTouchLook(false);
  });
  await sleep(SETTLE_MS);
}

async function openMapBriefly(page) {
  await page.keyboard.press('m');
  await sleep(Math.max(SETTLE_MS, Math.min(1200, STEP_MS)));
  await page.keyboard.press('m');
  await sleep(SETTLE_MS);
}

async function teleportTown(page) {
  await page.evaluate(() => {
    const g = window.__game;
    const p = g.sim.player;
    p.pos.x = 0;
    p.pos.z = -14;
    p.facing = 0;
    g.input.camYaw = 0;
  });
  await sleep(SETTLE_MS);
}

// FCT perf gate: prove the pooled FCT painter BOUNDS the live floater node count
// under an AoE / boss burst. The old per-event createElement + setTimeout fct() grew the
// #ui .fct node count without any ceiling; the fixed-size pooled-div ring caps it at
// FCT_POOL_CAP and FIFO-evicts the oldest past that. Drive several waves of synthetic
// combat events through the REAL migrated spawn path (window.__game.hud.handleEvents ->
// fctPainter.spawn), each wave far above any sane cap, and read the live node count in the
// SAME tick (right after the flood saturates + evicts). The count must be > 0 (spawns
// happened, not all behind-culled), bounded well below the spawn count (not per-event
// growth), and STABLE across waves (the fixed ring re-saturates to the same count). A
// regression to unbounded createElement lets the count climb toward the spawn count.
async function fctBurstBoundedNodes(page) {
  const SPAWN_PER_WAVE = 400;
  const WAVES = 3;
  // Re-centre the player so its head anchor projects in front of the camera (FCT behind
  // the camera is culled at spawn, exactly as the live fct() did).
  await teleportTown(page);
  const counts = [];
  for (let wave = 0; wave < WAVES; wave++) {
    const count = await page.evaluate((n) => {
      const g = window.__game;
      const pid = g.sim?.playerId ?? g.sim?.player?.id;
      if (pid == null || !g.hud?.handleEvents) return -1;
      const evs = [];
      // Crit damage-taken events: the drop-non-crit (low tier) sheds only NON-crit
      // floaters, so a CRIT burst is kept on every tier and exercises the live pool cap
      // (FCT_POOL_CAP at the full tiers, the tighter cap at low) rather than being dropped
      // entirely. Self-sourced (sourceId === targetId === player) so both the src and tgt
      // lookups resolve in the spawn path, with no missing-entity edge case.
      for (let i = 0; i < n; i++)
        evs.push({ type: 'damage', sourceId: pid, targetId: pid, amount: 1000 + i, crit: true });
      g.hud.handleEvents(evs);
      // Count in the same synchronous tick: the flood just filled + FIFO-evicted to the cap,
      // before the next rAF runs step() (which only recycles on TTL, never grows the pool).
      return document.querySelectorAll('#ui .fct').length;
    }, SPAWN_PER_WAVE);
    counts.push(count);
    await sleep(Math.max(SETTLE_MS, 1500)); // let TTL (1250ms) recycle before the next wave
  }
  const valid = counts.filter((c) => c >= 0);
  return {
    spawnPerWave: SPAWN_PER_WAVE,
    waves: WAVES,
    counts,
    max: valid.length ? Math.max(...valid) : -1,
    min: valid.length ? Math.min(...valid) : -1,
    drove: valid.length === counts.length,
  };
}

function fctBurstFailures(burst) {
  if (!burst) return [];
  const failures = [];
  if (!burst.drove)
    failures.push(`FCT burst could not drive spawns (counts ${burst.counts.join(',')})`);
  else if (burst.min <= 0)
    failures.push(`FCT burst spawned no floaters (counts ${burst.counts.join(',')})`);
  else if (burst.max >= burst.spawnPerWave)
    failures.push(
      `FCT node count ${burst.max} not bounded below ${burst.spawnPerWave} (unbounded pool)`,
    );
  else if (burst.max !== burst.min)
    failures.push(
      `FCT node count unstable across waves (${burst.counts.join(',')}), expected a fixed cap`,
    );
  return failures;
}

async function sample(page, label) {
  return page.evaluate((label) => {
    const g = window.__game;
    const p = g.sim.player;
    return {
      label,
      atMs: performance.now(),
      player: {
        x: p.pos.x,
        z: p.pos.z,
        facing: p.facing,
        camYaw: g.input.camYaw,
        targetId: p.targetId ?? null,
      },
      report: g.perf.report(),
    };
  }, label);
}

function maxOf(samples, read) {
  return Math.max(0, ...samples.map(read).filter((v) => Number.isFinite(v)));
}

function lastOf(samples) {
  return samples[samples.length - 1] ?? null;
}

function logicalAssetPath(url) {
  const pathname = (() => {
    try {
      return new URL(url, BASE_URL).pathname;
    } catch {
      return url;
    }
  })().replace(/^\/+/, '');
  if (!pathname.startsWith('media/')) return pathname;
  const parts = pathname.slice('media/'.length).split('/');
  const file = parts.pop() ?? '';
  const dot = file.lastIndexOf('.');
  if (dot <= 0) return pathname.slice('media/'.length);
  const stem = file.slice(0, dot);
  const ext = file.slice(dot);
  const hashDot = stem.lastIndexOf('.');
  const logicalStem =
    hashDot > 0 && /^[a-f0-9]{12}$/.test(stem.slice(hashDot + 1)) ? stem.slice(0, hashDot) : stem;
  return [...parts, `${logicalStem}${ext}`].join('/');
}

function staticAssetBytes(url) {
  const logical = logicalAssetPath(url);
  const file = path.join(process.cwd(), 'public', logical);
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

function bootBytesByType(report) {
  const byType = {};
  const seen = new Set();
  for (const file of report?.assets?.files ?? []) {
    const logical = logicalAssetPath(file.url);
    const key = `${file.type}:${logical}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const bytes = staticAssetBytes(file.url);
    const bucket = byType[file.type] ?? { count: 0, bytes: 0, mib: 0 };
    bucket.count++;
    bucket.bytes += bytes;
    bucket.mib = Math.round((bucket.bytes / 1024 / 1024) * 1000) / 1000;
    byType[file.type] = bucket;
  }
  return byType;
}

function summarizeResult(result) {
  const last = lastOf(result.samples);
  const lastReport = last?.report ?? {};
  const lastAssets = lastReport.assets ?? {};
  const gltf = lastAssets.byType?.gltf;
  const texture = lastAssets.byType?.texture;
  const renderer = lastReport.renderer;
  const prewarm = renderer?.prewarm;
  const foliage = renderer?.foliage;
  const hud = lastReport.hud;
  const longTasks = lastReport.browser?.longTasks;
  const bootByType = bootBytesByType(lastReport);
  const bootBytes = Object.values(bootByType).reduce((sum, bucket) => sum + bucket.bytes, 0);
  return {
    viewport: result.viewport,
    samples: result.samples.length,
    errors: result.errors.length,
    ignoredConsoleErrors: result.ignoredConsoleErrors.length,
    lastLabel: last?.label ?? '',
    fps: lastReport.fps ?? 0,
    fps10s: lastReport.windows?.last10s?.fps ?? 0,
    frameP95: lastReport.frameMs?.p95 ?? 0,
    frameP95_10s: lastReport.windows?.last10s?.frameMs?.p95 ?? 0,
    frameLong50: lastReport.frameMs?.long50 ?? 0,
    longTasks: longTasks?.count ?? 0,
    longTaskP95: longTasks?.p95 ?? 0,
    longTaskMax: longTasks?.max ?? 0,
    maxFrameP95: maxOf(result.samples, (s) => s.report?.frameMs?.p95),
    maxFrameP95_10s: maxOf(result.samples, (s) => s.report?.windows?.last10s?.frameMs?.p95),
    preloadWaitMs: lastAssets.preload?.waitMs ?? 0,
    preloadTasks: lastAssets.preload?.tasks ?? 0,
    gltfCount: gltf?.count ?? 0,
    textureCount: texture?.count ?? 0,
    bootBytes,
    bootMib: Math.round((bootBytes / 1024 / 1024) * 1000) / 1000,
    bootByType,
    rendererTier: renderer?.tier ?? '',
    effectiveRenderScale: renderer?.effectiveRenderScale ?? 0,
    calls: renderer?.calls ?? 0,
    triangles: renderer?.triangles ?? 0,
    maxSampleCalls: maxOf(result.samples, (s) => s.report?.renderer?.calls),
    maxSampleTriangles: maxOf(result.samples, (s) => s.report?.renderer?.triangles),
    views: renderer?.views ?? 0,
    maxViews: maxOf(result.samples, (s) => s.report?.renderer?.views),
    foliageModelQuality: foliage?.modelQuality ?? 0,
    foliageModelVisibleBuckets: foliage?.modelVisibleBuckets ?? 0,
    foliageModelVisibleDraws: foliage?.modelVisibleDraws ?? 0,
    foliageModelVisibleTriangles: foliage?.modelVisibleTriangles ?? 0,
    foliageModelVisibleByLod: foliage?.modelVisibleByLod ?? {},
    foliageModelVisibleDrawsByLod: foliage?.modelVisibleDrawsByLod ?? {},
    foliageModelVisibleTrianglesByLod: foliage?.modelVisibleTrianglesByLod ?? {},
    foliageGrassVisibleTufts: foliage?.grassVisibleTufts ?? 0,
    prewarmElapsedMs: prewarm?.elapsedMs ?? 0,
    prewarmMaxMs: prewarm?.maxMs ?? 0,
    prewarmRemainingMs: prewarm?.remainingMs ?? 0,
    prewarmBudgetUsedRatio: prewarm?.budgetUsedRatio ?? 0,
    prewarmTimedOut: prewarm?.timedOut ?? false,
    prewarmCompleted: prewarm?.manifestCompleted ?? 0,
    prewarmPlanned: prewarm?.manifestPlanned ?? 0,
    prewarmTimedOutEntries: prewarm?.manifestTimedOut ?? 0,
    prewarmFailedEntries: prewarm?.manifestFailed ?? 0,
    prewarmTimedOutEntryIds: prewarm?.timedOutEntryIds ?? [],
    prewarmFailedEntryIds: prewarm?.failedEntryIds ?? [],
    prewarmEntries:
      prewarm?.manifestEntries?.map((entry) => ({
        id: entry.id,
        category: entry.category,
        required: entry.required,
        status: entry.status,
        elapsedMs: entry.elapsedMs,
        remainingMsAfter: entry.remainingMsAfter,
        programDelta: entry.programDelta,
        textureDelta: entry.textureDelta,
        detail: entry.detail,
      })) ?? [],
    contextLost: renderer?.contextLost ?? 0,
    hudHotDomWrites: hud?.hotDomWrites ?? 0,
    hudHotDomSkippedWrites: hud?.hotDomSkippedWrites ?? 0,
    hudHotDomSkipRate: hud?.hotDomSkipRate ?? 0,
    inputIntentToFrameP95: lastReport.input?.intentToFrame?.p95 ?? 0,
    inputIntentToVisibleP95: lastReport.input?.intentToVisible?.p95 ?? 0,
  };
}

function budgetFailures(summary) {
  const checks = [
    ['frame p95', summary.maxFrameP95, THRESHOLDS.maxFrameP95, 'ms'],
    ['long frames >=50ms', summary.frameLong50, THRESHOLDS.maxFrameLong50, ''],
    ['browser long tasks', summary.longTasks, THRESHOLDS.maxLongTasks, ''],
    ['browser long task p95', summary.longTaskP95, THRESHOLDS.maxLongTaskP95, 'ms'],
    ['browser long task max', summary.longTaskMax, THRESHOLDS.maxLongTaskMax, 'ms'],
    ['preload tasks', summary.preloadTasks, THRESHOLDS.maxPreloadTasks, ''],
    ['gltf count', summary.gltfCount, THRESHOLDS.maxGltfCount, ''],
    ['texture count', summary.textureCount, THRESHOLDS.maxTextureCount, ''],
    ['boot bytes', summary.bootMib, THRESHOLDS.maxBootMib, ' MiB'],
    ['boot gltf bytes', summary.bootByType.gltf?.mib ?? 0, THRESHOLDS.maxBootGltfMib, ' MiB'],
    [
      'boot texture bytes',
      summary.bootByType.texture?.mib ?? 0,
      THRESHOLDS.maxBootTextureMib,
      ' MiB',
    ],
    ['boot hdr bytes', summary.bootByType.hdr?.mib ?? 0, THRESHOLDS.maxBootHdrMib, ' MiB'],
    ['draw calls', summary.calls, THRESHOLDS.maxCalls, ''],
    ['triangles', summary.triangles, THRESHOLDS.maxTriangles, ''],
    ['max sample draw calls', summary.maxSampleCalls, THRESHOLDS.maxSampleCalls, ''],
    ['max sample triangles', summary.maxSampleTriangles, THRESHOLDS.maxSampleTriangles, ''],
    ['renderer views', summary.maxViews, THRESHOLDS.maxViews, ''],
    ['prewarm elapsed', summary.prewarmElapsedMs, THRESHOLDS.maxPrewarmMs, 'ms'],
    ['prewarm budget ratio', summary.prewarmBudgetUsedRatio, THRESHOLDS.maxPrewarmBudgetRatio, ''],
    [
      'prewarm timed-out entries',
      summary.prewarmTimedOutEntries,
      THRESHOLDS.maxPrewarmTimedOut,
      '',
    ],
    ['prewarm failed entries', summary.prewarmFailedEntries, THRESHOLDS.maxPrewarmFailed, ''],
    [
      'input intent->frame p95',
      summary.inputIntentToFrameP95,
      THRESHOLDS.maxInputIntentToFrameP95,
      'ms',
    ],
    [
      'input intent->visible p95',
      summary.inputIntentToVisibleP95,
      THRESHOLDS.maxInputIntentToVisibleP95,
      'ms',
    ],
  ];
  const failures = [];
  for (const [label, actual, max, unit] of checks) {
    if (max !== null && actual > max) failures.push(`${label} ${actual}${unit} > ${max}${unit}`);
  }
  const minChecks = [
    ['prewarm completed entries', summary.prewarmCompleted, THRESHOLDS.minPrewarmCompleted],
    ['prewarm entries', summary.prewarmEntries.length, THRESHOLDS.minPrewarmEntries],
  ];
  for (const [label, actual, min] of minChecks) {
    if (min !== null && actual < min) failures.push(`${label} ${actual} < ${min}`);
  }
  if (summary.prewarmTimedOut) failures.push('prewarm exceeded startup budget');
  if (summary.contextLost > 0) failures.push(`context lost ${summary.contextLost} > 0`);
  return failures;
}

async function runViewport(browser, viewport) {
  const page = await browser.newPage();
  if (PERF_PRESET) {
    const presetValue = PRESET_VALUES[PERF_PRESET];
    if (!presetValue) {
      throw new Error(`Unknown PERF_PRESET=${PERF_PRESET}; use low, medium, high, or ultra.`);
    }
    // Seed the STATIC graphics preset into woc_settings before any app script runs, so the
    // applier resolves it on boot and the HUD tier knobs read the right data-fx-level.
    await page.evaluateOnNewDocument((value) => {
      try {
        const key = 'woc_settings';
        const cur = JSON.parse(localStorage.getItem(key) ?? '{}');
        cur.graphicsPreset = value;
        localStorage.setItem(key, JSON.stringify(cur));
      } catch {
        /* storage unavailable */
      }
    }, presetValue);
  }
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
    await bootOffline(page, viewport);
    const samples = [];
    samples.push(await sample(page, 'spawn'));

    await teleportTown(page);
    samples.push(await sample(page, 'town-nameplates'));

    await driveMove(page, { forward: true, back: false, strafeLeft: false, strafeRight: false });
    samples.push(await sample(page, 'forward'));

    await driveMove(page, { forward: true, back: false, strafeLeft: true, strafeRight: false });
    samples.push(await sample(page, 'forward-strafe'));

    await driveLook(page, { x: 0.75, y: -0.1 });
    samples.push(await sample(page, 'look'));

    await openMapBriefly(page);
    samples.push(await sample(page, 'map-open-close'));

    const firstFrame = samples[0]?.report?.frames ?? 0;
    const lastFrame = samples.at(-1)?.report?.frames ?? 0;
    if (lastFrame <= firstFrame)
      errors.push(`Frame counter did not advance for ${viewport.label}.`);

    // run the bounded-node FCT burst AFTER the tour samples, so its hot DOM writes do
    // not skew the steady-state frameP95 / skip-rate the summary reads from the last sample.
    const fctBurst = await fctBurstBoundedNodes(page);

    const result = {
      viewport: viewport.label,
      dimensions: {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: viewport.deviceScaleFactor,
        isMobile: viewport.isMobile,
        hasTouch: viewport.hasTouch,
      },
      userAgent: await page.evaluate(() => navigator.userAgent),
      samples,
      fctBurst,
      ignoredConsoleErrors,
      errors,
    };
    result.summary = summarizeResult(result);
    result.budgetFailures = budgetFailures(result.summary);
    result.fctBurstFailures = fctBurstFailures(fctBurst);
    return result;
  } finally {
    await page.close();
  }
}

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

const startedAt = new Date().toISOString();
const results = [];
try {
  for (const viewport of selectedViewports()) {
    console.log(`capturing ${viewport.label} perf tour...`);
    results.push(await runViewport(browser, viewport));
  }
} finally {
  await browser.close();
}

const artifact = {
  generatedAt: startedAt,
  baseUrl: BASE_URL,
  url: perfUrl(),
  scenario: PERF_SCENARIO,
  stepMs: STEP_MS,
  settleMs: SETTLE_MS,
  bootTimeoutMs: BOOT_TIMEOUT_MS,
  navTimeoutMs: NAV_TIMEOUT_MS,
  browserPath: BROWSER_PATH,
  thresholds: THRESHOLDS,
  summary: Object.fromEntries(results.map((r) => [r.viewport, r.summary])),
  results,
};
fs.writeFileSync(OUTPUT, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`wrote ${OUTPUT}`);
for (const r of results) {
  const s = r.summary;
  console.log(
    `${r.viewport}: fps ${s.fps} (10s ${s.fps10s}) p95 ${s.frameP95}ms maxP95 ${s.maxFrameP95}ms longtask ${s.longTasks}/${s.longTaskP95}ms tasks ${s.preloadTasks} gltf ${s.gltfCount} tex ${s.textureCount} boot ${s.bootMib}MiB calls ${s.calls}/${s.maxSampleCalls} tris ${s.triangles}/${s.maxSampleTriangles} views ${s.views}/${s.maxViews} foliage q${s.foliageModelQuality} buckets ${s.foliageModelVisibleBuckets} draws ${s.foliageModelVisibleDraws} tris ${s.foliageModelVisibleTriangles} prewarm ${s.prewarmElapsedMs}/${s.prewarmMaxMs}ms ${s.prewarmCompleted}/${s.prewarmPlanned} fail ${s.prewarmFailedEntries} timeout ${s.prewarmTimedOutEntries} input ${s.inputIntentToVisibleP95}ms tier ${s.rendererTier} hudSkip ${Math.round(s.hudHotDomSkipRate * 100)}%`,
  );
}

for (const r of results) {
  const b = r.fctBurst;
  if (b)
    console.log(
      `${r.viewport}: fct burst ${b.spawnPerWave}/wave x${b.waves} -> live nodes [${b.counts.join(', ')}] (cap-bounded)`,
    );
}

const hardErrors = results.flatMap((r) => [
  ...r.errors.map((e) => `${r.viewport}: ${e}`),
  ...r.budgetFailures.map((e) => `${r.viewport}: budget ${e}`),
  ...(r.fctBurstFailures ?? []).map((e) => `${r.viewport}: ${e}`),
]);
if (hardErrors.length) {
  console.error(hardErrors.join('\n'));
  process.exitCode = 1;
}
