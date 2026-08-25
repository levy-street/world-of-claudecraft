# Phase 20 QA: Real-SQL coverage

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/wocc-marketplace`; verify `pwd` and
`git branch --show-current` (must print `feature/woc-marketplace`). Then
`git fetch origin` and merge the newest `origin/release/**` branch (currently
`origin/release/v0.39.0`) so this session starts current; if the merge is
non-trivial, run the `release-merge-audit` skill on it before continuing.

Dedicated QA session for phase 20. Canonical QA workflow in `implementation-plan.md`.
Repo: game, worktree `/Users/fernando/Documents/wocc-marketplace`. Read the
`test-pin-traps-index` memory catalog first.

## What was promised (audit every item)

A complete predicate inventory; real-SQL pins for every money/security predicate; a
mutation log proving red-on-strip for all of them; fake divergences fixed and listed.

## Phase-specific probes

- Independently re-derive the inventory: sweep `woc_market_db.ts` and sibling modules
  for WHERE-clause guards, ON CONFLICT targets, and conditional UPDATE predicates; diff
  against the phase's inventory; a predicate the inventory missed is the phase's own
  blind spot.
- Spot-re-run the mutation check yourself on the three highest-value pins (self-buy,
  book-once, settlement CAS); do not trust the log alone.
- Pin quality: hunt constant-self-comparison shapes, tests green because seeding never
  creates the violating row, and asserts on the fake path smuggled into "real" suites
  (the DB handle must be the pg pool, not the fake).
- Check the suites run in the gate: `node scripts/gate_select.mjs` must select them for
  marketplace diffs (verify with a dry selection), or they are coverage theater.

## Reviewers

`test-coverage-auditor` on the final diff; `qa-checklist` last.

## Exit

Verdict, counts, deferrals. Update progress.md and state.md. Next file:
`docs/woc-marketplace-hardening/phase-21-devnet-dry-run.md`.
