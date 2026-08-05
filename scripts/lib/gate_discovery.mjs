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
  const upstream = run('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  if (upstream.status === 0 && upstream.stdout?.trim()) {
    return { base: upstream.stdout.trim(), reason: 'tracking branch (@{upstream})' };
  }
  for (const candidate of ['origin/HEAD', 'origin/main']) {
    const probe = run('git', ['rev-parse', '--verify', `${candidate}^{commit}`]);
    if (probe.status === 0) return { base: candidate, reason: `fallback base ${candidate}` };
  }
  return { base: null, reason: 'no upstream and no origin base could be resolved' };
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
