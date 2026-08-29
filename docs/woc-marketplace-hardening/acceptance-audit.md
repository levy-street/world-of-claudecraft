# Acceptance-bar audit (close-out prep: every non-devnet row evidenced)

Prepared by the close-out prep rider (2026-08-20). This walks review.md's
"Acceptance bar" and this packet's qa-checklist.md row by row. Every row that
does not need devnet carries evidence (a test file, a command output, a
state.md record, or a screenshot path); the devnet rows are listed OPEN with a
pointer at state.md's "21 devnet dry-run evidence" table. Phase 22 finishes
this audit after the 21 legs run: it fills the devnet rows and re-runs the
three final gates at the shipping tips.

Verdict shorthand: EVIDENCED (checked now, evidence attached), OPEN-21
(needs the devnet legs), OPEN-22 (the final gate runs and PR prep), OPEN-EXT
(an external gate: counsel or a repo setting), OPEN-ENABLE (a procedure that
can only run against the production database at enable time; the runbook
documents it).

## A. review.md "Acceptance bar for safe to enable"

1. B1 to B7 closed with tests that fail on the old behavior: EVIDENCED for
   the code half, OPEN-EXT for B7's counsel half.
   - B1 (seller cancel / admin suspend vs live buy-now): phase 02;
     cancel/suspend gate on the lock and live settlement, sale-row invariant.
     Tests: tests/woc_market_settlement_pg_integration.test.ts plus the
     structural pins in tests/server/woc_market_service.test.ts; red-first
     records in the 02 ledger (state.md).
   - B2 (delivery non-atomic, three dupe/loss windows): phase 03;
     exactly-once delivery over the custody-claims ledger.
     Tests: tests/woc_market_delivery_pg_integration.test.ts; the 03 ledger
     records the red-first proofs.
   - B3 (production bond releaser did not exist): phase 09; crash-safe
     release protocol (persist before broadcast, probe on retry,
     signature-keyed finalize), SolanaMarketBondReleaser, all-or-nothing
     boot. Tests: service test/market_bond_releaser.test.ts, plus the
     all-or-nothing boot pins in test/market_bootstrap.test.ts and the
     unwired-503 arm in test/market_http.test.ts; the 09 ledger records five
     red-first proofs. The live-cluster bond cycle remains the OPEN-21
     residual (section D).
   - B4 (burn-leg redirect accepted): phase 10; the verifier proves the burn
     and rejects unexplained third-party credits. Tests: service
     test/market_solana_chain.test.ts (burn-redirect rejection pinned);
     10 ledger.
   - B5 (query-string admin bypass): phase 08. Test: service
     test/server_auth_http.test.ts pins /v1/market/admin/overview?x=1
     refused; the whole-suite record is the 08 ledger.
   - B6 (TOTP phantom; custody moves on a bearer alone): phase 13 per R1;
     wallet-signature step-up on EVERY custody-moving call, no threshold
     knob; the phantom TOTP scaffolding deleted. Tests:
     tests/woc_market_stepup_pg_integration.test.ts and the step-up flow
     suites; R1 record in state.md Rulings. Residual R11 (wallet relink) is
     a pre-enable launch gate, listed in the follow-ups.
   - B7 (policy launch gates): the drafts and decision memo shipped (07);
     counsel sign-off is R6, OPEN-EXT. The amended-draft caveat (the 07 QA
     amended the Terms AFTER the recorded send) is recorded at R6: the copy
     forwarded must be the QA-tip draft.
2. Full bond cycle on devnet with a double-release balance assert: OPEN-21
   (state.md "21 devnet dry-run evidence", bond leg; environment STAGED,
   blocked on devnet SOL).
3. Confirming settlements have a bounded resolution path (H15): EVIDENCED
   for the BOUND, with one named pre-enable gap for the operator arm.
   Game side: the review park at WOC_MARKET_CONFIRMING_REVIEW_HOURS
   (server/woc_market_routes.ts, clamped at 720h with a boot warn;
   server/woc_market_db.ts transitionSettlement review arms;
   tests/woc_market_settlement_pg_integration.test.ts). Service side:
   MAX_CONFIRMING_AGE_MS five hours, expired-never-rejected with the
   adoption arms (service/src/market/quotes.ts; test/market_http.test.ts,
   test/market_store_pg.test.ts). Ruling record: R5 (state.md). GAP,
   surfaced by the rider's runbook verification: no route or tool drives
   transitionSettlement for review resolution yet and hand SQL is
   forbidden, so a parked review row has no legitimate manual exit; the
   sanctioned operator surface is a pre-enable requirement (follow-ups
   section 4). Operator guidance: docs/woc-market-runbook.md section 10.
