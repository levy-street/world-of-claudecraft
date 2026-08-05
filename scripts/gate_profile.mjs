// Local gate measurement harness for docs/local-gate-perf Phase 1.
// Times the same step list as scripts/gate.mjs, prints machine facts, and can
// rank top-N slowest vitest files via the JSON reporter. Does NOT change gate
// worker defaults, vitest pool, or package manager: measurement only.
//
// Pure parse/rank/format logic lives in scripts/lib/gate_profile.mjs and is
// pinned by tests/gate_profile.test.ts. This file is the thin orchestrator.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildGateProfileSteps,
  collectMachineFacts,
  formatMachineFacts,
  formatSlowFiles,
  formatStepTimings,
  helpText,
  parseGateProfileArgs,
  rankSlowestFiles,
} from './lib/gate_profile.mjs';
import { computeGateWorkers, resolveGateWorkerTierCap } from './lib/gate_workers.mjs';
import {
  formatInstallSyncFailure,
  parseInstallProblems,
  shouldCheckInstallSync,
} from './lib/npm_install_sync.mjs';
import { FFMPEG_PATH, FFPROBE_PATH } from './sfx/ffmpeg_paths.mjs';

const shell = process.platform === 'win32';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let args;
try {
  args = parseGateProfileArgs(process.argv.slice(2));
} catch (err) {
  console.error(`[gate_profile] ${err.message}`);
  process.exit(2);
}

if (args.help) {
  process.stdout.write(helpText());
  process.exit(0);
}

const facts = collectMachineFacts(os, process, process.env);
const workers =
  args.workersOverride ??
  computeGateWorkers({
    cpuCount: facts.cpuCount,
    freeMemBytes: facts.freeMemBytes,
    envOverride: process.env.GATE_MAX_WORKERS,
    tierCap: resolveGateWorkerTierCap(process.env.GATE_WORKER_TIER),
  });

const gitSha = runCapture('git', ['rev-parse', 'HEAD']) ?? 'unknown';
const gitShaShort = gitSha === 'unknown' ? 'unknown' : gitSha.slice(0, 10);
const npmVersion = runCapture('npm', ['--version']) ?? 'unknown';
const dateUtc = new Date().toISOString();

console.log(
  formatMachineFacts(facts, {
    workers,
    gitSha: gitShaShort,
    npmVersion,
    dateUtc,
  }),
);
console.log('');

if (args.factsOnly && !args.vitestSlow && !args.fromJson) {
  writeJsonIfRequested({
    kind: 'facts',
    dateUtc,
    gitSha,
    npmVersion,
    facts,
    workers,
  });
  process.exit(0);
}

if (args.fromJson) {
  const report = readJsonFile(args.fromJson);
  const ranked = rankSlowestFiles(report, args.top);
  console.log(`Slowest vitest files (top ${args.top}) from ${args.fromJson}`);
  console.log(formatSlowFiles(ranked));
  writeJsonIfRequested({
    kind: 'from-json',
    dateUtc,
    gitSha,
    npmVersion,
    facts,
    workers,
    fromJson: args.fromJson,
    slowFiles: ranked,
  });
  process.exit(0);
}

/** @type {import('./lib/gate_profile.mjs').TimedStepResult[]} */
const timed = [];
/** @type {import('./lib/gate_profile.mjs').RankedFileDuration[] | null} */
let slowFiles = null;
let failed = false;

