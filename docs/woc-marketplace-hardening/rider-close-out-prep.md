# Rider: close-out prep (the 21-independent half of phase 22)

WHY THIS RIDER EXISTS: the devnet dry run (21) is blocked on devnet SOL that
arrives near the end of the packet, and most of phase 22 does not depend on
it. This rider pulls the 21-independent half forward so the final 22 session
shrinks to the devnet evidence rows, the three gates, and PR prep. Minted
2026-08-20 at Fernando's request; the cadence exception is his call, same as
the two earlier riders.

SESSION START (do this first in every fresh session): this session spans
three repos. In `/Users/fernando/Documents/wocc-marketplace` (branch must be
`feature/woc-marketplace`): `git fetch origin`, merge the newest
`origin/release/**` (v0.40.0 at minting; a newer one supersedes it, follow
the newest; run the `release-merge-audit` skill on any non-trivial merge).
In `/Users/fernando/Documents/woc-rewards-service-pr31` (branch
`integration/woc-market-settlement`) and
`/Users/fernando/Documents/woc-rewards-dashboard-pr13` (branch
`integration/woc-market-trading`): `git fetch origin`, merge `origin/master`.
Verify `pwd` and the branch before any command in each repo; every tree must
be CLEAN or stop and ask (concurrent sessions exist).

Follow the shared workflow in `implementation-plan.md`; `state.md` has the
validation matrix and every ruling record. Memory scan per the workflow
(reusable-gotchas clusters for the domains touched; test-pin-traps before
any pin work). This file is the spec. Implement stays LOCAL per R4: nothing
pushed; the paired QA pushes on PASS.

## RULING GATE (before any implementation)

Present each of these to Fernando with a recommendation, then implement per
his answers. They were parked to 22 by earlier rounds and several shape the
runbook's procedures, so they come first:

1. The Not-now lock release question (14 QA deferral: what a buyer's
   "Not now" on the pay prompt does to the buy-now lock).
2. The outage-forfeit ruling (14 QA deferral: forfeit behavior when the
   service is unreachable at the deadline).
3. The terms text re-consent question (14 QA deferral: whether a Terms
   reword invalidates recorded acceptance).
4. The fail-then-pay-again service contract (14 QA deferral: the retry
   contract after a failed payment).
5. The pg-suites-in-CI standing posture (20/22: whether the real-SQL
   battery joins CI; a gate-selection change owned by the game repo).

Rulings answered "change code" become scoped code items IN THIS RIDER (with
tests, and any new money/security pin gets its mutant logged in
phase-20-mutation-log.md at the 20 protocol). "Document only" lands in the
runbook. "Defer" is recorded in state.md with an owner. Also RE-SURFACE,
never re-decide: the woc_market.ts ceiling raise, the woc_market_db.ts
no-ratchet-row question, the escrow gate hold-ceiling sizing, the
auth-rider TTL brownout note, and R11's pre-enable status.

## Goal

Operators get the runbook, the acceptance bar gets its evidence table for
every row that does not need devnet, the 19/22 cross-repo ask lands, and the
parked decisions are settled or explicitly re-parked, so the final 22
session after the dry run is small.

## Deliverables