4. Buy-now and directed rails both enforce the wallet-twin self-deal guard
   (H14): EVIDENCED. wallet_links.pubkey is UNIQUE so the twin resolves at
   the wallet; both rails checked (06 ledger, H14 SEMANTICS bullet). Tests:
   tests/woc_market_directed_pg_integration.test.ts and
   tests/woc_market_bond_pg_integration.test.ts self-deal arms.
5. Listing step-up auth decision implemented or explicitly accepted:
   EVIDENCED as implemented (R1 ruling record in state.md; phase 13). The
   R11 relink residual is explicitly NOT covered by R1 and stays a
   pre-enable gate (follow-ups list).
6. Dashboard cannot show 1000x-wrong balances, and an overview outage does
   not hide listings: EVIDENCED. The decimals half: the mint constant is
   single-sourced (dashboard src/components/woc_mint.ts, scanned repo-wide
   by tests/woc_mint.test.ts), and since this rider the market overview
   REPORTS wocDecimals, the Trading tab converts at the reported value and
   renders the divergence banner (dashboard commit 53913d7; tests
   tests/market_trading_view.test.ts, tests/market_trading_panel_dom.test.ts;
   service commit 2c4a261, test/market_http.test.ts). The outage half:
   the three service reads and the game-backed subtabs fail INDEPENDENTLY
   (src/components/market_summary_load.ts; tests/market_summary_load.test.ts),
   and listings ride the game proxy, not the overview read.
