import { spawn } from 'node:child_process';
import { access, chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { inspectorCleanupOptions, loadOpsToken } from '../scripts/prod_cpu_monitor.mjs';
import {
  markCaptureDirectory,
  prepareOutputDirectory,
  pruneCaptures,
} from '../scripts/prod_cpu_monitor_artifacts.mjs';
import {
  containerIdentityCommand,
  containerIdentityMatchesOwner,
  gameProcessCommand,
  profileCommand,
} from '../scripts/prod_cpu_monitor_commands.mjs';
import { remoteLockCommand, runProcess } from '../scripts/prod_cpu_monitor_process.mjs';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function inspectorOpen(expected, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const open = await fetch('http://127.0.0.1:9229/json/list', {
      signal: AbortSignal.timeout(250),
    })
      .then((response) => response.ok)
      .catch(() => false);
    if (open === expected) return;
    await wait(50);
  }
  throw new Error(`inspector did not become ${expected ? 'open' : 'closed'}`);
}

async function runProfileClient(env) {
  const child = spawn(process.execPath, ['scripts/prod_cpu_profile_client.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  return {
    code,
    stdout: Buffer.concat(stdout).toString('utf8'),
    stderr: Buffer.concat(stderr).toString('utf8'),
  };
}

import {
  buildSshArgs,
  classifyIncidentEvidence,
  DEFAULT_MONITOR_OPTIONS,
  launchCaptureWork,
  parseCpuSamples,
  parseMonitorOptions,
  planIncidentTransition,
  pollOnce,
  runPollingLoop,
  shouldTriggerProfile,
} from '../scripts/prod_cpu_monitor_core.mjs';

describe('production CPU monitor parsing', () => {
  it('parses Docker CPU percentages without clamping multi-core values', () => {
    expect(parseCpuSamples(' 95.01%\n199.8%\n96%\n')).toEqual([95.01, 199.8, 96]);
  });

  it.each([
    '',
    '--',
    'NaN%',
    '-1%',
    '95',
    '95%\ninvalid%',
  ])('rejects malformed CPU output %j', (raw) => {
    expect(() => parseCpuSamples(raw)).toThrow();
  });

  it('uses a strict threshold and a two-of-three confirmation by default', () => {
    expect(shouldTriggerProfile([95, 95, 95], 95, 2)).toBe(false);
    expect(shouldTriggerProfile([95.01, 95.02, 10], 95, 2)).toBe(true);
    expect(shouldTriggerProfile([99, 20, 10], 95, 2)).toBe(false);
  });
});

describe('production CPU monitor configuration', () => {
  it('defaults to a low-noise production trigger with sub-minute detection', () => {
    const options = parseMonitorOptions([], {});
    expect(options).toMatchObject({
      targetHost: 'world-of-claudecraft-prod',
      jumpHost: 'minivac',
      container: 'eastbrook-game',
      threshold: 90,
      intervalMs: 30_000,
      sampleCount: 3,
      requiredHighSamples: 2,
      profileMs: 20_000,
      profileSampleIntervalUs: 4_000,
      once: false,
      dryRun: false,
    });
  });

  it('uses immutable in-image helpers instead of executing monitor-supplied stdin', async () => {
    const inspectOnly = gameProcessCommand(DEFAULT_MONITOR_OPTIONS, false);
    const signaling = gameProcessCommand(DEFAULT_MONITOR_OPTIONS, true, 42);
    const profile = profileCommand(DEFAULT_MONITOR_OPTIONS, 42);
    expect(inspectOnly).toContain('/app/ops/prod_cpu_game_helper.mjs pid');
    expect(signaling).toContain('/app/ops/prod_cpu_game_helper.mjs signal 42');
    expect(profile).toContain('/app/ops/prod_cpu_profile_client.mjs');
    expect(`${inspectOnly}\n${signaling}\n${profile}`).not.toContain(' --input-type=module -');
    expect(`${inspectOnly}\n${signaling}\n${profile}`).not.toContain(' docker exec -i ');

    const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
    expect(dockerfile).toContain('/app/scripts/prod_cpu_game_helper.mjs /app/ops/');
    expect(dockerfile).toContain('/app/scripts/prod_cpu_profile_client.mjs /app/ops/');
  });

  it('pins the inspector client to the discovered game PID and requests shutdown', () => {
    const command = profileCommand(DEFAULT_MONITOR_OPTIONS, 42);
    expect(command).toContain('WOC_EXPECTED_PID=42');
    expect(command).toContain('WOC_PROFILE_SAMPLE_INTERVAL_US=4000');
    expect(command).toContain('WOC_CLOSE_INSPECTOR=1');
  });

  it('binds inspector ownership to the exact container start identity', () => {
    const identity = {
      containerId: 'a'.repeat(64),
      containerStartedAt: '2026-07-13T00:00:00.000000000Z',
    };
    const command = containerIdentityCommand(DEFAULT_MONITOR_OPTIONS);
    expect(command).toContain('.Id');
    expect(command).toContain('.State.StartedAt');
    expect(containerIdentityMatchesOwner(identity, identity)).toBe(true);
    expect(
      containerIdentityMatchesOwner(identity, {
        ...identity,
        containerId: 'b'.repeat(64),
      }),
    ).toBe(false);
    expect(
      containerIdentityMatchesOwner(identity, {
        ...identity,
        containerStartedAt: '2026-07-13T00:01:00.000000000Z',
      }),
    ).toBe(false);
  });

  it('uses a fresh option set for inspector cleanup after capture cancellation', () => {
    const captureSignal = AbortSignal.abort(new Error('lock lost'));
    const options = inspectorCleanupOptions({ ...DEFAULT_MONITOR_OPTIONS, captureSignal });
    expect(options.captureSignal).toBeUndefined();
    expect(options.targetHost).toBe(DEFAULT_MONITOR_OPTIONS.targetHost);
  });

  it('uses a production-host flock to serialize profiles across operator machines', () => {
    const command = remoteLockCommand();
    expect(command).toContain('flock --nonblock /run/lock/woc-prod-cpu-monitor.lock');
    expect(command).toContain('cat >/dev/null');
  });

  it('builds SSH argv with the jump host and non-interactive safety options', () => {
    expect(buildSshArgs(DEFAULT_MONITOR_OPTIONS, 'true')).toEqual([
      '-T',
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=12',
      '-o',
      'ServerAliveInterval=15',
      '-o',
      'ServerAliveCountMax=2',
      '-J',
      'minivac',
      'world-of-claudecraft-prod',
      'true',
    ]);
  });

  it('supports direct SSH from an always-on ops host', () => {
    const options = parseMonitorOptions(['--direct'], {});
    expect(options.jumpHost).toBeNull();
    expect(buildSshArgs(options, 'true')).toEqual([
      '-T',
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=12',
      '-o',
      'ServerAliveInterval=15',
      '-o',
      'ServerAliveCountMax=2',
      'world-of-claudecraft-prod',
      'true',
    ]);
  });

  it('accepts an absolute durable output directory and configurable sampling interval', () => {
    const options = parseMonitorOptions(
      ['--out-dir', '/var/lib/woc-prod-cpu-monitor', '--profile-sample-micros', '5000'],
      {},
    );
    expect(options.outDir).toBe('/var/lib/woc-prod-cpu-monitor');
    expect(options.profileSampleIntervalUs).toBe(5000);
    expect(() => parseMonitorOptions(['--out-dir', 'relative/path'], {})).toThrow('absolute path');
  });

  it('initializes a securely pre-created service state directory', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'woc-cpu-monitor-'));
    const secure = path.join(parent, 'secure');
    const exposed = path.join(parent, 'exposed');
    try {
      await mkdir(secure, { mode: 0o700 });
      await prepareOutputDirectory(secure);
      await prepareOutputDirectory(secure);

      await mkdir(exposed, { mode: 0o755 });
      await chmod(exposed, 0o755);
      await expect(prepareOutputDirectory(exposed)).rejects.toThrow('unowned');
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('loads an owner-only token but refuses a symlinked credential', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'woc-cpu-token-'));
    const tokenFile = path.join(parent, 'ops.token');
    const tokenLink = path.join(parent, 'ops-link.token');
    const token = 'a'.repeat(64);
    try {
      await writeFile(tokenFile, `${token}\n`, { mode: 0o600 });
      expect(await loadOpsToken(tokenFile)).toBe(token);
      await symlink(tokenFile, tokenLink);
      await expect(loadOpsToken(tokenLink)).rejects.toThrow('real regular file');
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('age-prunes a monitor-owned capture left incomplete by a crash', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'woc-cpu-incomplete-'));
    const capture = path.join(parent, 'capture-20260712T002746168Z');
    try {
      await mkdir(capture, { mode: 0o700 });
      await markCaptureDirectory(capture);
      await pruneCaptures({
        ...DEFAULT_MONITOR_OPTIONS,
        outDir: parent,
        maxCaptureAgeMs: -1,
      });
      await expect(access(capture)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('rejects unsafe remote identifiers before they can reach a shell', () => {
    expect(() => parseMonitorOptions(['--container', 'game; reboot'], {})).toThrow();
    expect(() => parseMonitorOptions(['--host', 'prod $(id)'], {})).toThrow();
    expect(() => parseMonitorOptions([], { WOC_CPU_MONITOR_HOST: '-V' })).toThrow();
  });
});

describe('production CPU incident state', () => {
  const baseState = {
    incidentActive: false,
    healthyPolls: 0,
    lastAttemptAt: null,
    lastCaptureAt: null,
  };

  it('captures a new incident, suppresses immediate repeats, and periodically recaptures', () => {
    const first = planIncidentTransition(baseState, {
      high: true,
      representativeCpu: 98,
      now: 1_000,
      recoveryThreshold: 80,
      healthyPollsToRearm: 2,
      recaptureMs: 1_800_000,
    });
    expect(first.capture).toBe(true);

    const active = { ...first.nextState, lastAttemptAt: 1_000, lastCaptureAt: 1_000 };
    expect(
      planIncidentTransition(active, {
        high: true,
        representativeCpu: 99,
        now: 10_000,
        recoveryThreshold: 80,
        healthyPollsToRearm: 2,
        recaptureMs: 1_800_000,
      }).capture,
    ).toBe(false);
    expect(
      planIncidentTransition(active, {
        high: true,
        representativeCpu: 99,
        now: 1_801_000,
        recoveryThreshold: 80,
        healthyPollsToRearm: 2,
        recaptureMs: 1_800_000,
      }).capture,
    ).toBe(true);
  });

  it('retries a failed capture after the short failure cooldown', () => {
    const failed = {
      ...baseState,
      incidentActive: true,
      lastAttemptAt: 1_000,
      lastAttemptFailed: true,
    };
    const beforeRetry = planIncidentTransition(failed, {
      high: true,
      representativeCpu: 99,
      now: 120_999,
      recoveryThreshold: 80,
      healthyPollsToRearm: 2,
      recaptureMs: 1_800_000,
      failureRetryMs: 120_000,
    });
    expect(beforeRetry.capture).toBe(false);
    const retry = planIncidentTransition(failed, {
      high: true,
      representativeCpu: 99,
      now: 121_000,
      recoveryThreshold: 80,
      healthyPollsToRearm: 2,
      recaptureMs: 1_800_000,
      failureRetryMs: 120_000,
    });
    expect(retry.capture).toBe(true);
    expect(retry.reason).toBe('failed-capture-retry');
  });

  it('does not re-profile an incident when the CPU profile succeeded but auxiliary evidence failed', () => {
    expect(
      classifyIncidentEvidence({
        cpuProfileFailed: false,
        auxiliaryEvidenceFailed: true,
      }),
    ).toEqual({ complete: false, fatal: false });
    expect(
      classifyIncidentEvidence({
        cpuProfileFailed: true,
        auxiliaryEvidenceFailed: false,
      }),
    ).toEqual({ complete: false, fatal: true });
  });

  it('re-arms only after two healthy polls', () => {
    const active = {
      incidentActive: true,
      healthyPolls: 0,
      lastAttemptAt: 1_000,
      lastCaptureAt: 1_000,
    };
    const one = planIncidentTransition(active, {
      high: false,
      representativeCpu: 70,
      now: 2_000,
      recoveryThreshold: 80,
      healthyPollsToRearm: 2,
      recaptureMs: 1_800_000,
    });
    expect(one.nextState).toMatchObject({ incidentActive: true, healthyPolls: 1 });

    const two = planIncidentTransition(one.nextState, {
      high: false,
      representativeCpu: 70,
      now: 3_000,
      recoveryThreshold: 80,
      healthyPollsToRearm: 2,
      recaptureMs: 1_800_000,
    });
    expect(two.nextState).toMatchObject({ incidentActive: false, healthyPolls: 0 });
  });
});

describe('production CPU polling orchestration', () => {
  it('waits for the CPU profiler readiness signal before tick and context evidence', async () => {
    const calls = [];
    let releaseProfile;
    let releaseSecondary;
    const profileBlocked = new Promise((resolve) => {
      releaseProfile = resolve;
    });
    const secondaryReady = new Promise((resolve) => {
      releaseSecondary = resolve;
    });
    const work = launchCaptureWork({
      profile: async () => {
        calls.push('profile');
        await profileBlocked;
        return 'profile-complete';
      },
      tick: async () => {
        calls.push('tick');
        return 'tick-complete';
      },
      context: async () => {
        calls.push('context');
        return 'context-complete';
      },
      secondaryReady,
    });

    expect(calls).toEqual(['profile']);
    releaseSecondary();
    await Promise.resolve();
    expect(calls).toEqual(['profile', 'tick', 'context']);
    await expect(work.tick).resolves.toBe('tick-complete');
    await expect(work.context).resolves.toBe('context-complete');
    releaseProfile();
    await expect(work.profile).resolves.toBe('profile-complete');
  });

  it('bounds child processes and returns small stdout safely', async () => {
    const success = await runProcess(process.execPath, ['-e', 'process.stdout.write("ok")']);
    expect(success.stdout).toBe('ok');

    await expect(
      runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 30 }),
    ).rejects.toThrow('timed out');
  });

  it('streams complete stderr lines while a child process is running', async () => {
    const lines = [];
    await runProcess(process.execPath, ['-e', 'process.stderr.write("ready\\npartial")'], {
      onStderrLine: (line) => lines.push(line),
    });
    expect(lines).toEqual(['ready', 'partial']);
  });

  it('terminates a child process when a capture lock is lost', async () => {
    const controller = new AbortController();
    const running = runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      timeoutMs: 5_000,
      signal: controller.signal,
    });
    controller.abort(new Error('remote lock lost'));
    await expect(running).rejects.toThrow('remote lock lost');
  });

  it('profiles confirmed high CPU but not healthy CPU or a dry run', async () => {
    const capture = vi.fn(async () => '/private/capture');
    const quiet = vi.fn();

    const healthy = await pollOnce({
      readCpu: async () => '20%\n21%\n20%',
      capture,
      state: {
        incidentActive: false,
        healthyPolls: 0,
        lastAttemptAt: null,
        lastCaptureAt: null,
      },
      options: DEFAULT_MONITOR_OPTIONS,
      now: () => 1_000,
      log: quiet,
    });
    expect(healthy.status).toBe('healthy');
    expect(capture).not.toHaveBeenCalled();

    const high = await pollOnce({
      readCpu: async () => '96%\n97%\n94%',
      capture,
      state: healthy.nextState,
      options: DEFAULT_MONITOR_OPTIONS,
      now: () => 2_000,
      log: quiet,
    });
    expect(high.status).toBe('captured');
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ representativeCpu: 96 }));

    const dryRunCapture = vi.fn();
    const dryRun = await pollOnce({
      readCpu: async () => '96%\n97%\n98%',
      capture: dryRunCapture,
      state: {
        incidentActive: false,
        healthyPolls: 0,
        lastAttemptAt: null,
        lastCaptureAt: null,
      },
      options: { ...DEFAULT_MONITOR_OPTIONS, dryRun: true },
      now: () => 3_000,
      log: quiet,
    });
    expect(dryRun.status).toBe('would-capture');
    expect(dryRunCapture).not.toHaveBeenCalled();
  });

  it('records a failed attempt so an overloaded server is not profiled again immediately', async () => {
    let current = 5_000;
    const result = await pollOnce({
      readCpu: async () => '99%\n99%\n99%',
      capture: async () => {
        current = 190_000;
        throw new Error('profile unavailable');
      },
      state: {
        incidentActive: false,
        healthyPolls: 0,
        lastAttemptAt: null,
        lastCaptureAt: null,
      },
      options: DEFAULT_MONITOR_OPTIONS,
      now: () => current,
      log: vi.fn(),
    });
    expect(result.status).toBe('capture-failed');
    expect(result.nextState.incidentActive).toBe(true);
    expect(result.nextState.lastAttemptAt).toBe(190_000);
    expect(result.nextState.lastCaptureAt).toBeNull();
  });

  it('keeps a start-to-start five-minute cadence and survives poll errors', async () => {
    let current = 0;
    let polls = 0;
    const sleeps = [];
    const log = vi.fn();

    await runPollingLoop({
      poll: async () => {
        polls += 1;
        current += polls === 1 ? 1_200 : 0;
        if (polls === 1) throw new Error('temporary SSH failure');
      },
      sleep: async (ms) => {
        sleeps.push(ms);
        current += ms;
      },
      now: () => current,
      intervalMs: 300_000,
      shouldStop: () => polls >= 2,
      log,
    });

    expect(polls).toBe(2);
    expect(sleeps).toEqual([298_800]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('temporary SSH failure'));
  });

  it('waits at least 30 seconds after a cycle overruns the five-minute interval', async () => {
    let current = 0;
    let polls = 0;
    const sleeps = [];
    await runPollingLoop({
      poll: async () => {
        polls += 1;
        current += 400_000;
      },
      sleep: async (ms) => {
        sleeps.push(ms);
        current += ms;
      },
      now: () => current,
      intervalMs: 300_000,
      shouldStop: () => polls >= 2,
      log: vi.fn(),
    });
    expect(sleeps).toEqual([30_000]);
  });
});