1. Ops runbook, `docs/woc-market-runbook.md` in the game repo (the phase 22
   deliverable pulled forward): pause and resume trading (the service pause
   the dashboard drives), force-release and refund flows, the
   unbooked-claims and stranded-settling monitors, the confirming-age
   resolution procedure, and the alarm meanings from the oracle and custody
   surfaces, written from SHIPPED behavior and cited by stable paths
   (anchor rule). It must ABSORB every scattered "22 runbook" obligation:
   sweep state.md and progress.md for the words "runbook" and "22 owns" and
   fold each hit in; the known list at minting includes the forward-only
   deploy and rollback caveats (02/03 ledgers), pause-before-deploy in a
   live settlement window plus the halt/recovered line meanings (11), the
   bidirectional deploy coupling and bond-knob lockstep (12, DEPLOY.md),
   escrow SOL funding and the low-SOL monitor as a MANUAL op (09, R5),
   probe-endpoint independence (two genuinely independent RPC vendors), the
   365d memoRef-trace bound and the sweep-budget arithmetic (17), the
   host-clock diagnosis note, the RPC-defect handling rule, the
   suspension-freezes-sweeps-returns-refunds procedure, the first-sweep
   backlog deploy note, the review-resolution step-by-step, the wind-down
   runbook (07), the cold-boot single-print exposure note (11 ruling), and
   the flag from the 21 session: the Python payout service's
   DAILY_REWARD_WOC_USD_PRICE fixed-price knob has NO environment gate
   (pre-existing; document the operational rule until Fernando rules on a
   code change). The devnet rehearsal section cites devnet.md and is marked
   pending the 21 legs.
2. The 19/22 cross-repo ask: the SERVICE reports wocDecimals (and the
   settled-total figure the dashboard's Trading tab wants) on the market
   admin payloads, with tests; the DASHBOARD prefers the service-reported
   value over its constant and keeps the divergence banner for a mismatch
   (woc_mint.ts documents the window this closes), with tests. Both repos'
   suites green.
3. Acceptance-bar audit PREP, `acceptance-audit.md` in the packet dir: walk
   review.md's "Acceptance bar" and this packet's qa-checklist.md row by
   row, attaching evidence (test file, command output, state.md record,
   screenshot path) for every row that does not need devnet; the devnet
   rows are listed OPEN with a pointer at the 21 evidence table. This
   includes the R9 verification (grep the woc_trade controller for a
   hard-coded acceptTerms; a survivor FAILS the pre-enable bar) and the 06
   ledger's deploy-note checks (the two dev-database classes and the
   bindOnTrade scan line). Nothing is hand-waved.
4. The follow-ups list DRAFT (the 22 deliverable pulled forward as a
   draft): every deferral accumulated in progress.md, the P2/P3 PRD gaps
   not taken, and the external gates (counsel sign-off R6, deploy
   sequencing, R11), marked draft until 21 closes it out.

## Out of scope

Anything that needs devnet SOL or the chain (21 owns all of it); the three
final gate runs and the PR texts (they stay in 22, after 21); pushing,
merging, deploying, enabling WOC_MARKET_ENABLED anywhere; packet teardown.

## Validation

Service: `npm run build` + `npm test` in `service/`. Dashboard: `npm test`,
`npm run check`, `npm run build`. Game: docs-only means `npm run
ci:changed`; if a ruling adds game code, the full matrix applies (targeted
vitest, then `node scripts/gate_select.mjs` on the committed tree,
TEST_DATABASE_URL on the command line only).

## Reviewers

Correctness lens over the runbook against shipped behavior (the 22 spec's
own reviewer, pulled forward) and over the audit table's evidence;
security lens over any service/dashboard code change; test-coverage-auditor
if tests are a deliverable of a ruling's code item. Fix rounds re-reviewed
FRESH; every finding applied or judged with the file open.

## Acceptance criteria

- [ ] Runbook exists, absorbs every swept obligation, an operator could
      follow it cold; devnet rehearsal marked pending 21
- [ ] wocDecimals (and settled total) served by the service and preferred
      by the dashboard, tests green both repos
- [ ] Acceptance audit covers every non-devnet row with evidence; devnet
      rows explicitly OPEN
- [ ] Every ruling-gate question settled or re-parked with an owner
- [ ] Zero secrets in any commit (diff sweep before every commit)

## Wrap-up

Update progress.md (this rider gets its own registry section) and state.md.
Next file: `docs/woc-marketplace-hardening/rider-close-out-prep-qa.md`
(FRESH session; it pushes on PASS per R4). After that, the packet resumes
with the 21 devnet legs once SOL exists (devnet.md runbook), then
phase-21-qa.md, then the shrunken phase-22-close-out.md.
