// WOC crowd A/B rig: one ARM per run, the same script for every arm.
//
// It answers one question with provenance: what does a crowd of 40 armored
// players cost on THIS machine when the client is served from a given checkout
// (the release, the PR head, a fixed tree)? Run it once per arm against that
// arm's own dev server, then put the result files side by side with --table.
// The script never needs to live in the checkout it measures: it reads only
// what both the release and the branch expose on the dev hook (the page half,
// scripts/lib/woc_crowd_ab_page.mjs, lists every one of them).
//
// What one run does (the method of the PR 4360 performance review, as closely
// as one script can repeat it):
//   1. Launches a browser with a FRESH profile, a fixed 1920x953 viewport at
//      device pixel ratio 1 and normal vsync (it never passes
//      --disable-gpu-vsync or --disable-frame-rate-limit), and opens
//      GAME_URL/?gfx=<preset>&governor=0&gputimer=1&fpscap=60.
//   2. Enters the OFFLINE world through the visible launcher (server select,
//      Offline, Play) as a level 1 warrior, with the intro skipped.
//   3. Waits for the world to settle: for the session's shader corpus record
//      to end (it only STARTS about 25 s after the reveal), then for the
//      program list, the textures and the background GPU queue to hold still.
//   4. SOLO: a 15 s window with nobody else in view.
//   5. Adds 40 bot players through the sim, on a grid 6 to 20 yd ahead: the
//      nine classes in turn, body type alternating, default faces, every bot
//      in the same six worn slots. ARRIVAL is the 15 s that start at the spawn.
//   6. CLOSE: a 15 s window once the crowd has settled (articulated bodies).
//   7. FAR: the same 40 moved 62 to 75 yd ahead, a 15 s window once every body
//      stands on its far mesh.
// One scene is this rig's own and is off unless AB_SCENES names it: TRANSIT,
// the 15 s that start when the crowd is moved to the far band (the far-bake
// burst of a camera leaving a town), with the time until all 40 stand on their
// far mesh. AB_SCENES=solo,arrival,close,transit,far runs all five.
// AB_CPU_THROTTLE=4 (or 6) slows the page's main thread through CDP
// (Emulation.setCPUThrottlingRate) from just before SOLO on.
//
// Three things it holds still that a hand run does not, the same in every arm:
//   - The time of day. The world's day turns every 45 minutes on a UTC clock
//     (src/render/day_night_clock.ts), so two arms run minutes apart would
//     stand under different light, lamps and program keys. It is frozen at
//     noon through the dev build's own override (AB_DAYPHASE).
//   - The network. The page links a web-font stylesheet and a third-party
//     script, and a slow answer from either holds the whole page back. No host
//     but this machine resolves during a run (--host-resolver-rules), so the
//     HUD renders in the fallback font (AB_EXTERNAL=1 turns that off).
//   - The moment after entry. The preview prewarm and the shader corpus record
//     follow every world entry and would land inside a window at a different
//     instant on every run; step 3 waits them out.
//
// Per window it records: GPU ms per frame from EXT_disjoint_timer_query_webgl2
// (perfStats().gpuTimer: the sum of the present submit's brackets, when the
// browser exposes the extension), draw calls and triangles per frame (median
// of 1 s samples), the game's own frame dt (mean, p95, frames over 50 ms, time
// spent in frames over 33.4 ms), raw requestAnimationFrame gaps, long tasks
// (PerformanceObserver), the linked program count, the gpu-prep events
// (live-program, gate-timeout), the build ledger's view rows and the
// background queue units per kind; for ARRIVAL also the time until all 40
// bodies have a view (a nameplate and a click target), the time until all 40
// are drawn, and the model and texture files first requested in the window.
// The task that opens ARRIVAL or TRANSIT is the rig's own (the sim adding or
// moving 40 players): its time is reported, sits inside the first frame gap,
// and is not counted among the long tasks.
//
// What it CANNOT tell you:
//   - Anything about another GPU, driver or OS. One machine, one browser.
//   - A weak CPU. A throttled run is a PROXY: CDP throttles the page's main
//     thread only (not workers, not the GPU process, not the driver), and is
//     labelled as a proxy in every output.
//   - A cold driver. The fresh profile empties the BROWSER's shader cache and
//     leaves the game's own shader replay nothing to replay, but the OS or
//     driver keeps its own cache outside the profile (Metal's on macOS), which
//     this rig neither clears nor inspects. Alternate the arms and repeat the
//     pair before reading an ARRIVAL difference.
//   - A network. Files come from a loopback dev server with no wait.
//   - A production build. Offline mode exists only in dev builds
//     (src/game/offline_mode_gate.ts), so every arm is a dev build.
//   - A real town. Default faces and one worn set leave the per-face and
//     per-set caches under-exercised.
//   - Player-representative shader warm-up: ?gputimer=1 retires the shader
//     warm worker (src/render/gpu_timer_probe.ts). AB_QUERY="governor=0&fpscap=60"
//     runs an arrival without the probe (and without GPU ms).
//   - Memory. Nothing here measures residency.
// A run is HEADLESS unless AB_HEADED=1 asks for a window, and a headless run is
// a smoke run: no display, frames paced by the browser's own 60 Hz timer
// instead of a display's vsync, nothing presented. Evidence is a HEADED run on
// a quiet machine; its window takes the focus, so nobody should be working at
// that machine meanwhile. Every output says which one it is and why: headless,
// a busy host (load average), a host short of memory (swap activity during the
// run), a software rasterizer and a hidden page each disqualify a run by name.
// The script closes only the browser it launched (its own fresh profile, its
// own process handle) and never looks for a browser by name.
//
// The two arms are not the same picture, and the output says so: the
// release's composed body ignores worn armor and wears its class kit, while a
// WOC body draws its class's own piece for each worn slot.
//
// Serve each arm from its own checkout, on its own port (never the default
// 5173, so a run cannot land on somebody's working session):
//   cd <release checkout> && node node_modules/vite/bin/vite.js --port 5301 --strictPort --host 127.0.0.1
//   cd <this checkout>    && node node_modules/vite/bin/vite.js --port 5302 --strictPort --host 127.0.0.1
// Then, from THIS checkout, one run per arm and preset:
//   GAME_URL=http://127.0.0.1:5301 AB_LABEL=release AB_GFX=low AB_HEADED=1 node scripts/woc_crowd_ab.mjs
//   GAME_URL=http://127.0.0.1:5302 AB_LABEL=pr-head AB_GFX=low AB_HEADED=1 node scripts/woc_crowd_ab.mjs
//   node scripts/woc_crowd_ab.mjs --table tmp/woc-crowd-ab/*.json
// (--summary <file.json> reprints one run's text summary from its JSON.)
// The provenance block is read off the machine, never claimed: the served
// checkout is the working directory of the process listening on the port, and
// the page's own build id must match that checkout's HEAD.
//
// Env: GAME_URL (required, loopback only), AB_LABEL (the arm's name in every
//      output), AB_GFX (default low), AB_SCENES (default
//      solo,arrival,close,far), AB_CPU_THROTTLE (default 1), AB_HEADED (1 =
//      open a real window), AB_SMOKE (1 = declare the run not evidence), AB_WINDOW_MS
//      (15000), AB_SETTLE_MS (15000, the least a settle waits), AB_BOTS (40),
//      AB_VIEWPORT (1920x953@1), AB_QUERY (default
//      governor=0&gputimer=1&fpscap=60, what follows ?gfx=), AB_DAYPHASE
//      (default 0.5, noon; "live" leaves the game's clock running), AB_AT
//      ("x,z" or "x,z,facing": move the observer), AB_EXTERNAL (1 = let the
//      page reach the internet), AB_ANGLE (pass --use-angle),
//      AB_WINDOW_POSITION ("x,y": which display a headed window opens on),
//      AB_ARM_DIR (the served checkout, when it cannot be read off the
//      listening process), AB_OUT_DIR (tmp/woc-crowd-ab), AB_SCREENSHOTS (1),
//      AB_NOTE, AB_BOOT_TIMEOUT_MS (300000), BROWSER_PATH.
//
// Pure halves (roster, grid, statistics, reports):
// scripts/lib/woc_crowd_ab_core.mjs, pinned by tests/woc_crowd_ab_core.test.ts.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { findBrowserPath } from './browser_path_resolve.mjs';
import { dismissEntryOverlays } from './enter_offline_game.mjs';
import { cleanupOwnedProfileDir, createOwnedProfileDir } from './lib/chrome_profile_dir.mjs';
import { suppressGpuNotice } from './lib/gpu_notice_suppress.mjs';
import { assertLoopbackUrl } from './lib/loopback_guard.mjs';
import {
  AB_BOT_COUNT,
  AB_SCENE_BANDS,
  AB_SCHEMA,
  AB_WORN_SET,
  comparisonTables,
  countsDelta,
  crowdGrid,
  crowdOverSolo,
  crowdRoster,
  drawWindowStats,
  evidenceReasons,
  formatSummary,
  frameWindowStats,
  gpuWindowMean,
  hostLoad,
  ledgerDelta,
  longTaskStats,
  parseVmStat,
  queueKindDelta,
  rafGapStats,
  swapActivity,
} from './lib/woc_crowd_ab_core.mjs';
import { installPageRig, pinDayNightClock } from './lib/woc_crowd_ab_page.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROFILE_PREFIX = 'woc-crowd-ab-';
const OBSERVER_NAME = 'Crowdcam';
const SCENE_ORDER = ['solo', 'arrival', 'close', 'transit', 'far'];
// The review's four scenes. TRANSIT is this rig's own and is asked for by name.
const DEFAULT_SCENES = 'solo,arrival,close,far';
const SERVED_PATHS = [
  'src',
  'public',
  'index.html',
  'vite.config.ts',
  'package.json',
  'pnpm-lock.yaml',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fail(message) {
  console.error(`[crowd-ab] ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// --table and --summary: read result files back (no browser, no server).
// --table puts arms side by side; --summary reprints one arm's text summary.
// ---------------------------------------------------------------------------
if (process.argv[2] === '--table' || process.argv[2] === '--summary') {
  const files = process.argv.slice(3);
  if (files.length === 0) fail(`${process.argv[2]} needs one or more result JSON files`);
  const results = files.map((file) => JSON.parse(fs.readFileSync(file, 'utf8')));
  for (const result of results) {
    if (result.schema !== AB_SCHEMA)
      fail(`not a ${AB_SCHEMA} result: ${JSON.stringify(result.schema)}`);
  }
  process.stdout.write(
    process.argv[2] === '--table'
      ? comparisonTables(results)
      : results.map(formatSummary).join('\n'),
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------
function intEnv(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(`${name} must be an integer from ${min} to ${max}, got "${raw}"`);
  }
  return value;
}

if (!process.env.GAME_URL) {
  fail('GAME_URL is required: the dev server of the arm to measure, e.g. http://127.0.0.1:5302');
}
const GAME_URL = process.env.GAME_URL.replace(/\/+$/, '');
// The rig drives sim-side dev state through the page it opens: local only.
const gameUrl = assertLoopbackUrl(GAME_URL, 'GAME_URL');
const GFX = process.env.AB_GFX ?? 'low';
if (!['low', 'medium', 'high', 'ultra', 'insane'].includes(GFX))
  fail(`AB_GFX "${GFX}" is not a preset`);
const SCENES = (process.env.AB_SCENES ?? DEFAULT_SCENES)
  .split(',')
  .map((scene) => scene.trim().toLowerCase())
  .filter(Boolean);
for (const scene of SCENES)
  if (!SCENE_ORDER.includes(scene)) fail(`AB_SCENES: unknown scene "${scene}"`);
const CPU_THROTTLE = Number(process.env.AB_CPU_THROTTLE ?? 1);
if (!Number.isFinite(CPU_THROTTLE) || CPU_THROTTLE < 1 || CPU_THROTTLE > 20) {
  fail('AB_CPU_THROTTLE must be a rate from 1 to 20');
}
// Headless unless asked: a headed window takes the focus of whoever is at the
// machine, so the evidence run opens one only on an explicit AB_HEADED=1.
const HEADLESS = process.env.AB_HEADED !== '1';
const SMOKE = process.env.AB_SMOKE === '1';
const WINDOW_MS = intEnv('AB_WINDOW_MS', 15_000, 1_000, 600_000);
const SETTLE_MS = intEnv('AB_SETTLE_MS', 15_000, 0, 600_000);
// How many one-second polls in a row must find the world unchanged.
const QUIET_POLLS = 5;
// A settle waits for quiet past its minimum, but never longer than this.
const SETTLE_MAX_MS = Math.max(90_000, SETTLE_MS * 4);
// The entry settle also sits through the session's shader corpus record
// (src/game/shader_cache_warmup.ts recordShaderCorpus), which a busy host can
// stretch to minutes.
const ENTRY_SETTLE_MAX_MS = Math.max(300_000, SETTLE_MAX_MS);
// How that record reports its end on the console, done, skipped or failed.
const CORPUS_RECORD_LINE = '[shader-warmup] record';
const BOT_COUNT = intEnv('AB_BOTS', AB_BOT_COUNT, 1, 200);
const BOOT_TIMEOUT_MS = intEnv('AB_BOOT_TIMEOUT_MS', 300_000, 10_000, 3_600_000);
const viewportMatch = /^(\d+)x(\d+)(?:@(\d+(?:\.\d+)?))?$/.exec(
  process.env.AB_VIEWPORT ?? '1920x953@1',
);
if (!viewportMatch) fail('AB_VIEWPORT must look like 1920x953 or 1920x953@2');
const VIEWPORT = { width: Number(viewportMatch[1]), height: Number(viewportMatch[2]) };
const DPR = Number(viewportMatch[3] ?? 1);
if (!(DPR > 0)) fail('AB_VIEWPORT: the device pixel ratio must be positive');
const ANGLE = process.env.AB_ANGLE ?? '';
const WINDOW_POSITION = process.env.AB_WINDOW_POSITION ?? '';
if (WINDOW_POSITION && !/^-?\d+,-?\d+$/.test(WINDOW_POSITION))
  fail('AB_WINDOW_POSITION must be "x,y"');
// The review's flags. AB_QUERY replaces them all: drop gputimer=1 for an
// arrival run with the shader warm worker alive, add wocmerge=off, and so on.
const QUERY_TAIL = (process.env.AB_QUERY ?? 'governor=0&gputimer=1&fpscap=60').replace(
  /^[?&]+/,
  '',
);
const QUERY = `?gfx=${GFX}${QUERY_TAIL ? `&${QUERY_TAIL}` : ''}`;
const queryParams = new URLSearchParams(QUERY);
const GPU_TIMER_ASKED = queryParams.get('gputimer') === '1';
// The page links a web-font stylesheet and a third-party script. A slow answer
// from either holds the whole page back (a pending stylesheet blocks the module
// script), so by default no host but this machine resolves: every arm renders
// its HUD in the fallback font and no run depends on the internet.
const EXTERNAL_HOSTS = process.env.AB_EXTERNAL === '1';
// The time of day every arm is measured under: a phase in [0,1), 0.5 is noon.
// "live" leaves the game's own 45 minute UTC clock running, which makes two
// runs comparable only if they happen to share a phase.
const DAY_PHASE_RAW = process.env.AB_DAYPHASE ?? '0.5';
const DAY_PHASE = DAY_PHASE_RAW === 'live' ? null : Number(DAY_PHASE_RAW);
if (DAY_PHASE !== null && !(DAY_PHASE >= 0 && DAY_PHASE < 1)) {
  fail('AB_DAYPHASE must be a phase from 0 to 1 (0.5 is noon) or "live"');
}
const SCREENSHOTS = (process.env.AB_SCREENSHOTS ?? '1') === '1';
const NOTE = process.env.AB_NOTE ?? '';
const OUT_DIR = path.resolve(ROOT, process.env.AB_OUT_DIR ?? path.join('tmp', 'woc-crowd-ab'));

// AB_AT="x,z" or "x,z,facing": stand the observer somewhere else. A different
// spot draws a different world, so a run is only comparable with runs there.
let observerOverride = null;
if (process.env.AB_AT) {
  const [x, z, facing] = process.env.AB_AT.split(',').map(Number);
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(z) ||
    (facing !== undefined && !Number.isFinite(facing))
  ) {
    fail(`AB_AT must be "x,z" or "x,z,facingRadians", got "${process.env.AB_AT}"`);
  }
  observerOverride = { x, z, facing: facing ?? null };
}

// ---------------------------------------------------------------------------
// Provenance of the arm: which checkout is this URL serving?
// ---------------------------------------------------------------------------
function git(dir, args) {
  try {
    return execFileSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trimEnd();
  } catch {
    return null;
  }
}

/** The working directory of the process listening on the arm's port: the
 *  checkout the dev server was started in. Read off the OS, never claimed. */
function listenerOf(port) {
  try {
    const pid = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .trim()
      .split('\n')[0];
    if (!pid) return null;
    const out = execFileSync('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const dir = out
      .split('\n')
      .find((line) => line.startsWith('n'))
      ?.slice(1);
    return dir ? { pid: Number(pid), dir } : null;
  } catch {
    return null;
  }
}

/** The OS swap counters, where `vm_stat` exists (macOS); null elsewhere. */
function readSwapCounters() {
  if (os.platform() !== 'darwin') return null;
  try {
    return parseVmStat(
      execFileSync('vm_stat', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }),
    );
  } catch {
    return null;
  }
}

function armProvenance() {
  const port = Number(gameUrl.port || (gameUrl.protocol === 'https:' ? 443 : 80));
  const listener = listenerOf(port);
  const servedDir = listener?.dir ?? process.env.AB_ARM_DIR ?? null;
  const servedDirSource = listener
    ? 'working directory of the process listening on the port'
    : process.env.AB_ARM_DIR
      ? 'AB_ARM_DIR, not verified against the listening process'
      : 'unknown';
  const arm = {
    url: GAME_URL,
    servedDir,
    servedDirSource,
    listenerPid: listener?.pid ?? null,
    gitSha: null,
    gitShaShort: null,
    branch: null,
    dirty: null,
    dirtyEntries: null,
    servedDirty: null,
    servedDirtyPaths: [],
  };
  if (!servedDir) return arm;
  arm.gitSha = git(servedDir, ['rev-parse', 'HEAD']);
  arm.gitShaShort = arm.gitSha?.slice(0, 12) ?? null;
  const branch = git(servedDir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  arm.branch = branch === 'HEAD' ? 'detached' : branch;
  const all = git(servedDir, ['status', '--porcelain']);
  const served = git(servedDir, ['status', '--porcelain', '--', ...SERVED_PATHS]);
  if (all !== null) {
    const entries = all.split('\n').filter(Boolean);
    arm.dirty = entries.length > 0;
    arm.dirtyEntries = entries.length;
  }
  if (served !== null) {
    const entries = served.split('\n').filter(Boolean);
    arm.servedDirty = entries.length > 0;
    arm.servedDirtyPaths = entries.slice(0, 40);
  }
  return arm;
}

// ---------------------------------------------------------------------------
// Driving the page
// ---------------------------------------------------------------------------
/** No model or texture request in flight, and none for `idleMs`. */
async function assetsIdle(assets, idleMs, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (assets.inFlight.size === 0 && Date.now() - assets.lastActivityAt >= idleMs) return true;
    if (Date.now() > deadline) return false;
    await sleep(100);
  }
}

async function enterOfflineWorld(page, assets) {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  await page.waitForSelector('#btn-play', { timeout: BOOT_TIMEOUT_MS });
  await page.evaluate((introKey) => {
    localStorage.setItem('woc.cameraModePrompt.shown', '1');
    localStorage.setItem(introKey, '1');
  }, `woc_spawn_intro_seen:offline:warrior:${OBSERVER_NAME}`);
  // The visible launcher: pick Offline in the world selector, then Play. The
  // markup exists before main.ts wires it, so keep asking until the creation
  // panel is up rather than clicking once into an unwired button.
  for (;;) {
    const state = await page.evaluate(() => {
      if (document.body.dataset.startPanel === 'offline-select') return 'creation';
      const select = document.querySelector('#server-select');
      const trigger = document.querySelector('#server-select-trigger');
      const menu = document.querySelector('#server-select-menu');
      const option = document.querySelector('#server-opt-offline');
      const play = document.querySelector('#btn-play');
      if (!select || !trigger || !menu || !option || !play) return 'no-launcher';
      if (option.hasAttribute('hidden')) return 'production';
      if (select.dataset.mode !== 'offline') {
        if (menu.hasAttribute('hidden')) trigger.click();
        option.click();
        return 'selecting';
      }
      play.click();
      return 'playing';
    });
    if (state === 'creation') break;
    if (state === 'production') {
      throw new Error(
        'the launcher hides Offline: this URL serves a production build, and the rig needs a dev server',
      );
    }
    if (Date.now() > deadline) {
      throw new Error(
        `the launcher never reached character creation (${state}): the page did not finish loading its modules`,
      );
    }
    await sleep(400);
  }
  const card = '#offline-select .mini-class[data-class="warrior"]';
  await page.waitForSelector(card, { visible: true, timeout: BOOT_TIMEOUT_MS });
  await page.evaluate(
    (selector, name) => {
      const input = document.querySelector('#char-name');
      input.value = name;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector(selector)?.click();
    },
    card,
    OBSERVER_NAME,
  );
  // Let the creation stage finish streaming the previewed character before
  // Enter World: an entry that races it builds the player's own body late, a
  // different scenario from the one measured here (review finding S5).
  const previewIdle = await assetsIdle(assets, 2000, 90_000);
  // Before Enter World, so the entry prepares its programs under the light the
  // windows will be measured in.
  const dayNight =
    DAY_PHASE === null
      ? { ok: true, pinnedPhase: null, livePhase: null, error: null }
      : await page.evaluate(pinDayNightClock, DAY_PHASE);
  await page.evaluate(() => document.querySelector('#btn-start-offline')?.click());
  await page.waitForFunction(
    () => Boolean(window.__game?.sim?.player && window.__game?.renderer && window.__game?.perf),
    { timeout: BOOT_TIMEOUT_MS, polling: 250 },
  );
  await dismissEntryOverlays(page);
  return { previewIdle, dayNight };
}

/** Wait at least `minMs`, then until the program list, the texture count and
 *  the background GPU queue hold still for QUIET_POLLS one-second polls (or
 *  `maxMs` runs out). The queue holds still when nothing waits in it AND it ran
 *  no unit since the last poll: the post-entry preview prewarm hands it one
 *  unit at a time, so an empty queue alone says nothing. The view count is not
 *  part of it: a wandering mob crosses the view range all the time. */
async function settle(page, minMs, maxMs, ready) {
  const started = Date.now();
  let last = null;
  let stable = 0;
  // What kept it from being quiet, poll by poll, so a long settle names its cause.
  const busy = {
    polls: 0,
    programsMoved: 0,
    texturesMoved: 0,
    queuePending: 0,
    queueRan: 0,
    notReady: 0,
  };
  let firstKinds = null;
  // The queue work the settle sat through, so a long one names its cause.
  const finish = (result, now) => {
    const { queueKinds: lastKinds, ...rest } = now;
    return {
      ...result,
      busy,
      queueWork: queueKindDelta(firstKinds, lastKinds).slice(0, 8),
      ...rest,
    };
  };
  for (;;) {
    await sleep(1000);
    const now = await page.evaluate(() => window.__wocCrowdAb.quiet());
    busy.polls += 1;
    if (last !== null && now.programs !== last.programs) busy.programsMoved += 1;
    if (last !== null && now.textures !== last.textures) busy.texturesMoved += 1;
    if (now.pending !== 0) busy.queuePending += 1;
    if (last !== null && now.units !== last.units) busy.queueRan += 1;
    firstKinds ??= now.queueKinds;
    const same =
      last !== null &&
      now.programs === last.programs &&
      now.textures === last.textures &&
      now.units === last.units &&
      now.pending === 0;
    stable = same ? stable + 1 : 0;
    last = now;
    const waited = Date.now() - started;
    const isReady = ready ? await ready() : true;
    if (!isReady) busy.notReady += 1;
    if (waited >= minMs && stable >= QUIET_POLLS && isReady) {
      return finish({ waitedMs: waited, quiet: true }, now);
    }
    if (waited >= maxMs) return finish({ waitedMs: waited, quiet: false, ready: isReady }, now);
  }
}

/** One measured window. `action` runs in the SAME task that opens it, so a
 *  window that starts with a change (the spawn, the move to the far band) has
 *  that change at its very first instant. */
async function runWindow(page, scene, ids, action) {
  return page.evaluate(
    async (sceneName, durationMs, botIds, act) => {
      const rig = window.__wocCrowdAb;
      rig.begin(sceneName, durationMs);
      let crowd = null;
      if (act?.kind === 'spawn') crowd = rig.spawn(act.roster, act.spots, act.wornSet, act.facing);
      if (act?.kind === 'move') crowd = rig.move(act.ids, act.spots, act.facing);
      await rig.done();
      // Let a long task that ended with the window reach its observer.
      await new Promise((resolve) => setTimeout(resolve, 250));
      return { ids: crowd?.ids ?? botIds, window: rig.collect(crowd?.ids ?? botIds) };
    },
    scene,
    WINDOW_MS,
    ids,
    action ?? null,
  );
}

function summarizeWindow(raw, cpuThrottle, network) {
  const { start, end } = raw;
  const frames = frameWindowStats(raw.frameMs);
  const seconds = (raw.t1 - raw.t0) / 1000;
  const eventsInWindow = end.events
    .filter((event) => event.atMs >= raw.t0 && event.atMs <= raw.t1 + 250)
    .map((event) => ({
      kind: event.kind,
      key: event.key,
      ageMs: Math.round(event.ageMs),
      atMs: Math.round(event.atMs - raw.t0),
    }));
  const window = {
    scene: raw.scene,
    cpuThrottle,
    cpuThrottleNote:
      cpuThrottle > 1
        ? `main thread slowed ${cpuThrottle}x through CDP: a proxy for a weak CPU, not a measurement of one`
        : null,
    windowMs: Math.round(raw.t1 - raw.t0),
    visibility: { start: start.visibility, end: end.visibility },
    frames: { ...frames, fps: Math.round((frames.rendered / seconds) * 10) / 10 },
    raf: rafGapStats(raw.rafTs),
    longTasks: longTaskStats(raw.longTasks, raw.t0, raw.t1),
    gpu: {
      ...gpuWindowMean(raw.samples, start.gpu.framesResolved),
      disjointFrames: end.gpu.disjointFrames - start.gpu.disjointFrames,
      droppedFrames: end.gpu.droppedFrames - start.gpu.droppedFrames,
      sceneNoHandover: end.gpu.sceneNoHandover - start.gpu.sceneNoHandover,
      halted: end.gpu.halted,
    },
    draws: drawWindowStats(raw.samples),
    programs: { start: start.programs, end: end.programs, delta: end.programs - start.programs },
    textures: { start: start.textures, end: end.textures },
    geometries: { start: start.geometries, end: end.geometries },
    views: { start: start.views, end: end.views },
    events: {
      counts: countsDelta(start.eventCounts, end.eventCounts),
      inWindow: eventsInWindow.slice(-80),
    },
    ledger: ledgerDelta(start.ledger, end.ledger),
    // The ledger keeps its 24 slowest builds of the session: the ones that
    // fell inside this window, worst first (empty when none ranked).
    ledgerSlowestInWindow: end.ledgerSlowest
      .filter((row) => row.atMs >= raw.t0 && row.atMs <= raw.t1)
      .map((row) => ({
        kind: row.kind,
        ms: Math.round(row.ms * 10) / 10,
        atMs: Math.round(row.atMs - raw.t0),
      })),
    // Background queue units that ran inside the window, per kind, most first.
    queueWork: queueKindDelta(start.queueKinds, end.queueKinds),
    gpuQueue: {
      units: end.queue.units - start.queue.units,
      syncMs: Math.round((end.queue.totalSyncMs - start.queue.totalSyncMs) * 10) / 10,
      pendingAtEnd: end.queue.pending,
    },
    night: end.night,
    camera: end.camera,
    cadence: end.cadence,
    bodies: raw.bodies,
    rigOverheadMs: Math.round(raw.rigMs * 10) / 10,
    arrival: null,
    transit: null,
    samples: raw.samples,
  };
  if (raw.watch) {
    const times = raw.watch.reachedTimes;
    const expected = raw.watch.expected;
    // A drawn set that changed inside the last 2 s has not shown it is done.
    const settledInside =
      raw.watch.lastChangeMs !== null && raw.watch.lastChangeMs < raw.t1 - raw.t0 - 2000;
    const reached = {
      expected,
      reachedInWindow: times.length,
      firstAfterMs: times[0] ?? null,
      halfAfterMs: times[Math.ceil(expected / 2) - 1] ?? null,
      allAfterMs: times.length === expected ? times[times.length - 1] : null,
      lastChangeMs: settledInside ? Math.round(raw.watch.lastChangeMs) : null,
      // The rig's own task that opened the window (the sim adding 40 players,
      // or moving them): inside the first frame gap, not among the long tasks.
      actionTaskMs: raw.actionTaskMs === null ? null : Math.round(raw.actionTaskMs * 10) / 10,
      timeline: raw.watch.timeline,
      drawnSets: raw.watch.sets,
    };
    if (raw.watch.goal === 'far') {
      window.transit = {
        expected,
        onFarMeshInWindow: reached.reachedInWindow,
        firstOnFarMeshAfterMs: reached.firstAfterMs,
        halfOnFarMeshAfterMs: reached.halfAfterMs,
        allOnFarMeshAfterMs: reached.allAfterMs,
        lastChangeMs: reached.lastChangeMs,
        moveTaskMs: reached.actionTaskMs,
        timeline: reached.timeline,
        drawnSets: reached.drawnSets,
      };
    } else {
      const views = raw.watch.viewTimes;
      window.arrival = {
        expected,
        drawnInWindow: reached.reachedInWindow,
        firstDrawnAfterMs: reached.firstAfterMs,
        halfDrawnAfterMs: reached.halfAfterMs,
        allDrawnAfterMs: reached.allAfterMs,
        // A view is what carries the nameplate and the click target, with or
        // without a body under it.
        viewsInWindow: views.length,
        allViewsAfterMs: views.length === expected ? views[views.length - 1] : null,
        lastChangeMs: reached.lastChangeMs,
        spawnTaskMs: reached.actionTaskMs,
        drawnTimeline: reached.timeline,
        drawnSets: reached.drawnSets,
        assetRequests: network.files,
        assetBytes: network.bytes,
        characterAssetRequests: network.characterFiles,
        characterAssetBytes: network.characterBytes,
        assetPaths: network.paths,
      };
    }
  }
  return window;
}

// ---------------------------------------------------------------------------
// One run
// ---------------------------------------------------------------------------
async function main() {
  const browserPath = findBrowserPath();
  if (!browserPath) fail('no Chrome, Edge or Chromium found: set BROWSER_PATH');
  const arm = armProvenance();
  const label = process.env.AB_LABEL ?? arm.gitShaShort ?? 'arm';
  const startedAt = new Date();
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
  const baseName = `${label}_${GFX}${CPU_THROTTLE > 1 ? `_cpu${CPU_THROTTLE}` : ''}_${HEADLESS ? 'headless' : 'headed'}_${stamp}`;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const loadStart = hostLoad(os.loadavg()[0], os.cpus().length);
  const swapStart = readSwapCounters();
  console.log(
    `[crowd-ab] arm ${label}: ${GAME_URL}${QUERY} sha ${arm.gitShaShort ?? 'unknown'} ` +
      `${HEADLESS ? 'HEADLESS (smoke)' : 'headed'} throttle ${CPU_THROTTLE} load ${loadStart.load1}`,
  );
  if (arm.servedDirty)
    console.log('[crowd-ab] note: the served checkout has uncommitted source changes');

  const profileDir = createOwnedProfileDir(PROFILE_PREFIX);
  const args = [
    `--window-size=${VIEWPORT.width},${VIEWPORT.height + 140}`,
    '--ignore-gpu-blocklist',
    '--enable-gpu',
    '--disable-backgrounding-occluded-windows',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-crash-reporter',
    '--disable-breakpad',
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
    // The rule maps IP literals too, so the loopback names are excluded by hand.
    ...(EXTERNAL_HOSTS
      ? []
      : [
          `--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost , EXCLUDE 127.0.0.1 , EXCLUDE ${gameUrl.hostname}`,
        ]),
    ...(ANGLE ? [`--use-angle=${ANGLE}`] : []),
    ...(WINDOW_POSITION ? [`--window-position=${WINDOW_POSITION}`] : []),
  ];
  let browser = null;
  // Bounded and never throwing: a browser that will not close is killed, and a
  // profile the dying browser is still writing to is retried, not fatal. The
  // kill reaches ONLY the process this script spawned on its own fresh profile,
  // through the handle it holds: never a browser found by name, so somebody
  // else's Chrome on the same machine is out of reach by construction.
  const cleanup = async () => {
    if (browser) {
      const child = browser.process();
      await Promise.race([browser.close().catch(() => {}), sleep(20_000)]);
      if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        cleanupOwnedProfileDir(profileDir, PROFILE_PREFIX);
        return;
      } catch {
        await sleep(500);
      }
    }
    console.error(`[crowd-ab] could not remove the browser profile ${profileDir}`);
  };
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      void cleanup().finally(() => process.exit(130));
    });
  }

  const health = {
    pageErrors: [],
    consoleErrors: [],
    webglMessages: [],
    failedAssets: [],
    // Requests the page itself cancelled (net::ERR_ABORTED): counted, with a
    // few examples, but not failures.
    abortedAssets: 0,
    abortedAssetExamples: [],
  };
  // Model and texture requests only: the homepage also streams music and
  // polls an API that no server answers here, and neither says anything
  // about whether a character is still loading.
  const assets = { inFlight: new Set(), lastActivityAt: Date.now(), log: [], byRequest: new Map() };
  const corpusRecord = { outcome: null };
  let lost = null;
  const warnings = [];
  const failures = [];
  let exitCode = 0;
  try {
    browser = await puppeteer.launch({
      executablePath: browserPath,
      headless: HEADLESS,
      userDataDir: profileDir,
      // A busy host can take longer than the default 30 s to bring a browser up.
      timeout: 120_000,
      protocolTimeout: 900_000,
      defaultViewport: { width: VIEWPORT.width, height: VIEWPORT.height, deviceScaleFactor: DPR },
      args,
    });
    const spawnArgs = browser.process()?.spawnargs ?? args;
    if (spawnArgs.some((arg) => /disable-gpu-vsync|disable-frame-rate-limit/.test(arg))) {
      throw new Error('the browser was launched with a vsync-off flag: not this rig');
    }
    const page = (await browser.pages())[0] ?? (await browser.newPage());
    // A headed window can be closed by hand mid-run: say so instead of leaving
    // a bare protocol error.
    page.once('close', () => {
      lost ??= 'the page was closed';
    });
    browser.once('disconnected', () => {
      lost ??= 'the browser went away';
    });
    await page.bringToFront().catch(() => {});
    await suppressGpuNotice(page);
    page.on('pageerror', (error) => {
      if (health.pageErrors.length < 30)
        health.pageErrors.push(String(error?.message ?? error).slice(0, 300));
    });
    page.on('console', (message) => {
      const text = message.text();
      const type = message.type();
      if (text.startsWith(CORPUS_RECORD_LINE)) corpusRecord.outcome ??= text.slice(0, 120);
      if (/webgl|GL_INVALID|GL ERROR|INVALID_OPERATION|INVALID_ENUM|INVALID_VALUE/i.test(text)) {
        if (health.webglMessages.length < 30)
          health.webglMessages.push(`${type}: ${text.slice(0, 300)}`);
      } else if (type === 'error' && !/\/api\/|Failed to load resource/.test(text)) {
        if (health.consoleErrors.length < 30) health.consoleErrors.push(text.slice(0, 300));
      }
    });
    const assetPathOf = (rawUrl) => {
      try {
        const { pathname } = new URL(rawUrl);
        return /^\/(models|textures)\//.test(pathname) ? pathname : null;
      } catch {
        return null;
      }
    };
    page.on('request', (request) => {
      const assetPath = assetPathOf(request.url());
      if (!assetPath) return;
      const entry = { at: Date.now(), path: assetPath, bytes: 0 };
      assets.inFlight.add(request);
      assets.byRequest.set(request, entry);
      assets.log.push(entry);
      assets.lastActivityAt = Date.now();
    });
    const settleRequest = (request) => {
      if (assets.inFlight.delete(request)) assets.lastActivityAt = Date.now();
    };
    page.on('requestfinished', settleRequest);
    page.on('requestfailed', (request) => {
      settleRequest(request);
      const assetPath = assetPathOf(request.url());
      if (!assetPath) return;
      const reason = request.failure()?.errorText ?? 'failed';
      if (reason === 'net::ERR_ABORTED') {
        health.abortedAssets += 1;
        if (health.abortedAssetExamples.length < 8) {
          health.abortedAssetExamples.push(
            `${Math.round((Date.now() - startedAt.getTime()) / 1000)} s ${assetPath}`,
          );
        }
      } else if (health.failedAssets.length < 40) {
        health.failedAssets.push(`${reason} ${assetPath}`);
      }
    });
    page.on('response', (response) => {
      const entry = assets.byRequest.get(response.request());
      if (!entry) return;
      if (response.status() >= 400) {
        if (health.failedAssets.length < 40)
          health.failedAssets.push(`${response.status()} ${entry.path}`);
        return;
      }
      entry.bytes = Number(response.headers()['content-length'] ?? 0);
    });

    console.log('[crowd-ab] entering the offline world...');
    await page.goto(`${GAME_URL}/${QUERY}`, {
      waitUntil: 'domcontentloaded',
      timeout: BOOT_TIMEOUT_MS,
    });
    const entry = await enterOfflineWorld(page, assets);
    if (!entry.previewIdle) {
      warnings.push('the creation stage was still loading files when Enter World was pressed');
    }
    if (DAY_PHASE === null) {
      warnings.push(
        'the time of day was left on its live 45 minute clock (AB_DAYPHASE=live): compare only runs at one phase',
      );
    } else if (!entry.dayNight.ok) {
      warnings.push(
        `the time of day could not be pinned (${entry.dayNight.error ?? 'the override did not hold'}): the arms may stand under different light`,
      );
    }
    await page.evaluate(installPageRig);
    const observer = await page.evaluate(
      (override) => window.__wocCrowdAb.prepareObserver(override),
      observerOverride,
    );
    const itemsOk = await page.evaluate(
      (ids) => window.__wocCrowdAb.verifyItems(ids),
      Object.values(AB_WORN_SET),
    );
    if (itemsOk === null)
      warnings.push("worn item ids could not be checked against the arm's item table");
    else if (itemsOk.includes(false))
      failures.push("a worn item id is missing from this arm's item table");

    console.log('[crowd-ab] settling after entry...');
    // Two background jobs follow every world entry and would otherwise land
    // inside a window at a different moment on every run: the preview prewarm
    // (queue units, seen by the settle as a busy queue) and the shader corpus
    // record, which only STARTS about 25 s after the reveal. The entry settle
    // waits for the record to say it is over, then for quiet.
    const entrySettle = await settle(
      page,
      Math.max(SETTLE_MS, 20_000),
      ENTRY_SETTLE_MAX_MS,
      async () => corpusRecord.outcome !== null,
    );
    entrySettle.corpusRecord = corpusRecord.outcome ?? 'no end reported';
    if (corpusRecord.outcome === null) {
      warnings.push(
        'the shader corpus record had not reported its end when the entry settle ran out: it may run inside a window',
      );
    } else if (!entrySettle.quiet) {
      warnings.push('the world was still preparing when the entry settle ran out');
    }
    // The camera fall of a first island landing ends well inside the settle;
    // seat the camera again so every arm frames the same view.
    await page.evaluate((override) => window.__wocCrowdAb.prepareObserver(override), {
      x: null,
      z: null,
      facing: observer.facing,
    });
    await sleep(500);
    const environment = await page.evaluate(() => window.__wocCrowdAb.environment());
    if (environment.tier !== GFX)
      failures.push(`the renderer runs tier ${environment.tier}, not ${GFX}`);
    if (environment.player.cls !== 'warrior' || environment.player.level !== 1) {
      warnings.push(
        `the observer is a level ${environment.player.level} ${environment.player.cls}`,
      );
    }
    const softwareGl = /swiftshader|llvmpipe|software|basic render/i.test(
      environment.glRenderer ?? '',
    );
    if (softwareGl) warnings.push(`software WebGL renderer: ${environment.glRenderer}`);
    if (GPU_TIMER_ASKED && !environment.gpuTimerAvailable) {
      warnings.push(
        `EXT_disjoint_timer_query_webgl2 is ${environment.timerExtensionSupported ? 'listed but the probe is off' : 'not exposed by this browser'}: no GPU ms in this run`,
      );
    }
    console.log(
      `[crowd-ab] webgl: ${environment.glRenderer} (gpu timer ${environment.gpuTimerAvailable})`,
    );

    let cdp = null;
    if (CPU_THROTTLE > 1) {
      cdp = await page.createCDPSession();
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
      console.log(`[crowd-ab] CPU throttle x${CPU_THROTTLE} on (a proxy for a weak CPU)`);
      await sleep(2000);
    }

    const roster = crowdRoster(BOT_COUNT);
    const closeSpots = crowdGrid(observer, AB_SCENE_BANDS.close, BOT_COUNT);
    const farSpots = crowdGrid(observer, AB_SCENE_BANDS.far, BOT_COUNT);
    const botFacing = observer.facing + Math.PI;
    const windows = [];
    const settles = {};
    let ids = null;
    const shot = async (scene) => {
      if (!SCREENSHOTS) return;
      await page
        .screenshot({ path: path.join(OUT_DIR, `${baseName}_${scene}.png`) })
        .catch((error) => warnings.push(`screenshot ${scene} failed: ${error.message}`));
    };
    const pushWindow = (
      raw,
      network = { files: 0, bytes: 0, characterFiles: 0, characterBytes: 0, paths: [] },
    ) => {
      const window = summarizeWindow(raw, CPU_THROTTLE, network);
      windows.push(window);
      if (window.frames.rendered === 0)
        failures.push(`${window.scene}: no rendered frame was recorded`);
      if (window.visibility.start !== 'visible' || window.visibility.end !== 'visible') {
        warnings.push(`${window.scene}: the page was not visible for the whole window`);
      }
      const drift = Math.hypot(raw.end.observer.x - observer.x, raw.end.observer.z - observer.z);
      if (drift > 0.1) warnings.push(`${window.scene}: the observer moved ${drift.toFixed(1)} yd`);
      console.log(
        `[crowd-ab] ${window.scene}: gpu ${window.gpu.meanMs ?? 'n/a'} ms, draws ${window.draws.callsMedian}, ` +
          `tris ${window.draws.trianglesMedian}, frame ${window.frames.meanMs} ms (p95 ${window.frames.p95Ms}), ` +
          `over50 ${window.frames.over50}, long tasks ${window.longTasks.count} (max ${window.longTasks.maxMs})` +
          `${window.bodies ? `, drawn ${window.bodies.drawn}/${window.bodies.expected}` : ''}`,
      );
      return window;
    };

    if (SCENES.includes('solo')) {
      const raw = await runWindow(page, 'SOLO', null, null);
      pushWindow(raw.window);
      await shot('SOLO');
    }

    const needsCrowd = SCENES.some((scene) => scene !== 'solo');
    if (needsCrowd) {
      const action = {
        kind: 'spawn',
        roster,
        spots: closeSpots,
        wornSet: AB_WORN_SET,
        facing: botFacing,
      };
      if (SCENES.includes('arrival')) {
        const startedAt = Date.now();
        const raw = await runWindow(page, 'ARRIVAL', null, action);
        ids = raw.ids;
        // Files this session had not asked for before the spawn.
        const seen = new Set(
          assets.log.filter((entry) => entry.at < startedAt).map((entry) => entry.path),
        );
        const network = { files: 0, bytes: 0, characterFiles: 0, characterBytes: 0, paths: [] };
        for (const entry of assets.log) {
          if (entry.at < startedAt || seen.has(entry.path)) continue;
          seen.add(entry.path);
          network.files += 1;
          network.bytes += entry.bytes;
          if (/^\/(models\/chars|textures\/skins)\//.test(entry.path)) {
            network.characterFiles += 1;
            network.characterBytes += entry.bytes;
          }
          network.paths.push(entry.path);
        }
        const window = pushWindow(raw.window, network);
        if (window.arrival.allDrawnAfterMs === null) {
          warnings.push(
            `ARRIVAL: only ${window.arrival.drawnInWindow} of ${BOT_COUNT} bodies were drawn inside the window`,
          );
        }
        await shot('ARRIVAL');
      } else {
        const spawned = await page.evaluate(
          (act) => window.__wocCrowdAb.spawn(act.roster, act.spots, act.wornSet, act.facing),
          action,
        );
        ids = spawned.ids;
      }
    }

    if (ids && SCENES.includes('close')) {
      console.log('[crowd-ab] settling the close crowd...');
      settles.close = await settle(page, SETTLE_MS, SETTLE_MAX_MS, async () => {
        const state = await page.evaluate((botIds) => window.__wocCrowdAb.crowdState(botIds), ids);
        return state.drawn === state.expected;
      });
      if (!settles.close.quiet)
        warnings.push('CLOSE: the crowd was still preparing when the settle ran out');
      const raw = await runWindow(page, 'CLOSE', ids, null);
      const window = pushWindow(raw.window);
      const b = window.bodies;
      if (b.drawn !== b.expected) failures.push(`CLOSE: ${b.drawn} of ${b.expected} bodies drawn`);
      if (b.articulated !== b.expected)
        warnings.push(`CLOSE: ${b.articulated} of ${b.expected} bodies articulated`);
      if (b.inFrustum !== b.expected)
        warnings.push(`CLOSE: ${b.inFrustum} of ${b.expected} bodies inside the view`);
      if (b.dressed !== b.expected)
        failures.push(`CLOSE: ${b.dressed} of ${b.expected} bots carry the six worn slots`);
      if (b.moved + b.swimming + b.dead + b.inCombat > 0) {
        warnings.push(
          `CLOSE: bots not standing idle (moved ${b.moved}, swimming ${b.swimming}, dead ${b.dead}, in combat ${b.inCombat})`,
        );
      }
      await shot('CLOSE');
    }

    const toFar = { kind: 'move', ids, spots: farSpots, facing: botFacing };
    let movedFar = false;
    if (ids && SCENES.includes('transit')) {
      const raw = await runWindow(page, 'TRANSIT', ids, toFar);
      movedFar = true;
      const window = pushWindow(raw.window);
      if (window.transit.allOnFarMeshAfterMs === null) {
        warnings.push(
          `TRANSIT: only ${window.transit.onFarMeshInWindow} of ${BOT_COUNT} bodies reached their far mesh inside the window`,
        );
      }
      await shot('TRANSIT');
    }

    if (ids && SCENES.includes('far')) {
      const movedAt = Date.now();
      if (!movedFar) {
        await page.evaluate(
          (act) => window.__wocCrowdAb.move(act.ids, act.spots, act.facing),
          toFar,
        );
      }
      console.log('[crowd-ab] settling the far crowd...');
      let farAfterMs = null;
      settles.far = await settle(page, SETTLE_MS, SETTLE_MAX_MS, async () => {
        const state = await page.evaluate((botIds) => window.__wocCrowdAb.crowdState(botIds), ids);
        const all = state.onFarMesh === state.expected;
        if (all && farAfterMs === null) farAfterMs = Date.now() - movedAt;
        return all;
      });
      // To the second, and only when no TRANSIT window timed it to the frame.
      settles.far.allOnFarMeshAfterMs = movedFar ? null : farAfterMs;
      if (!settles.far.quiet)
        warnings.push('FAR: the crowd was still preparing when the settle ran out');
      const raw = await runWindow(page, 'FAR', ids, null);
      const window = pushWindow(raw.window);
      const b = window.bodies;
      if (b.onFarMesh !== b.expected)
        failures.push(`FAR: ${b.onFarMesh} of ${b.expected} bodies on their far mesh`);
      if (b.inFrustum !== b.expected)
        warnings.push(`FAR: ${b.inFrustum} of ${b.expected} bodies inside the view`);
      if (b.moved + b.swimming + b.dead + b.inCombat > 0) {
        warnings.push(
          `FAR: bots not standing idle (moved ${b.moved}, swimming ${b.swimming}, dead ${b.dead}, in combat ${b.inCombat})`,
        );
      }
      await shot('FAR');
    }

    if (cdp) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => {});
    const loadEnd = hostLoad(os.loadavg()[0], os.cpus().length);
    const swap = swapActivity(swapStart, readSwapCounters());
    const hiddenWindows = windows.filter(
      (window) => window.visibility.start !== 'visible' || window.visibility.end !== 'visible',
    ).length;
    const reasons = evidenceReasons({
      headless: HEADLESS,
      busyStart: loadStart.busy,
      busyEnd: loadEnd.busy,
      swapping: swap.busy,
      softwareGl,
      smoke: SMOKE,
      hiddenWindows,
    });
    const pageBuildMatches =
      arm.gitSha && environment.pageBuildId ? arm.gitSha.startsWith(environment.pageBuildId) : null;
    if (pageBuildMatches === false) {
      warnings.push(
        `the page reports build id ${environment.pageBuildId} but the served checkout is at ${arm.gitShaShort}: restart the dev server`,
      );
    }
    const solo = windows.find((window) => window.scene === 'SOLO') ?? windows[0];
    const close = windows.find((window) => window.scene === 'CLOSE');
    const anyBodies = (close ?? windows.find((window) => window.bodies))?.bodies ?? null;
    const result = {
      schema: AB_SCHEMA,
      provenance: {
        label,
        note: NOTE,
        startedAtUtc: startedAt.toISOString(),
        finishedAtUtc: new Date().toISOString(),
        arm: {
          ...arm,
          // Offline mode exists only in dev builds, so anything else never gets here.
          build: environment.viteDevClient ? 'dev' : 'unknown',
          buildEvidence: environment.viteDevClient
            ? 'the page loads the vite dev client'
            : 'no vite dev client in the page',
          pageBuildId: environment.pageBuildId,
          pageVersion: environment.pageVersion,
          pageBuildIdMatchesServedHead: pageBuildMatches,
        },
        rig: {
          script: 'scripts/woc_crowd_ab.mjs',
          dir: ROOT,
          gitSha: git(ROOT, ['rev-parse', 'HEAD']),
          scriptSha256: createHash('sha256')
            .update(fs.readFileSync(fileURLToPath(import.meta.url)))
            .digest('hex'),
          coreSha256: createHash('sha256')
            .update(fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'woc_crowd_ab_core.mjs')))
            .digest('hex'),
          pageSha256: createHash('sha256')
            .update(fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'woc_crowd_ab_page.mjs')))
            .digest('hex'),
        },
        browser: {
          version: await browser.version(),
          userAgent: await browser.userAgent(),
          executablePath: browserPath,
          headless: HEADLESS,
          freshProfile: true,
          vsync: 'normal: no --disable-gpu-vsync, no --disable-frame-rate-limit',
          externalHosts: EXTERNAL_HOSTS
            ? 'reachable (AB_EXTERNAL=1): web fonts and third-party scripts load from the internet'
            : 'unresolvable by design: no web font, no third-party script, HUD in the fallback font',
          args: spawnArgs,
        },
        webgl: {
          vendor: environment.glVendor,
          renderer: environment.glRenderer,
          powerPreference: environment.glPowerPreference,
          software: softwareGl,
          gpuTimer: environment.gpuTimerAvailable,
          timerExtensionSupported: environment.timerExtensionSupported,
          parallelShaderCompile: environment.parallelShaderCompile,
        },
        flags: {
          query: QUERY,
          gfx: GFX,
          governor: queryParams.get('governor'),
          gputimer: queryParams.get('gputimer'),
          fpscap: queryParams.get('fpscap'),
          effectiveTier: environment.tier,
          autoGovernor: environment.autoGovernor,
        },
        viewport: {
          width: VIEWPORT.width,
          height: VIEWPORT.height,
          dpr: DPR,
          innerWidth: environment.innerWidth,
          innerHeight: environment.innerHeight,
          devicePixelRatio: environment.devicePixelRatio,
          drawingBuffer: environment.drawingBuffer,
          rendererPixelRatio: environment.pixelRatio,
          screen: environment.screen,
        },
        pacing: {
          mode: HEADLESS
            ? 'headless: no display, the browser paces frames on its own 60 Hz timer and presents nothing'
            : 'headed: frames paced by the display vsync',
          cadence: solo?.cadence ?? null,
          rafMedianMs: solo?.raf.medianMs ?? null,
        },
        dayNight: {
          pinnedPhase: entry.dayNight.pinnedPhase,
          livePhaseAtEntry: entry.dayNight.livePhase,
          note:
            DAY_PHASE === null
              ? 'left on the live UTC-anchored 45 minute cycle'
              : 'frozen through the dev time-of-day override (0.5 is noon), moon frozen full',
        },
        cpuThrottle: {
          rate: CPU_THROTTLE,
          note:
            CPU_THROTTLE > 1
              ? 'Emulation.setCPUThrottlingRate slows the page main thread only (not workers, the GPU process or the driver): a proxy for a weak CPU, never a measurement of one'
              : 'none',
        },
        host: {
          platform: os.platform(),
          release: os.release(),
          arch: os.arch(),
          cpu: os.cpus()[0]?.model ?? 'unknown',
          logicalCpus: os.cpus().length,
          totalMemoryGb: Math.round(os.totalmem() / 2 ** 30),
          loadStart,
          loadEnd,
          // Memory swapped in and out while the run lasted (macOS only): a
          // host short of memory stalls a page for reasons no arm owns.
          swap,
        },
        evidence: { performanceEvidence: reasons.length === 0, reasons },
      },
      config: {
        scenes: SCENES,
        windowMs: WINDOW_MS,
        settleMs: SETTLE_MS,
        settleMaxMs: SETTLE_MAX_MS,
        bots: BOT_COUNT,
        bands: AB_SCENE_BANDS,
      },
      observer: {
        ...observer,
        level: environment.player.level,
        cls: environment.player.cls,
        worn: environment.player.worn,
      },
      crowd: anyBodies
        ? {
            count: BOT_COUNT,
            classes: new Set(roster.map((bot) => bot.cls)).size,
            male: roster.filter((bot) => bot.gender === 'male').length,
            female: roster.filter((bot) => bot.gender === 'female').length,
            wornSet: AB_WORN_SET,
            wornItemIdsInItemTable: itemsOk === null ? 'not checked' : !itemsOk.includes(false),
            dressed: anyBodies.dressed,
            composedBodies: anyBodies.composed,
            visualKeys: anyBodies.visualKeys,
            asymmetry:
              anyBodies.composed > 0
                ? `this arm draws ${anyBodies.composed} COMPOSED bodies: they ignore the worn set and wear their class kit`
                : 'this arm draws fixed class rigs (the WOC bodies): each shows its own class piece for every worn slot',
            botFacing,
            closeSpots,
            farSpots,
          }
        : null,
      settles: { entry: entrySettle, ...settles },
      windows,
      crowdOverSolo: crowdOverSolo(windows, BOT_COUNT),
      health,
      warnings,
      failures,
    };
    const jsonPath = path.join(OUT_DIR, `${baseName}.json`);
    const textPath = path.join(OUT_DIR, `${baseName}.txt`);
    const summary = formatSummary(result);
    fs.writeFileSync(jsonPath, `${JSON.stringify(result, null, 1)}\n`);
    fs.writeFileSync(textPath, summary);
    console.log(`\n${summary}`);
    console.log(`[crowd-ab] wrote ${path.relative(ROOT, jsonPath)}`);
    console.log(`[crowd-ab] wrote ${path.relative(ROOT, textPath)}`);
    exitCode = failures.length > 0 ? 1 : 0;
  } catch (error) {
    console.error(`[crowd-ab] failed: ${error?.stack ?? error}`);
    if (error?.cause) console.error(`[crowd-ab] cause: ${error.cause?.message ?? error.cause}`);
    if (lost) console.error(`[crowd-ab] ${lost} before the run finished`);
    if (browser?.connected) {
      // Bounded: a page that cannot produce a frame must not hold the exit.
      const pages = await browser.pages().catch(() => []);
      await Promise.race([
        pages[0]
          ?.screenshot({ path: path.join(OUT_DIR, `${baseName}_FAILED.png`) })
          .catch(() => {}),
        sleep(15_000),
      ]);
    }
    exitCode = 1;
  } finally {
    await cleanup();
  }
  process.exit(exitCode);
}

await main();
