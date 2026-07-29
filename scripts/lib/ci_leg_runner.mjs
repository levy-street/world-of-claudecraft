// Leg runner for scripts/ci_shard_test.mjs, split out per the module-first
// rule so the retry policy is Vitest-pinnable without spawning real test
// legs. The entry stays a thin consumer.
//
// Streams the child's output through with backpressure (the CI log must stay
// complete and live; the mirror pauses the child when the parent's pipe is
// saturated instead of buffering without bound) while keeping a bounded
// rolling tail for the ONE sanctioned known-flake classification
// (teardown_rpc_flake.mjs). Retry policy, pinned by
// tests/ci_leg_runner.test.ts:
//   - only the exact teardown-rpc signature retries; every other failure
//     mode (failed tests, other exit codes, signal kills, spawn errors, any
//     unhandled error the signature count does not fully explain) fails the
//     job exactly as before;
//   - at most ONE retry per PROCESS, shared across all legs, so even a
//     pathological multi-leg flake run can never become a blanket retry
//     (the packet's non-goals forbid one);
//   - the retry reruns the SAME leg once, loudly: a banner in the log, a
//     GitHub Actions warning annotation on the run, and a PASS-line suffix,
//     so a green that used the retry is auditable at a glance. That
//     visibility, not the summary parse, is the safety property.

import { spawn } from 'node:child_process';
import { isTeardownRpcFlake, TEARDOWN_RPC_TAIL_BYTES } from './teardown_rpc_flake.mjs';

/**
 * How long after child EXIT to keep waiting for the stdio streams to close.
 * Normally close follows exit within milliseconds; a leaked grandchild that
 * inherited the leg's pipes (a stray server or watcher) would otherwise hold
 * this promise, and with it a required check, indefinitely. After the
 * deadline the runner resolves with the tail it has AND unrefs the pipe
 * handles, so the process itself can exit too (resolving alone was not
 * enough: the fix-round verifier measured the job still waiting 8 seconds
 * for the grandchild to let go). The mirror listeners stay attached, so any
 * late output still reaches the log while the event loop lives.
 */
export const DEFAULT_DRAIN_DEADLINE_MS = 10_000;

/**
 * One leg's log header, shared with the entry's --plan-only printer so the
 * two modes cannot drift apart.
 *
 * @param {{ name: string, cmd: string, args: string[] }} leg
 * @returns {string}
 */
export function formatLegHeader({ name, cmd, args }) {
  return `\n[ci-shard] ${name}: ${cmd} ${args.join(' ')}`;
}

/**
 * Rolling tail keeper, extracted pure so the MEMORY bound is testable: the
 * final subarray alone would bound the RETURNED tail while the retained
 * chunk list quietly grew without limit against a multi-megabyte log (the
 * mutation audit proved the trim deletable behind that subarray).
 *
 * @param {number} tailBytes
 * @returns {{
 *   push: (chunk: Buffer) => void,
 *   retainedBytes: () => number,
 *   tail: () => string,
 * }}
 */
export function createTailKeeper(tailBytes) {
  /** @type {Buffer[]} */
  const chunks = [];
  let kept = 0;
  return {
    push(chunk) {
      chunks.push(chunk);
      kept += chunk.length;
      while (chunks.length > 1 && kept - chunks[0].length >= tailBytes) {
        kept -= chunks[0].length;
        chunks.shift();
      }
    },
    retainedBytes: () => kept,
    tail: () => Buffer.concat(chunks).subarray(-tailBytes).toString('utf8'),
  };
}

/**
 * Spawn one leg, mirroring its stdout/stderr through with backpressure while
 * keeping a rolling tail of the combined output for classification. No
 * shell, deliberately: argv elements (which embed PR-controlled filenames)
 * pass verbatim to execvp. A spawn failure (ENOENT and friends) resolves as
 * a failed leg rather than rejecting, so the caller's FAIL audit line
 * survives.
 *
 * @param {{
 *   cmd: string,
 *   args: string[],
 *   cwd: string,
 *   out?: { write: (chunk: Buffer) => boolean },
 *   err?: { write: (chunk: Buffer) => boolean },
 *   log?: (line: string) => unknown,
 *   tailBytes?: number,
 *   drainDeadlineMs?: number,
 * }} opts
 * @returns {Promise<{ status: number | null, tail: string, spawnError?: Error }>}
 */
