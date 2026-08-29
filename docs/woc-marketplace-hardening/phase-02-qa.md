# Phase 02 QA: Settlement-aware listing state guards

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/wocc-marketplace`; verify `pwd` and
`git branch --show-current` (must print `feature/woc-marketplace`). Then
`git fetch origin` and merge the newest `origin/release/**` branch (currently
`origin/release/v0.37.0`) so this session starts current; if the merge is
non-trivial, run the `release-merge-audit` skill on it before continuing.

Dedicated QA session for phase 02. Canonical QA workflow in `implementation-plan.md`.
Repo: game, worktree `/Users/fernando/Documents/wocc-marketplace`.

## What was promised (audit every item)

Atomic settlement-aware guards on cancel and suspend; `delivered` in the live-settlement
index and `liveSettlementForListing`; the H9 winner/bond resolution; the
UNIQUE(listing_id) sale constraint; a real-SQL race test per deliverable that fails on
old behavior; additive idempotent DDL.

## Phase-specific probes

- Guards must be atomic SQL predicates, not read-then-act in JS: inspect the final SQL;
  a check that reads settlement state then updates in a second statement is a BLOCKING
  finding (the race survives).
- Enumerate every caller of `cancelListingIfUnbid` and every admin suspend/expire path;
  each must go through the new guard (grep for direct status updates that bypass it).
- The stale index cannot survive: check both the DDL and a fresh-boot schema dump.
- Race tests are decisive: revert each guard predicate locally (uncommitted) and confirm
  its test goes red; restore. Prove the tests RAN (mutation-harness memory).
- New error codes: stable, in the error-code catalog, English catalog key present, no
  raw-English server text (S3 guard run).
- DDL: apply twice against a scratch DB; second apply must be a no-op.

## Reviewers

`privacy-security-review` and `migration-safety` on the final diff;
`test-coverage-auditor` on the race suites; `qa-checklist` last.

## Exit

Verdict, counts found and fixed, deferrals. Update progress.md and state.md. Next file:
`docs/woc-marketplace-hardening/phase-03-delivery-exactly-once.md`.
