// Versioned GPU hitch capture CLI. The browser probe is installed before
// navigation; all attribution and validation happens in the pure metrics module.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { findBrowserPath } from './browser_path_resolve.mjs';
import { dismissEntryOverlays, enterOfflineGame } from './enter_offline_game.mjs';
import { assertLoopbackUrl } from './lib/loopback_guard.mjs';
import {
  createGearedObserverFixture,
  GEARED_ARRIVAL_OBSERVER,
  GearedArrivalRoster,
} from './profiler/geared_arrival_roster.mjs';
import {
  GPU_HITCH_SCHEMA_VERSION,
  makeProvenance,
  measurementParams,
  sanitizeCaptureUrl,
  summarizeCapture,
  validateCapture,
} from './profiler/gpu_hitch_metrics.mjs';
import { installGpuHitchProbe } from './profiler/gpu_hitch_probe.mjs';
import {
  enterOnlineProfilerCharacter,
  requireOnlineProfilerCapability,
} from './profiler/harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_URL = 'http://localhost:5173/?perf';
const DEFAULT_DURATION_MS = 180_000;
const DEFAULT_VIEWPORT = Object.freeze({ width: 1600, height: 900, deviceScaleFactor: 1 });
const PROFILE_PREFIX = 'woc-gpu-hitch-';
const BROWSER_ARGS = Object.freeze([
  '--ignore-gpu-blocklist',
  '--enable-gpu',
  '--disable-gpu-shader-disk-cache',
  '--disable-gpu-vsync',
  '--disable-frame-rate-limit',
  '--disable-backgrounding-occluded-windows',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--mute-audio',
]);

const usage = `GPU hitch capture

  node scripts/gpu_hitch_capture.mjs [options]

  --url URL              Vite origin and query (default ${DEFAULT_URL})
  --mode offline|manual|online-geared  entry scenario (default offline)
  --server-url URL       local online game server (default SERVER_URL or http://localhost:8787)
  --bots N               deterministic geared crowd size for online-geared (default 20)
  --profile shader|upload|full  instrumentation profile (default shader)
  --duration-ms N        capture duration after world entry (default ${DEFAULT_DURATION_MS})
  --viewport WIDTHxHEIGHT  CSS viewport at DPR 1 (default 1600x900)
  --observer X,Z         world spot the observer AND the geared crowd occupy
                         (default 0,0). Changing it changes what is measured:
                         a different town streams different content, so a leg
                         here is only comparable with another at the same spot.
  --out FILE             JSON output (default tmp/gpu-hitch_<stamp>.json)
  --group-id TOKEN       A/B campaign identifier (requires leg/repetition/order)
  --leg TOKEN            leg label inside the A/B campaign
  --repetition N         one-based repetition number
  --order N              one-based execution order inside the campaign
  --headed               use a visible real-GPU browser (default)
  --headless             smoke only, software timing is not performance evidence
  --allow-dirty          record a dirty worktree instead of refusing it
  --help                 show this text`;

function integer(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function campaignToken(value, label) {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(value))
    throw new Error(`${label} must be a 1-64 character identifier`);
  return value;
}

function observerSpot(value) {
  const match = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(value);
  const x = Number(match?.[1]);
  const z = Number(match?.[2]);
  if (!Number.isFinite(x) || !Number.isFinite(z))
    throw new Error('--observer must use X,Z with finite numbers');
  return { x, z };
}

function viewport(value) {
  const match = /^(\d+)x(\d+)$/i.exec(value);
  const width = Number(match?.[1]);
  const height = Number(match?.[2]);
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error('--viewport must use WIDTHxHEIGHT with positive integers');
  }
  return { width, height, deviceScaleFactor: 1 };
}