7. Counsel-approved Terms plus PRD/marketing language: OPEN-EXT (R6). The
   PRD/marketing reconciliation half is EVIDENCED (07: never-power carve-out
   across README/PRDs; the 07 ledger's staleness cluster), so only the
   counsel grant remains.
8. Ops runbook for pause, force-release, unbooked claims, and stranded
   settling: EVIDENCED. docs/woc-market-runbook.md (this rider), sections 2,
   5, 9, 10; reviewed against shipped behavior by the rider's correctness
   lane.
9. Game branch merged and pushed (2026-08-11 row): EVIDENCED long since; the
   branch has re-synced at every session per the workflow (latest: 0 behind
   origin/release/v0.40.0 at this rider's session start). The "full
   selective gate green plus semantic re-review" half is EVIDENCED by the
   recorded gate PASS runs in every ledger since (latest full record: the
   auth-guard rider QA, all 12 steps at 3e77e6f44e); the FINAL-tip gate rerun
   stays OPEN-22.

## B. Packet qa-checklist.md

### Game repo

- gate_select green on the final tip: OPEN-22 (the final tip does not exist
  until after 21). Standing evidence that the gate is green at every landed
  tip: the per-round gate records in state.md, most recently all 12 steps at
  3e77e6f44e (42,999 tests plus browser 131).
- Sim purity and determinism guards; no token firewall regression; no new
  Rng draws: EVIDENCED. tests/architecture.test.ts rides every gate run
  (same records); the sim token firewall scan is part of the 05 ledger and
  the S3 guard suite.
- IWorld parity pins current: EVIDENCED. tests/world_api_parity.test.ts and
  tests/command_schema.test.ts ride every gate run; count pins re-derived at
  every release sync (the sync entries in state.md record each re-derive).
- Monolith ratchet green with the LOWERED hud.ts ceiling: EVIDENCED.
  tests/monolith_budget.test.ts rides every gate run; the 01 ledger records
  the hud.ts extraction and lowered ceiling; the open ceiling QUESTIONS
  (woc_market.ts raise, woc_market_db.ts no-ratchet-row) are maintainer
  rulings in the follow-ups list, not red gates.
- S3 localization guard; English catalog keys; zero hand-edited overlays:
  EVIDENCED. tests/localization_fixes.test.ts rides every gate run; the
  14 ledger records the packet's i18n posture (English plus M16 non-Latin
  fills); the release-fill debt is the maintainer list in the follow-ups.
- Real-SQL suites green against Postgres: EVIDENCED. The eight
  tests/woc_market_*_pg_integration.test.ts suites plus
  tests/server/woc_market_directed_sql.test.ts; latest full-battery record
  241 tests zero skips (escrow rider QA record in state.md); AND, since this
  rider, the suites run at the CI merge bar itself (commit 462c234031,
  ruling R16; pinned by tests/ci_workflow.test.ts).
- Marketplace hot GETs rate-limited and cache-backed: EVIDENCED. The 16
  ledger (hot-path scale) plus the auth-guard rider (per-request read cache
  with the install veto); tests/woc_market_authguard_pg_integration.test.ts
  and the hot-reads pins in tests/server/. The at-scale contention
  observations remain OPEN-21 residuals (section D).
- Fresh desktop + mobile screenshots at lowest preset: EVIDENCED for the
  shipped UI (docs/screenshots/woc-market/, committed by 14/15; the 15 QA
  re-captured all 79 after the eyeball pass). Fernando's sign-off on the set
  is recorded in the 15 QA ledger ("BEAUTIFUL WITH NOTES", notes shipped).
- Beautify bar held: EVIDENCED per the 15 QA ledger (DESIGN.md conformance
  audit, formatter sweep, stress-length checks); the deferred design items
  are product debt in the follow-ups list, recorded there with owners.

### Service repo

- npm run build + npm test green: EVIDENCED, last re-run by the rider QA at
  tip 70b71b6: build clean, 605 tests, 598 pass, 7 env-gated skips, 0 fail;
  605/605 zero skips with CLAUDIUM_TEST_DATABASE_URL on the command line.
- Query-string admin bypass regression test (B5): EVIDENCED.
  test/server_auth_http.test.ts; runs in the suite above.
- Releaser wired; release_not_wired unreachable when configured; crash-safe
  protocol tests: EVIDENCED. test/market_bond_releaser.test.ts;
  test/market_bootstrap.test.ts (the all-or-nothing boot pins);
  test/market_http.test.ts (the unwired-503 arm); 09 ledger. The devnet
  release legs are the OPEN-21 residual (section D).
- Verifier rejects burn-redirect and unexplained third-party credits:
  EVIDENCED. test/market_solana_chain.test.ts; 10 ledger. The live-cluster
  observation of the same rejection is OPEN-21 (hostile leg).
- Oracle heartbeat warms the priced instance (H3): EVIDENCED.
  test/market_bootstrap.test.ts (mock-timer bootstrap pins, 11 ledger);
  test/market_price_gate_signal.test.ts for the halt/recovered signal. The
  live halt/recovered line observation remains an OPEN-21 residual
  (section D; recorded NOT OBSERVABLE without a venue key).

### Dashboard repo

- npm test + check + build green: EVIDENCED, last re-run by the rider QA at
  tip cff8102: 282 tests 0 fail, check 0 errors, build complete, plus
  npm run test:security 66/66.
- Game proxy role check enforced, non-privileged role exercised: EVIDENCED.
  The 18 ledger (H1); tests pinned in tests/ (the external-verdict matrix
  per route); the external-role payout POST question stays a Fernando
  confirmation in the follow-ups.
- Token decimals sourced from mint config; 6-decimal figure renders
  correctly (H2): EVIDENCED. src/components/woc_mint.ts single source;
  tests/woc_mint.test.ts scans the repo for open-coded scale factors;
  tests/market_trading_panel_dom.test.ts pins the rendered figure at 6
  decimals AND (since this rider) at a service-reported 9 with the
  divergence banner.
- npm audit clean or accepted: EVIDENCED. npm audit 0 since the 19 round
  (19 ledger); the scheduled-audit-job suggestion is a follow-ups item.

### Cross-repo

- Wire fields complete end to end (H8: fee split renders, signatureRequired
  flows): EVIDENCED. The 12 ledger (wire-pin suite pinning every
  serializer's exact key set); the 14/15 rounds render fee and net on both
  review faces.
- Env vars documented; health rail keys on real config: EVIDENCED for the
  documentation half (12 ledger: WOC_MARKET_SERVICE_URL +
  DASHBOARD_INTERNAL_SECRET in .env.example and DEPLOY.md; the env-docs
  guard test). The service /v1/health market rail REMAINS ABSENT by record:
  ops guidance keys on /v1/market/price instead (runbook section 1); adding
  a real rail is a follow-ups item.
- Doc staleness cluster resolved: EVIDENCED (07 ledger and its QA; the
  handful of stale comments found since are itemized in the follow-ups
  list with owners, none player-facing).
- No em dashes / en dashes / emojis in the packet's diffs: EVIDENCED. The
  Stop-hook floor plus the gate copy scan ride every session; the one known
  pre-existing violation OUTSIDE the packet diff (server/wallet_link.ts
  comment) is recorded in the follow-ups.
- The word "phase" nowhere in code, comments, commit messages, or PR text:
  EVIDENCED. The packet's commit convention (implementation-plan.md commit
  rules); the 14 QA judged the one wocOfferPhase domain-sense exception and
  recorded it; PR text is OPEN-22 (not yet written).
- Every CLAUDE.md stale-check: EVIDENCED per round (each QA session's
  upkeep step); this rider updated tests/CLAUDE.md (the DB-gate bullet) with
  its CI change.

## C. The named verification items (phase-22 spec, pulled forward)

1. R9: no hard-coded acceptTerms. VERIFIED THIS SESSION by grep over src/
   (re-verified independently by the rider QA): FOUR send sites across the
   two consent surfaces carry the player's real choice and nothing else:
   src/ui/woc_market_window.ts sends `acceptTerms: this.acceptTermsChecked()`
   (the checkbox state) on both its arms, and
   src/ui/hud/woc_trade/woc_trade_controller.ts sends
   `acceptTerms: this.wocTradeTermsAccepted || this.wocTradeTermsChecked`
   (durable acceptance learned from /me, or the consent row's checkbox) on
   both the offer-send and pay arms. No `acceptTerms: true` literal exists
   outside tests. PASS.
2. The two dev-database classes (06 deploy notes): EVIDENCED as dev-only by
   construction (production unreachable: the marketplace has never shipped).
   Raw-JSON pins refuse at acceptance and the deal reopens; accepted-unstamped
   rows with a live listing are wiped or expired. The owning record is the 06
   ledger's deploy notes in state.md ("dev databases carrying THIS BRANCH's
   earlier builds"), which this audit inherits per the progress.md 06 QA
   residual ("phase 22's pre-enable audit gains the two dev-database
   classes"); the runbook deliberately does not carry them (they are not a
   production procedure). No production action exists to take now; the
   enable-time check is the claims-table query in runbook section 3.
3. The bindOnTrade scan line (06 deploy notes): OPEN-ENABLE. The scan
   (listings' item payloads for bindOnTrade without boundTo) can only mean
   anything against the production database at enable time; it is step 3 of
   the runbook's enable procedure. Nothing to run today (production has no
   marketplace rows).
4. R14 enable-time verification: OPEN-ENABLE. Verify production holds no
   acceptance rows recorded before the counsel-approved text, and re-key the
   durable flag if the label changed (R14 record in state.md Rulings; the
   R6 memo's "What happens next" checklist carries it as its own numbered
   item, added by the rider QA after the ledger check found the re-park
   destination had never received it; follow-ups.md section 3 tracks it
   too). The load-bearing distinction R14 turns on: the durable flag records
   ACCEPTANCE THE PLAYER GAVE (a recorded act against a specific text),
   never merely that a terms screen was SHOWN, which is why re-keying on a
   text change is a verification step and not a data migration.
5. R15 contract walk (fail-then-pay-again): SETTLED ON PAPER this rider.
   transaction_failed reports only an atomically failed transaction (a
   failed Solana transaction moves nothing; the verifier matches at
   confirmed and credits at finalized, service/src/market/solana_chain.ts);
   a payment landing after quote_expired recovers through the entry
   adoption arms (the 09 QA paid-after-expiry record; pinned in
   test/market_http.test.ts and test/market_store_pg.test.ts); a timed-out
   confirming row goes EXPIRED, never rejected (MAX_CONFIRMING_AGE_MS,
   service/src/market/quotes.ts), keeping adoption open. The code walk found
   no path that marks transaction_failed while a transaction could still
   land. The empirical observation is OPEN-21 (a devnet evidence row).

## D. Devnet rows (all OPEN-21, pointer)

The full row-by-row table with per-leg status lives in state.md, section
"21 devnet dry-run evidence": the bond cycle with the double-release balance
assert, the settlement e2e with the burn verify, the hostile burn-redirect
rejection, the contention observations, and the halt/recovered line
observation (the last recorded NOT OBSERVABLE without a venue key; the
fixed-price path is the ruled substitute). Resume runbook: devnet.md.
