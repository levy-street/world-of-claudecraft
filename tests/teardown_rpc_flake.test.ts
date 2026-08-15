import { describe, expect, it } from 'vitest';
import {
  isTeardownRpcFlake,
  TEARDOWN_RPC_MESSAGE,
  TEARDOWN_RPC_TAIL_BYTES,
} from '../scripts/lib/teardown_rpc_flake.mjs';

// The ONE sanctioned known-flake signature (CI/CD performance packet, Phase
// 6): every test passed, exit 1 from the vitest worker-teardown RPC race.
// The classifier gates an automatic retry in CI, so every arm here is a
// fail-closed pin: anything that loosens the match would let a real failure
// ride the retry, which the packet's non-goals forbid.

const ESC = String.fromCharCode(27);
const dim = (s: string) => `${ESC}[2m${s}${ESC}[22m`;
const green = (s: string) => `${ESC}[1m${ESC}[32m${s}${ESC}[39m${ESC}[22m`;

function rpcBanner(count = 1): string {
  return (
    `Vitest caught ${count} unhandled error${count === 1 ? '' : 's'} during the test run.\n` +
    `Unhandled Rejection\nEnvironmentTeardownError: [vitest-worker]: ${TEARDOWN_RPC_MESSAGE}\n    at Object.onCancel (node_modules/.pnpm/vitest@4.1.10/node_modules/vitest/dist/worker.js:105:11)\n`.repeat(
      count,
    )
  );
}

function summary(filesBuckets: string, testsBuckets: string, errorsBuckets: string): string {
  return (
    ` Test Files  ${filesBuckets}\n      Tests  ${testsBuckets}\n     Errors  ${errorsBuckets}\n` +
    '   Start at  13:24:33\n   Duration  431.92s (transform 31.1s, setup 46.2s, import 116.4s)\n'
  );
}

// Real vitest order: the failure/unhandled banner prints BEFORE the summary
// lines (reportSummary calls printErrorsSummary first, then
// reportTestSummary), so the canonical fixture keeps that shape.
const FLAKE_TAIL = `${rpcBanner(1)}\n${summary('272 passed (272)', '3312 passed (3312)', '1 error')}`;