describe('container-local V8 profile client', () => {
  it('verifies the target PID, captures a profile, and closes the inspector', async () => {
    const target = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    try {
      await wait(300);
      process.kill(target.pid, 'SIGUSR1');
      await inspectorOpen(true);

      const wrongTarget = await runProfileClient({
        WOC_PROFILE_MS: '1000',
        WOC_EXPECTED_PID: String(target.pid + 1),
        WOC_CLOSE_INSPECTOR: '0',
      });
      expect(wrongTarget.code).not.toBe(0);
      expect(wrongTarget.stderr).toContain('unexpected inspector PID');
      await inspectorOpen(true);

      const captured = await runProfileClient({
        WOC_PROFILE_MS: '1000',
        WOC_EXPECTED_PID: String(target.pid),
        WOC_CLOSE_INSPECTOR: '1',
      });
      expect(captured.code, captured.stderr).toBe(0);
      expect(captured.stderr).toContain('WOC_PROFILE_STARTED');
      expect(captured.stderr).toContain('WOC_PROFILE_STOPPED');
      const profile = JSON.parse(captured.stdout);
      expect(profile.nodes.length).toBeGreaterThan(0);
      expect(profile.samples.length).toBeGreaterThan(0);
      await inspectorOpen(false);
    } finally {
      target.kill('SIGTERM');
      await new Promise((resolve) => target.once('close', resolve));
    }
  }, 15_000);
});
