// Pure configuration, threshold, incident-state, and polling helpers for the
// production CPU watcher. Network and filesystem effects stay in the CLI module.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULT_MONITOR_OPTIONS = Object.freeze({
  targetHost: 'world-of-claudecraft-prod',
  jumpHost: 'minivac',
  container: 'eastbrook-game',
  threshold: 90,
  recoveryThreshold: 80,
  intervalMs: 30_000,
  sampleCount: 3,
  requiredHighSamples: 2,
  sampleSpacingSeconds: 2,
  profileMs: 20_000,
  profileSampleIntervalUs: 4_000,
  tickCaptureMs: 30_000,
  tickTimeoutMs: 180_000,
  healthyPollsToRearm: 2,
  recaptureMs: 1_800_000,
  failureRetryMs: 120_000,
  logSince: '20m',
  maxCaptures: 24,
  maxCaptureAgeMs: 30 * 24 * 60 * 60 * 1_000,
  outDir: path.join(repoRoot, 'tmp', 'prod-cpu-watch'),
  opsTokenFile: null,
  once: false,
  dryRun: false,
  help: false,
});

export const INITIAL_INCIDENT_STATE = Object.freeze({
  incidentActive: false,
  healthyPolls: 0,
  lastAttemptAt: null,
  lastCaptureAt: null,
  lastAttemptFailed: false,
});

function optionValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

function finiteNumber(value, name, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return parsed;
}

