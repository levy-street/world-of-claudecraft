// Live program hunt: a manual ONLINE session, instrumented, aggregated.
//
// The renderer rule (src/render/CLAUDE.md, "Every material a live frame can
// draw for the first time after the curtain has a prewarm home") is judged by
// the live-program events in perfStats().gpuPrep. A fleet capture carries the
// events but names nothing (three names a program after material.name, and
// most escapees are unnamed), and an offline tour misses what a live world
// brings: gear, mounts, pets, dungeons, other players. So this script serves
// THIS worktree's dev client proxied to the production realm (render
// diagnostics and the shader warm audit only arm on a loopback dev build with
// ?perfTrace=1), opens a browser for the operator to play in, polls the
// renderer while they play, and writes ONE aggregated report at the end. Nobody
// reads the raw feed live; the report is the deliverable.
//
//   node scripts/live_program_hunt.mjs                # serve + browse + report
//   node scripts/live_program_hunt.mjs --report tmp/live-program-hunt-<id>/samples.ndjson
//
// Flags: --target <origin> (default https://worldofclaudecraft.com), --port
// <n> (default 5173), --offline (no realm proxy; play the offline world),
// --out <dir>, --headless, --angle <backend>,
// --profile <dir> (persistent Chrome profile, so the login survives sessions;
// default tmp/live-program-hunt-profile), --allow-dirty.
//
// Stop the session with Enter in this terminal, Ctrl-C, or by closing the
// browser: all three paths aggregate, write the report and stop vite.
//
// Vite trap (vite.config.ts watch.ignored matches '**/.claude/**', so a dev
// server inside an agent worktree never sees edits, and its transform cache
// can outlive a restart): every start here kills the port, purges
// node_modules/.vite and .vite-temp, starts with --force, then grep-verifies
// the served module before opening the browser.

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { findBrowserPath } from './browser_path_resolve.mjs';
import { renderReport } from './lib/live_program_hunt_report.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_TARGET = 'https://worldofclaudecraft.com';
const DEFAULT_PORT = 5173;
const POLL_MS = 250;
const VIEWPORT = { width: 1600, height: 900, deviceScaleFactor: 1 };
// The served-module check: this export must be in the module the browser will
// load, otherwise vite is serving something other than this worktree.
const SERVED_CHECK = {
  module: '/src/render/live_program_watch.ts',
  token: 'recordNewLivePrograms',
};

function parseArgs(argv) {
  const args = {
    target: DEFAULT_TARGET,
    port: DEFAULT_PORT,
    out: null,
    headless: false,
    angle: null,
    profile: path.join(ROOT, 'tmp', 'live-program-hunt-profile'),
    allowDirty: false,
    offline: false,
    report: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--target') args.target = next();
    else if (a === '--port') args.port = Number(next());
    else if (a === '--out') args.out = next();
    else if (a === '--headless') args.headless = true;
    else if (a === '--angle') args.angle = next();
    else if (a === '--profile') args.profile = next();
    else if (a === '--allow-dirty') args.allowDirty = true;
    else if (a === '--offline') args.offline = true;
    else if (a === '--report') args.report = next();
    else throw new Error(`unknown flag ${a}`);
  }
  return args;
}

