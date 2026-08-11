# Merge queue and required checks on main and release/**

`main` and `release/**` are protected by a repository ruleset (Settings, Rules,
Rulesets) that requires the PR-tier checks and routes every merge through a
merge queue. Settings do not live in git; this note is the contract those
settings implement, and the one place it is written down. If the ruleset and
this note disagree, fix whichever one drifted.

Rollout status: a repo admin applies the ruleset to `release/**` first, after
the ci.yml merge_group trigger lands there; `main` joins at the next
release-to-main merge, which is what carries that trigger onto main (enabling
the queue on a branch whose ci.yml lacks the trigger stalls every queued PR).
Until a branch is covered by the ruleset, its merge button is unchanged.
The same sequencing applies to every NEW required name after that: add a
check's context to the ruleset only AFTER the PR introducing the job has
merged into the target branch (`PR gate (long sims)` was the first case), and
expect open PRs whose heads predate the job to need a base re-merge before
they can queue, since a required context that never reports blocks the merge
forever. Renames follow the same choreography in reverse plus forward: when
the lane-diet PR split `PR gate (long sims)` into `PR gate (long sims A)` and
`PR gate (long sims B)`, the old context had to leave the ruleset at the same
time the two new ones joined (after the split merged), because a required
name no run produces anymore blocks every later merge.

Why: on 2026-08-05 two merges landed on an already-red release tip, every open
PR inherited 67 broken tests, and repair took a day of close/reopen churn. The
queue makes a green tip structural: nothing merges without the full suite
passing on the exact merge result, and a queued PR whose base moves is retested
automatically instead of by hand.

## What changes at the merge button

- The merge button becomes **Merge when ready**. It queues the PR instead of
  merging it. `gh pr merge` queues the same way.
- A PR can be queued once its own required checks are green. The queue then
  builds the candidate merge result (your PR merged onto the current tip, plus
  any PRs queued ahead of you) and runs CI on it as a `merge_group` event.
  ci.yml routes that run through the full PR tier: `changes` reports
  `test_mode=full`, so the queue always runs every suite (the 8-shard matrix
  plus the two long-sims lane halves) plus checks, browser, and lint on the
  tree it is about to make the branch tip. "Every suite" means every test
  FILE; the balance harnesses inside the lanes run their PR-tier diet
  configuration here exactly as on PRs and release pushes, and only the
  nightly workflow restores their full sweep (`WOC_FULL_BALANCE_SWEEP`,
  docs/qa-gate.md, "The balance-harness diet").
- If the queue run is green, GitHub merges automatically. No close/reopen, no
  re-merge of the base: base movement is the queue's job now.
