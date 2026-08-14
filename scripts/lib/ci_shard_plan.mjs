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
//   selective   ONE merged sharded leg: `vitest related` over the changed
//               sources PLUS the always-run floor files as self-selecting
//               seeds (vitest seeds its affected set with the given paths
//               themselves), minus the lane files on the floor side, which
//               the lane job carries instead. One collection, one transform
//               pass, one sharding, where the former floor and related legs
//               paid a second vitest startup per shard. The related side is
//               deliberately NOT lane-filtered: a lane file the graph walk
//               reaches re-runs here, which duplicates work but never opens
//               a gap. `npx vitest` has no npm lifecycle, so the entry
//               (scripts/ci_shard_test.mjs) regenerates the artifacts once
//               per job before spawning, and the guard suites still read
//               fresh bytes on every shard.
//   lane        the "PR gate (long sims A)" / "PR gate (long sims B)" jobs
//               (buildLanePlan, one CI_LONG_SUITE_HALVES half each): the
//               half's collected CI_LONG_SUITES files, all of them in full
//               mode and on any unprovable input, only the floor/changed
//               members in selective mode. Both sides fail closed toward
//               their own files, so mode for mode the shards plus the two
//               lanes run exactly what the pre-lane shard plan would have
//               run (selective mode still skips the outside-floor remainder
//               by design; the audit lines and docs/qa-gate.md carry that
//               accounting).
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
// Sharding: vitest partitions the COLLECTED file set, so `--shard=i/N` on the
// merged related invocation splits the floor-union-related selection 8 ways in
// one draw. A file both floor-classified and graph-reachable appears once in
// the argv and once in the collection: vitest's related set is a Set, so the
// old two-leg overlap re-runs are gone by construction.

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
  'tests/suite_duration_budget.test.ts',
  'tests/world_api_parity.test.ts',
]);

/** Directory prefixes whose every collected test joins the floor (parity pins). */
export const CI_GUARD_PREFIXES = Object.freeze(['tests/parity/']);

/**
 * Long rotation sims the PR tier runs in the dedicated lane jobs
 * ("PR gate (long sims A)" / "PR gate (long sims B)" in ci.yml, one
 * CI_LONG_SUITE_HALVES half each) instead of inside the shard matrix, so a
 * single multi-minute file stops setting the slowest shard's wall clock.
 * Membership is measured, not automated: a file joins when it costs more than
 * the 90 second threshold inside a full-mode CI shard, and the next-longest
 * file stays sharded (2026-08-06 full-mode run: the then-four members
 * measured 249.5 s, 143.9 s, 142.3 s, and 94.7 s in-shard; the next longest,
 * tests/corpse_harvest_sim.test.ts at 69.8 s, stays). One decided exception
 * to the per-file rule: the owned-class balance family split 2026-08-13 is
 * lane-owned as a UNIT, split pieces included, so the diet flag registry
 * (every WOC_FULL_BALANCE_SWEEP reader must be lane-owned) and the family's
 * lane accounting stay in one place; measured per-file lane durations for
 * the whole family are in the split PR (#3370). Membership is also
 * one-directional by nature: nothing automatic promotes a newly slowed suite
 * into this list, so when a shard's wall clock grows, remeasure from the
 * shard logs and re-decide the list (the committed contract and the audit
 * lines live in docs/qa-gate.md, "The long-sims lane").
 *
 * release-gate is deliberately NOT lane-split: release/** pushes keep the
 * whole suite in their 8 shards, so the post-merge backstop is untouched.
 */
export const CI_LONG_SUITES = Object.freeze([
  // 2026-08-13 remeasure (run 31732244215, both lanes fully loaded; figures
  // are IN-LANE and stay far under 90 even at the recorded 1.6x runner
  // ratio): battleground (14.4 s) and audit_conservation_property (55.1 s)
  // left for the shard pool. Eviction safety is structural, not
  // classification-dependent: lane membership only changes WHERE a file runs,
  // never WHETHER (a floor member like battleground rides the selective floor
  // leg instead of the lane; a graph member like audit_conservation runs via
  // the unfiltered related leg either way). The chronomancy
  // suite split three ways and only its balance-targets file stays lane-listed
  // (the heal-parity and Cascada pieces shard, like the warlock sustain
  // suite's per-spec pieces, both pending a per-piece in-shard measurement).
  // druid_balance_probe stays WHOLE: its cost is one matrix test whose
  // bestDruidBuilds assertions are an argmax across capstones, so a
  // per-capstone split would weaken the winner selection it pins.
  'tests/chronomancy_balance_targets.test.ts',
  // The five-class-overhauls balance harnesses (review 3050): the owned-class
  // matrices grew to 8 specs and the raid loop to ~510s, pushing shards 1 and
  // 4 past the then-20-minute pr-gate shard budget; they are exactly what this
  // lane is for. Their cost kept growing after that: see the ci.yml bounds,
  // where the same harnesses later outgrew the release-gate and lane bounds
  // too and forced both to be re-sized from measured slow-runner ratios.
  'tests/druid_balance_probe.test.ts',
  'tests/eastbrook_gameplay_integration.test.ts',
  'tests/hunter_dps_balance.test.ts',
  'tests/nythraxis_matrix.test.ts',
  // The owned-class harness pair was split into single-responsibility files
  // (2026-08-13) so no lane or shard chain carries a 13-minute single file:
  // the level-20 harness measured 788 to 842 s as ONE file and pinned a
  // whole worker wherever it ran. Every split file stays lane-owned; the
  // duration ledger for the halves below is in the split-change PR.
  'tests/owned_class_balance_dps_metrics.test.ts',
  'tests/owned_class_balance_dps_probes.test.ts',
  'tests/owned_class_balance_druid_bands.test.ts',
  'tests/owned_class_balance_groveheart.test.ts',
  'tests/owned_class_balance_healer_contract.test.ts',
  'tests/owned_class_balance_healer_probes.test.ts',
  'tests/owned_class_balance_role_bands.test.ts',
  'tests/owned_class_raid_armor_avoidance.test.ts',
  'tests/owned_class_raid_sustain_bands.test.ts',
]);

