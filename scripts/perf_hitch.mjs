// Frozen frame-consistency referee for first-draw stalls, GC stutter, and heap ratchet.
// Average FPS belongs to scripts/perf_baseline.mjs and is deliberately absent here.
//
//   node scripts/perf_hitch.mjs run --preset insane --gate
//   node scripts/perf_hitch.mjs run --preset insane --scenario crowd-influx
//   node scripts/perf_hitch.mjs run --preset insane --scenario soak --soak-ms 30000
//   node scripts/perf_hitch.mjs calibrate
//   node scripts/perf_hitch.mjs report

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  browserEvidenceFromScenarios,
  closeActiveHitchBrowsers,
  HITCH_VIEWPORT_LABEL,
} from './lib/perf_hitch_browser.mjs';
import { buildHitchCliPlan } from './lib/perf_hitch_cli.mjs';
import { HITCH_ROSTER_SIZE, HitchRoster, runHitchScenario } from './lib/perf_hitch_scenarios.mjs';
import {
  assertNoCalibrationFlaps,
  compareRunToGate,
  deriveCalibration,
  formatGateComparison,
  historyTable,
  makeRunRecord,
  parseHistoryJsonl,
  SCENARIO_NAMES,
  SCENARIO_SPECS,
  summarizeScenario,
} from './lib/perf_hitch_store.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA_DIR = path.join(ROOT, 'docs', 'perf', 'hitch');
const RAW_ROOT = path.join(ROOT, 'tmp', 'perf-hitch');
const HISTORY_PATH = path.join(DATA_DIR, 'history.jsonl');
const GATE_PATH = path.join(DATA_DIR, 'gate.json');
const BEFORE_PATH = path.join(DATA_DIR, 'before.json');
const OFFLINE_URL = (process.env.GAME_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
const SERVER_URL = (process.env.SERVER_URL ?? 'http://localhost:8787').replace(/\/+$/, '');
const LOG_PATHS = ['tmp/logs/vite.log', 'tmp/logs/build.log', 'tmp/logs/server.log'];
function buildPlanOrExit(argv) {
  try {
    return buildHitchCliPlan(argv);
  } catch (error) {
    printHelp();
    console.error(`[hitch] invalid arguments: ${error?.message ?? error}`);
    process.exit(1);
  }
}

const plan = buildPlanOrExit(process.argv.slice(2));
const command = plan.command;
let activeRoster = null;
let shutdownStarted = false;

function fail(message, code = 1) {
  console.error(message);
  process.exitCode = code;
  throw new Error(message);
}

function readTail(relativePath, maxLines = 30) {
  const absolute = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolute)) return `${relativePath}: missing`;
  return `${relativePath}:\n${fs.readFileSync(absolute, 'utf8').split('\n').slice(-maxLines).join('\n')}`;
}

async function waitForServer(url, label, validate) {
  let lastError = '';
  for (let attempt = 1; attempt <= 45; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(4_000) });
      const value = await validate(response);
      if (value) return value;
      lastError = `HTTP ${response.status} did not match the expected ${label} response`;
    } catch (error) {
      lastError = error.message;
    }
    if (attempt === 1) console.log(`${label} is not ready at ${url}; waiting and retrying`);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  console.error(LOG_PATHS.map((entry) => readTail(entry)).join('\n\n'));
  fail(`${label} did not become ready at ${url}: ${lastError}`);
}

async function preflight(names) {
  if (names.some((name) => SCENARIO_SPECS[name].mode === 'offline')) {
    await waitForServer(OFFLINE_URL, 'Vite client', async (response) => {
      const text = await response.text();
      return response.ok && /claudecraft/i.test(text);
    });
  }
  if (names.some((name) => SCENARIO_SPECS[name].mode === 'online')) {
    await waitForServer(`${SERVER_URL}/api/status`, 'game server', async (response) => {
      const status = await response.json().catch(() => null);
      if (status?.ok && status.dev_commands === true && status.profiler_invulnerability === true) {
        return status;
      }
      return null;
    });
  }
}

function git(argsList, fallback = null) {
  try {
    return execFileSync('git', argsList, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return fallback;
  }
}

function sourceBuildId() {
  const hash = createHash('sha256');
  hash.update(git(['rev-parse', 'HEAD'], 'no-head'));
  const porcelain = git(
    [
      'status',
      '--porcelain',
      '-z',
      '--',
      'src',
      'server',
      'public',
      'package.json',
      'package-lock.json',
      'pnpm-lock.yaml',
      'vite.config.ts',
      'scripts/perf_hitch.mjs',
      'scripts/lib/perf_hitch_browser.mjs',
      'scripts/lib/perf_hitch_cli.mjs',
      'scripts/lib/perf_hitch_crowd_reset.mjs',
      'scripts/lib/perf_hitch_scenarios.mjs',
      'scripts/lib/perf_hitch_soak.mjs',
      'scripts/lib/perf_hitch_store.mjs',
      'scripts/profiler/harness.mjs',
    ],
    '',
  );
  for (const entry of porcelain.split('\0').filter(Boolean)) {
    const relative = entry.slice(3).split(' -> ').at(-1);
    const absolute = path.join(ROOT, relative);
    hash.update(entry);
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile())
      hash.update(fs.readFileSync(absolute));
  }
  return hash.digest('hex').slice(0, 16);
}

