# Phase 20: Real-SQL coverage for money and security predicates

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/wocc-marketplace`; verify `pwd` and
`git branch --show-current` (must print `feature/woc-marketplace`). Then
`git fetch origin` and merge the newest `origin/release/**` branch (currently
`origin/release/v0.39.0`) so this session starts current; if the merge is
non-trivial, run the `release-merge-audit` skill on it before continuing.

Follow the shared workflow in `implementation-plan.md` first; `state.md` has the
validation matrix. Read the `test-pin-traps-index` memory catalog BEFORE this session's
work; this phase is exactly the terrain it covers. This file is the phase spec.

- Repo: game. Worktree `/Users/fernando/Documents/wocc-marketplace`, branch `feature/woc-marketplace`.
- Closes: the "Money/security SQL is fake-only" medium.
- review.md: Medium list, first item.

## Goal

Every money and security predicate the marketplace ships is pinned against real
Postgres, decisively: deleting the shipped predicate turns a test red.

## Findings context (verified 2026-08-11)

- The self-buy guard, shill-bid wallet-twin guard, escrow atomicity, book-once
  `ON CONFLICT`, realm scoping, and settlement state CAS are exercised only against
  `FakeWocMarketDb`; deleting the shipped SQL predicate stays green. Only the
  directed-sale/bond/ops predicates got real-SQL pins.
- Phases 02 to 06 and 16 to 17 added real-SQL tests for THEIR changes; this phase
  closes the remainder and audits the whole set.

## Deliverables

1. Inventory: enumerate every money/security predicate in `woc_market_db.ts` (and
   siblings) and classify its current coverage: real-SQL pinned, fake-only, or
   untested. The inventory lands in state.md.
2. Real-SQL pins for every fake-only or untested predicate, at minimum: self-buy guard,
   shill-bid wallet-twin guard, escrow atomicity, book-once `ON CONFLICT`, realm
   scoping, settlement state CAS. Each test seeds real rows and exercises the real
   query path.
3. Mutation verification: for EVERY pin (new and pre-existing marketplace real-SQL
   pins), temporarily strip the predicate and prove the test reds; restore. Record the
   mutation log in the phase notes (prove the tests ran; no checkout over uncommitted
   work, per the memory traps).
4. Fake honesty: where the fake's behavior diverged from real SQL during pinning, fix
   the fake (or the code) and note each divergence found.

## Out of scope

New predicates or behavior changes (a divergence that reveals a real bug gets a
minimal fix + test, or a deferral entry if large).

## Validation

`npx tsc --noEmit`; the full marketplace real-SQL suite against `npm run db:up`;
`npm run ci:changed`; commit, then `node scripts/gate_select.mjs`.

## Reviewers

`test-coverage-auditor` (the deliverable itself), `database-performance-reviewer` (the
new suites' cost and seeding hygiene). `qa-checklist` last.

## Acceptance criteria

- [ ] Inventory in state.md with zero remaining fake-only money/security predicates
- [ ] Mutation log shows every pin red-on-strip, green-on-restore
- [ ] Any fake divergence found is fixed and listed
- [ ] Suite runtime stays reasonable (bounded seeding, shared setup)

## Wrap-up

Update progress.md and state.md. Next file:
`docs/woc-marketplace-hardening/phase-20-qa.md`.
