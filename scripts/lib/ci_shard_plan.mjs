// Pure per-shard planning for the PR-tier CI test step (scripts/ci_shard_test.mjs).
// Phase 2 of the CI/CD performance packet (docs/qa-gate.md, "Selective PR-tier CI").
//
// The `changes` job decides the MODE (lib/ci_test_select.mjs) and relays the
// changed-path list; each pr-gate shard job then builds its own legs here:
//
//   full        today's step minus the long-sims lane: `npm test -- --shard=i/N`
//               (pretest and all) with the CI_LONG_SUITES files excluded; the
//               dedicated lane job runs exactly those files in the same run,
//               so in FULL mode the shards plus the lane run the whole old
//               suite and a fail-closed decision can never cost coverage.
//   selective   two sharded legs. Leg 1 runs the always-run FLOOR through
//               `npm test` (its pretest regenerates the i18n artifacts the
//               guard suites read, in every shard, exactly as today), minus
//               the lane files, which the lane job carries instead. Leg 2
//               runs `vitest related` over the changed sources; pretest has
//               already run by then. The related leg is deliberately NOT
//               lane-filtered: a lane file it reaches re-runs there, which
//               duplicates work but never opens a gap.
//   lane        the "PR gate (long sims)" job (buildLanePlan): the collected
//               CI_LONG_SUITES files, all of them in full mode and on any
//               unprovable input, only the floor/changed members in selective
//               mode. Both sides fail closed toward their own half, so mode
//               for mode the shards plus the lane run exactly what the
//               pre-lane shard plan would have run (selective mode still
//               skips the outside-floor remainder by design; the audit lines
//               and docs/qa-gate.md carry that accounting).
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
 * Long rotation sims the PR tier runs in the dedicated lane job
 * ("PR gate (long sims)" in ci.yml) instead of inside the shard matrix, so a
 * single multi-minute file stops setting the slowest shard's wall clock.
 * Membership is measured, not automated: a file joins when it costs more than
 * the 90 second threshold inside a full-mode CI shard, and the next-longest
 * file stays sharded (2026-08-06 full-mode run: these four measured 249.5 s,
 * 143.9 s, 142.3 s, and 94.7 s in-shard; the next longest,
 * tests/corpse_harvest_sim.test.ts at 69.8 s, stays). Membership is also
 * one-directional by nature: nothing automatic promotes a newly slowed suite
 * into this list, so when a shard's wall clock grows, remeasure from the
 * shard logs and re-decide the list (the committed contract and the audit
 * lines live in docs/qa-gate.md, "The long-sims lane").
 *
 * release-gate is deliberately NOT lane-split: release/** pushes keep the
 * whole suite in their 8 shards, so the post-merge backstop is untouched.
 */
export const CI_LONG_SUITES = Object.freeze([
  'tests/audit_conservation_property.test.ts',
  'tests/battleground.test.ts',
  'tests/chronomancy_balance.test.ts',
  'tests/eastbrook_gameplay_integration.test.ts',
]);

/**
 * The lane files this tree actually collects. Filtering on the collected set
 * is the fail-safe direction: a lane file the walker cannot see is neither
 * excluded from the shards nor run by the lane, so it stays inside the vitest
 * shards (coverage keeps, latency loses), and the real-tree pin in
 * tests/ci_shard_plan.test.ts makes the drift loud.
 *
 * @param {{ testFiles: string[], exists: (p: string) => boolean }} opts
 * @returns {string[]}
 */
export function collectedLaneFiles({ testFiles, exists }) {
  const collected = new Set(testFiles ?? []);
  return CI_LONG_SUITES.filter((f) => collected.has(f) && exists(f));
}

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
 * Shared fail-closed ladder for the selective plans. Returns either
 * `{ fallback: reason }` (any unprovable input: run everything) or the
 * resolved floor plus related sources. One copy so the shard plan and the
 * lane plan can never drift on what counts as provable: whenever a shard
 * falls back to its full half, the lane falls back to its full half on the
 * same input, keeping the union whole.
 *
 * @param {{
 *   changedPaths: string[],
 *   alwaysRun: string[],
 *   testFiles: string[],
 *   exists: (p: string) => boolean,
 * }} opts
 * @returns {{ fallback: string } | { fallback?: undefined, floor: string[], relatedSources: string[] }}
 */