- The queue gives a candidate **90 minutes** for its checks to report
  (`check_response_timeout_minutes` on the merge_queue rule; grouping is
  ALLGREEN, and it builds at most 2 entries at a time). That value is the
  ceiling every job bound has to fit under, so keep this invariant true when
  resizing any bound: the `changes` bound, plus the largest REQUIRED job
  bound, plus runner-acquisition slack (which `timeout-minutes` does not count
  but the queue's timer does) must stay comfortably under it. Today that is
  8 + 30, so a required critical path of 38 minutes against a 90 minute
  ceiling. A candidate that blows the queue timeout is ejected, which blocks
  the merge rather than merging anything unproven, but it costs a full queue
  cycle and reads like a mystery without this number written down.
- The queue merges with one repo-wide method (merge commit). The per-PR
  squash/merge choice does not apply on the protected branches.
- Direct pushes to the protected branches are blocked by the
  require-a-pull-request rule. Repository admins keep an always-on bypass for
  emergency repair; a bypassed push skips the queue's proof, so treat it as
  emergency-only and expect the next nightly or push run to be the real verdict.

## When the queue rejects a PR

A rejection removes the PR from the queue and leaves a red `merge_group` run on
the Checks tab (filter by event: merge_group).

1. Open the failed run and find the red job. The shard logs carry the same
   `[ci-shard]` audit lines as PR runs.
2. If the same failure is red on your PR's own run too, it is your change: fix
   and re-queue.
3. If your PR run was green, the failure is usually the interaction between
   your diff and commits that landed ahead of you (another queued PR, or a base
   move). Reproduce locally by merging the current base branch into your
   branch, fix, push, re-queue.
4. A flake verdict needs a clean rerun, not a shrug: re-run the failed job; if
   it greens, re-queue. Judge red CI by clean-runner reruns.
5. A job that failed with "exceeded the maximum execution time of N minutes"
   hit its checkout-stall bound (the test and browser jobs carry job-level
   timeout-minutes sized from measured healthy worst cases, or, where a job
   has repeatedly died before finishing on a slow runner OR has been measured
   sitting inside its own margin on a healthy one, from its healthy JOB wall
   scaled by the measured fast-to-slow runner ratio; the stall class
   is runner-side and runs tens of minutes inside actions/checkout, 9.6 to
   24.4 in the incident sample and up to 68 in the 24 hour replay). First open the killed job's log: if a test step was
   already failing or still running near the bound, treat it as a real
   failure or a real slowdown, not a stall (a genuinely red shard on a
   runner with a setup spike can die AS a timeout). Otherwise it is a rerun,
   not a code investigation: re-run the failed jobs and re-queue. Two
   automatic nets exist: ci.yml's workflow-wide git low-speed abort catches
   a fetch that slows to a trickle (the 2026-08-10 hang variant evades it,
   see the ci.yml env block), and the CI stall auto-rerun
   workflow (ci-stall-rerun.yml, decision core scripts/lib/ci_stall_rerun.mjs)
   reruns a run's failed jobs once, on attempt 1 only, when the dead step
   was a bound-killed setup step or a failed checkout (the two recognized
   stall shapes), nothing else that ran had failed, and nothing after the
   dead step ran. The auto-rerun deliberately skips merge_group runs (the
   queue has already ejected the PR and dissolved the group's ref, so only
   the manual rerun-and-re-queue above applies there); on pull_request and
   push runs a stall you meet by hand is usually already on attempt 2. If the
   SAME job times out twice on healthy-looking logs, treat it as a real
   slowdown and investigate before resizing any bound.

## The required-check contract

Required on both `main` and `release/**`, all sourced from GitHub Actions:

- `Detect code path changes`. Required itself, and load-bearing: when it fails,
  its non-matrix dependents report skipped under their exact names, and branch
  protection treats skipped as satisfied (the shard matrix instead collapses to
  an unsuffixed check run, which blocks by accident rather than by decision).
  Requiring the job that decides closes that hole for a classifier FAILURE.
  The residual is inherent to CI-config-in-repo: a queue run executes
  the queued tree's own copy of ci.yml and the classifier, so an honest
  mistake there is caught only because the workflow files
  (`.github/workflows/`) and the selection pipeline's own scripts are
  themselves fail-closed triggers (always `code=true`, always full mode); a
  hostile edit is a review problem, not something protection can solve.
- `PR gate (English-only legal) (1)` through `(8)`: the sharded test suite.
  The matrix legs START on every `pull_request` and `merge_group` run and gate
  their work at STEP level: on a run the suite does not apply to (a docs-only
  PR, a release-to-main PR) each leg skips its steps and reports green in
  seconds under its suffixed name. This is deliberate, not waste: a job-level
  skip of a MATRIX job collapses to one check run WITHOUT the `(N)` suffix,
  which string-matches none of these required contexts and leaves them
  "expected" forever, so the PR could never be queued or merged (observed live
  on the Phase 3 queue drills).
- `PR gate (long sims A)` and `PR gate (long sims B)`: the dedicated lane
  pair for the long rotation sims (`CI_LONG_SUITES` split by
  `CI_LONG_SUITE_HALVES` in `scripts/lib/ci_shard_plan.mjs`). The shard
  matrix deliberately excludes those files, so these jobs carry coverage
  nothing else in the run has: both are required for the same reason the
  shards are. Each runs (or docs-only-skips) on every `pull_request` and
  `merge_group` run; unlike the shard matrix, a job-level skip is safe here
  because a non-matrix job's skipped check run keeps its exact required name,
  which satisfies protection.
- `PR checks (freshness, typecheck, builds)`.
- `Format + lint (Biome, changed files)`: deterministic, diff-scoped, minutes
  long, and a red here is always a real defect in the changed files. On queue
  runs it diffs against the merge group's base SHA, falling back to the live
  target-branch tip if that SHA is unreachable, so a `release/**` queue run
  never sweeps the release-vs-main delta (and its intentionally-red whole-repo
  debt) into biome.
- `Browser regressions (Chromium)`: the real-browser net for a browser game.
  It reports (or is skipped, which satisfies) on every PR and queue run.

Never require these, deliberately:

- The release lanes (`Release gate (tests)`, `Release i18n (21-locale fill)`,
  `Release checks (freshness, typecheck, builds)`, `Release version gate`):
  release-process lanes, legitimately red or skipped mid-cycle. Release i18n in
  particular is red by design until the release-time locale fill.
- `Dependency audit`: its workflow is path-filtered to dependency changes, so
  on most PRs (and on every queue run) the check never reports at all, and a
  required check that never reports blocks the merge forever. Skipped jobs
  satisfy protection; absent workflows do not.

The same rule generalizes: a check may only join the required list if ci.yml
produces (or explicitly skips) it on every `pull_request` AND every
`merge_group` run. Anything else deadlocks the queue. For a MATRIX job the bar
is stricter: an explicit job-level skip is NOT enough, because the skipped
check run drops the `(N)` suffix and satisfies nothing; the legs must start
and no-op at step level, as the shard matrix does. And required-check names
are string-matched: renaming a CI job silently un-requires it, so treat the job
names above as pinned (`tests/ci_workflow.test.ts` holds each name to ci.yml
and to this doc, including the shard-count suffix range).

## Queueing a fork PR is the privileged step

A merge group runs the QUEUED tree (base plus the PR's diff) in this
repository's own context: repository secrets are resolvable there and no
fork-approval prompt guards it, unlike the PR's own workflow runs. Queueing
requires write access, so this is always a maintainer action: read the diff
before queueing a fork PR, and treat any fork change under `.github/**` or
`scripts/**` as needing a real review first.

## What did not change

- Fork PRs still need maintainer approval before their `pull_request` workflows
  run; the new privileged step is queueing (see above).
- The release-tier lanes still run on release refs and release-to-main PRs,
  visible but not required.
- The `release/**` push run after each queue merge and the nightly gate
  (`docs/qa-gate.md`) remain the unconditional full-suite backstops.
