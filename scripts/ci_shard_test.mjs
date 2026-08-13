// CI entry for the pr-gate shard matrix ("Run tests (PR tier, shard i of N)").
// Phase 2 of the CI/CD performance packet (docs/qa-gate.md, "Selective PR-tier CI").
//
// Reads the selection decision the `changes` job relayed (TEST_MODE,
// TEST_MODE_REASON, CHANGED_FILES) plus this job's `--shard=i/N` (or
// `--lane=long-sims-a` / `--lane=long-sims-b`) argv, builds the legs through the pure planner
// (lib/ci_shard_plan.mjs), prints the whole decision so a suspicious green can
// be audited from the job log alone, and runs the legs through the leg
// runner (lib/ci_leg_runner.mjs), which carries the ONE sanctioned
// known-flake retry: the exact teardown-rpc signature, every test passed but
// exit 1 (Phase 6; docs/qa-gate.md, "Known-flake handling"). Fail closed
// everywhere: any unreadable input runs this job's full share, the shard's
// suite-minus-lane or the lane job's whole CI_LONG_SUITE_HALVES list, whose
// union across the shards and both lane jobs is exactly the pre-selection
// full suite.
//
// Selection applies to PR-tier CI only: release-gate keeps its unconditional
// `npm test -- --shard=i/N` run line and never runs this script, and the
// nightly workflow re-proves the full suite on the tips daily (docs/qa-gate.md).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatLegHeader, runLegsWithFlakeRetry } from './lib/ci_leg_runner.mjs';
import { buildLanePlan, buildShardPlan, parseShardArg } from './lib/ci_shard_plan.mjs';
import { collectSuiteVisibility } from './lib/gate_discovery.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const usage =
  '[ci-shard] usage: node scripts/ci_shard_test.mjs (--shard=<i>/<N> | --lane=long-sims-a | --lane=long-sims-b) [--plan-only]';

const argv = process.argv.slice(2);
const shard = parseShardArg(argv);
// The long-sims lanes ("PR gate (long sims A)" / "PR gate (long sims B)"):
// the two jobs that split the CI_LONG_SUITES files the shard legs exclude
// (CI_LONG_SUITE_HALVES). Exactly one --lane flag with one of the two exact
// literals; any other value, a duplicate, or ANY --shard token beside it
// (even a malformed one parseShardArg rejects) is a wiring bug, same
// doctrine as a malformed shard spec: fail loud, never guess a partition.
const laneArgs = argv.filter((a) => a.startsWith('--lane='));
const LANE_FLAGS = { '--lane=long-sims-a': 'a', '--lane=long-sims-b': 'b' };
const laneHalf = laneArgs.length === 1 ? (LANE_FLAGS[laneArgs[0]] ?? null) : null;
const lane = laneHalf !== null;
const hasShardToken = argv.some((a) => a.startsWith('--shard='));
if ((laneArgs.length > 0 && !lane) || (lane && hasShardToken) || (!lane && !shard)) {
  console.error(usage);
  process.exit(1);
}
// Audit mode: print the whole decision and the exact leg commands without
// spawning them. For humans reproducing a CI decision locally, and for the
// subprocess tests that prove this entry is actually wired to the planner.
// The ci.yml run line is pinned WITHOUT this flag (tests/ci_workflow.test.ts),
// so it can never quietly turn the real shard step into a no-op.
const planOnly = argv.includes('--plan-only');

// Half the runner's cores for the lane AND the shards, and for the lane
// this is a MEASURED decision, not an oversight: a full-core trial (4
// workers on the 4-vCPU runner, run 31107474546) inflated the four sims'
// aggregate CPU time from 644 s to 1027 s through memory-bandwidth
// contention and pushed the eastbrook integration sweep past its own 180 s
// budget, while the half-cores run finished green with a 432 s wall. Every
// per-test budget in the suite is calibrated against this bound; raise it
// only with a green measured run at the new value.
const workers = Math.max(1, Math.floor(os.availableParallelism() / 2));

const mode = process.env.TEST_MODE ?? '';
// Echoed into the log only. The producer already strips CR/LF; re-stripping
// control characters here keeps the consumer's validation symmetric with the
// path relay rather than trusting the producer.
const modeReason = [...(process.env.TEST_MODE_REASON ?? '')]
  .filter((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) !== 0x7f)
  .join('');

/** @type {string[] | null} */
let changedPaths = null;
if (mode === 'selective') {
  try {
    const parsed = JSON.parse(process.env.CHANGED_FILES ?? '');
    if (Array.isArray(parsed) && parsed.every((p) => typeof p === 'string')) {
      changedPaths = parsed;
    }
  } catch {
    changedPaths = null;
  }
}

// The suite classification is recomputed here, in the PR's own tree, with the
// same shared code the local selective gate runs (lib/gate_discovery.mjs), so
// a test added by this very PR classifies the moment it exists.
const { testFiles, alwaysRun, counts } = collectSuiteVisibility({
  root: repoRoot,
  readdirSync,
  readFileSync,
  join: path.join,
  relative: path.relative,
  sep: path.sep,
});

