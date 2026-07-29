import { readFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  createTailKeeper,
  DEFAULT_DRAIN_DEADLINE_MS,
  formatLegHeader,
  runLeg,
  runLegsWithFlakeRetry,
} from '../scripts/lib/ci_leg_runner.mjs';
import {
  TEARDOWN_RPC_MESSAGE,
  TEARDOWN_RPC_TAIL_BYTES,
} from '../scripts/lib/teardown_rpc_flake.mjs';

// The retry policy is the load-bearing part: CI may rerun a leg ONLY on the
// exact teardown-rpc signature, at most once per process, and everything
// else must fail exactly as it always did (the packet's non-goals forbid a
// blanket retry). Every case here pins one arm of that sentence. The
// signature literal is kept away from the runner's REAL output streams
// throughout (stub tails, injected PassThrough sinks): if it ever reached a
// leg's real stdout, an all-passing exit-1 failure in the suite carrying it
// could self-match the classifier.

const FLAKE_TAIL =
  `Vitest caught 1 unhandled error during the test run.\n` +
  `EnvironmentTeardownError: [vitest-worker]: ${TEARDOWN_RPC_MESSAGE}\n` +
  ' Test Files  272 passed (272)\n' +
  '      Tests  3312 passed (3312)\n' +
  '     Errors  1 error\n';

const REAL_FAILURE_TAIL =
  ' Test Files  1 failed | 271 passed (272)\n      Tests  1 failed | 3311 passed (3312)\n';

type StubResult = { status: number | null; tail: string };

function makeStub(script: Record<string, StubResult[]>) {
  const calls: string[] = [];
  const receivedLogs: unknown[] = [];
  const runLegImpl = async ({ cmd, args, log }: { cmd: string; args: string[]; log?: unknown }) => {
    const key = `${cmd} ${args.join(' ')}`;
    calls.push(key);
    receivedLogs.push(log);
    const queue = script[key];
    if (!queue || queue.length === 0) throw new Error(`unexpected leg spawn: ${key}`);
    return queue.shift() as StubResult;
  };
  return { calls, receivedLogs, runLegImpl };
}

function collect() {
  const lines: string[] = [];
  return { lines, sink: (line: string) => lines.push(line) };
}

function runnerOpts(
  legs: Array<{ name: string; cmd: string; args: string[] }>,
  runLegImpl: ReturnType<typeof makeStub>['runLegImpl'],
) {
  const log = collect();
  const annotations = collect();
  return {
    opts: {
      legs,
      cwd: '/nowhere',
      log: log.sink,
      error: log.sink,
      annotate: annotations.sink,
      runLegImpl,
    },
    log,
    annotations,
  };
}

const GREEN: StubResult = { status: 0, tail: ' Test Files  10 passed (10)\n' };

