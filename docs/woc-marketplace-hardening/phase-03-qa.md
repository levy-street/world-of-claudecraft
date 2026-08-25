# Phase 03 QA: Delivery finalization exactly-once

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/wocc-marketplace`; verify `pwd` and
`git branch --show-current` (must print `feature/woc-marketplace`). Then
`git fetch origin` and merge the newest `origin/release/**` branch (currently
`origin/release/v0.37.0`) so this session starts current; if the merge is
non-trivial, run the `release-merge-audit` skill on it before continuing.

Dedicated QA session for phase 03. Canonical QA workflow in `implementation-plan.md`.
Repo: game, worktree `/Users/fernando/Documents/wocc-marketplace`.

## What was promised (audit every item)

Transactional (or reconcile-forward) finalization; idempotent `handToBuyer` with
lease-fence vs throw distinction; `booked_at`-aware `bookCustodyOnce`; the stuck-custody
monitor endpoint + metric; a real-SQL crash-point test per interleaving.

## Phase-specific probes

- Enumerate the finalization steps in the final code and check EVERY adjacent pair has
  either shared-transaction coverage or a reconcile test; a missing pair is BLOCKING.
- The reconcile arm must only move FORWARD: hunt any path that reopens, re-auctions, or
  re-mails on partial state.
- Mail idempotency must be enforced in SQL (unique key on the custody ref), not by an
  in-memory flag; verify the constraint exists in the schema dump.
- Prove the crash tests exercise the real sweep code path, not a test-local replica.
- Monitor: seeded stuck rows of all three classes appear; endpoint is internal-secret
  gated (unauthenticated and player-session requests get refused, tested); it is a
  `RouteDef` in the registry, not an inline route.
- Mutation pass: revert `booked_at` consultation locally and confirm its test reds.

## Reviewers

`privacy-security-review`, `database-performance-reviewer`, `test-coverage-auditor` on
the final diff; `qa-checklist` last.

## Exit

Verdict, counts, deferrals. Update progress.md and state.md. Next file:
`docs/woc-marketplace-hardening/phase-04-bond-payment-lifecycle.md`.
