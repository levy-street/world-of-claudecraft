# Phase 06 QA: Directed rail and self-deal integrity

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/wocc-marketplace`; verify `pwd` and
`git branch --show-current` (must print `feature/woc-marketplace`). Then
`git fetch origin` and merge the newest `origin/release/**` branch (currently
`origin/release/v0.37.0`) so this session starts current; if the merge is
non-trivial, run the `release-merge-audit` skill on it before continuing.

Dedicated QA session for phase 06. Canonical QA workflow in `implementation-plan.md`.
Repo: game, worktree `/Users/fernando/Documents/wocc-marketplace`.

## What was promised (audit every item)

Item fingerprint bound at offer time and enforced at acceptance; 600s directed hold with
strike and cap; wallet-twin refusal on both rails in atomic SQL; guardBalance on directed
creation; unpaid-expiry auto-close and return; real-SQL tests per item.

## Phase-specific probes

- Fingerprint strength: what exactly is fingerprinted? Enchant/charge/durability state
  changing between offer and accept must refuse; a byte-identical duplicate item in
  another bag slot should be examined and the chosen semantics documented and tested.
- The wallet-twin guard must live in the atomic claim SQL, not a pre-check (race).
  Confirm with the final SQL text; also confirm the bid path's existing guard was not
  weakened for symmetry.
- Strike parity: same thresholds and decay as public-rail strikes, or a documented
  difference; read the strike machinery, do not assume.
- Auto-close: verify the return path reuses the phase 02/03 hardened lifecycle (no new
  bespoke mail/close code that reintroduces the dupe surface).
- Mutation pass on each guard; tests red.

## Reviewers

`privacy-security-review`, `test-coverage-auditor`; `qa-checklist` last.

## Exit

Verdict, counts, deferrals. Update progress.md and state.md. Next file:
`docs/woc-marketplace-hardening/phase-07-policy-terms-drafts.md`.