function integer(value, name, min, max) {
  const parsed = finiteNumber(value, name, min, max);
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be an integer`);
  return parsed;
}

function remoteIdentifier(value, name) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:@-]*$/.test(value)) {
    throw new Error(`${name} contains unsafe characters`);
  }
  return value;
}

export function parseMonitorOptions(argv = process.argv.slice(2), env = process.env) {
  let options = {
    ...DEFAULT_MONITOR_OPTIONS,
    targetHost: env.WOC_CPU_MONITOR_HOST ?? DEFAULT_MONITOR_OPTIONS.targetHost,
    jumpHost: env.WOC_CPU_MONITOR_JUMP_HOST ?? DEFAULT_MONITOR_OPTIONS.jumpHost,
    container: env.WOC_CPU_MONITOR_CONTAINER ?? DEFAULT_MONITOR_OPTIONS.container,
    outDir: env.WOC_CPU_MONITOR_OUT_DIR ?? DEFAULT_MONITOR_OPTIONS.outDir,
    opsTokenFile: env.WOC_OPS_TOKEN_FILE ?? DEFAULT_MONITOR_OPTIONS.opsTokenFile,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--once') options = { ...options, once: true };
    else if (arg === '--dry-run') options = { ...options, dryRun: true };
    else if (arg === '--help') options = { ...options, help: true };
    else if (arg === '--direct') options = { ...options, jumpHost: null };
    else if (arg === '--host') options = { ...options, targetHost: optionValue(argv, i++, arg) };
    else if (arg === '--jump-host') options = { ...options, jumpHost: optionValue(argv, i++, arg) };
    else if (arg === '--container')
      options = { ...options, container: optionValue(argv, i++, arg) };
    else if (arg === '--threshold')
      options = {
        ...options,
        threshold: finiteNumber(optionValue(argv, i++, arg), arg, 0.01, 10_000),
      };
    else if (arg === '--interval-seconds')
      options = {
        ...options,
        intervalMs: integer(optionValue(argv, i++, arg), arg, 10, 86_400) * 1_000,
      };
    else if (arg === '--profile-seconds')
      options = {
        ...options,
        profileMs: integer(optionValue(argv, i++, arg), arg, 1, 300) * 1_000,
      };
    else if (arg === '--profile-sample-micros')
      options = {
        ...options,
        profileSampleIntervalUs: integer(optionValue(argv, i++, arg), arg, 100, 100_000),
      };
    else if (arg === '--out-dir') {
      const value = optionValue(argv, i++, arg);
      if (!path.isAbsolute(value)) throw new Error(`${arg} must be an absolute path`);
      options = { ...options, outDir: path.normalize(value) };
    } else if (arg === '--ops-token-file')
      options = { ...options, opsTokenFile: path.resolve(optionValue(argv, i++, arg)) };
    else throw new Error(`unknown option: ${arg}`);
  }

  const targetHost = remoteIdentifier(options.targetHost, 'host');
  const jumpHost =
    options.jumpHost === null ? null : remoteIdentifier(options.jumpHost, 'jump host');
  const container = remoteIdentifier(options.container, 'container');
  if (!path.isAbsolute(options.outDir))
    throw new Error('monitor output directory must be an absolute path');
  return Object.freeze({ ...options, targetHost, jumpHost, container });
}

export function parseCpuSamples(raw) {
  const text = String(raw ?? '').trim();
  if (!text) throw new Error('docker stats returned no CPU samples');
  return text.split(/\r?\n/).map((line) => {
    const match = /^\s*([0-9]+(?:\.[0-9]+)?)%\s*$/.exec(line);
    if (!match) throw new Error(`invalid Docker CPU sample: ${JSON.stringify(line)}`);
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value < 0) throw new Error('invalid Docker CPU percentage');
    return value;
  });
}

export function shouldTriggerProfile(samples, threshold, requiredHighSamples) {
  return samples.filter((sample) => sample > threshold).length >= requiredHighSamples;
}

function median(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

export function planIncidentTransition(
  state,
  {
    high,
    representativeCpu,
    now,
    recoveryThreshold,
    healthyPollsToRearm,
    recaptureMs,
    failureRetryMs,
  },
) {
  if (high) {
    const lastAttemptAt = state.lastAttemptAt ?? state.lastCaptureAt;
    const retryAfterMs = state.lastAttemptFailed ? failureRetryMs : recaptureMs;
    const recaptureDue =
      state.incidentActive && lastAttemptAt !== null && now - lastAttemptAt >= retryAfterMs;
    const capture = !state.incidentActive || recaptureDue;
    return {
      capture,
      reason: state.lastAttemptFailed
        ? 'failed-capture-retry'
        : state.incidentActive
          ? 'sustained-high-cpu'
          : 'new-high-cpu-incident',
      nextState: capture
        ? { ...state, incidentActive: true, healthyPolls: 0, lastAttemptAt: now }
        : { ...state, healthyPolls: 0 },
    };
  }

  if (!state.incidentActive) {
    return { capture: false, reason: 'healthy', nextState: { ...state, healthyPolls: 0 } };
  }

  const healthyPolls = representativeCpu < recoveryThreshold ? state.healthyPolls + 1 : 0;
  if (healthyPolls >= healthyPollsToRearm) {
    return {
      capture: false,
      reason: 'incident-rearmed',
      nextState: {
        incidentActive: false,
        healthyPolls: 0,
        lastAttemptAt: null,
        lastCaptureAt: null,
        lastAttemptFailed: false,
      },
    };
  }
  return {
    capture: false,
    reason: 'incident-cooling',
    nextState: { ...state, healthyPolls },
  };
}

export async function pollOnce({ readCpu, capture, state, options, now = Date.now, log }) {
  let samples;
  try {
    samples = parseCpuSamples(await readCpu());
    if (samples.length !== options.sampleCount) {
      throw new Error(`expected ${options.sampleCount} CPU samples, received ${samples.length}`);
    }
  } catch (error) {
    log(`CPU poll failed: ${errorMessage(error)}`);
    return { status: 'poll-failed', nextState: state, error };
  }

  const observedAt = now();
  const representativeCpu = median(samples);
  const high = shouldTriggerProfile(samples, options.threshold, options.requiredHighSamples);
  const transition = planIncidentTransition(state, {
    high,
    representativeCpu,
    now: observedAt,
    recoveryThreshold: options.recoveryThreshold,
    healthyPollsToRearm: options.healthyPollsToRearm,
    recaptureMs: options.recaptureMs,
    failureRetryMs: options.failureRetryMs,
  });
  log(
    `CPU samples=${samples.join(',')}% median=${representativeCpu}% threshold=>${options.threshold}% status=${transition.reason}`,
  );

  if (!transition.capture) {
    return { status: high ? 'high-suppressed' : 'healthy', nextState: transition.nextState };
  }
  if (options.dryRun) {
    log('Dry run: profile capture would start now');
    return { status: 'would-capture', nextState: state };
  }

  try {
    const captureDir = await capture({
      samples,
      representativeCpu,
      observedAt,
      reason: transition.reason,
    });
    log(`Capture complete: ${captureDir}`);
    return {
      status: 'captured',
      nextState: {
        ...transition.nextState,
        lastCaptureAt: observedAt,
        lastAttemptFailed: false,
      },
      captureDir,
    };
  } catch (error) {
    log(`Capture failed and will be retried: ${errorMessage(error)}`);
    return {
      status: 'capture-failed',
      nextState: { ...transition.nextState, lastAttemptAt: now(), lastAttemptFailed: true },
      error,
    };
  }
}

// A valid CPU profile is the irreplaceable incident artifact. Supporting context
// may be degraded without re-running a profiler on an already saturated process.
export function classifyIncidentEvidence({ cpuProfileFailed, auxiliaryEvidenceFailed }) {
  return {
    complete: !cpuProfileFailed && !auxiliaryEvidenceFailed,
    fatal: cpuProfileFailed,
  };
}

export async function runPollingLoop({
  poll,
  sleep,
  now = Date.now,
  intervalMs,
  minimumDelayMs = 30_000,
  shouldStop,
  log,
}) {
  while (!shouldStop()) {
    const startedAt = now();
    try {
      await poll();
    } catch (error) {
      log(`Polling cycle failed: ${errorMessage(error)}`);
    }
    if (shouldStop()) break;
    await sleep(Math.max(minimumDelayMs, intervalMs - (now() - startedAt)));
  }
}

// Launch hot incident evidence before slower best-effort context. Returning the
// three promises separately lets the caller classify required vs optional failures
// without one rejected task cancelling the others.
export function launchCaptureWork({ profile, tick, context, secondaryReady = Promise.resolve() }) {
  return {
    profile: profile(),
    tick: secondaryReady.then(tick),
    context: secondaryReady.then(context),
  };
}

export function buildSshArgs(options, remoteCommand) {
  const args = [
    '-T',
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=12',
    '-o',
    'ServerAliveInterval=15',
    '-o',
    'ServerAliveCountMax=2',
  ];
  if (options.jumpHost) args.push('-J', options.jumpHost);
  args.push(options.targetHost, remoteCommand);
  return args;
}

export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
