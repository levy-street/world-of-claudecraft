import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Profiler, profilerBrowserLaunchOptions } from '../profiler/harness.mjs';

export const HITCH_VIEWPORT = Object.freeze({ width: 1280, height: 720 });
export const HITCH_VIEWPORT_LABEL = `${HITCH_VIEWPORT.width}x${HITCH_VIEWPORT.height}`;
export const HITCH_SETTLED_HEAP_WAIT_MS = 100;
export const HITCH_BROWSER_EXTRA_ARGS = Object.freeze([
  '--disable-gpu-shader-disk-cache',
  '--disable-crashpad-for-testing',
  '--disable-crash-reporter',
  '--disable-breakpad',
  '--enable-precise-memory-info',
  '--disable-backgrounding-occluded-windows',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--mute-audio',
]);

export const HITCH_BROWSER_FLAGS = Object.freeze([
  '--user-data-dir=<fresh-temp>',
  ...profilerBrowserLaunchOptions({
    browserPath: '<resolved-browser>',
    userDataDir: '<fresh-temp>',
    headless: false,
    width: HITCH_VIEWPORT.width,
    height: HITCH_VIEWPORT.height,
    extraArgs: HITCH_BROWSER_EXTRA_ARGS,
  }).args,
]);

const PROFILE_PREFIX = 'woc-perf-hitch-';
const activeProfileDirs = new Set();
const activeSessions = new Set();

process.once('exit', () => {
  for (const profileDir of activeProfileDirs) {
    if (safeProfileDir(profileDir)) fs.rmSync(profileDir, { recursive: true, force: true });
  }
});

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const roundMb = (value) => Math.round(value * 100) / 100;

export async function readSettledHeapMb(cdpSession, wait = sleep) {
  await cdpSession.send('HeapProfiler.collectGarbage');
  await wait(HITCH_SETTLED_HEAP_WAIT_MS);
  await cdpSession.send('HeapProfiler.collectGarbage');
  await wait(HITCH_SETTLED_HEAP_WAIT_MS);
  const usage = await cdpSession.send('Runtime.getHeapUsage');
  if (!Number.isFinite(usage?.usedSize) || usage.usedSize < 0) {
    throw new Error('CDP Runtime.getHeapUsage returned an invalid usedSize');
  }
  return roundMb(usage.usedSize / 2 ** 20);
}

export function browserEvidenceFromScenarios(rawScenarios) {
  if (!Array.isArray(rawScenarios) || rawScenarios.length === 0) {
    throw new Error('scenario browser evidence is missing');
  }
  const first = rawScenarios[0];
  const expectedFlags = JSON.stringify(first.browserFlags);
  if (!first.browserVersion || !Array.isArray(first.browserFlags)) {
    throw new Error('scenario browser version or launch arguments are missing');
  }
  for (const raw of rawScenarios) {
    if (raw.browserVersion !== first.browserVersion) {
      throw new Error('scenario browser versions are inconsistent');
    }
    if (JSON.stringify(raw.browserFlags) !== expectedFlags) {
      throw new Error('scenario browser launch arguments are inconsistent');
    }
  }
  return {
    browserVersion: first.browserVersion,
    browserFlags: [...first.browserFlags],
    freshProfile: rawScenarios.every((raw) => raw.freshProfile === true),
  };
}

function presetValue(preset) {
  return { low: 1, medium: 2, high: 3, ultra: 4, insane: 6 }[preset] ?? 0;
}

async function seedSettings(profiler, preset) {
  await profiler.page.evaluateOnNewDocument((value) => {
    try {
      const key = 'woc_settings';
      const settings = JSON.parse(localStorage.getItem(key) ?? '{}');
      settings.fullscreen = 0;
      settings.graphicsPreset = value;
      localStorage.setItem(key, JSON.stringify(settings));
    } catch {
      /* a failed storage seed will surface as a tier mismatch */
    }
  }, presetValue(preset));
}

async function parkWindow(profiler) {
  try {
    const session = await profiler.page.createCDPSession();
    const { windowId } = await session.send('Browser.getWindowForTarget');
    await session.send('Browser.setWindowBounds', {
      windowId,
      bounds: {
        left: 340,
        top: 30,
        width: HITCH_VIEWPORT.width,
        height: HITCH_VIEWPORT.height + 120,
      },
    });
    await session.detach();
  } catch {
    /* placement does not change the fixed viewport */
  }
}

export async function requireVisible(profiler, label) {
  await profiler.page.bringToFront().catch(() => {});
  const visible = await profiler.page.evaluate(() => document.visibilityState === 'visible');
  if (!visible) throw new Error(`${label}: headed browser window is hidden or occluded`);
}

async function waitVisible(profiler, ms, label) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    await requireVisible(profiler, label);
    await sleep(Math.min(5000, Math.max(0, deadline - Date.now())));
  }
}

