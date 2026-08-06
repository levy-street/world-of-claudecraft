// Pure planning helpers for scripts/gate_select.mjs, the selective gate.
// Kept free of spawn/fs/git so Vitest can pin every branch without a shell.
//
// The selective gate runs the FULL gate's step list (i18n gen + freshness, wiki,
// malware, biome, sfx, browser, typecheck, all four builds) and changes exactly
// one step: the full unsharded vitest run becomes two bounded runs.
//
//   1. always-run   every test whose coverage reaches outside the module graph
//                   (scripts/lib/test_visibility.mjs). `vitest related` can never
//                   select these reliably, so they are never selected at all:
//                   they just always run.
//   2. related      `vitest related` over the changed source files, which models
//                   the remaining ~80% of the suite correctly.
//
// Two invocations rather than one because `related` is a subcommand, not a flag,
// so it cannot be mixed with an explicit file list. The overlap between the two
// (a 'partial' test selected by both) re-runs a handful of files and is pure
// wasted time, never a correctness gap.
//
// SAFETY FALLBACK: any change this planner cannot reason about (a broad config
// file, a lockfile, a vitest/vite/tsconfig edit) drops the whole plan to the FULL
// suite. Selection is an optimization for changes we understand; anything else
// gets the old bar. Failing toward MORE tests is the only safe direction, since
// a selection miss is silent.

import {
  isNonCodePath,
  isRelatedSourcePath,
  isTestPath,
  normalizeRepoPath,
} from './gate_fast_plan.mjs';

// NOTE: this deliberately does NOT reuse gate_fast_plan's isBroadConfigPath.
// That predicate means the OPPOSITE thing there: gate:fast uses it to EXCLUDE a
// path from `vitest --changed` (because expanding on it would run nearly the
// whole suite), whereas here the same class of path must FORCE the whole suite.
// Reusing it would have inverted the safety fallback.
//
// It is also incomplete for this purpose: it still names `package-lock.json`,
// which the Phase 7 pnpm migration removed, and never learned `pnpm-lock.yaml`.
// Under gate_fast_plan's own rules a lockfile change falls through to
// isNonCodePath (.yaml / .lock) and is treated as inert. For the merge bar that
// would be a silent hole: a dependency bump could change behavior anywhere and
// select nothing.
const FULL_SUITE_TRIGGER_RE =
  /^(package\.json|package-lock\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.npmrc|turbo\.json|biome\.json|vite\.config\.[cm]?[jt]s|vitest(?:\..+)?\.config\.[cm]?[jt]s|tsconfig(?:\..+)?\.json)$/;

/**
 * Changes that must widen the run to the FULL suite: build/test/dependency
 * configuration whose blast radius the import graph cannot express.
 *
 * @param {string} p
 * @returns {boolean}
 */
export function isFullSuiteTrigger(p) {
  const n = normalizeRepoPath(p);
  if (!n) return false;
  const base = n.includes('/') ? n.slice(n.lastIndexOf('/') + 1) : n;
  if (FULL_SUITE_TRIGGER_RE.test(base)) return true;
  // Vitest setup/global-setup and the shared test helpers change behavior for
  // every file that runs, so they can never be narrowed either.
  if (n.startsWith('tests/helpers/') || n.startsWith('tests/fixtures/')) return true;
  if (/^tests\/(global_setup|jsdom_local_storage_setup)\.[cm]?ts$/.test(n)) return true;
  return false;
}

/**
 * @typedef {'full' | 'selective'} SelectMode
 * @typedef {{
 *   mode: SelectMode,
 *   reason: string,
 *   alwaysRunFiles: string[],
 *   relatedSources: string[],
 *   changedTestFiles: string[],
 * }} SelectPlan
 */

/**
 * Split a changed-path list into the buckets the plan needs.
 *
 * @param {string[]} paths
 * @returns {{
 *   testFiles: string[],
 *   relatedSources: string[],
 *   broadConfigs: string[],
 *   nonCode: string[],
 * }}
 */
export function classifySelectPaths(paths) {
  const testFiles = [];
  const relatedSources = [];
  const broadConfigs = [];
  const nonCode = [];
  for (const raw of paths ?? []) {
    const p = normalizeRepoPath(raw);
    if (!p) continue;
    if (isFullSuiteTrigger(p)) {
      broadConfigs.push(p);
      continue;
    }
    if (isTestPath(p)) {
      testFiles.push(p);
      continue;
    }
    if (isRelatedSourcePath(p)) {
      relatedSources.push(p);
      continue;
    }
    // A TypeScript declaration file is erased at runtime, so it cannot change
    // behavior any test could observe; it can only change what `tsc` accepts,
    // and check:types runs in FULL on every selective gate. Without this arm a
    // .d.mts lands in the unrecognized bucket and forces the whole suite, which
    // fires on every new scripts/lib module (each ships a hand-written .d.mts).
    if (/\.d\.[cm]?ts$/.test(p)) {
      nonCode.push(p);
      continue;
    }
    if (isNonCodePath(p)) {
      nonCode.push(p);
      continue;
    }
    // Anything unrecognized is treated as a reason to widen, not narrow.
    broadConfigs.push(p);
  }
  return { testFiles, relatedSources, broadConfigs, nonCode };
}

/**
 * Build the selective plan.
 *
 * @param {{
 *   changedPaths: string[],
 *   alwaysRunFiles: string[],
 * }} opts
 * @returns {SelectPlan}
 */
export function buildSelectPlan({ changedPaths, alwaysRunFiles }) {
  const always = [...new Set(alwaysRunFiles ?? [])].sort();
  const { testFiles, relatedSources, broadConfigs } = classifySelectPaths(changedPaths);

  if (broadConfigs.length > 0) {
    return {
      mode: 'full',
      reason: `broad/unclassified change (${broadConfigs.slice(0, 3).join(', ')}${
        broadConfigs.length > 3 ? ', ...' : ''
      }): running the full suite`,
      alwaysRunFiles: always,
      relatedSources: [],
      changedTestFiles: testFiles,
    };
  }

  // A changed test file always runs, whether or not the graph would pick it.
  const alwaysWithChangedTests = [...new Set([...always, ...testFiles])].sort();

  if (relatedSources.length === 0 && testFiles.length === 0) {
    return {
      mode: 'selective',
      reason: 'no code or test changes: always-run set only',
      alwaysRunFiles: alwaysWithChangedTests,
      relatedSources: [],
      changedTestFiles: testFiles,
    };
  }

  return {
    mode: 'selective',
    reason: `${relatedSources.length} changed source file(s), ${testFiles.length} changed test file(s)`,
    alwaysRunFiles: alwaysWithChangedTests,
    relatedSources,
    changedTestFiles: testFiles,
  };
}

/**
 * Vitest argv for the always-run leg.
 *
 * @param {{ files: string[], workers: number }} opts
 * @returns {string[]}
 */
export function buildAlwaysRunArgs({ files, workers }) {
  return ['run', ...files, `--maxWorkers=${workers}`];
}

/**
 * Vitest argv for the `related` leg, or null when there is nothing to relate.
 *
 * @param {{ sources: string[], workers: number }} opts
 * @returns {string[] | null}
 */
export function buildRelatedArgs({ sources, workers }) {
  if (!sources || sources.length === 0) return null;
  return ['related', ...sources, '--run', '--passWithNoTests', `--maxWorkers=${workers}`];
}

/**
 * Vitest argv for the full-suite fallback.
 *
 * @param {{ workers: number }} opts
 * @returns {string[]}
 */
export function buildFullSuiteArgs({ workers }) {
  return ['run', `--maxWorkers=${workers}`];
}