function resolveSelectiveInputs({ changedPaths, alwaysRun, testFiles, exists }) {
  if (!Array.isArray(changedPaths)) {
    return { fallback: 'no relayed changed-path list: failing closed to the full suite' };
  }
  // Same relay-safety bar the changes job applied (one definition,
  // lib/ci_test_select.mjs): a path that could read as a flag or smuggle
  // control characters never reaches a vitest argv, whatever produced the
  // relayed list.
  if (changedPaths.some((p) => !isRelayablePath(p))) {
    return { fallback: 'unsafe relayed path: failing closed to the full suite' };
  }
  if ((alwaysRun?.length ?? 0) < FLOOR_SANITY_MIN) {
    return {
      fallback: `computed always-run floor has ${alwaysRun?.length ?? 0} files (sanity minimum ${FLOOR_SANITY_MIN}): classification collapsed, failing closed to the full suite`,
    };
  }

  // Re-bucket the relayed paths with the SAME shared planner the changes job
  // used (lib/gate_select_plan.mjs); a disagreement between the two runs (a
  // broad config the mode decision somehow relayed) widens here too.
  const buckets = classifySelectPaths(changedPaths);
  if (buckets.broadConfigs.length > 0) {
    return {
      fallback: `relayed path re-classified as broad (${buckets.broadConfigs.slice(0, 3).join(', ')}): failing closed to the full suite`,
    };
  }

  // Generated i18n artifacts are inert only while PRESENT in the merge tree:
  // the freshness diff cannot flag a deleted-then-regenerated file (it comes
  // back untracked), and this job has the checkout the mode decision lacked,
  // so presence is re-proven here whatever the relayed statuses said.
  const missingArtifacts = buckets.generatedI18n.filter((p) => !exists(p));
  if (missingArtifacts.length > 0) {
    return {
      fallback: `generated i18n artifact(s) missing from the tree (${missingArtifacts.slice(0, 3).join(', ')}${missingArtifacts.length > 3 ? ', ...' : ''}): failing closed to the full suite`,
    };
  }
  // Present artifacts join the related leg as graph nodes (the header in
  // lib/gate_select_plan.mjs): their consumers hang off the ARTIFACT side of
  // the import graph, not off the catalog/overlay sources that drove the
  // regeneration, so this union is what keeps a locale-fill or catalog PR's
  // consumer suites selected.
  const relatedSources = [...buckets.relatedSources, ...buckets.generatedI18n];

  const { floor, missingGuards } = buildFloor({
    alwaysRun,
    testFiles,
    changedTestFiles: buckets.testFiles.filter((t) => exists(t)),
  });
  if (missingGuards.length > 0) {
    return {
      fallback: `guard suite(s) missing from the collected tree (${missingGuards.join(', ')}): failing closed to the full suite`,
    };
  }
  return { floor, relatedSources };
}