describe('runLegsWithFlakeRetry', () => {
  it('runs every leg once and prints each header when all are green', async () => {
    const { calls, runLegImpl } = makeStub({
      'npm test -- a': [GREEN],
      'npm test -- b': [GREEN],
    });
    const legs = [
      { name: 'floor', cmd: 'npm', args: ['test', '--', 'a'] },
      { name: 'related', cmd: 'npm', args: ['test', '--', 'b'] },
    ];
    const { opts, log, annotations } = runnerOpts(legs, runLegImpl);
    const result = await runLegsWithFlakeRetry(opts);
    expect(result).toEqual({ ok: true, status: 0, retriedLegNames: [] });
    expect(calls).toEqual(['npm test -- a', 'npm test -- b']);
    expect(log.lines).toEqual([formatLegHeader(legs[0]), formatLegHeader(legs[1])]);
    expect(annotations.lines).toEqual([]);
  });

  it('forwards the injected log sink into every leg spawn', async () => {
    // Unpinned in the audit: dropping the forwarding sends the drain-deadline
    // note straight to console.log, bypassing any injected sink.
    const { receivedLogs, runLegImpl } = makeStub({
      'npm test -- a': [{ status: 1, tail: FLAKE_TAIL }, GREEN],
    });
    const { opts, log } = runnerOpts(
      [{ name: 'floor', cmd: 'npm', args: ['test', '--', 'a'] }],
      runLegImpl,
    );
    await runLegsWithFlakeRetry(opts);
    expect(receivedLogs).toEqual([log.sink, log.sink]);
  });

  it('gates the default annotation on GITHUB_ACTIONS, printing via console.log only in CI', async () => {
    const { vi } = await import('vitest');
    for (const [envValue, expectedWarnings] of [
      ['true', 1],
      ['', 0],
    ] as const) {
      vi.stubEnv('GITHUB_ACTIONS', envValue);
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const { runLegImpl } = makeStub({
          'npm test -- a': [{ status: 1, tail: FLAKE_TAIL }, GREEN],
        });
        const log = collect();
        // No annotate injected: the default must decide from the env.
        await runLegsWithFlakeRetry({
          legs: [{ name: 'floor', cmd: 'npm', args: ['test', '--', 'a'] }],
          cwd: '/nowhere',
          log: log.sink,
          error: log.sink,
          runLegImpl,
        });
        const warnings = spy.mock.calls.filter((c) => String(c[0]).startsWith('::warning'));
        expect(warnings).toHaveLength(expectedWarnings);
      } finally {
        spy.mockRestore();
        vi.unstubAllEnvs();
      }
    }
  });

  it('retries exactly the flaked leg once, loudly, and greens when the rerun passes', async () => {
    const { calls, runLegImpl } = makeStub({
      'npm test -- a': [GREEN],
      'npm test -- b': [{ status: 1, tail: FLAKE_TAIL }, GREEN],
    });
    const legs = [
      { name: 'floor', cmd: 'npm', args: ['test', '--', 'a'] },
      { name: 'related', cmd: 'npm', args: ['test', '--', 'b'] },
    ];
    const { opts, log, annotations } = runnerOpts(legs, runLegImpl);
    const result = await runLegsWithFlakeRetry(opts);
    expect(result).toEqual({ ok: true, status: 0, retriedLegNames: ['related'] });
    expect(calls).toEqual(['npm test -- a', 'npm test -- b', 'npm test -- b']);
    const banner = log.lines.find((l) => l.includes('known-flake retry'));
    expect(banner).toBeDefined();
    // The banner is the audit trail: it must name the leg, the signature, and
    // the fact that nothing else retries.
    expect(banner).toContain('"related"');
    expect(banner).toContain('teardown-rpc');
    expect(banner).toContain(TEARDOWN_RPC_MESSAGE);
    expect(banner).toContain('no other failure mode ever retries');
    // The run-level annotation makes the retry visible without opening the
    // log; a green that used the retry must never look like a plain green.
    expect(annotations.lines).toHaveLength(1);
    expect(annotations.lines[0]).toMatch(/^::warning title=/);
    expect(annotations.lines[0]).toContain('"related"');
  });

  it('fails after one retry when the signature repeats: never a second retry', async () => {
    const { calls, runLegImpl } = makeStub({
      'npm test -- b': [
        { status: 1, tail: FLAKE_TAIL },
        { status: 1, tail: FLAKE_TAIL },
      ],
    });
    const { opts, log } = runnerOpts(
      [{ name: 'related', cmd: 'npm', args: ['test', '--', 'b'] }],
      runLegImpl,
    );
    const result = await runLegsWithFlakeRetry(opts);
    expect(result).toEqual({ ok: false, status: 1, retriedLegNames: ['related'] });
    expect(calls).toHaveLength(2);
    // The FAIL line says the budget was spent, so a red after a burned retry
    // is diagnosable without scrolling for the banner.
    const fail = log.lines.find((l) => l.includes('FAIL at "related" (exit 1)'));
    expect(fail).toBeDefined();
    expect(fail).toContain('known-flake retry already used on: related');
  });

  it('never retries a real failure: failed tests fail immediately', async () => {
    const { calls, runLegImpl } = makeStub({
      'npm test -- a': [{ status: 1, tail: REAL_FAILURE_TAIL }],
    });
    const { opts, log, annotations } = runnerOpts(
      [{ name: 'floor', cmd: 'npm', args: ['test', '--', 'a'] }],
      runLegImpl,
    );
    const result = await runLegsWithFlakeRetry(opts);
    expect(result.ok).toBe(false);
    expect(result.retriedLegNames).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(log.lines.some((l) => l.includes('known-flake retry'))).toBe(false);
    expect(annotations.lines).toEqual([]);
  });

  it('never retries other exit codes or signal kills, even with the signature text present', async () => {
    for (const status of [2, null]) {
      const { calls, runLegImpl } = makeStub({
        'npm test -- a': [{ status, tail: FLAKE_TAIL }],
      });
      const { opts } = runnerOpts(
        [{ name: 'floor', cmd: 'npm', args: ['test', '--', 'a'] }],
        runLegImpl,
      );
      const result = await runLegsWithFlakeRetry(opts);
      expect(result.ok).toBe(false);
      expect(result.status).toBe(status ?? 1);
      expect(result.retriedLegNames).toEqual([]);
      expect(calls).toHaveLength(1);
    }
  });

  it('shares ONE retry across all legs: a second flaked leg fails without retrying', async () => {
    const { calls, runLegImpl } = makeStub({
      'npm test -- a': [{ status: 1, tail: FLAKE_TAIL }, GREEN],
      'npm test -- b': [{ status: 1, tail: FLAKE_TAIL }],
    });
    const { opts } = runnerOpts(
      [
        { name: 'floor', cmd: 'npm', args: ['test', '--', 'a'] },
        { name: 'related', cmd: 'npm', args: ['test', '--', 'b'] },
      ],
      runLegImpl,
    );
    const result = await runLegsWithFlakeRetry(opts);
    expect(result).toEqual({ ok: false, status: 1, retriedLegNames: ['floor'] });
    expect(calls).toEqual(['npm test -- a', 'npm test -- a', 'npm test -- b']);
  });

  it('stops at the first failing leg and preserves its exit code', async () => {
    const { calls, runLegImpl } = makeStub({
      'npm test -- a': [{ status: 7, tail: 'boom' }],
    });
    const { opts, log } = runnerOpts(
      [
        { name: 'floor', cmd: 'npm', args: ['test', '--', 'a'] },
        { name: 'related', cmd: 'npm', args: ['test', '--', 'b'] },
      ],
      runLegImpl,
    );
    const result = await runLegsWithFlakeRetry(opts);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(7);
    expect(calls).toEqual(['npm test -- a']);
    expect(log.lines.some((l) => l.includes('FAIL at "floor" (exit 7)'))).toBe(true);
  });

  it('surfaces a spawn error as a named failed leg, never a retry and never a raw rejection', async () => {
    const spawnError = new Error('spawn definitely-missing ENOENT');
    const runLegImpl = async () => ({ status: null, tail: '', spawnError });
    const { opts, log, annotations } = runnerOpts(
      [{ name: 'floor', cmd: 'definitely-missing', args: [] }],
      runLegImpl as never,
    );
    const result = await runLegsWithFlakeRetry(opts);
    expect(result).toEqual({ ok: false, status: 1, retriedLegNames: [] });
    expect(log.lines.some((l) => l.includes('spawn error at "floor"'))).toBe(true);
    expect(log.lines.some((l) => l.includes('FAIL at "floor" (exit killed)'))).toBe(true);
    expect(annotations.lines).toEqual([]);
  });
});

