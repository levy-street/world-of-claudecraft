// Shared discovery for the selective gate: which test files exist, and which
// paths changed. Both gate_select.mjs and gate_shadow.mjs use these, so the two
// cannot disagree about what they are reasoning over.
//
// They were duplicated per-script in the first cut and had already drifted
// (shadow's changed-path collector was missing the untracked-files leg), which
// meant the validator was validating a different plan than the gate executed.
// One definition, imported twice.
//
// fs and git access are injected so Vitest pins the real logic rather than a
// replica of it.

/**
 * Vitest's own default include is `**\/*.{test,spec}.?(c|m)[jt]s?(x)`, and
 * vite.config.ts excludes node_modules, dist, the agent-runtime dirs, .worktrees,
 * .venv, tmp/, tests/browser/, and *.browser.test.ts. Discovery MUST match, or
 * the always-run set silently omits files the full suite runs: the first cut
 * matched only `.test.ts` and skipped every directory named `helpers`, hiding 20
 * collected files (5 `.test.mjs`, 15 under `helpers/`), 8 of which classify as
 * blind. `tests/helpers/scan_guard_self_audit.test.ts` was one of them, so a
 * scan-guard convention break would fail the full gate and pass the selective one.
 */
export const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;

/** Directory names never walked (mirrors the vite.config.ts exclude list). */
export const SKIP_DIRS = Object.freeze([
  'node_modules',
  'dist',
  '.claude',
  '.codex',
  '.agents',
  '.worktrees',
  '.venv',
  'tmp',
  'browser',
]);

/**
 * True when vitest's default run collects this file.
 * @param {string} relPath repo-relative, POSIX slashes
 * @returns {boolean}
 */
export function isCollectedTestFile(relPath) {
  const p = String(relPath ?? '');
  if (!TEST_FILE_RE.test(p)) return false;
  // The opt-in Playwright suite has its own config and never joins a bare run.
  if (p.includes('.browser.test.')) return false;
  if (p.split('/').some((seg) => SKIP_DIRS.includes(seg))) return false;
  return true;
}

/**
 * Walk a tree and return every test file vitest would collect.
 *
 * @param {{
 *   root: string,
 *   dir: string,
 *   readdirSync: (p: string, o: { withFileTypes: true }) => Array<{ name: string, isDirectory(): boolean }>,
 *   join: (...parts: string[]) => string,
 *   relative: (from: string, to: string) => string,
 *   sep: string,
 * }} io
 * @returns {string[]} repo-relative POSIX paths, sorted
 */
export function listTestFiles(io) {
  const { root, dir, readdirSync, join, relative, sep } = io;
  /** @type {string[]} */
  const out = [];
  /** @param {string} current */
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.includes(entry.name)) continue;
        walk(full);
        continue;
      }
      const rel = relative(root, full).split(sep).join('/');
      if (isCollectedTestFile(rel)) out.push(rel);
    }
  };
  walk(dir);
  out.sort();
  return out;
}

/**
 * Resolve the base ref the branch diff is taken against.
 *
 * The first cut defaulted to `git diff HEAD`, which is the WORKING TREE only. On
 * a clean committed branch that returns nothing, so the planner reported "no code
 * changes", skipped the related leg entirely, and the gate passed green having
 * tested none of the branch's impact. That is the exact opposite of this design's
 * failing-toward-more-tests rule, and it fires at the natural merge-bar moment.
 * A merge bar diffs the BRANCH, so the base is resolved here and its absence is
 * an error rather than a silent narrowing.
 *
 * @param {{ env?: Record<string, string | undefined>, run: (cmd: string, args: string[]) => { status: number | null, stdout?: string } }} io
 * @returns {{ base: string | null, reason: string }}
 */
export function resolveSelectBase({ env = {}, run }) {
  const explicit = env.GATE_SELECT_BASE?.trim();
  if (explicit) {
    const ok = run('git', ['rev-parse', '--verify', `${explicit}^{commit}`]);
    if (ok.status !== 0) {
      return { base: null, reason: `GATE_SELECT_BASE="${explicit}" does not resolve to a commit` };
    }
    return { base: explicit, reason: `GATE_SELECT_BASE=${explicit}` };
  }
  // NOT @{upstream}. A feature branch tracks its own pushed copy, so
  // `@{upstream}...HEAD` is EMPTY the moment you push, and an empty changed set
  // is precisely the silent-narrowing failure this resolution exists to prevent.
  // The integration base is what the diff must be taken against: this repo bases
  // work on the latest release branch (root CLAUDE.md), with main as the fallback.
  const releases = run('git', [
    'for-each-ref',
    '--format=%(refname:short)',
    '--sort=-v:refname',
    'refs/remotes/origin/release',
  ]);
  const newestRelease =
    releases.status === 0
      ? (releases.stdout ?? '')
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)[0]
      : undefined;
  for (const candidate of [newestRelease, 'origin/main', 'origin/HEAD'].filter(Boolean)) {
    const probe = run('git', ['rev-parse', '--verify', `${candidate}^{commit}`]);
    if (probe.status === 0) return { base: candidate, reason: `integration base ${candidate}` };
  }
  return { base: null, reason: 'no release branch or origin base could be resolved' };
}

