# Phase 01 QA: Branch baseline

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/wocc-marketplace`; verify `pwd` and
`git branch --show-current` (must print `feature/woc-marketplace`). Then
`git fetch origin` and merge the newest `origin/release/**` branch (currently
`origin/release/v0.37.0`) so this session starts current; if the merge is
non-trivial, run the `release-merge-audit` skill on it before continuing.

Dedicated QA session for phase 01. Follow the canonical QA workflow in
`implementation-plan.md` (audit fan-out, FIX applies ALL findings including nits,
re-review the fix round, verdict format). Repo: game, worktree
`/Users/fernando/Documents/wocc-marketplace`.

## What was promised (audit every item)

The five coordinator re-review verdicts; the `src/ui/hud/woc_trade/` extraction
(view-core + painter + barrel + tests); monolith green with a LOWERED hud.ts ceiling; a
green `gate_select` baseline recorded in state.md; zero behavior change.

## Phase-specific probes

- Move-not-rewrite: diff the removed `hud.ts` block against the new module semantically;
  every branch, guard, and early return must survive. Flag any "improvement" smuggled in.
- Hunt dangling references: old private fields or helpers the extraction left behind on
  `Hud`; dead CSS or ids the move orphaned.
- The ceiling was LOWERED, not merely passing: read the pinned value vs the new line
  count; headroom to regrow is a finding.
- Re-run `node scripts/gate_select.mjs` yourself on the committed tip; do not trust the
  recorded result.
- Confirm all FIVE coordinators got a verdict; a missing one is a finding.
- View-core tests are decisive: mutate a transition guard mentally (or actually) and
  check a test would fail (test-pin-traps memory applies).

## Reviewers

`frontend-seam-reviewer` on the final diff; `test-coverage-auditor` on the new tests;
`qa-checklist` last.

## Exit

Verdict (PASS / PASS-WITH-FOLLOWUPS / FAIL), counts found and fixed, deferrals into
progress.md. Update state.md. Next file:
`docs/woc-marketplace-hardening/phase-02-settlement-state-guards.md`.