function runMetadata(preset, rawScenarios, note = '') {
  const browser = browserEvidenceFromScenarios(rawScenarios);
  return {
    at: new Date().toISOString(),
    commit: git(['rev-parse', '--short=12', 'HEAD']),
    buildId: sourceBuildId(),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    dirty: (git(['status', '--porcelain'], '') ?? '') !== '',
    preset,
    note,
    machine: `${os.cpus()[0]?.model ?? 'unknown-cpu'} ${os.arch()} ${Math.round(os.totalmem() / 2 ** 30)}GB`,
    viewport: HITCH_VIEWPORT_LABEL,
    ...browser,
  };
}

function rawDirectory(at, preset, sequence = '') {
  const stamp = at.replace(/[:.]/g, '-');
  return path.join(RAW_ROOT, `${stamp}-${preset}${sequence ? `-${sequence}` : ''}`);
}

function appendHistory(record) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.appendFileSync(HISTORY_PATH, `${JSON.stringify(record)}\n`);
}

async function measureRun({ preset, names, roster, soakMs, sequence = '', note = '' }) {
  await preflight(names);
  const rawScenarios = [];
  for (const name of names) {
    const measureMs = name === 'soak' && soakMs !== null ? soakMs : undefined;
    console.log(
      `[hitch] ${name}: warmup=${SCENARIO_SPECS[name].warmupMs}ms measure=${measureMs ?? SCENARIO_SPECS[name].measureMs}ms`,
    );
    const raw = await runHitchScenario({
      name,
      preset,
      offlineUrl: OFFLINE_URL,
      serverUrl: SERVER_URL,
      roster,
      measureMs,
    });
    rawScenarios.push(raw);
    const summary = summarizeScenario(raw);
    console.log(
      `[hitch] ${name}: long50=${summary.longFrames} worst=${summary.worstFrameMs}ms p99=${summary.p99FrameMs}ms programs=${summary.programCompiles} textures=${summary.texturesCreated} pooled=${summary.pooledVisualsCreated} settledHeap=${summary.settledHeapDeltaMb ?? '-'}MB heapFloorDiag=${summary.heapFloorGrowthMb ?? '-'}MB alloc=${summary.allocationRateMbPerSec ?? '-'}MB/s pageErrors=${summary.pageErrorCount ?? '-'} submitLatch=${summary.submitStallLatched}`,
    );
  }
  const meta = runMetadata(preset, rawScenarios, note);
  const summaries = rawScenarios.map(summarizeScenario);
  const record = makeRunRecord(meta, summaries);
  const outputDir = rawDirectory(meta.at, preset, sequence);
  fs.mkdirSync(outputDir, { recursive: true });
  for (const raw of rawScenarios) {
    fs.writeFileSync(path.join(outputDir, `${raw.name}.json`), `${JSON.stringify(raw)}\n`);
  }
  fs.writeFileSync(
    path.join(outputDir, 'record.json'),
    `${JSON.stringify({ record, rawFiles: rawScenarios.map((raw) => `${raw.name}.json`) }, null, 2)}\n`,
  );
  appendHistory(record);
  console.log(`[hitch] history: ${path.relative(ROOT, HISTORY_PATH)}`);
  console.log(`[hitch] raw: ${path.relative(ROOT, outputDir)}`);
  return record;
}

function loadGate() {
  if (!fs.existsSync(GATE_PATH))
    fail(`missing frozen gate at ${path.relative(ROOT, GATE_PATH)}; run calibrate`);
  return JSON.parse(fs.readFileSync(GATE_PATH, 'utf8'));
}

async function prepareRosterIfNeeded(names) {
  if (!names.some((name) => SCENARIO_SPECS[name].mode === 'online')) return null;
  const roster = new HitchRoster({ serverUrl: SERVER_URL });
  activeRoster = roster;
  console.log(`[hitch] preparing fixed ${HITCH_ROSTER_SIZE}-account local fixture roster`);
  await roster.prepare();
  console.log(
    `[hitch] fixture ready: rows=${roster.seedEvidence.rosterSize} cosmeticBatch=${roster.seedEvidence.cosmeticRows} payload=${roster.seedEvidence.payloadBytes} bytes`,
  );
  return roster;
}