/**
 * The two parallel lane jobs ("PR gate (long sims A)" / "PR gate (long sims
 * B)" in ci.yml): a literal partition of CI_LONG_SUITES, so the pair's wall
 * clock is roughly half of the single-job lane's. Halves are balanced by
 * MEASURED post-diet suite duration, not file count (re-balanced 2026-08-13
 * from the per-file durations in the harness-split PR after the owned-class
 * pair became nine single-responsibility files; re-derive from the lane job
 * logs whenever a member's cost moves). The shard legs keep excluding the
 * full CI_LONG_SUITES union, so the a/b assignment can rebalance freely
 * without touching the shard side. tests/ci_shard_plan.test.ts pins the
 * halves as an exact partition of CI_LONG_SUITES.
 */
const CI_LONG_SUITE_HALF_A = Object.freeze([
  'tests/nythraxis_matrix.test.ts',
  'tests/owned_class_balance_dps_metrics.test.ts',
  'tests/owned_class_balance_dps_probes.test.ts',
  'tests/owned_class_balance_druid_bands.test.ts',
  'tests/owned_class_balance_healer_probes.test.ts',
  'tests/owned_class_balance_role_bands.test.ts',
  'tests/owned_class_raid_armor_avoidance.test.ts',
]);

// Half b is DERIVED (the union minus half a), so a lane file excluded from
// every shard but owned by no lane is structurally impossible, not merely
// pinned; tests/ci_shard_plan.test.ts still pins b's exact contents so the
// derived assignment stays a conscious decision.
export const CI_LONG_SUITE_HALVES = Object.freeze({
  a: CI_LONG_SUITE_HALF_A,
  b: Object.freeze(CI_LONG_SUITES.filter((f) => !CI_LONG_SUITE_HALF_A.includes(f))),
});

/**
 * The lane files this tree actually collects. Filtering on the collected set
 * is the fail-safe direction: a lane file the walker cannot see is neither
 * excluded from the shards nor run by the lane, so it stays inside the vitest
 * shards (coverage keeps, latency loses), and the real-tree pin in
 * tests/ci_shard_plan.test.ts makes the drift loud.
 *
 * @param {{ testFiles: string[], exists: (p: string) => boolean, suites?: readonly string[] }} opts
 * @returns {string[]}
 */
export function collectedLaneFiles({ testFiles, exists, suites = CI_LONG_SUITES }) {
  const collected = new Set(testFiles ?? []);
  return suites.filter((f) => collected.has(f) && exists(f));
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
 * Resolve the vitest worker count for a CI test job. The default is half the
 * runner's cores, a MEASURED ruling (full-core run 31107474546 inflated the
 * long sims' aggregate CPU ~1.6x through memory-bandwidth contention and
 * timed out the eastbrook sweep); every per-test budget is calibrated
 * against it. WOC_TEST_WORKERS is the sanctioned trial knob for producing
 * the green measured run that ruling requires before any new default: an
 * integer between 1 and the core count is honored; a malformed or
 * out-of-range value falls back to the measured default and reports
 * `source: 'invalid'` so the entry announces it in the job log; unset or
 * empty is the ordinary default (`source: 'default'`) and stays quiet.
 * Worker count never changes WHICH tests run, so the fallback direction is
 * safety toward the calibrated bound, not toward fewer tests.
 *
 * @param {{ cores: number, envValue?: string }} opts
 * @returns {{ workers: number, source: 'default' | 'env' | 'invalid' }}
 */