describe('createTailKeeper', () => {
  it('bounds RETAINED memory, not just the returned tail', () => {
    // The audit proved the trim deletable: the final subarray bounds what
    // callers see while the retained list grows without limit. The keeper
    // must hold at most tailBytes plus one chunk at any moment.
    const tailBytes = 16 * 1024;
    const chunk = 8 * 1024;
    const keeper = createTailKeeper(tailBytes);
    for (let i = 0; i < 100; i++) {
      keeper.push(Buffer.alloc(chunk, i % 256));
      expect(keeper.retainedBytes()).toBeLessThanOrEqual(tailBytes + chunk);
    }
    const tail = keeper.tail();
    expect(tail.length).toBe(tailBytes);
  });
});

describe('exported constants and header shape', () => {
  it('pins the deadline value and the header literal', () => {
    // 10 seconds: long enough for any healthy post-exit drain, short enough
    // that a leaked grandchild costs seconds, not a workflow timeout.
    // Resizing is a conscious edit here.
    expect(DEFAULT_DRAIN_DEADLINE_MS).toBe(10_000);
    // The header is shared with the entry's plan-only printer; the prefix
    // half has no other backstop (the command half is pinned by the
    // subprocess tests in ci_shard_plan.test.ts).
    expect(formatLegHeader({ name: 'floor', cmd: 'npm', args: ['test', '--', 'a'] })).toBe(
      '\n[ci-shard] floor: npm test -- a',
    );
  });
});

