# Phase 07 QA: Policy and Terms drafts

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/wocc-marketplace`; verify `pwd` and
`git branch --show-current` (must print `feature/woc-marketplace`). Then
`git fetch origin` and merge the newest `origin/release/**` branch (currently
`origin/release/v0.37.0`) so this session starts current; if the merge is
non-trivial, run the `release-merge-audit` skill on it before continuing.

Dedicated QA session for phase 07. Canonical QA workflow in `implementation-plan.md`.
Repo: game (docs only), worktree `/Users/fernando/Documents/wocc-marketplace`.

## What was promised (audit every item)

Counsel-ready Terms draft; token-utility reconciliation across every claiming doc; the
decision memo; the staleness cluster fixed; R6 tracked in state.md.

## Phase-specific probes

- Completeness against code, not against the review: list the marketplace mechanics from
  the shipped feature set (listings, auctions, buy-now, directed offers, bonds,
  forfeiture, fee split, burn, custody mail, disputes/pauses) and check the Terms draft
  covers each; the review's three cited lines are a floor, not the scope.
- Fresh grep for the claims ("never power", "no monetary value", "cannot be redeemed",
  "no transaction"): every hit in a shipped doc must be reconciled or justified.
- The draft must not overpromise either: flag any drafted commitment the code does not
  actually implement (for example a dispute flow the dashboard does not have yet).
- Anchor rule: no literal counts or line numbers in the updated docs.
- Copy scan: no em dashes, en dashes, or emojis anywhere in the diff.

## Reviewers

None (docs-only). One fresh proofread subagent for consistency and overpromise hunting.

## Exit

Verdict, counts, deferrals. Update progress.md and state.md. Next file:
`docs/woc-marketplace-hardening/phase-08-service-auth-hardening.md`.