if (args.steps) {
  // Mirror gate.mjs preflights so a profile run is comparable to a real gate.
  if (!args.dryRun) {
    const dep = timePreflight('dependency sync', runDependencySync);
    timed.push(dep);
    if (dep.status === 'fail') {
      failed = true;
      if (!args.continueOnError) finishAndExit(1, timed, null);
    }
    const audio = timePreflight('ffmpeg/ffprobe probe', runAudioToolProbe);
    timed.push(audio);
    if (audio.status === 'fail') {
      failed = true;
      if (!args.continueOnError) finishAndExit(1, timed, null);
    }
  } else {
    timed.push(
      { name: 'dependency sync', seconds: 0, status: 'skipped' },
      { name: 'ffmpeg/ffprobe probe', seconds: 0, status: 'skipped' },
    );
  }

  const steps = buildGateProfileSteps(workers, {
    skipBrowser: args.skipBrowser,
    skipBuilds: args.skipBuilds,
    skipVitest: args.skipVitest,
    skipTypes: args.skipTypes,
  });

  if (args.dryRun) {
    console.log('Dry-run planned steps:');
    for (const s of steps) {
      console.log(`  ${s.name}: ${s.cmd} ${s.args.join(' ')}`);
    }
    for (const s of steps) {
      timed.push({ name: s.name, seconds: 0, status: 'skipped' });
    }
  } else {
    const branch = runCapture('git', ['branch', '--show-current']) ?? '';
    const releaseTier = branch.startsWith('release/');
    const env = releaseTier ? { ...process.env, I18N_RELEASE_TIER: '1' } : process.env;
    if (releaseTier) {
      console.log(
        `[gate_profile] release branch "${branch}": I18N_RELEASE_TIER=1 (same as gate.mjs)`,
      );
    }

    // When profiling slow files alongside timed steps, attach the JSON reporter to
    // the existing vitest step so the full suite is not run twice.
    const vitestJsonPath = path.join(ROOT, 'tmp', 'gate-profile-vitest.json');
    const vitestSlowViaSteps = args.vitestSlow && !args.skipVitest;
    if (vitestSlowViaSteps) {
      mkdirSync(path.dirname(vitestJsonPath), { recursive: true });
      for (const step of steps) {
        if (step.name === 'vitest (full suite)') {
          step.args.push('--reporter=default', '--reporter=json', `--outputFile=${vitestJsonPath}`);
        }
      }
    }

    for (const step of steps) {
      console.log(`\n[gate_profile] ${step.name}: ${step.cmd} ${step.args.join(' ')}`);
      const started = performance.now();
      const stepEnv = step.env ? { ...env, ...step.env } : env;
      const res = spawnSync(step.cmd, step.args, {
        stdio: 'inherit',
        env: stepEnv,
        shell,
        cwd: ROOT,
      });
      const seconds = (performance.now() - started) / 1000;
      const ok = res.status === 0;
      timed.push({
        name: step.name,
        seconds: round1(seconds),
        status: ok ? 'ok' : 'fail',
        exitCode: res.status ?? null,
      });
      console.log(`[gate_profile] ${step.name}: ${ok ? 'ok' : 'FAIL'} in ${round1(seconds)}s`);

      if (vitestSlowViaSteps && step.name === 'vitest (full suite)') {
        try {
          const report = readJsonFile(vitestJsonPath);
          slowFiles = rankSlowestFiles(report, args.top);
          console.log(`\nSlowest vitest files (top ${args.top})`);
          console.log(formatSlowFiles(slowFiles));
        } catch (err) {
          console.error(`[gate_profile] could not rank slow files: ${err.message}`);
        }
      }

      if (!ok) {
        failed = true;
        if (!args.continueOnError) {
          finishAndExit(res.status ?? 1, timed, slowFiles);
        }
      }
    }
  }
}