describe('isTeardownRpcFlake', () => {
  it('pins the message constant itself: the fixtures are built FROM it, so it needs its own literal', () => {
    // Constant-self-comparison guard: every fixture interpolates
    // TEARDOWN_RPC_MESSAGE, so loosening the constant would loosen the
    // fixtures with it and nothing else would go red.
    expect(TEARDOWN_RPC_MESSAGE).toBe('Closing rpc while "onUserConsoleLog" was pending');
  });

  it('matches the exact recorded signature: all passed, exit 1, the rpc message, in real vitest order', () => {
    expect(isTeardownRpcFlake({ status: 1, tail: FLAKE_TAIL })).toBe(true);
  });

  it('never retries when occurrences EXCEED the counted errors, and strips workflow-command lines first', () => {
    // Two banner occurrences against one counted error: a duplicate from a
    // source other than the reporter must veto the retry.
    const doubled = `${rpcBanner(2)}\n${summary('272 passed (272)', '3312 passed (3312)', '1 error')}`;
    expect(isTeardownRpcFlake({ status: 1, tail: doubled })).toBe(false);
    // The REAL CI shape: with GITHUB_ACTIONS=true vitest's github-actions
    // reporter re-emits the error as a `::error ...` annotation line, so the
    // message appears twice in the raw tail against `Errors  1 error`. The
    // annotation line must be stripped before counting or the retry is
    // silently inert in CI whenever the stack resolves a project frame.
    const annotated =
      `::error file=src/ui/hud.ts,line=1::EnvironmentTeardownError: [vitest-worker]: ${TEARDOWN_RPC_MESSAGE}\n` +
      `${rpcBanner(1)}\n${summary('272 passed (272)', '3312 passed (3312)', '1 error')}`;
    expect(isTeardownRpcFlake({ status: 1, tail: annotated })).toBe(true);
  });

  it('matches independent of banner-vs-summary order (the classifier is deliberately order-agnostic)', () => {
    const bannerLast = `${summary('272 passed (272)', '3312 passed (3312)', '1 error')}\n${rpcBanner(1)}`;
    expect(isTeardownRpcFlake({ status: 1, tail: bannerLast })).toBe(true);
  });

  it('matches through ANSI color wrapping and CRLF, the shapes CI logs can carry', () => {
    const colored =
      `${rpcBanner(1).replace(/\n/g, '\r\n')}\r\n` +
      `${dim(' Test Files ')} ${green('272 passed')} ${dim('(272)')}\r\n` +
      `${dim('      Tests ')} ${green('3312 passed')} ${dim('(3312)')}\r\n` +
      `${dim('     Errors ')} ${green('1 error')}\r\n`;
    expect(isTeardownRpcFlake({ status: 1, tail: colored })).toBe(true);
  });

  it('allows skipped and todo buckets: the full suite carries DB-gated skips', () => {
    const tail = `${rpcBanner(1)}\n${summary('272 passed (272)', '3302 passed | 10 skipped (3312)', '1 error')}`;
    expect(isTeardownRpcFlake({ status: 1, tail })).toBe(true);
  });

  it('matches a multi-worker flake: N teardown-rpc occurrences explaining N errors', () => {
    const tail = `${rpcBanner(2)}\n${summary('272 passed (272)', '3312 passed (3312)', '2 errors')}`;
    expect(isTeardownRpcFlake({ status: 1, tail })).toBe(true);
  });

  it('never retries a run whose error count the flake does not fully explain', () => {
    // One teardown-rpc occurrence but TWO counted errors: the second is a
    // genuine unhandled error riding the same run, so no retry.
    const mixed = `${rpcBanner(1)}TypeError: boom in afterAll\n${summary('272 passed (272)', '3312 passed (3312)', '2 errors')}`;
    expect(isTeardownRpcFlake({ status: 1, tail: mixed })).toBe(false);
    // No Errors line at all (or truncated away): fail closed.
    const noErrorsLine =
      `${rpcBanner(1)}\n Test Files  272 passed (272)\n      Tests  3312 passed (3312)\n` +
      '   Start at  13:24:33\n';
    expect(isTeardownRpcFlake({ status: 1, tail: noErrorsLine })).toBe(false);
    // A malformed count never parses into a match.
    const malformed = `${rpcBanner(1)}\n${summary('272 passed (272)', '3312 passed (3312)', 'some errors')}`;
    expect(isTeardownRpcFlake({ status: 1, tail: malformed })).toBe(false);
  });

  it('requires a passed bucket: an all-skipped summary is not all-passing', () => {
    const allSkipped = `${rpcBanner(1)}\n${summary('272 skipped (272)', '3312 skipped (3312)', '1 error')}`;
    expect(isTeardownRpcFlake({ status: 1, tail: allSkipped })).toBe(false);
  });

  it('accepts only real summary-line shapes: anchored label, two-plus space separator, anchored count', () => {
    // A junk-prefixed label line is not a summary line.
    const prefixed = `${rpcBanner(1)}\nfoo Test Files  272 passed (272)\nfoo      Tests  3312 passed (3312)\n     Errors  1 error\n`;
    expect(isTeardownRpcFlake({ status: 1, tail: prefixed })).toBe(false);
    // A single-space separator is prose, not the padded summary shape.
    const singleSpace = `${rpcBanner(1)}\n Test Files 272 passed (272)\n      Tests 3312 passed (3312)\n     Errors 1 error\n`;
    expect(isTeardownRpcFlake({ status: 1, tail: singleSpace })).toBe(false);
    // The error count must START the bucket text, never float mid-sentence.
    const floating = `${rpcBanner(1)}\n${summary('272 passed (272)', '3312 passed (3312)', 'about 1 error')}`;
    expect(isTeardownRpcFlake({ status: 1, tail: floating })).toBe(false);
  });

  it('never matches when any test failed, in either summary line', () => {
    const failedTests = `${rpcBanner(1)}\n${summary('272 passed (272)', '1 failed | 3311 passed (3312)', '1 error')}`;
    expect(isTeardownRpcFlake({ status: 1, tail: failedTests })).toBe(false);
    const failedFiles = `${rpcBanner(1)}\n${summary('1 failed | 271 passed (272)', '3312 passed (3312)', '1 error')}`;
    expect(isTeardownRpcFlake({ status: 1, tail: failedFiles })).toBe(false);
  });

  it('never matches without BOTH pass-summary lines in the tail', () => {
    const filesOnly = `${rpcBanner(1)}\n Test Files  272 passed (272)\n     Errors  1 error\n`;
    expect(isTeardownRpcFlake({ status: 1, tail: filesOnly })).toBe(false);
    const testsOnly = `${rpcBanner(1)}\n      Tests  3312 passed (3312)\n     Errors  1 error\n`;
    expect(isTeardownRpcFlake({ status: 1, tail: testsOnly })).toBe(false);
    expect(isTeardownRpcFlake({ status: 1, tail: rpcBanner(1) })).toBe(false);
  });

  it('requires the exact rpc message: a different pending rpc never retries', () => {
    const otherRpc = FLAKE_TAIL.replace(/onUserConsoleLog/g, 'onTaskUpdate');
    expect(isTeardownRpcFlake({ status: 1, tail: otherRpc })).toBe(false);
    const otherError = FLAKE_TAIL.replace(/EnvironmentTeardownError/g, 'SomeOtherTeardownError');
    expect(isTeardownRpcFlake({ status: 1, tail: otherError })).toBe(false);
    // The at-least-one arm must hold on its own: a zero-error summary with
    // the error NAME present but the exact message absent would satisfy the
    // count equality (0 equals 0) if the occurrences floor were dropped.
    const zeroCounted =
      'EnvironmentTeardownError: [vitest-worker]: Closing rpc while "onOther" was pending\n' +
      summary('272 passed (272)', '3312 passed (3312)', '0 errors');
    expect(isTeardownRpcFlake({ status: 1, tail: zeroCounted })).toBe(false);
  });

  it('requires exit status exactly 1: exit 0, other codes, and signal kills never match', () => {
    expect(isTeardownRpcFlake({ status: 0, tail: FLAKE_TAIL })).toBe(false);
    expect(isTeardownRpcFlake({ status: 2, tail: FLAKE_TAIL })).toBe(false);
    expect(isTeardownRpcFlake({ status: null, tail: FLAKE_TAIL })).toBe(false);
  });

  it('never matches an empty or summary-free tail', () => {
    expect(isTeardownRpcFlake({ status: 1, tail: '' })).toBe(false);
    expect(isTeardownRpcFlake({ status: 1, tail: 'npm ERR! test failed' })).toBe(false);
  });

  it('judges the FINAL summary when a tail somehow holds two', () => {
    const passesLast =
      `${rpcBanner(1)}\n${summary('1 failed | 271 passed (272)', '1 failed | 3311 passed (3312)', '1 error')}\n` +
      summary('272 passed (272)', '3312 passed (3312)', '1 error');
    expect(isTeardownRpcFlake({ status: 1, tail: passesLast })).toBe(true);
    const failsLast =
      `${rpcBanner(1)}\n${summary('272 passed (272)', '3312 passed (3312)', '1 error')}\n` +
      summary('1 failed | 271 passed (272)', '1 failed | 3311 passed (3312)', '1 error');
    expect(isTeardownRpcFlake({ status: 1, tail: failsLast })).toBe(false);
  });

  it('pins the tail budget exactly: big enough for the artifacts, small enough to stay flat', () => {
    // Exact, not a floor: shrinking it blinds the classifier in CI while
    // everything else stays green, and inflating it un-bounds the memory
    // claim. Resizing is a conscious edit here.
    expect(TEARDOWN_RPC_TAIL_BYTES).toBe(256 * 1024);
    expect(FLAKE_TAIL.length).toBeLessThan(TEARDOWN_RPC_TAIL_BYTES / 8);
  });
});