function git(argv, fallback) {
  try {
    return execFileSync('git', argv, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return fallback;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// vite: the prod hookup config, generated per run under tmp/ (never committed)
// ---------------------------------------------------------------------------

function writeHookupConfig(outDir, target) {
  const wsTarget = target.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
  const file = path.join(outDir, 'vite.hookup.config.mts');
  const rel = path.relative(outDir, path.join(ROOT, 'vite.config.ts')).replace(/\\/g, '/');
  // changeOrigin on the WebSocket entry is the part the base config lacks: the
  // upgrade otherwise reaches the edge with Host: localhost and is refused.
  fs.writeFileSync(
    file,
    [
      `import base from '${rel.startsWith('.') ? rel : `./${rel}`}';`,
      `const PROD = ${JSON.stringify(target)};`,
      `const PROD_WS = ${JSON.stringify(wsTarget)};`,
      'const config = { ...(base as Record<string, unknown>) } as {',
      '  server?: { proxy?: Record<string, unknown> };',
      '};',
      'config.server = {',
      '  ...(config.server ?? {}),',
      '  proxy: {',
      '    ...(config.server?.proxy ?? {}),',
      "    '/api': { target: PROD, changeOrigin: true },",
      "    '/ws': { target: PROD_WS, ws: true, changeOrigin: true, headers: { Origin: PROD } },",
      '  },',
      '};',
      'export default config;',
      '',
    ].join('\n'),
  );
  return file;
}

function killPort(port) {
  try {
    execFileSync('fuser', ['-k', `${port}/tcp`], { stdio: 'ignore' });
  } catch {
    // nothing was listening
  }
}

function purgeViteCache() {
  for (const dir of ['node_modules/.vite', 'node_modules/.vite-temp']) {
    fs.rmSync(path.join(ROOT, dir), { recursive: true, force: true });
  }
}

async function waitForVite(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(250);
  }
  throw new Error(`vite did not answer on :${port} within ${timeoutMs} ms`);
}

async function verifyServedModule(port) {
  const res = await fetch(`http://127.0.0.1:${port}${SERVED_CHECK.module}`);
  const body = await res.text();
  if (!body.includes(SERVED_CHECK.token)) {
    throw new Error(
      `served ${SERVED_CHECK.module} lacks ${SERVED_CHECK.token}: vite is not serving this worktree`,
    );
  }
}

function startVite(port, configFile, logFile) {
  killPort(port);
  purgeViteCache();
  const log = fs.openSync(logFile, 'w');
  const child = spawn(
    'npx',
    [
      'vite',
      ...(configFile ? ['--config', configFile] : []),
      '--force',
      '--port',
      String(port),
      '--strictPort',
      '--host',
      '127.0.0.1',
    ],
    { cwd: ROOT, stdio: ['ignore', log, log], env: { ...process.env, WOC_LIVE_PROGRAM_HUNT: '1' } },
  );
  return child;
}

// ---------------------------------------------------------------------------
// the page side: one poll, state kept on window so each poll only ships deltas
// ---------------------------------------------------------------------------

function pollOnce() {
  const game = window.__game;
  const renderer = game?.renderer;
  if (!renderer?.perfStats) return null;
  if (!window.__lph) window.__lph = { lastProgramId: -1, seenEvents: new Set() };
  const state = window.__lph;
  const stats = renderer.perfStats();
  const info = renderer.webgl?.info;
  const programs = [];
  for (const p of info?.programs ?? []) {
    if (typeof p.id !== 'number' || p.id <= state.lastProgramId) continue;
    programs.push({ id: p.id, name: p.name ?? '', cacheKey: p.cacheKey ?? '' });
  }
  if (programs.length) state.lastProgramId = Math.max(...programs.map((p) => p.id));
  const events = [];
  for (const e of stats.gpuPrep?.events?.events ?? []) {
    const id = `${e.kind}|${e.key}|${e.atMs}`;
    if (state.seenEvents.has(id)) continue;
    state.seenEvents.add(id);
    events.push({
      kind: e.kind,
      key: e.key,
      atMs: e.atMs,
      readyRoots: e.readyRoots,
      totalRoots: e.totalRoots,
    });
  }
  if (state.seenEvents.size > 4000) state.seenEvents = new Set([...state.seenEvents].slice(-2000));
  const diag = stats.renderDiagnostics ?? null;
  const pos = game.sim?.player?.pos ?? null;
  // The in-game badge: a fixed corner counter the operator can read while
  // playing (live programs so far, the last label, gate failures). Script-owned
  // DOM, so the game client ships no counter and the HUD is untouched.
  state.live = (state.live ?? 0) + events.filter((e) => e.kind === 'live-program').length;
  state.gates =
    (state.gates ?? 0) +
    events.filter((e) => e.kind === 'attach-watchdog' || e.kind === 'gate-timeout').length;
  const lastLive = events.filter((e) => e.kind === 'live-program').pop();
  if (lastLive) {
    const named = programs.find((p) => p.cacheKey === lastLive.key)?.name || '';
    state.last = named || (lastLive.key.includes(',') ? 'unnamed' : lastLive.key);
    state.lastAt = Date.now();
  }
  let badge = document.getElementById('lph-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'lph-badge';
    badge.style.cssText =
      'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:2147483647;' +
      'font:12px/1.4 monospace;color:#fff;background:rgba(0,0,0,.72);padding:4px 10px;' +
      'border-radius:4px;pointer-events:none;white-space:nowrap';
    document.body.appendChild(badge);
  }
  const flash = state.lastAt && Date.now() - state.lastAt < 3000;
  badge.style.background = flash ? 'rgba(180,30,30,.85)' : 'rgba(0,0,0,.72)';
  badge.textContent =
    `live programs: ${state.live}` +
    (state.last ? ` (last: ${state.last})` : '') +
    ` | gate failures: ${state.gates}` +
    (diag?.enabled ? '' : ' | NO DIAGNOSTICS');
  return {
    t: performance.now(),
    zone: stats.currentZoneId ?? '',
    pos: pos ? { x: pos.x, z: pos.z } : null,
    programs,
    events,
    diag: diag?.enabled
      ? {
          newMaterials: diag.newMaterials ?? [],
          firstVisibleObjects: diag.firstVisibleObjects ?? [],
          programDelta: diag.programDelta ?? 0,
        }
      : null,
    diagnosticsEnabled: !!diag?.enabled,
  };
}

function readAudit() {
  const perf = window.__game?.perf;
  if (!perf) return { error: 'no __game.perf on the page' };
  try {
    const report = perf.report?.();
    if (!report) return { error: 'perf.report() returned nothing' };
    const audit = report.shaderWarmAudit;
    if (!audit)
      return { error: `report has no shaderWarmAudit (keys: ${Object.keys(report).join(',')})` };
    return JSON.parse(JSON.stringify(audit));
  } catch (err) {
    return { error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// session
// ---------------------------------------------------------------------------

function waitForStop(browser) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (why) => {
      if (done) return;
      done = true;
      resolve(why);
    };
    if (process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin });
      rl.once('line', () => {
        rl.close();
        finish('enter');
      });
    }
    process.once('SIGINT', () => finish('sigint'));
    process.once('SIGTERM', () => finish('sigterm'));
    browser.once('disconnected', () => finish('browser-closed'));
  });
}

