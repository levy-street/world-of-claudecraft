// Production CPU watcher for eastbrook-game.
//
// Default: poll through minivac every 30 seconds. A confirmed CPU breach
// collects protected logs and runtime context plus a V8 .cpuprofile. The watcher
// never restarts the server, publishes the inspector, or reads container secrets.
//
//   node scripts/prod_cpu_monitor.mjs --once --dry-run
//   node scripts/prod_cpu_monitor.mjs
//
// Optional game tick capture: point WOC_OPS_TOKEN_FILE at a mode-0600 file
// containing an existing 64-hex bearer with ops.perf permission.

import { chmod, lstat, mkdir, readFile, rename, unlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  markCaptureDirectory,
  prepareOutputDirectory,
  privateAtomicWrite,
  privateWrite,
  pruneCaptures,
  writeChecksums,
} from './prod_cpu_monitor_artifacts.mjs';
import {
  adminRequestCommand,
  bundleHashCommand,
  containerIdentityCommand,
  containerIdentityMatchesOwner,
  cpuSampleCommand,
  duringStatsCommand,
  gameProcessCommand,
  hostContextCommand,
  inspectorProbeCommand,
  logsCommand,
  oneStatsCommand,
  processContextCommand,
  profileCommand,
  safeInspectCommand,
} from './prod_cpu_monitor_commands.mjs';
import {
  buildSshArgs,
  classifyIncidentEvidence,
  errorMessage,
  INITIAL_INCIDENT_STATE,
  launchCaptureWork,
  parseMonitorOptions,
  pollOnce,
  runPollingLoop,
} from './prod_cpu_monitor_core.mjs';
import { acquireRemoteCaptureLock, runProcess } from './prod_cpu_monitor_process.mjs';

const HELP = `Usage: node scripts/prod_cpu_monitor.mjs [options]

Options:
  --once                         Poll once and exit
  --dry-run                      Never profile, even if CPU is high
  --host NAME                    SSH target (default: world-of-claudecraft-prod)
  --jump-host NAME               SSH jump host (default: minivac)
  --direct                       SSH directly from an always-on ops host
  --container NAME               Docker container (default: eastbrook-game)
  --threshold PERCENT            Trigger threshold (default: 90)
  --interval-seconds N           Poll start-to-start interval (default: 30)
  --profile-seconds N            V8 profile duration (default: 20)
  --profile-sample-micros N      V8 sample interval (default: 4000)
  --out-dir ABSOLUTE_PATH        Private durable artifact directory
  --ops-token-file PATH          Existing 0600 ops.perf bearer file
  --help                         Show this help
`;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const INSPECTOR_OWNER_FILE = 'inspector-owner.json';

function runSsh(options, remoteCommand, runOptions) {
  return runProcess('ssh', buildSshArgs(options, remoteCommand), {
    ...runOptions,
    signal: options.captureSignal ?? runOptions?.signal,
  });
}

async function readRemoteCpu(options) {
  const timeoutMs = 20_000 + options.sampleCount * (options.sampleSpacingSeconds + 5) * 1_000;
  return (await runSsh(options, cpuSampleCommand(options), { timeoutMs })).stdout;
}

function captureId(date = new Date()) {
  return `capture-${date.toISOString().replace(/[-:.]/g, '')}`;
}

async function collectRemoteArtifact(
  options,
  captureDir,
  filename,
  command,
  timeoutMs = 30_000,
  maxStdoutBytes = 32 * 1024 * 1024,
) {
  const output = path.join(captureDir, filename);
  try {
    await runSsh(options, command, { stdoutFile: output, timeoutMs, maxStdoutBytes });
    return null;
  } catch (error) {
    await privateWrite(`${output}.error.txt`, `${errorMessage(error)}\n`);
    return `${filename}: ${errorMessage(error)}`;
  }
}

async function resolveGamePid(options, signal, expectedPid = null) {
  const result = await runSsh(options, gameProcessCommand(options, signal, expectedPid), {
    timeoutMs: 30_000,
  });
  const pid = Number(result.stdout.trim());
  if (!Number.isInteger(pid) || pid <= 0)
    throw new Error('game PID resolver returned invalid output');
  return pid;
}

