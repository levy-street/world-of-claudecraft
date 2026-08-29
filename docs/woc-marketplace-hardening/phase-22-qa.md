# Phase 22 QA: Final packet audit and teardown

SESSION START (do this first in every fresh session): this session spans all
three repos. In `/Users/fernando/Documents/wocc-marketplace` (branch must be
`feature/woc-marketplace`): `git fetch origin`, merge the newest `origin/release/**`
(currently `origin/release/v0.39.0`). In
`/Users/fernando/Documents/woc-rewards-service-pr31` (branch
`integration/woc-market-settlement`) and
`/Users/fernando/Documents/woc-rewards-dashboard-pr13` (branch
`integration/woc-market-trading`): `git fetch origin`, merge `origin/master`. Verify
`pwd` and the branch before any command in each repo.

The last session of the packet. Canonical QA workflow in `implementation-plan.md`.
Repos: all three.

## What was promised (audit every item)

The runbook; the evidence-backed acceptance-bar audit; three green gates; three PR
texts; the follow-ups list.

## Phase-specific probes

- Re-run all three gates yourself on the committed tips; do not trust recorded results.
- Spot-verify five acceptance-bar evidence links at random (open the test, run it, read
  the state.md record); a dead or wrong link fails the audit.
- Runbook table-top exercise: pick two procedures (force-release, stranded-settling)
  and walk them step by step against the real code and dashboard; a step that does not
  exist as described is a finding.
- Sweep all three repos' packet-era commits for: the word "phase" in any commit
  message, em/en dashes, emojis, secrets, and stray debug artifacts.
- Confirm the follow-ups list covers every progress.md deferral (diff the two).

## Teardown (after the verdict, before any PR)

The packet directory `docs/woc-marketplace-hardening/` is scaffolding. Surface the
follow-ups list FIRST, then ask Fernando explicitly whether to remove the packet. On
confirmation: `git rm -r docs/woc-marketplace-hardening/` and a
`docs: remove marketplace hardening planning scaffolding` commit (body per the commit
rules). If he declines, leave it. Never delete anything else; never `git add -A`. Also
offer cleanup of the packet-created game worktree (`wocc-marketplace`) AFTER the game
PR merges, per the delete-worktree-after-merge memory (only that one; the service and
dashboard review worktrees predate this packet and stay).

## Exit

Final verdict for the whole packet (SHIP-READY / SHIP-READY-WITH-EXTERNAL-GATES /
NOT-READY with the blocking list). Update memory (the marketplace memory files) with
the outcome and the follow-ups queue. There is no next file: hand the decision to
Fernando (push approvals, PR opening, counsel status, deploy sequencing).
