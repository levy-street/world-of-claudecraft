# Phase 17 QA: Database retention, indexes, and deadlines

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/wocc-marketplace`; verify `pwd` and
`git branch --show-current` (must print `feature/woc-marketplace`). Then
`git fetch origin` and merge the newest `origin/release/**` branch (currently
`origin/release/v0.39.0`) so this session starts current; if the merge is
non-trivial, run the `release-merge-audit` skill on it before continuing.

Dedicated QA session for phase 17. Canonical QA workflow in `implementation-plan.md`.
Repo: game, worktree `/Users/fernando/Documents/wocc-marketplace`.

## What was promised (audit every item)

Index-using directed-offers query verified by EXPLAIN; retention with a custody-safe
never-sweep set; sort and FK-cascade indexes; bounded lock waits on the bid paths.

## Phase-specific probes

- The retention never-sweep set is the dangerous part: enumerate every row class the
  custody ledger, dispute flow, or book-once invariant relies on (phase 03's semantics
  in state.md) and prove each survives the sweep; an over-eager sweep can DELETE the
  exactly-once evidence and reintroduce B2 silently. This is the one place to spend
  extra time.
- EXPLAIN honesty: the test must seed enough rows that the planner would seq-scan the
  old shape; ten rows proves nothing.
- lock_timeout scope: confirm it applies per-transaction on the bid path only, not
  session-wide via the shared pool (a pool-wide SET leaks into unrelated queries).
- Sweep cadence vs table growth: check the window and cadence actually bound the table
  under the review's growth model (every 2s polling is reads, but offers accrue per
  trade; estimate and record the steady-state size).

## Reviewers

`database-performance-reviewer`, `migration-safety`, `test-coverage-auditor`;
`qa-checklist` last.

## Exit

Verdict, counts, deferrals. Update progress.md and state.md. Next file:
`docs/woc-marketplace-hardening/phase-18-dashboard-guardrails.md`.
