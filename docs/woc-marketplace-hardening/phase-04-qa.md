# Phase 04 QA: Bond and payment lifecycle

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/wocc-marketplace`; verify `pwd` and
`git branch --show-current` (must print `feature/woc-marketplace`). Then
`git fetch origin` and merge the newest `origin/release/**` branch (currently
`origin/release/v0.37.0`) so this session starts current; if the merge is
non-trivial, run the `release-merge-audit` skill on it before continuing.

Dedicated QA session for phase 04. Canonical QA workflow in `implementation-plan.md`.
Repo: game, worktree `/Users/fernando/Documents/wocc-marketplace`.

## What was promised (audit every item)

Signature-first intake; refresh CAS on paid bonds; cancellation keeps paid bonds polled;
bounded confirming age with a defined resolution state; bonded-only anti-snipe extension;
real-SQL tests failing on old behavior for each.

## Phase-specific probes

- Walk every refusal path in the payment intake: none may return before the signature is
  persisted. Grep for early returns added or left between intake and persist.
- The confirming bound must be config-read (documented in `.env.example` when phase 12
  lands; note it in state.md), not a hardcoded constant, and its default sane (hours,
  not minutes; not so long it recreates H15).
- Check the polling-set change against unbounded growth: a bond that can never resolve
  must still exit the set via forfeit/expiry policy, or the set grows forever
  (database-performance lens).
- Mutation pass on each of the five deliverables: revert the guard locally, test reds.
- The resolution state must be reachable by the phase 03 monitor (seeded row shows up).

## Reviewers

`privacy-security-review`, `database-performance-reviewer`, `test-coverage-auditor`;
`qa-checklist` last.

## Exit

Verdict, counts, deferrals. Update progress.md and state.md. Next file:
`docs/woc-marketplace-hardening/phase-05-custody-entry-hardening.md`.