describe('runLeg (real subprocess)', () => {
  it('streams output through, captures a bounded tail, and reports the exit code', async () => {
    const out = new PassThrough();
    const err = new PassThrough();
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    out.on('data', (c) => outChunks.push(c));
    err.on('data', (c) => errChunks.push(c));
    const script =
      // Enough stdout to overflow the small tail budget below, then the
      // signature artifacts at the very end, split across the two streams
      // like a real vitest run (summary on stdout, rejection on stderr).
      // exitCode, never process.exit(): on a loaded machine the 64 KB burst
      // is still queued on the child's async stdout pipe, and a forced exit
      // drops the summary write behind it, exactly the truncation defect the
      // entry itself was fixed for (this fixture flaked that way once under
      // a full gate before the change).
      "process.stdout.write('x'.repeat(64 * 1024));" +
      "process.stdout.write('\\n Test Files  2 passed (2)\\n      Tests  5 passed (5)\\n');" +
      "process.stderr.write('EnvironmentTeardownError: [vitest-worker]: " +
      'Closing rpc while "onUserConsoleLog" was pending' +
      "\\n');" +
      'process.exitCode = 1;';
    const result = await runLeg({
      cmd: process.execPath,
      args: ['-e', script],
      cwd: process.cwd(),
      out,
      err,
      tailBytes: 8 * 1024,
    });
    expect(result.status).toBe(1);
    expect(result.spawnError).toBeUndefined();
    // The tail is bounded and keeps the END of the combined output.
    expect(result.tail.length).toBeLessThanOrEqual(8 * 1024);
    expect(result.tail).toContain('Test Files  2 passed (2)');
    expect(result.tail).toContain(TEARDOWN_RPC_MESSAGE);
    // The full output still reached the passthrough sinks uncut: the CI log
    // must never lose bytes to the tail bookkeeping.
    expect(Buffer.concat(outChunks).length).toBeGreaterThan(64 * 1024);
    expect(Buffer.concat(errChunks).toString('utf8')).toContain(TEARDOWN_RPC_MESSAGE);
  });

  it('reports exit 0 for a green child', async () => {
    const result = await runLeg({
      cmd: process.execPath,
      args: ['-e', "process.stdout.write('ok\\n')"],
      cwd: process.cwd(),
      out: new PassThrough(),
      err: new PassThrough(),
    });
    expect(result.status).toBe(0);
    expect(result.tail).toContain('ok');
  });

  it('resolves a spawn failure instead of rejecting, so the FAIL audit line survives', async () => {
    const result = await runLeg({
      cmd: '/definitely/not/a/real/binary/anywhere-xyz',
      args: [],
      cwd: process.cwd(),
      out: new PassThrough(),
      err: new PassThrough(),
    });
    expect(result.status).toBeNull();
    expect(result.spawnError).toBeInstanceOf(Error);
  });

  it('applies backpressure: the parent buffer stays bounded while the sink withholds drain', async () => {
    // Deterministic pin on the pause/resume pair: the max observed
    // writableLength over the whole run is timing-robust (a slow child just
    // takes longer; the poller keeps sampling until close). Without the
    // pause, incoming chunks pile into the sink's buffer while its write
    // callbacks are withheld and the max climbs toward the full burst.
    const { Writable } = await import('node:stream');
    const pending: Array<() => void> = [];
    let received = 0;
    let maxBuffered = 0;
    const sink = new Writable({
      highWaterMark: 1,
      write(chunk: Buffer, _enc, cb) {
        received += chunk.length;
        pending.push(cb as () => void);
      },
    });
    const sample = setInterval(() => {
      maxBuffered = Math.max(maxBuffered, sink.writableLength);
      const cbs = pending.splice(0);
      for (const cb of cbs) cb();
    }, 20);
    const result = await runLeg({
      cmd: process.execPath,
      args: ['-e', "process.stdout.write('y'.repeat(256 * 1024)); process.exitCode = 3;"],
      cwd: process.cwd(),
      out: sink,
      err: new PassThrough(),
    });
    clearInterval(sample);
    for (const cb of pending.splice(0)) cb();
    expect(result.status).toBe(3);
    expect(received).toBe(256 * 1024);
    // With the pause in place the parent-side buffer never approaches the
    // full burst; without it, it climbs past this bound regardless of load.
    // The ceiling is structural, not timing-dependent: exactly two 64 KB
    // pipe chunks (131072 bytes), byte-identical across 36 verifier runs in
    // three load conditions, because the mirror never allows more than one
    // un-drained write plus one in flight. The bound sits 17 percent above
    // that fixed ceiling and only a Node pipe-read-size change could move it.
    expect(maxBuffered).toBeLessThan(150 * 1024);
  });

  it('proceeds after the drain deadline when a leaked child holds the stdio pipes open', async () => {
    // The child exits immediately but leaves a detached grandchild holding
    // the inherited stdout pipe for 8 seconds. Without the deadline, close
    // never fires until the grandchild lets go and the runner (a required
    // check in CI) hangs with it.
    const script =
      "const { spawn } = require('node:child_process');" +
      "spawn(process.execPath, ['-e', 'setTimeout(() => {}, 3000)'], " +
      "{ stdio: ['ignore', 'inherit', 'inherit'], detached: true }).unref();" +
      "process.stdout.write('leg done\\n');" +
      'process.exit(0);';
    const notes = collect();
    const startedAt = Date.now();
    const result = await runLeg({
      cmd: process.execPath,
      args: ['-e', script],
      cwd: process.cwd(),
      out: new PassThrough(),
      err: new PassThrough(),
      log: notes.sink,
      drainDeadlineMs: 500,
    });
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(result.status).toBe(0);
    expect(result.tail).toContain('leg done');
    expect(notes.lines.some((l) => l.includes('stdio stayed open'))).toBe(true);
  });

  it('preserves a NONZERO exit code through the drain-deadline path', async () => {
    // The verifier proved finish(0) survivable when the only deadline case
    // exited 0: that mutant is exactly "a failing leg whose grandchild holds
    // the pipes reports green".
    const script =
      "const { spawn } = require('node:child_process');" +
      "spawn(process.execPath, ['-e', 'setTimeout(() => {}, 3000)'], " +
      "{ stdio: ['ignore', 'inherit', 'inherit'], detached: true }).unref();" +
      'process.exitCode = 7;';
    const result = await runLeg({
      cmd: process.execPath,
      args: ['-e', script],
      cwd: process.cwd(),
      out: new PassThrough(),
      err: new PassThrough(),
      log: () => {},
      drainDeadlineMs: 500,
    });
    expect(result.status).toBe(7);
  });

  it('lets the whole PROCESS exit past a leaked grandchild, not just the promise', async () => {
    // Resolving alone was measured insufficient (the job sat 8 more seconds
    // on the grandchild's pipe handles); the deadline now unrefs them. A
    // real driver process proves the property end to end: it must exit on
    // its own, promptly, with the leg's code relayed.
    const { execFile } = await import('node:child_process');
    const { mkdtemp, writeFile: writeTmp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'ci-leg-runner-'));
    try {
      const runnerUrl = new URL('../scripts/lib/ci_leg_runner.mjs', import.meta.url).href;
      const driver =
        `import { runLeg } from ${JSON.stringify(runnerUrl)};\n` +
        "const leak = \"const {spawn}=require('node:child_process');" +
        "spawn(process.execPath,['-e','setTimeout(()=>{},3000)']," +
        "{stdio:['ignore','inherit','inherit'],detached:true}).unref();process.exitCode=0;\";\n" +
        'const r = await runLeg({ cmd: process.execPath, args: ["-e", leak], cwd: process.cwd(), ' +
        'out: { write: () => true }, err: { write: () => true }, log: () => {}, drainDeadlineMs: 400 });\n' +
        'process.exitCode = r.status === 0 ? 42 : 43;\n';
      const driverPath = join(dir, 'driver.mjs');
      await writeTmp(driverPath, driver);
      const code = await new Promise<number | null>((resolve) => {
        execFile(
          process.execPath,
          [driverPath],
          { timeout: 6_000, killSignal: 'SIGKILL' },
          (error) => resolve(error ? ((error as { code?: number }).code ?? null) : 0),
        );
      });
      // 42 relayed through a clean self-exit; a hang would be SIGKILLed by
      // the 6 second harness timeout and land here as null.
      expect(code).toBe(42);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('entry wiring', () => {
  it('ci_shard_test.mjs runs its legs through the flake-retry runner, not a raw spawn', () => {
    const source = readFileSync(new URL('../scripts/ci_shard_test.mjs', import.meta.url), 'utf8');
    // Comments stripped (block then line, the ci_workflow.test.ts idiom): a
    // commented-out call must fail the pin, and prose mentioning spawnSync
    // must not trip the ban.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).toContain("from './lib/ci_leg_runner.mjs'");
    expect(code).toContain('runLegsWithFlakeRetry({ legs: plan.legs, cwd: repoRoot })');
    // The one retry policy lives in the runner; the entry must not grow its
    // own spawn path around it.
    expect(code).not.toContain('spawnSync');
    expect(code).not.toContain('spawn(');
    // The failure path must set exitCode and let the piped output drain; a
    // forced process.exit() discards queued stdout and truncates the
    // failing-shard log (measured: everything past one 64 KB pipe buffer).
    expect(code).toContain('process.exitCode = result.status');
    expect(code).not.toContain('process.exit(result.status)');
    // And the PASS line must live in the ELSE of that check: moved out, it
    // would print PASS on a failing shard.
    expect(code).toMatch(
      /if \(!result\.ok\) \{\s*process\.exitCode = result\.status;\s*\} else \{[\s\S]{0,600}?\[ci-shard\] PASS/,
    );
    // The PASS suffix naming retried legs is a docs/qa-gate.md claim.
    expect(code).toContain('known-flake retry used on:');
    // Exactly ONE call site: a second one (say, inside the plan-only branch)
    // would spawn real legs where the contract says nothing runs.
    expect(code.match(/runLegsWithFlakeRetry\(/g)).toHaveLength(1);
    // The runner's tail default must stay bound to the shared budget: a
    // shrunken default would blind the classifier in CI while every test,
    // which passes tailBytes explicitly, stayed green.
    const runnerSource = readFileSync(
      new URL('../scripts/lib/ci_leg_runner.mjs', import.meta.url),
      'utf8',
    );
    const runnerCode = runnerSource
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(runnerCode).toContain('tailBytes = TEARDOWN_RPC_TAIL_BYTES');
  });
});
