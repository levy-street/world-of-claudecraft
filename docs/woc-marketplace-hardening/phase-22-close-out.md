# Phase 22: Close-out (runbook, acceptance audit, gates, PR prep)

NOTE (2026-08-20, recorded when the 21 dry run blocked on devnet SOL):
`rider-close-out-prep.md` pulled the 21-independent half of this phase
forward at Fernando's request: deliverable 1 (the runbook), the evidence
prep for deliverable 2 (all non-devnet rows), the 19/22 wocDecimals
cross-repo ask, and the deliverable-5 draft. When this phase finally runs
(AFTER phase-21-qa.md), start from the rider's registry section in
progress.md and do only what remains: the devnet rows of the audit, the
three gate runs, the PR texts, and the follow-ups handover.

SESSION START (do this first in every fresh session): this session spans all
three repos. In `/Users/fernando/Documents/wocc-marketplace` (branch must be
`feature/woc-marketplace`): `git fetch origin`, merge the newest `origin/release/**`
(currently `origin/release/v0.39.0`). In
`/Users/fernando/Documents/woc-rewards-service-pr31` (branch
`integration/woc-market-settlement`) and
`/Users/fernando/Documents/woc-rewards-dashboard-pr13` (branch
`integration/woc-market-trading`): `git fetch origin`, merge `origin/master`. Verify
`pwd` and the branch before any command in each repo.

Follow the shared workflow in `implementation-plan.md` first; `state.md` has the
validation matrix and every ruling record. This file is the phase spec.

- Repos: all three (game worktree `/Users/fernando/Documents/wocc-marketplace`, service
  worktree `/Users/fernando/Documents/woc-rewards-service-pr31`, dashboard worktree
  `/Users/fernando/Documents/woc-rewards-dashboard-pr13`).
- Closes: the ops-runbook acceptance-bar item and the packet itself.

## Goal

Everything the acceptance bar demands is verified with evidence, all three repos gate
green, operators have a runbook, and the three PRs are ready for Fernando to review and
push.

## Deliverables

1. Ops runbook (a durable doc in the game repo, for example
   `docs/woc-market-runbook.md`): pause and resume trading (the service pause the
   dashboard drives), force-release and refund flows, working the unbooked-claims and
   stranded-settling monitor, the confirming-age resolution procedure, devnet rehearsal
   pointers, and the alarm meanings from the oracle and custody surfaces. Written from
   the SHIPPED behavior of phases 02 to 19, cited by stable paths (anchor rule).
2. Acceptance-bar audit: walk `review.md`'s "Acceptance bar" and this packet's
   `qa-checklist.md` row by row, attaching evidence (test file, command output,
   state.md record, screenshot path) for every box. Any box that cannot be checked
   becomes an explicit open item for Fernando; nothing is hand-waved. This audit
   ALSO verifies ruling R9 is resolved: the trade window must not record terms
   acceptance it never showed (grep the woc_trade controller for a hard-coded
   acceptTerms; a surviving one FAILS the pre-enable bar), plus the two dev-database
   classes and the bindOnTrade scan line from the 06 ledger's deploy notes.
3. Full gates, all green: game `node scripts/gate_select.mjs` on the committed tip
   (plus `npm run gate` if Fernando wants the deeper run); service `npm run build` +
   `npm test`; dashboard `npm test` + `npm run check` + `npm run build`.
4. PR prep, no pushes without approval: the game PR body per
   `.github/PULL_REQUEST_TEMPLATE.md` (screenshots from phase 15 referenced; no
   packet-internal wording; remember the word "phase" never appears in PR text);
   updated descriptions for service PR #31 and dashboard PR #13. i18n posture stated in
   the game PR: English-only pending rows are expected at PR tier; release fills are
   maintainer release work.
5. A follow-ups list: every deferral accumulated in progress.md, the P2/P3 PRD gaps not
   taken (player wiki/guide surface, dispute-case UI beyond what shipped, the numeric
   reserve guard), and the external gates (counsel sign-off R6, deploy sequencing),
   handed to Fernando as the post-packet queue.

## Out of scope

Pushing, merging, deploying, or enabling `WOC_MARKET_ENABLED` anywhere. Packet teardown
happens in phase 22 QA, not here.

## Validation

The three gate runs above, recorded in state.md with tips and results.

## Reviewers

`qa-checklist` over the whole game diff (branch base to tip); generic correctness lens
over the runbook against shipped behavior.

## Acceptance criteria

- [ ] Runbook exists, cites real procedures, and an operator could follow it cold
- [ ] Every acceptance-bar and qa-checklist box checked with evidence or explicitly
      listed open
- [ ] All three repos gate green on their committed tips
- [ ] Three PR texts drafted; follow-ups list handed over

## Wrap-up

Update progress.md and state.md. Next file:
`docs/woc-marketplace-hardening/phase-22-qa.md` (final QA: independent audit, then the
packet teardown offer).
