# Phase 05: Custody entry hardening (escrow write, eligibility, sim seam)

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/wocc-marketplace`; verify `pwd` and
`git branch --show-current` (must print `feature/woc-marketplace`). Then
`git fetch origin` and merge the newest `origin/release/**` branch (currently
`origin/release/v0.37.0`) so this session starts current; if the merge is
non-trivial, run the `release-merge-audit` skill on it before continuing.

Follow the shared workflow in `implementation-plan.md` first; `state.md` has the
validation matrix. This file is the phase spec.

- Repo: game. Worktree `/Users/fernando/Documents/wocc-marketplace`, branch `feature/woc-marketplace`.
- Closes: H5, H6, and the coordinator-drift medium (sim extraction + firewall scan).
- review.md: H5, H6, Medium "Coordinator drift".

## Goal

Harden the point where an item enters custody: the escrow write cannot be raced by an
autosave, ineligible gear cannot enter the real-money rail, and the sim-side custody
helpers live behind the proper seam with tests.

## Findings context (verified 2026-08-11; re-verify line numbers)

- H5 at `server/woc_market.ts:892`: the escrow character write bypasses the per-character
  save queue; an autosave that serialized the bags BEFORE extraction can commit its stale
  snapshot after the escrow commits, restoring the item to durable bags while the listing
  holds the escrowed copy (sell it and keep it, no crash needed).
- H6 at `src/sim/exchange_eligibility.ts:77`: still-armed bindOnTrade commissioned gear
  passes the woc-rail exchange lock; both sibling pipes (gold market, mail) refuse
  exactly this.
- Coordinator drift: `extractTradableCopy` / `grantTradableCopy` grew onto `src/sim/sim.ts`
  instead of a module behind `SimContext`; `grantTradableCopy` has no test; the sim
  token-firewall scan exempts `sim.ts` wholesale and its regex misses `signature`,
  `lamports`, and `base58` shapes.

## Deliverables

1. H5: the escrow extraction write goes through the per-character save queue (the same
   serialization every other durable character write uses), so no stale autosave can
   land after it. Interleaving test: autosave snapshot taken before extraction must not
   resurrect the item.
2. H6: `exchange_eligibility` refuses still-armed bindOnTrade commissioned gear on the
   woc rail, matching the gold-market and mail predicates; sim-level test covering armed,
   disarmed, and never-armed cases.
3. Extract `extractTradableCopy` / `grantTradableCopy` into a sim module behind the
   `SimContext` seam (`src/sim/CLAUDE.md` recipe); `sim.ts` becomes a thin consumer. Unit
   tests for BOTH helpers (grantTradableCopy currently has none) plus a determinism
   assertion; do not grow `sim.ts` (lower its ceiling if the extraction allows).
4. Tighten the token-firewall scan in the architecture guard: remove the wholesale
   `sim.ts` exemption (allowlist only the concrete residue that must remain, if any) and
   extend the pattern set with `signature`, `lamports`, `base58` shapes. The scan must
   still pass on the whole tree.

## Out of scope

Directed-rail rules (phase 06); any IWorld surface change (none expected; if one becomes
necessary, follow the facet + parity-pin recipe and add `cross-platform-sync` to review).

## Validation

`npx tsc --noEmit`; `npx vitest run tests/architecture.test.ts` plus the new sim and
interleave suites and the marketplace server suites; `npm run ci:changed`; commit, then
`node scripts/gate_select.mjs`.

## Reviewers

`architecture-reviewer` (sim extraction, determinism, firewall scan),
`privacy-security-review` (H5 race, H6 laundering rail), `test-coverage-auditor`.
`qa-checklist` last.

## Acceptance criteria

- [ ] Autosave-interleave test: stale snapshot cannot resurrect an escrowed item
- [ ] Armed bindOnTrade gear refused on the woc rail; sibling-pipe parity asserted
- [ ] Both custody helpers live in a SimContext module with tests and a determinism
      assertion; `sim.ts` did not grow
- [ ] Firewall scan runs with no wholesale `sim.ts` exemption and the extended patterns

## Wrap-up

Update progress.md and state.md (module path, any ceiling change). Next file:
`docs/woc-marketplace-hardening/phase-05-qa.md`.