async function readContainerIdentity(options) {
  const result = await runSsh(options, containerIdentityCommand(options), { timeoutMs: 30_000 });
  const identity = JSON.parse(result.stdout);
  if (
    !/^[a-f0-9]{64}$/.test(identity?.containerId) ||
    typeof identity?.containerStartedAt !== 'string' ||
    identity.containerStartedAt.length === 0
  ) {
    throw new Error('container identity returned invalid output');
  }
  return {
    containerId: identity.containerId,
    containerStartedAt: identity.containerStartedAt,
  };
}

export function inspectorCleanupOptions(options) {
  const { captureSignal: _captureSignal, ...cleanupOptions } = options;
  return cleanupOptions;
}

async function inspectorIsOpen(options) {
  const result = await runSsh(options, inspectorProbeCommand(options), { timeoutMs: 30_000 });
  const status = result.stdout.trim();
  if (status !== 'open' && status !== 'closed') {
    throw new Error(`inspector probe returned ${JSON.stringify(status)}`);
  }
  return status === 'open';
}

async function ensureInspectorClosed(options) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!(await inspectorIsOpen(options))) return;
    await delay(500);
  }
  throw new Error('inspector remained open after CPU profiling');
}

async function cleanupOwnedInspectorUnlocked(options) {
  const ownerPath = path.join(options.outDir, INSPECTOR_OWNER_FILE);
  let owner;
  try {
    owner = JSON.parse(await readFile(ownerPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  if (owner.targetHost !== options.targetHost || owner.container !== options.container) {
    throw new Error('invalid inspector ownership marker');
  }
  const identity = await readContainerIdentity(options);
  if (!containerIdentityMatchesOwner(owner, identity)) {
    await unlink(ownerPath);
    return;
  }
  const gamePid = await resolveGamePid(options, false);
  if (owner.gamePid !== gamePid) {
    await unlink(ownerPath);
    return;
  }
  if (await inspectorIsOpen(options)) {
    await runSsh(options, profileCommand({ ...options, profileMs: 0 }, gamePid), {
      timeoutMs: 45_000,
    });
  }
  await ensureInspectorClosed(options);
  await unlink(ownerPath);
}

async function cleanupOwnedInspector(options) {
  try {
    await lstat(path.join(options.outDir, INSPECTOR_OWNER_FILE));
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  const lock = await acquireRemoteCaptureLock(options);
  const abortController = new AbortController();
  const cleanup = cleanupOwnedInspectorUnlocked({
    ...options,
    captureSignal: abortController.signal,
  });
  try {
    await Promise.race([cleanup, lock.lost]);
  } finally {
    abortController.abort(new Error('inspector cleanup lock released'));
    await Promise.allSettled([cleanup, lock.release()]);
  }
}

export async function loadOpsToken(tokenFile) {
  if (!tokenFile) return null;
  const info = await lstat(tokenFile);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error('ops token path is not a real regular file');
  }
  if (process.getuid?.() !== info.uid)
    throw new Error('ops token file must be owned by the monitor');
  if ((info.mode & 0o077) !== 0) throw new Error('ops token file must have mode 0600');
  const token = (await readFile(tokenFile, 'utf8')).trim();
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new Error('ops token must be 64 lowercase hex characters');
  return token;
}

function responseData(raw) {
  const envelope = JSON.parse(raw);
  if (envelope?.success !== true || !envelope.data) {
    throw new Error(
      `admin API rejected the request: ${String(envelope?.error ?? 'invalid response')}`,
    );
  }
  return envelope.data;
}

async function adminRequest(options, token, method, endpoint, body) {
  return (
    await runSsh(options, adminRequestCommand(method, endpoint, body), {
      input: `${token}\n`,
      timeoutMs: 35_000,
    })
  ).stdout;
}

async function startTickCapture(options, captureDir, token) {
  if (!token) return { started: false, reason: 'no-ops-token', captureId: null };
  const beforeRaw = await adminRequest(options, token, 'GET', '/admin/api/perf/tick');
  await privateWrite(path.join(captureDir, 'tick-status-before.json'), `${beforeRaw.trim()}\n`);
  if (responseData(beforeRaw).capturing) {
    return { started: false, reason: 'capture-already-running', captureId: null };
  }
  const startRaw = await adminRequest(options, token, 'POST', '/admin/api/perf/tick/capture', {
    durationMs: options.tickCaptureMs,
  });
  const started = responseData(startRaw);
  const captureId = started.captureId;
  if (
    typeof captureId !== 'string' ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(captureId)
  ) {
    throw new Error('tick profiler returned an invalid capture id');
  }
  await privateWrite(path.join(captureDir, 'tick-capture-start.json'), `${startRaw.trim()}\n`);
  return { started: true, reason: 'started', captureId };
}

async function awaitTickCapture(options, captureDir, token, tickStart, sleep) {
  if (!token || !tickStart.started) return tickStart.reason;
  const deadline = Date.now() + options.tickTimeoutMs;
  while (Date.now() < deadline) {
    const raw = await adminRequest(options, token, 'GET', '/admin/api/perf/tick');
    const status = responseData(raw);
    if (!status.capturing) {
      if (status.last?.captureId !== tickStart.captureId) {
        throw new Error('tick profiler returned a stale capture');
      }
      await privateWrite(path.join(captureDir, 'tick-capture-result.json'), `${raw.trim()}\n`);
      return 'complete';
    }
    await sleep(5_000);
  }
  throw new Error(`tick profiler did not finish within ${options.tickTimeoutMs}ms`);
}

async function writePerfLogExcerpt(captureDir) {
  try {
    const logs = await readFile(path.join(captureDir, 'game.log'), 'utf8');
    const lines = logs.split(/\r?\n/).filter((line) => /\[perf(?:\.sim)?\]/.test(line));
    await privateWrite(path.join(captureDir, 'perf.log'), `${lines.join('\n')}\n`);
    return null;
  } catch (error) {
    return `perf log excerpt: ${errorMessage(error)}`;
  }
}

function appendError(errors, value) {
  return value ? [...errors, value] : errors;
}

async function validateCpuProfile(captureDir) {
  const profile = JSON.parse(await readFile(path.join(captureDir, 'cpu.cpuprofile'), 'utf8'));
  if (!Array.isArray(profile.nodes) || profile.nodes.length === 0) {
    throw new Error('CPU profile has no call-tree nodes');
  }
  if (!Array.isArray(profile.samples) || profile.samples.length === 0) {
    throw new Error('CPU profile has no samples');
  }
  return {
    nodeCount: profile.nodes.length,
    sampleCount: profile.samples.length,
    startTime: profile.startTime ?? null,
    endTime: profile.endTime ?? null,
  };
}

async function createIncidentCaptureLocked(options, trigger, { sleep }) {
  const captureDir = path.join(options.outDir, captureId(new Date(trigger.observedAt)));
  await mkdir(captureDir, { recursive: false, mode: 0o700 });
  await chmod(captureDir, 0o700);
  await markCaptureDirectory(captureDir);
  let errors = [];
  const metadata = {
    schemaVersion: 1,
    targetHost: options.targetHost,
    jumpHost: options.jumpHost,
    container: options.container,
    threshold: options.threshold,
    trigger,
    profileMs: options.profileMs,
    profileSampleIntervalUs: options.profileSampleIntervalUs,
    tickCaptureRequested: Boolean(options.opsTokenFile),
    startedAt: new Date().toISOString(),
    complete: false,
  };
  await privateAtomicWrite(
    path.join(captureDir, 'metadata.json'),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
  await privateWrite(
    path.join(captureDir, 'trigger-samples.txt'),
    `${trigger.samples.join('%\n')}%\n`,
  );

  let releaseSecondaryEvidence;
  let secondaryReleased = false;
  const secondaryReady = new Promise((resolve) => {
    releaseSecondaryEvidence = resolve;
  });
  const releaseSecondary = () => {
    if (secondaryReleased) return;
    secondaryReleased = true;
    releaseSecondaryEvidence();
  };
  const work = launchCaptureWork({
    profile: async () => {
      let profileError = null;
      let inspectorInitiallyOpen = null;
      let inspectorOwned = false;
      let inspectorCleanupError = null;
      let gamePid = null;
      let profileStartedAt = null;
      let profileFinishedAt = null;
      let profileErrors = [];
      try {
        const containerIdentity = await readContainerIdentity(options);
        gamePid = await resolveGamePid(options, false);
        const confirmedContainerIdentity = await readContainerIdentity(options);
        if (!containerIdentityMatchesOwner(containerIdentity, confirmedContainerIdentity)) {
          throw new Error('container restarted while preparing CPU profile');
        }
        inspectorInitiallyOpen = await inspectorIsOpen(options);
        if (inspectorInitiallyOpen) {
          throw new Error('inspector was already open; refusing to disrupt another operator');
        }
        await privateAtomicWrite(
          path.join(options.outDir, INSPECTOR_OWNER_FILE),
          `${JSON.stringify({
            targetHost: options.targetHost,
            container: options.container,
            ...containerIdentity,
            gamePid,
            createdAt: new Date().toISOString(),
          })}\n`,
        );
        inspectorOwned = true;
        gamePid = await resolveGamePid(options, true, gamePid);
        await sleep(750);
        let profileStartAcknowledged = false;
        let profileStopAcknowledged = false;
        let profileStartupGateTimedOut = false;
        const startupGateTimeout = setTimeout(() => {
          profileStartupGateTimedOut = true;
          releaseSecondary();
        }, 30_000);
        startupGateTimeout.unref();
        const profileProcess = runSsh(options, profileCommand(options, gamePid), {
          stdoutFile: path.join(captureDir, 'cpu.cpuprofile'),
          timeoutMs: options.profileMs + 45_000,
          maxStdoutBytes: 128 * 1024 * 1024,
          onStderrLine: (line) => {
            if (line === 'WOC_PROFILE_STARTED') {
              profileStartAcknowledged = true;
              profileStartedAt ??= Date.now();
              clearTimeout(startupGateTimeout);
              releaseSecondary();
            } else if (line === 'WOC_PROFILE_STOPPED') {
              profileStopAcknowledged = true;
              profileFinishedAt = Date.now();
            }
          },
        }).finally(() => {
          clearTimeout(startupGateTimeout);
          releaseSecondary();
        });
        const [profileResult, statsResult] = await Promise.allSettled([
          profileProcess,
          secondaryReady.then(() =>
            collectRemoteArtifact(
              options,
              captureDir,
              'stats-during.jsonl',
              duringStatsCommand(options),
              options.profileMs + 60_000,
            ),
          ),
        ]);
        if (profileResult.status === 'rejected') profileError = profileResult.reason;
        if (profileResult.status === 'fulfilled' && !profileStartAcknowledged) {
          profileError = new Error('CPU profiler did not acknowledge start');
        }
        if (profileResult.status === 'fulfilled' && !profileStopAcknowledged) {
          profileErrors = [...profileErrors, 'CPU profiler did not acknowledge stop'];
        }
        if (profileStartupGateTimedOut) {
          profileErrors = [...profileErrors, 'CPU profiler startup gate exceeded 30000ms'];
        }
        if (statsResult.status === 'fulfilled') {
          profileErrors = appendError(profileErrors, statsResult.value);
        } else {
          profileErrors = [...profileErrors, `stats during: ${errorMessage(statsResult.reason)}`];
        }
      } catch (error) {
        profileError = error;
      } finally {
        releaseSecondary();
      }

      if (inspectorOwned) {
        const cleanupOptions = inspectorCleanupOptions(options);
        try {
          const cleanup = cleanupOwnedInspectorUnlocked;
          if (options.captureSignal?.aborted) {
            const cleanupLock = await acquireRemoteCaptureLock(cleanupOptions);
            const cleanupAbortController = new AbortController();
            const guardedCleanup = cleanup({
              ...cleanupOptions,
              captureSignal: cleanupAbortController.signal,
            });
            try {
              await Promise.race([guardedCleanup, cleanupLock.lost]);
            } finally {
              cleanupAbortController.abort(new Error('inspector cleanup lock released'));
              await Promise.allSettled([guardedCleanup, cleanupLock.release()]);
            }
          } else {
            await cleanup(cleanupOptions);
          }
        } catch (error) {
          inspectorCleanupError = error;
          profileErrors = [...profileErrors, `inspector shutdown: ${errorMessage(error)}`];
        }
      }
      return {
        errors: profileErrors,
        inspectorCleanupError,
        inspectorInitiallyOpen,
        profileError,
        profileFinishedAt,
        profileStartedAt,
      };
    },
    tick: async () => {
      let token = null;
      let tickStart = { started: false, reason: 'no-ops-token', captureId: null };
      try {
        token = await loadOpsToken(options.opsTokenFile);
        tickStart = await startTickCapture(options, captureDir, token);
      } catch (error) {
        return {
          errors: [`tick capture start: ${errorMessage(error)}`],
          tickOutcome: 'start-failed',
        };
      }
      try {
        return {
          errors: [],
          tickOutcome: await awaitTickCapture(options, captureDir, token, tickStart, sleep),
        };
      } catch (error) {
        return {
          errors: [`tick capture result: ${errorMessage(error)}`],
          tickOutcome: 'result-failed',
        };
      }
    },
    context: async () =>
      Promise.all([
        collectRemoteArtifact(options, captureDir, 'container.json', safeInspectCommand(options)),
        collectRemoteArtifact(options, captureDir, 'host-before.txt', hostContextCommand(), 45_000),
        collectRemoteArtifact(
          options,
          captureDir,
          'processes-before.txt',
          processContextCommand(options),
        ),
        collectRemoteArtifact(options, captureDir, 'stats-before.json', oneStatsCommand(options)),
        collectRemoteArtifact(options, captureDir, 'bundle.sha256', bundleHashCommand(options)),
      ]),
    secondaryReady,
  });

  const [profileResult, tickResult, preResults] = await Promise.all([
    work.profile,
    work.tick,
    work.context,
  ]);
  for (const result of preResults) errors = appendError(errors, result);
  errors = [...errors, ...profileResult.errors, ...tickResult.errors];

  const postResults = await Promise.all([
    collectRemoteArtifact(
      options,
      captureDir,
      'processes-after.txt',
      processContextCommand(options),
    ),
    collectRemoteArtifact(options, captureDir, 'stats-after.json', oneStatsCommand(options)),
    collectRemoteArtifact(options, captureDir, 'game.log', logsCommand(options), 90_000),
  ]);
  for (const result of postResults) errors = appendError(errors, result);
  const perfLogError = await writePerfLogExcerpt(captureDir);
  errors = appendError(errors, perfLogError);
  if (profileResult.profileError) {
    errors = [...errors, `cpu profile: ${errorMessage(profileResult.profileError)}`];
  }
  let profileSummary = null;
  let profileValidationError = null;
  if (!profileResult.profileError) {
    try {
      profileSummary = await validateCpuProfile(captureDir);
    } catch (error) {
      profileValidationError = error;
      errors = [...errors, `cpu profile validation: ${errorMessage(error)}`];
    }
  }
  const cpuProfileFailed = profileResult.profileError !== null || profileValidationError !== null;
  const auxiliaryEvidenceFailed =
    errors.length > 0 ||
    postResults[2] !== null ||
    perfLogError !== null ||
    (metadata.tickCaptureRequested && tickResult.tickOutcome !== 'complete');
  const evidenceStatus = classifyIncidentEvidence({
    cpuProfileFailed,
    auxiliaryEvidenceFailed,
  });

  const completedMetadata = {
    ...metadata,
    finishedAt: new Date().toISOString(),
    complete: evidenceStatus.complete,
    inspectorInitiallyOpen: profileResult.inspectorInitiallyOpen,
    inspectorCleanupError:
      profileResult.inspectorCleanupError === null
        ? null
        : errorMessage(profileResult.inspectorCleanupError),
    profileFinishedAt:
      profileResult.profileFinishedAt === null
        ? null
        : new Date(profileResult.profileFinishedAt).toISOString(),
    profileStartedAt:
      profileResult.profileStartedAt === null
        ? null
        : new Date(profileResult.profileStartedAt).toISOString(),
    profileStartDelayMs:
      profileResult.profileStartedAt === null
        ? null
        : profileResult.profileStartedAt - trigger.observedAt,
    profileSummary,
    tickCapture: tickResult.tickOutcome,
    errors,
  };
  await privateAtomicWrite(
    path.join(captureDir, 'metadata.json'),
    `${JSON.stringify(completedMetadata, null, 2)}\n`,
  );
  await writeChecksums(captureDir);
  if (evidenceStatus.complete) {
    await privateWrite(path.join(captureDir, 'COMPLETE'), `${completedMetadata.finishedAt}\n`);
  }
  await pruneCaptures(options);
  if (evidenceStatus.fatal) {
    throw new Error(
      `required incident evidence is incomplete; partial evidence is in ${captureDir}`,
    );
  }
  return {
    captureDir,
    degradedErrors: evidenceStatus.complete ? [] : errors,
  };
}

async function createIncidentCapture(options, trigger, dependencies) {
  const lock = await acquireRemoteCaptureLock(options);
  const abortController = new AbortController();
  const capture = createIncidentCaptureLocked(
    { ...options, captureSignal: abortController.signal },
    trigger,
    dependencies,
  );
  try {
    return await Promise.race([capture, lock.lost]);
  } finally {
    abortController.abort(new Error('production capture lock released'));
    await Promise.allSettled([capture, lock.release()]);
  }
}

async function readIncidentState(outDir) {
  try {
    const parsed = JSON.parse(await readFile(path.join(outDir, 'state.json'), 'utf8'));
    if (
      typeof parsed.incidentActive === 'boolean' &&
      Number.isInteger(parsed.healthyPolls) &&
      (parsed.lastAttemptAt === null ||
        parsed.lastAttemptAt === undefined ||
        Number.isFinite(parsed.lastAttemptAt)) &&
      (parsed.lastCaptureAt === null || Number.isFinite(parsed.lastCaptureAt)) &&
      (parsed.lastAttemptFailed === undefined || typeof parsed.lastAttemptFailed === 'boolean')
    ) {
      return {
        incidentActive: parsed.incidentActive,
        healthyPolls: parsed.healthyPolls,
        lastAttemptAt: parsed.lastAttemptAt ?? parsed.lastCaptureAt,
        lastCaptureAt: parsed.lastCaptureAt,
        lastAttemptFailed: parsed.lastAttemptFailed ?? false,
      };
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return { ...INITIAL_INCIDENT_STATE };
}

async function writeIncidentState(outDir, state) {
  const finalPath = path.join(outDir, 'state.json');
  const temporaryPath = `${finalPath}.${process.pid}.tmp`;
  await privateWrite(temporaryPath, `${JSON.stringify(state, null, 2)}\n`);
  await rename(temporaryPath, finalPath);
  await chmod(finalPath, 0o600);
}

async function acquireLocalLock() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', (error) => {
      if (error?.code === 'EADDRINUSE')
        reject(new Error('production CPU monitor is already running'));
      else reject(error);
    });
    server.listen({ host: '127.0.0.1', port: 43951, exclusive: true }, resolve);
  });
  return () => new Promise((resolve) => server.close(resolve));
}

function createStopController(log) {
  let stopped = false;
  let wake = null;
  const stop = (signal) => {
    if (stopped) return;
    stopped = true;
    log(`Stopping after ${signal}`);
    wake?.();
  };
  return {
    isStopped: () => stopped,
    stop,
    sleep: (ms) =>
      new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      }).finally(() => {
        wake = null;
      }),
  };
}

