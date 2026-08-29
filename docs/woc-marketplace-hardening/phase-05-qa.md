# Phase 05 QA: Custody entry hardening

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/wocc-marketplace`; verify `pwd` and
`git branch --show-current` (must print `feature/woc-marketplace`). Then
`git fetch origin` and merge the newest `origin/release/**` branch (currently
`origin/release/v0.37.0`) so this session starts current; if the merge is
non-trivial, run the `release-merge-audit` skill on it before continuing.

Dedicated QA session for phase 05. Canonical QA workflow in `implementation-plan.md`.
Repo: game, worktree `/Users/fernando/Documents/wocc-marketplace`.

## What was promised (audit every item)

Escrow write through the per-character save queue with an interleave test; bindOnTrade
refusal on the woc rail; both custody helpers extracted behind SimContext with tests and
a determinism assertion; the tightened token-firewall scan.

## Phase-specific probes

- The save-queue routing must cover EVERY escrow-entry call site, not just the one the
  review cited: enumerate all callers of the extraction write.
- The interleave test must exercise the real save queue, not a mock that trivially
  serializes; check what the test actually schedules.
- Sibling-pipe parity: read the gold-market and mail predicates side by side with the
  new woc predicate; a semantic difference (not just shared code) is a finding.
- Extraction is move-not-rewrite; rng draw order and tick order unchanged
  (`architecture-reviewer` confirms; also check no new `Rng` draws).
- Firewall scan: run it against a planted `lamports` token in a scratch sim file to
  prove the new patterns fire; remove the plant.
- Mutation pass: revert the eligibility predicate; its test reds.

## Reviewers

`architecture-reviewer`, `privacy-security-review`, `test-coverage-auditor`;
`qa-checklist` last.

## Exit

Verdict, counts, deferrals. Update progress.md and state.md. Next file:
`docs/woc-marketplace-hardening/phase-06-directed-rail-integrity.md`.