function safeProfileDir(profileDir) {
  const relative = path.relative(os.tmpdir(), profileDir);
  return (
    relative !== '' &&
    !relative.startsWith('..') &&
    !path.isAbsolute(relative) &&
    path.basename(profileDir).startsWith(PROFILE_PREFIX)
  );
}

export function programKeysCreatedSince(baselineKeys, observedKeys) {
  if (!Array.isArray(baselineKeys) || !Array.isArray(observedKeys)) return null;
  const baseline = new Set(baselineKeys.map(String));
  return [...new Set(observedKeys.map(String))].filter((key) => !baseline.has(key));
}

export async function closeHitchBrowser(session) {
  const profiler = session?.profiler;
  const proc = profiler?.browser?.process() ?? null;
  let timer;
  try {
    if (profiler?.mode === 'online') {
      await profiler.page?.evaluate(() => window.__game?.online?.sendLogout?.()).catch(() => {});
      await sleep(300);
    }
    await Promise.race([
      profiler?.close().finally(() => clearTimeout(timer)),
      new Promise((resolve) => {
        timer = setTimeout(resolve, 8000);
        timer.unref?.();
      }),
    ]);
  } finally {
    activeSessions.delete(session);
    try {
      if (proc && proc.exitCode == null) proc.kill('SIGKILL');
    } catch {
      /* process already ended */
    }
    if (session?.profileDir && safeProfileDir(session.profileDir)) {
      fs.rmSync(session.profileDir, { recursive: true, force: true });
      activeProfileDirs.delete(session.profileDir);
    }
  }
}

export async function closeActiveHitchBrowsers() {
  await Promise.all(
    [...activeSessions].map((session) => closeHitchBrowser(session).catch(() => {})),
  );
}

export async function openHitchBrowser({ mode, preset, gameUrl, serverUrl, onlineFixture = null }) {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), PROFILE_PREFIX));
  activeProfileDirs.add(profileDir);
  const pageErrors = [];
  const consoleErrors = [];
  const profiler = new Profiler({
    gameUrl,
    server: serverUrl,
    userDataDir: profileDir,
    width: HITCH_VIEWPORT.width,
    height: HITCH_VIEWPORT.height,
    extraArgs: HITCH_BROWSER_EXTRA_ARGS,
  });
  const session = {
    profiler,
    profileDir,
    pageErrors,
    consoleErrors,
    browserVersion: '',
    browserFlags: [...HITCH_BROWSER_FLAGS],
    freshProfile: true,
  };
  activeSessions.add(session);
  try {
    await profiler.launch();
    profiler.page.on('pageerror', (error) =>
      pageErrors.push(String(error?.stack ?? error).slice(0, 1500)),
    );
    profiler.page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 260));
    });
    await seedSettings(profiler, preset);
    await parkWindow(profiler);
    await requireVisible(profiler, 'browser launch');
    await profiler.enter({
      mode,
      tier: preset,
      selectorTimeoutMs: 60_000,
      gameBootTimeoutMs: 300_000,
      extraQuery: '&governor=1&perfReport=0',
      onlineFixture,
    });
    await parkWindow(profiler);
    await requireVisible(profiler, 'world entry');
    session.browserVersion = await profiler.browser.version();
    const renderer = await profiler.page.evaluate(() => {
      const stats = window.__game?.renderer?.perfStats?.();
      return stats
        ? {
            tier: stats.tier,
            glRenderer: stats.glRenderer,
            autoGovernor: stats.autoGovernor,
            contextLost: stats.contextLost,
          }
        : null;
    });
    if (!renderer) throw new Error('renderer perfStats is unavailable');
    if (/swiftshader|software|llvmpipe/i.test(renderer.glRenderer)) {
      throw new Error(`software renderer is forbidden for hitch runs: ${renderer.glRenderer}`);
    }
    if (renderer.tier !== preset) {
      throw new Error(`renderer tier mismatch: requested ${preset}, got ${renderer.tier}`);
    }
    if (renderer.autoGovernor !== true) {
      throw new Error('adaptive render governor must be armed so the submit-stall latch is live');
    }
    if (renderer.contextLost > 0) throw new Error('WebGL context was lost during world entry');
    return session;
  } catch (error) {
    await closeHitchBrowser(session);
    throw error;
  }
}