export function resolveWorkerCount({ cores, envValue }) {
  const fallback = Math.max(1, Math.floor(cores / 2));
  if (envValue === undefined || envValue === '') return { workers: fallback, source: 'default' };
  if (!/^[1-9]\d*$/.test(envValue)) return { workers: fallback, source: 'invalid' };
  const parsed = Number(envValue);
  if (parsed > cores) return { workers: fallback, source: 'invalid' };
  return { workers: parsed, source: 'env' };
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
  // Same presence re-proof for the manifest family (the second and only
  // other freshness-guarded generated family; lib/gate_select_plan.mjs).
  const missingManifests = buckets.generatedManifests.filter((p) => !exists(p));
  if (missingManifests.length > 0) {
    return {
      fallback: `generated manifest artifact(s) missing from the tree (${missingManifests.slice(0, 3).join(', ')}${missingManifests.length > 3 ? ', ...' : ''}): failing closed to the full suite`,
    };
  }
  // Present artifacts join the related leg as graph nodes (the header in
  // lib/gate_select_plan.mjs): their consumers hang off the ARTIFACT side of
  // the import graph, not off the catalog/overlay sources that drove the
  // regeneration, so this union is what keeps a locale-fill, catalog, or
  // manifest PR's consumer suites selected.
  const relatedSources = [
    ...buckets.relatedSources,
    ...buckets.generatedI18n,
    ...buckets.generatedManifests,
  ];

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
  const liveSources = relatedSources.filter((p) => exists(p));
  // ONE merged leg (2026-08-14; formerly a floor `npm test` leg plus a
  // separate `vitest related` leg): `vitest related` keeps a spec whose own
  // moduleId is among the given paths (vitest 4.1.10, specifications.ts,
  // filterTestsBySource's `path === specification.moduleId` arm), so a floor
  // TEST file passed as a positional selects itself. Feeding the floor beside the changed sources therefore
  // runs floor-union-related in one collection, one transform pass, and one
  // sharding, where the two sequential legs paid a second vitest startup and
  // re-imported the shared setup on every shard.
  // tests/ci_shard_plan.test.ts pins the self-selection property by EXECUTION
  // so a vitest upgrade that dropped it goes red there instead of silently
  // un-flooring every selective shard. The related side stays deliberately
  // NOT lane-filtered: a lane file `related` reaches re-runs here (duplicate
  // work, never a gap). `npx vitest` has no npm lifecycle, so pretest runs
  // once at the entry (scripts/ci_shard_test.mjs) instead of per leg; the
  // per-JOB artifact regeneration the S3 guard and freshness suites rely on
  // is unchanged.
  const legs = [
    {
      // "path(s)", not "changed source file(s)": liveSources is the union of
      // changed sources and fed-through generated i18n artifacts; the mode
      // reason carries the split counts.
      name:
        `vitest related (merged: ${floorFiles.length} floor file(s) + ` +
        `${liveSources.length} changed path(s), shard ${shard.index}/${shard.total})`,
      cmd: 'npx',
      // EXPLICIT --passWithNoTests=false: the related subcommand defaults
      // the option to TRUE internally (options.passWithNoTests ??= true in
      // vitest's cac wiring), so omitting the flag is NOT loud; only an
      // explicit false sticks through the ??=. With it, a merged leg that
      // collects nothing exits 1 (measured both directions), which is the
      // red a floor-seeding collapse must produce in real CI; a healthy leg
      // always collects the floor, so no false red is possible.
      args: [
        '--no-install',
        'vitest',
        'related',
        ...liveSources,
        ...floorFiles,
        '--run',
        '--passWithNoTests=false',
        shardArg,
        workersArg,
      ],
    },
  ];
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
 * Build the legs one long-sims lane job ("PR gate (long sims A)" or
 * "PR gate (long sims B)") executes over its CI_LONG_SUITE_HALVES half.
 *
 * Mirror image of buildShardPlan over the SAME inputs: full mode and every
 * unprovable input run every collected lane file of this half; selective mode
 * runs exactly the half's lane files the floor (blind/partial membership,
 * guard suites, or the PR's own changed tests) would have carried, so the two
 * halves together keep selective coverage unchanged from the pre-lane layout.
 * An empty selective lane is a valid plan with zero legs, never a spawn of
 * `npm test` with no file arguments (which would run the whole suite).
 *
 * @param {{
 *   mode: string,
 *   changedPaths: string[],
 *   alwaysRun: string[],
 *   testFiles: string[],
 *   workers: number,
 *   exists: (p: string) => boolean,
 *   half: 'a' | 'b',
 * }} opts
 * @returns {{ mode: 'full' | 'selective', reason: string, legs: ShardLeg[], laneFiles: string[] }}
 */
export function buildLanePlan({ mode, changedPaths, alwaysRun, testFiles, workers, exists, half }) {
  // Own-property lookup, not a bare index: a prototype-chain key like
  // 'constructor' is truthy and would sail past a null check into an opaque
  // downstream TypeError instead of this loud message.
  const suites = Object.hasOwn(CI_LONG_SUITE_HALVES, half) ? CI_LONG_SUITE_HALVES[half] : undefined;
  if (!suites) {
    // A bad half is a wiring bug (the entry validates its --lane flag before
    // planning), not a fail-closed input: throw loud, never guess a half.
    throw new Error(`unknown long-sims lane half: ${JSON.stringify(half)}`);
  }
  const workersArg = `--maxWorkers=${workers}`;
  const collected = collectedLaneFiles({ testFiles, exists, suites });
  const legsFor = (files) =>
    files.length === 0
      ? []
      : [
          {
            name: `npm test (long-sims-${half} lane, ${files.length} file(s))`,
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