export function parseArgs(argv) {
  const args = {
    url: DEFAULT_URL,
    mode: 'offline',
    serverUrl: process.env.SERVER_URL ?? 'http://localhost:8787',
    bots: 20,
    profile: 'shader',
    durationMs: DEFAULT_DURATION_MS,
    viewport: { ...DEFAULT_VIEWPORT },
    observer: null,
    out: null,
    groupId: null,
    leg: null,
    repetition: null,
    order: null,
    headless: false,
    allowDirty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const option = argv[index];
    const next = () => {
      if (argv[index + 1] === undefined || argv[index + 1].startsWith('--'))
        throw new Error(`${option} needs a value`);
      return argv[++index];
    };
    if (option === '--help' || option === '-h') args.help = true;
    else if (option === '--url') args.url = next();
    else if (option === '--mode') {
      args.mode = next();
      if (!['offline', 'manual', 'online-geared'].includes(args.mode))
        throw new Error('--mode must be offline, manual, or online-geared');
    } else if (option === '--server-url') {
      args.serverUrl = next();
    } else if (option === '--bots') {
      args.bots = integer(next(), '--bots');
      if (args.bots > 40) throw new Error('--bots must not exceed 40');
    } else if (option === '--profile') {
      args.profile = next();
      if (!['shader', 'upload', 'full'].includes(args.profile))
        throw new Error('--profile must be shader, upload, or full');
    } else if (option === '--duration-ms') args.durationMs = integer(next(), '--duration-ms');
    else if (option === '--viewport') args.viewport = viewport(next());
    else if (option === '--observer') args.observer = observerSpot(next());
    else if (option === '--out') args.out = next();
    else if (option === '--group-id') args.groupId = campaignToken(next(), '--group-id');
    else if (option === '--leg') args.leg = campaignToken(next(), '--leg');
    else if (option === '--repetition') args.repetition = integer(next(), '--repetition');
    else if (option === '--order') args.order = integer(next(), '--order');
    else if (option === '--headless') args.headless = true;
    else if (option === '--headed') args.headless = false;
    else if (option === '--allow-dirty') args.allowDirty = true;
    else throw new Error(`unknown option ${option}`);
  }
  new URL(args.url);
  new URL(args.serverUrl);
  if (args.mode === 'online-geared') {
    assertLoopbackUrl(args.url, '--url');
    assertLoopbackUrl(args.serverUrl, 'SERVER_URL');
  }
  const campaignFields = [args.groupId, args.leg, args.repetition, args.order];
  if (
    campaignFields.some((value) => value !== null) &&
    campaignFields.some((value) => value === null)
  )
    throw new Error('--group-id, --leg, --repetition, and --order must be supplied together');
  return args;
}

function git(args, fallback = '') {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return fallback;
  }
}

function sourceBuildId() {
  const hash = createHash('sha256');
  hash.update(git(['rev-parse', 'HEAD'], 'no-head'));
  const paths = [
    'src',
    'vite.config.ts',
    'package.json',
    'pnpm-lock.yaml',
    'scripts/gpu_hitch_capture.mjs',
    'scripts/profiler/gpu_hitch_probe.mjs',
    'scripts/profiler/gpu_hitch_metrics.mjs',
    'scripts/profiler/geared_arrival_fixture.mjs',
    'scripts/profiler/geared_arrival_roster.mjs',
    'src/game/gpu_hitch_receipt.ts',
  ];
  const status = git(['status', '--porcelain', '-z', '--', ...paths], '');
  hash.update(status);
  for (const entry of status.split('\0').filter(Boolean)) {
    hash.update(entry);
    const relative = entry.slice(3).split(' -> ').at(-1);
    if (!relative) continue;
    const absolute = path.join(ROOT, relative);
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile())
      hash.update(fs.readFileSync(absolute));
  }
  return hash.digest('hex').slice(0, 16);
}

function fileSha256(relativePath) {
  return createHash('sha256')
    .update(fs.readFileSync(path.join(ROOT, relativePath)))
    .digest('hex');
}