function releaseRoster(roster) {
  roster?.release();
  if (activeRoster === roster) activeRoster = null;
}

async function runCommand() {
  const { preset, scenario, names, soakMs, note } = plan;
  const roster = await prepareRosterIfNeeded(names);
  try {
    const record = await measureRun({ preset, names, roster, soakMs, note });
    if (plan.gate) {
      const comparison = compareRunToGate(record, loadGate(), { scenario: scenario ?? undefined });
      for (const line of formatGateComparison(comparison)) console.log(line);
      if (!comparison.ok) process.exitCode = 1;
    }
  } finally {
    releaseRoster(roster);
  }
}

async function calibrateCommand() {
  const startBuildId = sourceBuildId();
  const roster = await prepareRosterIfNeeded(SCENARIO_NAMES);
  const records = [];
  try {
    for (let index = 0; index < plan.calibrationRuns; index += 1) {
      console.log(`[hitch] calibration ${index + 1}/3, build ${startBuildId}`);
      const record = await measureRun({
        preset: plan.preset,
        names: plan.names,
        roster,
        soakMs: plan.soakMs,
        sequence: `calibration-${index + 1}`,
        note: `calibration ${index + 1}/3`,
      });
      if (record.buildId !== startBuildId || sourceBuildId() !== startBuildId) {
        throw new Error('working build changed during the three calibration runs');
      }
      records.push(record);
    }
  } finally {
    releaseRoster(roster);
  }
  const { gate, before } = deriveCalibration(records);
  assertNoCalibrationFlaps(records, gate);
  for (const straddle of gate.missionStraddles) {
    console.log(
      `[hitch] mission straddle: ${straddle.scenario} ${straddle.metric} samples ${straddle.samples.join(', ')} against fixed target ${straddle.target}; recorded in gate.json, still enforced by every gate compare`,
    );
  }
  gate.reproducibility = {
    sameBuild: true,
    noCalibratedVerdictFlaps: true,
    missionStraddleCount: gate.missionStraddles.length,
  };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(GATE_PATH, `${JSON.stringify(gate, null, 2)}\n`);
  fs.writeFileSync(BEFORE_PATH, `${JSON.stringify(before, null, 2)}\n`);
  console.log(`[hitch] frozen gate: ${path.relative(ROOT, GATE_PATH)}`);
  console.log(`[hitch] frozen before: ${path.relative(ROOT, BEFORE_PATH)}`);
  for (const line of formatGateComparison(compareRunToGate(before, gate))) console.log(line);
}

function reportCommand() {
  if (!fs.existsSync(HISTORY_PATH))
    fail(`no hitch history at ${path.relative(ROOT, HISTORY_PATH)}`);
  const { records, skipped } = parseHistoryJsonl(fs.readFileSync(HISTORY_PATH, 'utf8'));
  for (const line of historyTable(records)) console.log(line);
  if (skipped) console.log(`${skipped} corrupt history line(s) skipped`);
}

function printHelp() {
  console.log('usage: node scripts/perf_hitch.mjs <run|calibrate|report>');
  console.log('  run --preset <low|medium|high|ultra|insane> [--gate] [--scenario <name>]');
  console.log('      [--soak-ms <5000 to 600000>] [--note <text>]');
  console.log('  calibrate');
  console.log('  report');
}

const watchdogMinutes = command === 'calibrate' ? 75 : 20;

async function boundedShutdown(code, reason) {
  if (shutdownStarted) return;
  shutdownStarted = true;
  console.error(`[hitch] ${reason}; cleaning up local browser and fixture sessions`);
  try {
    await Promise.race([
      Promise.allSettled([
        closeActiveHitchBrowsers(),
        activeRoster?.emergencyCleanup?.() ?? Promise.resolve(),
      ]),
      new Promise((resolve) => setTimeout(resolve, 15_000)),
    ]);
  } finally {
    activeRoster?.release?.();
    process.exit(code);
  }
}

setTimeout(
  () => void boundedShutdown(3, `watchdog exceeded ${watchdogMinutes} minutes`),
  watchdogMinutes * 60_000,
).unref();
process.once('SIGINT', () => void boundedShutdown(130, 'received SIGINT'));
process.once('SIGTERM', () => void boundedShutdown(143, 'received SIGTERM'));

try {
  if (command === 'run') await runCommand();
  else if (command === 'calibrate') await calibrateCommand();
  else if (command === 'report') reportCommand();
  else printHelp();
} catch (error) {
  if (!process.exitCode) process.exitCode = 1;
  if (!String(error?.message ?? '').startsWith('--')) {
    console.error(`[hitch] failed: ${error?.stack ?? error}`);
    console.error(LOG_PATHS.map((entry) => readTail(entry, 16)).join('\n\n'));
  }
}
