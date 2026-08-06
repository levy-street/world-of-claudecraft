// Pure per-shard planning for the PR-tier CI test step (scripts/ci_shard_test.mjs).
// Phase 2 of the CI/CD performance packet (docs/qa-gate.md, "Selective PR-tier CI").
//
// The `changes` job decides the MODE (lib/ci_test_select.mjs) and relays the
// changed-path list; each pr-gate shard job then builds its own legs here:
//
//   full        exactly today's step: `npm test -- --shard=i/N` (pretest and
//               all). The fall-back is byte-identical to the pre-selection
//               behavior, so a fail-closed decision can never cost coverage.
//   selective   two sharded legs. Leg 1 runs the always-run FLOOR through
//               `npm test` (its pretest regenerates the i18n artifacts the
//               guard suites read, in every shard, exactly as today). Leg 2
//               runs `vitest related` over the changed sources; pretest has
//               already run by then.
//
// THE FLOOR. Selection's failure mode is silent (a skipped test does not
// error), so the floor is a union of three sets, each guarding a different way
// selection can under-run:
//   1. every test lib/test_visibility.mjs classifies blind or partial,
//      recomputed from source in the shard job itself so it cannot go stale;
//   2. the invariant guard suites named below, INCLUDING graph-visible ones:
//      the repo treats these as un-skippable regardless of what the diff looks
//      like, and listing them here keeps that true even if their classification
//      or the import graph shifts underneath them;
//   3. every test file the PR itself changed.
//
// Sharding: vitest partitions the COLLECTED file set, so `--shard=i/N` on an
// explicit file list (leg 1) and on a related run (leg 2) each split their own
// set 8 ways. The two legs may overlap on partial tests; that re-runs a few
// files and is wasted time, never a correctness gap.

import { isRelayablePath } from './ci_test_select.mjs';
import { classifySelectPaths } from './gate_select_plan.mjs';

/**
 * Guard suites the repo treats as invariants: they run on every selective
 * shard regardless of the diff and regardless of how they classify.
 * (architecture and the localization guards classify blind/partial today, so
 * for them this list is documentation plus drift insurance; the parity pins
 * are graph-visible and genuinely need it.)
 */
export const CI_GUARD_SUITES = Object.freeze([
  'tests/architecture.test.ts',
  'tests/localization_fixes.test.ts',
  'tests/localization_coverage.test.ts',
  'tests/world_api_parity.test.ts',
]);

/** Directory prefixes whose every collected test joins the floor (parity pins). */
export const CI_GUARD_PREFIXES = Object.freeze(['tests/parity/']);

/**
 * If the recomputed blind/partial floor ever collapses below this, the
 * classifier is broken and selection cannot be trusted; the plan falls back to
 * the full suite. Mirrors the >300 sanity floor tests/gate_select_plan.test.ts
 * pins over the real suite (well above 500 as of Phase 2).
 */
export const FLOOR_SANITY_MIN = 300;

/**
 * Parse `--shard=i/N` argv form. Returns null when absent or malformed; the
 * entry treats null as a configuration error (loud), not a fallback: the shard
 * index comes from the workflow matrix, never from untrusted input.
 *
 * @param {string[]} argv
 * @returns {{ index: number, total: number } | null}
 */
export function parseShardArg(argv) {
  for (const arg of argv ?? []) {
    const m = /^--shard=([1-9]\d*)\/([1-9]\d*)$/.exec(arg);
    if (m) {
      const index = Number(m[1]);
      const total = Number(m[2]);
      if (index <= total) return { index, total };
    }
  }
  return null;
}

/**
 * Resolve the floor for a selective run.
 *
 * @param {{
 *   alwaysRun: string[],
 *   testFiles: string[],
 *   changedTestFiles: string[],
 * }} opts
 * @returns {{ floor: string[], missingGuards: string[] }}
 */
export function buildFloor({ alwaysRun, testFiles, changedTestFiles }) {
  const collected = new Set(testFiles ?? []);
  const floor = new Set(alwaysRun ?? []);
  const missingGuards = [];
  for (const guard of CI_GUARD_SUITES) {
    if (collected.has(guard)) floor.add(guard);
    else missingGuards.push(guard);
  }
  for (const prefix of CI_GUARD_PREFIXES) {
    const matched = (testFiles ?? []).filter((f) => f.startsWith(prefix));
    if (matched.length === 0) missingGuards.push(prefix);
    for (const f of matched) floor.add(f);
  }
  for (const t of changedTestFiles ?? []) floor.add(t);
  return { floor: [...floor].sort(), missingGuards };
}

