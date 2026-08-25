# Phase 14 QA: UX honesty on the money surface

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/wocc-marketplace`; verify `pwd` and
`git branch --show-current` (must print `feature/woc-marketplace`). Then
`git fetch origin` and merge the newest `origin/release/**` branch (currently
`origin/release/v0.39.0`) so this session starts current; if the merge is
non-trivial, run the `release-merge-audit` skill on it before continuing.

Dedicated QA session for phase 14. Canonical QA workflow in `implementation-plan.md`.
Repo: game, worktree `/Users/fernando/Documents/wocc-marketplace`.

## What was promised (audit every item)

Working decline and directed-listing cancel; distinct truthful outcome states; quote
review in the Pay flow; the pre-bid disclosure; fully localized wallet-bridge failures
and Intl currency formatting; view-core tests for all of it.

## Phase-specific probes

- State-machine truth table: enumerate every listing/settlement terminal state the
  server can produce (use the phase 02 to 04 state additions) and check each renders a
  distinct, correct player string; an unmapped state falling through to a generic
  "settled" is the original bug.
- Decline/cancel server paths must respect the settlement-aware guards: declining or
  cancelling mid-payment must follow phase 02 semantics, not bypass them via the new
  command.
- Disclosure placement: the no-withdraw text must appear BEFORE the first
  charge-committing click on both desktop and mobile flows, not on a screen the flow
  can skip.
- Currency grep: any remaining string-concatenated symbol or `toFixed` money rendering
  in the market UI is a finding.
- i18n: keys English-only in the catalog, no overlay edits, M16 check on wordy values.

## Reviewers

`frontend-seam-reviewer`, `cross-platform-sync`, `test-coverage-auditor`; `qa-checklist`
last.

## Exit

Verdict, counts, deferrals. Update progress.md and state.md. Next file:
`docs/woc-marketplace-hardening/phase-15-ui-polish.md`.
