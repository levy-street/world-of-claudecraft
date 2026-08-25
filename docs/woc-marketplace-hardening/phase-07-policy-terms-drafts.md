# Phase 07: Policy and Terms drafts (counsel package)

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/wocc-marketplace`; verify `pwd` and
`git branch --show-current` (must print `feature/woc-marketplace`). Then
`git fetch origin` and merge the newest `origin/release/**` branch (currently
`origin/release/v0.37.0`) so this session starts current; if the merge is
non-trivial, run the `release-merge-audit` skill on it before continuing.

Follow the shared workflow in `implementation-plan.md` first; `state.md` has the
validation matrix and rulings R6 AND R9 (the 06 QA round's implied-consent
finding: the trade window's $WOC arm records terms acceptance while showing no
terms text; read R9's full text before drafting). This file is the phase spec.

- Repo: game (docs only). Worktree `/Users/fernando/Documents/wocc-marketplace`, branch
  `feature/woc-marketplace`.
- Closes: B7 drafting (counsel sign-off remains an external launch gate) and the
  documentation staleness cluster.
- review.md: B7, PRD gap backlog P1 "policy PRD + marketing reconciliation", Medium
  "documentation staleness cluster".

## Goal

Produce the complete counsel-ready policy package now so external legal latency runs in
parallel with the rest of the packet, and make every shipped doc tell the truth about
the marketplace.

## Findings context (verified 2026-08-11)

- `TERMS_AND_CONDITIONS.md:45` still prohibits selling in-game items for real money;
  line 58 states items "have no monetary value and cannot be redeemed for real money";
  line 65 says wallet verification "involves no transaction and no transfer of funds".
- `docs/prd/wallet-link.md:56`, `docs/prd/holder-cosmetic-flair.md:14`, and `README.md`
  still assert token utility is "never power", with no marketplace carve-out for trading
  stat-bearing gear.
- Six docs contradict shipped marketplace behavior (the staleness cluster; the Explore
  agent enumerates them from the review findings and a fresh grep).

## Deliverables

1. Revised Terms draft: real-money item trading, custody and escrow, bonds and
   forfeiture, fees and the burn leg, dispute and refund posture, wallet transactions.
   Clearly marked DRAFT FOR COUNSEL, kept alongside the current Terms (do not replace
   the live Terms in this phase).
2. Token-utility reconciliation drafts for the policy PRDs and README: a marketplace
   carve-out that states the adopted position (trading stat-bearing gear for $WOC is
   real; "never power" is rescoped to what remains true), consistent across every doc
   that makes the claim.
3. A one-page decision memo for Fernando and counsel: the adopted position, the open
   questions counsel must answer, and exactly which lines change where (R6). Counsel
   approval is tracked in state.md as a launch gate. The memo MUST carry R9 as one of
   the counsel questions: where terms acceptance may be recorded (today the trade
   window's offer send and pay arm both record it with no terms shown), and what the
   trade-window affordance must present; the drafts state the acceptance-surface
   requirement so 14/15 can build against agreed language.
4. Fix the doc staleness cluster: every marketplace doc matches shipped behavior (cite
   stable paths and symbols per the anchor rule; no literal counts or line numbers).

## Out of scope

Publishing or replacing the live Terms; marketing copy beyond the named docs; the player
wiki/guide surface (tracked as a P2 follow-up in progress.md, decided at close-out).

## Validation

Docs-only: the copy scan floor (no em dashes, en dashes, emojis), anchor-rule check, and
`npm run ci:changed` (no code should be touched; a non-empty code diff is a scope error).

## Reviewers

None (docs-only; the dispatch rule spawns no reviewer). Have a fresh subagent
proofread the package for internal consistency: every doc must state the SAME adopted
position.

## Acceptance criteria

- [ ] Terms draft covers every marketplace mechanic that exists in code (trading, bonds,
      fees, burn, custody, disputes, wallet transactions)
- [ ] Every "never power" / "no monetary value" claim located by grep is reconciled in a
      draft; none is left contradicting the marketplace
- [ ] Decision memo lists the counsel questions and the exact line changes
- [ ] Staleness cluster fixed; no doc contradicts shipped behavior
- [ ] R6 launch-gate entry updated in state.md (sent-to-counsel status, date)

## Wrap-up

Update progress.md and state.md. Next file:
`docs/woc-marketplace-hardening/phase-07-qa.md`.