function timestampLog(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

async function main() {
  process.umask(0o077);
  const options = parseMonitorOptions();
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  await prepareOutputDirectory(options.outDir);
  await pruneCaptures(options);
  const releaseLock = await acquireLocalLock();
  const stop = createStopController(timestampLog);
  process.once('SIGINT', () => stop.stop('SIGINT'));
  process.once('SIGTERM', () => stop.stop('SIGTERM'));

  let state = await readIncidentState(options.outDir);
  let lastResult = null;
  const poll = async () => {
    await cleanupOwnedInspector(options);
    lastResult = await pollOnce({
      readCpu: () => readRemoteCpu(options),
      capture: async (trigger) => {
        const result = await createIncidentCapture(options, trigger, { sleep: delay });
        if (result.degradedErrors.length > 0) {
          timestampLog(
            `Capture degraded (${result.degradedErrors.length} auxiliary errors): ${result.captureDir}`,
          );
        }
        return result.captureDir;
      },
      state,
      options,
      log: timestampLog,
    });
    state = lastResult.nextState;
    await writeIncidentState(options.outDir, state);
    await cleanupOwnedInspector(options);
    if (options.once) stop.stop('single poll complete');
  };

  timestampLog(
    `Watching ${options.container} on ${options.targetHost}${options.jumpHost ? ` through ${options.jumpHost}` : ' directly'} every ${options.intervalMs / 1_000}s`,
  );
  try {
    await runPollingLoop({
      poll,
      sleep: stop.sleep,
      intervalMs: options.intervalMs,
      shouldStop: stop.isStopped,
      log: timestampLog,
    });
  } finally {
    await releaseLock();
  }
  if (options.once && ['poll-failed', 'capture-failed'].includes(lastResult?.status)) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(errorMessage(error));
    process.exitCode = 1;
  });
}