/**
 * Build the legs one shard executes.
 *
 * Every fall-back path returns the FULL leg with a printed reason. The full
 * leg is today's step minus the collected lane files (the lane job runs
 * those in the same workflow run, in every mode), so falling back can only
 * cost minutes, never coverage.
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
 * @returns {{ mode: 'full' | 'selective', reason: string, legs: ShardLeg[], floorCount?: number, relatedCount?: number, outsideFloorCount?: number, laneExcluded: string[], laneFloorCount?: number }}
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
  const laneExcluded = collectedLaneFiles({ testFiles, exists });
  // Exact relative paths, one flag each. `--exclude` globs are ADDITIVE to the
  // config's exclude list in vitest, so this can never resurrect
  // tests/browser/ or the other config-level exclusions.
  const laneExcludeArgs = laneExcluded.map((f) => `--exclude=${f}`);
  const laneSet = new Set(laneExcluded);
  const fullLegName =
    laneExcluded.length > 0
      ? `npm test (full suite minus the ${laneExcluded.length}-file long-sims lane, shard ${shard.index}/${shard.total})`
      : `npm test (full suite, shard ${shard.index}/${shard.total})`;
  const fullPlan = (reason) => ({
    mode: 'full',
    reason,
    legs: [
      {
        name: fullLegName,
        cmd: 'npm',
        args: ['test', '--', shardArg, workersArg, ...laneExcludeArgs],
      },
    ],
    laneExcluded,
  });

  if (mode !== 'selective') {
    return fullPlan(
      mode === 'full'
        ? 'mode=full from the changes job'
        : `unrecognized mode ${JSON.stringify(String(mode))}: failing closed to the full suite`,
    );
  }
  const resolved = resolveSelectiveInputs({ changedPaths, alwaysRun, testFiles, exists });
  if (resolved.fallback) {
    return fullPlan(resolved.fallback);
  }
  const { floor, relatedSources } = resolved;

  // The lane job carries the floor's lane members; running them here too would
  // put the multi-minute files right back on the shard tail.
  const floorFiles = floor.filter((f) => !laneSet.has(f));
  const laneFloorCount = floor.length - floorFiles.length;
  const legs = [
    {
      name: `npm test (always-run floor, ${floorFiles.length} files, shard ${shard.index}/${shard.total})`,
      cmd: 'npm',
      args: ['test', '--', ...floorFiles, shardArg, workersArg],
    },
  ];
  const liveSources = relatedSources.filter((p) => exists(p));
  if (liveSources.length > 0) {
    // Deliberately NOT lane-filtered: a lane file `related` reaches re-runs
    // here (duplicate work, never a gap), exactly the overlap contract the two
    // selective legs already have with each other.
    legs.push({
      // "path(s)", not "changed source file(s)": liveSources is the union of
      // changed sources and fed-through generated i18n artifacts; the mode
      // reason carries the split counts.
      name: `vitest related (${liveSources.length} path(s), shard ${shard.index}/${shard.total})`,
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
    reason: `selective: floor ${floorFiles.length} + related over ${liveSources.length} source(s)`,
    legs,
    floorCount: floorFiles.length,
    relatedCount: liveSources.length,
    outsideFloorCount: Math.max(0, (testFiles?.length ?? 0) - floor.length),
    laneExcluded,
    laneFloorCount,
  };
}

/**
 * Build the legs the long-sims lane job ("PR gate (long sims)") executes.
 *
 * Mirror image of buildShardPlan over the SAME inputs: full mode and every
 * unprovable input run every collected lane file; selective mode runs exactly
 * the lane files the floor (blind/partial membership, guard suites, or the
 * PR's own changed tests) would have carried, so selective coverage is
 * unchanged from the pre-lane layout. An empty selective lane is a valid
 * plan with zero legs, never a spawn of `npm test` with no file arguments
 * (which would run the whole suite).
 *
 * @param {{
 *   mode: string,
 *   changedPaths: string[],
 *   alwaysRun: string[],
 *   testFiles: string[],
 *   workers: number,
 *   exists: (p: string) => boolean,
 * }} opts
 * @returns {{ mode: 'full' | 'selective', reason: string, legs: ShardLeg[], laneFiles: string[] }}
 */
export function buildLanePlan({ mode, changedPaths, alwaysRun, testFiles, workers, exists }) {
  const workersArg = `--maxWorkers=${workers}`;
  const collected = collectedLaneFiles({ testFiles, exists });
  const legsFor = (files) =>
    files.length === 0
      ? []
      : [
          {
            name: `npm test (long-sims lane, ${files.length} file(s))`,
            cmd: 'npm',
            args: ['test', '--', ...files, workersArg],
          },
        ];
  const fullLane = (reason) => ({
    mode: 'full',
    reason,
    legs: legsFor(collected),
    laneFiles: collected,
  });

  if (mode !== 'selective') {
    return fullLane(
      mode === 'full'
        ? 'mode=full from the changes job'
        : `unrecognized mode ${JSON.stringify(String(mode))}: failing closed to the full suite`,
    );
  }
  const resolved = resolveSelectiveInputs({ changedPaths, alwaysRun, testFiles, exists });
  if (resolved.fallback) {
    return fullLane(resolved.fallback);
  }
  const floorSet = new Set(resolved.floor);
  const laneFiles = collected.filter((f) => floorSet.has(f));
  return {
    mode: 'selective',
    reason: `selective: ${laneFiles.length} of ${collected.length} lane file(s) on the floor or changed`,
    legs: legsFor(laneFiles),
    laneFiles,
  };
}
