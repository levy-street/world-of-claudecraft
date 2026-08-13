---
name: ci-triage
description: Triage a red, stalled, or cancelled CI run on a World of ClaudeCraft PR. Classify the failure first, then apply the matching remedy instead of blind reruns.
user-invocable: true
---

# CI triage: classify first, then remedy

A blind `gh run rerun` wastes a full CI cycle and hides the real cause. Every red run
falls into a small set of known classes, each with its own remedy. Classify before
touching anything. The gate architecture (selective PR tier, shards and lanes, known-flake
handling) is documented in `docs/qa-gate.md`; the merge queue and required-check contract
in `docs/merge-queue.md`.

## Step 0: classify from the logs, not the summary

- Open the FIRST failing step across ALL shards and jobs. A shard's log tail can be green
  while an earlier leg in the same job failed; never judge a shard from its last lines.
- CANCELLED counts as a failure. A cancelled leg (timeout, concurrency group, a stall
  kill) reds the run just like a test failure and needs the same classification pass.
- Record the failing step name, the exact error signature, and whether it reproduces on a
  second shard or job. Then match a class below.

## The failure classes and their remedies

1. **Checkout stall (a job hangs fetching, then times out or is cancelled).** The
   auto-rerun reactor handles this class once armed: `.github/workflows/ci-stall-rerun.yml`
   fires on a completed first-attempt failure/cancellation and drives
   `scripts/ci_stall_rerun.mjs`, which re-reads the live run, applies the tested predicate
   (pure core: `scripts/lib/ci_stall_rerun.mjs`), and reruns failed jobs at most once,
   printing its whole decision in the job log. The driver can also be run by hand for a
   stalled run it did not catch. Do not stack manual reruns on top of the reactor; check
   whether attempt 2 already exists first.

2. **Teardown-rpc flake.** The exact signature: every test in the leg passed, but the leg
   exited 1 with `EnvironmentTeardownError: Closing rpc while ...` in the tail. PR-tier
   shard legs auto-retry this ONCE (the one sanctioned known-flake retry, in
   `scripts/lib/ci_leg_runner.mjs` via `scripts/ci_shard_test.mjs`, loud in the log).
   Anywhere that retry does not run (release-gate shards, nightly), rerun only the red
   part: `gh run rerun <run-id> --failed`. If the signature differs at all, it is not this
   class; keep classifying.

3. **A PR red that reproduces nothing locally.** Two base-branch checks before any rerun:
   - Did the release base MOVE since the PR's last CI run? A moving `release/**` base
     invalidates the merge commit CI tested; the fix is to merge the base into the branch
     and push (which triggers fresh CI), not to rerun the stale run.
   - Is the base tip itself red? A branch inherits a red release tip; check the nightly
     or gate tracking state for the base before blaming the PR.

4. **Lockfile desync inherited from a base merge.** Install errors or frozen-lockfile
   failures right after merging the base usually mean the merge brought `package.json`
   changes whose `pnpm-lock.yaml` resolution did not merge cleanly. Run `pnpm install`
   and commit the regenerated `pnpm-lock.yaml` (never hand-edit it).

5. **Fork first-time contributor.** A fork PR from a first-time contributor sits in
   `action_required` until a maintainer approves the workflow run. Nothing is broken and
   no rerun helps; it needs the approval click.

## After the remedy

State the class you diagnosed and the evidence (step name, signature, run id) when you
report back, so a repeat occurrence is recognizable. If no class matches, treat it as a
real failure: reproduce locally with the failing test file, fix test-first, and never
mask it with repeated reruns.
