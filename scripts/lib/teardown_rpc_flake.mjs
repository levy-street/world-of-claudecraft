// Exact-signature detector for the vitest worker-teardown RPC flake, the ONE
// known-flake class CI is sanctioned to auto-retry (CI/CD performance packet,
// Phase 6). The packet's non-goals forbid any blanket retry policy because
// retries hide real regressions; everything in here exists to keep the match
// narrow enough that nothing else can ride it.
//
// The signature, first recorded 2026-08-05 (PR #2935, three hits in one
// evening, and repeatedly since on loaded runners): the vitest summary shows
// every test file and every test PASSED, but the process exits 1 with an
// unhandled `EnvironmentTeardownError: [vitest-worker]: Closing rpc while
// "onUserConsoleLog" was pending`: a worker-teardown race on the console-log
// RPC in suites that log near teardown. It is not a test failure and not
// diff-related, so retrying exactly this signature papers over nothing.
//
// Deliberately narrow, each arm pinned by tests/teardown_rpc_flake.test.ts:
// exit status must be exactly 1 (a signal kill or any other code never
// matches); BOTH final summary lines must be present in the captured tail
// and show only passing buckets (skipped and todo are fine, any `failed`
// bucket disqualifies); the exact quoted RPC message must be present; and
// the summary's `Errors N error(s)` count must EQUAL the number of
// teardown-rpc occurrences in the tail, so a run carrying any other
// unhandled error beside the flake never retries (multiple workers can hit
// the same race, so the count is compared, never pinned to one; a truncated
// tail under-counts occurrences and therefore fails closed). Anything else
// fails the job exactly as it always did.
//
// Honesty note on what this predicate is: a narrowing filter, not an
// integrity boundary. Test output is not trusted input (a test already
// executes arbitrary code in the job), so a forged tail is conceivable; the
// property that actually holds is the retry POLICY in ci_leg_runner.mjs (at
// most one rerun of the same leg per job, always logged). Do not relax this
// classifier on the theory that the summary parse proves anything.

/**
 * Rolling-tail size the leg runner keeps for classification. The vitest
 * summary and the unhandled-rejection banner both print at the very end of a
 * run, so a bounded tail is enough and keeps memory flat against the
 * multi-megabyte full-suite logs.
 */
export const TEARDOWN_RPC_TAIL_BYTES = 256 * 1024;

/** The exact unhandled-rejection message of the known flake. */
export const TEARDOWN_RPC_MESSAGE = 'Closing rpc while "onUserConsoleLog" was pending';

// CI logs can carry ANSI escape sequences around the summary labels and
// buckets; strip them defensively before matching (harmless when absent).
// The escape byte is spelled via fromCharCode because a control character in
// a regex literal trips the suspicious-regex lint, and biome auto-rewrites a
// plain-string constructor back into that literal.
const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

/**
 * Final occurrence of a summary line for the given label ("Test Files",
 * "Tests", or "Errors"), or null when the tail holds none. Last occurrence
 * wins so a tail that somehow holds two summaries is judged on the final
 * one.
 *
 * @param {string} text
 * @param {string} label
 * @returns {string | null}
 */
function lastSummaryBuckets(text, label) {
  const re = new RegExp(`^\\s*${label} {2,}(.+)$`, 'gm');
  let buckets = null;
  for (const match of text.matchAll(re)) {
    buckets = match[1];
  }
  return buckets;
}

/**
 * A summary bucket list counts as all-passing when it has a passed bucket and
 * no failed bucket. Skipped and todo buckets are allowed: the full suite
 * carries DB-gated skips on every healthy run.
 *
 * @param {string} buckets
 * @returns {boolean}
 */
function isAllPassing(buckets) {
  return /\bpassed\b/.test(buckets) && !/\bfailed\b/.test(buckets);
}

/**
 * @param {string} text
 * @param {string} needle
 * @returns {number}
 */
function countOccurrences(text, needle) {
  let count = 0;
  let index = text.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * True exactly when a finished leg matches the teardown-rpc flake signature:
 * exit code 1, both summary lines all-passing, the exact RPC message in the
 * tail, and every counted unhandled error accounted for by that message.
 * This is the only predicate the leg runner may retry on.
 *
 * @param {{ status: number | null, tail: string }} result
 * @returns {boolean}
 */
export function isTeardownRpcFlake({ status, tail }) {
  if (status !== 1) return false;
  if (typeof tail !== 'string' || tail === '') return false;
  // Workflow-command lines are dropped before counting: with
  // GITHUB_ACTIONS=true vitest auto-enables its github-actions reporter,
  // which can RE-EMIT the unhandled error as a `::error ...` annotation
  // line, and that duplicate would make the occurrence count exceed the
  // summary's error count and silently veto the retry in CI (the audit
  // reproduced both arms against real vitest 4.1.10: annotation emitted
  // for project-frame stacks, skipped for vitest-internal ones).
  const text = tail
    .replace(ANSI_RE, '')
    .replace(/\r/g, '')
    .split('\n')
    .filter((line) => !/^::[a-z-]+/.test(line))
    .join('\n');
  if (!text.includes('EnvironmentTeardownError')) return false;
  const occurrences = countOccurrences(text, TEARDOWN_RPC_MESSAGE);
  if (occurrences < 1) return false;
  const files = lastSummaryBuckets(text, 'Test Files');
  const tests = lastSummaryBuckets(text, 'Tests');
  if (files === null || tests === null) return false;
  if (!isAllPassing(files) || !isAllPassing(tests)) return false;
  // The whole exit-1 reason must be the flake: the summary's error count has
  // to be fully explained by teardown-rpc occurrences. A run that also
  // carries a genuine unhandled error (count higher than occurrences), or a
  // truncated tail (occurrences higher than the count says, or no Errors
  // line at all), never retries.
  const errors = lastSummaryBuckets(text, 'Errors');
  if (errors === null) return false;
  const errorCount = errors.match(/^(\d+) errors?\b/);
  if (!errorCount) return false;
  return Number(errorCount[1]) === occurrences;
}
