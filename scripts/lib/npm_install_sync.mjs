// Pure parse/format logic for the gate's dependency-sync preflight
// (scripts/gate.mjs). A local checkout can drift from pnpm-lock.yaml without
// anyone noticing: a stray `pnpm add <pkg>` bumps a version, or a long-lived
// checkout just gets stale. CI always re-syncs with `pnpm install --frozen-lockfile`,
// but a local `npm run gate` / `pnpm run gate` has no such reset between sessions.
// The drift then surfaces many minutes later as a confusing tsc or build failure
// that looks like a real regression (a bumped `three` can change public type
// shapes enough to fail `tsc --noEmit`) but is actually just an out-of-sync
// install. Catching it with `npm ls --depth=0 --json` up front still works under
// pnpm's symlink layout, costs under a second, and fails with a message that
// names the actual problem instead of a downstream symptom.

// Only these two `npm ls` problem classes reflect the failure mode this preflight
// targets: an installed version that does not satisfy what package.json (and
// therefore pnpm-lock.yaml) declares. `extraneous:` (an unlisted package left
// over in node_modules, e.g. after a dependency was removed) does not change what
// any declared import resolves to, so it cannot itself break tsc or a build; no
// CI job runs `npm run gate` (CI always starts from a fresh frozen install), so a
// prefix this preflight doesn't recognize has no other gate to catch a
// false-positive block, and the gate stays silent on it rather than stopping
// every local run over a problem class that was never the one causing failures.
const BLOCKING_PROBLEM_PREFIXES = ['missing:', 'invalid:'];

function stringifyProblem(p) {
  if (typeof p === 'string') return p;
  try {
    return JSON.stringify(p);
  } catch {
    return String(p);
  }
}

/**
 * Extracts the blocking subset of `npm ls --json`'s `problems` list. npm emits
 * valid JSON on stdout whether or not the tree is in sync; only truly unparsable
 * output (not JSON at all) is treated as a hard failure of the check itself. A
 * non-string entry is stringified rather than dropped, so an unrecognized problem
 * shape from a future npm version is still visible in the message even though it
 * won't match a blocking prefix (see BLOCKING_PROBLEM_PREFIXES above).
 */
export function parseInstallProblems(rawStdout) {
  let parsed;
  try {
    parsed = JSON.parse(rawStdout);
  } catch {
    throw new Error(
      'npm ls --depth=0 --json did not produce valid JSON; cannot verify node_modules is in sync',
    );
  }
  const problems = parsed?.problems;
  if (!Array.isArray(problems)) return [];
  return problems
    .map(stringifyProblem)
    .filter((p) => BLOCKING_PROBLEM_PREFIXES.some((prefix) => p.startsWith(prefix)));
}

/**
 * Decides whether gate.mjs should even attempt the dependency-sync check from a
 * completed `spawnSync('npm', ['ls', ...])` result. `error` set means npm itself
 * could not be spawned (e.g. not on PATH) or spawnSync hit its own limit
 * (maxBuffer/timeout): in either case `stdout` may be missing or a truncated
 * fragment, and parsing it would either throw on partial JSON or, worse, succeed
 * on a fragment that happens to parse. Skipping is the safer choice: a problem
 * this preflight cannot reliably observe is not evidence of drift, and the
 * unrelated cause (npm missing, output too large) gets no clearer by us trying to
 * interpret output that was never fully produced.
 */
export function shouldCheckInstallSync({ error, stdout }) {
  return error === undefined && typeof stdout === 'string';
}

/** Formats a non-empty blocking-problems list into the gate's failure message. */
export function formatInstallSyncFailure(problems) {
  const count = `${problems.length} problem${problems.length === 1 ? '' : 's'}`;
  return (
    `node_modules does not match what pnpm-lock.yaml would install (npm ls --depth=0 reported ${count}):\n` +
    problems.map((p) => `  - ${p}`).join('\n') +
    '\n\nRun `pnpm install --frozen-lockfile` to reinstall exactly what the lockfile pins, then re-run the gate. ' +
    'A drifted install can fail typecheck or a build step in a way that looks like a real ' +
    'regression in your change but is actually environment drift.'
  );
}