// Standalone vitest-slow path when steps are off (or vitest was skipped during steps).
if (args.vitestSlow && (!args.steps || args.skipVitest)) {
  const outPath = path.join(ROOT, 'tmp', 'gate-profile-vitest.json');
  mkdirSync(path.dirname(outPath), { recursive: true });
  const vitestArgs = [
    'test',
    '--',
    `--maxWorkers=${workers}`,
    '--reporter=default',
    '--reporter=json',
    `--outputFile=${outPath}`,
  ];
  if (args.dryRun) {
    console.log(`\n[gate_profile] dry-run vitest-slow: npm ${vitestArgs.join(' ')}`);
  } else {
    console.log(`\n[gate_profile] vitest-slow: npm ${vitestArgs.join(' ')}`);
    const started = performance.now();
    const res = spawnSync('npm', vitestArgs, {
      stdio: 'inherit',
      env: process.env,
      shell,
      cwd: ROOT,
    });
    const seconds = (performance.now() - started) / 1000;
    timed.push({
      name: 'vitest (json reporter / slow-file capture)',
      seconds: round1(seconds),
      status: res.status === 0 ? 'ok' : 'fail',
      exitCode: res.status ?? null,
    });
    try {
      const report = readJsonFile(outPath);
      slowFiles = rankSlowestFiles(report, args.top);
      console.log(`\nSlowest vitest files (top ${args.top})`);
      console.log(formatSlowFiles(slowFiles));
    } catch (err) {
      console.error(`[gate_profile] could not rank slow files: ${err.message}`);
    }
    if (res.status !== 0) failed = true;
  }
}

finishAndExit(failed ? 1 : 0, timed, slowFiles);

// --- helpers ---

function finishAndExit(code, stepResults, ranked) {
  if (stepResults.length > 0) {
    console.log('');
    console.log(formatStepTimings(stepResults));
  }
  writeJsonIfRequested({
    kind: 'profile',
    dateUtc,
    gitSha,
    npmVersion,
    facts,
    workers,
    steps: stepResults,
    slowFiles: ranked,
    ok: code === 0,
  });
  process.exit(code);
}

function writeJsonIfRequested(payload) {
  if (!args.jsonOut) return;
  const abs = path.isAbsolute(args.jsonOut) ? args.jsonOut : path.join(ROOT, args.jsonOut);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`\n[gate_profile] wrote ${abs}`);
}

function timePreflight(name, fn) {
  const started = performance.now();
  const result = fn();
  const seconds = round1((performance.now() - started) / 1000);
  return {
    name,
    seconds,
    status: result.ok ? 'ok' : 'fail',
    exitCode: result.ok ? 0 : (result.exitCode ?? 1),
  };
}

function runDependencySync() {
  if (process.env.WOC_SKIP_DEP_SYNC === '1') {
    console.log('[gate_profile] dependency sync skipped (WOC_SKIP_DEP_SYNC=1)');
    return { ok: true };
  }
  const npmLs = spawnSync('npm', ['ls', '--depth=0', '--json'], {
    encoding: 'utf8',
    shell,
    cwd: ROOT,
  });
  if (!shouldCheckInstallSync(npmLs)) {
    console.error('[gate_profile] WARN: dependency sync check skipped (spawn issue)');
    return { ok: true };
  }
  try {
    const problems = parseInstallProblems(npmLs.stdout);
    if (problems.length > 0) {
      console.error(
        `[gate_profile] FAIL at "dependency sync"\n${formatInstallSyncFailure(problems)}`,
      );
      return { ok: false, exitCode: 1 };
    }
  } catch (err) {
    console.error(`[gate_profile] WARN: dependency sync check skipped: ${err.message}`);
  }
  return { ok: true };
}

function runAudioToolProbe() {
  const missing = [
    ['ffmpeg', FFMPEG_PATH],
    ['ffprobe', FFPROBE_PATH],
  ].filter(([, toolPath]) => {
    const probe = spawnSync(toolPath, ['-version'], { stdio: 'ignore', shell });
    return probe.error !== undefined || probe.status !== 0;
  });
  if (missing.length > 0) {
    console.error(
      `[gate_profile] missing required SFX audio tooling: ${missing.map(([n]) => n).join(', ')}`,
    );
    return { ok: false, exitCode: 1 };
  }
  return { ok: true };
}

function runCapture(cmd, cmdArgs) {
  const res = spawnSync(cmd, cmdArgs, { encoding: 'utf8', shell, cwd: ROOT });
  if (res.status !== 0) return null;
  return res.stdout?.trim() ?? null;
}

function readJsonFile(filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
  return JSON.parse(readFileSync(abs, 'utf8'));
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