describe('real vitest output (the one external assumption)', () => {
  // The fixtures above are hand-built from the same constants the classifier
  // matches, so nothing in them proves vitest still prints this shape. This
  // spawns the REAL vitest on a scratch project whose one leaked error
  // mimics the recorded flake (vitest-internal stack, exact message), under
  // GITHUB_ACTIONS=true like a real shard, and feeds the captured output
  // through the classifier. A vitest bump that reformats the summary or the
  // banner turns this red instead of silently disabling the retry.
  it('classifies a real flake-shaped run as retryable and a real failure as not', {
    timeout: 60_000,
  }, async () => {
    const [{ spawnSync }, { mkdtemp, writeFile, symlink, rm }, { tmpdir }, path] =
      await Promise.all([
        import('node:child_process'),
        import('node:fs/promises'),
        import('node:os'),
        import('node:path'),
      ]);
    const repoRoot = path.join(__dirname, '..');
    const dir = await mkdtemp(path.join(tmpdir(), 'teardown-rpc-real-'));
    try {
      await symlink(path.join(repoRoot, 'node_modules'), path.join(dir, 'node_modules'));
      const leak =
        "import { it } from 'vitest';\n" +
        "it('passes', () => {});\n" +
        "it('leaks the teardown-rpc shape', () => {\n" +
        '  const err = new Error(\n' +
        `    '[vitest-worker]: ${TEARDOWN_RPC_MESSAGE.replace(/'/g, "\\'")}',\n` +
        '  );\n' +
        "  err.name = 'EnvironmentTeardownError';\n" +
        "  err.stack = 'EnvironmentTeardownError: ' + err.message +\n" +
        "    '\\n    at node_modules/vitest/dist/worker.js:105:11';\n" +
        // The real flake is an unhandled REJECTION during the run; a
        // deferred throw races the process exit and can vanish.
        '  Promise.reject(err);\n' +
        '});\n';
      await writeFile(path.join(dir, 'leak.test.mjs'), leak);
      const run = (file: string) =>
        spawnSync('npx', ['--no-install', 'vitest', 'run', '--root', dir, file], {
          cwd: repoRoot,
          encoding: 'utf8',
          env: { ...process.env, CI: 'true', GITHUB_ACTIONS: 'true' },
          timeout: 50_000,
        });
      const flaky = run('leak.test.mjs');
      const flakyTail = `${flaky.stdout}\n${flaky.stderr}`.slice(-TEARDOWN_RPC_TAIL_BYTES);
      expect(flaky.status).toBe(1);
      expect(isTeardownRpcFlake({ status: flaky.status, tail: flakyTail })).toBe(true);
      // Control: a genuinely failing test with the same leak must never
      // classify, proving the run above is not vacuous.
      await writeFile(
        path.join(dir, 'red.test.mjs'),
        `${leak}\nit('fails', () => {\n  throw new Error('real failure');\n});\n`,
      );
      const red = run('red.test.mjs');
      const redTail = `${red.stdout}\n${red.stderr}`.slice(-TEARDOWN_RPC_TAIL_BYTES);
      expect(red.status).toBe(1);
      expect(isTeardownRpcFlake({ status: red.status, tail: redTail })).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