const exists = (p) => existsSync(path.join(repoRoot, p));
const plan = lane
  ? buildLanePlan({
      mode,
      changedPaths: changedPaths ?? undefined,
      alwaysRun,
      testFiles,
      workers,
      exists,
      half: laneHalf,
    })
  : buildShardPlan({
      mode,
      changedPaths: changedPaths ?? undefined,
      alwaysRun,
      testFiles,
      shard,
      workers,
      exists,
    });

console.log(
  lane
    ? `[ci-shard] long-sims-${laneHalf} lane, workers=${workers}`
    : `[ci-shard] shard ${shard.index}/${shard.total}, workers=${workers}`,
);
console.log(
  `[ci-shard] changes-job decision: mode=${mode || '(unset)'}${modeReason ? ` (${modeReason})` : ''}`,
);
console.log(
  `[ci-shard] suite: ${testFiles.length} test files (${counts.graph} graph-visible, ` +
    `${counts.blind} blind, ${counts.partial} partial); always-run floor ${alwaysRun.length}`,
);
console.log(`[ci-shard] plan: mode=${plan.mode} (${plan.reason})`);
if (lane) {
  // The lane's own audit trail: which files this job owns, or why it owns
  // none. Zero legs is a valid selective outcome and must exit green WITHOUT
  // spawning (an argument-less `npm test` would run the entire suite).
  console.log(
    plan.laneFiles.length > 0
      ? `[ci-shard] lane runs: ${plan.laneFiles.join(', ')}`
      : '[ci-shard] lane runs: nothing (no lane file on the floor or changed; ' +
          'the shard legs cover the rest, and the release/** push run and the ' +
          'nightly gate run the full suite, docs/qa-gate.md)',
  );
} else {
  if (plan.laneExcluded.length > 0) {
    // Shard-side half of the lane accounting: these files are excluded from
    // every leg below and owned by the two long-sims lane jobs in this run.
    console.log(
      `[ci-shard] long-sims lane: ${plan.laneExcluded.length} suite(s) excluded from this ` +
        'shard and owned by the "PR gate (long sims A)" and "PR gate (long sims B)" jobs',
    );
  }
  if (plan.mode === 'selective') {
    console.log(
      `[ci-shard] runs: ${plan.floorCount} floor file(s) sharded ${shard.total} ways` +
        (plan.laneFloorCount > 0
          ? ` (${plan.laneFloorCount} more floor file(s) ride the long-sims lane)`
          : '') +
        `, plus vitest related over ${plan.relatedCount} changed source(s)`,
    );
    // Honest accounting: the related leg covers an unknown further share of the
    // outside-floor files (it can only be known by running vitest), so this line
    // must never read as "N files were skipped".
    console.log(
      `[ci-shard] outside the floor: ${plan.outsideFloorCount} graph-visible test file(s); ` +
        'the related leg covers the share of those reachable from the changed sources. ' +
        'Backstops: the release/** push run and the nightly gate run the full suite (docs/qa-gate.md).',
    );
  }
}

if (planOnly) {
  for (const leg of plan.legs) {
    console.log(formatLegHeader(leg));
  }
  console.log(`\n[ci-shard] plan-only: ${plan.legs.length} leg(s) printed, nothing spawned`);
} else {
  // The leg runner (lib/ci_leg_runner.mjs) streams each leg's output through
  // unchanged, keeps a bounded tail, and applies the ONE sanctioned
  // known-flake retry: a leg that exits 1 with the exact teardown-rpc
  // signature (every test passed) reruns once, loudly; nothing else ever
  // retries. Spawning stays shell-less there: argv elements (which embed
  // PR-controlled filenames) pass verbatim to execvp, and the floor leg's
  // long file list is safe under the POSIX arg limits this ubuntu-only entry
  // runs under. The win32 cmd.exe 8191-char ceiling that forces
  // gate_select.mjs to chunk does not apply here; local reproduction on
  // Windows is --plan-only (spawns nothing) per docs/qa-gate.md.
  const result = await runLegsWithFlakeRetry({ legs: plan.legs, cwd: repoRoot });
  if (!result.ok) {
    // exitCode, never process.exit(): the legs' output is piped through this
    // process now, and a forced exit discards whatever is still queued on
    // the async stdout pipe (measured: everything past one 64 KB pipe
    // buffer), which would truncate exactly the failing-shard log a human
    // needs. Setting exitCode lets the event loop drain and then exit.
    process.exitCode = result.status;
  } else {
    console.log(
      `\n[ci-shard] PASS: ${plan.legs.length} leg(s) green on ${
        lane ? `the long-sims-${laneHalf} lane` : `shard ${shard.index}/${shard.total}`
      }${
        result.retriedLegNames.length > 0
          ? ` (known-flake retry used on: ${result.retriedLegNames.join(', ')})`
          : ''
      }`,
    );
  }
}