/**
 * @typedef {{ name: string, cmd: string, args: string[] }} ShardLeg
 */

/**
 * Build the legs one shard executes.
 *
 * Every fall-back path returns the FULL leg with a printed reason: the full
 * suite is exactly today's behavior, so falling back can only cost minutes.
 *
 * @param {{
 *   mode: string,
 *   changedPaths: string[],
 *   alwaysRun: string[],
 *   testFiles: string[],
 *   shard: { index: number, total: number },
 *   workers: number,
 *   exists: (p: string) => boolean,
 * }} opts
 * @returns {{ mode: 'full' | 'selective', reason: string, legs: ShardLeg[], floorCount?: number, relatedCount?: number, outsideFloorCount?: number }}
 */
export function buildShardPlan({
  mode,
  changedPaths,
  alwaysRun,
  testFiles,
  shard,
  workers,
  exists,
}) {
  const shardArg = `--shard=${shard.index}/${shard.total}`;
  const workersArg = `--maxWorkers=${workers}`;
  const fullPlan = (reason) => ({
    mode: 'full',
    reason,
    legs: [
      {
        name: `npm test (full suite, shard ${shard.index}/${shard.total})`,
        cmd: 'npm',
        args: ['test', '--', shardArg, workersArg],
      },
    ],
  });

  if (mode !== 'selective') {
    return fullPlan(
      mode === 'full'
        ? 'mode=full from the changes job'
        : `unrecognized mode ${JSON.stringify(String(mode))}: failing closed to the full suite`,
    );
  }
  if (!Array.isArray(changedPaths)) {
    return fullPlan('no relayed changed-path list: failing closed to the full suite');
  }
  // Same relay-safety bar the changes job applied (one definition,
  // lib/ci_test_select.mjs): a path that could read as a flag or smuggle
  // control characters never reaches a vitest argv, whatever produced the
  // relayed list.
  if (changedPaths.some((p) => !isRelayablePath(p))) {
    return fullPlan('unsafe relayed path: failing closed to the full suite');
  }
  if ((alwaysRun?.length ?? 0) < FLOOR_SANITY_MIN) {
    return fullPlan(
      `computed always-run floor has ${alwaysRun?.length ?? 0} files (sanity minimum ${FLOOR_SANITY_MIN}): classification collapsed, failing closed to the full suite`,
    );
  }

  // Re-bucket the relayed paths with the SAME shared planner the changes job
  // used (lib/gate_select_plan.mjs); a disagreement between the two runs (a
  // broad config the mode decision somehow relayed) widens here too.
  const buckets = classifySelectPaths(changedPaths);
  if (buckets.broadConfigs.length > 0) {
    return fullPlan(
      `relayed path re-classified as broad (${buckets.broadConfigs.slice(0, 3).join(', ')}): failing closed to the full suite`,
    );
  }
  const changedTestFiles = buckets.testFiles;
  const relatedSources = buckets.relatedSources;

  const { floor, missingGuards } = buildFloor({
    alwaysRun,
    testFiles,
    changedTestFiles: changedTestFiles.filter((t) => exists(t)),
  });
  if (missingGuards.length > 0) {
    return fullPlan(
      `guard suite(s) missing from the collected tree (${missingGuards.join(', ')}): failing closed to the full suite`,
    );
  }

  const legs = [
    {
      name: `npm test (always-run floor, ${floor.length} files, shard ${shard.index}/${shard.total})`,
      cmd: 'npm',
      args: ['test', '--', ...floor, shardArg, workersArg],
    },
  ];
  const liveSources = relatedSources.filter((p) => exists(p));
  if (liveSources.length > 0) {
    legs.push({
      name: `vitest related (${liveSources.length} changed source file(s), shard ${shard.index}/${shard.total})`,
      cmd: 'npx',
      args: [
        '--no-install',
        'vitest',
        'related',
        ...liveSources,
        '--run',
        '--passWithNoTests',
        shardArg,
        workersArg,
      ],
    });
  }
  return {
    mode: 'selective',
    reason: `selective: floor ${floor.length} + related over ${liveSources.length} source(s)`,
    legs,
    floorCount: floor.length,
    relatedCount: liveSources.length,
    outsideFloorCount: Math.max(0, (testFiles?.length ?? 0) - floor.length),
  };
}