export async function startCollector(page, label) {
  await page.evaluate((scenarioLabel) => {
    const game = window.__game;
    if (!game?.renderer?.perfStats || !game?.perf?.report) {
      throw new Error('hitch collector cannot see the game perf surface');
    }
    const programKeys = () => {
      const programs = game.renderer.webgl?.info?.programs ?? [];
      return programs.map((program, index) =>
        String(program?.cacheKey ?? `program-index-${index}`),
      );
    };
    const stats = () => {
      const value = game.renderer.perfStats();
      return {
        programs: value.programs,
        textures: value.textures,
        pooledVisuals: value.pooledVisuals,
        renderBudget: {
          reason: value.renderBudget.reason,
          recentSubmitStalls: value.renderBudget.recentSubmitStalls,
          lastSubmitStallMs: value.renderBudget.lastSubmitStallMs,
        },
      };
    };
    const startedAt = performance.now();
    const first = stats();
    game.perf.reset();
    window.__hitchReferee = {
      label: scenarioLabel,
      on: true,
      startedAt,
      lastAt: startedAt,
      warmupBoundaryMs: null,
      frames: [],
      baselineProgramKeys: new Set(),
      newProgramKeys: new Set(),
      counterBaseline: null,
      counterPeaks: { textures: first.textures, pooledVisuals: first.pooledVisuals },
      markWarmup() {
        if (this.warmupBoundaryMs !== null) return this.warmupBoundaryMs;
        this.warmupBoundaryMs = performance.now() - this.startedAt;
        this.baselineProgramKeys = new Set(programKeys());
        const current = stats();
        this.counterBaseline = {
          textures: current.textures,
          pooledVisuals: current.pooledVisuals,
        };
        this.counterPeaks = { ...this.counterBaseline };
        game.perf.reset();
        return this.warmupBoundaryMs;
      },
      samplePrograms() {
        if (this.warmupBoundaryMs === null) return;
        for (const key of programKeys()) {
          if (!this.baselineProgramKeys.has(key)) this.newProgramKeys.add(key);
        }
      },
      stop() {
        this.on = false;
        this.samplePrograms();
        const current = stats();
        this.counterPeaks.textures = Math.max(this.counterPeaks.textures, current.textures);
        this.counterPeaks.pooledVisuals = Math.max(
          this.counterPeaks.pooledVisuals,
          current.pooledVisuals,
        );
        const report = game.perf.report();
        const hitch = game.perf.hitchReport?.() ?? null;
        return {
          warmupBoundaryMs: this.warmupBoundaryMs,
          frames: this.frames.slice(),
          baselineProgramKeys: [...this.baselineProgramKeys],
          observedProgramKeys: [...this.baselineProgramKeys, ...this.newProgramKeys],
          counterBaseline: this.counterBaseline,
          counterPeaks: this.counterPeaks,
          report,
          heapFloor: hitch?.heapFloor ?? null,
          heapFloorSeries: hitch?.heapFloorSeries ?? null,
        };
      },
    };
    const tick = (now) => {
      const referee = window.__hitchReferee;
      if (!referee?.on) return;
      const current = stats();
      const atMs = now - referee.startedAt;
      const dtMs = now - referee.lastAt;
      referee.lastAt = now;
      referee.frames.push({ atMs, dtMs, ...current });
      if (referee.warmupBoundaryMs !== null) {
        referee.samplePrograms();
        referee.counterPeaks.textures = Math.max(referee.counterPeaks.textures, current.textures);
        referee.counterPeaks.pooledVisuals = Math.max(
          referee.counterPeaks.pooledVisuals,
          current.pooledVisuals,
        );
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, label);
}

export async function runMeasuredWindow(session, spec, action, deps = {}) {
  const { profiler } = session;
  const ensureVisible = deps.requireVisible ?? requireVisible;
  const beginCollector = deps.startCollector ?? startCollector;
  const waitForVisible = deps.waitVisible ?? waitVisible;
  const settleHeap = deps.readSettledHeapMb ?? readSettledHeapMb;
  await ensureVisible(profiler, spec.name);
  await beginCollector(profiler.page, spec.name);
  await waitForVisible(profiler, spec.warmupMs, `${spec.name} warmup`);
  const cdpSession = await profiler.page.createCDPSession();
  try {
    // Finish both forced collections before markWarmup starts the measured frame window.
    const warmupMb = await settleHeap(cdpSession);
    const warmupBoundaryMs = await profiler.page.evaluate(() => window.__hitchReferee.markWarmup());
    const actionPromise = Promise.resolve().then(action);
    await Promise.all([
      actionPromise,
      waitForVisible(profiler, spec.measureMs, `${spec.name} measurement`),
    ]);
    // Stop frame capture before the ending collections so their pauses are never measured.
    const raw = await profiler.page.evaluate(() => window.__hitchReferee.stop());
    const endMb = await settleHeap(cdpSession);
    const newProgramKeys = programKeysCreatedSince(
      raw.baselineProgramKeys,
      raw.observedProgramKeys,
    );
    const contextLost = raw.report?.renderer?.contextLost ?? 0;
    if (contextLost > 0) throw new Error(`${spec.name}: WebGL context lost ${contextLost} time(s)`);
    return {
      ...raw,
      settledHeap: { warmupMb, endMb, deltaMb: roundMb(endMb - warmupMb) },
      newProgramKeys,
      name: spec.name,
      warmupMs: spec.warmupMs,
      warmupBoundaryMs,
      measureMs: spec.measureMs,
      pageErrors: [...(session.pageErrors ?? [])],
      consoleErrors: [...(session.consoleErrors ?? [])],
    };
  } finally {
    await cdpSession.detach().catch(() => {});
  }
}