/**
 * Every path this branch changed: committed since the merge base, plus anything
 * dirty or untracked in the working tree.
 *
 * A failing `git` invocation THROWS rather than contributing an empty list. The
 * first cut swallowed a non-zero status, so an unfetched base or a typo'd
 * GATE_SELECT_BASE silently produced an empty changed set, which narrows the run
 * to nothing and passes.
 *
 * @param {{ base: string | null, run: (cmd: string, args: string[]) => { status: number | null, stdout?: string, stderr?: string } }} io
 * @returns {string[]} sorted, de-duplicated repo-relative paths
 */
export function listChangedPaths({ base, run }) {
  const out = new Set();
  /** @param {string[]} args */
  const collect = (args) => {
    const res = run('git', args);
    if (res.status !== 0) {
      throw new Error(
        `git ${args.join(' ')} failed (exit ${res.status ?? 'killed'}): ${(res.stderr ?? '').trim()}`,
      );
    }
    for (const line of (res.stdout ?? '').split('\n')) {
      const t = line.trim();
      if (t) out.add(t);
    }
  };
  if (base) collect(['diff', '--name-only', `${base}...HEAD`]);
  collect(['diff', '--name-only', 'HEAD']);
  collect(['ls-files', '--others', '--exclude-standard']);
  return [...out].sort();
}

/**
 * Drop paths that no longer exist on disk.
 *
 * A changed-test path comes from `git diff`, which reports DELETIONS too, so
 * deleting a test would otherwise put a dead path into the always-run argv. Most
 * of the time vitest just matches nothing, but a chunk that happens to contain
 * only dead paths exits 1 with "No test files found" and fails the gate on a
 * perfectly legitimate change.
 *
 * @param {{ files: string[], exists: (p: string) => boolean }} opts
 * @returns {string[]}
 */
export function filterExisting({ files, exists }) {
  return (files ?? []).filter((f) => exists(f));
}

/**
 * Compare what selection ran against what the full suite ran.
 *
 * Two numbers, and the distinction matters. `escapes` is the strict signal: a
 * file the full suite FAILED that selection would not have run, i.e. a real
 * change that would have shipped green. But `escapes` is EMPTY on any green
 * branch regardless of how bad selection is, and a branch is usually green at
 * the moment you gate it, so a shadow run reporting "no escapes" is mostly
 * saying "nothing was broken", not "selection is sound".
 *
 * `unselected` is the always-available signal: every file the full suite ran
 * that selection skipped. It is not a defect list (skipping tests is the entire
 * point), it is the surface where an escape COULD hide, so it is what a reviewer
 * actually studies when deciding whether to trust selection.
 *
 * @param {{ selected: Set<string>, fullRan: Set<string>, fullFailed: Set<string> }} opts
 * @returns {{ escapes: string[], unselected: string[], selectedCount: number, fullCount: number }}
 */
export function compareSelection({ selected, fullRan, fullFailed }) {
  const escapes = [...fullFailed].filter((f) => !selected.has(f)).sort();
  const unselected = [...fullRan].filter((f) => !selected.has(f)).sort();
  return { escapes, unselected, selectedCount: selected.size, fullCount: fullRan.size };
}

/**
 * Split a file list into argv chunks that stay under a command-line limit.
 *
 * cmd.exe caps a command line at 8191 characters and gate.mjs spawns with
 * `shell: true` on win32, so passing ~500 test paths (about 16.5k characters) as
 * one argv cannot launch there at all.
 *
 * @param {{ files: string[], limit?: number }} opts
 * @returns {string[][]}
 */
export function chunkFileArgs({ files, limit = 6000 }) {
  /** @type {string[][]} */
  const chunks = [];
  /** @type {string[]} */
  let current = [];
  let length = 0;
  for (const file of files) {
    const cost = file.length + 1;
    if (current.length > 0 && length + cost > limit) {
      chunks.push(current);
      current = [];
      length = 0;
    }
    current.push(file);
    length += cost;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