function defaultOutput(now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return path.join(ROOT, 'tmp', `gpu-hitch_${stamp}.json`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function browserArgs(viewportSize) {
  return [`--window-size=${viewportSize.width + 20},${viewportSize.height + 60}`, ...BROWSER_ARGS];
}

function browserFlags(headless, viewportSize) {
  return [
    '--user-data-dir=<temporary-profile>',
    ...browserArgs(viewportSize),
    ...(headless ? ['--headless=new'] : []),
  ];
}

async function waitForManualEntry(page) {
  // The TTY refusal itself lives in capture(), before anything is launched.
  // Here the rule is only that the listener is always released: a resumed
  // stdin holds the event loop open after the artifact is written.
  process.stdout.write(
    '\nBrowser opened. Complete login and enter the world manually, then press Enter here to start the timed window.\n',
  );
  try {
    await new Promise((resolve) => {
      process.stdin.resume();
      process.stdin.once('data', resolve);
    });
  } finally {
    process.stdin.pause();
  }
  await page.waitForFunction(() => Boolean(window.__game?.renderer), {
    timeout: 120_000,
    polling: 250,
  });
}

function rendererEnvironment(snapshot, browserVersion, flags) {
  const stats = snapshot.rendererStats ?? {};
  const receiptTier = snapshot.runtimeReceipt?.effective?.renderer?.tier;
  const rendererTier =
    typeof receiptTier === 'string'
      ? receiptTier
      : typeof stats.tier === 'string'
        ? stats.tier
        : null;
  return {
    browserVersion,
    browserFlags: flags,
    shaderDiskCache: 'disabled',
    glVendor: typeof stats.glVendor === 'string' ? stats.glVendor : '',
    glRenderer: typeof stats.glRenderer === 'string' ? stats.glRenderer : '',
    viewport: `${stats.width ?? ''}x${stats.height ?? ''}`,
    devicePixelRatio: stats.pixelRatio ?? null,
    rendererTier,
    visible: snapshot.visible === true,
    visibilityTransitions: snapshot.visibilityTransitions,
    contextLost: snapshot.contextLost,
  };
}

function compileUnitsOnProbeTimeline(units, probeStartedAtPerformanceMs) {
  if (!Array.isArray(units) || !Number.isFinite(probeStartedAtPerformanceMs)) return [];
  const timestampKeys = ['submittedAtMs', 'syncEndAtMs', 'settledAtMs', 'failedAtMs'];
  return units.map((unit) => {
    const normalized = { ...unit };
    for (const key of timestampKeys) {
      if (Number.isFinite(unit?.[key])) normalized[key] = unit[key] - probeStartedAtPerformanceMs;
    }
    return normalized;
  });
}

export function buildCapture({ args, url, snapshot, browserVersion, flags, provenance }) {
  const receipt = snapshot.runtimeReceipt;
  const effective = receipt
    ? { schemaVersion: receipt.schemaVersion, ...receipt.effective }
    : {
        schemaVersion: GPU_HITCH_SCHEMA_VERSION,
        prewarmPacing: { available: false },
        modular: { available: false },
      };
  const sanitizedUrl = sanitizeCaptureUrl(url);
  const raw = {
    schemaVersion: GPU_HITCH_SCHEMA_VERSION,
    capture: {
      id: snapshot.captureId,
      groupId: args.groupId,
      leg: args.leg,
      repetition: args.repetition,
      order: args.order,
      profile: args.profile,
      headless: args.headless === true,
      // What this run CLAIMS, written into the artifact so a standalone
      // analyzer re-run reproduces the same verdict. A headed run claims the
      // real GPU, so a software rasterizer found on one is an error rather
      // than a warning; a --headless run claims smoke only.
      performanceEvidence: args.headless !== true,
      scenario: scenarioName(args.mode),
      startedAtUtc: new Date(snapshot.startedAtEpochMs).toISOString(),
      // The timed window starts after world entry. Keep its requested duration
      // as the campaign contract instead of including variable boot time.
      durationMs: args.durationMs,
      // Preserve the probe's full wall-clock span for diagnostics and timeline
      // reconstruction without making it part of A/B comparability.
      totalElapsedMs: snapshot.elapsedMs,
      complete: snapshot.stopReason === 'duration',
      url: sanitizedUrl,
      zone: snapshot.rendererStats?.currentZoneId ?? null,
      observer: args.observer ?? null,
      fixture: args.fixtureEvidence ?? null,
    },
    provenance: {
      ...provenance,
      servedBuildId: receipt?.buildId ?? '',
    },
    requested: measurementParams(new URL(url).search),
    effective,
    environment: rendererEnvironment(snapshot, browserVersion, flags),
    timeline: {
      phases: snapshot.transitions,
      links: snapshot.links,
      queries: snapshot.queries,
      programs: snapshot.programs ?? [],
      sceneRoots: snapshot.sceneRoots ?? [],
      compileUnits: compileUnitsOnProbeTimeline(
        snapshot.rendererStats?.prewarm?.compileUnits,
        snapshot.startedAtPerformanceMs,
      ),
      uploadBucketWidthMs: snapshot.uploadBucketWidthMs,
      uploadBuckets: snapshot.uploadBuckets,
    },
    diagnostics: {
      controls: snapshot.controls,
      rendererHook: snapshot.rendererHook ?? null,
      runtimeReceipt: receipt,
      rendererStats: snapshot.rendererStats,
      probeRunningAtStop: snapshot.running,
    },
  };
  return raw;
}

function scenarioName(mode) {
  if (mode === 'offline') return 'offline-entry';
  if (mode === 'online-geared') return 'online-geared-entry';
  return 'manual-entry';
}

async function enterOnlineGearedGame(page, args, runId) {
  assertLoopbackUrl(args.url, '--url');
  assertLoopbackUrl(args.serverUrl, 'SERVER_URL');
  const fixture = await createGearedObserverFixture(args.serverUrl, runId);
  await page.evaluateOnNewDocument((session) => {
    localStorage.setItem(
      'woc_session',
      JSON.stringify({ token: session.token, username: session.username }),
    );
  }, fixture);
  await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('#btn-online', { timeout: 60_000 });
  await page.evaluate(() => document.querySelector('#btn-online')?.click());
  await enterOnlineProfilerCharacter(page, { name: fixture.characterName, cls: 'warrior' });
  await page
    .waitForSelector('#ws-continue:not([disabled])', { visible: true, timeout: 20_000 })
    .catch(() => {});
  await page.evaluate(() => {
    const button = document.querySelector('#ws-continue');
    if (button && !button.disabled) button.click();
  });
  await page.waitForFunction(
    () => Boolean(window.__game?.world?.player && window.__game?.renderer),
    {
      timeout: 240_000,
      polling: 250,
    },
  );
  await dismissEntryOverlays(page);
  const observer = args.observer ?? GEARED_ARRIVAL_OBSERVER;
  await page.evaluate(({ x, z }) => {
    window.__game.online.devCmd({ cmd: 'dev_teleport', x, z });
  }, observer);
  await page.waitForFunction(
    ({ x, z }) => {
      const position = window.__game?.world?.player?.pos;
      return position && Math.hypot(position.x - x, position.z - z) < 2;
    },
    { timeout: 10_000, polling: 100 },
    observer,
  );
}

export async function prepareOnlineGearedRoster({
  args,
  runId,
  databaseUrl = process.env.DATABASE_URL,
  checkCapability = requireOnlineProfilerCapability,
  rosterFactory = (options) => new GearedArrivalRoster(options),
}) {
  // These checks are deliberately before the roster constructor and prepare
  // call. The roster constructor is local validation today, while prepare
  // registers accounts, writes cosmetics, and opens world sockets.
  assertLoopbackUrl(args.url, '--url');
  assertLoopbackUrl(args.serverUrl, 'SERVER_URL');
  if (!databaseUrl) throw new Error('DATABASE_URL is required for --mode online-geared');
  await checkCapability(args.serverUrl);
  const roster = rosterFactory({
    serverUrl: args.serverUrl,
    databaseUrl,
    count: args.bots,
    runId,
  });
  // The geared crowd rides with the observer: measuring a different town with
  // the bots left behind at the default spot would silently change the scenario
  // (no nearby geared players) as well as the location.
  //
  // prepare() registers accounts and opens sockets one bot at a time and has no
  // cleanup of its own, so a failure partway through would strand everything it
  // already created: the caller's finally only sees a roster this function
  // RETURNED. Close it here, then rethrow the original failure.
  try {
    await roster.prepare({ center: args.observer ?? GEARED_ARRIVAL_OBSERVER });
  } catch (error) {
    await roster.close().catch(() => {});
    throw error;
  }
  return roster;
}

// Resolved at launch, never at module load: this file's pure halves (parseArgs,
// buildCapture, prepareOnlineGearedRoster) are unit-tested, and a load-time
// throw would red the whole suite on any machine without a Chromium.
function requireBrowserPath() {
  const resolved = findBrowserPath();
  if (!resolved)
    throw new Error(
      'No Chrome/Edge/Chromium binary found. Set BROWSER_PATH to your browser executable.',
    );
  return resolved;
}

export async function capture(args) {
  const requestedUrl = new URL(args.url);
  if (args.mode === 'online-geared') assertLoopbackUrl(args.url, '--url');
  // Refused here, before a browser, a temp profile and possibly 40 bot
  // accounts exist: manual mode waits for an operator to press Enter, and
  // without a TTY there is nobody to press it. Checked here rather than in
  // parseArgs so the parser stays pure and testable off a terminal.
  if (args.mode === 'manual' && !process.stdin.isTTY)
    throw new Error('--mode manual needs an interactive terminal; use --mode offline instead');
  const dirty = git(['status', '--porcelain'], '') !== '';
  if (dirty && !args.allowDirty)
    throw new Error('worktree is dirty; pass --allow-dirty to record it explicitly');
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), PROFILE_PREFIX));
  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
  const captureId = `${new Date().toISOString()}-${Math.random().toString(36).slice(2, 8)}`;
  const flags = browserFlags(args.headless, args.viewport);
  const provenance = makeProvenance({
    gitHead: git(['rev-parse', '--short=12', 'HEAD']),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    sourceBuildId: sourceBuildId(),
    servedBuildId: '',
    probeSha256: fileSha256('scripts/profiler/gpu_hitch_probe.mjs'),
    analyzerSha256: fileSha256('scripts/profiler/gpu_hitch_metrics.mjs'),
    worktreeName: path.basename(ROOT),
    dirty,
  });
  let browser;
  let page;
  let roster;
  try {
    if (args.mode === 'online-geared') {
      roster = await prepareOnlineGearedRoster({ args, runId: captureId });
      args.fixtureEvidence = roster.evidence();
    }
    browser = await puppeteer.launch({
      executablePath: requireBrowserPath(),
      headless: args.headless ? 'new' : false,
      userDataDir: profileDir,
      args: browserArgs(args.viewport),
      defaultViewport: args.viewport,
    });
    // Reuse Chrome's initially focused tab. Opening a second tab makes Chrome
    // briefly mark the instrumented document hidden while focus transfers,
    // which both perturbs the first boot milliseconds and correctly
    // invalidates the visibility contract.
    const [initialPage] = await browser.pages();
    page = initialPage ?? (await browser.newPage());
    await page.bringToFront();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(String(error?.stack ?? error).slice(0, 1500)));
    await page.evaluateOnNewDocument(installGpuHitchProbe, {
      profile: args.profile,
      captureId,
      scenario: scenarioName(args.mode),
    });
    if (args.mode === 'offline') {
      await page.goto(requestedUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await enterOfflineGame(page, {
        charClass: 'warrior',
        charName: 'HitchProbe',
        settleMs: 0,
        selectorTimeoutMs: 60_000,
        gameBootTimeoutMs: 180_000,
      });
    } else if (args.mode === 'manual') {
      await page.goto(requestedUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await waitForManualEntry(page);
    } else {
      await enterOnlineGearedGame(page, { ...args, url: requestedUrl.toString() }, captureId);
    }
    await sleep(args.durationMs);
    const snapshot = await page.evaluate(() => window.__wocGpuHitchProbe?.stop('duration'));
    if (!snapshot) throw new Error('GPU hitch probe was not installed');
    const browserVersion = await browser.version();
    const raw = buildCapture({
      args,
      url: requestedUrl.toString(),
      snapshot,
      browserVersion,
      flags,
      provenance,
    });
    raw.diagnostics.pageErrors = pageErrors;
    if (pageErrors.length > 0) raw.capture.complete = false;
    const expectedBuildId = git(['rev-parse', '--short=12', 'HEAD']);
    const expectedSourceBuildId = sourceBuildId();
    raw.validation = validateCapture(raw, {
      sourceBuildId: expectedSourceBuildId,
      servedBuildId: expectedBuildId,
      probeSha256: provenance.probeSha256,
      analyzerSha256: provenance.analyzerSha256,
      worktreeName: provenance.worktreeName,
      // The demand also travels in capture.performanceEvidence above, so this
      // verdict is reproducible from the artifact alone.
      performanceEvidence: !args.headless,
    });
    if (raw.validation.valid) raw.summary = summarizeCapture(raw);
    const output = args.out ? path.resolve(ROOT, args.out) : defaultOutput();
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(raw, null, 2)}\n`);
    console.log(`GPU hitch capture written to ${output}`);
    if (!raw.validation.valid) {
      console.error(`Capture invalid: ${raw.validation.errors.join('; ')}`);
      return { output, raw, exitCode: 1 };
    }
    return { output, raw, exitCode: 0 };
  } finally {
    await page?.evaluate(() => window.__game?.online?.sendLogout?.()).catch(() => {});
    await browser?.close().catch(() => {});
    await roster?.close().catch(() => {});
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage);
    } else {
      const result = await capture(args);
      process.exitCode = result.exitCode;
    }
  } catch (error) {
    console.error(error?.stack ?? error);
    console.error(usage);
    process.exitCode = 1;
  }
}
