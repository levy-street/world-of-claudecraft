# Phase 13 QA: Step-up authorization

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/wocc-marketplace`; verify `pwd` and
`git branch --show-current` (must print `feature/woc-marketplace`). Then
`git fetch origin` and merge the newest `origin/release/**` branch (currently
`origin/release/v0.39.0`) so this session starts current; if the merge is
non-trivial, run the `release-merge-audit` skill on it before continuing.

Dedicated QA session for phase 13. Canonical QA workflow in `implementation-plan.md`.
Repo: game, worktree `/Users/fernando/Documents/wocc-marketplace`.

## What was promised (audit every item)

Challenge-signature enforcement on both custody-moving ops with replay/expiry/binding
protection; the client prompt UX; zero phantom scaffolding; the R1 record.

## Phase-specific probes

- Attack the challenge protocol: reuse a challenge for a different item; reuse across
  accounts; sign with a formerly-linked wallet after relink; race two ops on one
  challenge; each must refuse with a test.
- Enumerate EVERY custody-moving entry point (including any admin or internal path that
  lists or moves player items) and check the enforcement boundary is server-side in the
  handler, not in a middleware a future route can miss; a bypassable sibling path is
  BLOCKING.
- Verify the signature verification uses the canonical linked-wallet record (the same
  source the payment path trusts), not a client-supplied pubkey.
- TOTP remnant grep across code, styles, i18n catalogs, error catalogs, .env.example,
  and committed screenshots (stale captures are H13's finding; note for phase 15).
- UX honesty: the failure and pending states render real t() text (S3 green), and the
  mobile layout was actually checked (screenshot or DOM probe evidence).

## Reviewers

`privacy-security-review`, `frontend-seam-reviewer`, `test-coverage-auditor`;
`qa-checklist` last.

## Exit

Verdict, counts, deferrals. Update progress.md and state.md. Next file:
`docs/woc-marketplace-hardening/phase-14-ux-honesty.md`.
