// Browser perf tour: boots offline mode with ?perf and writes structured
// window.__game.perf.report() samples to tmp/ for desktop/mobile comparison.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from './browser_path.mjs';

const BASE_URL = process.env.GAME_URL ?? 'http://localhost:5173';
const VIEWPORT_MODE = process.env.PERF_VIEWPORT ?? 'both';
const STEP_MS = Number(process.env.PERF_STEP_MS ?? 2500);
const SETTLE_MS = Number(process.env.PERF_SETTLE_MS ?? 600);
const BOOT_TIMEOUT_MS = Number(process.env.PERF_BOOT_TIMEOUT_MS ?? 120000);
const OUTPUT = process.env.PERF_OUT ?? path.join('tmp', `perf-tour-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);

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
    label: 'mobile',
    width: 390,
    height: 844,
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
  return url.toString();
}

function selectedViewports() {
  if (VIEWPORT_MODE === 'both') return [VIEWPORTS.desktop, VIEWPORTS.mobile];
  const viewport = VIEWPORTS[VIEWPORT_MODE];
  if (!viewport) throw new Error(`Unknown PERF_VIEWPORT=${VIEWPORT_MODE}; use desktop, mobile, or both.`);
  return [viewport];
}

function isIgnorableConsoleError(text) {
  return text.includes('/api/project-stats') || text.includes('project stats') || text.includes('502');
}

async function bootOffline(page, viewport) {
  await page.setViewport(viewport);
  await page.goto(perfUrl(), { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#btn-offline', { timeout: 30000 });
  await page.$eval('#btn-offline', (el) => el.click());
  await page.waitForSelector('#char-name', { timeout: 30000 });
  await page.$eval('#char-name', (el, value) => {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, viewport.label === 'mobile' ? 'MobilePerf' : 'DesktopPerf');
  await page.$eval('#offline-select .mini-class[data-class="warrior"]', (el) => el.click());
  await page.$eval('#btn-start-offline', (el) => el.click());
  try {
    await page.waitForFunction(
      () => Boolean(window.__game?.sim?.player && window.__game?.perf?.report),
      { timeout: BOOT_TIMEOUT_MS },
    );
  } catch (err) {
    const state = await page.evaluate(() => {
      const visiblePanel = [...document.querySelectorAll('#mode-select,#login-panel,#realm-panel,#charselect-panel,#offline-select')]
        .find((el) => !el.hasAttribute('hidden'))?.id ?? null;
      const loading = document.querySelector('#loading-screen');
      const fatal = document.querySelector('#fatal-overlay, .fatal-overlay');
      return {
        visiblePanel,
        startScreenDisplay: getComputedStyle(document.querySelector('#start-screen')).display,
        loadingVisible: loading?.classList.contains('visible') ?? false,
        loadingStatus: document.querySelector('#ls-status')?.textContent ?? '',
        offlineError: document.querySelector('#offline-error')?.textContent ?? '',
        selectedClass: document.querySelector('#offline-select .mini-class.sel')?.getAttribute('data-class') ?? null,
        name: document.querySelector('#char-name')?.value ?? '',
        hasGame: Boolean(window.__game),
        bodyClass: document.body.className,
        fatalText: fatal?.textContent ?? '',
      };
    });
    throw new Error(`Timed out waiting for offline world boot: ${JSON.stringify(state)}`, { cause: err });
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
    try { return new URL(url, BASE_URL).pathname; } catch { return url; }
  })().replace(/^\/+/, '');
  if (!pathname.startsWith('media/')) return pathname;
  const parts = pathname.slice('media/'.length).split('/');
  const file = parts.pop() ?? '';
  const dot = file.lastIndexOf('.');
  if (dot <= 0) return pathname.slice('media/'.length);
  const stem = file.slice(0, dot);
  const ext = file.slice(dot);
  const hashDot = stem.lastIndexOf('.');
  const logicalStem = hashDot > 0 && /^[a-f0-9]{12}$/.test(stem.slice(hashDot + 1)) ? stem.slice(0, hashDot) : stem;
  return [...parts, `${logicalStem}${ext}`].join('/');
}

function staticAssetBytes(url) {
  const logical = logicalAssetPath(url);
  const file = path.join(process.cwd(), 'public', logical);
  try { return fs.statSync(file).size; } catch { return 0; }
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
    ['boot texture bytes', summary.bootByType.texture?.mib ?? 0, THRESHOLDS.maxBootTextureMib, ' MiB'],
    ['boot hdr bytes', summary.bootByType.hdr?.mib ?? 0, THRESHOLDS.maxBootHdrMib, ' MiB'],
    ['draw calls', summary.calls, THRESHOLDS.maxCalls, ''],
    ['triangles', summary.triangles, THRESHOLDS.maxTriangles, ''],
    ['max sample draw calls', summary.maxSampleCalls, THRESHOLDS.maxSampleCalls, ''],
    ['max sample triangles', summary.maxSampleTriangles, THRESHOLDS.maxSampleTriangles, ''],
    ['renderer views', summary.maxViews, THRESHOLDS.maxViews, ''],
    ['input intent->frame p95', summary.inputIntentToFrameP95, THRESHOLDS.maxInputIntentToFrameP95, 'ms'],
    ['input intent->visible p95', summary.inputIntentToVisibleP95, THRESHOLDS.maxInputIntentToVisibleP95, 'ms'],
  ];
  const failures = [];
  for (const [label, actual, max, unit] of checks) {
    if (max !== null && actual > max) failures.push(`${label} ${actual}${unit} > ${max}${unit}`);
  }
  if (summary.contextLost > 0) failures.push(`context lost ${summary.contextLost} > 0`);
  return failures;
}

async function runViewport(browser, viewport) {
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
    if (lastFrame <= firstFrame) errors.push(`Frame counter did not advance for ${viewport.label}.`);

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
      ignoredConsoleErrors,
      errors,
    };
    result.summary = summarizeResult(result);
    result.budgetFailures = budgetFailures(result.summary);
    return result;
  } finally {
    await page.close();
  }
}

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--window-size=1600,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
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
  stepMs: STEP_MS,
  settleMs: SETTLE_MS,
  bootTimeoutMs: BOOT_TIMEOUT_MS,
  browserPath: BROWSER_PATH,
  thresholds: THRESHOLDS,
  summary: Object.fromEntries(results.map((r) => [r.viewport, r.summary])),
  results,
};
fs.writeFileSync(OUTPUT, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`wrote ${OUTPUT}`);
for (const r of results) {
  const s = r.summary;
  console.log(`${r.viewport}: fps ${s.fps} (10s ${s.fps10s}) p95 ${s.frameP95}ms maxP95 ${s.maxFrameP95}ms longtask ${s.longTasks}/${s.longTaskP95}ms tasks ${s.preloadTasks} gltf ${s.gltfCount} tex ${s.textureCount} boot ${s.bootMib}MiB calls ${s.calls}/${s.maxSampleCalls} tris ${s.triangles}/${s.maxSampleTriangles} views ${s.views}/${s.maxViews} input ${s.inputIntentToVisibleP95}ms tier ${s.rendererTier} hudSkip ${Math.round(s.hudHotDomSkipRate * 100)}%`);
}

const hardErrors = results.flatMap((r) => [
  ...r.errors.map((e) => `${r.viewport}: ${e}`),
  ...r.budgetFailures.map((e) => `${r.viewport}: budget ${e}`),
]);
if (hardErrors.length) {
  console.error(hardErrors.join('\n'));
  process.exitCode = 1;
}