export async function hunt(args) {
  const dirty = git(['status', '--porcelain'], '') !== '';
  if (dirty && !args.allowDirty)
    throw new Error('worktree is dirty; pass --allow-dirty to record it explicitly');
  const browserPath = findBrowserPath();
  if (!browserPath) throw new Error('No Chrome/Chromium found; set BROWSER_PATH');
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = args.out ?? path.join(ROOT, 'tmp', `live-program-hunt-${id}`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(args.profile, { recursive: true });
  const samplesFile = path.join(outDir, 'samples.ndjson');
  const reportFile = path.join(outDir, 'report.md');
  const viteLog = path.join(outDir, 'vite.log');

  // Offline: the plain repo config (no realm behind /api and /ws), the
  // operator enters the offline world. Fewer live-world variants, but no
  // account, no server, and the interiors and zones are the same code.
  const configFile = args.offline ? null : writeHookupConfig(outDir, args.target);
  process.stdout.write(
    `vite: purging cache, serving ${ROOT} ${args.offline ? 'OFFLINE' : `against ${args.target}`} on :${args.port}\n`,
  );
  const vite = startVite(args.port, configFile, viteLog);
  let browser = null;
  const startedAt = Date.now();
  const samples = fs.createWriteStream(samplesFile);
  let polls = 0;
  let sawDiagnostics = false;
  try {
    await waitForVite(args.port, 120_000);
    await verifyServedModule(args.port);
    process.stdout.write('vite: serving this worktree (verified)\n');

    browser = await puppeteer.launch({
      executablePath: browserPath,
      headless: args.headless ? 'new' : false,
      userDataDir: args.profile,
      defaultViewport: VIEWPORT,
      // puppeteer's own signal handlers exit the process before the report is
      // written; the stop promise below owns every exit path instead.
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
      args: [
        `--window-size=${VIEWPORT.width + 20},${VIEWPORT.height + 60}`,
        '--ignore-gpu-blocklist',
        '--enable-gpu',
        '--disable-backgrounding-occluded-windows',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        ...(args.angle ? [`--use-angle=${args.angle}`] : []),
      ],
    });
    const [page] = await browser.pages();
    // perfTrace=1 arms the render diagnostics (the material and object names);
    // perf arms the PerfMonitor whose report carries the shader warm audit.
    const url = `http://localhost:${args.port}/?perfTrace=1&perf`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    process.stdout.write(
      `\nBrowser open on ${url}. Log in and play. Stop with Enter here, Ctrl-C, or by closing the browser.\n\n`,
    );
    const stop = waitForStop(browser);
    let stopped = false;
    void stop.then(() => {
      stopped = true;
    });
    while (!stopped) {
      const row = await page.evaluate(pollOnce).catch(() => null);
      if (row) {
        polls += 1;
        if (row.diagnosticsEnabled) sawDiagnostics = true;
        if (row.programs.length || row.events.length || row.diag?.newMaterials?.length) {
          samples.write(`${JSON.stringify(row)}\n`);
        }
      }
      await sleep(POLL_MS);
    }
    const why = await stop;
    process.stdout.write(`\nstopping (${why}), aggregating...\n`);
    const audit = await page.evaluate(readAudit).catch(() => null);
    const browserVersion = await browser.version().catch(() => 'unknown');
    await new Promise((r) => samples.end(r));
    const meta = {
      target: args.offline ? 'offline' : args.target,
      gitSha: git(['rev-parse', '--short', 'HEAD'], 'unknown'),
      dirty,
      browser: browserVersion,
      durationMs: Date.now() - startedAt,
      polls,
      audit,
    };
    const report = renderReport(readSamples(samplesFile), meta);
    const warn = sawDiagnostics
      ? ''
      : '\n> WARNING: render diagnostics never reported enabled. The page must be a DEV build on localhost with ?perfTrace=1; names above are missing because of it.\n';
    fs.writeFileSync(reportFile, report + warn);
    fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 2));
    process.stdout.write(`report: ${reportFile}\nraw: ${samplesFile}\n`);
    return reportFile;
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    vite.kill('SIGTERM');
    killPort(args.port);
  }
}

function readSamples(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.report) {
    const dir = path.dirname(args.report);
    const metaFile = path.join(dir, 'meta.json');
    const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : {};
    const out = path.join(dir, 'report.md');
    fs.writeFileSync(out, renderReport(readSamples(args.report), meta));
    process.stdout.write(`report: ${out}\n`);
    return;
  }
  await hunt(args);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
