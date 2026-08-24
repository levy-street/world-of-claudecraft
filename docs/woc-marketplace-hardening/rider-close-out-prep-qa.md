# Rider QA: close-out prep (paired QA for rider-close-out-prep.md)

SESSION START (do this first): same three-repo entry as the paired spec.
In `/Users/fernando/Documents/wocc-marketplace` (branch
`feature/woc-marketplace`): `git fetch origin`, merge the newest
`origin/release/**` (release-merge-audit on any non-trivial merge). In
`/Users/fernando/Documents/woc-rewards-service-pr31`
(`integration/woc-market-settlement`) and
`/Users/fernando/Documents/woc-rewards-dashboard-pr13`
(`integration/woc-market-trading`): `git fetch origin`, merge
`origin/master`. Verify `pwd` + branch first; clean trees or stop and ask.

Follow implementation-plan.md's QA phase workflow. The implement round's
registry section in progress.md is binding (JUDGED and DEFERRED lists: do
not re-raise). Diff ranges: from the commits recorded there, in each repo
the rider touched.

## Audit focus (on top of the canonical QA workflow)

1. Runbook truth: every procedure verified against SHIPPED code with the
   file open (an operator following it cold must not hit a step the code
   refuses); the obligation sweep re-run independently (grep state.md and
   progress.md for "runbook" and "22 owns") and reconciled against the
   runbook's coverage; anchor rule held (stable paths, no counts or line
   numbers).
2. Audit-table honesty: re-derive a sample of evidence rows from scratch
   (run the cited commands, open the cited tests); every devnet row OPEN,
   none quietly checked; the R9 grep and the 06 deploy-note checks
   reproduced.
3. Cross-repo contract: the wocDecimals/settled-total payload change
   exercised over the REAL wire shape on both sides (service test pins the
   payload; dashboard test pins the preference order and the mismatch
   banner); no fake-only coverage of a money figure.
4. Ruling-gate ledger: every question from the spec's gate has a recorded
   answer or re-park in state.md; any "change code" outcome carries its
   tests and, for money/security pins, its mutants in
   phase-20-mutation-log.md at the 20 protocol.
5. CLAUDE.md upkeep: any new seam, endpoint, env var, monitor, or doc the
   rider added is reflected in the NEAREST CLAUDE.md (game: owning
   directory; service and dashboard: repo top level).

## Validation matrix

Service `npm run build` + `npm test`; dashboard `npm test` + `npm run
check` + `npm run build`; game `npm run ci:changed` (docs-only) or the full
matrix plus `node scripts/gate_select.mjs` on the committed tree if game
code changed (TEST_DATABASE_URL on the command line only).

## Verdict and push

PASS or PASS-WITH-FOLLOWUPS (every fix applied) pushes per R4: game
`git push origin feature/woc-marketplace`; service
`git push origin integration/woc-market-settlement:feature/woc-market-settlement`
(updates PR #31); dashboard
`git push origin integration/woc-market-trading:feature/woc-market-trading-controls`
(updates PR #13). FAIL pushes nothing. Sweep every outgoing commit for
secrets before pushing (open-source repo rule).

## Wrap-up

Update progress.md and state.md. Next file: the 21 resume
(`docs/woc-marketplace-hardening/phase-21-devnet-dry-run.md`, once devnet
SOL exists; devnet.md carries the runbook), then phase-21-qa.md, then
phase-22-close-out.md (now shrunken to the devnet evidence rows, the three
gates, and PR prep).
