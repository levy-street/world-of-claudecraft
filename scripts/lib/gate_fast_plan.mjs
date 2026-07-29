// Pure planning helpers for scripts/gate_fast.mjs (Phase 3 local-gate-perf).
// Kept free of spawn/git so Vitest can pin argv and step shapes without a shell.

/** Always-run high-signal guards (same pair as .githooks/pre-push). */
export const GATE_FAST_GUARD_TESTS = Object.freeze([
  'tests/architecture.test.ts',
  'tests/localization_fixes.test.ts',
]);

/** Paths that make vitest --changed expand to nearly the whole suite. */
const BROAD_CONFIG_RE =
  /^(package\.json|package-lock\.json|vite\.config\.[cm]?[jt]s|vitest(?:\..+)?\.config\.[cm]?[jt]s|tsconfig(?:\..+)?\.json)$/;

const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const CODE_EXT_RE = /\.([cm]?[jt]sx?|mjs|cjs)$/;

/**
 * Normalize a repo-relative path for classification (POSIX slashes).
 * @param {string} p
 */
export function normalizeRepoPath(p) {
  return String(p ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
}

/**
 * @param {string} p
 */
export function isTestPath(p) {
  const n = normalizeRepoPath(p);
  return n.startsWith('tests/') && TEST_FILE_RE.test(n);
}

/**
 * package.json / vitest / vite / tsconfig: do not feed to vitest related/changed.
 * @param {string} p
 */
export function isBroadConfigPath(p) {
  const n = normalizeRepoPath(p);
  const base = n.includes('/') ? n.slice(n.lastIndexOf('/') + 1) : n;
  if (BROAD_CONFIG_RE.test(base)) return true;
  if (n === 'package.json' || n === 'package-lock.json') return true;
  return false;
}

/**
 * Docs and non-code assets never need vitest related expansion.
 * @param {string} p
 */
export function isNonCodePath(p) {
  const n = normalizeRepoPath(p);
  if (!n) return true;
  if (n.endsWith('.md') || n.endsWith('.mdx')) return true;
  if (n.endsWith('.json') && !isBroadConfigPath(n)) return true;
  if (n.startsWith('docs/')) return true;
  if (n.startsWith('public/')) return true;
  if (/\.(png|jpe?g|webp|gif|svg|glb|mp3|wav|ogg|css|html|yml|yaml|toml|lock)$/i.test(n)) {
    return true;
  }
  return false;
}

/**
 * Source that can participate in vitest related (src, server, scripts, headless, ...).
 * @param {string} p
 */
export function isRelatedSourcePath(p) {
  const n = normalizeRepoPath(p);
  if (!n || isTestPath(n) || isBroadConfigPath(n) || isNonCodePath(n)) return false;
  if (!CODE_EXT_RE.test(n)) return false;
  // Declaration stubs are not runtime modules for vitest related.
  if (/\.d\.[cm]?ts$/.test(n)) return false;
  // Skip generated trees and resolved locale blobs.
  if (n.includes('.generated') || n.includes('i18n.resolved.generated')) return false;
  return true;
}

/**
 * Classify git-changed paths for the day-loop vitest step.
 *
 * @param {Iterable<string>} paths
 * @returns {{
 *   testFiles: string[],
 *   relatedSources: string[],
 *   broadConfigs: string[],
 *   nonCode: string[],
 * }}
 */
export function classifyChangedPaths(paths) {
  const testFiles = new Set();
  const relatedSources = setString();
  const broadConfigs = setString();
  const nonCode = setString();

  for (const raw of paths ?? []) {
    const n = normalizeRepoPath(raw);
    if (!n) continue;
    if (isTestPath(n)) testFiles.add(n);
    else if (isBroadConfigPath(n)) broadConfigs.add(n);
    else if (isNonCodePath(n)) nonCode.add(n);
    else if (isRelatedSourcePath(n)) relatedSources.add(n);
    else nonCode.add(n);
  }

  return {
    testFiles: [...testFiles].sort(),
    relatedSources: [...relatedSources].sort(),
    broadConfigs: [...broadConfigs].sort(),
    nonCode: [...nonCode].sort(),
  };
}

function setString() {
  return new Set();
}

/**
 * Pick the git ref for opt-in branch-wide vitest --changed.
 * Default day-loop does not use this (null); set GATE_FAST_BASE to opt in.
 *
 * @param {{ envBase?: string | null | undefined }} [opts]
 * @returns {string | null}
 */
export function resolveFastChangedBase({ envBase } = {}) {
  if (typeof envBase === 'string') {
    const trimmed = envBase.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

/**
 * Build vitest argv for the day-loop related step.
 *
 * Modes:
 * - changedBase set: opt-in `run --changed <base>` (can be huge if package.json differs)
 * - else relatedSources and/or testFiles: `related` or `run` filters (default day-loop)
 * - else skip (docs/config-only; guards already ran)
 *
 * @param {{
 *   workers: number,
 *   changedBase?: string | null,
 *   testFiles?: readonly string[],
 *   relatedSources?: readonly string[],
 * }} opts
 * @returns {{ mode: 'changed' | 'related' | 'run' | 'skip', args: string[] | null, reason?: string }}
 */
export function buildDayLoopVitestPlan({
  workers,
  changedBase = null,
  testFiles = [],
  relatedSources = [],
}) {
  const n = Math.max(1, Math.floor(Number(workers)) || 1);
  const base =
    typeof changedBase === 'string' && changedBase.trim().length > 0 ? changedBase.trim() : null;

  if (base) {
    return {
      mode: 'changed',
      args: ['run', '--passWithNoTests', `--maxWorkers=${n}`, '--changed', base],
      reason: `opt-in GATE_FAST_BASE=${base}`,
    };
  }

  const tests = uniqueSorted(testFiles);
  const sources = uniqueSorted(relatedSources);

  if (sources.length > 0) {
    // vitest related <sources...> [-- filters]; pass test files as extra filters when present.
    return {
      mode: 'related',
      args: ['related', ...sources, ...tests, '--run', '--passWithNoTests', `--maxWorkers=${n}`],
    };
  }

  if (tests.length > 0) {
    return {
      mode: 'run',
      args: ['run', '--passWithNoTests', `--maxWorkers=${n}`, ...tests],
    };
  }

  return {
    mode: 'skip',
    args: null,
    reason:
      'no code or test file changes (docs/config-only); guards already covered architecture + i18n',
  };
}

/**
 * Build argv for the always-on guard vitest step.
 *
 * @param {{ workers: number, guardFiles?: readonly string[] }} opts
 * @returns {string[]}
 */
export function buildGuardVitestArgs({ workers, guardFiles = GATE_FAST_GUARD_TESTS }) {
  const n = Math.max(1, Math.floor(Number(workers)) || 1);
  return ['run', `--maxWorkers=${n}`, ...guardFiles];
}

/**
 * Ordered step names for docs and tests (spawn wiring stays in gate_fast.mjs).
 * Malware is included: ~4s and high signal for agent day-loops.
 *
 * Full merge bar remains `npm run gate`. This list is intentionally a subset.
 */
export const GATE_FAST_STEP_NAMES = Object.freeze([
  'malware scan',
  'biome (changed files)',
  'guard tests (architecture + localization)',
  'typecheck (check:ts incremental)',
  'vitest (related / changed tests)',
]);

/**
 * @param {Iterable<string>} items
 * @returns {string[]}
 */
function uniqueSorted(items) {
  return [...new Set([...(items ?? [])].map(normalizeRepoPath).filter(Boolean))].sort();
}