export function runLeg({
  cmd,
  args,
  cwd,
  out = process.stdout,
  err = process.stderr,
  log = console.log,
  tailBytes = TEARDOWN_RPC_TAIL_BYTES,
  drainDeadlineMs = DEFAULT_DRAIN_DEADLINE_MS,
}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ['inherit', 'pipe', 'pipe'] });
    const keeper = createTailKeeper(tailBytes);
    const keep = keeper.push;
    // Mirror with backpressure: when the parent's pipe reports saturation,
    // pause the child stream until drain, exactly the pressure the child
    // felt under the old stdio-inherit wiring.
    const mirror = (src, dst) => {
      src?.on('data', (chunk) => {
        keep(chunk);
        if (!dst.write(chunk)) {
          src.pause();
          dst.once('drain', () => src.resume());
        }
      });
    };
    mirror(child.stdout, out);
    mirror(child.stderr, err);
    let settled = false;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let drainTimer;
    const finish = (status, spawnError) => {
      if (settled) return;
      settled = true;
      if (drainTimer) clearTimeout(drainTimer);
      const tail = keeper.tail();
      resolve(spawnError ? { status, tail, spawnError } : { status, tail });
    };
    child.on('error', (spawnError) => finish(null, spawnError));
    child.on('exit', (code) => {
      // close (below) is the normal finish: it fires once the streams have
      // drained, so the tail is complete. The deadline only covers the
      // leaked-grandchild case where the pipes never close.
      drainTimer = setTimeout(() => {
        log(
          `[ci-shard] leg exited (${code ?? 'killed'}) but its stdio stayed open for ` +
            `${drainDeadlineMs} ms (a spawned process may still hold the pipes); ` +
            'continuing with the output captured so far',
        );
        // Unref the pipe handles so the PROCESS can exit as well as the
        // promise: the entry finishes via exitCode (never a forced exit),
        // so a still-referenced pipe held by a grandchild would keep the
        // job alive to its workflow timeout even after this resolve.
        child.stdout?.unref?.();
        child.stderr?.unref?.();
        finish(code);
      }, drainDeadlineMs);
      drainTimer.unref?.();
    });
    child.on('close', (code) => finish(code));
  });
}

/**
 * Run every leg in order with the single sanctioned flake retry. Returns the
 * first failure (after any retry) or ok; printing of headers, the retry
 * banner, the annotation, and the FAIL line happens here so the policy and
 * its audit trail stay in one tested place.
 *
 * @param {{
 *   legs: Array<{ name: string, cmd: string, args: string[] }>,
 *   cwd: string,
 *   log?: (line: string) => unknown,
 *   error?: (line: string) => unknown,
 *   annotate?: (line: string) => unknown,
 *   runLegImpl?: typeof runLeg,
 * }} opts
 * @returns {Promise<{ ok: boolean, status: number, retriedLegNames: string[] }>}
 */
export async function runLegsWithFlakeRetry({
  legs,
  cwd,
  log = console.log,
  error = console.error,
  annotate = defaultAnnotate,
  runLegImpl = runLeg,
}) {
  // Shared across all legs: one process, one retry, ever.
  let flakeRetryBudget = 1;
  /** @type {string[]} */
  const retriedLegNames = [];
  for (const leg of legs) {
    log(formatLegHeader(leg));
    // log is forwarded so the drain-deadline note follows the same sink as
    // every other audit line instead of bypassing an injected one.
    let res = await runLegImpl({ cmd: leg.cmd, args: leg.args, cwd, log });
    if (res.status !== 0 && !res.spawnError && flakeRetryBudget > 0 && isTeardownRpcFlake(res)) {
      flakeRetryBudget -= 1;
      retriedLegNames.push(leg.name);
      log(
        `\n[ci-shard] known-flake retry: "${leg.name}" exited 1 with the teardown-rpc ` +
          'signature (every test passed; EnvironmentTeardownError: Closing rpc while ' +
          '"onUserConsoleLog" was pending). Retrying this one leg once; no other failure ' +
          'mode ever retries (docs/qa-gate.md, "Known-flake handling").',
      );
      annotate(
        `::warning title=ci-shard known-flake retry::"${leg.name}" hit the teardown-rpc ` +
          'signature (all tests passed, exit 1 in teardown) and was retried once; see the ' +
          'job log for the banner',
      );
      res = await runLegImpl({ cmd: leg.cmd, args: leg.args, cwd, log });
    }
    if (res.status !== 0) {
      if (res.spawnError) {
        error(`\n[ci-shard] spawn error at "${leg.name}": ${res.spawnError.message}`);
      }
      error(
        `\n[ci-shard] FAIL at "${leg.name}" (exit ${res.status ?? 'killed'})` +
          (retriedLegNames.length > 0
            ? `; known-flake retry already used on: ${retriedLegNames.join(', ')}`
            : ''),
      );
      return { ok: false, status: res.status ?? 1, retriedLegNames };
    }
  }
  return { ok: true, status: 0, retriedLegNames };
}

// The annotation is a GitHub workflow command; keep it off local runs so a
// terminal never shows raw ::warning lines.
function defaultAnnotate(line) {
  if (process.env.GITHUB_ACTIONS === 'true') console.log(line);
}
