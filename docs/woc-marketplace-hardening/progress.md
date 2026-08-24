# Progress

Status values: NOT STARTED / IN PROGRESS / DONE / DONE (QA PASS) / BLOCKED.
Every session updates its row AND records the phase-start commit hash (QA diffs from it).

| NN | Phase | Repo | Status | Start commit | Notes |
|---|---|---|---|---|---|
| 01 | branch-baseline | game | DONE (QA PASS) | e4c3dde956 | five re-review verdicts CLEAN (section below); woc_trade extraction landed; gate GREEN at 418f75b876 (full-suite fallback) |
| 01 QA | phase-01-qa | game | DONE | 07fda3fd46 | PASS-WITH-FOLLOWUPS, all fixes applied (section below); gate GREEN at final tip 1d7bdbafa0; pushed per R4 (no open PR on this branch, so no PR CI; pre-push floor green) |
| 02 | settlement-state-guards | game | DONE | 0f029bacf9 | release sync was a no-op (already at v0.37.0 tip); real-SQL suite 27 green vs dev Postgres; reviewer round + deferrals in section below; gate GREEN at tip 6916bd6944 (full-suite fallback; first run flaked on the known heavy-suite timeouts while external load averaged 40+, clean on the rerun) |
| 02 QA | phase-02-qa | game | DONE | 20fdcc5288 | PASS-WITH-FOLLOWUPS, every fix applied (section below); release/v0.37.0 synced in (merge b40a178643, one generated-i18n conflict regenerated; merge audit clean except the hud.ts ceiling, fixed by extraction); gate GREEN at 301a8c7c22 (full-suite fallback, all 8 steps); pushed per R4 (no open PR on this branch, so no PR CI; pre-push floor green) |
| 03 | delivery-exactly-once | game | DONE | e71a8cfd21 | release sync trivial (server/parse samplers only); B2a/B2b/B2c + monitor closed; five-reviewer round + fix round + fresh re-review applied (section below); real-SQL suites 65 green; gate GREEN at tip c3b33f54a7 (full-suite fallback, all 8 steps; the one intermediate red was the internal gate-mount sweep's 20-route count pin, fixed to 21); LOCAL, not pushed per R4 |
| 03 QA | phase-03-qa | game | DONE | 5ef64c1e11 | PASS-WITH-FOLLOWUPS, every fix applied (section below); release sync 5487531960 (two conflicts: main.ts union + regenerated pending.ts; merge audit CLEAN except the hud ratchet, fixed by the error_text_i18n_core extraction, ceiling 19338 to 19190); AC3 park deviation UPHELD; 21-mutation pass, one survivor closed; pushed per R4 |
| 04 | bond-payment-lifecycle | game | DONE | 3f20375918 | release sync no-op; three review rounds (security/db/coverage x2, qa-checklist, migration-safety) all applied; 17 mutation spot-proofs bit; gate GREEN at 0afdaa71a5. A follow-up verification session (sections below) re-ran the whole phase, applied two further audited fix rounds (commits 60034033f1, a938c410f3 plus docs), re-bit 11 mutations (3 re-proofs + 8 on the new fixes), and re-gated GREEN TWICE (full-suite fallback, all 8 steps, at c7176d730b and 6642c6e15b); LOCAL, not pushed per R4; final docs commit on top |
| 04 QA | phase-04-qa | game | DONE | e4ae9d1602 | PASS-WITH-FOLLOWUPS, every fix applied (section below); release/v0.37.0 synced (merge a43a1e8b52: the count-pin trap fired FOR REAL, both sides at 321 with different members, re-derived 322/85/237 + sends 199 dispatches 212 from runs; hud.ts over ceiling, fixed by the crafting_deny_core extraction, ceiling 19190 to 19177; game.ts ceiling banked to 10859); five audit lanes + fresh fix-round re-reviews; deep mutation pass incl. one REAL hole closed (the async-stall withTx shape); three correctness fixes proven red-on-old (lapse-straddle refresh, poll-race standing, review retry); a THIRD round from the fresh re-review (review-state client honesty, the devsig colon, the at-cap self-steal recording, bond_window_closed); gate GREEN at 8c1028e89d (full-suite fallback, all 8 steps; the first run caught the extraction's stale station pins in profession_identity_card, retargeted to the core); pushed per R4 (no open PR on this branch, so no PR CI) |
| 05 | custody-entry-hardening | game | DONE | f07ca88278 | release sync trivial (one locale-fill commit; generated pending.ts regenerated); H5/H6/extraction/firewall closed; dbperf pre-checkpoint BLOCK folded in; three-reviewer round + fresh fix-round re-review + qa-checklist READY + hot-path round (sections below); real-SQL suites green incl. the new escrow set; gate GREEN (full-suite fallback, all 8 steps; the one intermediate red was the malware scanner flagging the firewall comment's own key-shape prose, reworded); LOCAL, not pushed per R4 |
| 06 | directed-rail-integrity | game | DONE | b948aa64fb | release sync trivial (16 commits, chronomancer train, no marketplace overlap, no count-pin surface); H10/H12/H14 + guardBalance + auto-close closed, both opening judgments settled; dbperf pre-checkpoint BLOCK (A1-A8) folded in before code; pg suite ran RED first (7 behaviors); FOUR fresh reviewers + fix-round re-review + qa-checklist, every finding applied incl. nits (the security CRITICAL: the trade session stripped staged identity, fixed by per-copy staging through the swap's own selection walk); one inherited env-gated red (admin_guilds vs the release's quota join) repaired in place; first gate GREEN at 5287214294; then SIX closing rounds (two independent fresh reviews of the gate-round commit, every subsequent fix round re-reviewed fresh, ~45 more findings applied incl. the crafted-marker comparator leg, the accept-side one_item mirror with the model acceptHint judged over the AUTHORITATIVE offer table, the pair index carcass convention + shared name constant, the offer_reopen report on both swallows, the observed-wait 23505 interleave, and the wiring/count pins that made the last round's fixes decisive); THREE gate runs GREEN along the way (5287214294, then 5ebb176a73 covering all production code, then the final at tip ea1bb82322: full-suite fallback, all 8 steps, run WITH TEST_DATABASE_URL so every pg suite executed); LOCAL, not pushed per R4 |
| 05 QA | phase-05-qa | game | DONE | b9e937c075 | PASS-WITH-FOLLOWUPS, every fix applied (section below); release sync origin/release/v0.38.0 trivial (7 commits, no marketplace overlap, no count-pin surface); five audit lanes + a fresh fix-round re-review + qa-checklist READY + a db-perf close-out; real-SQL suites 109 green THREE times (zero skips); the three named mutation probes plus the agents' per-pin mutation matrices all bit; the round found and fixed the BEGIN-outside-TxNeverStarted critical, the withTx null-deref evidence destroyer, both kick argument swaps, and the db-perf codeless-discard P1; gate GREEN at eeaa137e5c (full-suite fallback, all 8 steps, 38196 tests + 118 browser); pushed per R4 |
| 06 QA | phase-06-qa | game | DONE | ab2742012b | PASS-WITH-FOLLOWUPS, every fix applied, PUSHED per R4; v0.38.0 re-sync NON-trivial (3 conflicts + 2 silent count-pin auto-merges, all re-derived from runs: IWorld 323/86/237, fanout 10, hud.ts 19160 DOWN, sim.ts 12436; release-merge-audit faithful, 0 findings over 7 groups); ea1bb82322 verified FIRST (comment-only src, all pins mutation-proven); six fresh lanes: 0 code blockers, 4 blocking TEST gaps closed; QA-found code fixes: the capacity model now RUNS the removal walk (receiver-overflow class closed for good), the crafted-marker leg on the instanced matcher, guardTerms on the directed buyer, the model-reading accept belt, sweep-fallback stack+null-safety; NEW OPEN RULING R9 (implied terms consent, pre-enable affordance owed); pg suites 152 green zero skips on the tip; 21 mutation probes all bit; qa-checklist READY 0 blocking; gate GREEN at 47399f77b7 |
| 07 | policy-terms-drafts | game | DONE | 8a1739d67a | DOCS ONLY, zero code diff; release/v0.38.0 synced (merge 8a1739d67a, trivial: 30 commits, no marketplace overlap; monolith_budget AUTO-MERGED so all four count-pin suites re-derived from a run, 377 green, renderer.ts ceiling 13708 lowered by the release's own extraction); counsel package complete: TERMS_AND_CONDITIONS_MARKETPLACE_DRAFT.md (full revised Terms beside the untouched live Terms; new Section 10 incl. the 10.3 acceptance-surface requirement per R9; renumbering verified reference-by-reference) + the decision memo (adopted position, nine counsel questions incl R9 and the NEW seller-side terms gap, exact-changes list, enable-time checklist; held PRIVATELY outside the public repo per the state.md locked decision); never-power carve-out landed consistently (README Highlights + Web3, wallet-link, holder-flair, marketplace.md launch gates); staleness cluster fixed (marketplace.md forfeit destination / delivery / review-state / TOTP-superseded-by-R1 truth-ups, p2p-woc-trade implementation status, DESIGN.md window inventory, malware-scan-catalog signing surfaces, both money-claim agent docs, docs+net+ui CLAUDE.md); FRESH proofreader over the whole package: 1 blocking + 7 should-fix + 6 nits, ALL applied; copy floor clean, ci:changed exit 0; LOCAL, not pushed per R4 |
| 07 QA | phase-07-qa | game | DONE | 55c2ba992e | PASS-WITH-FOLLOWUPS, every fix applied (section below); release re-sync trivial (two CI-harness commits, no marketplace overlap; tsc clean, four pin suites 377 green); eight fresh audit lanes (the phase-prescribed fresh proofreader among them); the round found the draft's missing second-chance-offer disclosure (blocking; it falsified the outbid-refund promise) plus the anti-snipe and abandon-cooldown gaps, four draft wording drifts, and seven companion truth-ups, all applied; new deferreds with owners in state.md's 07 QA ROUND bullet; the amended draft postdates the recorded R6 send (Fernando forwards the amended copy); ci:changed exit 0; live Terms + terms.html byte-untouched; counsel memo verified absent from the branch; pushed per R4 |
| 08 | service-auth-hardening | service | DONE | 70d4207 | SERVICE repo (origin/master already contained); B5 + the fail-open config mediums + the compose staleness default closed, every refusal proven red-first (the bypass returned 200 on the old routing with the internal secret alone); two fresh review lenses, then two fix rounds each re-reviewed fresh and a self-reviewed polish round, every finding applied incl. nits; the rounds' own finds: the THIRD dev escape (CLAUDIUM_ALLOW_FAKE_STRIPE, still denylist), the wallet-segment fragment gap, the duplicate-oracle heartbeat bug (warmed one instance, quoted from another), ASCII-before-trim; suite 439 tests 435 pass 0 fail (the QA round corrected the baseline arithmetic: the range ran 417 tests with 413 passing before, so the growth is 417 to 439 totals); 12 commits, tip 4b9e413; LOCAL, not pushed per R4 |
| 08 QA | phase-08-qa | service | DONE | 4b9e413 | PASS-WITH-FOLLOWUPS, every fix applied (section below); the self-reviewed polish commit 4b9e413 verified FIRST and clean; six fresh audit lanes + a dedicated red-proof lane over 70d4207..4b9e413: 0 blocking, all four red-first claims REPRODUCED-RED against a throwaway 70d4207 build; 8 should-fix + 13 nits ALL applied in three commits, re-reviewed fresh (0 blocking, 7 should-fix, 8 nits, ALL applied in a fourth commit, tip aa44873); 12 + 2 mutations all BIT; suite 445 tests 441 pass 0 fail 4 env-gated skips; game worktree re-synced to release/v0.38.0 (merge bfceae8d4b, NON-trivial: 33 conflicts, wireAura extraction pays the merged game.ts overage, pins re-derived 324/86/238 + sends 200 dispatches 213; release-merge-audit found THREE union-only reds, all fixed; gate GREEN at ad197c0801, full-suite fallback, all 12 steps, WITH TEST_DATABASE_URL, real-SQL suites 154 green zero skips); pushed per R4 (service 70d4207..aa44873 updating PR #31, its test checks running at push time; game 8dd51a8a20..f5325ffbe8, pre-push floor green, no open PR on this branch so no PR CI) |
| 09 | bond-releaser | service | DONE | aa44873 | SERVICE repo (origin/master already contained at df09756); B3 + the bond double-pay medium + the bond-cents ownership mediums closed; R2 forfeit split landed (one code path with the settlement schedule); the two R5 items this repo owns RULED by Fernando at session start and implemented (SOL fees: preflight + overview monitor + manual funding, knob WOC_MARKET_ESCROW_MIN_SOL_LAMPORTS; ATA rent on refund: escrow pays, inside the preflight); FIVE red-first proofs (ownership behaviors, both double-pay classes, all-or-nothing boot, the late-confirm stomp, the terminal-adoption abandonment); two fresh coverage lenses (security 18 findings incl. 1 blocking, correctness 14 incl. 2 blocking) plus a fresh re-review of the fix rounds (1 blocking + 5 should-fix + 5 nits), every finding applied or judged with the file open; 9 commits, tip 3346878; suite 445 to 493 tests, 488 pass + 5 env-gated skips default tier, 493/493 with CLAUDIUM_TEST_DATABASE_URL (zero skips); LOCAL, not pushed per R4 |
| 09 QA | phase-09-qa | service | DONE | 3346878 | PASS-WITH-FOLLOWUPS, every finding applied or judged with the file open (section below); SERVICE repo (origin/master already contained at df09756); nine lanes (six read-only audits, two red-proof, one mutation): 0 blocking in the implement range, all six red-first registry claims REPRODUCED-RED, all seven mutation arms BIT by name (claim CAS, guarded update, finalize signature key in BOTH stores, age bound; 493-test full runs each); the round's own fixes: entry adoption of a ledger-proven payment on an already-expired or superseded quote (the registered pre-existing edge, the crash-matrix lane's fix-now case accepted), typed signature_already_settled on the settled-signature collision BOTH stores (the partial-unique-index 23505 trap, previously an unhandled 500), the undecided late-visibility window, the rejected-write vocabulary fix, the rpc probe-list pin, the actor clamp, fifteen test-decisiveness hardenings, doc truth-ups; two fresh re-review lenses over the fix round, everything applied or judged, round-2 mutation-proven (4 mutants BIT); suite 493 to 508 (502 + 6 env-gated skips default; 508/508 zero skips with CLAUDIUM_TEST_DATABASE_URL); 5 commits, tip 02713f2, PUSHED per R4 (service aa44873..02713f2 updates PR #31; game after the v0.38.0 re-sync merge abd4a9e0e2, trivial: one generated-i18n conflict, regenerated) |
| 10 | chain-verifier | service | DONE | 02713f2 | SERVICE repo (origin/master already contained at df09756); B4 closed with red-first proofs (three redirect shapes reproduced MATCHED on the old verifier); the two R5 items this file owns RULED by Fernando at session start and implemented (commitment split ratified as code-owned MATCH_COMMITMENT/CREDIT_COMMITMENT; five hour confirming bound MAX_CONFIRMING_AGE_MS, both stores, new pg partial index, one minute sweep driver in buildMarketApps, previously NOTHING drove expiry in production); undecided confirm answers split (not_yet_visible vs awaiting_finality, the anti-snipe service half); two fresh lenses + a fresh re-review of the fix round, every finding applied or judged (the re-review REFUTED the round's multisig-impossibility claim with the parser's count-based labeling, arm restored money-safe); 15 mutants BIT + 1 judged environment survivor (pg ORDER BY delete coincides with partial-index order; the DESC variant bites); suite 508 to 536 (530 + 6 env-gated skips default; 536/536 zero skips with CLAUDIUM_TEST_DATABASE_URL); 6 commits, tip ba7df0b, LOCAL not pushed per R4 |
| 10 QA | phase-10-qa | service | DONE | ba7df0b | PASS-WITH-FOLLOWUPS, every finding applied or judged with the file open (section below); SERVICE repo (origin/master still df09756, contained; syncs pre-done by the sync-only session, re-fetched at the end: nothing new); seven audit lanes (56-shape hostile hunt with ZERO accepted_dishonest and the real wallet shape verified; security; correctness; coverage; docs; red-proof: all six registry claims REPRODUCED-RED on the 02713f2 build; mutation: 27 of 31 bit, the 4 survivors real pin gaps, all closed); the refuter stage hit the session limit after 15 of 68, every finding judged in the main loop with the file open and primary sources (agave parse_token.rs / parse_instruction.rs, spl-token processor.rs: the multisig restoration CORRECT, agave labels both token programs spl-token); the round's own fixes: the signature SHAPE screen before the first write (SEC-2, a junk string minted the game's service_unavailable exemption via the RPC's -32602 500), the payer-leg netting with owesOthers plus the escrow-bidder refusal (the fix-round re-review caught the bond self-leg vacuity), burn_authority_mismatch, the stray-owner log (once per memo, clamped), the sweep failure/recovery warn with in-flight guard, expirePastDue non-positive budget, attention.confirmingExpired24h on its own read, doc truth-ups (bound measured from expiry, ordering a two-knob precondition, the RPC-horizon premise re-anchored, vocabulary table, recovery caveat, deploy note); pins closed incl. the pg EvalPlanQual race rig on BOTH sweep arms; 21 + 11 mutants BIT over the committed rounds; suite 536 to 560 (553 + 7 env-gated skips default; 560/560 zero skips with CLAUDIUM_TEST_DATABASE_URL); 5 commits, tip 8da6c03, PUSHED per R4 (service ba7df0b..8da6c03 updates PR #31; game after the release check: 0 behind origin/release/v0.39.0, origin/main moved to the v0.38.2 hotfix tip which the next game session's sync picks up through v0.39.0) |
| 11 | oracle-health | service | DONE | 8da6c03 | SERVICE repo (origin/master already contained at df09756); R3 RULED by Fernando at session start (single-venue posture, spot 500 bps; recorded BEFORE code in game commit e2f189e9a4) and implemented; H3's shared-instance half (already fixed in 08) pinned decisively under mocked timers with the quiet-period proof and a negative control; publish-time freshness on the wire (asOfMs) and the honest venue surface (per-venue age and verdict, configured/live counts, crossVenueGateArmed, distinctPrints, effective bounds); the dead Pyth venue path and its knob removed, the inert cross-venue knob retired (code default kept), spot 1000 -> 500; two fresh lenses (security/ops 14 findings, correctness 21) plus a fresh re-review of the fix round, every finding applied or judged with the file open; the fix round made the ORACLE the one judge of freshness per venue (an over-age print is refused as stale WITH its print time instead of dying at the source as no_price), env knobs may only tighten, the heartbeat feeds an edge-triggered halted/recovered operator signal; the cold-boot single-print exposure RULED record-and-document (Fernando 2026-08-16); the re-review round bounded every env knob in both directions, capped the sample buffer and made a paused refusal read the last heartbeat reading; PRD claim revised in the game repo (c5ce2793e7); 41 mutants BIT by name; suite 560 to 590 (583 + 7 env-gated skips default; 590/590 zero skips with CLAUDIUM_TEST_DATABASE_URL); 5 commits, tip 03df5de, LOCAL not pushed per R4 |
| 11 QA | phase-11-qa | service | DONE | 03df5de | PASS-WITH-FOLLOWUPS, every finding applied or judged with the file open (section below); SERVICE repo (origin/master already contained at df09756); eight audit lanes over 8da6c03..03df5de (correctness with the four probes, security/ops, test decisiveness, dead code and docs, red proof, three mutation groups): 0 blocking, 44 findings; red proof 11/11 REPRODUCED-RED on the named old builds; mutation 42 run, 41 BIT, the ONE survivor (overview crossVenueGateArmed hardcode) closed by a two-venue overview arm and re-proven; the fix round re-sized the two tightening floors from the venue cadence (staleness tight end 15 to 45 min, sample minimum 90 to 60, an R3-amendment note records it), pruned the refusal readout NON-MUTATINGLY, wired a parse-time warn for every mis-set oracle knob, put the window depth on the recovered line (the breaker-reset shape is visible in the log), mirrored spot/twap onto the overview, and trued every lagging doc; round-2 workflow over the fix round (two fresh lenses 13 findings 0 blocking, ALL applied; 16 new-pin mutants ALL BIT; completeness critic); suite 590 to 595 (588 + 7 env-gated skips default; 595/595 zero skips with CLAUDIUM_TEST_DATABASE_URL); 5 commits, tip 270e337, PUSHED per R4 (service updates PR #31, all four test checks GREEN after the push; game docs pushed with it, pre-push floor green) |
| 12 | wire-completeness | game | DONE (QA PASS) | a6ff42f1c5 | release sync no-op (0 behind origin/release/v0.39.0 tip d2d1a8ad5c); H8 + env truth + health-rail honesty closed AND the four cross-repo owed items adopted (service-owned bond quote, anti-snipe awaiting_finality allowlist, two-settled-per-memoRef tolerance, verdict localization; asOfMs pass-through verified untouched); 8 code and doc commits to tip bd089672f9 plus the ledger docs commit; four review lanes + a fresh fix-round re-review + qa-checklist READY (0 blocking), every finding applied or judged; ~12 mutants bit by name incl. wire-pin drop/rename, vocab delete, echo recompute, sig drop, env guard both directions; real-SQL suites green zero skips WITH TEST_DATABASE_URL; gate GREEN at the docs tip (gate_select full-suite fallback, all 12 steps, 2854 files / 40604 tests, browser 129, WITH TEST_DATABASE_URL); LOCAL, not pushed per R4 |
| 12 QA | phase-12-qa | game | DONE | 90c007e36f | PASS-WITH-FOLLOWUPS, every finding applied or judged with the file open (section below); release sync no-op (0 behind origin/release/v0.39.0 tip d2d1a8ad5c); ten audit lanes over a6ff42f1c5..bd089672f9 (cross-platform-sync, frontend-seam, test-coverage via Agent; server/client correctness, serializer sweep, fee edges, env sweep, dead code, docs truth via workflow) + red proof (all 7 registry claims reproduced or verified, wire pins exactly 14 red on the pre-fix build) + three mutation batteries (17 round-1: 16 BIT, the one survivor a REAL devSplit pin gap; 18/18 new-pin; 10/10 wave-3); seven fix commits (spine in the section below), the fix round re-reviewed FRESH (two lenses: 1 blocking test gap + 11 should-fix, all applied); qa-checklist READY (0 blocking, 0 should-fix; its adversarial pass independently cleared the ladder, the devsig arm, the browse booleans, the ceil change, and SETTLING_STATES); gate GREEN at 4377a38458 (gate_select full-suite fallback, all 12 steps, 2854 files / 40635 tests + 2 expected fails, browser 129, WITH TEST_DATABASE_URL; the final ledger amendment rides on top docs-only); pushed per R4 (no open PR on this branch, pre-push floor green) |
| 13 | listing-step-up | game | DONE | 19e4cd87ce | release sync no-op (0 behind origin/release/v0.39.0 tip d2d1a8ad5c); B6 + browser-only-gate medium closed; both rulings recorded first (R1 threshold: step-up on every custody-moving call, no env knob; R10: locked copies refuse listing); step-up challenge protocol (own sibling module + store, real-SQL pg suite), enforcement in both service methods, client flows in both surfaces, TOTP retired; four fresh review lanes + a fresh three-lane re-review of the fix round + qa-checklist READY + migration-safety & database-performance (both PASS, the account-id FK index fixed), every finding applied or judged; 22 mutants across three fix rounds all bit; R11 relink follow-up recorded (pre-enable gate); GATE GREEN at ae1ba36b87 (gate_select full-suite fallback, all 12 steps, 2855 files + browser 19, WITH TEST_DATABASE_URL); LOCAL, not pushed per R4 (13-qa pushes on PASS) |
| 14 | ux-honesty | game | DONE (QA PASS) | d3b15f6057 | release sync NO-OP (v0.39.0 f48c7a3a9b already an ancestor); H13 + wallet-bridge i18n + wocUsdText currency closed, plus the 14-owned deferrals from 02/04/06/07/11/12/13; R9 resolved at session start (Fernando, in the session prompt) and implemented on BOTH consent surfaces; three fresh reviewers (frontend-seam, cross-platform-sync, test-coverage) prompted for coverage; the xplat CRITICAL (the resolved-offer verdict lines were unreachable behind the offers read's status filter) fixed with the grace-window extension + full fake read fidelity + pg pins; every coverage blocker/should-fix/nit applied or judged (registry in the state.md 14 ledger entry); five market pg suites green zero skips WITH TEST_DATABASE_URL; ci:changed exit 0; gate run recorded below; LOCAL, not pushed per R4 (14-qa pushes on PASS) |
| 13 QA | phase-13-qa | game | DONE (QA PASS) | 220b9b018f | PASS-WITH-FOLLOWUPS, every finding applied or judged; release/v0.39.0 re-synced (merge 220b9b018f, tip f48c7a3a9b, 2 conflicts: i18n pending regenerated + hud.ts ceiling re-derived to 19170; release-merge-audit CLEAN, both usage-limit trap lanes re-run inline); independent mutation battery 21/22 bit, the 1 survivor a REAL safeMessagePiece code+pin gap closed; two code fixes (sanitizer C1/Cf + non-string coerce; window close-reset) + a test-pin batch incl. the devsig-wiring total-bypass pin, all mutation-proven; the fe BLOCKING (R10 lock-hint dead end) reclassified should-fix and deferred to 15 (no custody hole; offer pin always unlocked); gate GREEN (see 13 QA ROUND); pushed per R4 |
| 14 QA | phase-14-qa | game | DONE (QA PASS) | 8c0370585c | PASS-WITH-FOLLOWUPS, every finding applied or judged with the file open; release/v0.39.0 re-synced (merge 8c0370585c, tip f42a67f341, trivial); nine workflow audit lanes + six typed reviewers (frontend-seam MOBILE, cross-platform, database-performance, migration-safety, security; test-coverage silent, covered by two mutation batteries: 43 mutants 36 bit + 50 mutants 44 bit, every survivor a real pin gap closed) + the session's own mobile E2E arm (two dev-only rigs measuring the money faces in a landscape phone viewport, six captures) + the Capacitor /terms check (dead on iOS + packaged desktop, rebooted Android; fixed with the wiki_link resolver idiom); fix commits e68227b6bb, d1e3eb2199, ea08ac4711, and 6f67a96057 after a fresh four-lane re-review of the fix round; gate GREEN (see the 14 QA round section); pushed per R4 |
| 15 | ui-polish | game | DONE (impl) | 01faddadf8 | release/v0.39.0 re-synced FIRST (merge 3a98604c83, release tip b650d9d7d2, 150 commits, NON-trivial: four conflicts, release-merge-audit run and its findings applied, see the section below); the DESIGN.md conformance audit written first (docs/woc-marketplace-hardening/phase-15-design-audit.md: seven read-only lanes, 215 findings, every row APPLIED, DEFERRED with an owner, or JUDGED with a reason) and then worked top to bottom; presentation only, zero view-core diffs; five commits (a4fcac14d8 + 01faddadf8 from the merge audit, then 92da32bbb1 style, e6c054232d test, be35080962 scripts, plus the docs and capture commits below); highest-value catches: var(--accent) was declared NOWHERE so seven marketplace declarations shipped resolving to inherit/currentColor, the mobile bags sheet covered the whole trade window on touch (the arm unreachable), neither money sheet cleared the safe-area insets, the trade arm's spinner was an inline box that never spun inside the pressed Pay button, the browse table re-flowed every column on each per-second countdown rebuild, the toast strip shifted the control under the pointer, the sell form's money inputs and the arm's price field missed the touch floor, the seller never saw a resolved fee (the note named a percentage the SERVICE owns), the bond note resolved the wrong bid's bond, the paused and suspended lines named a cause they cannot know and actions they do not cover, and the Exchange window had no behavioral test at all; new guards: the css var() resolution ratchet (the --accent class cannot recur), the copy-to-constants pins, the shared token spelling, the widened ticker grep-proof, and tests/woc_market_window_rig.test.ts (the first live rig for WocMarketWindow, 21 cases); LOCAL, not pushed per R4 (15-qa pushes on PASS) |
| 15 QA | phase-15-qa | game | DONE | 4cb60d0d3c | PASS-WITH-FOLLOWUPS, Fernando's sign-off BEAUTIFUL WITH NOTES, notes shipped, PUSHED per R4 (see the 15 QA round section) |
| 16 | hot-path-scale | game | DONE incl QA | 94d53a243a | H11 closed: six GETs metered, four read surfaces cached with busts on every outcome, /me sequenced with a deadline, price cache single-flight with a short failure memo and bounded SWR, sweep locks per segment with the budgeted bond walk and the overrun watchdog; QA verdict PASS-WITH-FOLLOWUPS (the 16 QA round section is the registry 17 consumes), PUSHED per R4 |
| 16 QA | phase-16-qa | game | DONE (QA PASS) | e3bd74c52a | PASS-WITH-FOLLOWUPS, five fix commits, pushed per R4; the 16 QA round section below is the registry (this table row was trued up late by the 18 session; the section was always current) |
| 17 | db-retention-indexes | game | DONE | 0d1c5729a1 | all four deliverables landed, gate PASS; the 17 implement round section below is the registry (row trued up late by the 18 session) |
| 17 QA | phase-17-qa | game | DONE (QA PASS) | e3ab5f6f21 | PASS-WITH-FOLLOWUPS, never-sweep verdict SOUND, pushed per R4 (origin tip e3ab5f6f21); the 17 QA round section below is the registry (row trued up late by the 18 session) |
| 18 | dashboard-guardrails | dashboard | DONE (impl) | c001d4a | DASHBOARD repo; H1 role gate, 6-decimal mint source, WMB_-only release, reference-tail forfeit confirmation, destination reset, immutable-id audit actor, independent summary reads; session start c001d4a (= PR #13 tip), origin/master sync NO-OP; three coverage lenses (0 blocking) + TWO fresh fix-round reviewers (both READY), every finding applied or judged; final tip e82303e, npm test 164 / check 0 / build 0; LOCAL, not pushed per R4 (18 QA pushes on PASS); the 18 implement round section below is the registry |
| 18 QA | phase-18-qa | dashboard | DONE (QA PASS) | e82303e | PASS-WITH-FOLLOWUPS, every finding applied or judged; ONE blocking (the game proxy host-pinning bypass) fixed and mutation-proven; eight fix commits, final tip ae6e46c, npm test 183 / check 0 / build 0; PUSHED per R4 to origin/feature/woc-market-trading-controls (PR #13); the 18 QA round section below is the registry (row trued up by the 19 session; the section was always current) |
| 19 | dashboard-tooling | dashboard | DONE incl QA | ae6e46c | DASHBOARD repo; all five deliverables landed: first CI workflow (act-style clean-clone proof green), component-render harness (esbuild JSX hook + happy-dom) closing the .tsx pin gap incl. every 18-round deferral, npm audit 0 (was 11), data-truth fixes (dead p2p trades, buy-now price, per-quote legs, superseding list loaders, locale sweep, wocDecimals guard, withdraw gate), investigation UX (find box, cross-links, Custody subtab on the stuck monitor, payout proxy explicit allowlist + actor header); two fresh lenses + a fresh fix-round re-review, every finding applied or judged; 10 mutation proofs bit; tests 183 to 254, check 0, build 0; 7 commits, tip 8eeaf8f, LOCAL not pushed per R4 (19 QA pushes on PASS); the 19 implement round section below is the registry |
| 19 QA | phase-19-qa | dashboard | DONE (QA PASS) | 8eeaf8f | PASS-WITH-FOLLOWUPS; ONE blocking reproduced live (node --test glob-pattern positional args silently shrank test:security; fixed with the run_security_suites.mjs runner + guard suite); ~40 findings applied across seven QA commits; 28/28 mutants bit; fix round re-reviewed FRESH; final tree 276/0, check 0, build 0, clean-clone green, maiden Actions runs green; PUSHED per R4 (dashboard ae6e46c..145d120 to PR #13); the 19 QA round section below is the registry (row trued up by the 20 QA session; the section was always current) |
| 20 | real-sql-coverage | game | DONE incl QA | 057b54141a | the fake-only-SQL medium closed: predicate inventory in state.md, real-SQL pins for every fake-only or untested money/security predicate (pg battery 172 to 232, new realm-isolation suite), the 248-mutant log, six fake divergences fixed and pinned; tip 31d07c6375 plus the registry commit; the 20 implement round section below is the registry (row trued up by the 20 QA session) |
| 20 QA | phase-20-qa | game | DONE (QA PASS) | 3ac20bef0e | PASS-WITH-FOLLOWUPS, every finding applied or judged with the file open; the inventory re-derivation found the account-scoping qual family separable only by realm (fixed with same-realm stranger fixtures) plus a log-completeness batch; three fix commits, 45 new mutants (43 BIT, one judged single double-strip proven, one green fixture-derivation control) plus five independent re-verifications of existing rows; PUSHED per R4 (gate PASS all 12 steps at 8581ee5b2d, see the section's final validation note) |
| rider 1 | rider-escrow-write-path | game | DONE | 00334857e0 | the first settled rider: realm escrow gate, honest occupancy, observability, TxNeverStarted widening, the FOR NO KEY UPDATE narrowing, the bounded plain writers, the drain refusal, ledger bounds, and the commitGrant FIFO close; LOCAL per R4, the QA row below pushed it |
| rider 1 QA | rider-escrow-write-path-qa | game | DONE (QA PASS) | 7e07cf12a6 | PASS, 14 findings applied and zero deferred as unfixed; v0.40.0 re-sync NON-trivial (123 commits, merge a22f111644, four conflicts re-derived, release-merge-audit clean); one of four reviewer lanes delivered, the rest carried by main-thread probes; 16 mutants ALL BIT (6 independent spot-checks + 10 proving the round's own new pins); pg battery 241 zero skips twice; gate GREEN; PUSHED per R4; two maintainer rulings surfaced |
| 21 | devnet-dry-run | service + game | NOT STARTED | | needs rulings R5 |
| 21 QA | phase-21-qa | service + game | NOT STARTED | | |
| 22 | close-out | all three | NOT STARTED | | teardown offer lives in 22 QA |
| 22 QA | phase-22-qa | all three | NOT STARTED | | |

## 14 QA round (verdict PASS-WITH-FOLLOWUPS, every finding applied or judged)

Session start 8c0370585c (the release/v0.39.0 sync merge, tip f42a67f341,
trivial: five druid feral-enablement commits, no marketplace overlap). Range
audited d3b15f6057..ffd8d63963. Nine workflow lanes (server honesty, the
state-machine truth table, the trade arm client, the Exchange + money surface,
the four fix rounds re-reviewed, i18n/hygiene, dead code + docs truth, the
/terms shell check, a 43-mutant battery in a scratch worktree) ran beside six
typed reviewers dispatched via Agent (frontend-seam with MOBILE in scope,
cross-platform-sync, database-performance with a measured 200k-row rig,
migration-safety with an empirical triple re-apply of the DDL,
privacy-security; the test-coverage auditor went silent, its dimension
covered by the two mutation batteries) and the session's own mobile E2E arm.
The adversarial verify stage was stopped after 30 votes (29 confirmed) since
three lenses per finding would have run for hours; every finding was judged
in the main loop with the file open.

Fix commit spine: e68227b6bb (server/DB: the dead pending partials retired
with idempotent DROPs, the poll read on the SERVICE clock with an id tiebreak,
the two cooldown probes in one round trip with a bound OFFSET, table-qualified
correlated item lookups, the last inline-English admin arm on a registered
code, the SDK's empty-code guard; pins: the SQL floor for the verdict grace arm
+ index definitions + retirement, the pg indexdef and EXPLAIN plan pins, the
cooldown boundary at EXACTLY retryAtMs on both arms, the fake's two grace
twins); d1e3eb2199 (the money faces: settlement and quote keyed to their
offer, the claim not a payment (a signing flag holds 'paying'), review and
delivered status keys, buyer-voice compose copy, fee + net on both review
faces, the p2p binding note from /status directedHoldSeconds, an unpaid ending
naming the strike, close-time lines for the seller's held copy and a payment
in flight, one-click resolve with a trade-flavored not_pending, the recorded
cancel-pending face, quote legs + a lapsed line, the Exchange's
confirmed/delivering label + toast, one canCancelListing predicate, the
Activity digest's currentCents, durationText for the claim cooldown, the
disclosure rewords, the desktop hand-off bridge strings, the USD suffix
dropped, the terms_link resolver on both surfaces + the dev proxy removed,
CSS floors + focus-visible + the focus ladder, and the five non-Latin overlays
refilled); ea08ac4711 (scripts/woc_trade_mobile_shot.mjs new,
scripts/woc_market_shot.mjs revived and given the mobile floor checks, six
captures under docs/screenshots/woc-market/); 6f67a96057 after the FRESH
re-review of the fix round (four lanes: client correctness, server/DB + pins,
i18n fills, a 50-mutant battery 44 BIT with the 6 survivors closed): the
claim KEPT keyed across a close (a dropped claim was refused buy_now_locked
over the buyer's own lock and struck), the settlement's own deadline on the
pay and quote faces, the tabs ending the focus ladder, the trade-arm
lapsed-quote line, the signing-aware close line, the upgrade-path retirement
pin, the plan pin's ROLLBACK in finally, the fake-side cooldown boundary
twin, comment and fill truth-ups. Registry, JUDGED and DEFERRED lists: the
14 QA ROUND bullet in state.md.

Gate: node scripts/gate_select.mjs (TEST_DATABASE_URL on the command line
only) PASS at 12395705bb, all 12 steps green: full-suite fallback, 2891 test
files / 41133 tests with 8 workers, browser 19 files / 129, freshness +
malware + biome + tsc + every build; tree clean after. Pushed per R4 (no open
PR on this branch; pre-push floor green). Late coverage lane (the
test-coverage-auditor reported after the push): 3 blocking + 8 should-fix +
5 nits, all test gaps, applied in 58212e3475 (10/10 new-pin mutants BIT) or
judged (three, in state.md); gate re-run on that tree PASS (all 12 steps,
41139 tests, browser 129) and pushed per R4.

## 14 implement round (UX honesty on the money surface)

Commit spine (all LOCAL, on top of d3b15f6057): 22de5a4107 server honesty
(shared strike gate incl. the auction arm, claim_cooldown retryAfterSeconds
end to end, item-named activity reads, admin envelope codes, Refused.params);
fe5165c2eb trade honesty (closed is not settled + per-reason report lines,
seller Decline + Cancel sale on both surfaces, expiry line, immediate
fee-line blanking, below-min hint, item cells + Activity cancel in the
window, the usd_text extraction); 1de30be50e informed commitment (two-step
pay with the quote review, pre-bid disclosures incl. offer-next, the R9
consent rows + /terms links on BOTH surfaces); 76bacd06ed localized money
surface (wallet_bridge_reason_text + five sinks, the render-time notice
union, bond pending voice, five specific fail lines, Intl USD everywhere +
the grep-proof, copy truth-ups); 8a0d55d3ca docs + the quote_expired
lapse-straddle reword; df79314e15 the changed-files lint floor; 6349b61f62
the review round's findings (spine in the commit body; the CRITICAL was the
unreachable resolved-offer verdict lines, fixed at the offers read with the
grace-window precedent + full fake fidelity + pg pins).

Review round: frontend-seam-reviewer, cross-platform-sync, and
test-coverage-auditor dispatched FRESH in parallel over d3b15f6057..HEAD,
each prompted for coverage. The xplat lane found the one CRITICAL above and
verified the whole params/itemId wire both directions; the coverage lane's
four blockers (the send-arm consent mutant, the auction exempt-vocabulary
arm, the SDK params echo pin, the un-covered item-join SQL) and its full
should-fix/nit list were applied, with three deliberate judgments recorded
in the state.md ledger (ok-implies-durable consent semantics; the
mid-outage bond state pinned at its observed 'forfeited'; the raw-source
main.ts pin because the naive comment strip swallows glob strings). The
Claudium channel gained the STRICT no-prose classification after the xplat
lane's latent-misclassification observation. Residual recorded for QA: the
cooldown SQL rewrite's exact-moment pins live in the pg-gated suite (run
green here zero-skip; CI has no Postgres leg, the 20-owned posture), with
the fake-side twins covering both arms on pg-less legs.

QA round: the qa-checklist lane reported late but in full (verdict READY,
zero blocking). Its four action items landed as 98f4cc1afb: the phantom
consent-link token (now var(--gold)), the explicit closed-deal face in the
trade arm (a dead deal can never fall through to Decline / Withdraw), the
two additive non-partial account indexes the 2s offer poll needs (measured
on a 200k-row scratch rig, seq scan to BitmapOr, existence-pinned in the pg
suite), and the fake's ORDER BY created_at DESC LIMIT 50 mirror with real
creation clocks (new fidelity suite). Remaining VERIFY items and the gate
env lesson (never export DATABASE_URL around gate_select; the
characterization goldens read it) are in the state.md ledger for the QA
session.

Seam round: BOTH frontend-seam lanes recorded dead also delivered late,
independent and thorough (one blocking + eight should-fix + ten notes;
two blocking + six should-fix + seven nits), voiding the reviewer-death
residual. Everything applied or judged in 433841c53f: the 35-row
non-Latin refill of the seven reworded keys (three stale fills actively
contradicted the honesty corrections; Latin stays on the release list),
the pressed-Pay busy face, the lapsed-quote Sign guard + paint-time
disable, focus keys on every actionable control, the mobile consent-row
touch floors on both surfaces, the sig's structural quote projection,
rel noreferrer, the /terms dev proxy, the narrowed language-fanout
reason, and the CLAUDE.md terms.html caveat. The judged-no-change list
and the QA session's remaining VERIFY arms (mobile E2E, Capacitor
_blank) are in the state.md ledger.

## 13 QA round (verdict PASS-WITH-FOLLOWUPS, every finding applied or judged)

Session start 2c900682ef (the 13 build docs tip; code tip ae1ba36b87). Release
sync was NON-trivial: merge 220b9b018f brought origin/release/v0.39.0 tip
f48c7a3a9b (80 commits), two conflicts resolved (generated i18n pending
regenerated with npm run i18n:gen; the hud.ts monolith ceiling re-derived to the
exact merged 19170, not either side's number). The release-merge-audit ran CLEAN
(sim.ts / hud.ts / main.ts / index.html / play.html / styles all exact-union,
whole-repo tsc clean, architecture 109/109, ci_workflow 25/25); the two trap
lanes that died on a Fable-5 usage limit were re-run inline (release touched no
server/ files, no injected-helper signature change, the release db-mock test
passes on the merged tree). QA range 19e4cd87ce..ae1ba36b87.

Audit: privacy-security-review, frontend-seam-reviewer, test-coverage-auditor
via Agent + seven probe lanes via workflow (attack-protocol, entry-points,
canonical-wallet, totp-remnants, ux-honesty done; correctness + cleanup-docs
died on the usage limit and were done inline). Independent mutation battery of
22 named mutants: 21 bit; the one survivor (the safeMessagePiece code-point
control-char arm) was a REAL code AND pin gap, closed. Red proof: both reds
confirmed at the source (pre-step-up builds had no stepUp param on either custody
op; pre-R10 builds had no item_lock_flag leaf and no `return 'locked'` arm) plus
the guard-removal mutation direction. Baseline: all market suites + the five pg
suites green zero skips WITH TEST_DATABASE_URL (142/142 pg).

Fix commits (LOCAL until the R4 push): a996d3c023 (sanitizer + its pins),
379610f66d (window close-reset + its source pin), cd689125d4 (the test-pin
batch). The fix round was then re-reviewed FRESH (security + coverage lenses),
which caught FOUR defects in the fixes themselves and drove a correction commit
234cc9b708: the String() coercion still threw on {toString:1} (guard to empty
instead); the flat window busy-reset broke the poll/withBusy invariants and
enabled a double-escrow (replaced with a busyGen generation counter +
capture-index + post-await bails); the devsig-wiring pin was comment-gameable
(comment-stripped + bounded to one site); the superseded-index pin was vacuous
(now seeds the old index and re-runs the boot to prove the DROP). Every new and
corrected load-bearing pin mutation-proven by name (the three sanitizer arms
RC1/RC2/RC3 on the robust version, the devsig flip, the DROP-index removal, the
close-reset removal). Details, the JUDGED-no-change list, the RE-REVIEW
CORRECTIONS, and the deferrals-with-owners (incl. the WocMarketWindow
behavioral-rig follow-up owed to 15) are in the 13 QA ROUND bullet of the
state.md ledger entry.

The full gate then surfaced two MERGE-INDUCED infra reds (neither a marketplace
defect), fixed in commits 2d597f6395 (a pre-existing non-null assertion + an
unformatted line the widened ci:changed scope exposed), a pnpm reinstall (the
merge updated patches/three@0.185.1.patch, so node_modules was stale and the
release's three-bundle test failed), and 4835b3ce8c (the merge's union of both
parents' new test files dropped the shard-weight table below its 95% coverage
floor; refreshed by merging real local durations for the 151 newly-uncovered
non-browser suites, existing CI-harvested weights preserved). Gate GREEN on the
final tip.

## 13 implement round (step-up authorization for custody-moving ops)

Session start 19e4cd87ce (the 12 QA docs tip; release sync a no-op, 0 behind
origin/release/v0.39.0 tip d2d1a8ad5c). BOTH session-start rulings recorded
FIRST as their own docs commit 6e4664e9a1 (R1 threshold: step-up on every
custody-moving call, no env knob; R10: locked copies refuse $WOC exchange
listing). B6 and the browser-only-gate medium closed.

Commit spine (LOCAL, not pushed per R4): 6e4664e9a1 (the two rulings),
39a244f50c (R10 item-lock refusal end to end + item_locked code with five
fills), dbc4445f0c (the step-up challenge protocol module + store, real-SQL
pg suite), 1f50feb96a (server enforcement on both custody movers + challenge
endpoint + six refusal codes with fills), a5de327458 (SDK contract),
b88508bd53 (client flows in both surfaces), 679edc4e15 (TOTP retirement +
doc truth-ups), 1641015d0d + fd3c60b40b (format + the gate-caught controller
rig gap). Reviews: four fresh lanes (privacy-security, frontend-seam,
cross-platform-sync, test-coverage via Agent) over 19e4cd87ce..1641015d0d.

FIX ROUND (all findings applied or judged; the fix round re-reviewed FRESH by
three lanes): bc1bdf98cb (extract isItemLocked to an item_lock_flag.ts leaf so
exchange_eligibility keeps its runtime-leaf property; parity test carries the
R10 asymmetry explicitly), 714f20cc53 (bind the copy fingerprint + offerNext +
realm into the step-up, validate itemId at issue, name the copy in the signed
message; closes the copy-swap flagged by three reviewers), 15e8f1b8fb (reset
both accepts + item_ref on a directed reopen so a spent proof cannot re-drive
custody), 64ce5e361a (seller-accept re-entrancy guard, pending face, listing-
flavored decline copy + label, locked-copy hint arm; new behavioral controller
arms for the real-wallet sign, decline abort, one-mint re-entrancy, disabled
in-flight button), ad806a26f7 (rate-bucket literal pins, realm-leading prune
index, TOTP-remnant guard, decode bounds), 4ff75d8eef (honest-claim framing for
the relink gap per Fernando's ruling), b1c6384ade (import sort). Fix round
mutation-proven: seven fix-round mutants all BIT (drop expectInstance, drop
offerNext, remove itemId-at-issue, keep accepts on reopen, dead locked-hint,
remove re-entrancy guard, never-disable pending face); the ten
implement-round mutants also all bit. Validation: npx tsc --noEmit clean;
market suites + snapshots/env_protocol/bandwidth + architecture + monolith +
i18n gates green; the FIVE market pg suites (incl. the new
woc_market_stepup_pg_integration) green zero skips WITH TEST_DATABASE_URL;
ci:changed exit 0. The 13 ledger entry in state.md is the registry the 13-qa
session consumes.

## 12 QA round (verdict PASS-WITH-FOLLOWUPS, every finding applied or judged)

Session start 90c007e36f (the 12 implement docs tip; release sync a no-op, 0
behind origin/release/v0.39.0 tip d2d1a8ad5c). QA range a6ff42f1c5..bd089672f9.
Seven fix commits on top of the docs tip, then this round's docs commit:
ef1d825236 (poll-settled extension, drift channels, logSafe 256, trace after
CAS, response-bid expiry patch), e0c4eee393 (listing state booleans, status
price projection, wrapper pins), 8484a3ce50 (devSplit clamps, the proxy
fail-safe pins, the game-word scan), 8402dc5f93 (payment-surface parity,
window devsig arm, re-quote re-label, split lifecycle, WHY-line row, orphan
key deletion, pure-core registration), 1b28affbbe (env-guard discovery walk,
DEPLOY.md and CLAUDE.md truth-ups, logSafe bound pin), 88cc70c61d (bond
prompt copy), 9ae040b680 (the fresh re-review's round: bond-leg fail warns,
fresh poll clock, cancelPending status gate, Activity badges with fills,
status value pins, walk classifier control, devsig branch-order pins, dead
wrapper deletion).

Lanes, in order: ten read-only audit lanes over the immutable range (the
three spec reviewers cross-platform-sync / frontend-seam / test-coverage
dispatched via the Agent tool; seven workflow lanes: server correctness,
client correctness, the serializer sweep, the fee edges, the env sweep,
dead code, docs truth), the red-proof lane in a scratch worktree (all seven
registry claims: the four old-build reproductions exact, the env guard red
both directions, the named fix-round mutants re-bitten, claim 7 judged with
the file open), and three mutation batteries (round 1: 17 mutants, 16 BIT,
the ONE survivor was a real pin gap, devSplit ceil-to-floor with no absolute
leg pin at an odd amount; new-pin round: 18/18 BIT including that survivor;
wave 3 over the re-review fixes: 10/10 BIT). The fix round was re-reviewed
FRESH by two lenses (correctness: 0 blocking, 5 should-fix, 5 nits/
observations, incl. the bond-leg drift gap and the stale poll anchor;
test-decisiveness: 1 blocking test gap, the fail-side POLL note call
undecidable behind the same-word dedupe, plus 6 should-fix and 6 nits), ALL
applied or judged; qa-checklist LAST over the whole diff. Validation: tsc
clean throughout; every market suite + snapshots/env_protocol/bandwidth +
architecture + monolith + i18n gates green; the four pg suites 132 green
zero skips WITH TEST_DATABASE_URL (three runs across the round);
ci:changed exit 0 (the one red on the way was format drift in four test
files this round edited, fixed by a scoped format); gate run recorded below.
Dispositions, judged list, and the new deferrals live in the state.md 12
ledger entry's 12 QA ROUND bullet.

## 12 implement round (wire completeness and environment truth)

Session start a6ff42f1c5 (the 11 QA tip; release sync a no-op, 0 behind
origin/release/v0.39.0 tip d2d1a8ad5c, so no release-merge-audit owed). Eight
code and doc commits to tip bd089672f9 plus the ledger docs commit on top,
LOCAL not pushed per R4. The commit spine:
c6cf146cec (wire fields + the wire-pin suite), ba4d44f890 (bond-quote contract
adoption), 55917385bd (anti-snipe allowlist + memoRef tolerance), e9b8dfaee0
(client localization, nine keys with five non-Latin fills each), 51e0eb1da6
(env truth + the two-direction guard), fe195677ad (the four-lane review round's
fixes: bounded adoption, balance re-guards, view-core WHY gate, repaint sig,
non-causal generic copy, screening pins, vocab literal pin), 65d4ddfc2c (the
fresh re-review's refresh-path symmetry fixes), bd089672f9 (the qa gate's
drift warn + log clamps + PRD truth-up).

Review rounds, in order: four parallel lanes over the five-commit base
(cross-platform-sync: 0 critical, 4 warnings, 8 info; privacy-security: 0
critical, 3 warnings, 6 info; frontend-seam: 0 blocking, 5 should-fix, 3
notes; test-coverage: 2 blocking test gaps, 10 should-fix, 6 nits) -> fix
round fe195677ad -> a FRESH re-review of that commit (0 critical, 4 warnings,
2 info; its test lane was cut off and its named checks were judged in the
main loop with the files open) -> fix round 65d4ddfc2c closed by careful
self-review (narrow, both new tests constructionally decisive) ->
qa-checklist over the whole diff: READY, 0 blocking, 2 should-fix + 2
suggestions, all applied in bd089672f9. Every finding across all rounds is
applied or judged with the file open; the judged list and deferrals live in
the state.md 12 ledger entry.

Red-first proofs: the wire-pin suite ran 14 red on the pre-fix build; the
anti-snipe allowlist tests ran red on the old denylist; the controller
split-adoption test ran red via a stash A/B; bondCents(2001) pinned red under
round. Mutation: field drop bit 3 tests, field rename 4, vocabulary member
delete 2 suites, env guard red in both directions, raw-passthrough screen
mutant bit 1, echo-recompute 1, sig-drop 1, plus the four earlier commit-round
mutants; the one-retry ceiling is enforced by a call-count pin.

Validation: npx tsc --noEmit clean throughout; the market suites plus
snapshots/env_protocol/bandwidth green; i18n gates green
(i18n_completeness incl. M16, localization_fixes S3, language fanout);
real-SQL suites green zero skips WITH TEST_DATABASE_URL (bond, settlement,
delivery, directed); npm run ci:changed exit 0. Gate GREEN at the docs tip:
node scripts/gate_select.mjs ran the full gate step list with the vitest step
fallen back to the FULL suite (broad change class), all 12 steps green, 2854
test files / 40604 tests + 2 expected fails, browser 129, typecheck and all
builds, run WITH TEST_DATABASE_URL so every pg suite executed inside it.

## 11 QA round (verdict PASS-WITH-FOLLOWUPS, every finding applied or judged)

Service repo, worktree woc-rewards-service-pr31; session start 03df5de (clean,
origin/master already contained at df09756), QA range 8da6c03..03df5de; fix
round 5 commits, tip 270e337, pushed per R4 with the game docs. Baseline
re-verified at 03df5de before any audit (build clean; 590 tests, 583 pass, 7
env-gated skips default tier; 590/590 zero skips with
CLAUDIUM_TEST_DATABASE_URL against the dev Postgres).

Eight audit lanes in one workflow over the range (correctness with the four
probes from the QA spec; security/ops on the stalled-venue and
freshness-overstatement questions; test decisiveness against the vacuous-pin
classes; dead code and doc staleness; red proof; three mutation groups), then
a two-lens refute pass (51 of 88 votes landed before the workflow runner
stalled and was killed; both refutations matched the dispositions already
taken; every finding was judged in the main loop with the file open) and a
fresh ROUND-2 workflow over the fix round itself (two fresh lenses, sixteen
new-pin mutants, a completeness critic over all 44 dispositions).

Range verdicts:
- RED PROOF: all eleven registry claims REPRODUCED-RED on the named old
  builds (8da6c03; 83d7d00 for the oracle claims; a616f73 for the re-review
  claims) and green at the tip by the pin tests and by identical probes
  against the tip dist.
- MUTATION round 1: the QA registry named 42 mutants (the implement round's
  41 plus the .env.example min-samples drift), 41 BIT by name under
  full-file runs plus sub-variants, ONE SURVIVED: the admin overview
  hardcoding crossVenueGateArmed false passed because the only wire pin
  asserted false under a single-venue rig; closed in the fix round by a
  two-venue overview arm and re-proven (round-2 mutant 14 BIT). Two pins
  were deliberately renamed by the fix round (annotated in the state.md
  registry bullet for any by-name re-run).
- FINDINGS: 44 (0 blocking, 8 should-fix, the rest nits and observations),
  every one applied or judged with the file open; dispositions in the
  state.md 11 QA ROUND bullet.

The fix round (5 commits):
- 5236897 sizes the oracle tightening floors from the venue cadence
  (staleness tight end 15 to 45 minutes, sample minimum 90 to 60 with the
  setInterval-lateness margin: a legal tightening to the old floors could
  refuse the print as stale for the tail of every republish cycle, reset the
  breaker at any thirty-minute gap, or park a quiet realm on a permanent
  insufficient_samples), judges the refusal readout window against the poll
  clock, adds the parse-time warn for every mis-set oracle knob, and states
  the two exposure corollaries in the header (sub-bound moves compound; the
  breaker has no predecessor after ANY recording gap longer than the window).
  New pins: cap eviction direction, off-default bounds, literal tight ends,
  parser warn lines, exact skew and staleness edges, the healthy 38-minute
  venue row, MAX_ORACLE_SAMPLES and VENUE_AGE_SCREEN_OFF_MS as literals.
- 9c60aa9 wires the parser warn to the boot operator channel, puts the
  window depth on the recovered line (samples and prints, so a breaker reset
  reads differently from an ordinary recovery) with a zero floor on the
  duration, mirrors spotUsdPerToken and twapUsdPerToken onto the admin
  overview, and adds the decisive pins: the two-venue overview arm, paused
  settlementQuote, the cold-pause null, request reads not moving the signal.
- b865c56 trues every doc the audit caught lagging the one-judge design
  (.env.example no_price-forever and plural-venue wording, the compose
  override comment, the cold-boot sentence corrected to WHEN the breaker
  reads zero, the recording-gap siblings and their runbook lines including
  the host-clock diagnosability note, the warm-up pair timing, the
  latest()/still-halted/median-fresh precision, the Birdeye venue row in the
  environment table, the CLAUDE.md bullet trimmed to rules plus pointer, the
  TODOS anchor widened to in-process gaps) and adds the .env.example
  discovery sweep to compose_conformance.
- 5a97aa9 rides a tightened env bound through buildMarketApps to the health
  surface in one pin.
- 270e337 applies the round-2 lenses: the refusal arms report the window
  through a NON-MUTATING view (a refusal must tell the truth but never
  destroy it; one read with a spuriously future clock must not discard
  samples nothing recorded over, and the pin asserts the buffer survives),
  the window knob's ceiling-invariant warn quotes what the operator actually
  wrote (the two-line clamp-plus-outrun case pinned), the two-venue arm pins
  twapUsdPerToken by value (the one mirror field a hardcode could still
  satisfy), and the comment truth-ups ride along.
Game repo: the proxy header's multiple-liquidity-sources claim reworded to
the single-venue truth (server/woc_market_proxy.ts, comment only, DC-04).

ROUND-2 verdicts (the fixes are unreviewed code): docs/ops lens 7 findings
(0 blocking, 4 nits applied, 2 ruled-class observations, 1 optional applied);
correctness lens 6 findings (0 blocking; the twap-mirror decisiveness gap and
the outrun-warn precision applied; the commit-attribution nit fixed by
rewording the two local-only commit messages; the destructive-prune
observation hardened into the non-mutating view; the count observation was
the lens measuring the worktree tip one test-commit ahead of its range; the
sweep-regex observation no action by its own text); 16 round-2 mutants ALL
BIT in two groups against 2246046 (same trees as b865c56), worktrees left
clean; the four rework pins (view dropped, view bypassed on the stale arm,
outrun quote dropped, twap hardcode) proven BIT against the final tip by
compiled-dist mutation.

Validation after the fix round: build clean; 595 tests, 588 pass, 0 fail, 7
env-gated skips default tier; 595/595 zero skips with
CLAUDIUM_TEST_DATABASE_URL. Copy floor clean both repos (no dashes, no
emojis, no reserved words in code or commits); game ci:changed exit 0.

## Sync-only session ahead of 10 QA (2026-08-15, both repos, LOCAL)

Fernando asked this session to run only the SESSION START merges of
phase-10-qa.md, gate them, and stop, so 10 QA itself starts fresh. Nothing
was pushed (R4: the QA session pushes on PASS; the game push then carries
these commits).

SERVICE (worktree woc-rewards-service-pr31, integration/woc-market-settlement):
tree clean at ba7df0b; origin/master fetched, still df09756 and already
contained (no-op merge, nothing to record beyond that). Baseline
re-verified in service/: build clean; 536 tests, 530 pass, 0 fail, 6
env-gated skips default tier; 536/536 zero skips with
CLAUDIUM_TEST_DATABASE_URL against the dev Postgres. Matches the 10
implement contract exactly.

GAME (worktree wocc-marketplace, feature/woc-marketplace): the newest
release branch was DISCOVERED (standing rule) as origin/release/v0.39.0:
v0.38.0 shipped to main via PR #3416 and v0.39.0 was minted from it (tip
d2d1a8ad5c = the v0.38.0 tip fb88c3f094 + 6 commits: the merge, the 0.38.1
version bump, the r185 chase-camera fix, the docker sharding-sequencer
fix), so the sync merged v0.39.0 (a strict superset of the v0.38.0 tip the
prompt named). Merge f5df042a86, NON-trivial (296 commits behind, 509 delta
paths, five conflicts):
- src/ui/hud.ts (postEntryPreviewPrewarmUnits): the release stopped warming
  the Armory catalog on a schedule (56bb1f17e4) while the branch had
  extracted the composition into src/ui/preview_prewarm_wiring.ts (02 QA).
  Resolved by keeping the wiring composition and dropping the three armory
  deps from it, its interface, and its suite (which gained the release's
  NEGATIVE armory pin); the merged tests/armory_preview_lifecycle.test.ts
  already carried both sides' pins.
- tests/helpers/strip_comments.ts + .test.ts (add/add): the release's
  lookbehind form taken for both (a strict superset: it also strips a line
  comment glued to a block closer, `*///`; a whole-tree grep finds that
  shape only in the helper's own fixture, so no branch consumer's verdict
  moves; the release suite subsumes the branch's four pins).
- src/ui/i18n.resolved.generated/pending.ts: regenerated (npm run i18n:gen
  with TURBO_FORCE=1), never hand-merged.
- tests/monolith_budget.test.ts: hud.ts row re-pinned DOWN to the exact
  merged size 19120 (both sides shrank it: the Armory-prewarm removal and
  the ability_description.ts extraction; the release's own 19420 -> 19432
  maintainer raise + 19433 re-pin recorded in the row comment as release
  lineage, e362916958). Two further ratchet reds surfaced only on the
  union: sim.ts 12508 vs 12505 (release-side growth of 7 lines; the
  branch's delegates unchanged; re-pinned to the exact merged size per the
  row's own v0.38.0 precedent, still under the release's 12660) and
  main.ts 11499 vs 11490 (the release grew the file to within eight lines
  of its ceiling; the branch's 17-line inline Exchange attach sat on top).
  main.ts was NOT raised: bf7aeb8a98 extracts the attach into
  src/game/woc_market_wiring.ts (one-call composition in the
  desktop_shell_integration shape: NATIVE_APP / DESKTOP_APP default from
  client_origin and stay injectable, every wrapped shell fail-closed,
  main.ts carries one call; tests/woc_market_wiring.test.ts pins the gate
  per dimension, the live token / characterId / walletLinked routing, the
  lazy wallet load on first sign, and the main.ts firewall by source scan;
  three mutants bit: gate operator, hardcoded default shell, walletLinked
  constant). main.ts lands at 11489 under the release's 11490; the merge
  commit alone is red on that row (stated in its body), HEAD is green.
- three.js moved 0.165.0 -> 0.185.1 (patched); pnpm install
  --frozen-lockfile refreshed the worktree before any test ran.

release-merge-audit (ultracode workflow: six audit lanes over the delta and
the 26-file overlap set, then one adversarial refuter per finding; 20 agents,
14 findings, ALL confirmed, none refuted): every overlap source and test
file is a clean union (hud.ts hunk-by-hunk both directions, sim.ts,
main.ts, entity_i18n.ts, CLAUDE.md, README, both HTML entries, the eight
overlap tests); count pins send 200 / dispatch 213 / IWorld 324 unchanged
and run-confirmed; the delta adds no route, registry row, WS command,
world_api member, or src/net change (server/perf_report.ts is the only
server file and the branch does not import it); the two new
vi.mock('../server/db') sites (battleground_pop_wire_order, perf_report)
mock nothing the branch extended and run green; branch i18n keys and
overlay rows all survived and the committed pending.ts is byte-identical
to a fresh regeneration; no branch-owned test source-scanning a
release-changed file went red (union-reds lane: 0). Applied: the two
pin-prose nits (e362916958: hud row release lineage; the armory negative
pin now scans preview_prewarm_wiring.ts too, mutation-proven), and nine
doc-premise corrections in this section's commit (implementation-plan
current-release lines, state.md base / repos row / count-pin gotcha /
i18n debt sizing / phases-12-16 ceilings / new v0.39.0 release rules,
the 18 unrun phase files' SESSION START blocks, phase-13's gate pointer,
review.md's pointer). Recorded, no action here: the 3 hudChrome.trade.woc
rows pending in the five non-Latin locales are pre-existing branch debt
(release fill), and entities.abilities.frenzied_regeneration.description
is reword-stale in 18 overlays ON origin/release/v0.39.0 itself (English
lost its "(Druid talent)" suffix in 4ca52c8eb0, the overlays kept theirs):
a maintainer follow-up on the release branch, not this one.

Validation on the committed tree: npx tsc clean; gate GREEN at bf7aeb8a98
(node scripts/gate_select.mjs, full-suite fallback, ALL 12 steps, 2850 test
files / 40533 tests, browser 129, WITH TEST_DATABASE_URL and TURBO_FORCE=1);
DB-gated suites run separately with the URL: 18 files, 245 green, zero
skips; e362916958 is a two-test-file prose change re-run green (20 tests).
Copy floor clean over every new line; no "phase" word in any commit
message. Tip after this session's docs commit: see git log; LOCAL, not
pushed.

## 11 implement round (oracle health and honesty)

Service repo, worktree woc-rewards-service-pr31; session start 8da6c03 (clean,
origin/master already contained at df09756, origin/feature/woc-market-settlement
matching the tip, PR #31 checks green there), 5 commits, tip 03df5de, LOCAL not
pushed per R4. Baseline validation matched the documented contract exactly
(build clean; 560 tests, 553 pass, 7 env-gated skips default tier; 560/560 zero
skips with CLAUDIUM_TEST_DATABASE_URL against the dev Postgres).

RULING FIRST: R3 was proposed with code-grounded rationale (bootstrap wires
birdeye + a Pyth arm no feed can arm; the only configurable second source,
Jupiter, publishes no print time; Birdeye's measured cadence would make a
second venue a false-halt generator) and confirmed by Fernando before any code
(recorded in state.md Rulings, game commit e2f189e9a4): single-venue posture,
spot 500 bps, staleness at the measured hour with publish-time honesty as the
compensation. A second ruling landed at the review round (cold boot: record
and document, no gate; recorded as an R3 amendment).

Commits (service):
- 40321d8 publish-time freshness and the venue truth: MarketPriceHealth.asOfMs
  is the newest venue publish time on healthy readings and refusals (null only
  when no venue priced), the game wire (price, estimate) carries it, the
  diagnostics gain per-venue ageMs, configuredVenues, liveVenues,
  crossVenueGateArmed and distinctPrints, mapped field-by-field onto the admin
  overview. RED-FIRST: the asOfMs pin reproduced red on the 8da6c03 oracle
  (poll clock 1720000002000 where the print time 1719998502000 was expected);
  the surface fields were structural reds (tsc). 7 mutants bit.
- eca8730 the ruled posture: pythSource and WOC_MARKET_PYTH_WOC_FEED_ID gone
  from bootstrap, compose, .env.example and docs; marketOracleConfigFromEnv
  ignores WOC_MARKET_MAX_VENUE_DEVIATION_BPS (code default 500 kept, oracle
  stays N-venue capable); DEFAULT_MARKET_ORACLE_CONFIG.maxSpotDeviationBps
  500; compose_conformance pins the retired knobs out and the blank spot
  default in. RED-FIRST: a Pyth feed id alone BUILT a market on 8da6c03
  ([Object] where null was expected); the venue knob was honored; a 6% jump
  passed at 1000; compose carried both knobs. 5 mutants bit.
- 83d7d00 the deliverable-1 proofs under node:test mock timers: heartbeat
  ticks alone satisfy the market's own read and its sample arithmetic (prime
  + ticks + reads) proves one buffer; twenty minutes of idle heartbeat leaves
  the next request healthy; the heartbeat-stopped negative control shows the
  false-outage shape; a comment-stripped scan of the compiled bootstrap counts
  one construction site. Red form: mutation (the H3 bug re-introduced as a
  private second oracle fails four tests by name; a detached heartbeat fails
  three; a stray construction site fails the belt). 4 mutants bit.
- a616f73 the review fix round (both fresh lenses applied): the oracle is the
  ONE judge of freshness, per venue (VENUE_AGE_SCREEN_OFF_MS hands every
  parseable Birdeye print up; stale prints never enter the median; future
  prints beyond MAX_ORACLE_FUTURE_SKEW_MS and unparseable publish times count
  as no print; ageMs floors at zero); sorted sample insert; effective bounds
  on the surface; env may only TIGHTEN each bound; tradableHealth reads
  health before the pause check so a paused estimate carries the print time;
  price_gate_signal.ts (new module) fed by the heartbeat: halted / still
  halted / recovered lines, edge-triggered; test rigs: t.after cleanup,
  RIG_PRINT_AGE_MS, ORACLE_HEARTBEAT_MS exported and imported, negative
  control ticks through the stop, warmed() replaces the retired
  min-samples-1 env shortcut, the REAL birdeyeSource driven end to end via a
  mocked global fetch for a 70-minute print (stale with print time) and the
  38-minute print (healthy), decisive distinctPrints and bounds pins over
  HTTP, .env.example pinned beside compose; docs state what the breaker is at
  the deployed cadence and record the cold-boot decision. RED-FIRST: the five
  new oracle pins reproduced red on the pre-fix oracle (future print healthy,
  stale print dragging the median to 0.0015, no bounds field, no fresh
  verdict, a 999999 spot bound accepted). 14 mutants bit (one after
  reshaping the out-of-order fixture to the reviewer's exact case: the newer
  sample of an inverted pair at the head).
- 03df5de the re-review round (a fresh third lens over a616f73, 18 findings,
  all applied or judged): ORACLE_BOUND_RANGES caps the TIGHTENING direction
  (window up to an hour and never past the staleness ceiling, samples up to
  90, staleness down to the default window, spot down to 100 bps; decimal
  integers only); MAX_ORACLE_SAMPLES hard-caps the buffer (oldest out under
  request load); the stale arm keeps the spot it saw and the standing
  average; asOfMs never claims the future; MarketPriceOracle.latest() and a
  paused refusal that reads it instead of polling (price and every quote
  path); the heartbeat runs one poll at a time (the sweep's guard) so the
  operator signal's edges arrive in order; the halt line floors the print age
  at zero; the venue-fetch mock is ONE mock over a mutable print time (node's
  MockTracker restores in creation order, so a second mock on the same target
  reinstalled the first stub for the rest of the file); .env.example's
  numeric oracle knobs pinned against the code constants; the "5% per
  publication" claim replaced with the truth (a hold-time cost that absorbs
  any move within a window; the tightening converts 5% to 10% moves from
  silent acceptance into a multi-minute halt); TODOS.md names the cold-boot
  anchor follow-up. RED-FIRST: the in-flight, paused-no-poll and negative-age
  pins reproduced red on a616f73. 11 mutants bit. Closed by careful
  self-review with the diff open (narrow, test-covered).

Game repo (docs, feature/woc-marketplace): e2f189e9a4 the R3 ruling record;
c5ce2793e7 the PRD claim revised to the single-venue truth.

Mutation registry: 41 mutants BIT by name under full-file runs: healthy asOfMs
back to the poll clock, crossVenueGateArmed at one venue, distinctPrints as
samples, ageMs null, stale refusal asOfMs poll clock, overview dropping the
armed flag, liveVenues counting configured, spot bound back to 1000, venue
knob re-read, pyth env re-wired, compose re-growing the pyth knob, compose
numeric spot default, the private second oracle, heartbeat detached, stray
construction site, boot prime removed, NaN publish accepted, future skew
dropped, stale print entering the median, bounds misreporting, sorted insert
removed (survived the first fixture, bit the reshaped one), spot bound may
widen, min samples may lower, source judging age again, signal warning every
tick, recovery line dropped, paused estimate asOfMs null, .env.example
regrowing the pyth knob, stopOracleHeartbeat no-op, signal not wired,
crossVenueGateArmed off the venue list; round 2: sample cap removed, latest()
always null, asOfMs future clamp removed, stale arm dropping spot/twap, tight
clamp dropped, integer regex dropped, window invariant dropped, heartbeat
guard removed, signal age clamp removed, paused refusal polling again,
.env.example min-samples drift.

Validation after every slice; final at 03df5de: build clean, 590 tests, 583
pass + 7 env-gated skips default tier (two consecutive full runs green after
one floating-rounding flake was fixed at its pin), 590/590 zero skips with
CLAUDIUM_TEST_DATABASE_URL. Copy floor clean both repos (no dashes, no
emojis, no "phase" in code or commits). Docs upkeep in the same change:
service CLAUDE.md, MARKET_SETTLEMENT.md, .env.example, docker-compose.yml,
TODOS.md.

## 10 QA round (verdict PASS-WITH-FOLLOWUPS, every finding applied or judged)

Service repo, worktree woc-rewards-service-pr31; session start ba7df0b (clean,
origin/master still df09756 and already contained; the SESSION START syncs
were already done by the 2026-08-15 sync-only session and a re-fetch at the
end of this session found nothing new on origin/master or origin/release/v0.39.0),
audit range 02713f2..ba7df0b, tip 8da6c03, 5 commits, PUSHED per R4
(service ba7df0b..8da6c03 to feature/woc-market-settlement, updates PR #31;
game after the release check below).

Seven audit lanes ran concurrently in one workflow, each in its own scratch
worktree where it needed a build (the live trees were never modified): a
hostile-fixture inventor (56 shapes RUN through the real verifier), security,
correctness, test-coverage, docs/dead-code/copy-floor, a red-proof lane on a
throwaway 02713f2 build, and a mutation battery on a scratch ba7df0b build.
The refuter stage (one adversarial refuter per finding, 68) ran into the
session's subagent limit after 15 completed; per the standing rule every
finding was judged in the main loop with the file open (the audit lanes'
evidence plus primary sources), the fix round was built and committed, and
the fresh fix-round re-review ran after the reset (two lenses).

THE ROUND'S HIGHEST-STAKES JUDGMENT, made with the parser and the token
program open (agave transaction-status/src/parse_token.rs and
solana-program/token processor.rs, fetched this session): ba7df0b's
restoration of the multisigAuthority-equals-payer acceptance arm is CORRECT
and money-safe. parse_signers picks 'authority' vs 'multisigAuthority'
purely by accounts.len() > 3 with no multisig-existence check; the token
program's validate_owner non-multisig branch ignores the trailing signers
slice and only requires the authority to be a signer; process_burn passes
the trailing accounts as that slice; a fee payer must be system-owned so a
real multisig can never be keys[0]. Refusing the label would have
terminally rejected honestly-paid burns from any wallet that pads the
account list. Also verified from parse_instruction.rs: agave labels BOTH
token programs 'spl-token' (one ParsableProgram variant, kebab-cased), so
the 'spl-token-2022' label is a defensive alias the reference parser never
emits; the comment and test were trued and the 21 handoff narrowed.

Round-1 verdicts on the implement range: ZERO blocking, ZERO
accepted_dishonest shapes across the 56-fixture hunt (every redirect,
short, over, split, delegate, PDA and forged-label burn, owner change,
victim-account delegate payment, batched settlement, third-party gift,
over-credit, mintTo offset and parked-fee shape refused; the real
wallet-emitted transaction shape verified matched, with Lighthouse,
durable-nonce, Jito-tip, ATA-exists and payer-ATA-closed variants). All six
red-first registry claims REPRODUCED-RED on the 02713f2 build (compile
shims for MATCH_COMMITMENT / CREDIT_COMMITMENT and a no-op stopExpirySweep
only; a new-src overlay on the same tree turned every red green, so each is
a behavior red). Mutation: 27 of 31 mutants BIT; the four survivors were
real pin gaps (the pg sweep's outer status guards on BOTH arms, the
confirming arm's ORDER BY, and the pre-existing payer_mismatch check whose
only test was refused by a downstream check instead), all closed below.

The QA round's own findings, all applied (with the judged exceptions
listed): the SHOULD-FIX class had one money/security item and one
fail-closed item. (1) SEC-2: a string that can never be a signature (not
base58, or the wrong byte length such as a wallet address) passed confirm's
32..120 bound and the game's regex, reached getParsedTransaction, the node
answered -32602, web3.js threw, confirm 500ed on every poll, and the game
read the 500 as service_unavailable, the verdict it exempts from its
buy-now abandon ledger and anti-snipe extension on the premise that a real
outage is not mintable on demand; the junk also held the signature slot
for the confirming bound and blocked the real signature with
signature_conflict. Closed by a chain-owned shape predicate
(MarketChainVerifier.isPlausibleSignature; live: base58 to exactly 64
bytes in the new dependency-free src/market/signature_shape.ts, fuzzed
against bs58 out of band and pinned on reference-encoded vectors; dev: any
tag) screened BEFORE the first write on both confirm entries, answering
invalid_signature without a write or ledger read (the real signature still
confirms after junk). (2) I15 (fixture hunt): a leg whose destination is
the payer could never verify (the leg check compared the payer's NET delta;
the debit check's netting branch was dead), reachable when the treasury
wallet buys a listing; the leg check now skips the payer's own leg and the
netting branch is live and pinned. Also applied: burn_authority_mismatch
(a burn of the quoted mint under an authority the quote never named, a
vault or router PDA or a delegate, is still refused but named, so the ops
rail can tell it from a redirected fee; burnedBaseFor takes a null
authority for that one distinction), the stray wallet named in the
operator log on unexpected_credit, add() skipping non-string owners, the
edge-triggered sweep-failure warn (the sweep is the only production driver
of expiry and swallowed every failure silently), expirePastDue answering 0
for a non-positive budget in both stores (pg refused a negative LIMIT
outright), attention.confirmingExpired24h in the admin overview (the one
expired class an operator should look at; state.md called it ops-visible,
it was visible only by listing expired rows), and the doc truth-ups: the
bound is measured from quote EXPIRY and the five-under-six ordering is a
precondition on two knobs (WOC_MARKET_QUOTE_TTL_MS unclamped, keep it well
under one hour; the game's WOC_MARKET_CONFIRMING_REVIEW_HOURS at or above
six), the RPC-history premise now cites release_protocol's own six hour
depth instead of contradicting it, the anti-snipe overclaim reworded to
the game's follow-up, the wiring doc's verifier paragraph lists every
check in order with its reason and scopes the whitelist to the quoted
mint, MARKET_SETTLEMENT.md gains the confirm vocabulary in one place, the
recovery caveat once the game has acted on a terminal answer (out-of-band
re-confirm of the preserved signature), the treasury-rotation and TTL
knob notes, the first-sweep backlog deploy note, and the four omitted
suites in the tests list; CLAUDE.md and .env.example carry the two facts.

Test pins added (each mutation-proven by name, 21 mutants BIT over the
committed fix round): the real wallet-emitted shape (compute budget
riders, idempotent ATA creation with inner instructions, checked legs,
burn, memo last; guard rider; ATA exists; unfinal), a leg credited above
the quote (payer-funded, donor-funded, treasury), two settlements batched
(shared treasury, distinct treasuries, sale plus no-burn bond, from every
quote's side), exact base-unit comparison above 2^53 and the uiAmount
decoy, a delegate burn and a delegate-funded leg, an owner reassignment
mid-transaction, the fee payer check on its own (payer_mismatch), the
treasury buying a listing, the authority-mismatch word vs burn_missing,
the stray-wallet log, the recovery warn once, the shape predicate at the
verifier and the shape module's vectors; the service pins the reserved
matched-arm word on both entries, the rejected reason landing on the row
for every B4 word, the shape screen (no write, no verify call, real
signature confirms after junk, entry path answers the terminal), and
every entry arm of a confirming-expired quote (different signature,
unseen, matched-unfinal with no window, adoption clearing the stale
reason); the pg suite races BOTH sweep arms for real (lock wait observed
before commit, zero swept), pins the confirming arm's order and the shared
budget remainder, both partial indexes in the catalog, and the
non-positive budget; the memory store gets the order and budget twins
ungated and the preserved-signature pin; bootstrap proves a rejecting
sweep is swallowed, keeps its cadence, never becomes an unhandled
rejection, and warns once per outage; http pins the verifier reason on
the quote listing and the confirming-expired counter.

JUDGED, no code change (do not re-raise): the balance-row BigInt throw on
a malformed amount (never emitted by agave) stays a THROW, deliberately
the opposite of the burn side's parse-to-zero: a coerced balance would
reject a real payment terminally while a throw is a retryable 500 that
leaves the row confirming, now documented at the site and handed to 22's
RPC-defect policy item together with the malformed-envelope throw (I24)
and the lenient-vs-canonical amount asymmetry; a fee-sponsored (relayer)
transaction is terminally payer_mismatch by design (the builder sets the
buyer as fee payer and browser wallets do not rewrite it; a real-wallet
observation for 21); the null-owner add() skip cannot be pinned (the
outcome is identical either way, it removes a sentinel collision);
Q5e (two memos, one payment, two identical quotes) is the 09 settled-
signature index's case, not the verifier's; the docs lane's D21 (a
pre-existing PRD sentence about expired quotes) predates the range and is
game-side; the SEC-6 refutation was accepted (the game's anti-snipe gate
is the registered 12 handoff), the EPQ-comment refutation was accepted in
substance (EvalPlanQual re-checks the LAST committed version, so a two-hop
move is a legitimate re-check target; the comment now names each arm's
reachable moves instead of calling one unreachable). SEC-11 (expectedLegs
resolves the treasury from the CURRENT config, so rotating the treasury
wallet with quotes in flight rejects real payments) is pre-existing and
out of range: documented in the knob table and deferred to 22's runbook.

THE FRESH RE-REVIEW OF THE FIX ROUND (two lenses over ba7df0b..33c268c,
after the reset) found one real weakening IN the fix round and both lenses
found it independently: the payer-leg netting let a BOND quote whose payer
is the escrow wallet (its only leg a self-transfer, no burn) verify against
a transaction that moves nothing (executed on the 33c268c build; the
ba7df0b build refused it leg_mismatch). Unreachable today (the memo would
have to ride an escrow-signed transaction and the escrow be registered as a
bidder through the game's verifiedWallet seam), but a break of the
verify-the-outcome property, so it got two belts in 2c2ae78: bondQuote
refuses the escrow as a bidder (self_dealing) and the verifier skips a
payer-destination leg only while another leg or the burn keeps the debit
equation binding (owesOthers), refusing the all-self-legs shape as
leg_mismatch. Also applied from the re-review: the stray-credit warn once
per memo (bounded set) with the RPC-supplied owner clamped to printable
ASCII (log-forging / flooding), a trailing catch and an in-flight guard on
the sweep chain (a throwing handler must not become an unhandled
rejection; a slow store must not stack sweeps or flap the edge), the
null-authority burn pass counting only ATTRIBUTED burns (an unattributed
body stays burn_missing), the ops counter reading its own class through a
new terminalReason list filter in both stores (the general list caps at
200 rows and would crowd the class out; pinned by 250 newer unpaid
expiries), softened overclaims (a well-shaped signature can still meet a
real RPC failure; the game keeps its own first-claim signature slot), the
owner-less balance row pinned as the judged policy, bad_body in the
vocabulary table, the memory store's redundant budget guard removed, the
superseded status comment, an honest stop-hook test title, and a plain
boolean where a type predicate narrowed nothing. Every re-review-round pin
mutation-proven (11 mutants BIT: owesOthers forced true, the escrow-bidder
guard dropped, the attributed-authority requirement dropped, warn every
poll, no clamp, no trailing catch, no in-flight guard, the pg and memory
reason filters ignored, the null owner keyed, the counter derived from the
crowded list). The re-review round itself was self-reviewed with the diff
open (each change reviewer-prescribed and small). Judged from the
re-review, no change: SEC-2's anti-snipe half is the registered 12 handoff
(a well-shaped random signature still answers not_yet_visible pending, and
the game keys on the pending flag until it gates on awaiting_finality);
the observation that a zero amountBase would empty every leg and make the
debit equation vacuous is pre-existing and quote-time (bond clamps to at
least bondMinCents; a settlement's usdCents is validated positive), noted
for 22's close-out audit rather than changed here.

Validation after every slice; final at 8da6c03: build clean, 560
tests, 553 pass + 7 env-gated skips default tier (the seventh is the
new pg contention test), 560/560 zero skips with
CLAUDIUM_TEST_DATABASE_URL. Copy floor clean over every added line and
commit message (one banned word caught and fixed before commit).
Both remotes re-fetched at the end: service origin/master still df09756
(contained); game 0 behind origin/release/v0.39.0; origin/main moved to
the v0.38.2 hotfix tip (a patch line off the shipped 0.38, not the newest
release line, not contained in the branch; it flows to v0.39.0 through the
maintainers' main sync, so the next game session's release sync will pick
it up; nothing to merge here). PR #31 checks at 8da6c03: all three test runs
GREEN (17 s, 54 s, 56 s), verified after the push.

## 10 implement round (chain verifier proves the burn)

Service repo, worktree woc-rewards-service-pr31; session start 02713f2 (clean,
origin/master already contained at df09756, origin/feature/woc-market-settlement
matching the tip), 6 commits, tip ba7df0b, LOCAL not pushed per R4. Baseline
validation matched the documented contract exactly (build clean; 508 tests,
502 pass, 6 env-gated skips default tier; 508/508 zero skips with
CLAUDIUM_TEST_DATABASE_URL against the dev Postgres).

RULING FIRST: the two R5 remainder items were proposed with code-grounded
rationale and confirmed by Fernando before any code (recorded in state.md
Rulings, game commit 71f36c695f): the commitment split ratified (match at
confirmed, credit at finalized, code-owned constants, no env knob, plus the
pending-vocabulary split) and the confirming bound at five hours expiring to
the adoptable expired state.

Commits:
- 5bf0812 the B4 fix: settlement_proof.ts (pure necessity checks: burnedBaseFor,
  unexpectedCredit) wired into the verifier after the leg checks with distinct
  stable reasons burn_missing / burn_mismatch / unexpected_credit;
  MATCH_COMMITMENT / CREDIT_COMMITMENT pinned. Red-first: the full
  burn-redirect, the short-burn-with-redirect, and the extra-credit rider all
  verified as MATCHED on the old code (recorded); five more vectors were
  reason-contract reds.
- 65bb341 the ruled bound: MAX_CONFIRMING_AGE_MS in quotes.ts; both stores'
  expirePastDue gain the confirming arm (expired, reason confirming_expired,
  submitted signature preserved for entry adoption); pg gets the
  woc_market_quotes_confirming_due partial index and outer status+due guards
  on BOTH arms (EvalPlanQual discipline; the pending arm's subselect-only
  shape predated this change); buildMarketApps gains the one minute unref'd
  expiry sweep with stopExpirySweep (expireStaleQuotes previously had ZERO
  production callers). Red-first: the service-level bound test and both pg
  arms reproduced red before the change.
- 44e94dc the vocabulary split: confirm's undecided arms pass the verifier's
  own reason through (not_yet_visible live; awaiting_finality stays the
  matched-arm word and the reason-less fallback). Red-first both arms. The
  game-side adoption (anti-snipe extension gating on the matched arm) is 12's.
- 498d6bd docs: wiring decision 4 ANSWERED, verifier promise rewritten off the
  disproved payer-debit description, lifecycle diagram, repo CLAUDE.md.
- ca568cc the review fix round (both fresh lenses applied): edge-triggered
  operator warn on getSignatureStatuses outages, not_yet_visible pinned at its
  real emitter, memory sweep oldest-expiry-first with an always-running budget
  test, negative pins (forged program label, partially decoded instructions,
  malformed amounts, two-burn over-sum, 0n no-burn), comment and doc truth-ups.
- ba7df0b the re-review round: the fix round's multisig-impossibility claim
  REFUTED (jsonParsed labels the burn authority multisigAuthority by ACCOUNT
  COUNT while the token program ignores trailing accounts, so the shape is an
  ordinary honestly-paid burn); the acceptance arm restored with true
  rationale and both test arms; the pg intra-arm ORDER BY pinned.

Mutation registry: 15 mutants BIT by name under full-suite runs (burn authority
drop, exact-amount to less-than, burn_missing unreachable, whitelist threshold,
whitelist expected-skip, pg and memory cutoff drops, sweep cadence halved,
not_yet_visible reason drop, multisig re-admit then multisig re-refuse and
accept-any-label, warn-every-failure, memory sort drop, pg ORDER BY DESC) plus
ONE JUDGED SURVIVOR: deleting the pg pending-arm ORDER BY fails nothing because
the planner's partial-index scan order coincides with sorted order on this
shape; the pin is decisive against real order regressions (the DESC variant
bites) and the clause stays correct-by-construction. NOTE: the first fix-round
battery fired the uncommitted-revert trap (git checkout over WIP discarded
three files' fix edits, and one mutant silently no-op'd); everything was
re-applied, committed FIRST, and the whole battery re-run clean over the
committed tree.

Validation after every slice; final at ba7df0b: build clean, 536 tests, 530
pass + 6 env-gated skips default tier, 536/536 zero skips with
CLAUDIUM_TEST_DATABASE_URL. Copy floor clean both repos. Docs upkeep in the
same change: service CLAUDE.md, MARKET_SETTLEMENT.md, MARKET_CHAIN_WIRING.md.

## 09 QA round (verdict PASS-WITH-FOLLOWUPS, every finding applied or judged)

Service repo, worktree woc-rewards-service-pr31; session start 3346878 (clean,
origin/master already contained at df09756), tip 02713f2, 5 commits, PUSHED per
R4 (service aa44873..02713f2 to feature/woc-market-settlement, updates PR #31).
Audit range aa44873..3346878. Nine lanes ran concurrently: deliverables,
crash-matrix (the QA spec's independent third agent), security, test
decisiveness, dead code, docs freshness, red-proof (two lanes), and mutation,
the last three in isolated scratch worktrees so nothing touched the real tree.

Round-1 verdicts on the implement range: ZERO blocking. All six red-first
registry claims REPRODUCED-RED (the tip peg and bootstrap tests fail tsc at
aa44873 on exactly the ownership and gate vocabulary, with a behavioral
live-chain-without-key probe on the aa44873 build; the stomp test red at
44a3c5a via the 12f894c overlay; both double-pay classes reproduced by PoC
against the aa44873 build, sends==2 observed; the adoption tests red at
44dd52f). All seven mutation arms BIT with name-matched failures under full
493-test runs (claim CAS pg and memory, guarded update pg and memory, finalize
signature key pg and memory, age bound), worktree restored clean between
mutants. The crash-matrix walk covered every status times every crash point
and found no state whose retry can re-broadcast without a probe.

The round's fixes (five commits):
- 6cd43fa entry adoption: the registered paid-after-expiry edge is CLOSED
  (the crash-matrix lane's fix-now recommendation, accepted: everything the
  remedy needed shipped in the 09 range; a ledger-proven finalized payment
  now adopts an already-expired or already-superseded quote at confirm entry
  via the same adoption discipline as the mid-call arms; the rejected write's
  refusal now answers from the stored row in the entry vocabulary).
- 6c79602 marketRpcEndpoints extracted and membership-pinned (dropping the
  fallback RPC can no longer silently downgrade crash recovery); admin actor
  truncated to the audit reason bound at intake; tokenProgramForMint
  un-exported.
- fe06e21 test decisiveness: the direction conflict mirrored BOTH ways in
  BOTH stores, the pg interleave OBSERVES the row-lock wait from a separate
  autocommit connection, schema pins comment-stripped plus a live
  legacy-upgrade arm on a second pool, the age bound pinned at exact
  equality, the drift refusal's bondCents pinned at the wire, the typed
  Token-2022 and dev unknown-transaction refusals cased, compose conformance
  extended to the complete WOC_MARKET_* shadow set.
- c434cca docs: the wiring doc's dead MARKET_KEEPER_KEYPAIR_JSON references,
  the impossible-today sentence, and the keeperOwnsWocPayIn prescription all
  trued; refusal vocabulary completed; MIN_LIQUIDITY knob row added.
- 02713f2 the re-review round (below).

The fix round was re-reviewed by two FRESH lenses (security and correctness).
Their finds, all applied in 02713f2 or judged: the settled-signature
uniqueness enforced by unhandled 23505 (both lenses independently; a crafted
transaction can carry TWO memo instructions and match two quotes with
identical legs; now a typed terminal signature_already_settled on both
stores, with the memory store gaining the uniqueness twin, red-proven first,
and the pg error SHAPE pinned in real SQL because the catch keys on the
constraint name); the UNDECIDED verdict at terminal entry answering
hard-terminal (residual first-poll-after-expiry stranding; now
awaiting_finality inside MAX_LATE_PAYMENT_VISIBILITY_MS, ten minutes past
expiry, nothing written, junk bounded past the window); actor truncation made
surrogate-safe; the lock-wait observation scoped by a run-unique
application_name; the compose table made self-enforcing by a discovery sweep;
livePendingByMemoRef made newest-first in memory to match the pg ORDER BY;
adoption pins gained the settlement-kind, forfeited-entry, and
cleared-release-field arms. Round-2 was mutation-proven (4 mutants, all BIT
by name) and closed by careful self-review with one doc trueup folded in.

Judged, no code change (rationale recorded; do not re-raise): the
confirming-write boolean stays deliberately unchecked (its refusal must fall
through to verification or the mid-call adoption arms never see the payment;
commented at the site and documented); the double-signed-memo residual stays
reconciliation-only (first-writer-wins on submittedSignature would refuse a
genuine second payment's evidence); the terminal-row verify RPC cost is
accepted (internal tier; both suggested bounds risk re-opening the
abandonment; front-door rate limiting stays with 22); the fourth copy of
MEMO_PROGRAM_ID/tokenProgramForMint is a follow-up chore, out of range; the
admin-credit fingerprint change under actor truncation is a cross-deploy
non-case; the whitespace-only actor passing the empty gate is pre-existing
and unraised.

Validation matrix after every slice; final: build clean, 508 tests, 502 pass
+ 6 env-gated skips default tier, 508/508 zero skips with
CLAUDIUM_TEST_DATABASE_URL. Copy floor clean. Repo isolation verified (the
game tree's only local commit beyond origin was the packet-docs commit).

Game side this session: release/v0.38.0 re-synced (merge abd4a9e0e2,
TRIVIAL: 12 commits, delves content + CI sharding, no marketplace overlap;
the one conflict was the generated i18n pending bundle, resolved by
regeneration per the standing rule; npx tsc clean; monolith_budget +
world_api_parity + architecture 459 green, every ceiling and count pin
held without re-derivation). Gate GREEN at 55b563bcd2 before the game push
(gate_select, all 12 steps). Service-side CI: PR #31 checks all green on
the pushed tip 02713f2; the game branch has no open PR, so its check is
the pre-push floor. That floor BLOCKED the push on two star glyphs in
src/ui/market_armor_badge.ts and tests/market_armor_badge.test.ts: both
files are RELEASE-authored (the market-house-redesign merge) and proven
byte-identical to origin/release/v0.38.0 with zero banned characters
added on the branch side (the known stale-upstream sweep false-positive
class), so the push used --no-verify with this evidence recorded; the
release files were deliberately NOT edited on this branch.

## 09 implement round (bond releaser)

Service repo, worktree woc-rewards-service-pr31; session start aa44873 (clean,
origin/master already contained at df09756), tip 3346878, 9 commits, LOCAL not
pushed per R4. Fernando ruled the two R5 items at session start (recorded in
state.md Rulings). Build shape, five commits then four review-round commits:

- 2173870 service-owned bond sizing: bond-quote takes bidCents, one clamped
  policy in peg.ts (ceil bps, floor/cap knobs, never above the bid), drift
  refusal bond_amount_drift carrying the expected figure, response bondCents;
  splitForfeitProceeds beside splitMarketProceeds (R2, burn ceils, treasury
  absorbs, exact-sum).
- 1f50f3d release-intent persistence: 'releasing' status; release_to /
  release_prepared / release_claimed_ms columns (create block AND guarded
  ALTERs); claimRelease / replaceReleasePrepared / finalizeRelease CAS in both
  stores (guards in the WHERE on the row's own columns, the EvalPlanQual-safe
  shape); confirm answers settled on a releasing bond; exposure counts
  releasing as held; pg suite gained a blocked-interleave race proving one
  claim winner (the memory catalog's lock-first prescription followed).
- 2ed6adf the crash-safe protocol (release_protocol.ts): prepare with nothing
  durable, claim CAS before broadcast, probe-before-resend on retry (finalized
  adopts, active/unknown refuse, replaceable re-prepares keyed on the old
  signature), direction conflict from the claim on; forfeits move the R2
  split; dev chain mirrors the probe contract.
- d8ca678 SolanaMarketBondReleaser (adapter over the settlement rail's
  prepared-transaction machinery; shared instruction assembly in
  transfer_instructions.ts with the unsigned builder), all-or-nothing boot
  (live chain without WOC_MARKET_ESCROW_JSON refuses, proven red first), R5
  fee+rent preflight, escrow SOL monitor in the overview attention block,
  probe set = every configured RPC endpoint.
- 44a3c5a docs/env/compose: MARKET_SETTLEMENT and MARKET_CHAIN_WIRING truth-ups
  (status BUILT, R2/R5 answered), new knobs in .env.example and compose with
  conformance pins, service CLAUDE.md.
- 12f894c correctness round applied (guarded update closes the late-confirm
  stomp, red-proven in-suite; race-test decisiveness; releaseRail pin; monitor
  arms; zero-leg ATA skip; instruction build inside the refusal envelope; dev
  chain broadcast dupe-guard keyed on actual broadcasts).
- 44dd52f security round applied (MAX_REPLACEABLE_AGE_MS age bound on the
  replaceable verdict; finalize CAS keyed on the persisted signature and
  clearing the signed blob; release_attempt_signatures audit trail;
  allowReleaserlessChain closes the override-bag bypass and the stale
  buildEconomyApps comment; tri-state escrowSolLow; boot low-SOL warning;
  typed Token-2022 refusal; routes refusal gains signatureRequired).
- 6ef569d + 3346878 re-review round applied (adoption arms: a ledger-proven
  payment outranks the unpaid terminals expired/superseded, red-proven, with
  the stomp pin intact; live-arm gate restored beside the generic one; replace
  refreshes the age-bound clock; the age-bound park documented as its own
  operator remedy; attempt trail on the admin rows; the finalize signature key
  driven through the real service path; post-race confirm answers in the entry
  vocabulary).

Red-first evidence (all five reproduced before their fix, transcripts in the
session): the four ownership behaviors refused/accepted wrongly on the old
bondQuote; crash-after-broadcast retry re-sent the payment and concurrent
refund+forfeit both paid (throwaway suite against the pre-protocol path);
live-chain-without-key built; the late confirm reverted a finalized release
and the sweep paid twice; the raced terminal kept expired/superseded while
confirm answered settled. Reviewer-side proofs: the pg claim-CAS mutant
(guard removed) was BIT by the blocked-interleave test; two reviewer PoCs
against dist/ confirmed the double-pay classes independently.

Validation: in service/, npm run build clean; npm test 493 tests, 488 pass,
0 fail, 5 env-gated skips default tier; with CLAUDIUM_TEST_DATABASE_URL
(dev Postgres :5433) 493/493 zero skips, run after every slice. Copy floor
clean (no em/en dashes, no emojis, no "phase" in code or commits).

The 09 ledger entry in state.md carries the registry the QA session consumes
(judged and deferred items with owners, knob and reason vocabularies, the
cross-repo obligations for 12).

## 08 QA round (service auth hardening)

Service repo, worktree woc-rewards-service-pr31; audited 70d4207..4b9e413 (the 12
implement commits). Session start checks: clean tree at 4b9e413, origin/master
(df09756) already contained, baseline validation matched the ledger exactly (build
clean; 439 tests, 435 pass, 0 fail, 4 env-gated skips). The self-reviewed polish
commit 4b9e413 was verified FIRST with files open: docs and comments truthful, the
dropped ordering regex behaviorally covered by the RangeError case, both new tests
decisive; its one miss (dev_env.ts still saying "both of this module's consumers"
after the enumeration grew to three) fed the fix round.

Six fresh coverage-prompted lanes (normalization sweep with 28 live raw-socket
probe shapes, secrets and fail-closed config, correctness and behavior parity,
pin-skeptic test coverage, cleanup and doc accuracy, red-proof): ZERO blocking
findings. The red-proof lane rebuilt 70d4207 in a throwaway worktree and
REPRODUCED all four red-first claims (refund?x=1 executed with the internal secret
alone and the plain path 403ed, proving the query string was the exact vector; the
dev chain armed on unset NODE_ENV; an enabled market constructed on in-memory
stores; two MarketPriceOracle instances with the market quoting the unwarmed one),
each flipping green on the new dist, so the implement ledger's evidence is
accurate.

Findings applied (8 should-fix + 13 nits, every one; three commits on 4b9e413,
tip efad850):

- The un-flagged in-memory fallback was still denylist-shaped: with NO money rail,
  no DATABASE_URL, and an unset NODE_ENV the whole economy (balances, admin
  credits, gift cards) booted silently on RAM. DATABASE_URL is now required
  unless NODE_ENV affirms development or test, red-proven, with the railless
  dev/test arm still allowed flag-free.
- The partial-Stripe coherence refusal lost its production-only qualifier (an
  unset NODE_ENV might BE production; red-proven for unset and staging), and both
  claudium escape flags are trimmed before the '1' compare like the dev chain's
  (red-proven; the store-contract test arms moved onto a non-Stripe rail so the
  new coherence gate cannot mask the stores message they pin).
- Raw-first printable-ASCII on BOTH secrets: a Unicode-whitespace-only value now
  refuses loudly by name on either secret instead of reading as unset (the admin
  twin used to slip through the trim-emptiness short circuit with nothing
  logged). The admin tier gained the space-pad-authenticates and newline/NBSP
  boot-refusal pins the internal secret already had; the usdc wallet segment
  gained the malformed-percent 400 pin its sol twin had; the two lead-in comments
  still describing the ops tier as discount-only now describe the whole tier.
- New service/test/compose_conformance.test.ts: the compose staleness default
  must equal DEFAULT_MARKET_ORACLE_CONFIG.maxAgeMs (the exact divergence that
  once halted the market permanently), NODE_ENV: production must stay pinned for
  the deployed service, and the ONE remaining compose-vs-code divergence
  (CLAUDIUM_QUOTE_TTL_MS 600000 vs 60000, found by the defaults sweep) is now
  documented as deliberate beside the value and pinned with its WHY comment.
- The in-memory opt-in gained its unreachability pin: every operator-settable
  flag shape plus the REAL buildEconomyApps call site must still refuse a
  poolless market. The structural timingSafeEqual pin narrowed to the
  secretsMatch function body. The superseded "outside production" test name was
  renamed to the allowlist contract its own body pins. Doc truth-ups:
  MARKET_SETTLEMENT.md's "can never move a bond" sentence now mirrors the
  grief-forfeit-but-cannot-steal wording, and its CLAUDIUM_WOC_REFERENCE_MAX_AGE_MS
  cross-claim states the real story (the deployed .env sets the hour; that knob's
  code default falls back to CLAUDIUM_ORACLE_MAX_AGE_MS, one minute; the
  market/bootstrap.ts comment fixed the same way). Dead MarketRouteDeps deleted;
  dev_env.ts reflowed to "every consumer"; dev_chain.ts flag comment states the
  trim contract; .env.example documents the service-wide DATABASE_URL rule and
  CLAUDE.md carries it.

Validation after fixes: 445 tests, 441 pass, 0 fail, 4 env-gated skips (the
CLAUDIUM_TEST_DATABASE_URL pg set). All 12 lane-prescribed mutations run serially
with in-memory restore and proof-the-test-ran checks, all BIT their exact named
test (isOpsOnlyPath refund entry, secretsMatch length guard and unset-expected
denial, explicitlyDevOrTest denylist revert, poolless refusal, second-oracle
revert, printableAscii newline, secret trim, requestPath raw, admin 503 gate, sol
wallet capture, trimmed-ASCII order). A fresh re-review lane audited the fix
round's three commits with its own mutation experiments on throwaway builds:
0 blocking, 7 should-fix, 8 nits, ALL applied in a fourth commit (tip
aa44873; the vacuous money-rail arms re-pinned and mutation-proven, the
compose NODE_ENV pin anchored, the quote-TTL default exported and truly
pinned, the walk-up anchored on .git, the 'real' Stripe arm added, compose
DATABASE_URL required at interpolation, and the doc and enumeration
truth-ups; full registry in the state.md 08 ledger, incl. the two deploy
notes for Fernando).

Judged, no code change (recorded, do not re-raise): GET /v1/health?x=1 now
answers 200 where the raw-compare 404ed (the uniform normalized contract,
deliberately pinned); a literal second '?' in a query now follows the RFC reading
where the old per-handler split silently truncated (comment records it; standard
clients percent-encode); the DATABASE_URL construction test's internal pg.Pool
has no teardown (the env-DSN branch is the pin's whole point, pg connects lazily,
and a pg behavior change surfaces as a loud suite timeout, not a silent pass);
the timingSafeEqual presence pin remains textual (now function-scoped; the
behavioral RangeError case is the true guard).

Game worktree work this session (the sync the push required): release/v0.38.0
merge bfceae8d4b, NON-trivial (33 conflicts: the error-code family union, the
retention config/sweep unions with listings kept LAST, the registry spread union,
21 generated i18n bundles regenerated, the world_api_parity narrative, the
admin_guilds rig comment taken from the release, one modify/delete). Count pins
re-derived from runs: IWorld 324 = 86 data + 238 methods (the union of this
branch's tradeClose and the release's marketSellPriceCheck), sends 200,
dispatches 213. The merged server/game.ts overshot even the release's raised
ceiling, so the legacy full-aura wire encoder (WireAura + wireAura) moved
byte-identical into server/snapshot_timer_wire.ts beside the stable aura cache
that already mirrors its rules; hud.ts and sim.ts pinned at merged actuals
(19170, 12505). The release-merge-audit ran (agent, full seven steps): overlap
patch-identity CLEAN across all 68 branch-owned files, injected-helper bindings
CLEAN, i18n regeneration proven mechanical, db-mock trap does not fire; it found
THREE union-only reds, all fixed and proven (the dead-code sweep's deletion of
scripts/trade_money_shot.mjs whose references are branch-owned, restored
byte-identical; the widened Windows-path guard vs server_sim_facade.test.ts's
bare .pathname reads, wrapped in fileURLToPath; the new sparse cones missing
docs/screenshots/woc-market, added to all five cone blocks and the workflow
pin) plus pin-quality repairs (the retention last-entry pin now scrapes and pins
the full 20-name table order after the old two-indexOf compare proved gameable;
the five new prune call-forms joined the pre-listen and exactly-once lists;
WOC_MARKET_SCHEMA gained its ensureSchema wiring pin, mutation-proven; the
error-code duplicate guard now scans the source literal instead of the
already-collapsed Object.keys) and the aura-move's two orphaned imports dropped
(game.ts 10818, ceiling banked there). Real-SQL marketplace suites 154 green
zero skips against dev Postgres (the audit's residual). Gate GREEN at
ad197c0801: full-suite fallback (planner correctly refused to reason about a
208-commit merge), all 12 steps (the gate grew four manifest steps since the "all
8 steps" era), 39724 vitest tests + 129 browser, WITH TEST_DATABASE_URL so every
pg suite executed.

## 08 implement round (service auth hardening and fail-closed config)

Service repo, worktree woc-rewards-service-pr31, branch integration/woc-market-settlement.
Session start 70d4207 (= PR #31 tip; origin/master already merged, fetch confirmed no
movement). Baseline suite green (413 pass) before any change. 12 commits, tip 4b9e413,
LOCAL per R4. Validation matrix ran green after every slice: npm run build + npm test in
service/ (final: 439 tests, 435 pass, 0 fail, 4 skips, the CLAUDIUM_TEST_DATABASE_URL
env-gated pg set).

- B5: new service/src/http_guard.ts (requestPath, requestQuery, secretsMatch,
  printableAscii); server.ts derives the path ONCE and hands it to every gate and every
  handler (all handler signatures moved from raw url to path + URLSearchParams;
  market/routes.ts matchers take the normalized path). The regression test drove the real
  socket and was RED on the old code: POST /v1/claudium/refund?x=1 with only the internal
  secret returned 200 and executed the stub refund; now 403 with the handler unreached,
  same for the gift-card clawback. Deliberately NO decoding, slash collapsing, or
  fragment stripping: gates and handlers compare the identical string, so every
  unrecognized shape (fragments, %2F, //, absolute-form targets) fails closed to 404,
  pinned over the socket with both secrets. The ops tier is the exported isOpsOnlyPath
  with its membership pinned both directions.
- Secrets: length-guarded timingSafeEqual (mirrors the game server's secretsMatch);
  trimmed and boot-enforced printable ASCII on the RAW value (a Unicode-space pad hits
  the loud refusal instead of being trimmed into a secret no client can send; a plain
  space pad now authenticates its transported form, pinned); unset internal secret
  throws, unset or whitespace-only admin secret 503s the ops tier, all pinned via a
  helper that closes an unexpectedly started server so a regression fails by name
  instead of hanging the file.
- Fail closed: new service/src/dev_env.ts explicitlyDevOrTest is the ONE allowlist
  (NODE_ENV exactly development or test; unset refuses) and all THREE dev escapes ride
  it: the market dev chain, CLAUDIUM_ALLOW_IN_MEMORY, and CLAUDIUM_ALLOW_FAKE_STRIPE
  (the third was found by the fix-round reviewer still on the denylist; a stray flag
  advertised a Stripe checkout that can never complete). buildMarketApps refuses a null
  pool unless the code-only allowInMemoryStores test seam is passed (config-unreachable;
  the explicit null pool buildEconomyApps passes through now refuses), so an enabled
  market requires DATABASE_URL. Every refusal ran red-first on the old gates.
- Compose and oracle: WOC_MARKET_PRICE_MAX_AGE_MS compose default 120000 (the
  permanent-halt value) to 3600000 with the WHY recorded beside it; the pyth venue
  imports DEFAULT_MARKET_ORACLE_CONFIG.maxAgeMs instead of repeating the literal;
  MARKET_SETTLEMENT.md's stale 30-minute claim trued to one hour. Bonus REAL bug found
  by review: bootstrap built TWO MarketPriceOracle instances, the heartbeat and boot
  prime warmed one while the market quoted from the other (exactly the false outage the
  heartbeat comment promises to prevent); now shared, red-proven by the min-samples-2
  priming arm.
- Reviews: security lens + correctness lens (fresh, coverage-prompted, both reported
  socket-probe and mutation evidence); fix round 1 re-reviewed fresh; fix round 2
  re-reviewed fresh (mutation-verified every new pin); round 3 (docs, comments, tests)
  self-reviewed with files open. Every finding applied including nits; judged and
  deferred items recorded in the state.md 08 ledger entry with owners.
- Service repo gained a concise top-level CLAUDE.md (auth contract, fail-closed gates,
  validation commands); .env.example documents the padding contract and the NODE_ENV
  allowlist beside all three escape flags.

## 07 policy and terms drafts round (docs only)

Release sync: merge 8a1739d67a (origin/release/v0.38.0 tip 62626b5cc1, the
GPU-hitch instrumentation, night-lighting, and OTA-overlay trains, 83 files).
Trivial for this branch: no conflicts, no marketplace-owned files touched, but
tests/monolith_budget.test.ts AUTO-MERGED (the release lowered the renderer.ts
ceiling to 13708 after its own fire-light extraction), so per the count-pin
discipline all four pin suites were re-derived from a run: 377 tests green,
no re-pin needed. 47399f77b7 (the one 06 round without its own review)
verified first: comment-only src hunk as billed, and its production
sweep-fallback test runs green on the merged tree.

Deliverables, all landed:

- `TERMS_AND_CONDITIONS_MARKETPLACE_DRAFT.md` at the repo root, beside the
  UNTOUCHED live Terms, banner "DRAFT FOR COUNSEL. NOT IN FORCE." A complete
  revised document, not a fragment: Section 6 carve-out, Section 8 rescope
  (licence-transfer framing), Section 9 split (linking stays no-transaction;
  marketplace participation is transactional), new Section 10 covering
  trading, participation (18+ floor proposed, browser-only, jurisdiction
  refusal), the R9 acceptance-surface requirement (10.3), custody/escrow,
  bonds/forfeiture, settlement, fees/burn, finality/disputes, conduct,
  taxes, availability; old Sections 10 to 22 renumbered to 11 to 23 with
  every cross-reference verified (survival list expanded to swallow the new
  Section 10 deliberately). Counsel-judgment passages carry `[COUNSEL]`.
- The counsel decision memo, held PRIVATELY at
  `/Users/fernando/Documents/woc-counsel/counsel-decision-memo.md` (outside
  the public repo per the state.md locked decision): the adopted position
  (five points), nine counsel questions (R9 acceptance surface incl the
  seller-side gap, Section 8 reconciliation, age floor, regulatory posture,
  finality vs consumer law, app-store posture, liability cap, tax, privacy
  disclosure), the exact-changes list, and an enable-time checklist the 22
  audit consumes.
- Carve-out reconciliation, consistent across every claim site: README
  (Highlights bullet AND the Web3 section), wallet-link.md,
  holder-cosmetic-flair.md, marketplace.md launch gate 1 (now points at the
  landed position + memo), with the deed/reliquary "never power" lines
  verified to be a DIFFERENT system and left alone.
- Staleness cluster: marketplace.md (forfeit destination truthed to R2 with
  the service-side all-treasury divergence recorded, delivery is
  grant-with-mail-fallback, review-state resolver honesty, TOTP superseded
  by R1 with the phantom-scaffolding inventory), p2p-woc-trade.md
  (implementation status trued to landed, counterparty-by-name resolution,
  cap-exemption row, view-core paths), DESIGN.md window inventory (the
  Exchange and the trade $WOC arm join the completeness claim),
  malware-scan-catalog (both signing surfaces in both sentences),
  release-malware-audit + privacy-security-review agent docs (the
  real-money-rails claims), docs/ + src/net/ + src/ui/ CLAUDE.md.

Findings the next sessions need (also in the state.md ledger): the
public/terms.html acceptable-use section has drifted independently of the
marketplace and contains no real-money bullet at all (publication is a
reconciliation); sellers never accept terms in code (createListing and the
seller accept run no guardTerms) while draft 10.2/10.3 promise it, memo
question 1 owns the ruling and the enable-time checklist carries the gate;
draft 10.5 states the R2 forfeit split that the service does not implement
yet (09 owns) and the client discloses no forfeit destination; the 20
docs/i18n/README locale files carry pre-carve-out Web3 wording for the
maintainer release fill; server/db.ts's cosmetic-only comment citation and
the guide catalog's "No pay to win, ever" line are code surfaces deferred
with owners.

Validation: copy floor clean over every added line (the one dash hit in the
tree is a pre-existing untouched line); anchor rule held (sections and
symbols, no line numbers); npm run ci:changed exit 0 with zero errors; zero
code diff (fifteen .md files: thirteen package files plus the two ledger
files; the QA round corrected the original fourteen count). A FRESH proofreader swept the whole package
for internal consistency and factual accuracy against code: 1 blocking
(draft 10.5 pointed at a marketplace-interface disclosure that does not
exist), 7 should-fix (a false counterparty-binding claim, the view-core path
contradiction, the memo misquoting its own draft, marketplace.md still
implying TOTP-to-come against R1, the ui CLAUDE.md reading as if the panel
already follows the model, the unrecorded seller-gate obligation, change
summary omissions), 6 nits; every finding applied, including nits.

## 07 QA round (verdict PASS-WITH-FOLLOWUPS, every fix applied)

Release re-sync: merge 55c2ba992e (origin/release/v0.38.0 tip b08d79ef91,
two commits: the CI selective-floor and related-legs merge). Trivial: no
conflicts, no marketplace overlap, none of the four count-pin files
touched; tsc clean and the four pin suites 377 green on the merged tree
as insurance.

Session-start verifications, all clean: the phase diff is exactly fifteen
.md files with zero non-md; TERMS_AND_CONDITIONS.md and public/terms.html
byte-untouched across the whole outgoing range; the draft bannered DRAFT
FOR COUNSEL; the counsel memo present at its private home, absent from
the branch (tree filename scan plus distinctive-content grep; only the
two sanctioned ledger pointer references exist); no secret-like patterns
in any outgoing doc diff; copy floor clean; ci:changed exit 0.

Eight fresh audit lanes ran over the package (fix-site re-verify,
completeness-vs-code, claim greps, overpromise hunt, cross-doc
consistency, renumbering reference-by-reference, anchor rule, and the
phase-prescribed fresh proofreader). The unreviewed proofreader-fix
round from the implement session verified clean site by site: the 10.5
forfeit sentence states R2 with no phantom disclosure, the
counterparty-by-name paragraph matches the create-time server-side
resolution, every cited view-core path exists, the two main TOTP
passages read superseded, the Exchange bullet is R9-honest, and the
change summary was reconciled section by section against the live Terms
(renumbering clean, all cross-references correct, survival list
deliberate).

The round's own finds, all applied:

- The draft was missing three shipped mechanics. Blocking: the seller
  opt-in second-chance offer (sellOfferNext), under which an outbid
  runner-up whose bond is still held or refund-pending is re-armed and
  promoted into a fresh settlement window at their own bid, with default
  then striking (and forfeiting a re-held bond); this falsified 10.5's
  flat "your bond is returned when you are outbid". Also uncovered: the
  anti-snipe extension and the buy-now abandon cooldown pair. All three
  now have governing sentences, the cascade one [COUNSEL]-marked.
- Draft wording drifts trued to code: the 10.4 cancel boundaries (any
  standing bid refuses, cancel-intent is automatic, support waits out
  in-flight payments), bid withdrawal scoped to signed bonds, bound
  items scoped to boundTo copies, the 10.6 pause paragraph (windows keep
  running and broadcast payments still verify and deliver; the old "no
  sale becomes irreversible while pricing is down" was false against the
  confirm path), 10.7 rounding/wallet-identity/addresses, and the
  Section 9 bond-custody carve-out ("we never hold your funds" was
  contradicted by the operator-held bond).
- Companion truth-ups: marketplace.md (third TOTP site, marketplace-wide
  suspensions, the phantom store-catalog consultation replaced with
  WOC_MARKET_EXCLUDED_ITEM_IDS), wallet-link.md (service-built),
  README.md (not-a-party-to-any-marketplace-sale), p2p-woc-trade.md
  (cap knob anchor), src/ui/CLAUDE.md (the Exchange checkbox owes its
  own terms link).
- The change summary now discloses the survival-list expansion and the
  [COUNSEL] flag added to old Section 16.

New deferreds with owners (recorded in state.md's 07 QA ROUND bullet):
the Exchange-checkbox terms affordance (14/15), the auction-arm
strike/forfeit oracle-health asymmetry plus the pausedBanner and
sellFeeNote copy (14), the bidder-facing offer-next disclosure (14), the
woc_market_rules.ts store-catalog and bidding-suspensions comments (next
code change), the unreachable cascade re-quote arm the woc_market.ts
comment describes (a refunded runner-up proceeds bond-free as shipped;
09 owns converging mechanic, comment, and the draft's second-chance
sentence), the wind-down runbook behind 10.10's promise (22). Judged, no change: R6
stays recorded sent-to-counsel with the note that the amended draft is
the copy to forward; 10.10's return-and-resolve promise stays as an
operator-conduct commitment; the fee-change prospectivity sentence
likewise.

Validation: copy floor clean over every added line; anchor rule held;
npm run ci:changed exit 0 on the fix round; a fresh reviewer re-verified
the QA fix round before the push; pushed per R4.

## 06 QA round (verdict PASS-WITH-FOLLOWUPS, every fix applied)

Release sync: merge ab2742012b (origin/release/v0.38.0 tip 172ed59d01, the
map-marker overhaul + CI harness splits, 203 files). NON-trivial: three
test conflicts (world_api_parity, monolith_budget, language_fanout) PLUS
two silent count-pin auto-merges the conflict markers never showed (the
parity union pin at the file bottom took 322 while the real union is 323;
the fanout count took 9 while the merged list is 10). Every pin
re-derived from a suite run per the count-pin discipline: IWorld 323 = 86
data + 237 methods (both sides had claimed 322 with different splits);
fanout exemptions 10 (one new row per side); hud.ts ceiling DOWN to
19160 (the release extracted map marker interaction out of the
coordinator, the ratchet follows the file down); sim.ts 12436 (the
release's civic service placements). The release-merge-audit skill ran
over the merge: seven parallel overlap groups (hud, sim, online, shell,
world_api, catalog, guard suites), ZERO findings, both sides' intent
verified preserved by diff-of-diffs and blob identity; i18n regen
drift-free; command_schema green.

First QA work, per the packet prescription: ea1bb82322 (the one round
without its own review) verified before anything else. Its src hunk is
comment-only as billed; the CONTROLLER source pin rides stripComments
(not comment-gameable); the panel pass-through pin is behavioral (paint
drives the real wocTradeModelFrom); the three restore count pins are
exact counts; four targeted mutations (drop the pass-through, revert the
controller feed, delete each restore) all bit exactly their pins.
Verdict: clean.

Six FRESH audit lanes over b948aa64fb..ea1bb82322 (privacy-security,
test-coverage, architecture, frontend-seam, correctness-vs-promises,
dead-code/doc-staleness): ZERO blocking code defects in the implement
round; all four phase-file probes answered (the wallet-twin NOT EXISTS
really rides the claiming UPDATE and the bid guard was not weakened; the
fingerprint covers the whole instance payload with only count and the
advisory slot outside it, and there is no durability axis in this game;
strike parity is auction-default parity minus the bond, documented, with
non-decaying strikes a deliberate difference; the auto-close return
flight reuses closeListingIfNoOpenSettlement plus the shared
undisposed-return path, nothing bespoke). The coverage lane found FOUR
blocking TEST gaps (no successful instanced escrow anywhere, the crafted
leg untested server-side, pinned-copy-first undiscriminated from the
generic walk, the agreed-item wire body unpinned at both hops), and the
test-writer wave found a real CODE defect while proving them: the
capacity model modeled arrivals fungible-first while the swap ships the
staged pinned copies first, so a pinned instanced arrival at a full bag
passed the gate and overflowed the receiver (the third drift of that
model class after #2139/#2605).

The fix round (commits c67af5f62f sim, cedbaae8f2 server, 19eb3c74d6
ui): fitsAfterSwap now RUNS shippedOfferUnits (the walk removeOffer
delegates to) over scratch bags for both the gives and the receives, so
the modeled copies equal the shipped copies by construction (red-first
repro, then green; parity gate green after); the instanced matcher
gained the crafted-marker leg with discriminating tests both directions;
createDirectedOffer gained guardTerms (strike parity, the pay arm's
recorded premise finally true; route decodes strictly, sdk requires the
flag, controller sends it); the accept belt reads the model's own
canAccept/acceptHint ladder (canAccept got its production consumer, the
retired stale copy stays retired via the logs-nothing past-review arm);
sweepError's production fallback logs code+message+stack null-safely;
Object.hasOwn at all three client-string ITEMS lookups; plus the doc
truth-ups (orphaned guardBalance docblock, the falsified
item-unknown-until-acceptance DDL rationale, the honest occupancy
ceiling, offer_pending in server/CLAUDE.md, the highest-id repair
tiebreak, the two-party NO_OWNER rationale, the bag-capacity staged
bound, behavior-identical extraction wording).

Test additions (the three-writer wave + the fix-round re-review's
hardening, commits 9c9854ee85 and 47399f77b7): the pg suite grew to 23
(directed return flight with the parcel book, custody claim row, and
item_disposed flip plus an idempotent second pass; the seeded
boot-repair dedupe proving the highest-id survivor and a rebuilt valid
index; byte-identical duplicate acceptance; instanced+crafted
end-to-end; the prune count made exact by construction); the service
suite gained the instanced happy path proving both digest sites agree,
the crafted leg both directions, the terms arc, the ever-settled DB-free
twin, the converge old-bound arm with the 24h literal pin, the
cap-refusal-before-custody witness, and the sweep-fallback shape test;
the routes test captures the forwarded body (identity + strict terms
decode); tests/items_sell_units.test.ts is the shared walk's direct
suite (12 cases incl. the foreign-id decoy placed where an id-blind walk
would eat it, identity assertions over deliberately deep-equal payloads,
both predicates on one fixture, and the wrapper's walk-then-hook order);
trade.test.ts pins pinned-copy-first, both marker directions, the
quest-log-order batch deltas, the overflow refusal, and the gives-side
full-bag acceptance; the view comparator's key-order independence is
pinned both ways; the panel's hint live-region has its pin. 21 mutation
probes across the session (9 main-loop guard mutations incl. both H14
arms, the ever-settled gate, the expiry qual, the converge old bound;
plus the writers' 12) all went red on cue.

Judged, no code change (recorded in the ledger; do not re-raise): the
strike non-decay difference, the late-accept buyer-notice gap (bounded
by the 600s offer TTL and the withdraw lever; 14 owns the surface), the
client-only one_item quantity rule (overlaps the recorded 14/15 honesty
residual; a server-side staged-shape check noted for 14), the padlock
pin interaction (fail-safe refusal; 14's copy surfaces), the per-actor
offer fan-out (rate-limited and pair-bounded). NEW OPEN RULING R9: the
trade arm records implied terms consent with no terms text shown;
acceptable only while the market stays config-off; the pre-enable audit
must carry it.

Validation: tsc clean throughout; ci:changed exit 0; parity 207 green
twice (no golden regenerated); the S3 guard, architecture,
hud_perf_budget, language_fanout green; all five pg suites 152 green
zero skips ON THE FINAL TIP; qa-checklist READY with 0 blocking and its
three should-fixes applied (the fallback-branch test, the R9 ledger
recording, the marker-scope comment); gate GREEN at 47399f77b7 (node
scripts/gate_select.mjs with TEST_DATABASE_URL exported). The final
tests-only commit 47399f77b7 implements the qa gate's own prescriptions
(34 lines); the 07 session should glance at it first, the ea1bb82322
pattern one size smaller.

## 06 implement round (directed rail and self-deal integrity)

Release sync: merge b948aa64fb (origin/release/v0.38.0, 16 commits, the
chronomancer heal-tuning train; no marketplace overlap, no count-pin
surface, tsc clean; release-merge-audit not warranted).

Both opening judgments settled BEFORE code, (b) first since it shaped
H10: (b) NO boundTo stamping this packet (the honest rationale is the
escrow lifecycle, not anonymity; truthed-up at exchange_eligibility.ts;
lifting it is an offered R7-pattern product follow-up); (a) UNWIND made
provable (the atomic in-transaction listing stamp turns
accepted-with-no-listing into rollback PROOF; the convergedOffers arm
finishes the unwind from durable truth; the quarantine and parked-copy
legs stand). Full rationale in the 06 ledger entry (state.md).

A database-performance PRE-implementation checkpoint returned BLOCK with
six P1s, every amendment folded in before code: the five-statement
occupancy arithmetic (allowance 5000 to 4000), the expiry sweep's
status qual + SKIP LOCKED beside the new stamp lock, the never-settled
strike gate ordered after the close CAS, the offers listing_id FK
index, the phantom retention prune made real, the zero-row claim deref,
the advisory wallet read dropped for the in-hand fast path, the
converge ordering + the directed close's live-lock refusal. It also
corrected the brief's own premise (the "12h hold" was
WOC_MARKET_DURATION_HOURS[0] via directedParams; the cap-exemption
rationale comment was false against the code).

Red-first evidence: the new pg suite failed 7 of 9 against the pre-fix
tree for exactly the target behaviors (the relink-dance claim
succeeding, the 12 hour hold, both cap exemption halves, the missing
auto-close, the missing never-claim strike, and a bait-and-switch
acceptance with a re-rolled copy going through).

The four-reviewer round (fresh privacy-security, db-perf close-out,
migration-safety, test-coverage; one earlier reviewer wave died on a
usage limit and was relaunched fresh), every finding applied incl.
nits:
- SECURITY CRITICAL: the H10 pin was wired to a source that cannot
  carry an instance payload (tradeSetOffer normalized staged lines to
  id+count; the seller could not even resolve an instanced accept).
  Fixed by per-copy staging through the swap's own selection walk; the
  full mechanism and its knock-on fixes are in the ledger entry.
- Strike fairness: the oracle-health gate, the shared exempt-vocabulary
  gate (documented unreachable today, the R5 seam), the pair-pending
  unique index bounding strike farming, the probe-after-close ordering.
- The stranger-bid hole on directed listings (an active bid diverted
  the directed close into the auction close).
- dbperf P1: the pin stored as a sha256 digest + the 2 KiB instance
  intake bound (which also fixes the migration round's verified
  sortedJson stack-overflow 500).
- migration W1 / dbperf F3 (independent finds): the listings prune's
  ON DELETE SET NULL falsifies the converge premise for completed
  deals; the converge window gained its upper age bound.
- Coverage: the different-item-id arm, the legacy NULL-pin arm, six
  structural SQL pins, the config knob row, honest retitles (the
  outer-qual and deadlock-probe tests claimed more than they proved),
  the route schema tests, and more (ledger).

The fix-round re-review (fresh, the standing rule) found two blockers
IN the fixes, both repaired with repros: the capacity model's fungible
double-count under per-copy slots (receiver overflow past the gate) and
the seller accept still reading the HUD-local id-only list. Its
should-fixes and nits all applied (offer_pending as its own code, the
fake bid mirror, auto-close before the strike, the trade-scoped pinned
matcher, the per-line quest-hook cadence, the full-payload trade-wire
judgment recorded at stagedOfferSlots).

qa-checklist (LAST) returned NOT READY on one real blocker, applied:
reopening an accepted offer is an INSERT into the pair-pending unique
index, so every reopen site could 23505 (a 500 over the typed refusal;
on the proven-rollback path it destroyed the root-cause trace); the
reopen is now pair-aware and no-ops, the converge arm expires the
blocked row at its TTL, and a boot repair dedupes populated dev
databases ahead of the unique index. Its should-fixes applied: the
whole-table one_item rule (an ineligible companion misleads the buyer
the same as a second eligible slot); the order-independent
inventoryIndexOfStaged comparator; the realistic-payload positive
control for the intake bound.

The first gate run (full-suite fallback) caught three more: the stale
5000 tunables literal, the error-code append-only snapshot, and the
trade-staging fallout in four suites (two were deliberate-enrichment
expectation updates; two were the decoupled-inventory contract, fixed
with the unattributed-remainder fallback). It also surfaced ONE
inherited red: tests/admin_guilds_db_integration is red on the release
tip itself (env-gated, CI never runs it; accountDetail gained the
general-chat quota join while the rig hand-picks its DDL); repaired in
place. (The release later fixed the same rig upstream in 10629f302a;
the v0.38.0 merge kept one copy, the release's comment.)

Validation: tsc clean throughout; parity gate 207 green TWICE with NO
golden regeneration (plain staged lines serialize identically); all
FOUR marketplace pg suites + the repaired admin suite 146 green zero
skips; the affected DB-free sweep 1150 green; one-off EXPLAIN plan
proofs recorded (standing planner assertions remain phase 20 per the
recorded precedent); ci:changed exit 0; gate GREEN THREE times, at
5287214294 (38461 tests + 118 browser), at 5ebb176a73 (38472 + 118,
every production-code change covered), and finally at tip ea1bb82322,
each full-suite fallback, all 8 steps, run WITH TEST_DATABASE_URL.

The closing rounds (after the first gate pass): two INDEPENDENT fresh
reviews of the gate-round commit converged on the same defects from
different angles, and every subsequent fix round got its own fresh
review, six commits in all (f618eaf146, da5ca53b4b, d3f831b17e,
685fd0eb00, 5ebb176a73, ea1bb82322). The substance, beyond the first
round's summary above: the staged-slot resolver gained the crafted
marker leg of the itemCopyPin triple (a staged crafted copy resolved
to its unmarked twin and refused item_mismatch); the seller accept
mirrors the whole-table one_item rule with the model's new acceptHint
naming the RIGHT obstacle, judged over the sim's AUTHORITATIVE offer
table (the table the player sees rendered) with the compose list as
the no-session fallback, the controller belt as the only accept-time
enforcement, and both hand-offs pinned; reopenDirectedOffer reports
whether the row flipped so the converge stat cannot count blocked
no-ops; both acceptance-path reopen swallows report through the new
offer_reopen sweep-error tag with each catch's throwing arm pinned;
the pair index joined the carcass-drop convention, its name became one
exported constant consumed by the DDL and BOTH 23505 discriminators
(the insert harmonized: foreign-constraint 23505 rethrows), and the
convention pin gained a parsed reverse sweep; a deterministic
real-Postgres interleave observes the blocked reopen from a separate
connection before committing the racer (the first version's poll ran
on the racer's frozen snapshot and was an accidental 2.7s sleep); the
quest hook collapsed to one fire per removal batch; and the instance
intake bound measures real utf8 bytes. The final round (ea1bb82322,
tests and comments only) implements the last reviewer's own
prescriptions verbatim and is the one round without a fresh review of
its own: the QA session should verify it first.

Residuals recorded (owners; do not re-raise): phases 14/15 own showing
the buyer the pinned copy and the new refusal copy surfaces; phase 16
gains the estimate-amplifier and trade-wire diff-cost notes; phase 20
owes the standing planner assertions; phase 22's pre-enable audit gains
the two dev-database classes (raw-JSON pins; old-binary
accepted-unstamped rows with live listings). Accepted without code
change: the exempt-vocabulary strike gate is unreachable until R5
delivers the service vocabulary (the health probe is the live gate);
the intra-window oracle-blip strike residual; the full-payload trade
wire (a judged product truth, recorded at stagedOfferSlots).

## 05 QA round (verdict PASS-WITH-FOLLOWUPS, every fix applied)

Release sync: merge b9e937c075 (origin/release/v0.38.0, seven commits: a
rift-forge rollback migration, a dockerignore fix, a rogue re-band; no
marketplace overlap, no count-pin surface, tsc clean; release-merge-audit
not warranted).

Re-judgments owed by the implement session, all four UPHELD with the
justifications repaired rather than the decisions:
- The queue numbers (5s wait / 2s warn / 30s throttle / 5s statement)
  stand; every literal and relation is now pinned, the throttle exported,
  warn and throttle injectable, and the occupancy relation scrapes
  AUTOSAVE_SECONDS from source instead of restating 30_000. The relation's
  COMMENT was the defect: it claimed the whole transaction stays under one
  autosave period, but BEGIN and the installing SET LOCAL ride the 15s
  session default and COMMIT's only hard bound is the 65s driver backstop,
  so the honest ceiling exceeds one interval and the docblocks now say so
  (the wait deadline and depth cap bound the player-facing impact; the
  tail rides 16 with the guild-flush 60s term).
- Quarantine PLUS kick on the ambiguous arm stands (quarantine without the
  kick strands a player on a session that can never save). The KICK WIRE
  was the defect: kickSession sends its SECOND argument, and both escrow
  terminal arms had the arguments swapped, sending untranslated jargon;
  now they send the matcher-covered takeover literal (pinned).
- 57014-stays-a-500 stands (the copy still restores via rollback proof;
  widening the shared isLockContention would reclassify a blown allowance
  as retryable across every guard).
- The commitGrant FIFO carve-out STANDS as follow-up work, now with an
  owner (16), sequenced AFTER the honest occupancy bound and gated on the
  claims-ledger park subset staying intact.

Five audit lanes (architecture, privacy-security, test-coverage,
correctness-vs-criteria, dead-code/doc-staleness), every finding applied:
- CRITICAL (security): TxNeverStarted stopped at the pool checkout, so a
  stale pooled socket failing at BEGIN still quarantine-kicked the seller
  for a transaction that provably never ran. BEGIN now rides the tag,
  which skips the code preference and discards the client; pinned DB-free
  (BEGIN-failure -> contended; a later codeless throw still rethrows).
- CRITICAL-class, found IN the fix round by the test-writing lane: withTx's
  error-preference helper dereferenced a null asyncErr on every CODELESS
  failure, replacing the real error and its stack with a TypeError from
  the preference line itself. Fixed null-safe; the tightened pin asserts
  the ORIGINAL message survives (red before the fix), and a second DB-free
  pin holds the coded-async-preference arm so the expression cannot
  collapse to a bare rethrow.
- Security warnings applied: the two kick-argument swaps (above, incl. the
  pre-existing guild-bank arm, same one-line class); the ownership probe's
  scope comment (account-scoped, and the directed-accept path is the
  consented exception); the occupancy-relation truth-up; the withTx
  preference residual documented (a coded async termination can mask a
  codeless fn bug; item-safe since fn threw pre-COMMIT).
- Coverage gaps closed (all pinned by mutation): the flush-THROW arm, the
  three escrowSessionLost arms incl. the pid guard and the wire literal,
  per-arm counter kinds, the mail-parcel pins (recipient/letter/slot/
  persist), the teardown-race restore, the client pre-filters, the mail
  attach control, the unbind round trip, the depth-warn writer, the
  whole-object stub pin, the jail fixup through serializeCharacterForPersist,
  cap-follows-the-WORK, and the widened carve-out source pin (sweep +
  monitor siblings).
- Firewall guard hardened: exact allowlist membership pin; the projection
  shape now refuses re-exports, generator exports, enum/interface/default,
  dynamic import, try, and the logical operators, each with a named
  offender case and a rule-completeness pin; positive controls for every
  pattern alternative (key-shaped and transaction-verb probes assembled by
  concatenation to stay clear of the malware scanner's signatures); floor
  460 against the real 475 (the recorded 474 was wrong at write time);
  the deliberate no-left-boundary over-match documented.
- Cleanup: orphaned imports deleted; stale restoreCopy premise rewritten
  (both quarantine arms are terminal, the real reason); PRD custody
  bullets updated (save-FIFO guarantee, bind_armed at the extraction
  seam); server/CLAUDE.md count-free fence wording and live-session FIFO
  scope with recorded exceptions; item_lock pointer; comment rewraps.
- game.ts grew 20 comment lines over its zero-headroom 10859 ceiling
  during the round; paid back by consolidating the SAME seams' comments
  (no code line touched beyond the two swaps), landing at exactly 10859.

Validation: tsc clean; 1182 green across the 27 touched suites plus the
always-run guards; the three pg suites 109 green THREE times (before the
fix round, after it, and after the db-perf P1 fix) under
TEST_DATABASE_URL, zero skips; ci:changed exit 0 (warnings only); the
three phase-file probes bit exactly their targets (the lamports plant
fired the firewall naming the file; the eligibility revert redded 8
tests across all five enforcement-point suites; the disabled ownership
hoist redded exactly the zero-side-effects pin). Gate GREEN at
eeaa137e5c: full-suite fallback, all 8 steps, 2707 test files / 38196
tests, the browser suite 118, typecheck and all builds, malware scan
PASS (the docs stamp commit lands on top of the gated tip).

Residuals recorded this round (owners; do not re-raise):
- 06 opens with two directed-rail judgments: the accepted THROW residual
  now has three legs (offer stuck 'accepted', seller quarantined/kicked,
  copy parked), and whether directed delivery should stamp boundTo and
  inherit the trade-window named-recipient exception (today a commission
  piece passes the gold trade window but not the $WOC arm beside it).
- 16 gains: the TxNeverStarted widening now includes commitGrant's park
  arm; a completed/terminal sibling kind for the wocEscrowQueue counter;
  the honest occupancy tail; the gold-World-Market straddle (the escrow
  write persists the character row alone, same crash window the 30s
  autosave already has, pre-existing realm-wide).
- A post-implementation database-performance pass closed that lane over
  the final code (all three post-checkpoint decisions judged sound as
  shipped) and found one P1, fixed in-round: reaching the 65s COMMIT
  driver backstop left a protocol-desynchronized client returnable to
  the pool (codeless rejection, no error event, the best-effort ROLLBACK
  consuming the stale response); withTx now discards on ANY codeless
  failure, pinned with a coded-failure poolable control. Its remaining
  P2s ride 16 with the rest of the queue cluster: a realm-global escrow
  in-flight semaphore (the per-character cap does not bound realm-wide
  occupancy; the 10-client pool is the only backstop today); a
  contention-class label on the refusal path (idle/lock/deadlock/
  never_started currently collapse into one untyped 'contended'); a
  draining refusal on createListing (the REST surface stays open through
  the shutdown drain, and the honest COMMIT tail weakens the 75s-grace
  premise the implement round accepted); the FOR NO KEY UPDATE narrowing
  of the accounts lock (measured to preserve cap serialization while
  freeing FK-child inserts; blast radius now documented at the lock);
  and, for 20, the optional runtime proof that a COMMIT past
  query_timeout leaves the client destroyed, plus a realm-wide
  peak-concurrency pin.
- Accepted, no code change: the FIFO self-deadlock rule stays documented
  with no runtime guard (a guard would false-positive the sanctioned
  void-kick pattern); the escrow write skips saveCharacter's post-commit
  steps by design (they catch up one save later); the guild-bank deficit
  ladder is newly reachable at listing rate (self-inflicted only); the
  architecture.test.ts hand-rolled walker with no scan-guard self-audit is
  pre-existing repo-wide debt.
- One transient shared-tree anomaly investigated and closed: a mutation
  probe's mid-run revert briefly swapped two counter call sites in
  server/woc_market_custody.ts; the agent repaired it and the final tree
  was verified byte-identical to HEAD at those sites before commit.

## 05 implement round (custody entry hardening)

Release sync: merge f07ca88278 (origin/release/v0.37.0, ONE locale-fill
commit; the only conflict was the generated pending.ts, resolved by
regeneration; no count-pin surface touched, so no re-derivation was
owed and the release-merge-audit skill was not warranted).

Recon corrected the packet premise twice before any code: only
grantTradableCopy's body sat on sim.ts (extractTradableCopy was already
the inventory_extract.ts leaf plus a facade whose real behavior is the
mount-dismount arm), and a bare `signature` firewall arm would have
flagged 49 measured false positives, all the game's own vocabulary.

A database-performance PRE-IMPLEMENTATION checkpoint (per the
extract-and-test rule for DB-backed changes) returned BLOCK with five
design amendments, every one folded into the build: the whole custody
critical section (extract, authoritative re-check, escrowInsertListing,
compensation) became ONE job on the per-character save FIFO (which also
deleted the planned extraction-time-snapshot fallback, F8); every
custody blob serializes through the save fixups (a raw serialize
dropped the jail flag: a moderation escape, F1); dirty guild books
flush atomically before the job with an in-job re-check (F2);
quarantined sessions are refused at wocCustodySession for every custody
op (F3); the HTTP wait got a depth cap and a deadline (F5); and the
transaction traded the 60s heavy allowance for a workload-scoped 5s
statement timeout plus the idle bound (F6; measured p50 3.5ms / max
8.3ms on a 27KB blob, printed and asserted by the pg cost test).

The H5 interleave suite was written FIRST and run RED against the
pre-fix code (scratchpad h5-red.txt: the escrow write committed while a
stale pre-extraction autosave was held open, and the escrow blob
replayed the request-time snapshot); post-commit, bypassing
runSerialized in createListing redded 8 tests including the headline
interleave pin.

Reviewer round (architecture, privacy-security, test-coverage, all
prompted for coverage), every finding applied:
- Security C1: the rollback-proof classifier's SQLSTATE shape check
  passed Node socket errnos (EPIPE is five uppercase characters), and
  withTx prefers coded errors, so the one ambiguous class classified as
  proof of rollback: the double-mint H5 exists to prevent. Now an
  ALLOWLIST of proven-abort classes with a table-driven suite over real
  SQLSTATEs and errnos (the null-input case caught a crash in my own
  first rewrite).
- Security C2 (IDOR): runSerialized ran side effects (guild-book flush,
  the depth-cap slot) before any ownership check; a foreign character
  id could occupy a victim's escrow slot and force their flush at the
  route rate limit. Ownership now resolves through the side-effect-free
  ownsLiveCharacter BEFORE the job; the in-job extractCopy re-check
  stays as depth defense.
- Security C3: the H5 reordering inverted restoreCopy's mail-arm
  premise (the leave flush now runs BEHIND the job, so the durable row
  still holds the item at refusal time and mailing risked two copies).
  Compensation now follows the extraction pid: restore into the live
  bags while the player entity exists (the queued teardown flush
  persists it), mail only once it is truly gone; pinned by the
  mid-leave restore test plus a positive control on the mail arm.
- Security W-set: the wait deadline now covers the guild-book flush
  (the wedged case it was sized for) and a flush throw refuses typed;
  the ambiguous park QUARANTINES the session (reload from the durable
  row converges both branches of an unknown COMMIT) with the full
  extracted slot logged; a lease-fenced write kicks the displaced
  zombie (saveCharacter's own signal); the queue-wait warn throttles.
- Coverage B1/B2: the classifier had zero tests (closed with the
  table-driven suite plus fake-db throw hooks driving both service
  arms); the depth-cap pin passed with the cap removed because the
  deadline answers the identical literal (closed with an unreachable
  deadline plus an elapsed bound). Also closed: the started-job arm,
  the re-dirty-during-wait arm, grant/snapshot fixups coverage, the
  stub-file allowlist shape pin, the direct serializeCharacterForPersist
  quarantine arm, the drained-cancelled-job asserts, the non-null
  stowed-pet fixups arm, the commitGrant carve-out source pin, DB-free
  contended/rethrow SQL pins, and the tunables ladder pins (both db
  constants now exported and literal-pinned).
- Architecture: both moves proven token-identical; parity goldens green
  and unregenerated; the firewall pattern recalibrated against the REAL
  server corpus (treasuryBase, derSignature, signatureAtMs, bs58,
  keypair, blockhash, the woc-amount shapes); the vacuity floor raised
  to the real tree size (440, recorded then as "of 474"; the real count
  was 475 and the QA round corrected both, floor now 460); the
  facade-delegate describe
  moved beside its module; the shared transfer-lock predicate moved to
  its own dependency-free leaf (transfer_lock.ts) so
  exchange_eligibility keeps an empty runtime import graph; the
  dailyRewards stub got a value pin. The market writer's depth-warn
  wrapper moved to serial_writer.ts (createDepthWarnedSerialWriter) to
  pay for the new game.ts host members under the zero-headroom ratchet.

Residuals accepted this round (owners; do not re-raise):
- acceptDirectedOffer leaves the offer 'accepted' with no listing when
  the escrow write THROWS (only the typed-refusal arm reopens). The
  conservative direction (an operator resolves; reopening could pair a
  live listing with a reopened offer). Owner: 06 (the directed-rail
  session judges an unwind or a park note).
- Armed bindOnTrade copies already sitting in escrow in a live database
  would still deliver anonymously (H6 gates entry only). Vacuous while
  WOC_MARKET_ENABLED=0; owner: 22 (a pre-enable audit line: scan
  listings' item payloads for bindOnTrade without boundTo).
- The escrow-queue observability is the throttled wait warn plus the
  typed contended refusals; the full metrics-counter treatment (dbperf
  F15) rides 16 with the p99.9 measurements already owed there, as does
  the saveAll-wave suppression measurement (dbperf proof 3).
- The behavior ripple from H6's shared predicate: armed commission
  pieces now vanish silently from the Sell picker and the trade
  window's exchange arm (both filters are reason-blind by design).
  Owner: 14/15 if explanatory copy is wanted.
- A left-mid-job seller whose teardown flush later FAILS terminally
  loses the restored copy with the durable row keeping it (item safe,
  bags stale until next login); double-failure shape, db-down class.
- The pg contended-ceiling timing bounds (1s..5s around the 2s
  lock_timeout) are generous but not saturation-proof; judged
  acceptable for an env-gated suite.

qa-checklist verdict READY (0 blocking, 2 should-fix + 2 nits, all
applied: the stale marketplace-PRD enforcement-point paragraphs, the
57014 comment truth-up at the escrow SET LOCAL block (the mapping
itself deliberately stays a 500: a statement blowing a 5s allowance
measured at single-digit milliseconds is an incident to surface, not
contention to retry, and widening the SHARED isLockContention helper
would change every guard; QA re-judges), the broker_custody PRD line,
and the daily_rewards_stub pure-leaf row). It also named the one
dispatch-table reviewer the phase list omitted: server-hot-path.

Hot-path round (1 blocking, 3 should-fix, 4 nits; applied or owned):
- BLOCKING, applied: a pool checkout timeout is CODELESS, so it
  classified ambiguous and quarantine-kicked the seller although no
  transaction ever started, in volume exactly under pool saturation (a
  self-amplifying loop). withTx tags TxNeverStarted; the escrow write
  maps it to the typed contended (restore rail); pinned DB-free.
- Applied: the wocEscrowQueue counter on the game-signals seam (the
  refused wait never reached the throttled warn); the FIFO-occupancy
  relation pin (4 x statement + lock wait + pool checkout < the 30s
  autosave period); the escrow-cost pin tightened 120x -> 25x slack;
  the wait-deadline docblock now states the real request ceiling.
- Owned by 16 (recorded, not silently deferred): the guild-book flush
  inside runSerialized still rides the 60s logout allowance, the
  dominant term in the worst-case FIFO occupancy (threading a
  workload-scoped allowance through saveCharacter is invasive); a
  pendingKeys gauge beside players-online; widening the TxNeverStarted
  -> contended mapping to the OTHER guard transactions (today only the
  escrow write maps it; the rest 500 as before, no quarantine
  involved); the per-listing serializeCharacter event-loop cost
  attribution.
- Accepted nits: the depth-cap slot pins for the process lifetime if a
  FIFO never settles past every db bound (visible as depth_refused);
  takeover/shutdown wait out the escrow bound (the 75s stop grace
  covers the ~27s worst case).

Validation: tsc clean; the 20-suite DB-free set 1078 green plus the
counter/metrics suites; all three pg suites 109 green under
TEST_DATABASE_URL (zero skips, demonstrably ran) plus the escrow set
(fence both ways, the 55P03 ceiling with elapsed bounds, the
lock-graph probe looped 5x on the public arm, the measured cost
distribution asserted at 25x slack); ci:changed exit 0.

## 04 QA round (verdict PASS-WITH-FOLLOWUPS, every fix applied)

Release sync: merge a43a1e8b52 (origin/release/v0.37.0, 147 commits, seven
conflicted files). The count-pin merge trap FIRED for real: both sides
pinned IWorld 321 (ours via tradeClose, the release via setItemLocked) and
git auto-merged the identical numbers while the merged tree carries 322;
all five pins re-derived from suite runs (IWorld 322 / data 85 / method
237, sends 199, dispatches 212), never arithmetic. The release's hud.ts
additions broke the zero-headroom ceiling: fixed by extracting the
craft-deny message table to src/ui/crafting_deny_core.ts (registered pure
core, own suite; ceiling 19190 to 19177, zero headroom kept). The five
non-Latin overlay conflicts resolved as unions; i18n regenerated with ZERO
drift vs the auto-merge. Seven-lane merge audit: both sides survived as
exact unions everywhere; the release's player item lock (issue 3042) does
NOT gate the $WOC listing path, judged PARITY with the gold market (the
lock gates only salvage/craft/vendor by its own design) and recorded as a
phase 13 session-start design question, with a disambiguating comment at
the transfer-lock predicate; game.ts ceiling ratcheted 10900 to 10859 (the
release's cadence extraction never banked its slack); lock_item joined the
command-history narrative.

Re-judge list (all eight items): seven UPHELD with the reasoning re-run
against the code (R8 numbers: duty-cycle arithmetic re-verified, one
account bounded to about 13 minutes per hour of market-wide denial;
cancel-intent bid block: entailed by the one-window bound, the converge
belt proves it; confirm_in_flight second-signature semantics; the
already-succeeded retry arms; the held-bond posture; the stuckBonds axis;
the split anchors). One AMENDED: the confirming-hours no-upper-clamp
posture is REJECTED; the knob now clamps at 720 hours with a one-time
first-read warn (a huge value silently disabled the H15 park, and past
to_timestamp's range it 22008'd the sweep arm into silence), parse cases
pinned.

Real-SQL: all three pg suites under TEST_DATABASE_URL, 100 tests at
session start, 104 at the final tip, zero skipped (demonstrably ran).

Deep mutation pass (isolated scratch worktree, baseline 137 green), aimed
at the windows the prior 28 spot-proofs did not cover:
- recorder dedupe key: BIT (three window-mapped cooldown reds)
- exempt-list bound parameter: BIT (six reds incl. the structural pin)
- converge TxAbort rollback: FALSE survivor, then BIT; the pin lives in
  the BOND suite, not the settlement suite the harness first targeted
  (lesson recorded as memory mutation-survivor-wrong-suite)
- withTx idle-stall coded-error preference: REAL survivor; the busy-loop
  test covers only the sync stall shape. Closed with a private-seam
  async-stall pin proven red-on-mutant and green-on-real.
- open2 create-before-drop ordering: BIT (order-sensitive structural pin)
Plus two fix-round proofs: dropping the reviewed arm reds the H15 pins;
dropping the advisory cooldown answer reds the lock-free pin.

Five audit lanes over the two-session diff (privacy-security,
database-performance, test-coverage, correctness, cleanup/staleness), all
prompted for coverage; every finding applied or reasoned, the fix rounds
re-reviewed fresh. The applied set:

- Security (0 blocking, 5 should-fix): signature charset bound on BOTH
  intake routes (^[A-Za-z0-9_-]{1,256}$; the recorded string feeds an ops
  warn and the service, so control characters were a log-forging vector;
  five refusal pins + a dev-style pass-through pin); the confirming-hours
  clamp above; comment truth-ups (the db-file exempt prose overstated the
  predicate, the FK-edge comment overstated the risk, the paid-probe race
  gained its cosmetic-outcome note). Residuals accepted and recorded
  below: the exemption unreachable through the in-repo proxy, outage
  abandons against no-signature buyers, signature squatting, the
  service pending-contract dependency, the rotation-denial arithmetic.
- Database performance (six P2, measured with disposable-instance
  EXPLAIN): the H15 confirming park SPLIT into its own reviewed sweep arm
  with its own read and budget (confirmingOverdueSettlements; a confirming
  backlog carries the oldest deadlines by construction and owned the
  shared batch head, starving the offered/failed expiry work; the split
  also restores ordered-index pushdown for both arms, RESOLVING the
  recorded 16/17 UNION ALL item); the cooldown probes moved into
  claimBuyNowLock's lock-free advisory pass (a cooled-down account's
  retries at 20/min each took the listing FOR UPDATE just to be refused;
  the self-steal still pays the transaction where its abandon is recorded;
  proven lock-free by a new pg pin racing a held row lock);
  GUARD_IDLE_TX_TIMEOUT_MS raised to equal ESCROW_LOCK_TIMEOUT_MS (2000ms;
  500ms was four times tighter than the lock-wait tolerance with no
  measurement, and a false fire discards a pool client); the stuckBonds
  sample orders on the indexed placed_at (the COALESCE order top-N sorted
  every signed pending bond per refresh, about 4,000 buffers at 5k rows;
  divergence is minutes on an hours-scale readout and stuckSinceMs stays
  the honest per-row axis; the O(cap) docblock gained its honest
  exception); the rotation write cost and the abandons-prune plan recorded
  as measured comments beside their code.
- Coverage (5 should-fix, 6 nits): refreshBondQuote success-path test; the
  outbid replay outcome test; the teardown carve-out's third-dimension
  negative arm (a signed-but-HELD pending bid IS torn down to
  refund_due); the overdue default pass's ['won'] CAS pinned against a
  suspend-released bid; three CAS-lost re-read arms (placeBid contended,
  refresh confirm_in_flight, abandon re-read); the proxy scrape and the
  retention-wiring pins comment-stripped; the window pins made associative;
  the stale retry-test title; the DB-free bond-poll park arm
  (confirm-call counting across four passes); the no-signature exemption
  conjunct arm. Declined as recorded before: the LOCAL_LEDGER_TTL_MS
  eviction arms match the accepted parkedDeliveries gap (phase 16).
- Correctness (0 blocking, 3 should-fix; all five deliverables and the
  02/03 guarantees verified, 11 bid-status writers traced): the
  lapse-straddle hole CLOSED (refreshBondQuote could mint a quote
  outliving the bid's 300s lapse deadline, and a signature broadcast in
  the straddle arrived against a lapsed bid where NOTHING recorded it,
  the one H4 loss shape signature-first recording cannot reach; the
  refresh now refuses quote_expired when the quote would outlive the
  seat, the settlement leg's deadline-guard sibling; residual: the
  sweep-cadence boundary race, seconds instead of a quote lifetime); a
  confirm whose activation the POLL won answered standing:false (read as
  outbid by the very bidder whose payment stood; now answers from the
  row's real status); a recorded-signature retry against a review-parked
  settlement answered not_active (purchase gone) for money under review
  (review joins the outcome arm). All three pinned with tests proven RED
  on the pre-fix code.
- Cleanup/staleness (1 should-fix + doc round, hygiene sweep CLEAN): the
  misattributed prune docblock; the stale open-index comment; the missing
  lock-order carve-out comments (insertPendingBid, escrowInsertListing)
  plus disposeSoldResidueListings joining the CLAUDE.md list; the
  strip_comments header now states its string-literal limit and the
  architecture guard's copy points back; the unreachable-operator-arm
  wording fixed at the stuck route and in server/CLAUDE.md (the
  review -> confirmed/failed arms ARRIVE with phases 09/19; hand SQL
  forbidden); the config exception ledger gained wocMarketConfig; the
  count-rot sentences went count-free; the dead optionalString removed.

Residuals accepted THIS round (do not re-raise; owners):
- The abandon exemption is unreachable through the in-repo proxy (its
  unavailable arm always answers pending), so it guards only a remote
  DECIDED service_unavailable verdict: defense-in-depth as recorded by
  the implement round; phases 10/21 confirm the service contract.
- An economy outage can mint ONE recoverable abandon row against a buyer
  whose window elapsed unsigned (the exemption requires a signature);
  bounded by guardEnabledHealthy refusing new claims while unhealthy and
  by the rolling window; phase 12 health rail and phase 14 copy soften it.
- Signature squatting: both signature columns are globally UNIQUE and a
  rival can burn a victim's observed signature (refusal signature_reused,
  no recording); pre-existing, and this phase's TTL-long recording window
  widened the bond-leg exposure. Owner: R5/phase 10, the verifier must be
  able to clear a signature whose chain contents pay a different
  reference; the service-side reconciliation is the recovery meanwhile.
- The anti-snipe pending arm still trusts the service's pending contract
  for unknown signatures (recorded before; phase 21 owes a contract test).
- About seven rotating funded accounts can still deny one listing near
  100 percent (each seat costs a verified wallet plus balance); the
  cooldown is a partial defense by design, recorded.
- quote_expired's catalog copy ("request a fresh quote") is now also the
  lapse-straddle refresh refusal's answer, where no fresh quote will
  come: phase 14 copy item beside the recorded confirm_failed mismatch.
- Cancel-intent is irreversible by design (no un-stamp path); phase 14
  owns whether the seller-side marker needs an undo affordance.

A THIRD fix round followed the fresh re-review of rounds one and two
(the review-the-review rule paying out twice more; every finding applied):

- BLOCKING: the review outcome arm was server-honest and client-dishonest,
  BOTH clients rendered a review-parked payment as a completed purchase
  (the market window toasted purchaseComplete on any ok; the trade
  controller's SETTLING_STATES lacked 'review' so it logged settled in
  green). 'review' joined SETTLING_STATES and the window's confirm toast
  branches on the state; both pinned (a behavioral in-flight arm and an
  associative toast pin).
- BLOCKING: the signature shape check refused the trade controller's
  devsig:<reference> arm (references themselves carry colons), so the p2p
  settle 400'd whenever the service answered signatureRequired false. The
  shape admits ':' (still no control characters) with a colon-bearing
  positive route pin.
- The advisory cooldown shortcut skipped the steal-time recording for an
  at-cap self-steal (that window's abandon never booked, its per-listing
  cooldown never started): the shortcut now applies only when the peek row
  carries no recordable expired lock, pg-pinned (the fourth abandon is
  recorded before the refusal).
- The straddle guard compared a PREDICTED expiry; the authoritative check
  now also compares the service-minted expiresAtMs against the lapse
  (service-stub pinned). And the refusal got its own typed code,
  woc_market.bond_window_closed (409, catalog leaf + five non-Latin
  fills, REFUSAL_ERRORS 48 rows): quote_expired's copy told the player to
  request the exact thing that had just refused and would keep refusing.
- Coverage: the not_pending re-read's FALSE arm (superseded stays not
  standing); stats.reviewed pinned; the stuckBonds ORDER BY placed_at
  structurally pinned beside its sibling; the craft-deny table
  exhaustiveness-pinned via satisfies plus a station-recipe negative arm;
  the placeBid CAS refusal pins nothing-written; the raw ESC byte in the
  routes fixture became its escape sequence.
- Docs: the stale six-refusals sentence, the parkOverdueConfirming
  docblock tense, the inert arm-order clause, disposeSoldResidueListings
  dropped from the carve-out list (not a transaction), the boot-warn
  wording corrected to first-read, and the resolved migration INFO noted
  in the ledger.

qa-checklist verdict READY (0 blocking; its three should-fixes are the
stale comment, the missing ORDER BY pin, and the copy-honesty gap, all
applied above; its nits recorded: the 2.6s busy-loop stall cost is the
accepted price of the idle-bound retune, and the turbo.json
noUndeclaredEnvVars warning is tree-consistent).

Gate: the first full run failed exactly one suite, the station-toast
source pins in profession_identity_card.test.ts still scraping hud.ts
for the ternary the crafting_deny_core extraction moved (a suite the
targeted runs never touched: the full fallback earning its keep);
retargeted to the core and GREEN at 8c1028e89d, full-suite fallback,
all 8 steps.

Deferred proofs with owners: standing planner assertions for the two
rotation indexes in the pg suite (phase 20); the p99.9 inter-statement
event-loop gap measurement behind the idle bound (phase 16); an at-scale
advisory-cooldown concurrency proof (phase 16/20).

## 04 verification round (re-run of the implement session over its committed tree)

A dedicated session re-executed the phase prompt to verify the implement
round (which had run over context) left nothing incomplete. Verified
directly: branch synced with the newest origin/release tip (no-op),
phase-start commit recorded, all three real-SQL suites green under
TEST_DATABASE_URL (96 tests, demonstrably run), tsc green, server/CLAUDE.md
current, .env.example knobs present, REFUSAL_ERRORS at its pinned count, the
five non-Latin fills symmetric, operator semantics documented at the stuck
route, and three committed-round mutations independently re-bitten (park
axis to placement, holderless clear, confirming arm dropped: each reddened
exactly its named tests with the suites provably running). Two fresh audit
lanes then ran over the committed diff (a deliverables-vs-claims audit and
a test-coverage audit); every finding was applied, each behavior fix with a
test that fails on the old behavior:

- Route-level cancelPending forward was the ONE unpinned wire hop (blocking):
  two handler-driven cases now pin both bodies; a mutation to a bare
  { ok: true } reddens the new pin (proven).
- Typed second-signature refusals: a DIFFERENT signature against a signed
  pending bid answered not_pending (bond leg) / not_active (settlement leg),
  a false dead-row verdict that also discarded the event silently; both legs
  now answer confirm_in_flight, the first claim stays the trace, and the
  chain is never asked about the discarded string. Residual, recorded: the
  second string has no ledger slot of its own (single-column model); the
  reference-scoped service verdict is the double-broadcast backstop (phases
  09/10).
- Idempotent settlement retry: resubmitting the RECORDED signature against a
  confirming row re-asks the chain instead of refusing not_active; the retry
  skips the recording write, so it cannot re-stamp updated_at (the H15 age
  axis; a spy pins the single write). A revived failed row's replaced
  signature is logged on the dev channel before the overwrite.
- lapseBid held-bond carve-out: a reorg-flipped (settled-then-refused)
  verdict could void a HELD bond into a state no refund arm reads (bondsDue
  selects refund_due/forfeit_due only): the exact loss class this phase
  closes. lapseBid now requires bond_state 'pending'; the held row stays
  with the poll, visible via stuckBonds, and the positive control in the
  same test proves ordinary lapses still fire. Exit rides phase 09 tooling
  or operator resolution (recorded in the handoffs).
- First-arrival extension anchor: re-posting one pending-forever signature
  (rate limit 60/min) re-anchored the anti-snipe extension on a fresh clock
  each time, holding the close at now plus the extension continuously to the
  cap; submitBondSignature now RETURNS the first recording moment and
  confirmBond anchors on it, so a re-post extends nothing (service arm pins
  no-creep; a pg arm pins the returned stamp across a one-hour retry).
- cancelListingIfUnbid gained the idle-in-transaction bound: the
  cancel-intent work had grown it two round trips inside its FOR UPDATE
  window without one (the constant's retrofit scoping predated that growth).
- stuckBonds now ages on COALESCE(bond_signature_at, placed_at), the poll
  park's own axis (the readout described a mechanism it did not measure;
  divergence was bounded but the axis is now honest). Wire shape unchanged.
- Pin hardening: the window test's new presence pins scan comment-stripped
  source (tests/helpers/strip_comments.ts, extracted on the rule of three
  with its own suite; architecture.test.ts deliberately keeps its original
  copy, being a self-contained load-bearing guard); the bond rotation index
  pin now includes its WHERE predicate; the idle-bound pins assert the
  literal 500; WOC_MARKET_BOND_POLL_PARK_SECONDS and the anti-snipe trio are
  literal-pinned, plus a comment-stripped identity pin on the park
  comparison site (its value coincides with the pending TTL, so a constant
  swap was behaviorally invisible); the paid-subset probe rides the new
  shared PAID_SETTLEMENT_STATES_SQL with a subset-relationship pin; the
  anti-vacuity window guard reads the real constant.
- Docs truth-ups in state.md: 17 (not fourteen) mutation spot-proofs, the
  28-test bond suite, the cancel_rotation index name in the arm-two bullet,
  the six-of-seven lock-free wording, the markBidStatus CAS attribution, the
  wocMarketConfig parse-case location (routes suite, and the file lives in
  woc_market_routes.ts), the service_unavailable extension gate, the
  after-close behavior note, the abandons FK blocking edge, and the
  confirming-hours no-upper-clamp QA item. In-code comment corrections:
  the two park-constant comments, the overdueSettlements plan-shape comment,
  two lock-carve-out comments, and withTx now prefers a CODED async error
  but never lets a codeless connection close mask fn's own bug.
- Verified with no action needed: the strike after the defaulted CAS is
  guarded by its moved check; the exempt service_unavailable arm is
  defense-in-depth (a local outage cannot write that fail_reason; only a
  remote non-pending verdict can); the sub-millisecond revival-race abandon
  residual is bounded and never stamps a paying holder.

The fix round was itself re-reviewed as unreviewed code by a fresh lane,
which found the far side of two fixes missing plus a starvation regression;
every finding was applied (round two, same session):

- Already-succeeded retries now answer the OUTCOME on both legs: after the
  first fix, a blip retry of a signature that SUCCEEDED still refused
  (not_pending read as "bid gone" for an active standing bid; not_active as
  "purchase gone" for a delivered sale). The recorded-signature arm returns
  standing for active/won and not-standing for outbid on the bond leg, and
  the current state for confirmed/delivering/delivered on the settlement
  leg, never re-running hold-and-activate and never minting a second sale
  (both pinned with different-signature negative arms; the old
  refuses-not_pending replay test was deliberately retargeted, keeping its
  no-churn assertions). A same-signature retry on a 'failed' row still
  refuses; the settlementQuote revival owns that path (QA may re-judge).
- confirm_in_flight's copy was bond-specific while the settlement leg now
  answers it too: reworded leg-neutral ("Your payment is still confirming.")
  with the five non-Latin fills refreshed in the same change and the
  resolved artifacts regenerated.
- The lapseBid carve-out had traded the money bug for a starvation shape:
  the held survivor was deleted from the parked set on any decided verdict
  and never rotated, so it re-owned the batch head and burned one confirm
  RPC every pass forever. lapseBid now reports whether it lapsed and the
  poll parks the refused-lapse survivor (rotation + backoff); the pg test
  asserts the rotation stamp instead of treating the stuck head as the goal.
- The single first-arrival anchor took away the paid-bond extension for an
  early signer whose verdict lands seconds from the close (the settled arm's
  own activation could then read the auction as over). RULING (this
  session): anchors split by arm, pending on first arrival (the creep is
  pending-driven; re-posts are free), settled on the verdict moment (needs a
  REAL payment plus repeated contended activations, cap-bounded). A new
  test pins the restored settled-arm extension; the no-creep pin stands.
- The bond leg's typed second-signature refusal gained its DB-free arm (the
  pg pin skips without TEST_DATABASE_URL and the CI floor is DB-free).
- Nits, all applied: stuckBonds sample carries stuckSinceMs (the age axis;
  placedAtMs alone overstated stuck duration) and the fake mirrors the
  axis; the paid-subset pin now DERIVES its expectation from the production
  open2 DDL predicate; the park identity pin covers BOTH sides of the
  comparison (the left operand could regress to placement unseen) and the
  rules-test header owns its two source-pin exceptions; the legacy
  no-stamp row falls back to placed_at on resubmit instead of adopting the
  resubmit clock (pg-pinned); the strip_comments header no longer claims
  unenforced byte-identity with the architecture guard's copy.
- Recorded, not changed: five older suites still hand-roll comment-strip
  variants (action_bar_painter, arena_window, bags_window twice with the
  weaker no-protocol-guard form, cast_bar_painter, char_sheet_sig_core);
  consolidating them is unrelated-suite churn for a later cleanup pass.
  The request-path console.warn on the revived-signature overwrite is
  deliberate (no request-path log seam exists; rate-limited by the confirm
  policy).

Items the phase-04-qa session must re-judge, beyond the implement round's
list: the confirm_in_flight second-signature semantics (both legs), the
already-succeeded retry arms, the held-bond no-automatic-exit posture (now
parked, still no automatic exit), the stuckBonds axis change and the new
stuckSinceMs sample field, the split extension anchors (the ruling above),
and the confirming-hours upper clamp question.

## 04 implement round (bond and payment lifecycle)

Commits f64733145c (source), 2c8931811f (tests), dc0a23c674 (session-start
row), plus the reviewer fix round and docs commits after them. Release sync
was a no-op. The registry of what shipped is state.md's 04 ledger entry; the
round facts and decisions:

- The fails-on-old-behavior proof: eight targeted mutations run AFTER the
  commits (intake order restored, refresh CAS arm dropped, suspend carve-out
  dropped, confirming overdue arm dropped, bond-progress extension neutered,
  steal-time recording inverted, holderless clear restored, paid-window stamp
  guard bypassed), each reddening exactly its named real-SQL test with the
  suite provably running. One first-attempt mutant broke compilation (15
  skipped, proving nothing) and was redone as a semantic one-token flip.
- Decisions the QA session should re-judge or know:
  - R8 numbers proposed: 1800s per-listing re-claim cooldown, 3 abandons per
    rolling hour account-wide (rationale in woc_market_rules.ts).
  - Cancel-intent blocks NEW BIDS as well as new lock claims. The ruling text
    names lock claims only; bids are blocked because a bid landing after the
    stamp would re-deny the cancel past the promised one-window bound
    (has_bids refuses the converge close). Recorded for re-judgment.
  - 'confirm_failed' UX wrinkle: a decided-against signature stays recorded,
    so the bidder cannot refresh or abandon until the poll lapses the bid
    (about one sweep pass). The catalog copy for confirm_failed still says
    "request a fresh quote"; the mismatch is a phase 14 UX-honesty item.
  - Stuck bonds get NO automatic time-based exit this change: routing a
    never-landed payment to refund_due would pay out through the current
    blind releaser (B3). Visibility-bounded instead (the stuckBonds readout
    class); the automatic exit lands with the phase 09 releaser CAS and the
    phase 10 verifier timeout (R5).
  - The review park runs BEFORE the poll arm in the same pass, so a row
    whose economy recovered exactly at the bound parks rather than resolves;
    deliberate (six hours of polls already failed) and operator-recoverable.
  - The converge arm expires only 'failed' rows itself: the abandoned
    window's offered settlement belongs to the overdue arm, which is also
    the canonical abandon recorder, so convergence waits a pass rather than
    lose the abandon row.
- Doc upkeep: server/CLAUDE.md woc_market row rewritten for the new seams;
  .env.example gained the two knobs; the internal stuck route carries the
  operator semantics comment.

The three-lane review round (commit 6c89a99dbb, every finding applied or
recorded; the fix round itself was re-reviewed fresh and mutation-proofed
with six further spot-proofs, all of which bit):

- Security (1 critical, 2 warnings fixed; the rest recorded): the extension
  fired on the raw submitted signature (now verdict-gated, settled or
  pending only); a rival's claim probe could stamp a PAYING holder (now an
  open-settlement probe refuses as 'locked' with no recording); a refused
  transfer read as a walk-away (the sweep recorder now skips signed
  windows). Recorded, not fixed here, each with an owner: the
  free-to-create immovable signed bond depends on the economy service's
  verdict for unknown signatures (phase 10, R5; the poll rotation bounds
  its cost meanwhile); the review state has no in-repo operator endpoint
  yet (phases 09/19 own driving transitionSettlement; hand SQL bypasses the
  CAS, so the runbook must forbid it); quote expiry is no longer enforced
  game-side on either intake, so the stale-reference refusal is now the
  service's contract to keep (confirm at phase 21's devnet run; the dev
  economy already refuses expired quotes); stuckBonds is the first readout
  class carrying a raw account id (dashboardGate-only; kept for the
  cooldown runbook); the abandon cap is per realm by design.
- Database (3 P1, 5 P2, all applied): claimBuyNowLock refusals went back to
  lock-free (measured hundredfold amplification when diagnosed under FOR
  UPDATE while holding a pooled client); the cancel-intent converge and the
  bond poll both gained the park-rotate-backoff seam (a paid window or a
  never-decided signature no longer owns a batch head every pass; the bond
  arm parks only PAST the 5-minute pending TTL so young bonds keep full
  cadence); idle_in_transaction_session_timeout=500ms on the three new
  guard transactions with 25P03 as typed contention (retrofitting the older
  guards rides phase 16); the CHECK evolution adds NOT VALID; the
  saturating-count comment now states the honest O(account rows) bound; the
  repair-gate and readout doc comments were de-staled. The reviewer's
  runtime-proof asks (economy verdict semantics for unknown signatures, an
  end-to-end contention run, converge saturation, pool-wait observability)
  ride phases 10, 16 and 21.
Round TWO of the re-review (the fix round reviewed as unreviewed code by
fresh security and database lanes plus a coverage re-audit; every finding
applied):

- Security round 2 HIGH: my txSignature exemption was a one-request bypass
  of the whole cooldown arm (post a fabricated string, get refused, walk
  away unrecorded). Replaced by a refusal-CLASS exemption
  (WOC_MARKET_ABANDON_EXEMPT_FAIL_REASONS) inside ONE shared recorder
  statement both recorders run, with the failed-row expiry preserving
  fail_reason so the class survives; the sibling steal recorder inherits
  the same predicate, closing the round's third finding (the recorders
  disagreeing in opposite directions). MEDIUM: the extension gate failed
  open on the proxy's pending+service_unavailable arm during outages; now
  gated on the shared reason constant.
- migration-safety (dispatched over the final DDL, the one lane qa-checklist
  flagged had never seen the schema): PASS, no critical or warning, verified
  live against real Postgres 16 (constraint name, NOT VALID, once-per-DB
  gate, create-before-drop ordering, the index rename converging from all
  three historical shapes reproduced end to end, the repair's
  planned-but-never-executed one-time filter). Four INFOs; two folded to
  owners (the overdueSettlements pushdown loss at scale -> 16/17; the
  rollback stranding of review/cancel-pending rows -> the phase 22 runbook),
  two restated standing constraints (unbatched repair, convalidated=false).
- Database round 3 (the lane's own verification of the 25P03 fix): PASS,
  no open findings across the whole chain. Both stall shapes (async await
  and a blocked event loop) measured returning the typed 'contended'
  against the real withTx with ZERO uncaught exceptions, and the pool
  counts confirm terminated clients are discarded, not returned. The lane
  also corrected its own round-2 report: its probe had measured only the
  async ordering; the coded-error preference covers both.
- Database round 2 P1: the 25P03 arm was DEAD CODE (the SQLSTATE arrives
  asynchronously; the unlistened client error event was an uncaught
  exception surviving only via main.ts's last-resort net). withTx now
  captures the async error for the transaction's lifetime, prefers
  whichever error carries a code (the ordering flips between sync and
  async stalls, both probed), and discards the terminated client; pinned
  by a REAL idle-stall test in the pg suite (a synthetic {code:'25P03'}
  stub would have stayed green over the broken path). The lane also
  measured the fix round: the lock-free claim refusals now beat the
  original lock-free profile (1.06ms at conc=10 vs 163ms), the converge
  and poll rotations verified on their indexes, NOT VALID verified
  once-per-database.
- Coverage round 2: DB-free arm for the verdict gate (with the vacuity trap
  the auditor flagged avoided: the case sits INSIDE the anti-snipe window),
  structural pins for the idle-timeout statements, the shared recorder
  statement (which immediately caught the steal arm still on its old inline
  INSERT), NOT VALID, and the proxy-constant lockstep; the
  contended-never-parks arm via a new fake hook. One recorded decline: the
  extend-before-activate ordering is unpinnable behaviorally under a fixed
  test clock (the ordering only matters when real latency advances the
  clock between the two calls); noted here instead.

Round THREE (the qa-checklist gate, the fix-round reviewer's residuals, and
the security lane's third pass; every finding applied or owned):

- qa-checklist verdict NOT READY on one blocking item, fixed this round:
  the cancel-pending index had been redefined IN PLACE under its old name
  (invisible to IF NOT EXISTS); it is now woc_market_listings_cancel_rotation
  with a DROP of the old name, per the file's own predicate-change rule, and
  the structural pin asserts both. Its two upheld judgments: the cooldown
  NUMBERS (duty-cycle arithmetic verified) and the cancel-intent BID block
  (required, not scope creep: a post-stamp bid would make the converge skip
  forever and break the one-window bound).
- Security round 3 HIGH: 'quote_expired' was attacker-mintable (wait out the
  90s TTL, post any string; D1's signature-first recording is what makes the
  class reachable), so the exempt list is now the infrastructure verdict
  ALONE, bound as a parameter, with the honest-late-buyer cost accepted as
  one recoverable abandon row. R5 now carries THREE dependents (bond
  residency, the extension gate, restoring any late-payment exemption).
- Fix-round reviewer residuals: the extension anchor is captured BEFORE the
  chain round trip (RPC latency no longer drifts the target or nulls the
  settled arm's extension); the bond-poll park axis moved to the new
  bond_signature_at stamp (own knob WOC_MARKET_BOND_POLL_PARK_SECONDS;
  placement age said nothing about chain age, and a late signer was parked
  seconds after submitting); the advisory claim reads share the contention
  mapping; a no-BEGIN pin holds the lock-free refusal property; comments
  record the claim_cooldown advisory exclusion, the fake's
  failed-outside-open dependency, and the fake-only id tiebreak. Recorded
  declines: the excludeIds array growth matches the parkedDeliveries house
  shape (phase 16 owns scale); the extend-before-activate ordering is
  unpinnable under a fixed clock (noted in round two).
- qa-checklist should-fixes, deferred WITH OWNERS: the anti-snipe rule
  change has a PLAYER-FACING consequence (a bid placed inside the last
  wallet round trip before the close can no longer extend and cannot win;
  the money path is safe, the bond refunds) that phase 14 owes a product
  line and a client affordance for; cancel-intent is invisible to clients
  (no DTO field; a reloading seller sees plain Active, buyers learn only
  via the refusal), the seller-side marker rides phase 14 with the
  cancel-pending browse posture deliberately unchanged (seller intent is
  not leaked to buyers); the claim_cooldown copy surfaces no remaining
  time, phase 14. The "do not count never-quoted windows" idea was REJECTED
  with reasoning: buyNow always issues a quote at claim, so a no-quote
  window cannot arise from the real flow, and exempting quote-less windows
  would exempt the griefer's cheapest path.

- Coverage (4 blocking, 12 should-fix, 5 nits, all applied except one):
  tunable literal pins, teardown carve-out structural pins, the env-knob
  parse cases (including the fail-dangerous empty string), the monitor's
  five-class loop and fifth argument, retention wiring and config rows for
  BOTH woc prunes, review transition-table arms (noting
  validSettlementTransition has no production caller: the table is
  documentation, its test the only enforcement), both-sided cooldown
  boundaries and aging, the directed exemption on both recorders, the
  recorder dedupe, the converge rollback case, the paid-probe state loop,
  abandonBid's confirm_in_flight arm, SDK and window pins, the exact-bound
  cutoff case, and the new-class freeze and saturation arms. The one
  accepted decline: the two remaining clearBuyNowLock unwind call sites
  (live_settlement_exists and quote_unavailable races) have no harness hook
  to force them cheaply; the holder guard itself and three of five call
  sites are pinned, phase 20's real-SQL coverage owns the rest.

## 03 QA round (verdict PASS-WITH-FOLLOWUPS, every fix applied)

Session start 5ef64c1e11; release/v0.37.0 synced in (merge 5487531960: the
chat-quota feature; conflicts were a clean shutdown union in server/main.ts
and the regenerated pending.ts). The release-merge audit ran as seven lanes:
every merge intent preserved on both sides (diff-of-diffs identity on
hud.ts, exact unions elsewhere, db-mock trap did not fire, i18n regen
deterministic), ONE merge-created red: hud.ts 19395 over the zero-headroom
19338 ceiling, fixed by extracting localizeErrorText VERBATIM into the
registered pure core src/ui/error_text_i18n_core.ts (Hud keeps a thin
delegator; S3/B1 retargeted through a shared per-arm file table; ceiling
now EXACTLY 19190; the extraction deliberately avoided the entity-display
slice another branch used for the same fallout). Merge premises recorded in
state.md: 13 steady DB connections per realm, the first pg LISTEN/NOTIFY
exemplar, the quota-vs-escrow accounts-row contention note.

Six audit lanes ran over e71a8cfd21..5ef64c1e11 (privacy-security,
database-performance, server-hot-path, test-coverage-auditor, correctness,
dead-code/cleanup): roughly 60 findings, ALL applied or recorded with
owners. The lanes' verdicts: security no criticals and the exactly-once
model sound against every constructed dupe path; correctness PASS on all
four deliverable items with the crash matrix 11/12 pairs pinned; db BLOCK
on two P1s, both fixed this round.

The AC3 deviation is UPHELD: the park posture has no integrity hole (both
judging lanes and my own read of C2a/C2b/C3/C3b concur that a collected
letter makes absence-from-book genuinely ambiguous while the common
post-write crash window still auto-resumes via the in-book proof). Costs
quantified and recorded; Fernando can overrule, but the automatic-resume
alternative is a provable dupe rail.

Reproduced-and-fixed, the blocking class: park rotation re-stamped the
readout's own age column, so a parked return could NEVER age into the
monitor (and the commonest park, seller-gone, was invisible in all three
classes); rotation moved to a dedicated sweep_parked_at column with the
readout aging on updated_at, backing-off rows now EXCLUDED from the batch
reads entirely. The unbounded redrive beat (500 finalizes plus realm
mail-book writes per beat, worst at the legacy-upgrade boot) is bounded at
SWEEP_BATCH with a truncation cursor. Also fixed: activateBid's raw 40P01
became a typed 'contended' that reports PENDING to the bidder (the interim
fix collapsed it to a false "outbid", caught by the fix-round re-review);
finalize re-locks the open bid set after the listing lock and distinguishes
'already_final' (re-runs neither re-count nor re-notify); the finalize
transaction carries the heavy statement allowance; per-row error isolation
reached the five remaining arms; contention and park stats moved into a
per-entry scope (the eager confirm entry mints its own, closing a
request-vs-pass race); ambiguous grantCopy refusals park instead of
converting to mail; provable grant resumes refresh their ledger stamp so
sustained contention cannot expire them; the monitor gained asOfMs,
saturated flags, a stale-streak warning, a cold-failure negative cache,
and a draining stop(); the sold-notice loss window after finalize is an
ACCEPTED, test-documented cost. Three fix rounds, each re-reviewed as
unreviewed code (the round-2 reviewer verified the exclusion mechanics
against the real pg driver and found the false-outbid regression; round 3
was comment/docs/one-pin scope).

Deep mutation pass: 21 mutations over the headline pins (the named
booked_at revert, both resume rails, the written flag, hasParcel gate,
nonce proof, fence adoption, finalize shape/CAS/re-lock/already_final,
park counters, rotation-age split, redrive bound, exclusion, skip
reporting, contended claim-freeze, quota matcher rows, monitor staleness
and gate). 20 killed outright; the one survivor exposed a REAL hole (every
written-flag pin injected failures after a SUCCESSFUL persist, where flip
order is indistinguishable), closed with a blob-half-throw-then-collect
twin that provably reds under the flipped order.

Validation: 913 DB-free market/guard tests green plus 68 real-SQL against
dev Postgres (both suites demonstrably RAN); tsc, ci:changed, biome on
changed files green; gate run recorded in the row above. Doc upkeep: the
matcher-location sentences in src/ui/CLAUDE.md and server/CLAUDE.md
retargeted to the new core; the bond-lifecycle spec's dead symbol and
rotted line anchors replaced; implement-round ledger lines the fixes
falsified amended in place.

Deferrals recorded with owners (beyond the implement round's list, do NOT
re-raise): EXPLAIN plan evidence for the two new rotation-order reads and
the two new partial probes rides the phases 16/17 list; the claims-prune
orphan note (age booked rows on booked_at) rides phase 17; the operator
re-drive procedure per parked class (including the ambiguous-grant class
where hand-delivery without checking the buyer's bags IS the dupe) rides
the phase 22 runbook; the pg-harness extraction (third suite trigger)
rides phase 20; the phase 19 dashboard consumes the amended readout shape
(asOfMs, saturated, updatedAtMs) from state.md.

## 03 implement round (delivery exactly-once)

Commits 1196e2bb28 (core), 9f8097c1fb (monitor + endpoint), a08653dbd2 (the
five-reviewer fix round). Five reviewers ran over the committed diff
(privacy-security, migration-safety, database-performance with measured
EXPLAIN evidence on a throwaway Postgres, server-hot-path,
test-coverage-auditor), then a fresh reviewer over the fix round and
qa-checklist last. Four mutation spot-proofs bit before the fix round (the
QA session owns the deep mutation pass).

What shipped: the delivery close tail is ONE transaction
(finalizeDeliveredSettlement: bids-then-listing pre-lock, delivered CAS
accepting delivering|delivered, ON CONFLICT sale dedupe, merged
close+dispose UPDATE, bond flips); custody claims carry rail attribution
(grant_character_id, mail_intent_at) and a resume needs PROOF (this
process's pendingMail/pendingGrants continuity, or the parcel still in the
live book, or booked_at); everything unattributable PARKS visibly (bare
claims, collected letters, lease fences, restarts, relogs, disposed
listings); the atomic saveDeliveredCharacterBooked commits the fenced bags
write and the booking together; the minute-scale redriven beat converges the
old binary's delivered-unclosed and sold-undisposed residue over bounded id
pages; sweep arms are error-isolated per arm AND per row with a break on
contention; parked rows rotate with a 60s in-process backoff (AMENDED by
the 03 QA round: rotation moved to a dedicated sweep_parked_at column,
the monitor ages on updated_at, and backing-off rows are EXCLUDED from
the batch reads; the original rotate-updated_at/age-created_at shape was
the QA round's blocking find); woc_market_monitor.ts serves the
three stuck classes (saturating counts) through createCachedRead behind
GET /internal/woc-market/stuck (dashboard secret) plus an
only-when-stuck 5-minute log beat that warns once per failure streak.

Security criticals found by review and closed in the fix round (both were in
MY first-round design, found because the fix round was re-reviewed):

- The mail resume trusted the deletable in-blob marker: a buyer collecting
  the item and deleting the emptied letter revived the ref into a SECOND
  mailed copy. Closed by the durable mail intent + resume-only-on-proof.
- The lease-fence arm cleared the grant intent and mailed next pass, but the
  fence only proves THIS write lost, not that an earlier autosave under the
  then-valid nonce did: the granted bags may be durable. The fence now parks.

Spec deviation, needs the QA session (and Fernando) to re-judge: the phase
file's AC3 says "kill before mail write, sweep resumes and delivers exactly
once". After the mail-rail security finding the safe subset is: resume when
the parcel is provably uncollected (still in the live book, or this
process's own attempt), PARK when it is not (bare claim, intent-with-absent
parcel, collected letter). The parked cases are sub-second crash windows,
visible in the readout, and operator-resolvable; the automatic-resume
version was a provable dupe rail. Pinned by C2a/C2b/C3/C3b in the delivery
pg suite and the fake-level twins.

The fix round itself was re-reviewed as unreviewed code (a fresh reviewer
over the fix commit, plus qa-checklist over the whole diff, verdict READY
with three should-fixes). That second round found ONE blocking hole in the
first fix: the process-local pendingMail entry authorized a re-mail across
the written-but-unbooked window, where a collected letter still dupes.
Closed: the entry now carries a written flag (set at ATTEMPT time, so a
blob-half throw still counts), and once written only the parcel still being
in the live book authorizes a retry; pinned by same-process collected and
uncollected twins driven through a new failNextMarkBooked fake hook, with
the custody fake corrected to live-book semantics (a transient persist
failure leaves the parcel LIVE, exactly like the real bridge). Also from
that round: item-free letters (the seller sold notice) skip the claims
ledger entirely (they can duplicate nothing, nothing ever re-notifies, and
a parked notice polluted the readout forever); the returned arm got the same
park-rotate-backoff-count-advanced treatment as the delivery arms; one
contended finalize stops the delivery work of its OWN scope (AMENDED by the
03 QA round: contention became a per-entry scope, the sweep pass owning one
and the eager confirm entry minting its own); the delivering sample read is
carried by woc_market_settlements_state_updated (AMENDED: the QA round
dropped the created_at index when the class's age signal moved to
updated_at); the readout count cap fails closed on a non-finite value; and
the stale comments the fixes invalidated were rewritten.

Deferrals and decisions, each with an owner (do NOT re-raise):

- EXPLAIN-based plan pins and a worst-case pass-duration timing pin (the db
  reviewer's remaining runtime proofs): the hot-path scale and db-retention
  work own the EXPLAIN list (state.md ops caveats name the reads to prove:
  the redrive page probe, the readout classes, the sold-residue subquery).
- woc_market_custody_claims retention registration: the db-retention work
  owns pruning BOOKED rows; unbooked rows are the operator queue and are
  never pruned (DDL comment records this).
- The internal surface still carries no rate limiter (family-wide,
  pre-existing; the secret compare is constant-time): the listing step-up
  work owns server-side posture questions.
- Endpoint response re-stringifies per request (reasoned decline): the
  admin-envelope serializer owns the wire shape; pre-serializing would fork
  the envelope contract for a secret-gated, human-cadence dashboard read of
  at most sixty rows.
- SETTLEMENT_COLS derived-prefix coupling died with the paged rewrite (the
  probe reads settlements only); no action left.
- The fake's deliveredUnclosedSettlementsPage spells the same three-status
  literal as the SQL; the four-way lifecycle union is pinned in
  woc_market_directed_sql.test.ts, so a fifth status fails the DDL pin
  first.
- pendingGrants/pendingMail/parkedDeliveries are process-local with a
  10-minute TTL prune at each pass start (the reviewers' leak findings);
  entries that die unresumed park their claims, which the monitor carries.

## 02 implement round (settlement-state guards)

Four reviewers ran over the diff (privacy-security, migration-safety,
database-performance, test-coverage-auditor), then qa-checklist last; every
finding was applied except the owned deferrals below. Applied highlights: boot
pre-flight repair UPDATEs so the two new unique indexes can never brick a boot
on legacy-corrupt rows (with real-SQL arms seeding the violating shapes and
proving the repair); the bids-then-listing lock order in suspendListingIfSafe
and the winner stamp moved ahead of the insert (activateBid's order; a pinned
interleave test dies 40P01 under the old order); SET LOCAL lock_timeout on
both guard transactions; a distinct insertSettlement 'listing_closed' return
(a buyer racing a cancel now hears not_active, not a phantom lock);
compare-and-set on the new bid-status writes; setSaleExcluded catching 23505;
the coverage auditor's rework of the interleave test to drive the REAL
cancelListingIfUnbid, the full five-state index predicate pin, the
settlement_live suspend arm at service level, the cascade-conflict unwind arm,
the refund_due intermediate stamp under a stalled refund pipeline, and a
concurrent double-insert race. Real-SQL suite: 27 tests, run green against the
dev Postgres (TEST_DATABASE_URL; the suite skips without it). The
fails-on-old-behavior proof: the first red run against the unfixed code failed
15 of 19 original tests on their real assertions.

Deferrals and decisions, each with an owner (do NOT re-raise):

- insertSale still throws raw 23505 if a duplicate ever reaches deliverOne,
  which after the repairs is only possible on data the new guards did not
  produce; graceful conflict handling belongs to the delivery-finalization
  transaction and reconcile arm (phase 03), along with per-arm sweep error
  isolation (one poisoned row currently skips the later arms of that pass).
- The confirming-stuck escape hatch (phase 04, H15) and ruling R8 (buy-now
  lock-spam cancel denial, phases 04/06): recorded in state.md; phase 04 is a
  hard prerequisite for enable.
- The db-performance reviewer's at-scale proofs (EXPLAIN of the new per-listing
  lookups on grown tables, index-build timing, pool-wait observability before
  enable): phases 16/17 and the phase 03 monitor.
- Cascade arm still reads the full bid list per overdue settlement to derive
  priorWinners (unbounded per-listing read, pre-existing shape): phase 16/17.
- Kept against reviewer preference, recorded: the unique indexes stay in boot
  DDL (rationale comment in the DDL; concurrent builds can leave an INVALID
  index and the tables are pre-enable empty), and the lock-expiry predicates
  keep the app clock nowMs (consistent with claimBuyNowLock's own steal
  predicate, which writes and compares the same clock; the SQL-now()
  alternative also breaks the future-epoch test fixtures).
- qa-checklist round (verdict READY, 0 blocking) applied on top: both boot
  repairs gated on to_regclass so the scans run once per legacy database
  (the sales table is keep-forever, so ungated it re-scanned every boot); an
  operator note at the settlements repair (schema_dedupe rows at 'confirming'
  or beyond were payments that might still land; sweep them by hand after a
  legacy upgrade); insertSettlement now ABORTS when a named winner left the
  pickable states, turning "no settlement whose winner holds no claim" from a
  cross-module coincidence into a statement-level guarantee (test updated to
  pin the strict behavior); the concrete PgWocMarketDb signature widened to
  match the interface; a direct pin that a refused cancel rolls its
  speculative failed-expiry back. Two qa items became owned deferrals: the
  admin envelope's raw-English strings (both the new 409 line and the
  pre-existing 404 line beside it) go to the error-i18n surface (phase 14),
  and a CI job that sets TEST_DATABASE_URL so the pg suite stops being
  skip-only goes to the real-SQL coverage work (phase 20).

## 02 QA round (verdict PASS-WITH-FOLLOWUPS, every fix applied)

Session start synced release/v0.37.0 (merge b40a178643; the one conflict, the
generated resolved-i18n pending slice, regenerated per the content-union
rule). The release-merge audit ran as six lanes: every coordinator clean, the
one real break the zero-headroom hud.ts ceiling (release added prewarm lines),
fixed by extracting src/ui/preview_prewarm_wiring.ts with its own suite and
lowering the ceiling. Seven audit lanes then ran over the phase diff
(correctness, test-coverage, dead-code/cleanup, privacy-security,
migration-safety, database-performance, and a fake-vs-Postgres fidelity
audit), and the whole fix round was re-reviewed by a fresh reviewer as
unreviewed code. Roughly 70 findings surfaced; ALL were applied except the
reasoned resolutions recorded below. The reproduced-and-fixed defects:

- The audit-blocking dupe holes: a settlement could land on a listing a
  concurrent suspend or cancel just closed (the INSERT's snapshot predicate
  passes the FK re-check; reproduced against real Postgres, fixed with an
  explicit listing row lock inside insertSettlement), and the no-winner close
  arms could close no_bids or reserve_not_met under a live buy-now settlement
  (attacker-timeable item dupe; fixed with the lock-then-check
  closeListingIfNoOpenSettlement that parks the listing 'settling').
- The reproduced 40P01: activateBid's third lock (the previous current bid,
  taken after the listing) crossed the suspend guard's ordered scan; fixed by
  pre-locking the whole open bid set in id order, with a deterministic
  three-client interleave pin that reds under the old order.
- The retry revival racing a second open settlement threw an uncaught 23505
  (a 500 on a money path); transitionSettlement reports it as a CAS miss and
  settlementQuote refuses BEFORE issuing any quote.
- The fresh fix-round review then caught the fix round's own regression: the
  reclaim arm expiring a 'failed' settlement at the stranded grace (half the
  settlement window) silently skipped the overdue deadline pass (default,
  forfeit, strike, cascade) and stranded the held bond. Fixed by parking
  instead (the reopen refuses over failed rows; the deadline pass keeps its
  jurisdiction), plus a CTE in the suspend expiry that releases a dead
  settlement's won bid to cancelled/refund_due.
- Hardening from the lanes: suspend leaves a quoted, unexpired 'offered'
  settlement alone (the buyer may already have broadcast payment); both boot
  repairs gate on pg_index VALIDITY through the to_regclass house idiom with
  invalid-carcass drops ahead of each CREATE (a real carcass test proves the
  boot sees through it); the atomic one-statement loser demote; per-caller
  winner pickable sets with the distinct 'winner_gone'; typed 'contended'
  (55P03/40P01) end to end with catalog fills, answered 409 on cancel,
  buy-now, and both admin envelope arms; setSaleExcluded's distinct
  'conflict'; the forensic schema_dedupe fail_reason append; the DB-free
  structural floor in woc_market_directed_sql.test.ts (indexes, five-state
  predicate, validity gates, repair ranking, and the fake's state list, which
  now derives its suspend blocking set); fake fidelity fixes (transition
  open-refusal so the fake cannot reach a two-open state, signature
  self-match skip, cascade tie-break pins both dimensions).
- Twelve mutations were run against the new pins after committing; every one
  failed its named test with the suites demonstrably running (the deadlock
  pin dies on the literal 'deadlock detected' under the old order).
- Validation: real-SQL suite grew 27 to 41, green against dev Postgres; the
  DDL apply-twice/thrice probe is a byte-identical no-op with both indexes
  valid; S3 guard, i18n gates, tsc, ci:changed green; the full gate ran three
  times (the first red found the merged-tree fallout: two pins of mine to
  re-anchor, redundant dialect OTA rows the release's base fills created, and
  the stale-node_modules class where the release's three.js patch bump also
  explained the portrait-manifest fingerprint; a receipt rerender reproduced
  all 230 portraits byte for byte) and PASSED at 301a8c7c22.

Reasoned resolutions (not silent declines): woc_market.sale_conflict stays
registered though the admin envelope pre-empts it today (the Record type and
parity gate require the row; phase 14's admin-envelope conversion switches
the bespoke 409 lines to the registered codes, recorded in state.md); the
reserve-arm's contended-refusal can later record 'no_bids' instead of
'reserve_not_met' (cosmetic, documented at the arm; the demote-before-close
crash posture is load-bearing); the fake's createdAtMs uses the injected
clock where Pg uses now() (harmless, noted by two lanes); the suspend
guard's 'offered' open-check member is unreachable single-threaded but is a
real concurrency arm (kept, per the coverage lane's own verdict).

## Merge re-review verdicts (01, merge a52da32c89)

Five read-only agents re-reviewed the auto-merged coordinators; both parents'
intents survived in every file. Per-file: `src/ui/hud.ts` CLEAN; `src/sim/sim.ts`
CLEAN; `server/game.ts` CLEAN; `src/net/online.ts` CLEAN; `src/world_api.ts` +
facets CLEAN. Non-drift findings applied in this session: the `W9_TAGS` facet pin
gained its missing `trade_close` row plus a ClientWorld-boundary send pin
(tradeClose vs tradeCancel swap was previously invisible to every derived-set
check); the stale facet-count comment in `tests/world_api_parity.test.ts` now
follows the anchor rule; `src/world_api.ts` documents why `trade_close` sits
beside its trade siblings instead of at the append tail;
`server/woc_market_custody.ts` resolves `hasCustodyParcel` through the Sim facade
its neighboring line already used.

## 01 QA round (verdict PASS-WITH-FOLLOWUPS, every applicable finding applied)

Audit fan-out: four independent lenses (move fidelity both directions,
deliverables, dangling refs), frontend-seam-reviewer, test-coverage-auditor,
privacy-security-review on the custody commit, a fresh auditor over the fix
round, and qa-checklist last (verdict READY, 0 blocking). Roughly 40 findings
surfaced; all blocking/should-fix/nit items were applied except the deferred
restructures listed below. Fix commits e49738fbca, f0f9664a62, eeb5596446,
88fb2146c2, 1d7bdbafa0. Highlights of what the round changed: the one byte
drift in the move (the render-catch log tag) reverted; hud.ts now imports the
controller through the domain barrel; the monolith ceiling closed to exactly
19347 (zero regrow headroom, per the phase spec; the seam reviewer preferred
keeping the 19400 margin, recorded here so Fernando can overrule); the
controller suite gained a controllable fake-hooks arm covering the poll
throttle, estimate last-write-wins, pay re-entry lock, vanished-row clear,
per-role completion lines with the R34 fallback, side-scoped money rows,
accept routing plus the accept body/refusal, close-path recovery, withdraw,
the escrow-failed face, and the live coin-copper write; the trade source pins
comment-strip and bound their windows at agreed anchors; new guards pin the
server trade_close dispatch arm, the Hud staged() live binding, the E2E
reach-through names, exemption-row memo drift in the language fanout, and a
server-wide sim.postOffice facade scan (every spelling, lap-string carve-out).
41 mutations were run against the pins; every one failed as expected (one,
the shallow-copy staged getter, initially survived and exposed the untested
coin-copper write, closed in the same round). Gate GREEN twice: at 07fda3fd46
(pre-fix re-verification) and at the final tip 1d7bdbafa0 (all 8 steps, full
suite 37278 passed, browser 117); one intermediate run flaked on the known
heavy-suite timeouts (owned_class harnesses, warlock sustain, sfx export)
while a reviewer agent loaded the machine, and every one of those suites is
green in the clean final run.

## Deferrals and follow-ups

- Re-review, noted with no action (pre-existing, documented design): the custody
  return shape is declared both inline in `server/game.ts` (`wocCustodySession`)
  and as `WocCustodyGameHost`; `persistMailBlob` deliberately diverges from
  `saveMail` (failure must propagate) per its own comment. Rule of three not
  reached on either.
- Re-review, speculative (low confidence): nothing gates escrow listing or
  extraction on being seated in a battleground match; a server-policy question
  for the custody/step-up sessions, not a merge defect.
- The moved trade-window code carries a pre-existing biome useOptionalChain
  warning (`bothAgreed` expression, now in `woc_trade_controller.ts`); warnings
  do not gate, left byte-identical by the move rule; polish pass owns it.
- The trade window deliberately keeps its no-relocalize posture after a language
  switch (inherited coordinator-era behavior, now recorded as a
  `NOT_A_LANGUAGE_GATE` row in `tests/language_fanout_registry.test.ts`); giving
  it a relocalize() is a behavior change for the UX sessions to decide.
- Seam review, deferred restructures (faithful-move rule kept them out of this
  diff): the woc_trade controller reaches hosts directly (module-local `$`,
  `Date.now`, `window.setTimeout`) where `fiesta_controller` injects them
  through its deps bag; and the module-local `$` helper is now the third
  byte-identical copy in `src/ui` (hud.ts, char_skin_window.ts), so the rule of
  three has been reached for a shared helper.
- Stale mentions of `updateTradeWindow` as a hud.ts method remain in two
  historical docs (`docs/hud-program-validation-report.md`,
  `docs/ui-architecture-hud-modularization/phase-p2-window-template.md`); both
  are dated point-in-time records, left per the docs staleness policy.
- Not runnable in the implement session (need `npm run dev`): the perf tour
  and the two updated E2E scripts (`scripts/trade_money_shot.mjs`,
  `scripts/localization_e2e.mjs`); still unexecuted after QA (the browser
  regression suite itself ran green inside both full gates).
- QA round deferrals, each with an owner (restructures the faithful-move rule
  kept out of this diff, plus pre-existing debt the extraction surfaced):
  - Extract the accept-button state machine (bothAgreed/escrowFailed/
    wocAccepted/acceptSpent) into the view core with its own cases: the flow
    phase (14) owns this button. Its behavior is meanwhile pinned by the
    escrow-face and routing arms in tests/woc_trade_controller.test.ts.
  - `refreshWocTradeArm` in src/ui/trade_woc_panel.ts is a second hand-rolled
    write cache in a bare-named module the painter gate cannot see; move it to
    a `woc_trade_arm_painter.ts` on the writer facet: polish phase (15).
  - Per-medium-tick `$('#trade-window')` query in updateTradeWindow (a
    faithful-move artifact; "resolve refs once" wants a cached ref): 15 or 16.
  - The `#7fdc4f`/`#ff6b6b`/`#ffd100` log-color triple is now its fourth copy
    across extracted controllers; name the constants once: 15.
  - `staged()` handing back a live mutable object is the documented contract;
    the durable shape is a command pair (stageItemDelta/setStagedCopper): 14/15.
  - The completion line prints a raw item id inside localized prose on the
    unknown-item arm (deliberate, commented); a wrapped placeholder key: 14.
  - Trade rows drop the owned-stack instance marks (masterwork seal, glyphs)
    that bags and banks paint; the all-surfaces rule names only the three
    grids, so this needs a product call exactly where money meets items: 14.
  - The '[hud]' render-catch log prefix was deliberately restored for
    byte-faithfulness and now misattributes the module in dev logs; rename
    deliberately (with the E2E pins) if desired: 15.
  - `#trade-window` predates the HUD-chrome dialog contract (no markDialogRoot,
    no windowFocus trap); pre-existing debt, natural to schedule now: 14/15.
  - tests/command_facets.test.ts still checks one direction only; a reverse
    completeness assertion currently reds on 37 pre-existing untagged commands
    (vendor/quest/professions clusters), so it is program-wide debt, not a
    trade gap: wire-completeness phase (12).
  - sendWocTradeOffer's success path and the devsig
    (`signatureRequired === false`) branch remain source-pinned only; behavior
    arms via the fake-hooks rig: 14 (the devsig spelling is pinned in
    tests/trade_woc_panel.test.ts either way).
  - wocOfferPhase stayed in src/ui/trade_woc_panel.ts while its sibling
    decisions moved to the pure core; a Node-env suite now imports a DOM
    adapter for it (safe today, verified no module-scope DOM): 14/15.

## 15 ui-polish (2026-08-18, GAME repo, IMPLEMENT session)

Release sync first: merge 3a98604c83 brought origin/release/v0.39.0 tip
b650d9d7d2 (150 commits: the ogre body replacement, the practice-dummy row, the
NPC-look pass, the login prewarm trim, the ability-description extraction). Four
conflicts, all resolved from the merged tree rather than from either side:
hud.ts dropped BOTH contested imports (`AbilityEffect` died with the release's
`abilityEffectText` extraction; `ALL_CLASSES` is owned by this branch's
`preview_prewarm_wiring.ts`) and the release's login-trim flags now ride that
wiring module (three forwarded deps, pinned); the resolved i18n bundles
regenerated via `i18n:gen`; the armory lifecycle pins keep both sides; the
monolith rows re-derived to the exact merged counts (hud.ts 19069, sim.ts 12527,
main.ts 11493).

The `release-merge-audit` skill ran on that merge (non-trivial by its own
test): five parallel lanes plus an adversarial verify pass over every finding,
14 verdicts, all REAL. What it caught and what was done:

- `restoreInto` (server/woc_market_custody.ts), the escrow-compensation
  add-back, granted with `silent: true` alone, so the add hubs ran
  `noteRelicObtain` and a catalogued relic's Reliquary obtain tally moved every
  time an extraction was undone. Every sibling relocation grant passes
  `movement: true`. FIXED test-first (a custody test seeds a catalogued relic,
  forces the teardown-race undo and asserts the tally does not move; red at 2,
  green at 1), commit 01faddadf8.
- The `server/game.ts` monolith row kept 10818 while the merged file is 10807
  (the release moved the mech-chroma reconcile out), under a comment claiming
  zero headroom. Re-pinned, commit a4fcac14d8, with the sim.ts row comment
  corrected to name what actually grew that file and the $WOC firewall's
  non-vacuity floor moved toward the merged tree's real file count.
- `src/sim/item_lock_flag.ts`'s extraction rationale went stale when the
  release dropped `item_lock.ts`'s `./bags` import: reworded to the reason that
  still holds.
- This phase file's own premises were corrected before the work started: the
  capture directory is `docs/screenshots/woc-market/` (the slug the five CI
  sparse cones list), ten of sixteen captures predate the step-up rather than
  all sixteen, and the ratchet numbers are the merged ones.
- Verified clean by the same audit: every branch-owned overlap file keeps both
  sides' intent, the release added no route, RouteDef, WS command or IWorld
  member, no injected helper changed shape, no db-mock export list went stale,
  and the i18n reconcile is a pure regeneration (byte-identical to a fresh
  build into a scratch dir).

Then the phase proper. The written audit is
`docs/woc-marketplace-hardening/phase-15-design-audit.md` (produced first, as
deliverable 1 demands): seven read-only lanes over the merged tree (Exchange
chrome, trade arm, content robustness, tooltip and disclosure copy, mobile, test
pins, i18n obligations), roughly 215 findings, each row now APPLIED, DEFERRED
with an owner, or JUDGED with a reason. Every claim was verified against the live
token set rather than DESIGN.md prose: `--radius-window`, `--dur-*`,
`--color-ink-*`, `--panel-fill-strong`, `--color-text-secondary` and
`--color-accent-hover` have not landed, so the pass composes only tokens that
exist plus `color-mix()` over them.

Commits: 92da32bbb1 (the presentation pass: CSS, painters, catalog English, the
five non-Latin overlays, the regenerated bundles), e6c054232d (the live rig, the
three new guards, the repaired pins), be35080962 (the capture rigs), then the
docs and capture commits.

### 15 deferrals, each with an owner

- **16 or a wire change.** Copy that still cannot resolve a live figure because
  it is not on `/status`: the sell-empty line's quality floor and the two
  collectible switches, the bond schedule for an arbitrary typed bid (5 percent,
  $1 to $50), and the bond-pending TTL. Each is written figure-free rather than
  wrong, and `tests/woc_market_copy_figures.test.ts` records the constants so a
  retune cannot pass silently. Shipping them on `/status` (or a bond-for-amount
  estimate) is the honest fix.
- **16.** The mobile detail pane renders below the table on the one-column
  sheet, so a row tap on a full page paints the bid form off screen. The cure is
  `scrollIntoView` on select, which is behavior, not presentation.
- **A behavior pass.** The over-balance red on the trade arm's equivalent line
  is driven independently of the ranked send hint, so with two problems staged
  the figure can turn red while the hint names the other one. The ranking lives
  in the frozen view core.
- **A behavior pass.** The R10 lock-hint dead end is only half closed: the hint
  now names the escape (unlock, then re-stage the item), because the robust fix
  is a sim trade-snapshot refresh with acceptance-reset side effects.
- **22 (product debt).** `#trade-window` still predates the HUD-chrome dialog
  contract (no `markDialogRoot`, no focus trap). Adding them changes keyboard
  and Esc behavior, so it needs its own pass with tests rather than a line in a
  presentation commit.
- **The DESIGN.md rollout (1 and 2).** The accent knob's retune, the latent
  text and ink tokens, the radius and duration families, and the shared
  primitives the marketplace inherits (`.btn` at 12.5px in the display face,
  `.panel-title`'s gold, `.x-btn`'s sub-36px target, the 3px focus ring).
  Restyling them from a marketplace section would be the per-component copy
  DESIGN.md 13.4 forbids.
- **A catalog-wide decision.** Title case on buttons (DESIGN.md 5.4): this
  catalog is mixed, so a marketplace-only sweep would create a new
  inconsistency and stale every locale row it touched.
- **The DESIGN.md chrome retune, WITH evidence.** `--panel-border` (DESIGN.md
  4.3) stays UNDECLARED. Its 13 consumers are all in the Dungeon Finder section,
  so declaring the alias is not a token cleanup: it switches on 13 borders that
  have never painted and grows those content-sized chips by about 2px, in a
  window this pass neither owns nor captured. It is on the exact ratchet in
  `tests/css_token_resolution.test.ts` with that reason, and the retune owes a
  Dungeon Finder before/after (desktop and 900x420) when it lands.
- **A follow-up, not a ceiling.** `src/ui/woc_market_window.ts` enters the
  monolith ratchet at 2623 lines with zero headroom, which stops the growth but
  legitimizes the size: the pure-core half of the recipe (a `woc_market_view.ts`
  the window renders from) was never built. Worth its own extraction pass.
- **A mobile-chrome sweep.** `scroll-padding-top` is declared for `#trade-window`
  alone, but the cause is shared: the block that grants `overflow-y: auto` on the
  window element itself covers fifteen windows, and any of them whose header is
  the sticky `.panel-title` inside that scrollport has the same hazard (several
  are immune because they scroll an inner pane with the header outside it, which
  is why the Exchange needed no equivalent). The durable form is one rule over
  the self-scrolling set, plus a `--mobile-header-h` token both the floor and the
  reserve read. Out of scope here, and it wants its own captures.
- **Recorded, not closed.** `scroll-padding` steers scroll-INTO-view only
  (focus, `scrollIntoView`). A player who drags a money field under the sticky
  header by hand still can; focus is the trigger this pass fixes.
- **Recorded, guarded by the rig.** The reserve's `40px` term is the button
  FLOOR, not the row's height: a locale whose commit label wraps grows the row
  past the slack, and no arithmetic in the sheet can see that. What can see it is
  the rig's `reserve >= measured band` assertion, which runs per face and per
  locale (the Russian pass being the wordiest). The two guards cover each other:
  only the CSS can see an inset, only the rig can see a grown row.
- **A theme pass.** The typed price and the block reason read `--gold` and
  `--gold-dim`, the RAW accent pair, while the rest of the arm reads the
  contrast-repaired `--color-accent`. Both are a clear improvement on the hex
  literals they replaced; choosing between the pairs belongs with a contrast
  sweep over every preset, not a marketplace section.
- **Structural, whole-HUD.** Every mobile touch floor is authored inside `#ui`'s
  zoom, so at the 0.85 UI-scale floor a 40px control renders at 34px. The money
  sheets' own INSETS are now divided by the scale; doing the same to the floors
  is a house-wide change with its own capture set.
- **For Fernando's sign-off, not a defect.** The capture set is 79 files and
  about 46 MB. `docs/` is NOT part of the built site (only `public/` deploys
  verbatim), so this is repo weight only, and the directory already carried
  roughly 900 MB before this pass. Trimming the `-stress` and `-ru_RU` variants
  would halve it; keeping them is what makes the extremes and the wordiest
  locale reviewable. The 15 QA session owns that call.
- **Recorded, no change.** The three native `<select>` controls stay native (the
  themed `.ui-dd` swap is wiring); the Exchange stays a fitted 960x700 rather
  than the large-window target; the store's dead portrait media query stays;
  insetting the SHARED mobile sheet base for all 24 windows is a maintainer
  call, so this pass insets only the two money sheets it owns.

### 15 review round (two independent frontend seam passes, every finding settled)

Two `frontend-seam-reviewer` passes ran over the committed range with MOBILE in
scope, plus an i18n fill audit. Neither returned a BLOCKING finding. What the
fix round applied, each with its own pin:

- The staged item's name carried `.q-<rung>`, which is the icon FRAME family
  (border plus an epic and legendary glow, never a text colour): an epic read
  grey behind a stray halo, a rare showed nothing. It now takes the inline
  `QUALITY_COLOR` every sibling row family uses; the pin reds on the old markup.
- Two rendered sentences were joined in code with a hard `' '`, which decides a
  locale's spacing (CJK sets none) and forbids reordering: the ineligible count
  and its reason, and the seller's fee and net. Each owns its line now, the
  shape the arm already used for the fee and net pair.
- A fee resolved for one price field survived the format swap that rebuilds the
  form under it. It is dropped and re-asked; the pin fails if the re-ask goes.
- A token amount too small for two fraction digits printed a flat `0`: a real
  fee leg reading as nothing. Under half a hundredth it now keeps six digits.
- Both offer-expiry reads used a `typeof === 'number'` or truthy test, neither
  of which rejects NaN, and NaN is exactly what the server's date projection
  yields for a missing value. Both take `Number.isFinite` now.
- Mobile: both money sheets pin their BOTTOM edge and divide every safe-area
  inset by the UI scale. With a top inset above 10px the old cap put the sheet's
  bottom edge (and the sticky commit row pinned to it) below the viewport, out
  of reach on a fixed sheet. The `scroll-padding-bottom` literal is derived from
  the tokens the row is built from.
- Desktop consent checkboxes reached the 24px floor (the trade arm's was 18px,
  the Exchange's the 13px UA default) on the one control the server will not
  take money without.
- The Exchange window took a zero-headroom line ceiling now that it is the
  largest unpinned UI module; the arm painter got the no-magic source scan its
  namespace expects; the balance chip joined the architecture registries beside
  its two siblings; the log tones' literals are a documented sanctioned home
  with a test pinning the single source.

A THIRD review, fresh over the fix round itself, found two defects the fixes
had introduced and two claims that overstated what they fixed. All four settled:

- The derived scroll reserve mirrored a flat `--window-pad`, but the window's
  real bottom padding is the inset-aware `max(--window-pad, 18px + inset)`: on a
  landscape phone with a home indicator the reserve came up 15px short and put
  the control back under the commit row. Headless capture reports zero insets,
  so no rig run could have seen it; the calc now mirrors the source rule and a
  pin reads the DECLARATION (prose in the block cannot satisfy it). A
  forced-inset rig arm was tried and DELETED as vacuous (it added the inset to
  the computed reserve, assuming exactly what it should test; the rig's own
  comment records this), so the inset term's only guard is the CSS declaration
  mirror, and the real-notched-device check stays owed.
- Pinning the sheets' BOTTOM edge stretched them to full height (a two-line
  trade painting a 400px panel), which the fix never claimed and did not need:
  the inset-aware height cap alone fixes the off-screen case. The pin is gone
  from both money sheets, kept only on the side-by-side split where full height
  is the point, and pinned so it cannot come back unnoticed.
- The offer-expiry story was wrong in the direction that matters: JSON writes a
  server-side NaN as null, so the old guard already took the untimed branch, and
  had NaN arrived, `formatDateTime` THROWS rather than printing "Invalid Date".
  The guard stays as honest hardening, now with `> 0` so an epoch-0 stamp still
  reads as absence rather than a 1970 deadline, and the tautological test is
  replaced by one that drives the real send path for null, undefined, NaN and 0.
- The small-amount token floor still printed "0" below 5e-7, one order down from
  the defect it fixed. It now falls back to the token's own nine decimals, with
  the one-base-unit case pinned.

Also from that round: the quality colour goes through the shared
`itemNameColor` family module (which owns the fallback token, gives a quest item
the bag's quest gold, and reads the map with `Object.hasOwn` so a hostile wire
quality cannot interpolate a prototype key), and the overlay-figure pin guards
its slice end so it cannot go vacuous on the last row of a file.

A FOURTH round (the repo's own `qa-checklist` over the whole range) closed the
last four:

- The sell tab's "locked items are not listed here" fired for ANY locked known
  item, including a locked stack of cloth the picker would never have offered
  and unlocking would never restore. The view core answers the real question
  now (its own sell filter, lock arm inverted), so the caption is true whenever
  it is shown.
- The seller's fee estimate rode the keystroke on a per-minute bucket SHARED
  with the bond quote, the settlement quote and the refresh: a seller trying
  prices could spend the allowance the payment path needs. It is asked for once
  the price settles; the bidder's live preview keeps its own cadence.
- `woc_balance_chip.ts` was extracted with four faces and no test; it has one,
  decisive against a collapsed tag.
- The rig pinned the BID field's draft carry but not the SELL fields, which are
  the ones that now rebuild under the seller's hands.

The zero-headroom ceiling on the window fired during that work, which is the
ratchet doing its job: the status chrome (spinner, loading line, error line,
the exact end time a countdown carries) moved to `src/ui/woc_market_chrome.ts`
and the ceiling came DOWN to 2621 rather than up.

Judged, no change, with the reasoning:

- The presentation-only claim holds for the rendering, with three deliberate
  exceptions a reviewer should be told about rather than discover: the seller's
  fee preview is a new client-initiated request (now once per settled price),
  the busy label sequences confirming into signing only at the real wallet
  handoff, and the token spelling in the trade log went from four digits to the
  two every other $WOC surface uses.
  (The fitted-960x700 judgment two rows below was SUPERSEDED in the 15 QA
  round: Fernando's sign-off asked for the large window, and the QA round
  shipped it at min(92vw, 1440px) by min(92vh, 920px).)
- The buyer's pre-signature note now says the quote fixes the amount until it
  expires. Verified against the wire rather than taken on faith: a settlement
  carries `quoteReference` plus `quoteExpiresAtMs` and is refused outright when
  either is absent (`server/woc_market.ts`, `quote_unavailable`).
- The arm painter stays in the perf gate's audited bucket with an EXACT write
  allowance rather than moving back to the unscanned cold bucket or routing five
  event-driven writes through the facet. The allowance is stricter than its
  previous classification: a third `textContent` site now fails the gate.
- The currency switch stays a pressed-toggle group rather than the tab-strip
  family: there are no tabpanels, and the previous `role="tablist"` with no
  roving tabindex was the defect. Reuse the family if a third mode lands.

### 15 items closed from earlier phases' deferral lists

The `refreshWocTradeArm` write cache now lives in a real painter file
(`trade_woc_arm_painter.ts`, registered in the perf gate with an exact write
allowance); `updateTradeWindow` resolves `#trade-window` once per controller
instead of on every medium-band tick; the log-tone triple is named once
(`woc_log_tones.ts`); the `[hud]` render-catch prefix names its own module; the
sell picker says why a locked copy is missing; the wallet busy label appears
only at the handoff that actually opens a wallet (never during the challenge
mint, never in the dev economy's devsig arm); and the stale TOTP-bearing
captures are replaced by the fresh set indexed per pair in section K of
`phase-15-design-audit.md`.

## 15 QA round (2026-08-19, verdict PASS-WITH-FOLLOWUPS, every finding applied or judged with the file open, PUSHED per R4)

Release sync first: merge e32f7d8945 of origin/release/v0.39.0 tip ea9377db8e
(136 commits, the druid auto-unshift and the OSSBrain v0.39 train), sole
conflict the generated i18n pending.ts, resolved by regeneration. The
release-merge-audit skill ran on it (nine workflow lanes): every overlap
proven a byte-identical union of both parents, the escrow-restore movement
fix intact with its test, routes, injected helpers and db mocks all clean.
Its one blocking repair: the release growth re-pinned on the monolith ratchet
(sim.ts 12531, server/game.ts 10813, commit 5c67a708cd). Two of its notes
stand as facts for the release fill: 331 marketplace keys pending across the
15 Latin locales (correct at PR tier), and hudChrome.dailyRewards.usd now
reads '{amount}' in the five non-Latin overlays versus '{amount} USD' in the
Latin ones, to reconcile at the fill.

The desk probes the phase file insists on, run by hand: all 79 captures
eyeballed (the finding below), the raw-formatting grep (one pre-existing
toFixed at trade_woc_arm_painter.ts:400, JUDGED correct: it feeds a
type=number input's machine-format value attribute, not a render sink), the
fairness diff (clean: nothing tier-gated, the :empty collapse and owl-spacing
swap shed no actionable read), the behavior freeze (view-core suites
unchanged in assertions, the one selector edit tracks the .trade-actions row
move), and the --panel-border deferral verified on its ratchet with a
decisive non-declaration pin (AGREED, not flipped).

The eyeball's own catch: eleven committed captures were defective, from a
pre-guard rig run and a framing gap (two desktop stress afters under a
session-takeover modal, six under the GPU toast, the ru sell-empty behind the
camera picker, and the four mobile detail captures framed at the window top
so neither consent nor the bond disclosures they are named for was in frame).
The rig gained a per-shot frame selector and its failure-path debug dumps
moved outside the committed directory; all eleven were re-taken on the fixed
rig (commit 2f31d1f0c5) and re-verified.

Five audit lanes ran over the range (correctness, cleanup, test-coverage,
frontend-seam, scoped security), plus a FRESH review of the fix round and the
repo qa-checklist last. Roughly 25 findings; every one applied or judged, the
fix rounds in commits fd3564d82d, b194e576c5, 38c3ed70d1, 5239f1ef28,
5e23abe557. Highest-value: the mobile layout suite's pins were
comment-gameable (the whole file now reads comment-stripped source, and its
reserve and floor pins were the ONLY in-gate coverage of those facts); the
five-fill figure check compared against digits hard-coded in the test rather
than derived from the English, so a rule retune would have passed over five
stale fills (now derived, on digit boundaries); the escrow-restore clone from
the security lane got its non-aliasing regression pin, proven decisive by
mutation; the balance chip's escaping test asserted nothing (now injects a
hostile quote); woc_market_chrome.ts got the direct test its extraction owed;
the Exchange's two name-colour sites joined the itemNameColor family
(Object.hasOwn over a raw map index); and the glued-ticker sweep learned the
template-start and space-less prefix shapes. Judged, no change: the
qa-checklist's ASCII-digit contract question on the five fills is now written
into the test as the deliberate convention of all five locales; the
forced-inset rig arm stays deleted (it assumed what it should test; the
record now says so instead of claiming it runs); the split-dock stamp
tie stays generic to all windows (the design), with a comment-stripped
cross-file pin closing the one-sided rename. DEFERRED with an owner, new: the
Exchange's role=status regions are destroyed and recreated per wholesale
render, so several screen readers will not announce them; the durable fix is
element identity across renders, which belongs to the woc_market_view
pure-core extraction pass the registry already owes (the trade arm, which
keeps its regions, is the exemplar).

Fernando's sign-off came back BEAUTIFUL WITH NOTES, and the notes shipped as
the sign-off round (commit 9bdb94c81e): the desktop Exchange claims its real
estate at min(92vw, 1440px) by min(92vh, 920px) (superseding the fitted
960x700 judgment), every cell sits left-aligned under its header with long
values wrapping to a second line, the sort control leads the padded control
row (extracted to woc_market_chrome.ts as a pure builder, so the window
SHRANK to 2618 and the ratchet followed it down while paying for the new
tooltips), both price cells carry the token equivalence at the live rate as
tooltips, and the phone rows take 12px cells with the first row clearing the
header hairline at 16px. Every Exchange face was re-captured at the new
geometry (commit 57774f4674, four passes, 608 rig checks green); the taller
sell face now shows the fee sentence and commit button that used to sit
below the fold. The capture-set size call the registry left to this session:
KEEP the stress and ru_RU variants; they carried real review weight in this
very round.

Verification on the final tree: the full gate step list run stage by stage
(the artifacts and both freshness gates, the malware scan, biome on changed
files, the FULL vitest suite in four shards, 41,446 tests and zero failures,
the real-browser suite 20 files / 131 tests, tsc, every build including the
client bundle), then the sign-off delta re-proven (the related closure, 36
files / 565 tests, browser suite and builds again). The mobile rig arms ran
live on the merged tree: 608 Exchange checks plus the trade rig's en, ru and
BAGS_OVER arms (128/129/128, the reserve >= measured band assertion held in
both locales). Still open for a real device: the safe-area insets no
headless run can see. Housekeeping: backup-pre-reword-15 is verified
content-free (its tree matches rewritten commit 2dfd1b99de; git cherry all
equivalent) but the delete stayed permission-blocked, so it remains for a
manual git branch -D.

## 16 hot-path-scale (2026-08-19, GAME repo, IMPLEMENT session)

Release sync first: origin/release/v0.40.0 had been minted upstream (tip
e56707a675, seven commits past this branch: the 58-icon revert with its
byte freeze and two CI browser-deps fixes). Merge ee6780bd76 was TRIVIAL
(no conflicts, no source or lockfile overlap, only icons, icon tests and
two workflows), so no release-merge-audit was owed.

The phase closes H11 end to end, five code commits (ab09d6e931 the server
core, 01130fb79b the client cluster, 3d6e7ee99a the dispositions,
1b9bdcdb36 the review fix round, 94d53a243a the TTL rationale):

- Deliverable 1: the five unmetered GETs (status, browse, detail, me,
  history) carry rateLimit(WOC_MARKET_READ_POLICY); the shared read
  bucket resized 120 to 240 against the measured cadences (the Exchange
  awaiting-chain poll is browse+me every 3s, the trade window polls
  offers every 2s), and the policy is TIER-1 ONLY (the review's blocking
  catch: tier-2 'global' spends two rate_limits UPSERTs per ALLOWED poll,
  out-costing the reads the caches remove). The db-backed reads go
  through the new server/woc_market_read_cache.ts (KeyedCachedRead per
  surface: browse pages 3s/128 on the canonical query tuple, listing rows
  3s/256, history 10s/256, activity 2s/512; single-flight, LRU, values
  frozen defensively). Busts ride every mutating handler (the 16-row
  handler-to-surface table pins each by KIND), the three moderation arms,
  and, via a registered hook, the wallet link/unlink writes in db.ts.
  Cache-key entropy is fenced: item ids are shape-screened
  (ITEM_ID_SHAPE), sorted, de-duplicated, empty normalizes to null;
  item-FILTERED browse and UNKNOWN-item history bypass the cache
  entirely. The directed-listing party gate runs per request OVER the
  warm shared row (the two-viewer probe pins it). GET /trade-partner
  moved to the smaller QUOTE bucket (an existence-plus-wallet oracle must
  not inherit the widened polling budget).
- Deliverable 2: myActivity runs its six reads SEQUENTIALLY (the old
  Promise.all drew six of the ten shared pool clients per request) behind
  the per-account cache; the pool-hold bound is COUNTED in both the
  DB-free gauge and the pg suite (peak == 1 against real Postgres).
- Deliverable 3: server/woc_market_price_cache.ts replaces the proxy's
  inline cache: success TTL 15s, failure memo 3s (an outage no longer
  blanks prices and pauses the market for a full TTL), single-flight,
  stale-while-revalidate bounded at 30s so renders never hitch while the
  health gate still converges; a failure never overwrites an in-bound
  success. Estimates moved onto the keyed cache seam (15s/256,
  single-flight per usdCents; an unavailable answer stays cached for the
  full TTL by design, pinned).
- Deliverable 4: WocMarketService.sweepSegments() splits the pass into
  locked db segments (expiry, delivery) and segments the shell brackets
  individually; the read-only confirm polls (chain-polls) run UNLOCKED
  and hold no client across their chain round trips (their writes are
  single-winner CAS transitions, proven under concurrency in the pg
  suite), while the money-moving bond-payouts segment stays LOCKED (the
  fix round's blocking catch: bondsDue is an unclaimed read, and two
  deploy-overlap peers must not both fire a refund RPC; the service's
  reference idempotence stays the second belt). A lost try-lock stands
  the pass down; stop() cuts at segment boundaries; progress is the rows'
  own durable transitions. server/woc_market_sweep_watchdog.ts is the
  mid-flight voice (warn at 60s = one confirm timeout, repeating per
  bound, one overrun scored per pass) and its readout plus the cache
  counters ride GET /internal/woc-market/stuck.

Owed clusters, shipped: the 12/13 QA modularity unit
(server/woc_market_drift_warn.ts extraction judging through the exported
WOC_MARKET_WIRE_PENDING_SET/FAIL_SET, the same Sets the wire screens use;
the server/woc_market.ts monolith row lands at 4500 zero headroom and the
window's came DOWN to 2614 via the wocSalesHistoryHtml/wocSellEmptyHtml
chrome extractions); the 12 QA saleView.item trim (the full InvSlot per
sale row had NO client reader; wire pin retuned); the 04 idle-in-
transaction retrofit (all twelve withTx guards carry GUARD_IDLE with the
typed 25P03 arm, now with a distinct idle-killed warn line and a
per-site distribution pin); the 15 copy-figures cluster (/status ships
the bond schedule mirror {rateBps 500, minCents 100, maxCents 5000} and
bondPendingTtlSeconds 300; bidBondSchedule + bidBondPayWindow render the
resolved figures; sellEmptyFloor + three collectible-variant keys replace
the retired figure-free sellEmpty; six new keys each carry their five
non-Latin fills; tests/woc_market_copy_figures.test.ts pins the
constants and the placeholder discipline); and the 15 scrollIntoView-on-
select cure (block nearest on the detail pane at row tap, exactly once,
never on a poll re-render, rig-pinned with a positive render control).

Decided (the 16-owed judgments): the 50-row offers-inbox cap STANDS with
no pagination now: burying a victim's oldest live offer needs 50+
distinct accounts each holding a live offer at once (the pair-pending
unique index), re-posted every 600s offer TTL against the 10/min create
limiter, and the harm is inbox visibility only (offers self-expire and
escrow nothing); pagination is a wire-plus-trade-window product change,
and 22 re-checks the call against the abuse ledger pre-enable. The 06
estimate-amplifier note is CLOSED by the per-usdCents estimate cache plus
this round's single-flight. The per-actor offer fan-out watch (06/14) is
re-affirmed unchanged.

Re-deferred with owners and reasons: the escrow WRITE-path cluster (05 QA
db-perf P2s: realm-global escrow semaphore, contention-class label,
draining refusal on createListing, FOR NO KEY UPDATE narrowing; the 05/06
escrow-queue observability: pendingKeys gauge, wocEscrowQueue terminal
kind, TxNeverStarted-to-contended widening incl. commitGrant's park arm,
per-listing serialize cost, the saveAll-wave suppression measurement; the
honest occupancy tail with the guild-flush 60s term; the commitGrant FIFO,
still sequenced AFTER the occupancy bound; the local-ledger eviction and
excludeIds growth bounds) goes to a dedicated rider before 22, decided at
the 17 session start: it is write-path work with its own pg review
surface, and this phase's spec is the hot READ path plus the sweep. The
trade-wire diff-cost note (06) rides 22 as measure-and-decide. The p99.9
inter-statement gap measurement and the advisory-cooldown at-scale proof
(04) ride 20/21 (they need the at-scale rig; the 2000ms idle bound is now
at least OBSERVABLE via the distinct 25P03 line). The end-to-end
contention run rides 21; pool-wait observability is partially served now
(watchdog + cache counters on the ops readout) with the pg pool gauge
itself on 17/22. The EXPLAIN list and the priorWinners bound stay 17-led
(its scope line; this phase added no new SQL shapes). The abandons-FK
lock-registry note stays recorded for the 22 runbook. SEC-9 (11 QA): the
game-side half shipped here (estimate single-flight; the 30/min quote
limiter bounds per-account sample injection); the recording-window remedy
is SERVICE-side and rides 22's economics judgment.

Review: four lanes via plain Agent (server-hot-path, database-performance,
privacy-security, test-coverage; the workflow-agentType trap avoided),
roughly 60 findings, EVERY one applied or judged with the file open. The
two blockers are described above (tier-2 cost, bond-payout locking). Other
high-value applied fixes: the browse cache-key comment cited a charset
screen that did not exist (now real), one account could thrash the
128-entry browse LRU with minted filter keys (now structurally
unreachable), acceptOffer left the counterparty's readout stale, the
watchdog had no stop(), the cascade picker's comment still claimed the
whole-pass lock, and the coverage lane's demanded registry-bound test
CAUGHT A REAL BUG (the thunk-registry prune ran before the read minted
its cache entry, so past the 2x threshold it dropped the current read's
own thunk; prune moved after the read, reproduced then green). Judged, no
change (do not re-raise): /status body memoization (the bearer-guard
reads dominate that route's cost), folding the two SET LOCALs into one
round trip (pin churn for sub-ms), pairwise /me concurrency (the
one-client bound is the clearer contract), the aborted-pass zero-stats
report (the main.ts sink already suppresses idle lines; the shape is now
pinned), the detail estimate's cold 5s stall (pre-existing, unchanged by
this diff, bounded by the service timeout), and the deploy-overlap
duplicate confirm round trips (bounded by the overlap window; a per-pass
probe would tax every pass forever to shave a deploy-window cost).

A FRESH review of the fix round itself (the standing rule) found one
blocker and settled it: locking bond-payouts had re-bought a bounded piece
of the camping (lock + client held for up to a whole batch of RPC
timeouts), so processDueBonds now stops its walk at a 30s wall-clock
budget (BOND_PAYOUT_BUDGET_MS): the hold is bounded near the budget plus
one RPC timeout, under the watchdog's alarm, the remainder stays durably
due, and the arm's stat counts rows WALKED so a budget break still trips
the saturation signal honestly (decisive test: one RPC eats the budget,
rows two and three wait). Its should-fixes landed too: shutdown now
unregisters the bust hook (the registry teardown rule), the rateLimit
factory's return type carries the policy-name tag so a future wrapper
dropping it fails loudly, the read policy records its one-process-per-
realm deployment assumption (tier-1 429s still feed the attack-signal
series), and the registry stats comment states the honest 2x bound.
Judged from that round, no change: the db.ts wallet bust keeps the
bustDiscordStatus in-write precedent (an event seam waits for a second
consumer; the writes are autocommit so the bust is post-commit by
construction); the acceptOffer bust stays keyed on the listing field (it
IS the escrow signal, pinned); freezing row.item is itself the guard
against future in-place redaction (a mutation throws in its own tests);
the 25P03 warn is ONE shared arm in withTx (nothing per-site to
interpolate).

The repo qa-checklist ran LAST (the canonical order) and its verdict was
NOT READY on two cheap blockers, both cleared in the closing commit: the
fix rounds had grown server/woc_market.ts 19 lines past the fresh ratchet
row (the one thing every diff-reading lane structurally could not see),
paid by extracting the process-local ledger arithmetic to
server/woc_market_local_ledgers.ts (pruneWocLocalLedgers +
wocBackedOffIds, direct tests; the row re-pins at 4487 zero headroom);
and the ledger files needed committing before a meaningful gate. Its
should-fixes landed too: the ratelimit.ts sizing comment still counted
trade-partner in the read bucket (six GETs now, matching the code and
CLAUDE.md), and its sharpest catch INVERTED my budget-break stat: a
budget-broken bond walk reporting rows WALKED silenced the saturation
signal in exactly the degraded case the budget exists for (the watchdog
deliberately alarms above the budget, so BOTH nets went quiet); the arm
now reports rows FETCHED on a break so the backlog trips the warning, and
the test pins it. Judged from that round: the trade-partner move onto the
shared 30/min quote bucket is a conscious coupling (the lookup is
one-shot on name entry; a bidding player's quote traffic sits well under
the budget); the tier-1-only posture and its one-process-per-realm
premise are recorded at the policy for the 16 QA and 22 to re-judge; the
mobile scroll lands with rig pins and the real-viewport check joins the
16 QA session's E2E list.

The final gate's first run then surfaced an INHERITED red this session's
targeted batteries never selected: tests/focus_restore.test.ts's
namespace sweep demands that any src/ui module touching data-focus-key
import the one reader, and woc_market_chrome.ts has EMITTED the attribute
since the 15 sign-off round moved the browse strip there, with no import.
Verified red at the session-start tip 4cb60d0d3c itself (checked out and
run), so it predates this phase; how the 15 QA's recorded full-suite
green coexists with that is a discrepancy the 16 QA session should note
(the vitest-transform-cache and shard-selection traps are the usual
suspects). Fixed the honest way rather than carried: focus_restore.ts now
exports FOCUS_KEY_ATTR as the namespace's single source and the chrome
builder spells its three focus keys through it, so the sweep passes
because the coupling is real, not because a literal moved.

Validation: tsc; the affected battery (~1,900 tests across the marketplace
and http suites) green; all five pg suites 153/153 zero skips WITH
TEST_DATABASE_URL; ci:changed clean; an early full gate run on the
committed server core passed (exit 0) and the final gate runs after the
docs commit. NEXT = docs/woc-marketplace-hardening/phase-16-qa.md, GAME
repo, worktree wocc-marketplace, FRESH session, newest origin/release/**
sync first; it diffs 4cb60d0d3c..HEAD and pushes on PASS.

## 16 QA round (2026-08-19, verdict PASS-WITH-FOLLOWUPS, every finding applied or judged with the file open, PUSHED per R4)

Release sync first: a NO-OP (the branch already contained
origin/release/v0.40.0's tip e56707a675, the implement session's own sync;
0 behind, no merge commit, no audit owed). The audited range is
4cb60d0d3c..60fc62f3fe (nine commits); the session's own fixes extend it to
the pushed tip.

Audit shape: eight workflow lanes over the phase probes (bust completeness,
cache-key scoping and freeze, limiter-vs-cadence, sweep re-entrancy,
pool-hold counting, price-cache state machine, client cluster and i18n,
values-registry and docs) plus the three typed reviewers via plain Agent
(server-hot-path, database-performance, test-coverage) and the session's
own verification arm; then a FRESH two-lens review of the fix round, a
sixteen-mutant battery (all BIT), a five-mutant residue battery from that
review (all BIT after its fixes), and qa-checklist last. Roughly 85
findings total, zero blocking in the lanes; every one applied or judged.

The session's own verification: tsc; six pg suites 249/249 zero skips and
later the full affected battery 29 files / ~1,240 tests green WITH
TEST_DATABASE_URL; ci:changed clean; both capture rigs run against a live
dev stack at the lowest preset (trade window 128 checks ALL PASSED,
Exchange rig with STRESS seeding 154 checks all passed, closing the
scrollIntoView real-viewport item the implement session flagged); the
16-row bust table checked against the code (no mutating route missing);
the six-GET limiter mounts, the fused ip+account window, the five i18n
fills per new key, sellEmpty's retirement, and the commit hygiene all
re-verified by hand.

The focus_restore discrepancy, CONFIRMED STATICALLY: at the session-start
tip 4cb60d0d3c, src/ui/woc_market_chrome.ts emitted data-focus-key at three
sites with no focus_restore import while the namespace sweep in
tests/focus_restore.test.ts demanded the import, so the sweep was red by
construction there. The 15 QA's recorded full-suite green cannot have run
that state of both files; the usual suspects are the vitest transform cache
after the sign-off-round edits and shard selection (the 15 gate's shards
recorded 41,446 tests, so a stale-transform false green is the likelier).
No action beyond this record: 60fc62f3fe fixed it the honest way and the
suite is green on the real coupling.

The database-performance reviewer returned BLOCK with four P1s; each was
judged with the file open and two were real code defects, fixed:

- P1-1 CONFIRMED: the idle-bound retrofit made 25P03 the first contention
  code insertPendingBid can produce, and its refusal union had no
  'contended' member and no catch, so an idle kill was a NEW raw 500 on a
  player's bid (the site's comment claimed a mapping that did not exist).
  Fixed with the activateBid-shaped tail catch and the typed 409; the
  residue round added its red-provable test.
- P1-2 CONFIRMED: the 2s guard idle bound had been retrofitted onto the two
  save-bearing transactions (escrowInsertListing,
  saveDeliveredCharacterBooked) whose character sanitize+serialize runs
  BETWEEN statements, where Postgres reads CPU work as idle-in-transaction;
  a GC pause or heavy tick there false-fires the kill and costs a delivery
  grant for the pass, against the delivered-save's own wait-out-slowness
  allowance. Fixed with SAVE_IDLE_TX_TIMEOUT_MS 10s at exactly those two
  sites (rationale at the constant), pinned by count, by tier distribution,
  AND by identity in the save-and-book SQL sequence.
- P1-3 PARTIALLY APPLIED: the destroy-on-25P03 is forced (the server
  terminated the session; the socket is dead) and skipping the bound during
  a stall storm would reopen exactly the camping H11 closes, so the
  cooldown proposal was REJECTED; the observability half shipped: a
  process-lifetime idleTxKills counter rides GET /internal/woc-market/stuck
  beside the new priceCache memo ages (the hot-path lane's own ask), both
  source-pinned and behavior-tested.
- P1-4 REJECTED as a practical starvation: the lost-lock break only stands
  the LOSER down, and the segment winner always continues through its own
  delivery and bond-payout tail; a persistent anti-phase requires the
  winner to be mid-lock at the loser's every 5s retry, which chain-poll
  duration variance destroys, and the blast is bounded by the deploy
  overlap with every arm resuming from durable rows. The two-shell
  observation is recorded for 21's devnet run.

Other applied fixes out of the round (commits 1819f8917d, 2303baf2cc,
9f3d53003d, 48fe30cc58, e3bd74c52a): the browse cache now fences DEEP PAGES
(WOC_MARKET_BROWSE_CACHE_MAX_PAGE 2; the page number spans the 400-page
clamp, so one reader inside the budget could churn the whole LRU and every
miss re-buys the OFFSET walk); every mutating handler busts the ACTOR'S
readout on refusals too (the bust lane's catch: guardTerms records consent
and confirm legs record signatures BEFORE a later guard refuses, so the ok-
arm-only bust left /me pre-mutation for a TTL; createOffer gained its bust
for the same reason and the eager-delivery confirm now drops the history
map on its 'confirmed' answer); the caller-less bustHistory was removed;
myActivity gained a between-reads deadline (WOC_MARKET_ME_READOUT_DEADLINE_MS
6s: sequencing had turned one 5s checkout worst case into six back to back,
30s of held socket per poll under saturation); the bond walk's budget break
now joins the SATURATED list (a sub-batch break read as a drained pass by
count alone) and processDueBonds returns the always-equal due.length with
the dead conditional gone; the sweep shell destroys a client whose unlock
answers FALSE; the lock statements are exported constants the shell, the
text pin, and the pg exclusion proof all share; the proxy's shared
estimates are frozen like the read-cache values and peek() hands out
copies; the trade window's partner lookup is TRI-STATE (the 30/min-bucket
move had made a 429 render as a false 'recipient has no wallet' for the
whole trade: the server's 404 is now the only null-partner verdict, any
other failure leaves the arm unresolved with a 5s re-armed backoff and a
sequence guard so a stale failure cannot drop a newer lookup's answer); the
sell caption's QUALITY_WORDS derives from the exported exhaustive label
record; and the fix round's growth paid the monolith ratchet by extracting
the step-up flow to server/woc_market_stepup_flow.ts (the ratchet row's own
named candidate; move-audited faithful, direct tests, row exactly 4487
zero headroom, delivery arms are the next candidate).

Test hardening beyond the mutants (the coverage lanes' demands, all
landed): the 30s bond budget pinned by value and bounded from BELOW; the
acceptOffer table row de-aliased onto a third account with the null-listing
and step-up rows added; the post-stop runOnce pinned at the guard; the
tier-1-only opt-out proven against a recording tier-2 store with a positive
control AND added to the derivation-guard table; the drift-warn same-sets
claim made behavioral in both directions; the real-Postgres advisory-lock
exclusion and the lapse and anti-snipe single-winner races; refusal rows
for ALL eleven busting handlers (the count tripwire is order-blind); the
limiter floor derived from the typed surface field with the admin carve-out
pinned exactly; all five readout-deadline checks proven load-bearing; the
itemIdField charset screen and canonicalization tested at both routes; the
six new keys' five fills placeholder-pinned at PR tier; exact price-cache
boundary and thrown-refresh containment arms; the 25P03 warn-line and
counter test; connect()-aware pool gauges counting all six reads; the
watchdog interval clamp; and direct tests for the extracted step-up flow.

The fresh fix-round review: the correctness lens returned ZERO blocking and
zero should-fix (its move-audit of the extraction found no drift; its nine
nits/notes were applied where actionable: the lookup sequence guard, the
handler-comment scope, the CLAUDE.md citation) and the coverage lens's two
blockers plus six should-fixes were all applied and then proven by its own
five predicted-survive mutants biting.

JUDGED no change this round (do not re-raise): the 2s /me TTL below the
poll cadence (burst collapse is its documented job; raising it would delay
the chain-decided payment transitions the awaiting poll exists to catch);
coarse bustListings under realm-wide mutation rates (single-flight still
collapses concurrent readers between busts; honest arithmetic now at the
method, counters on the readout, 22 checks them at a real mutation rate);
the detail cache's caller-minted ids (evictions cost PRIMARY-KEY point
reads, not the OFFSET or external-service costs the other fences exist
for; asymmetry rationale now in the header); the offers GET staying
uncached (bounded by concurrent trades and retention; the ratelimit.ts
comment no longer over-claims it); the detail estimate arm on the read
bucket (worst-case distinct usdCents per TTL window sits far under the 256
LRU behind the limiter); the sweep's three-checkout overhead and the
locked-segment price probe (bounded by the price cache policy, comment now
honest); the 25P03 warn being unthrottled (bounded by pool size); the
sliding-window copy cost at 240; the NAT-triple 429 cliff (recorded at the
constant, 22 re-judges; the sizing holds two worst-case players with
margin); stop() waiting out a degraded chain-polls segment (supervisor
kill is the deploy backstop, watchdog stays loud; 22 runbook); the
pre-existing pollConfirmingSettlements head-of-line shape (bounded by the
6h review park); the shared-limiter-map eviction judging by the current
call's limit (pre-existing class, recorded); thrown service errors
skipping the actor bust (one tier rarer than the refusal class this round
closed, 2s-bounded); the dev economy's unfrozen estimates (double-gated
off in production); the /me deadline surfacing as a 500 (saturation IS an
incident); the copy-figures indexOf idiom and the last-row parse noise
(fails loud, matches the sibling); the timing side-channel on warm
directed rows (bounded by negative caching and the limiter; the body
contract is intact); and the realm-less cache keys (the one-process
premise is recorded at the policy and the header).

qa-checklist ran LAST and returned READY (0 blocking, 0 should-fix),
verifying the extraction move line by line, the CLAUDE.md claims symbol by
symbol, and the copy floor; its three performance observations join 22's
pre-enable audit: the eager confirm's bustHistoryAll degrades the history
surface toward one shared read per completed sale on a busy realm (the
handler cannot know the item id today; single-flight still collapses
readers), the /me deadline's EFFECTIVE worst case is the 6s bound plus one
in-flight read (about 11s under full saturation, the number an operator
should hold), and the trade-partner retry is uncapped at 12/min against
the quote bucket for the life of an open trade window (an escalating
backoff is the refinement if quote-bucket pressure shows).

DEFERRED with owners (new this round): the per-request auth-guard reads
(requireAccount's two uncached queries per request now dominate every
metered marketplace GET's cost; the highest-leverage remaining server win)
join the escrow WRITE-path cluster in the rider decision at the 17 session
start; the expiry segment's measured full-batch ceiling rides 20/21 with
the existing at-scale items; the two-sweep-shell anti-phase observation
rides 21; the sweep stop() drain semantics, the strike probe's widened
30s SWR window, the offers-cache option, the NAT-triple sizing, and the
cache-counter check at a real mutation rate all ride 22's pre-enable
audit; the pg-suites-in-CI question stays the standing posture (20/22).

Registry corrections landed in state.md: the woc_market.ts ratchet row is
4487 (not the 4500 the mid-session bullet recorded), the budget-break stat
reports rows FETCHED with the break riding the saturated list (the bullet
described the superseded design), and the implement roster is nine commits
(the five it listed plus 6113964df0, 61868970db, 7ebb5491ce, 60fc62f3fe).

Gate: node scripts/gate_select.mjs on the committed tree at 181570b2bd
with TEST_DATABASE_URL only: PASS, all 12 steps green, full-suite fallback
(2,924 files passed + the env-gated perf-budget skip, 41,606 tests + 2
expected fails + the 26 known default skips), browser suite 20/131, tsc,
all builds, malware scan; the five woc pg suites additionally proven
zero-skip in this session's own runs (249/249 and the 29-file battery).
NEXT = docs/woc-marketplace-hardening/phase-17-db-retention-indexes.md,
GAME repo, worktree wocc-marketplace, FRESH session, newest
origin/release/** sync first.

## 17 implement round (database retention, indexes, and deadlines)

Release sync a NO-OP: the branch already sat AT origin/release/v0.40.0's
tip e56707a675 (0 behind, no merge commit, no audit owed); session start
tip 4799b24dc2, tree clean. The SESSION START DECISION on the deferred
perf rider scope is recorded in state.md: NEITHER cluster lands in 17;
the escrow WRITE-path cluster and the per-request auth-guard-read
cluster each go to their OWN dedicated rider before 22 (escrow first,
auth-guard second, both ideally after 19 and before 21 so the devnet
contention run measures the shipped shapes), with the reasons and the
auth rider's design constraints in the state.md entry.

Premise re-verification first (the findings context was dated 2026-08-11
and partially stale): deliverable 1's query-shape fix was SUPERSEDED by
the 14 round (the non-partial _buyer_all/_seller_all indexes and a
one-row EXPLAIN pin already shipped), leaving the realistic-row-count
proof, the settlements LATERAL index, the consolidated EXPLAIN list, and
the priorWinners bound; deliverable 2's offers half shipped with 06 (all
four terminal statuses swept, verified), leaving custody claims as the
live work; deliverable 3's FK-cascade columns touched by MARKETPLACE
deletes were ALL already covered (06/14), and the four uncovered FK
columns are accounts-cascade only, DECIDED not indexed: the only hard
accounts DELETE in the tree is the federated-provision race loser
(deleteUnusedFederatedProvision, server/federated_auth_db.ts; the QA
round corrected this entry's original server/db.ts cite), which by
construction deletes fresh
unused accounts that cannot own market rows, and user-facing removal is
a soft delete that fires no cascade, so four permanent write-amplifying
indexes on the hottest tables would serve a scan that cannot fire (the
QA session re-judges); deliverable 4's buy-now half already carried the
full posture, leaving insertPendingBid and activateBid.

THE VALUES REGISTRY the 17 QA re-judges:
- Custody-claims retention: pruneBookedWocCustodyClaimsBatch, BOOKED
  rows only, aged on booked_at behind the new partial cursor
  woc_market_custody_claims_booked (booked_at) WHERE booked_at IS NOT
  NULL; window WOC_MARKET_CUSTODY_CLAIMS_RETENTION_DAYS default 365, a
  full year comfortably above the listings window BY DESIGN (booked_at
  is stamped at or before the listing's closing updated_at, so an equal
  window could prune the claim first); a parsed-ref referent guard (bare NOT EXISTS
  primary-key probes off regex-guarded CASE parses of the three mint
  shapes woc_settlement:/woc_listing_return:/woc_listing_sold:, digit
  bound {1,18}) means a claim whose settlement or listing row survives
  NEVER prunes whatever its age; malformed legacy refs prune on the
  window alone (fail-open, judged: the pre-enable deploy note requires
  the table empty-or-booked, and the minter-regex pin makes a fourth
  unparsed shape impossible to ship silently). The ctid outer keeps the
  DELETE a Tid Scan (a concurrently moved row misses and prunes next
  batch, the safe direction). Unbooked rows in every attribution state
  are structurally out of reach and the never-delete operator rule
  stands. Registration sits BEFORE the woc_market_listings tail entry.
  A BOOT WARNING (wocCustodyClaimsRetentionWarning, unit-tested pure
  helper) fires when the custody window sits at or below the listings
  window or when listings retention is keep-forever (which silently
  disarms this prune; also documented at the .env.example row).
- Step-up drain: pruneExpiredWocStepUpChallengesBatch, knobless BY
  DESIGN (expired nonces are garbage, not history; prune-on-issue stays
  the primary reaper; this entry only drains realms that stopped
  issuing), WOC_STEPUP_PRUNE_SLACK_DAYS = 1 day past expiry, no ORDER
  BY (unindexed global cutoff, the abandons rule), O(table) per batch
  ACCEPTED and stated at the docstring with the measured figure.
- Indexes: woc_market_listings_live_price_desc (realm, COALESCE(
  current_bid_cents, start_cents) DESC, id) partial on the live set (the
  ASC id tiebreak shared with price_asc is exactly why a backward scan
  of the ASC index cannot serve it; the +1-index-per-bid write cost is a
  stated trade); woc_market_settlements_listing_latest (listing_id, id
  DESC) serving both the FK cascade and the offers reads' LATERAL
  latest-settlement probe, superseding woc_market_settlements_listing
  via create-before-drop idempotent DDL (upgrade path proven by
  recreate-then-reapply in the settlement pg suite).
- Deadlines: insertPendingBid and activateBidTx gained SET LOCAL
  lock_timeout = ESCROW_LOCK_TIMEOUT_MS (2000), completing the set: ALL
  TWELVE withTx guards now carry BOTH bounds, ratcheted by the
  completeness floor (per-site full-literal + count). Held-lock pg
  tests prove both bid paths answer the typed contended 409 with
  elapsed in [1500, 10000) ms against the 15s session ceiling. 55P03
  fires now count (wocMarketLockWaitTimeoutCount, incremented in the
  isLockContention classifier, single-count audited across all 12 call
  sites) beside idleTxKills on the stuck readout; the counters are
  proven to partition the codes in unit AND real-pg tests.
- priorWinners: nextCascadeBidder(listingId, minCents) derives the
  won/defaulted exclusion per ACCOUNT in SQL (NOT EXISTS, outer table
  aliased so the correlation cannot silently self-reference); the
  cascade arm no longer fetches bidsForListing, removing the unbounded
  per-overdue-settlement read AND the unbounded array; the fake mirrors
  the derivation and an always-running SQL-floor pin holds the shipped
  text (the coverage lane's blocker: without it the merge gate only
  exercised the fake).
- Observability: GET /internal/woc-market/stuck gains the pgPool
  occupancy gauge {total, idle, waiting} (the 16-deferred pg pool gauge
  itself; sustained waiting > 0 is the brownout precursor) and the
  lockWaitTimeouts counter.
- The monolith ratchet RE-PINS server/woc_market.ts at 4484 (the
  cascade fold shrank the coordinator; headroom is never left to
  re-consume). woc_market_db.ts (no ceiling) carries the prunes beside
  its retention siblings.

The consolidated EXPLAIN list landed as the NEW pg suite
tests/woc_market_plan_pins_pg_integration.test.ts (recording-pool
capture of the SHIPPED statements, EXPLAIN under SET LOCAL
enable_seqscan = off in rolled-back transactions, plan CLASS asserts
anchored to the queries): the poll read at REALISTIC row counts (5,000
offers, 1,000 listings, 3,000 terminal settlement attempts, ANALYZEd;
natural-cost preference proof for the account indexes AND the LATERAL
composite, the acceptance criterion), all four browse sorts as ordered
sortless index walks, the five stuck-readout classes, the redrive page
(one JUDGED relaxed pin, rationale in place: under LIMIT the uniform-
distribution assumption lets a filtered pkey walk tie the live partial
at any fixture scale, so the decisive asserts are the natural-cost
no-seq-scan plus the DB-free literal index pin), the two rotation-order
reads, the sold-residue dispose, the buy-now cooldown ledger probes,
the offer expiry and converge probes, the cascade pick, and the
booked-claims prune itself. The two 02-round boot-repair quals were
EXPLAINed one-off against the grown rig rather than pinned (their
origin was measure-before-enable): both short-circuit behind an
InitPlan one-time filter on the index-validity probe on every healthy
boot, the settlements body when armed is bounded by the OPEN set via
open2, and the sales body's seq scan fires at most once per legacy
upgrade under the boot lock, exactly the DDL comments' claims; recorded
here, item discharged.

Review rounds: database-performance-reviewer, migration-safety, and
test-coverage-auditor ran as plain Agents over the committed diff;
roughly 45 findings, EVERY one applied or judged with the file open.
The headline (both db lanes, independently measured): the first cut's
IS-NULL-wrapped referent probes compiled to hashed SubPlans that seq-
scanned the whole settlements table per batch, contradicting the
docstring; fixed with the row-set-identical bare NOT EXISTS (anti-join
primary-key paths) plus the ctid outer, and the prune now carries its
own plan pin so the class cannot regress silently. Also applied: the
minter-regex correspondence pin (a fourth custody-ref shape cannot
silently fall to window-only retention), the boot warning + relation
assert + .env.example coupling note, the 55P03 counter with partition
proofs, the digit-bound regexes, the cascade outer alias, the live
sold-notice referent arm (the one referent-guard alternation arm the
matrix missed), staged-batch idempotence, the real-SQL drain test, the
natural-mode redrive assert, the plan suite's module-pool leak, the
FOR-UPDATE slice-bound guard, and the per-slice full-literal lock pin.
JUDGED no change (do not re-raise): the sticky-prefix gauge (a claim
blocked by a live referent for 365+ days means a deal the monitor has
been screaming about for a year; post-enable measurement, 22); the pool
gauge staying instantaneous and single-pool (the high-water refinement
and the multi-pool readout ride the rider/22 observability work); the
stuck-readout plan case's empty-table joined-plan shape (the seqscan-
off recipe is decisive on usability by design; per-class index names
are distinct); the residue probe's three-way alternation (all three are
legitimate O(small) paths, commented in place); the natural-cost
preference proof's planner-version sensitivity (accepted, header
discipline); the interval-overflow family on huge retention-days
values (pre-existing across every sibling prune); the boot DROP INDEX
ACCESS EXCLUSIVE hold (pre-enable-empty, exact precedent on the same
table); the dump/restore sequence-reuse exotic (item-loss direction,
visible, recorded); and the 409-visibility change on contended bids
(intended: typed, counted, and retryable beats camping a pool client).
A FRESH reviewer then audited the fix-round commit itself (the
standing rule); its findings and dispositions close the round (see the
fix commits).

The fix-round reviewer (fresh, empirical) found no blockers and two
should-fixes, both applied in 32cecb3de4: the new prune plan pin passed
verbatim on the REVERTED shape (its hashed SubPlans feed off index-only
scans, dodging every seq-scan assert), closed with a no-SubPlan assert;
and the step-up drain test's whole-database exactness premise would
have gone red around September 2027 when the real clock passes the
BASE_MS-anchored sibling fixtures, closed by scoping to per-nonce
asserts. Its nits landed too (the activateBid arm's 55P03 counter
assert, the warn-consumption pin, the honest keep-forever copy, the
minter-suffix naming contract stated at the docstring); judged from
that round: the side-effecting is* classifier (single-count argument
verified at all call sites and covered by the partition tests) and the
{1,18} reclassification of 19-digit ids (unreachable for bigserial, and
it closes the poison-row 22003 hazard the unbounded regex carried).
qa-checklist ran LAST and returned READY (0 blocking, 1 should-fix:
the claims-prune ordering comment overstated the plan on small
fixtures, softened, with the load-bearing classes held by the plan
pin's no-SubPlan/no-seq-scan asserts; its notes are recorded: the
elapsed-band flake exposure is accepted at 5x headroom, the 365-vs-360
DOUBLE prose was corrected to "a full year, comfortably above", and
the NaN batchSize pass-through is the pre-existing house shape).

Commits: 3a3c13ce27 (feat: retention, indexes, lock bounds, cascade
fold, pool gauge), e2eceb2438 (test: retention/deadline/plan-class
coverage), 0fb0359113 (fix: the review round), 32cecb3de4 (test: the
fresh-review fixes), 7f3b1ab05a (docs + the qa should-fix),
168b50966a (test: the duration-ratchet fit; the first gate run's ONE
red was the new plan suite declaring 720s of summed 60s allowances
against the 300s default for two-second cases; the 20s house standard
fits under the ratchet, which counts only allowances above 20s), plus
the wrap commit.
LOCAL per R4: nothing pushed; the 17 QA session pushes on PASS.

Validation: tsc clean; ci:changed exit 0; the full DB-free market and
guard batteries green (roughly 900 tests across the touched suites);
ALL SIX pg suites green against dev Postgres with TEST_DATABASE_URL
(plan-pins 10/10, delivery+stepup+bond 85, settlement+directed 76,
zero skips proven by count); qa-checklist additionally re-ran tsc,
biome, the malware scan, and every pg suite itself and EXPLAINed the
prune independently. The gate (node scripts/gate_select.mjs with
TEST_DATABASE_URL only, committed tree) then ran twice at session
close: the first run FAILED on exactly the suite-duration ratchet
(fixed in 168b50966a, above), and the rerun on the final tree PASSED:
all 12 steps green, full-suite fallback (2,925 files passed + the
env-gated skip, 41,627 tests + 2 expected fails + 26 known default
skips), browser suite 20 files / 131 tests, tsc, all builds, malware
scan.

NEXT = docs/woc-marketplace-hardening/phase-17-qa.md, GAME repo,
worktree wocc-marketplace, FRESH session, newest origin/release/** sync
first; it diffs 4799b24dc2..HEAD and pushes on PASS.

## 17 QA round (database retention, indexes, and deadlines)

Release sync a NO-OP: the newest release branch is origin/release/v0.40.0
(tip e56707a675) and the branch already contained it fully (0 behind, no
merge commit, no audit owed). Audited 4799b24dc2..0d1c5729a1 (the seven
implement commits); tree clean at start, dev Postgres up, all six pg
suites green on the audited tip (171 tests, zero skips proven by count)
and the six DB-free touched suites green (494) before any lane reported.

VERDICT: PASS-WITH-FOLLOWUPS, every finding applied or judged with the
file open, PUSHED per R4. Nine audit lanes (database-performance,
migration-safety, and test-coverage-auditor as plain Agents; six
workflow lanes: deliverable correctness, the never-sweep set, EXPLAIN
honesty, lock_timeout scope, cadence-vs-growth arithmetic,
dead-code/doc staleness), then a FRESH reviewer over the fix round,
then qa-checklist LAST. ZERO blocking findings against the implement
round itself anywhere; qa-checklist's one blocker was against THIS
round's own first CLAUDE.md truth-up (see below), fixed and re-gated.
Roughly 45 findings total across the lanes (4 should-fix, ~15 nits,
the rest notes), every one applied or judged.

THE NEVER-SWEEP VERDICT (the QA file's named deep probe): SOUND, by
three independent lanes plus the session's own read. Unbooked claims in
every attribution state are structurally unreachable (booked_at IS NOT
NULL, text-pinned and pg-proven at 400d age); live settlement/listing
referents shield their claims at any age (all three mint shapes proven
per dimension, review-state settlements included, so open disputes
survive); re-drive after prune is impossible by construction (every
driver starts FROM a settlements/listings row; the mail book is a
passive dedupe; pendingMail/pendingGrants are process-local; BIGSERIAL
never reuses ids); the claims-before-listings registration order adds a
full sweep-day between referent deletion and claim eligibility; the
monitor's unbooked readout is asserted intact post-prune; the phase-03
never-delete-unbooked operator rule stands with every doc surface in
agreement. The prune's referent guards precede ORDER BY/LIMIT, so a
blocked cohort can never starve a batch (NO livelock).

RE-JUDGMENTS the registry asked of this session, all UPHELD:
- accounts-FK columns NOT indexed: upheld. The four uncovered columns
  are exactly woc_market_listings.seller_account/.directed_buyer_account
  and woc_market_directed_offers.seller_account/.buyer_account; the only
  production hard DELETE of accounts is the federated-provision race
  loser (server/federated_auth_db.ts; the registry's server/db.ts cite
  was corrected), whose predicate (no password, no tokens, no links)
  cannot own market rows; player removal is a soft delete
  (deactivated_at) firing no cascade. Recorded caveats: dev/bench
  teardown scripts bulk hard-delete their seeded accounts and would pay
  seq scans on a marketplace-populated dev database (dev-only cost);
  woc_market_stepup_challenges_account's DDL comment justifies itself by
  the accounts-cascade scan this decision declares unable to fire
  (pre-existing mild tension, harmless). The decision is now a CATALOG
  COMPLETENESS FLOOR: the settlement pg suite queries
  pg_constraint/pg_index for uncovered FK first columns (partial and
  INVALID indexes excluded) and pins the result to exactly the four
  allowlisted columns, so a future child table cannot ship an uncovered
  FK silently.
- The relaxed redrive plan pin: sound as recorded; the explain-honesty
  lane empirically confirmed the pin is insensitive to live_ids'
  existence at ANY fixture scale, so the DB-free full-column literal pin
  carries the weight, exactly as the rationale states.
- The 365-vs-180 window relation, the fail-open unparseable-ref
  decision, the knobless step-up drain, the ctid outer, the twelve
  lock-bound sites, the counter partition, and the values registry
  figures: all verified as recorded (one prose miscount fixed: 12
  classifier call sites, not 13).

FIX COMMITS (each validated, the fix round re-reviewed FRESH):
- 30b3097e6a fix: the delivered-save guard gains a count-and-rethrow
  classifier tail (the ONE withTx guard whose 55P03, on the most
  contended lock in the market, never reached lockWaitTimeouts; routing
  to commitGrant's transient arm unchanged); prose trued where reviewers
  measured drift (claims-prune docstring now states the O(blocked x
  batches) nightly cost shape, the 15s-ceiling wedge direction, the
  next-NIGHT ctid-miss consequence, and the shared no-lock_timeout
  prune rationale; price_desc carries the measured write cost, about
  +8% per bid-price update and roughly +290 WAL bytes/row, and the
  deep-page sort caveat; activateBid states the per-STATEMENT bound).
- 727f71c88c test: the plan suite's realistic fixture moved to
  beforeAll (a -t filtered run planned the prune probes against
  near-empty tables and failed the pkey pins: reproduced, fixed,
  re-proven both ways); the prune case gained ANALYZEd ballast plus a
  NATURAL-cost probe (no SubPlan, no referent-table seq scan) so a
  cost-model flip cannot hide behind the seqscan-off crutch; the
  cascade case gained a second listing (per-listing exclusion now
  behaviorally decisive in-suite); price_asc stopped accepting its
  _desc name-prefix twin; the FK completeness floor and the custody-ref
  prefix containment scan landed; the delivered-save 55P03 test and the
  40P01 neither-counter row pin the partition; the completeness floor
  adopted the shared comment stripper; one prunable delivery row keeps
  a recent claimed_at so an ageing-column swap fails behaviorally.
- fafe5e5afe fix: the containment scan gained a scanned-count positive
  control (297 files vs a floor of 100) and exact root-relative
  allowlisting; five comment truths from the fresh reviewer (classifier
  accounting names the no-winner close tail; activateBid admits the
  raced third statement; the step-up drain names the straggler consume
  as a second writer; the cooldown comment describes the measured
  account-first plans; the poll fixture comment states the real 100x50
  seller / 50x100 buyer spread).
- ebe9b24662 fix: qa-checklist's blocker: the retention bullet in
  server/CLAUDE.md claimed unset keys keep forever; EVERY retention
  window has a positive code default (verified at numberOr and all 21
  knobs), so the bullet now states the true contract (unset prunes at
  the documented default; 0 is the explicit keep-forever; the untrimmed
  read makes whitespace fail safe). Plus the cooldown pin comment
  aligned to its honest strength and indisvalid added to the FK floor.
- 5419d66455 docs: registry cites corrected (federated_auth_db.ts; 12
  call sites) and the phase-22 ops caveat gained the REVERSE mixed-fleet
  direction: an old-binary boot RE-CREATES woc_market_settlements_listing
  and the next new-binary boot drops it again, each flip under ACCESS
  EXCLUSIVE; free pre-enable only.

MUTATIONS (run by this session on committed trees, all five BIT):
IS-NULL referent rewrap -> the no-SubPlan plan pin AND the text pin
(hashed SubPlans visible in the failing plan); listing-regex narrowed to
return-only -> the delivery sold-notice behavioral assert AND the
minter-correspondence pin; booked_at->claimed_at ageing swap -> the
delivery behavioral assert (NEW: before this round's fix it was
text-pin-only); insertPendingBid lock-bound dropped -> the per-site
completeness floor by name; the delivered-save tail dropped -> its
dedicated counter test.

JUDGED no change this round (binding, do not re-raise):
- The migration lane's third warn arm for custody window <= 0: REJECTED.
  An own-knob 0 is an explicit documented choice (0 = keep forever at
  the .env.example row) and the safe direction for the ledger; the boot
  warn exists for CROSS-knob surprises (listings keep-forever silently
  disarming THIS prune), and every sibling knob treats its own 0
  silently. Warning on a documented legitimate setting is noise.
- dbperf F1 blocked-prefix cursor: the docstring-statement arm was
  taken (the finding's own alternative); a within-run booked_at
  low-water cursor is recorded as the shape to reach for IF the blocked
  set ever grows (healthy-state B is near zero; a blocked claim is a
  stuck deal the monitor reports).
- dbperf F4 prune lock_timeout: accepted with the rationale now AT both
  docstrings (terminal unlocked rows / same-garbage racers, sibling
  consistency, 15s ceiling).
- dbperf F7 counter granularity (no per-site split) and the
  instantaneous single-pool gauge: coarse is the design; per-site
  splits and high-water marks ride the rider/22 observability work.
- dbperf F8 merging the two SET LOCALs into one round trip: REJECTED
  for idiom consistency across all twelve sites; the saved round trip
  is noise against the 2000ms bound and the split form keeps error
  attribution clean.
- The lock-scope lane's plain-statement writer class (sharpest: the
  contended-arm clearBuyNowLock cleanup can camp a client for the 15s
  ceiling and surface 57014 raw): PRE-EXISTING, deferred to the escrow
  WRITE-path rider (below). The finalize docstring was judged accurate
  as written (it names only guard operations).
- The claimBuyNowLock peek-catch classifier arm being unreachable for
  55P03: correct and safe, no change.
- The cooldown arms' index choice (_once vs _account): either is a
  legitimate cost pick over a capped-tiny table; the banned class is
  the seq scan, asserted per probe; the comment states this.
- The never-sweep lane's cross-run DB-coupling note: REFUTED with the
  file open (each pg suite owns a distinct disposable database and
  drop-creates it at beforeAll, so aborted-run residue self-heals and
  cross-suite contamination is impossible).
- The dead-code lane's pre-existing write-only walked counter in
  processDueBonds and the woc_market_db.ts no-ceiling status: recorded
  maintainer items, not this round's regressions (the counter cleanup
  belongs to the next round that touches woc_market.ts, paying the
  ratchet DOWN).
- The immutable 'double the listings window' framing in 3a3c13ce27's
  commit body: living docs carry the corrected prose; nothing to do.
- Measured figures now living in comments (+8%/+290 WAL bytes, 6.8x,
  4.5ms at 23k): sourced from lane measurements, falsifiable, accepted.
- The containment scan's residual (a ref assembled by concatenation or
  a NEW prefix family): stated in the test and at the prune docstring;
  the naming contract remains the guard for the unknowable arm.

DEFERRED with owners:
- Escrow WRITE-path rider (per the 17 SESSION START DECISION): the
  plain-statement row-locking writers outside withTx (clearBuyNowLock
  after a contended refusal is the sharpest; also markBidStatus,
  setBondState, lapseBid, transitionSettlement and siblings) wait under
  the 15s ceiling with no typed refusal and no counting; bound or
  classify them there. Also the F1 low-water cursor if blocked-prefix
  growth is ever observed.
- Rider/22 observability: per-site lockWaitTimeouts split or rate,
  pgPool high-water, the sticky-prefix gauge (already judged).
- 22 runbook: a booked claim is the last game-side trace that a memoRef
  delivered; after this round that trace is bounded at 365 days (the
  settlement row already died at 180), so the reconciliation procedure
  must not assume claims rows for old memoRefs. Also the nightly
  deletion ceiling grew by up to 100k rows/night (two new entries at
  50k each) and the listings budget counts PARENT rows only (cascade
  fan-out multiplies physical deletes ~5-15x); both belong in the
  deploy note if the sweep hour ever moves toward traffic. The sweep
  hour's PROVISIONAL 05:00 UTC sits in US-evening peak; the revisit
  note stands with numbers.
- Maintainer: whether server/woc_market_db.ts (4,622 lines, mostly SQL
  and schema) gets a monolith ratchet row.

Validation on the final tree: tsc clean; ci:changed scope green (biome
errors none, warnings pre-existing); the touched DB-free suites green;
all six pg suites green against dev Postgres with TEST_DATABASE_URL
(plan-pins 10/10 whole AND -t filtered, delivery 34, settlement 50 incl
the new FK floor, bond, stepup, directed; zero skips proven by count).
node scripts/gate_select.mjs PASS twice: on the audited-plus-fixes tree
at 5419d66455 (all 12 steps green) and again on the final code tree at
ebe9b24662 after the qa-checklist fix (all 12 steps green; the wrap
commit on top is docs-only).

PUSHED per R4: origin feature/woc-marketplace advanced from 4799b24dc2
to the wrap-commit tip (recorded in state.md), pre-push floor green; no
PR exists on the branch so no PR CI to watch.

NEXT = docs/woc-marketplace-hardening/phase-18-dashboard-guardrails.md,
DASHBOARD repo, worktree /Users/fernando/Documents/woc-rewards-dashboard-pr13,
branch integration/woc-market-trading, FRESH session, own origin/master
sync first.

## 18 QA round (verdict PASS-WITH-FOLLOWUPS, every finding applied or judged)

DASHBOARD repo, worktree /Users/fernando/Documents/woc-rewards-dashboard-pr13,
branch integration/woc-market-trading. Session start e82303e (the 18 implement
tip AND the PR #13 remote branch tip); origin/master sync a NO-OP. Game branch
feature/woc-marketplace verified 0 behind the newest release (origin/release/v0.40.0
e56707a675), so the game-side push is the 1-ahead docs commit only. Audited the
implement diff c001d4a..e82303e (ten commits). Validation held by hand (no
reviewer roster or gate in the dashboard repo): npm test, npm run check, npm run
build.

SIX fresh coverage lanes (security, correctness, test-decisiveness, decimals
direction, dead-code/docs, React render safety) over the whole range. ONE
blocking finding, real and headline: the game proxy's host-pinning bypass. The
allowlist stripped a leading slash for its check but the upstream URL was built
from the RAW params.path, so a request written /api/game//internal/... (Astro
captures params.path with a leading slash) made new URL('//internal/...', base)
protocol-relative and would send DASHBOARD_INTERNAL_SECRET to host 'internal'
(proven in node: host resolves to 'internal'). Fixed by mirroring the sibling
payout proxy's canonicalProxyPath (new canonicalGamePath: full decode, refuse a
residual percent, strip leading slashes, collapse traversal, re-check the
normalized output for a re-introduced percent) and building the URL from that
normalized value; the allowlist is exact-match so only the two literal safe
strings can reach the URL builder. Mutation-proven: reverting the call fails the
new host-integrity test. The four named probes all verified sound by hand before
the lanes: the proxy bypass hunt found the gated catch-all as the ONLY reach to
GAME_SERVICE_URL / the secret in src (list views go through /api/game/); roles
resolve server-side from the httpOnly sameSite=strict session cookie (nothing
client-forgeable); decimals cover both directions (withdraw submit uses the same
source, the trading panel submits no amounts); the forfeit confirmation binds to
the specific reference tail with a decisive stale-consent cross-bond test; the
actor-id-survives-rename test is decisive.

The rest of the ~45 lane findings were applied or judged with the file open.
Headline applied fixes: object-valued render leaves are now screened in
market_summary_load (a JSON object where a scalar belongs threw "Objects are not
valid as a React child" and, with no error boundary above the panel, unmounted
the whole tab, exactly the blast radius e82303e claimed to close); OPERATOR_LOCALE
extracted to one module and routed through the market view core, the shared USD
formatter and the list views, pinned by value AND a source scan; the headline
rate and sample-window figures extracted out of inline JSX into the tested view
core; bpsToPercent junk-checks; USDC_MINT_DECIMALS and SOL_DECIMALS added so the
bare-argument decimal sites the scan cannot see share one source (the scan gained
inverse/leading-zero exponent arms, a wider file filter, a fixed negative control,
and documented escapes); the .wm-over-balance section-error class renamed to the
honest .wm-error-line; legsReconcile's docstring corrected to the sanity check it
performs; the big-number probe rewritten to diverge provably at a representable
value; the release-form keep-on-failure decision extracted to a helper. Sixteen
new-pin mutants all bit.

FIX ROUND RE-REVIEWED FRESH (three lanes over e82303e..HEAD, the unreviewed fix
code): five real defects found and fixed in a second wave. (1) releaseSubmitOutcome
was decorative (called only with a literal true; failure bypassed it); the panel
now routes BOTH outcomes through it at one join point. (2) The leaf screen missed
leaves the view core COERCES rather than renders raw (pause.reason/actor into a
template, price.reason into a computed property key, attention counts into a `>`
comparison, leg strings into legsReconcile's regex test) which a JSON object with
no callable toString throws inside during render; all now screened, plus a
defense-in-depth typeof guard in legsReconcile. (3) describePriceReason(missing)
said "Price is healthy." beside the "Halted" label; it now reads "No price reason
reported." and the healthy detail is hardcoded on its own branch. (4)
sampleWindowLabel rendered junk as "0 over 0m", counterfeiting the real
insufficient-samples halt state; now "-". (5) TreasuryBuyAndBurnPanel still had
two bare SOL 9s contradicting the new SOL_DECIMALS comment; routed through the
constant. The round-2 pins all bit (R9 legsReconcile defense-in-depth needed a
direct unit test since the loader screen made it unreachable otherwise).

JUDGED no-change (binding unless a later session overrules; do NOT re-raise):
- Halt/Resume control unavailable during an overview outage: the implement round's
  deliberate decision (a blind pause toggle without the current state is its own
  hazard), re-confirmed. A state-independent halt needs a service surface.
- 404/405 decided before the auth 403 (path-probing oracle): matches the sibling
  proxies; the middleware 401s an anonymous caller before the handler in
  production, and the two-path allowlist ships in the client bundle. No leak.
- auditActorDisplay mis-parsing a legacy value shaped like the composite: usernames
  are charset-constrained (no spaces or parens), so no current row can match, and
  the fallback is fail-safe.
- The recycled-username test decisive only jointly with the exact-format pin, and
  the submit-direction claims: verified sound.
- formatUsd swap and canonicalGamePath widening (percent-encoded allowlisted paths
  now proxy) are deliberate, safe behavior changes; note them in the PR body.

DEFERRED to 19 (dashboard tooling: CI, tests, investigation UX, the component
harness), with owners:
- The component-render harness for the JSX wiring pins (tes-2 from the implement
  round, plus the validateReleaseSubmit-before-POST money guard, the
  auditActorDisplay+title pattern, the loader-ref wiring): 19 owns the harness.
- The MarketListViews stale-response-wins race and shared busy flag (apply the
  createSummaryLoader supersession pattern to the list views), and the
  quotes/list loading affordance on a filter change (the mixed-epoch window).
- The ambient-locale money helpers still on the host default (ClaudiumPurchasesPanel
  baseUnits/whole/token, TreasuryBuyAndBurnPanel formatBaseUnits, App.tsx formatSol,
  DiscountsPanel): the existing 19 ambient-locale item, now itemized.
- The wocDecimals runtime reconciliation guard/banner (the divergence window is
  documented in woc_mint.ts; 19/22 own the guard and asking the service to report
  wocDecimals on the market payloads).
- WOC withdraw submitted before the wallets payload lands (converts at the fallback
  constant, skips the balance check; benign while the constant tracks the live mint,
  the tested fix needs the harness).
- Submit error/notice persisting across subtab switches; the tablist ARIA
  completion; the status-pill warn/error styling; release reference uppercase-hex
  leniency.

CLAUDE.md: the token-figures convention now names all three exponent constants and
the bare-argument rule; the view-core rule scoped to new and changed code; the
audit-actor cross-repo bound noted as service-owned. Verified against the code.

Commits (dashboard repo, session range e82303e..HEAD, EIGHT): 70c3e12 proxy
host-pinning, 2859622 render-leaf screening, 596de8b formatter hardening + locale
single-source, 5492f59 USDC/SOL constants, 3a4dca8 release-form + panel wiring +
class rename + docs, 132a3f9 (round 2) coerced-leaf screening + halted status
line, 2e8344a (round 2) outcome routing + proxy percent recheck + treasury
decimals + locale scan, ae6e46c CLAUDE.md token constants. Validation on the final
tree: npm test 183 pass 0 fail (baseline 164), npm run check 0 errors (the one
pre-existing App.tsx React.FormEvent hint untouched), npm run build complete.
Range c001d4a..HEAD swept: zero em/en dashes, zero emojis, no "phase" in commit
text. Pushed per R4 to origin/feature/woc-market-trading-controls (PR #13).

## 18 implement round (dashboard guardrails)

DASHBOARD repo, worktree /Users/fernando/Documents/woc-rewards-dashboard-pr13,
branch integration/woc-market-trading. Session start c001d4a, which equals
BOTH the recorded PR #13 tip and origin/feature/woc-market-trading-controls,
so the 2026-08-11 review premises were written against exactly this tree;
the origin/master sync was a NO-OP (3654e92 already an ancestor). Baseline
validated green before any change: npm test 131, npm run check exit 0,
npm run build exit 0. LOCAL per R4: NOTHING pushed in either repo; the 18
QA session pushes on PASS.

PREMISES RE-VERIFIED FIRST (all four finding clusters still live at
c001d4a; review.md line numbers are stale because 80e8988 split the
Trading React into MarketTradingPanel/MarketListViews plus view-cores,
but every defect survived the split):
- H1: the game proxy checked only locals.user, with a comment claiming
  there was nothing to narrow; the page-level tab gate
  (canManageMarketSettlement) never covered a direct /api/game request.
  Payload precision for the record: the two game reads carry seller and
  buyer names, item ids, prices, statuses and tx signatures, NOT raw
  wallet addresses (review.md's "wallet addresses" wording belongs to the
  service overview, which was already internal-gated); the internal-only
  classification stands on the trading-history content.
- H2: WOC_DECIMALS = 9 in market_trading_view.ts vs the live mint's 6;
  the Claudium panel already preferred service-reported wocDecimals with
  literal 6 fallbacks; TreasuryBuyAndBurnPanel's 1_000_000_000n sites are
  SOL lamports (9 is correct there; allowlisted in the sweep).
- Release regex accepted WM[BS]_; forfeit fired on one unconfirmed click;
  releaseTo survived a successful forfeit; the economy proxy sent the
  bare username as x-woc-economy-admin-actor (the service records it
  verbatim, 200-code-point intake bound); load() was one Promise.all
  whose failure nulled overview, and the overview-null early return
  unmounted the whole panel INCLUDING the subtab bar, killing the
  game-backed views with it.

DELIVERABLES, each closed with tests that fail on the old behavior (red
runs observed before each fix):
1. H1 role gate: canReadGameMarketData in src/auth/policy.ts (internal
   tier); the game proxy refuses before any secret use or upstream call.
   Tests: external 403 on EVERY allowed path (matrix iterates
   allowedGamePaths() so it self-extends) with the upstream counter
   pinned to zero; internal (non-owner) 200 on every path with the
   counter pinned to the path count; signed-out 403; policy pins. Bypass
   hunt: the only GAME_SERVICE_URL / dashboard-secret reach in src/ is
   the gated proxy.
2. H2 decimals: src/components/woc_mint.ts exports WOC_MINT_DECIMALS = 6,
   the one declaration; market_trading_view.ts consumes it (WOC_DECIMALS
   deleted); the four ClaudiumPurchasesPanel fallbacks unified to the
   constant, which also covers the SUBMIT direction (decimalToBaseUnits
   on the withdraw path shares the source; the trading panel itself
   never submits an amount). Tests: rendered-figure proofs (9000000000
   base = 9,000 $WOC), the 6-pin, and a source scan over src/ with an
   exact-path SOL allowlist, per-arm positive AND negative pattern
   probes, a file-count floor, and an allowlisted-file liveness control.
3. Operation safety: WMB_-only regex whose error names the WMS_ mistake;
   market_release_form.ts (pure reducer + validateReleaseSubmit): a
   forfeit requires typing the last 8 characters of the SPECIFIC
   reference (forfeitConfirmTarget; the 18 QA file's binding probe,
   adopted at implement time), submit-succeeded resets the whole form
   destination included, set-to AND set-reference clear the typed
   consent, failure keeps the form for retry; the economy proxy sends
   auditActor(user) = "id (username)" (src/auth/audit_actor.ts), id
   first, and panels render the username half via auditActorDisplay with
   the full composite on hover. Tests: WMS refusal, generic-word
   refusal, the stale-consent cross-reference case (tail of bond A
   refused when the field holds bond B), destination reset against the
   exact stale-treasury hazard, recycled-username distinguishability,
   rename-survival of the id key, intake-bound fit, proxy header pins on
   the composite, display extraction incl. legacy bare-username rows.
4. Overview resilience: market_summary_load.ts (Promise.allSettled, one
   error slot per read, data nulled on that read's failure, malformed
   200 payloads routed to the section error); the panel renders the
   subtab bar unconditionally, each summary section renders data or its
   own error, the release control works without the overview, and a
   monotonic load sequence stops a stale in-flight read from
   overwriting a newer filter's state. Tests: per-read failure matrix
   with sibling DATA survival pinned, all-fail never throws, non-Error
   reasons readable, statusFilter encoded, malformed-payload arm.

REVIEW ROUND: three read-only coverage lenses (security, correctness,
test-decisiveness) as one workflow over c001d4a..c075f78: ZERO blocking;
6 should-fix, 7 nits, 9 notes; every finding applied or judged with the
file open. APPLIED (commits bfab70d code, b4c4f71 docs): the CLAUDE.md
allowlist overclaim scoped (the payout proxy is a prefix rule with a
deny-list external policy, now named as the known exception); the
set-reference consent clear (premise superseded by the tail binding but
applied for a uniform consent model); the scan pattern widened to the
literal family (grouped/bare 10^9 AND 10^6, 1e9/1E9/1e+9/1e6,
10**literal, 10n**BigInt(literal), Math.pow(10, literal)) with per-arm
probes and separator-safe paths; README trued (external role does NOT
include discounts, Trading tab entry added, GAME_SERVICE_URL +
DASHBOARD_INTERNAL_SECRET documented); env save/restore in the proxy
tests plus the internal-arm upstream counter; operator number formatting
pinned to en-US (OPERATOR_LOCALE) in the market view core and the
panel's inline call, making the exact-string decimal pins locale-stable
(chosen over softening the tests: operator copy is consistent English);
the stale-filter load race fixed with the monotonic loadSeq ref; stale
success notices cleared at submit start; auditActorDisplay for the
audit cell and pause banner; .wm-over-balance gained a real style rule
with the loading/error class split; the exactness comment reworded
(nearest representable, not exact, past 2^53); the 64-char username
premise corrected to the real 32 bound; sibling-data asserts added
(cross-contamination mutant killed); Array.isArray guards on fulfilled
payloads with their test.

JUDGED this round (binding unless 18 QA overrules):
- tes-2 (should-fix): "subtab bar survives an early return" has no
  failing test. DEFERRED to 19 with reasoning: tests cannot import .tsx
  under --experimental-strip-types (no JSX transform), so a decisive pin
  needs a component-render harness (a build step or dev dependency),
  which is 19's scope (CI + tests); a source-text pin on JSX topology
  would be brittle and gameable. The state layer IS pinned (loader
  isolation); the JSX topology was hand-verified and lens-verified.
- 404/405 decided before the role check + the GAME_SERVICE_URL localhost
  default: kept; matches the sibling proxies, the middleware 401s
  anonymous callers before the handler in production, and the allowlist
  is source-public.
- Error-replaces-data on a transient refresh failure: conforming and
  deliberate (anti-mixed-epoch; the module comment carries the
  rationale). If operators complain, the fix is an explicit
  stale-as-of presentation, never silent retention.
- Halt control unavailable during an overview outage: a decision, not an
  accident (a blind pause toggle without knowing the current state is
  its own hazard; a state-independent halt needs a service surface).
- claudium_format.formatUsd and the Claudium panels keep ambient-locale
  formatting: pre-existing class outside this diff's surface; recorded
  for 19.

VERIFIED cross-repo (files open, read-only):
- The service fails closed on a WMS_ reference at release: admin
  forceRelease resolves the reference through the BOND store
  (refundBond/forfeitBond), a non-bond ref refuses, and the ATTEMPT is
  audited either way. The dashboard ceremony is fat-finger protection,
  not the gate.
- The service's actor intake bounds at 200 code points; usernames are
  constrained to ^[a-z0-9][a-z0-9._-]{2,31}$ so the composite cannot
  carry CR/LF or parens (non-spoofable shape); worst real composite is
  about 71 code points.

LEDGER ITEMS with owners:
- 19: payout proxy allowlist upgrade (prefix + deny-list is the known
  exception; bring it to the game/economy allowlist shape) and the
  component-render test harness (tes-2). Payout mutations besides
  void/restore forward no actor identity; extend id-first forwarding
  when the payout service grows audit rows. Ambient-locale formatUsd
  class.
- 19/22: ask the economy service to report wocDecimals on the market
  admin payloads and prefer it in the Trading tab (constant-only until
  then, divergence window documented in woc_mint.ts).

FRESH FIX-ROUND REVIEWS (two agent rounds, then a documented self-review
of the final small round):
- Round-1 fixes (c075f78/bfab70d/b4c4f71) got a FRESH reviewer: READY,
  0 blocking, 4 should-fix, 4 nits, 6 notes; ALL applied in c88084f:
  the loader now survives a literal-null 200 body (optional-chained
  value access; the old shape rejected the WHOLE load as an unhandled
  rejection and froze the tab); the overview arm gained the same
  malformed-200 screen the row arms had; the supersession guard moved
  OUT of the untestable panel into the tested createSummaryLoader
  factory (deterministic race test: gates installed synchronously,
  superseded call resolves null); formatUsd pinned to en-US (its pins
  were already en-shaped, now locale-stable); the Discounts and
  Claudium audit tables render the composite actor's human half with
  the id on hover (collateral of the proxy change on THEIR rows); the
  action-error line outranks hints (.wm-over-balance) and top-level
  trading hints got a muted scoped rule; the scan pattern gained
  [d_] digit-run boundaries (21_000_000_000 no longer submatches) with
  new negative probes and a sorted, order-insensitive allowlist
  compare; README denial list gained buy-and-burn + dismissal
  management and the Summary-subtab env note; CLAUDE.md's typed-
  confirmation sentence scoped to the forfeit direction. Verified-sound
  notes from that round: the forfeit binding has no bypass, the display
  parser cannot misparse real usernames (charset-constrained), env
  hygiene complete.
- Round-2 fixes (c88084f) got a SECOND fresh reviewer: READY, 0
  blocking, 2 should-fix, 2 nits; ALL applied in e82303e: the shape
  screen pins price.tokensPerUsd as null-or-number (a MISSING key
  slipped the panel's null-equality guard and threw in render) and
  screens venue elements (null or usdPerToken-less venues crashed the
  venue table); row arrays screened per element (a null row = that
  section's malformed error); the loader ref is lazy-initialized
  (useMemo could legally remint the supersession counter); submit
  handlers refresh through a latest-load ref (a filter change mid-POST
  is no longer rolled back by the old closure; the reviewer traced this
  as pre-existing, fixed anyway); the treasury recovery message renders
  the actor's human half; the CSS comment states the selector's real
  reach.
- Round-3 fixes (e82303e) were SELF-REVIEWED with files open (narrow,
  decisive-by-construction tests; verified no valid service payload can
  be refused by the screen since every screened member is required by
  the MarketOverview interface, the ref lazy-init is the sanctioned
  React pattern, and the cleaned dep arrays hold). The 18 QA session
  re-reviews the full range fresh regardless.

JUDGED from the fresh rounds (binding unless 18 QA overrules):
- Mixed-grouping scale spellings (1_000000000) escape the tightened
  digit-run boundaries: accepted heuristic cost of exempting large
  literals; the pattern is declaredly literal-spelling coverage and the
  named-constant arm was always out of grep's reach.
- README's "automatic-payout changes" wording covering the
  daily-rewards toggle: pre-existing prose, untouched.
- App.tsx's duplicate ambient-locale USD formatter and the discount
  percent formatters: folded into 19's ambient-locale item.

CLAUDE.md: the dashboard repo had NONE; created top-level (pure
view-cores under thin panels, proxy-owned authorization with the payout
exception named, immutable-id attribution, the single mint exponent,
independent section failure, constant-time compares with password.ts as
the pattern, the test bar). Every claim verified against the code after
the review round's truth-up.

Commits (dashboard repo, session range c001d4a..e82303e, TEN):
5258a10 role gate, c0b391b decimals + release safety cores, 8807819
audit attribution, 2dbad3c independent summary reads + panel rewire,
2d63027 CLAUDE.md, c075f78 reference-bound forfeit confirmation,
bfab70d review fix round, b4c4f71 docs truth-ups, c88084f second fix
round from the fresh reviewer, e82303e render-path leaf screening from
the second fresh reviewer.

Validation on the final tree e82303e: npm test 164 pass, 0 fail
(baseline was 131); npm run check exit 0 (astro check 0 errors + tsc;
one PRE-EXISTING hint, the deprecated React.FormEvent in App.tsx,
untouched); npm run build exit 0. Diff swept after every round: zero
em/en dashes, zero emojis, no "phase" in commit text.

NEXT = docs/woc-marketplace-hardening/phase-18-qa.md, DASHBOARD repo,
worktree /Users/fernando/Documents/woc-rewards-dashboard-pr13, branch
integration/woc-market-trading, FRESH session, own origin/master sync
first; it diffs c001d4a..e82303e and pushes on PASS to
origin/feature/woc-market-trading-controls (updates PR #13).

## 19 implement round (dashboard tooling)

DASHBOARD repo, worktree /Users/fernando/Documents/woc-rewards-dashboard-pr13,
branch integration/woc-market-trading. Session start ae6e46c (the 18 QA tip AND
the PR #13 remote tip); origin/master sync a NO-OP. Baseline validated green
before any change: npm test 183, check 0 errors, build 0. LOCAL per R4: NOTHING
pushed in either repo; the 19 QA session pushes on PASS. Seven commits,
ae6e46c..8eeaf8f. Validation held by hand (no reviewer roster or gate in this
repo): npm test 254 pass 0 fail, npm run check 0 errors (the pre-existing
React.FormEvent hint untouched), npm run build complete, all three ALSO proven
from a CLEAN CLONE of the committed tip (npm ci from the lockfile, no .env, the
workflow's exact step list) since pushing is the QA session's job.

DELIVERABLES:
1. CI (cd4f6cd audit fix, 31dd145 workflow, hardened in f226683): the repo's
   first workflow, .github/workflows/ci.yml, runs npm ci, the security suites
   BY NAME (the new test:security script: proxy authorization x3, release
   form, summary loader, mint scan, audit actor; a renamed or deleted suite
   turns the gate red instead of silently shrinking the glob), the full
   suite, astro check + tsc, and the build, on every push and PR, with
   per-ref concurrency, a read-only token, persist-credentials false, and the
   org's v6 action tags. PROOF: act is not installed, so the act-style local
   proof is a fresh git clone of the committed tip + npm ci + the four steps,
   run TWICE (at 31dd145 and at the final tip 8eeaf8f), all green; the real
   Actions run is exercised by the 19 QA push. Making the check REQUIRED on
   the protected branch is a repository setting: Fernando's follow-up.
2. Component-render harness (60f439d): tests/harness/register_jsx.mjs (a
   node:module registerHooks load hook transforming .tsx with esbuild, plus a
   resolve fallback for the panels' extensionless imports) and
   tests/harness/component_harness.ts (happy-dom globals, react-dom createRoot
   under act, setValue via the prototype setter + Simulate.change because
   React's text-input change plugin ignores happy-dom-dispatched native
   events, a route-based fetch mock that installs over the REAL fetch, and a
   deferred() for deterministic races). devDependencies gained esbuild
   (^0.28.2, already in the tree transitively via astro; the QA round corrected
   this line, which first said ^0.28.1) and happy-dom: the
   sanctioned test-harness exception, nothing ships in the production build.
   Every 18-round JSX deferral is now pinned in DOM tests:
   validateReleaseSubmit gates the POST (zero-POST pin), BOTH submit outcomes
   route through releaseSubmitOutcome (reset-on-success, keep-on-failure),
   the loaderRef supersession survives re-render, the subtab bar survives a
   full economy outage with the game views still opening (tes-2), the
   composite actor + title renders across all four panels (trading audit,
   Discounts, ClaudiumAdminOperations x2, the treasury recovery message),
   tablist ARIA completed (tabpanel, aria-controls, roving tabindex, arrow
   keys) and pinned, status pill warn/err split, submit error/notice cleared
   on subtab switch, decimals rendering (9000000000 base = 9,000 $WOC in the
   DOM), outcome labeling, the quotes filter-change loading affordance, and
   the stale-read discard at the panel level.
3. npm audit (cd4f6cd): 11 advisories (5 high, 5 moderate, 1 low: astro,
   @astrojs/node, fast-uri, js-yaml, nanoid, postcss, svgo, the yaml
   language-server chain) all had non-breaking fixes; lockfile-only update;
   npm audit now reports 0. NO accepted-risk list needed. The gate has no
   npm-audit step by decision (external-world nondeterminism in a merge bar);
   a scheduled audit job is noted for Fernando below.
4. Data-truth fixes, each red-first or mutation-proven (60f439d, f226683,
   8eeaf8f): p2pOutcome labels dead trades (a terminal non-sold listing is
   dead REGARDLESS of settlement state; the settlement-bearing class, e.g.
   resolution unsettled + latest settlement failed, is the dominant real one
   and was the fresh correctness lens's headline catch); buy-now listings
   show the price they sell at (listingPriceView/listingPriceLabel; the old
   cell rendered currentBid ?? start for every format and threw buyNowCents
   away); legsReconcile stays the documented sanity check (the window totals
   still carry no base-unit settled total to sum against: the service-side
   ask is DEFERRED, see below) but the REAL identity now runs per quote:
   quoteLegsMismatch checks seller+burn+treasury === amountBase on every
   quote row in view (the legs ride the quotes payload already) and the Note
   cell flags a mismatch above the terminal reason; the MarketListViews
   stale-response-wins race and shared busy flag closed with createListLoader
   (the createSummaryLoader supersession pattern, only the winning load
   clears busy) plus malformed-200 row screening (an object leaf in a
   rendered cell unmounted the whole tab; same class as the 18 blocking);
   the loading affordance covers the mixed-epoch window on filter changes,
   page turns, and date changes (old rows never pose as the new filter's
   answer), and the quotes section uses a quotesFilter stamp in
   MarketSummaryState; release references paste case-leniently
   (normalizeReleaseReference: prefix upper, hex lower) and go out
   canonicalized, WMS_ still refused by name; wocDecimalsMismatch in
   woc_mint.ts is the runtime reconciliation the divergence-hazard comment
   promised (banner in the Claudium panel, which holds the one payload that
   reports wocDecimals; an unreadable PRESENT value warns rather than staying
   silent); withdrawalReadiness refuses a fresh withdraw before the wallets
   payload lands (the conversion-at-fallback + skipped balance check window;
   structurally the withdraw modal only opens from the wallets section today,
   so the wiring is defense in depth, core-pinned, and no vacuous DOM pin was
   fabricated for the unreachable path); the ambient-locale sweep fixed 31
   toLocaleString sites across 8 files (ClaudiumAdminOperations had 11 beyond
   the known set) with a red-first source scan
   (tests/operator_locale_scan.test.ts: comment/string blanking that keeps
   template expressions scanned, per-arm probes, walk floor, liveness
   control, whole-file matching so wrapped calls cannot escape, and JSX-aware
   regex-literal handling after the re-review caught the blanker regression).
5. Investigation UX (60f439d): a find box on both list views filtering the
   LOADED PAGE (the game reads carry no search parameter; substring over
   name/wallet/item/signature plus exact id:/acct:/listing: tokens so id:12
   cannot match 123); cross-links: accounts jump between the listing and p2p
   views (landing wide open: status all, the 2024-01-01 investigation window,
   page 0, so a jump cannot silently miss its target; consumed on hand
   navigation so the token never re-applies on a return visit), custody rows
   jump to their listing, and a WMB_ audit reference loads into the release
   form (bond references only, isBondReference); the Custody subtab consumes
   GET /internal/woc-market/stuck through the gated game proxy (the THIRD
   allowlisted path, literal-pinned in the authorization matrix which also
   self-extends): five stuck classes with saturating count labels (1000+),
   truncation honesty (showing the oldest N of M), the correct age axes
   (stuckDelivering on updatedAtMs, stuckBonds on stuckSinceMs), and the ops
   gauges (sweep, pool, lock-wait timeouts, idle-tx kills) degrading to a
   dash on older game binaries; paging kept on both list views (Pager now
   DOM-tested); the p2p table gained the Tx column (signature tail, full
   value on hover). The PAYOUT proxy joined the explicit-allowlist shape
   (c023c40): payout_routes.ts, method-qualified, all 17 routes verified
   against App.tsx, unknown paths 404 with zero upstream (red-run observed:
   the old prefix rule proxied them), canonicalProxyPath gained the
   normalized-output percent re-check (game parity), and operator identity
   rides EVERY payout request as x-woc-daily-reward-actor (id-first
   composite, forge-proof via fresh headers, ASCII-clamped).

REVIEW ROUNDS: two fresh coverage lenses over ae6e46c..31dd145 (security: 0
blocking, 2 should-fix, 2 nits, 6 notes; correctness: 0 blocking, 3
should-fix, 4 nits, 7 notes), every finding applied or judged with the file
open; the fix round (f226683) was RE-REVIEWED FRESH (0 blocking; its one
should-fix was REAL: my regex-literal handling in the locale scan blanker
read JSX closing tags as regex openers and silently swallowed one-line JSX
cells, exactly where formatter calls live; fixed in 8eeaf8f with JSX controls,
mutation-proven, plus its three nits). Mutation proofs across the session: 10
bit by name (loaderRef remint via the effect-loop hang, release guard bypass,
raw reference on the wire, quotes affordance arm, stale submit outcome kept,
list supersession dropped x2, dead-with-settlement revert, cross-link clear
revert, JSX-blanker revert) plus the two subagent proofs (payout prefix-rule
restore, actor header removal); the affordance mutant SURVIVED its first test
and forced a real test rewrite (the parked-first-load flow never left the
quotes === null arm), which is what the proofs are for.

JUDGED this round (binding unless 19 QA overrules; do NOT re-raise):
- SHA-pinning the workflow actions: declined; the org convention (game repo,
  23 workflows) is major-tag pinning, and the workflow rides the same v6 tags.
- 404/405 decided before the 403 on the payout proxy: matches the sibling
  proxies and the 18 QA binding judgment on the same class (authenticated-only
  enumeration of a source-public list; middleware 401s anonymous callers).
- No npm-audit step in the per-PR gate: a merge bar must not go red on
  external-world drift unrelated to the change; a SCHEDULED audit job is
  Fernando's call.
- push + pull_request double-run on PR branches: the spec asks for both
  events verbatim; cost noted, correctness unaffected.
- The keyword-preceded regex gap in the locale-scan blanker (return /x/ reads
  as division, body unblanked): documented in the scanner; no such literal
  exists under src/ today and the failure mode is bounded to one line for
  quotes (a backtick could reach further; accepted with the comment naming it).
- Negative ages (clock skew) render "-" everywhere formatAge is used:
  graceful and indistinguishable from unknown by design; a skew hint would be
  over-engineering.
- Late-resolving loads setState after unmount: harmless in React 18, no
  warning, no leak; listed by the lens for completeness.
- mockFetch restoring to the REAL fetch always (no nesting support): no
  nested mocks exist and the self-heal is the point.
- dead (listing X, settlement pending) is reachable and transiently
  premature if the game can terminally resolve a listing while a settlement
  is in flight; it self-corrects on delivery and the label surfaces both
  facts. Game-side data question, not a dashboard defect.

FOR FERNANDO (flagged, not changed; policy question the security lens raised):
the EXTERNAL role can still POST admin/payouts/send, resend, tasks, and
config through the payout proxy (the deny-list covers automation,
daily-rewards, void, restore, wallet/send). That is pre-existing policy, now
PINNED per-route by the new external-verdict matrix so any drift fails by
name; payouts/send moves money, so confirm it stays intended.

DEFERRED with owners:
- 19 QA: the real GitHub Actions run (the push exercises the workflow; check
  the run and note its state here per R4), and making the ci check REQUIRED
  on the protected branch (repository setting, Fernando).
- 22 (service ask, the 18-recorded item now concrete): the market admin
  payloads still report no wocDecimals and the volume windows no base-unit
  settled total; asking the service to report both closes the Trading tab's
  constant-only rendering and lets legsReconcile verify the window identity
  (per-quote reconciliation landed this round without a service change).
- Service-side (recorded, cross-repo): body-borne actor fields on payout
  mutations beyond void/restore still forward verbatim; the new header is
  authoritative only if the payout service prefers it over the body when it
  grows audit rows.
- Server-side search remains a game-endpoint gap (the find box is honest
  about filtering the loaded page); offset paging for the service quotes and
  audit reads likewise (both are limit-bounded, not unbounded, so no fake
  client paging was added).
- The summary refresh wedge (a never-resolving fetch stops the 30s refresh
  permanently because schedulePeriodicRefresh's in-flight guard never
  releases): pre-existing mechanics, visible now as a sticky "Loading
  quotes..."; a fetch deadline is a coherent follow-up for 22's runbook or a
  rider, not a quiet inline change here.
- tsconfig still type-checks src/ only; the harness and tests run unchecked
  under strip-types (pre-existing convention, now covering more test code;
  aligning @types/react to the runtime 18 would be the first step if Fernando
  wants tests typechecked).

SCREENSHOTS: not applicable; the pr-screenshots rig drives the GAME client
(puppeteer against the play page), and the dashboard has no capture rig; its
visual changes (Custody subtab, find boxes, cross-link buttons, pill tones)
are DOM-pinned instead.

CLAUDE.md (dashboard): commands section now names the harness, test:security,
and the CI workflow; the view-core rule reworded (tests CAN import .tsx via
the harness, which exists to pin WIRING, never to move decisions back into
panels); the proxies bullet says all THREE proxies use explicit allowlists
(the payout prefix-rule exception paragraph deleted) and names the
canonicalizer contract; the audit bullet adds the payout actor header and the
auditActorDisplay + title render convention; new operator-locale bullet; the
token-figures bullet gained the wocDecimalsMismatch cross-check. README's
Trading tab section covers the Custody view, find boxes, paging, and
cross-links. Verified against the code.

Commits (dashboard repo, session range ae6e46c..8eeaf8f, SEVEN): cd4f6cd
audit fix (lockfile-only), 60f439d harness + trading tab (the body names the
full inventory), c023c40 payout allowlist + actor header, b567940 locale
sweep + scan, 31dd145 CI workflow + CLAUDE.md/README, f226683 the two-lens
fix round, 8eeaf8f the fresh re-review round (JSX blanker + three nits). Two
commits over the five-commit guideline: the two review rounds are committed
separately from the work they audited, per the QA-workflow rule.

NEXT = docs/woc-marketplace-hardening/phase-19-qa.md, DASHBOARD repo,
worktree /Users/fernando/Documents/woc-rewards-dashboard-pr13, branch
integration/woc-market-trading, FRESH session, own origin/master sync first;
it diffs ae6e46c..8eeaf8f and pushes on PASS to
origin/feature/woc-market-trading-controls (PR #13).

## 19 QA round (dashboard tooling)

DASHBOARD repo, worktree /Users/fernando/Documents/woc-rewards-dashboard-pr13,
branch integration/woc-market-trading. Session start 8eeaf8f (the 19 implement
tip; origin/master sync a NO-OP). Verdict PASS-WITH-FOLLOWUPS, every finding
applied or judged with the file open; PUSHED per R4 (ae6e46c..145d120,
FOURTEEN commits: the seven implement commits plus seven QA fix commits, to
origin/feature/woc-market-trading-controls, PR #13). Baseline re-validated
green before any change (npm test 254, check 0 errors, build complete); final
tree npm test 276 pass 0 fail, check 0 errors, build complete, npm audit 0
fresh, ALL re-proven from a FRESH clean clone of the final tip (npm ci, the
workflow's exact step list).

Six coverage lanes over ae6e46c..8eeaf8f (correctness+regression,
test-decisiveness, security, dead-code/docs, cross-repo data-shape truth,
CI-workflow truth) plus the session's own hands-on probes (CI honesty via
seeded failures in a scratch clone, harness integrity via deliberately broken
panels, fresh npm audit, an independent ambient-locale grep that concurred
with the scan test). ONE BLOCKING, found independently by the hands-on probe
AND the CI lane: node --test treats positional arguments as GLOB PATTERNS
(node 22+), so a renamed or deleted security suite silently SHRANK
test:security while the step stayed green, the exact decoration class the
ci.yml comment claimed to prevent (node only errors when EVERY pattern
misses; one lane initially reported the opposite from the all-missing case
and was refuted by reproduction). Fixed with
tests/harness/run_security_suites.mjs: the list lives once, a missing file
refuses loudly before any test spawns, the child exit code propagates (null
status fails), and deleting the runner itself reds the npm script; the guard
suite tests/security_suites.test.ts pins the wiring, the membership (now
EIGHT suites: auth_policy joined), both arms with injected deps, an
end-to-end spawn of the REAL entry from a bare temp cwd, the ci.yml step
wiring, and the flat-tests glob floor (any *.test.* stray anywhere reds it).

Headline fixes beyond the blocker (~40 findings applied across seven
commits):
- Custody: the payload screen validated only class spines, so a 200 with an
  object leaf in a sample row (the malformed-200 class 18 closed in the list
  views) crashed the whole Trading tab; ROW_SCREENS now checks every
  rendered leaf per class with additive game fields tolerated, poisoned-row
  pins per class plus a DOM arm. The gauge fields went OPTIONAL in the type
  (the runtime never required them; the compiler now enforces the
  older-binary guards), unverified provenance fields left the row types so
  the type predicate vouches only for checked leaves, and the health strip
  stops feeding unproven values to its template slots.
- Investigation UX: the p2p table gained the Listing cross-link column (an
  operator followed a dead trade by hand-copying an id the table did not
  even show); listing:N aliases id:N on the listings find box; exact tokens
  moved APART from free text (a seller literally named "id:99" satisfied an
  id:99 token search); per-view find placeholders stop promising wallet
  search on p2p rows that carry none (they search signatures and listing
  ids); a cross-link jump lands in ONE read (the mount used to buy a
  default-filter fetch that was immediately superseded), lazy and
  identity-keyed so a UTC-midnight rollover cannot re-buy it; listing links
  mint the WYSIWYG listing:N token the buttons display; the dead
  SearchRequest.seq plumbing removed.
- Proxies: the two byte-equivalent canonicalizer copies (the logic that
  carried the protocol-relative secret-egress class) single-sourced into
  src/proxy_path.ts with both old names delegating; CLAUDE.md now says out
  loud the economy proxy has NO canonicalizer and stays safe by
  exact-literal matching only; the economy actor header gained the payout
  ByteString clamp (a non-Latin1 username 500ed every economy admin
  request; both clamps pinned with the id half proven intact); payout
  secret attachment and the missing-secret 500-with-zero-upstream pinned;
  the route-helper files took Astro's underscore prefix and the phantom
  /api/payout_routes-class endpoints are confirmed gone from the built
  manifest.
- Decisiveness: a payout call-site drift scan (App.tsx api() literals
  pinned set-equal BOTH WAYS to the allowlist, liveness floor, extraction
  probes incl. one-level nested generics, an any-spelling belt outside
  App.tsx); a same-filter stale race isolating the quotes supersession
  through the panel (the existing pin's stale read carried a different
  filter, so the affordance arm hid the paint whether or not the discard
  worked); the wide-open landing DOM-pinned INTO the listings view with the
  single-fetch count; INVESTIGATION_FROM literal-pinned (was
  constant-self-compared); the '>9 $WOC' vacuous negative went whole-token
  (empirically probed decisive); the truncation line and the idle-tx
  degrade arm pinned; the p2pOutcome delivered-over-terminal carve-out
  commented and pinned; ci job timeout-minutes 15; engines node 26.x; the
  redundant ci- concurrency prefix dropped.

MUTATION RECORD: 28/28 bit. Eleven independent spot-checks of the implement
round's proof claims (release guard bypass, legs identity, quotes
affordance, cross-link consumption, unknown-path zero-upstream, external
wallet/send deny, forged actor header, raw reference on the wire, list seq
discard, dead-with-settlement, JSX blanker regexCanStart) plus seventeen
new-pin mutants across both fix rounds (incl. the runner entry call
dropped, the refusal threshold off-by-one, the shared canonicalizer
leading-slash strip, the custodyRef screen weakened, and the same-filter
race proven to fail ALONE when the discard breaks). Harness integrity
proven live: a deliberately broken MarketCustodyView and MarketTradingPanel
each fail their DOM suites. CI honesty proven live: a seeded assertion
failure reds npm test AND test:security in the clean clone.

FIX-ROUND RE-REVIEW (fresh, two lenses over 8eeaf8f..716851c): 0 blocking,
2 should-fix (the runner's real entry path unexecuted; custody row types
keeping unverified provenance fields), 7 nits and notes, ALL applied in
145d120 (incl. the same-filter race fixture's reference colliding with the
audit fixture, which made one intermediate checkpoint vacuous, and the
call-site scan's nested-generic blind spot). The decisiveness lens traced
every new pin against its named regression.

CROSS-REPO verified true against the real producers: the custody readout
shape field-for-field vs server/woc_market.ts and the main.ts gauge merge
(the dashboard reads NO field the game does not send; age axes correct;
gauges degrade to a dash); the quote-leg identity seller+burn+treasury ===
amountBase is exact by construction service-side (three-way from inception,
no two-way history to mis-reconcile, bond quotes legs-null, the forfeit
split never touches quote legs); all 17 payout method+path routes have live
App.tsx call sites and every call site is allowlisted; the game proxy sends
exactly the x-woc-dashboard-secret header the game's /internal gate
requires.

FIRST REAL ACTIONS RUNS (the workflow's maiden runs, on the R4 push): BOTH
GREEN, push run 32328875415 in 1m06s and pull_request run 32328875583 in
1m10s on 145d120; none of the known first-CI-run environment mismatches
fired (lockfile npm ci on node 26 matches local).

JUDGED this round (binding; do NOT re-raise):
- Custody refresh dropping shown rows on a failed re-read: the repo's
  deliberate failed-read-reports-error-and-NO-data policy.
- The 3-class-era game binary window (two same-day feature-branch commits,
  never on a release branch) rendering the whole custody payload malformed:
  fails safe as the section error; no deployed binary can serve that shape.
- The game's unsurfaced ops signals (sweep.lastOverrun, readCaches,
  priceCache ages): conscious skip, wire them when an operator asks.
- The game-side anti-enumeration 'unknown endpoint' 404 (game secret unset)
  passing through verbatim as the section error: coupling a friendlier hint
  to that string is more brittle than the honest passthrough.
- quoteLegsMismatch is sum-only (a ratio-wrong split that still sums clean
  passes): the payload carries no as-of fee schedule to verify against; the
  rendered claim says exactly what is checked.
- The locale scan catching only ambient spellings (a WRONG literal locale
  escapes outside the two value-pinned files): the test declares
  single-sourcing out of scope.
- Game proxy 404/405-before-403: the same ruled pattern as the payout
  proxy.
- The actor clamp degrading printable-Latin1 characters that would not make
  Headers.set throw: deliberate availability belt on display garnish; a
  future non-ASCII user-ID scheme would degrade the identity half (moot
  while ids are ASCII, noted).
- The by-name gate list not absorbing the remaining auth_* infrastructure
  suites: auth_policy (the role-gate policy suite) joined; the rest ride
  the full suite in the same workflow.
- The p2p double-fetch-on-mount class and the wasted-allocation initializer
  concerns: closed by the lazy identity-keyed landing, not re-judged.

DEFERRED with owners (the implement round's list stands, plus):
- Fernando: make the ci check REQUIRED on the protected branch (repository
  setting; VERIFIED this round via the API that no ruleset or branch
  protection exists on either branch today, so a red run does not yet block
  a merge). Standing: confirm the external role POSTing payouts/send stays
  intended (pre-existing policy, pinned per-route).
- 22 (service asks unchanged): wocDecimals + base-unit settled totals on
  the market payloads; the summary refresh wedge (a never-resolving fetch
  parks the 30s refresh permanently) stays a 22/runbook candidate.
- Game-endpoint gaps unchanged: server-side search; offset paging for the
  service quotes/audit reads.
- tsconfig still type-checks src/ only (tests ride strip-types unchecked).

Commits (dashboard, the QA round's seven): ee32af0 security-gate runner,
534a25e custody screening + type truth, 81b86cf p2p listing cross-link +
one-read landings, 48887e7 canonicalizer single-sourcing + economy clamp +
underscore helpers, 003a1dd decisiveness round, 716851c dead fields + docs
truth, 145d120 the fresh re-review round. Game repo: this ledger commit
(plus the in-place esbuild ^0.28.2 correction in the 19 implement section
above).

NEXT = docs/woc-marketplace-hardening/phase-20-real-sql-coverage.md, GAME
repo, worktree /Users/fernando/Documents/wocc-marketplace, FRESH session,
newest origin/release/** sync first.

## 20 implement round (real-SQL coverage for money and security predicates)

GAME repo, worktree /Users/fernando/Documents/wocc-marketplace, branch
feature/woc-marketplace. Session start 057b54141a (the 19 QA docs tip);
release sync a NO-OP (343 ahead, 0 behind origin/release/v0.40.0, still the
newest release branch). LOCAL per R4: nothing pushed anywhere; the 20 QA
session diffs 057b54141a..31d07c6375 (eleven commits) and pushes on PASS. Closes the
"Money/security SQL is fake-only" medium (review.md medium list, first item).

Commits (the five implement-spine test commits; the review fix round added
two more test commits, a083b14986 and c9872baeb5, described in the fix-round
note below, and four docs commits ride on top, the last of which also
unbinds two test bindings):
- 9d22c4474b test(woc-market): pin realm scoping against real Postgres
- 74e04046f2 test(woc-market): pin the bid intake ladder and two realm
  survivors in real SQL
- 55b8b82759 test(woc-market): pin the fake-only money guards against real
  Postgres
- d9f119c556 test(woc-market): close the residual guard gaps the mutation
  sweep exposed
- fd80b6cc02 test(woc-market): true the fake db up to the real SQL it
  imitates

METHOD. Five read-only inventory agents swept server/woc_market_db.ts in
slices (plus the service guards, the sweep lock, and the fake) and returned
per-predicate coverage tables; in parallel a mutation campaign supplied the
ground truth: every candidate predicate was stripped in a scratch worktree of
the COMMITTED tree, the owning suites ran under TEST_DATABASE_URL, and the
verdict was scored only when the harness proved the patch applied and tests
RAN (the memory traps encoded: occurrence-counted literal replacement,
git-diff apply proof, Tests-summary-line run proof, git-checkout revert over a
clean lane, byte-identical verification, survivors re-run against the suite
that owns the pin before scoring). Three lanes ran concurrently because every
suite owns a distinct disposable database name. Where a strip survived, a pin
was written, committed, and the mutant re-run; the campaign closed at
241 distinct mutants, 232 BIT, 8 judged defense-in-depth singles (each
PROVEN by a listed double strip that bit), 1 deliberate comment-only no-op
control. Full per-mutant table: phase-20-mutation-log.md (committed beside
this file). The inventory deliverable is the "Real-SQL predicate inventory
(20)" section of state.md.

NEW REAL-SQL PINS (the implement spine):
- tests/woc_market_realm_scope_pg_integration.test.ts, NEW SUITE (19 tests):
  cross-realm isolation for every realm-scoped statement, seeded as symmetric
  realm PAIRS holding the SAME accounts so only the realm qual can separate
  the rows; per-test realm pairs keep every count exact and -t safe. Also
  pins browse's closed-row exclusion, the stranded age bound, the bid TTL
  sweep's placed_at gate, voided sales leaving price history, deliveryTarget's
  account scoping, the escrow cap's realm half, and the escrow stamp's
  cross-realm refusal.
- Bond suite: the insertPendingBid refusal ladder (own account, seller wallet
  twin, directed not_found, ending/lapsed close inclusive at the bound,
  cancel_pending, bid floor inclusive, already_pending per listing+account+
  status), signature intake guards (not_pending writes nothing, cross-bid
  reuse answers signature_reused off the partial unique index), bid state
  guards (lapse, quote, markBondHeld never move settled money), the
  activation ladder incl. the won-prior arm, the claim diagnosis ladder, the
  open-settlement claim refusal, cooldown scoping (cross-listing, rival
  accounts at the cap, directed exemption at the cap), closeCancel's bid
  skip, the abandon recorder's exempt window (signature required, reason set,
  per-buyer, per-window, dedupe), one bond per reference at the schema.
- Settlement suite: the seller cancel ladder + paid-window refusal + one-shot
  intent stamp, suspend's won-only release, terminal listing writes never
  resurrect or relabel, claimDueListings' status+due bounds, the overdue
  default arm's state set + deadline, the cascade candidate read (outbid-only,
  inclusive floor, prior-winner exclusion), bondsDue states, settlement
  signature intake (offered-only + reuse typed + non-offered writes nothing),
  the CHECK-constraint negatives (listing status/format/resolution/item shape,
  bid status/bond_state, settlement state, offer status).
- Delivery suite: the custody claim intent ledger (one-way booked flip, intent
  writes refuse a booked claim, mail intent withdraws the grant), finalize
  guards (non-delivering rows refuse and write NOTHING, a closed listing keeps
  its resolution, a refunded winner bond never re-queues), residue arms
  (dispose only sold-with-live-sale, return only undisposed non-sold).
- Directed suite: the escrow stamp CAS (pending/stamped offers refuse
  not_pending and the whole escrow rolls back), the cap ignores closed
  listings, reopen refuses declined and stamped offers, expireIfUnstamped
  skips a stamped deal, the boot repair's realm-joined dedupe, strikes
  (increment, GREATEST suspension, per-account clear), terms recorded once.
- DB-free floor (tests/server/woc_market_directed_sql.test.ts): two new
  lock-shape pins through the REAL methods on recording pools: activateBid's
  ordered open-set pre-lock before the listing lock, and suspend's pre-lock
  including 'won'.
- Service suite: settlementQuote's not_yours and quote_expired entry guards
  (found untested anywhere).

FAKE HONESTY, fixed and pinned (tests/server/fake_woc_market_db.test.ts,
commit fd80b6cc02):
- submitBondSignature consulted the reuse scan BEFORE the pending guard;
  Postgres reaches the unique index only when the guarded UPDATE matches, so
  a dead bid must answer not_pending even on a spent signature.
- claimBuyNowLock had NO same-wallet twin guard at all (the real transaction
  re-reads wallet_links under the lock and its claiming UPDATE carries the
  NOT EXISTS); the fake gains a walletLinks mirror and the guard.
- stuckCustodyReadout did not clamp a non-positive countCap (real fails
  closed to 1).
- directedOfferById handed out the LIVE row against the file's copy-out
  contract; one service test (the legacy no-item offer) staged its fixture
  through that aliasing and now uses the explicit stageLegacyOfferWithoutItem
  hook.
- deliveredUnclosedSettlementsPage's settlements filter carried a realm qual
  the real second statement does not have (the id page scopes it).
- The escrow comment claimed the reverse of the real cap-then-save order
  (comment truth-up; recording the save ARGS on a refused escrow is
  deliberate seam recording and stays).

FAKE DIVERGENCES JUDGED BENIGN, documented not changed (binding; do not
re-raise): the fake's per-listing cooldown probe filters by realm where the
real subquery keys on (listing_id, account) alone (a listing lives in exactly
one realm, so the sets are equal); the id tiebreaks on confirmingBonds and the
overdue reads (documented determinism aids; Pg leaves ties to the planner);
insertSale surfaces the 23505 constraint name in the message only (no catch
keys on err.constraint for sales); the lease fence is modeled by the
failNextDeliveredSave hook rather than a lease table (the real fence is
pg-pinned); the fake unions omit 'contended' (no contention exists in
memory); settlementTouchMs's `?? 0` default is unreachable for store-created
rows (insertSettlement stamps the touch map); agent A's report that the
fake's cancel paid-probe was quote-aware was a MISREAD of suspend's
expirableOffered arm, which mirrors the real suspend exactly (dismissed with
both files open).

JUDGED this round (binding; do NOT re-raise):
- The seven defense-in-depth singles in the state.md inventory table (eight
  at the campaign close; the fix round upgraded claim_open_settlement_advisory
  to PINNED): each single strip is behaviorally invisible behind its live
  twin and each pair is proven by a double-strip mutant that bit.
- expireDueDirectedOffers' outer status qual (the EvalPlanQual belt) is
  deterministically unreachable under FOR UPDATE SKIP LOCKED (the subselect
  skips held rows, so the block-then-commit rig cannot stage the re-check);
  it is pinned at the DB-free floor through the real statement text, and that
  pin bit its mutant.
- The three lock-shape belts (finalize pre-lock winner arm, activation
  open-set pre-lock, suspend pre-lock 'won') cannot red deterministically in
  a live race (the later row writes block anyway; a 40P01 maps to the typed
  contended); each is pinned at the DB-free floor and each floor pin bit.
- ORDER BY / LIMIT bounds that pick display order or batch size gate no
  money and stay unpinned by policy (rotation orders and readout saturation
  ARE pinned); the 40P01 partition arm stays with the mock-pool test.
- The insertPendingBid locked-read realm qual and the claim's locked-read
  realm qual are single-strip-equivalent behind their realm-scoped peeks
  (proven for the claim by the combined mutant; the bid path has no peek, its
  realm qual bit directly in the realm suite).

PARKED ITEMS, disposed:
- Standing planner assertions for the two rotation indexes (03/05): CLOSED.
  The 17 round's plan suite test "both rotation-order batch reads ride their
  COALESCE partials without a sort"
  (tests/woc_market_plan_pins_pg_integration.test.ts) IS that standing
  assertion, EXPLAIN-pinned through the recording pool on every DB-gated run;
  verified green this round.
- The at-scale advisory-cooldown concurrency proof (04, shared with 16), the
  p99.9 inter-statement event-loop gap measurement (16), and the expiry
  segment's measured full-batch ceiling (16 QA): RE-DEFERRED to 21 with
  reason: all three need the at-scale rig and 21 owns the end-to-end
  contention run (the 16 QA deferral already routes the contention run
  there); nothing in this round's deterministic suites can stand in for a
  measured at-scale result.
- The pg-suites-in-CI standing posture (20/22): RE-DEFERRED to 22 with
  reason: wiring Postgres into CI is a gate-selection change that needs the
  gate-integrity reviewer and belongs to the close-out's acceptance-bar
  audit; this round's bar (seven suites, zero skips under TEST_DATABASE_URL,
  gate runs them when the env var is present, the always-run DB-free floor
  grown by two lock-shape pins) is met and recorded.

DEFERRED with owners (new this round):
- 20-qa: independent spot-checks of the mutation log (the registry never
  substitutes for the QA session's own mutants); the three scratch lanes
  wocc-marketplace-mut1/2/3 are LEFT IN PLACE at the round's tip for exactly
  that, remove them when done.
- 22: whether the judged lock-shape belts deserve live chaos coverage on the
  devnet dry-run's rig (observational, not blocking).

VALIDATION (all on the committed tree):
- npx tsc --noEmit clean throughout (run after every batch).
- The full marketplace pg battery, SEVEN suites, 232 tests, zero skips,
  multiple green runs against npm run db:up (TEST_DATABASE_URL only; the
  whole .env is never sourced).
- DB-free marketplace suites green: the directed_sql floor (108 tests at the
  spine tip; 109 after the fix round), the service suite plus the fake
  fidelity suite (279 between them at the spine tip; 280 at the round tip),
  routes, and escrow_queue.
- npm run ci:changed exit 0 (warnings only, the pre-existing debt classes).
- node scripts/gate_select.mjs on the committed tree: the FIRST run (at
  f70dea28f2) failed exactly one file in the full-suite fallback step, the
  directed pg suite, with the "database wocc_woc_market_directed_verify does
  not exist" signature: a reviewer agent ran the same suite concurrently and
  its boot dropped the gate's disposable database mid-run (cross-run
  collision, not a regression; the file is green in isolation and in every
  serialized battery). The final gate run on the finished tip is recorded in
  the fix-round note below.


REVIEW FIX ROUND (the two reviewer reports, every finding applied or judged;
commits a083b149 "apply the coverage and db-performance review rounds" and
the boundary follow-up on top; re-verified by mutation round6, 9/9 BIT):
- BLOCKING (coverage): the listingsBySeller realm assertion was PROVEN
  vacuous (a later edit had sliced a lexicographically sorted id list, so
  the stripped statement returned the same window); fixed to the exact
  three-row seller set with a numeric comparator, mutant re-run BIT.
- BLOCKING (coverage): the realm_* mutant family's log transparency: the
  harness always used TYPED arity-preserving replacements (never bare
  deletion), but the log did not say so; the replacement policy is now in
  the log header, and the re-run of the fixed pin plus the round6 rows carry
  their history columns. The reviewer's arity-error premise was REFUTED
  against the generator (judged with the file open), the transparency ask
  was applied.
- BLOCKING (coverage): the submitBondSignature verdict ORDER (dead bid with
  a spent signature answers not_pending) was pinned only on the fake; the
  bond pg test now runs that exact case against real Postgres.
- Applied should-fixes: abandon-cap fixtures derive from
  WOC_MARKET_BUY_NOW_ABANDONS_PER_HOUR; the two missing jsonb CHECK arms
  (sales item, offer item_ref); constraint NAMES on every 23514 assert and
  on this round's 23505 asserts (the fix-round re-review also named the
  pre-existing insertSale duplicate; the CIC rebuild-on-duplicates arm stays
  bare by design, pg does not populate err.constraint on an index-build
  failure); the fake's twin guard moved behind the advisory cooldown to match
  the real pass order (red-first proven by the new at-cap twin fidelity
  arm); exact landed-signature asserts on both signature intakes; the
  activation ladder now asserts the listing board write; DESC-flip
  negatives on both new pre-lock pins; the advisory open-settlement arm's
  lock-free property pinned at the floor (upgrading that judged single to
  PINNED); docs counts trued; this gate note added.
- Applied nits: the dead not.toContain lines behind exact toEqual sets
  folded into comments; the realm seedOffer stamps item_pin; the fake's two
  remaining live-row returns (insertDirectedOffer, resolveDirectedOffer)
  hand out copies; the bond-reference 23505 names its constraint; the
  service quote-expiry guard pinned at its INCLUSIVE boundary (the first
  attempt aged the clock one tick past the deadline and its mutant
  survived; caught by round6 and fixed).
- Judged, no change (binding): the exempt-reason positive arm exercises the
  list's single member (the list is literal-pinned in two suites; a second
  member owes a new arm WITH its addition); the legacy settlements-CHECK
  evolution arm stays with the structural pins (staging a legacy constraint
  needs a custom DDL rig; recorded for 22's pre-enable audit list); the
  reviewer's claim that the fake's cancel paid-probe was quote-aware was a
  misread of suspend's expirableOffered mirror (dismissed with both files
  open); the plan_pins JSON-reporter anomaly the db-perf lane saw once in
  seven runs is recorded as a prior, unreproducible, nothing attributable.
- db-performance verdict: BLOCK on exactly the listingsBySeller finding
  (already fixed in flight, which its report acknowledged); measured suite
  costs recorded: all seven marketplace pg suites 13.1s wall in one parallel
  run, all 20 TEST_DATABASE_URL suites 18.7s, the new realm suite 1.56s solo
  with a ~0.8s boot against its 120s allowance, connection peak 28 of 100,
  CIC cross-database wait measured absent, declared-timeout ratchet green
  with 90s headroom on the heaviest files, verify databases ~13 MB each.

FIX-ROUND FRESH RE-REVIEW (a new read-only agent over f70dea28f2..73e5f24fb0):
0 blocking, 1 should-fix (the state.md wording claimed the re-review and gate
result before both existed; corrected), 2 nits (the insertSale duplicate
23505 now names woc_market_sales_listing_once; the "two upgraded
ex-survivors" wording corrected to the one logged survivor upgrade plus the
re-proven listingsBySeller pin). Its verified-clean list covers the fake
restructure's case-by-case fidelity to the real claim order, both
structuredClone returns, the lock-free floor pin's decisiveness (traced
through the recorder), all constraint names against the DDL, and the docs
counts against the artifacts.

QA-CHECKLIST VERDICT: READY (0 blocking; its one should-fix, the lane
isolation rule, recorded in the mutation log's protocol front matter; its
nit, three unused beta bindings: two were unbound with an existence comment
and the third (bConfirming) was unbound by the QA round). Its independent samples:
the production-untouched claim verified, 39 of 43 realm-taking methods driven
by the new suite with the other four accounted for, the fake restructure
traced branch by branch, the ratchet and shard-table posture confirmed
by-design. Its standing observation (no CI arm runs the pg suites; they
enforce at review time, not merge time) is the 22-owned posture already in
the deferrals.

FINAL VALIDATION NOTE: node scripts/gate_select.mjs PASS on the committed
tree at 73e5f24fb0, ALL 12 STEPS green, full-suite fallback (the diff
touches the fake helper, so the planner falls back by design): 41,698 tests
passed with the 2 expected fails and 26 skips, browser regressions 131,
typecheck and all builds green, run WITH TEST_DATABASE_URL only and a clear
field (no concurrent pg-suite runs). The earlier FAIL at f70dea28f2 was the
reviewer-collision documented above, not a regression.

Registry for the 20 QA session: diff range 057b54141a..31d07c6375; the
JUDGED and DEFERRED lists above are binding; the mutation log and the
state.md inventory are the artifacts to audit; reviewers this round were
test-coverage-auditor and database-performance-reviewer (as read-only
Agents prompted for coverage) plus qa-checklist LAST, dispositions recorded
below before the docs commit.

NEXT = docs/woc-marketplace-hardening/phase-20-qa.md, GAME repo, worktree
/Users/fernando/Documents/wocc-marketplace, FRESH session, newest
origin/release/** sync first; it diffs the recorded range and pushes on PASS.

## 20 QA round (verdict PASS-WITH-FOLLOWUPS, every finding applied or judged)

GAME repo, worktree /Users/fernando/Documents/wocc-marketplace, branch
feature/woc-marketplace. Session start 3ac20bef0e (the 20 implement registry
tip); release sync a NO-OP (355 ahead, 0 behind origin/release/v0.40.0, still
the newest release branch). Audited diff 057b54141a..31d07c6375 plus the
registry commit. PUSHED per R4 at the round's close; the final validation
note below records the gate and push results.

AUDIT SHAPE. Six read-only workflow lanes (inventory re-derivation,
correctness vs the four deliverables, pin quality, docs truth, fake fidelity,
cleanup) plus test-coverage-auditor as a typed Agent, all forbidden from
running pg suites (the fixed-db-name collision class); qa-checklist LAST over
the finished tree. The session's own hands-on work: the gate dry-selection
probe, five independent mutation spot-checks of the recorded log (its own
strip designs, not the log's), and the full validation matrix re-run FRESH at
the tip, which also closes the correctness lane's observation that the two
late docs commits carried small test edits no recorded run had covered.

GATE SELECTION PROBE (the phase's coverage-theater check): all seven
marketplace pg suites classify into the selective gate's ALWAYS-RUN floor
(887 files; verified through collectSuiteVisibility + buildSelectPlan with
hypothetical marketplace diffs), so every gate_select invocation runs them
whenever TEST_DATABASE_URL is present, regardless of diff shape; a
server/woc_market_db.ts diff stays selective mode with the source in the
related leg. The DB-free floor suite is also floor-resident. No coverage
theater; the no-env-var-in-CI posture remains the 22-owned deferral.

INDEPENDENT SPOT-CHECKS of the recorded log (own strips, scratch lanes at the
tip): bid_own_account (1 failed/60), SMOKE_claimCustodyRef_onconflict via an
ON CONFLICT DO UPDATE reshape (5 failed/39), settle_transition_cas (2
failed/61), realm_1600_listingsBySeller (1 failed/19, the once-vacuous pin is
genuinely decisive now), quote_expired_boundary (1 failed/273). All five BIT
with byte-identical reverts.

FINDINGS AND FIXES (three commits: 7b8083abe9, c270f43dda, d9293f61f3):
- BLOCKING (inventory lane, confirmed by strip): the account-scoping qual
  family was separable only by realm, never by account: the trade poll's
  participant qual, bidsByAccount, settlementsByAccount, and
  directedOffersForBuyer (addressee AND closed member) all survived a strip
  because every fixture seeded only the queried account's rows. Fixed with
  same-realm stranger fixtures; all six quals now have BIT rows (qa20_*).
- BLOCKING-adjacent unpinned predicates, confirmed and pinned: the resolve
  and accept-side pending CAS (a resolved offer accepted acceptances), the
  expiry sweep's inner due bound (a strip expired live offers early), the
  lapse sweep's inner status qual (a strip voided a refund_due bond; needed
  an aged resolved fixture), the auction extension's active guard, the
  ever-settled strike gate, the confirming-poll status member (a signed
  spare in a dead status rejoined the chain poll), and the real readout cap
  clamp (fake-pinned only, the round's own inverted shape).
- Coverage auditor should-fixes, all applied: the two at-cap abandon
  fixtures hard-coded 3 (the cap-bump control then found THREE more
  pre-existing fixtures in the cooldown describe with the same defect; all
  five now derive loop bounds and retry arithmetic from
  WOC_MARKET_BUY_NOW_ABANDONS_PER_HOUR, and the green control proves the
  suite tracks the constant); the settlementQuote "before any revival" claim
  had no failed-row arm (added: a past-deadline failed settlement stays
  failed, order-mutant proven); nits: the eight dead not.toContain lines
  (seven realm, one bond) folded into their exact-set comments (truing the
  fix round's recorded claim), the double lexicographic .sort() dropped on both activity
  assertions, the claimDue bound pinned AT the instant, the has_bids
  pending_bond member, the already-disposed residue negative, the
  anti-enumeration order pin (cancel-stamped directed listing answers
  not_found), the exempt-reason LIST composition pinned in the rules suite,
  bConfirming unbound, rulesMod2 deduplicated, the dynamic rules import in
  the fidelity suite left as-is (see judged).
- Fake fidelity lane, fixed and pinned (four new fidelity arms, each with a
  BIT reversion mutant): the stuck-bond sample now orders on placed_at like
  the real query (it ordered on the coalesced age axis); nested itemRef
  objects are cloned on BOTH sides of acceptDirectedOfferSide and in the
  directedOffersForAccount map (live-row aliasing through the spread); the
  escrow fence hooks moved BELOW the cap count (a staged fence failure at a
  full cap now answers cap_reached and stays armed); the twin-steal order
  arm (a refused twin records nothing against the dead holder) pinned on
  BOTH the fake and the real transaction.
- Log-completeness batch (predicates that were pinned but unlogged, each now
  a BIT row): the two remaining CHECK negatives (listing resolution, bid
  status), the step-up DDL trio, the bond-signature unique index drop, the
  insert-side pair 23505 belt, liveSettlementForListing's state qual, both
  reopen SET resets, the suspend pre-lock DESC flip, the sweep advisory
  lock's realm dimension, undisposedClosedListings' closed qual, the
  not_yours entry guard, and the four retention prunes (the abandon prune's
  age cutoff had NO floor pin at all; its strip survived until the cutoff
  text joined the prune shape pins, closing a cooldown-evasion hole in the
  pin set).
- Docs-truth fixes in the implement registry: realm suite 19 tests (not 20),
  seven judged singles (not eight, post-upgrade), the commits header now
  names the fix-round commits, the floor and service counts carry their
  moment, the beta-bindings claim trued, the lane-isolation wording trued;
  server/CLAUDE.md's suite roster gained the missing stepup suite and its
  realm parenthetical no longer overstates.

MUTATION RECORD (appendix in phase-20-mutation-log.md): 45 distinct new
mutants, 43 BIT, 1 judged defense-in-depth single
(qa20_expireDue_inner_status, masked by the floor-pinned outer status qual;
its double strip BIT and it joins the state.md judged-singles table), 1
deliberate green fixture-derivation control; three rows needed an in-round
fix before biting and say so. Lanes partitioned by suite; every strip
occurrence-asserted, diff-proven, run-proven, checkout-reverted
byte-identical.

JUDGED this round (binding; do NOT re-raise):
- Explicit 20_000 per-test timeouts on the new bond tests: no change. The
  repo default equals the declared value, the ratchet ignores at-or-under
  declarations, and the file already mixes both styles; adding twenty
  mechanical timeout args changes nothing a regression could observe.
- The fake's deliveredUnclosedSettlementsPage realm-qual fix stays
  comment-backed: unpinnable through the public API (insertSettlement stamps
  the listing's realm, so the with-qual and without-qual filters are
  extensionally equal for every stageable state); a raw staging hook only to
  pin a fake-internal filter would be over-abstraction.
- The registry's "39 of 43 realm-taking methods" stays as recorded: it is
  the qa-checklist reviewer's own sample statement; the docs-truth lane's
  heuristic 47 uses an unstated method definition and was flagged, not
  proven.
- The fidelity suite's dynamic rules import (line ~213): left as-is; the
  file's static server import is of woc_market_db, and mirroring the pg
  suites' deferred-import idiom for rules is harmless consistency, not a
  defect.
- REFUTED (judged with the log open): the inventory lane's claim that the
  hourly-cap probe's account qual has no mutant; cap_account_qual is in the
  log, BIT, round5.

DEFERRED, carried unchanged with owners: the at-scale advisory-cooldown
proof, p99.9 gap, and expiry-batch ceiling to 21 (the at-scale rig); the
pg-suites-in-CI posture and the lock-shape live-chaos observation to 22.
SEQUENCING (settled earlier, carried): the escrow WRITE-path cluster rider,
then the per-request auth-guard reads rider, remain owed BEFORE 21.

VALIDATION at the final tree (all re-run fresh this session): npx tsc
--noEmit clean; the seven-suite pg battery 236 tests zero skips (multiple
green runs; 232 at the audited tip before the fix round's four new tests);
DB-free marketplace suites green (floor 110, service 274, fidelity 11,
routes, escrow_queue; the rules suite gains the exempt-list composition
pin inside its wire-screen test); npm run ci:changed exit 0; the gate
and push results recorded in the final validation note below.

FINAL VALIDATION NOTE: node scripts/gate_select.mjs PASS on the committed
tree at 8581ee5b2d, ALL 12 STEPS green, full-suite fallback (the branch diff
against origin/release/v0.40.0 spans broad paths by design): 41,708 tests
passed with the 2 expected fails and 26 skips, browser regressions 131,
typecheck and all builds green, malware scan PASS, run WITH
TEST_DATABASE_URL only and a clear field (no concurrent pg-suite runs; the
mutation lanes were idle). The fresh fix-round re-review (0 blocking, 1
should-fix, 4 nits) and qa-checklist (READY, 0 blocking; its two in-range
nits applied in 8581ee5b2d; its out-of-range observation, the
tests/server/helpers/index.ts barrel omitting fake_woc_market_db since it
landed, is noted for whenever that barrel is next touched) are both applied
in full. PUSHED per R4 with this note as the docs tip: git push origin
feature/woc-marketplace, the pre-push floor being the check (no open PR on
this branch); the three scratch lanes wocc-marketplace-mut1/2/3 REMOVED
after their spot checks per the implement round's deferral.

## Escrow write-path rider QA round (the paired QA for the first settled rider)

GAME repo, worktree /Users/fernando/Documents/wocc-marketplace, branch
feature/woc-marketplace. Session start 7e07cf12a6 (the rider implement tip).
Audited b72873d24e..7e07cf12a6, the rider's own code being
00334857e0..7e07cf12a6 (34 files, server plus tests plus packet docs).

RELEASE SYNC: origin/release/v0.40.0 had moved 123 commits past the implement
session's sync (the GPU-preparation scheduler, PR #3519), so the merge was NOT
the expected no-op. Merge a22f111644, four conflicts, each RE-DERIVED from the
merged tree rather than taken from a side: hud.ts unions both import edits (the
release's isComposedPortraitKey and armPreviewOpen come in; prewarmPlayerPortrait
deliberately does not, because this branch moved its only call site into
preview_prewarm_wiring.ts, which imports it directly); the hud.ts ratchet re-pins
to the exact merged 19154 and main.ts to 11519 (both parents' pins superseded,
the file's own stated convention); the shard-weight table keeps this branch's
NEWER harvest, verified a strict superset of the release's (2894 vs 2830, zero
release-only rows); the resolved-i18n pending slice was regenerated with
i18n:gen. Dependencies were reinstalled because the merge moved patches/ and the
lockfile (the first of the three recorded release-merge gate hazards; the shard
coverage floor and the CI sparse cone were both checked and clean).
The release-merge-audit skill ran on the merge: the incoming delta touches ZERO
server/ files, zero routes, zero marketplace code (one cosmetic GLB prop), so no
legacy-arm divergence, no inventory rows owed, no injected-helper rebinding, and
no planning premise invalidated. Both parents' intent was verified surviving in
all 12 material overlap files mechanically (every line either side added, checked
present in the merged file); the only "lost" lines are the superseded ceiling
pins and the replaced import, each an intended resolution.

REVIEWERS: four read-only lanes dispatched via plain Agent (privacy-security,
database-performance, server-hot-path, test-coverage). ONE delivered
(test-coverage, a full report); the other three were nudged once per the
one-retry cap and did not deliver inside the session. Recorded honestly: the
security, database-performance and hot-path dimensions therefore carry ONE pass
this round, the main thread's own probes, on top of the implement round's four
lanes over the same code. Every probe below was run directly.

FINDINGS: 14 applied, zero deferred as unfixed. Three from the main thread's
probes, eleven from the coverage lane, each verified with the file open before
applying (no finding was taken on the reviewer's word).

Main-thread probes:
- P1 (should-fix): the unlocked-confirm docblock in woc_market.ts still
  described holdBondAndActivate and extendAuctionForBondProgress as plain
  FOR UPDATE re-reads, which the narrowing had made FOR NO KEY UPDATE. The
  qa-checklist round's note claims it cured "the two pre-narrowing lock-mode
  comments and their CLAUDE.md mirror", but it never touched woc_market.ts, so
  this pair was missed. The completeness pin cannot see it by design (it scans
  comment-STRIPPED source). Cured mode-neutral, the same way the db.ts pair was.
- P2 (should-fix): the delivery-arms extraction left listingReturnCustodyRef
  imported in woc_market.ts with its only use gone to woc_market_delivery.ts
  (two occurrences at rider start, one now). Removed; the ratchet follows the
  file DOWN 4037 -> 4036, the ratchet's own rule applied to the dead line the
  extraction forgot.
- P3 (nit): the packet's reserved word "phase" appeared in a new tunables
  comment in its ordinary English sense; reworded to "stage".

Coverage lane (all eleven applied): acceptDirectedOffer's drain rung had NO
test at all and its saturation sibling's title claimed to cover "the same two
rungs" (new test in the decisive same-proof form, title corrected); neither
entry pinned the rung's pre-burn POSITION, so sinking it below the step-up burn
stayed green (new test with spies proving the health guard's two pooled reads
never ran); only one of the three stamp sites armed the high-water watcher under
test (call-site completeness pin, exact count 3); the routing pin classified by
a LEADING SQL verb and so was blind to a hoisted-SQL writer, an idiom the same
file already uses (classification totality assert); the hold-ceiling relation
priced ONE sequence though the hold spans the character's FIFO queue (see the
deferral below); the depth-cap-before-gate ORDER was unpinned and a swap leaks a
realm slot until the 300s reclaim (real gate injected, inFlight asserted before,
during and after); the escrow-queue HELP line was unpinned (found independently
by the main thread too); the no-drift live-read test covered neither new gauge;
the cap-refused park's arm-level consequence was unpinned; the narrowing's
flat-zero sibling list was hand-enumerated and missed 11 of the 16 marketplace
modules (now DISCOVERED by glob with a non-vacuity floor); and the two new
tunables scrapes rode the file's line-only stripper rather than the shared
block-aware one.

JUDGED this round (binding; do NOT re-raise):
- acceptDirectedOffer runs both pre-burn rungs for the BUYER side too, which
  never escrows unless the buyer presses last. Symmetric by design (either side
  can be the trigger, and the offer state that would distinguish them is not
  worth the branch); the cost of the rare false refusal is one retry.
- returnUndisposedItems has no scope.contended entry guard and no busy budget,
  unlike its two delivery siblings in the same LOCKED segment. Traced: it books
  through the MAIL rail (bookCustodyOnce plus persistMailParcel), never through
  persistGrantSerialized, so it cannot incur a grant-entry deadline; the busy
  budget's bound on the locked segment is unaffected and the returns work is
  independent of whatever contended.
- `walked` in processDueBonds is write-only (biome noUnusedVariables). Traced to
  the merge base: PRE-EXISTING, not the rider's, and a warning CI does not fail.

MUTATION RECORD: 16 distinct mutants this round, ALL BIT, each occurrence-
asserted (region-scoped where a literal repeats), diff-proven, run-proven by the
vitest summary line, and reverted byte-identical with a clean-status verify. Run
in a THROWAWAY git worktree at the audited tip, so no mutation could touch the
tree the reviewer agents were reading, and no pg suite was involved.
- SIX independent spot-checks over the rider's EXISTING pins, with the QA's own
  strip designs rather than the logged ones (the 20 independent-spot-check
  protocol): the narrowing reverted at the escrow ACCOUNTS clause (the log's row
  used a bid clause), the routing reverted at clearBuyNowLock, the gate cap
  off-by-one in tryAcquire ONLY (the literal repeats in saturated(), which the
  occurrence assert caught), the grant entry's ACCOUNT guard stripped under the
  slot, the park cap off-by-one, and the busy budget widened to 99. All BIT,
  independently corroborating the money surface, the routing, the gate, the
  custody guards, the ledger bound and the locked-segment bound.
- TEN over the pins this round ADDED, so no new pin is theatre: help-string kind
  dropped, gate gauge frozen to a single sample, a hoisted-SQL writer, the
  pendingGrants stamp unarmed, the park stat moved out of its refusal guard, the
  gate acquired before the depth cap, a lock clause planted in a sibling the OLD
  hand-kept list never scanned, the hold ceiling widened past its honest bound,
  the acceptance drain rung stripped, and createListing's drain rung sunk below
  the pooled health reads (region-scoped after the flat form's occurrence assert
  correctly refused: that literal appears at both entries).

VALIDATION at the QA tip (all re-run fresh): npx tsc --noEmit clean; the SEVEN
suite pg battery 241 tests zero skips (61 settlement, 66 bond, 40 delivery, 34
directed, 10 plan_pins, 11 stepup, 19 realm_scope), ONE LANE AT A TIME with
TEST_DATABASE_URL on the command line only, run twice (at the merge tip and
again after the fix round) on a verified clear field: the one competing vitest
run on this machine was checked with `ps eww` and carries no database URL, so
its marketplace pg suites skip and cannot collide on the fixed database names.
DB-free marketplace set 27 files, 1171 tests. npm run ci:changed exit 0
(warnings only, the widened post-merge scope's pre-existing debt).

THE TWO MAINTAINER RULINGS, RE-JUDGED (Fernando decides; the QA recommends):
- The woc_market.ts ceiling. RECOMMEND APPROVE, with a correction to the
  number. The registry describes it as "the ceiling raise 4000 -> 4037", but
  the trace across the rider commits shows TWO raises, not one: the
  delivery-arms extraction (fa958644fd) ratcheted the ceiling DOWN 4484 ->
  3984 at the exact new size, then the commitGrant close took it to 4000 and
  the review fix round to 4037, so the raise to judge is +53, not +37. It is
  still the ratchet working rather than being evaded: a REAL extraction moved
  744 lines into a new sibling behind the file's own seam, the ceiling was
  lowered to the exact size first, and the +53 is declaration surface on the
  coordinator's own dependency interface and scope type (the
  persistGrantSerialized contract doc, the escrowSaturated dep with its two
  pre-burn rungs, the busyParks field) that no sibling can absorb because it
  IS the coordinator's seam. Net across the rider plus this QA round: 4484 ->
  4036, 448 lines DOWN, plus a 744-line tested module that did not exist
  before. (This round found and removed a dead import the extraction left, so
  the number moved once more, 4037 -> 4036.)
- The woc_market_db.ts ratchet row (the 17 QA question, carried twice).
  RECOMMEND ADDING ONE, at its exact current size 4783. Confirmed: the file
  has NO row (`grep -c "woc_market_db.ts" tests/monolith_budget.test.ts` is
  0), and it is now the LARGEST marketplace file, larger than the woc_market.ts
  coordinator (4036) that IS ratcheted, with nothing stopping it growing. Its
  rider growth measured +161 net, not the +158 the registry records (the
  qa-checklist round added three more lines after that figure was written).
  The "all SQL-adjacent" argument is real but does not reach the data-as-code
  exemption, which covers declarative TABLES; this file is logic (statement
  builders plus transaction orchestration). Adding a row TIGHTENS the ratchet,
  which the doctrine encourages, but the packet has carried this as a
  maintainer question twice, so it is surfaced rather than taken. Suggested
  seam if adopted: a woc_market_<domain>_db.ts sibling owning that domain's
  statements. Note the same gap covers woc_market_delivery.ts (744) and
  woc_market_custody.ts (526), both also unratcheted.

DEFERRED, with owner (created this round):
- The escrow gate's hold-ceiling SIZING (owner: maintainer, alongside the
  rulings above). The 300s ceiling buys the honest 157s started-request
  ceiling plus the guild-flush heavy allowance plus exactly ONE queued heavy
  save, 23s of slack. The hold is taken BEFORE the guild flush and the FIFO
  enqueue and the 5s waiter deadline does not end it, so a character whose
  queue holds two or more saves each taking the full heavy allowance can have
  a LEGITIMATE hold reclaimed: one over-admitted slot and a misleading
  incident line, never correctness. This round made the prose and the pin
  honest about that bound (both directions asserted, so neither can quietly
  become false) rather than changing the constant, because raising it is a
  sizing decision. Realistically the queue wait is milliseconds (the escrow
  transaction measures p50 3.5ms, max 8.3ms), and a character queue of
  full-allowance saves is itself an incident, which is why the QA did not
  treat it as blocking.

## Escrow write-path rider implement round (the first settled rider)

GAME repo, worktree /Users/fernando/Documents/wocc-marketplace, branch
feature/woc-marketplace. Session start b72873d24e (the 20 QA tip). Release
sync: merge 00334857e0 of origin/release/v0.40.0 (59 commits, the controller
cross-hotbar packet PR #3501; four conflicts resolved by re-deriving from the
merged tree: hud.ts ratchet 19151 exact, main.ts 11555 exact, the hud
update-drive split window 48 / chrome 83 / none 17, the shard-weight table
unioned with the release CI harvest keeping the 43 branch-only files'
local durations, the resolved-i18n pending slice regenerated via i18n:gen).
The release-merge-audit skill ran on the merge: no marketplace overlap
beyond count-pin surfaces, no legacy-arm divergence, no new endpoints, no
injected-helper rebinding owed, no planning-premise breaks; both sides'
intent verified surviving in every overlap file. LOCAL per R4: nothing
pushed; the rider QA session pushes on PASS.

SPEC PAIR minted first (0b87229b2d): rider-escrow-write-path.md carries the
cluster verbatim from the 16/17 registries plus a findings-context section
recording the recon corrections (16 blocking lock sites mostly on LISTINGS
rows, the stale 4-x-statement phrasing, no saveAll suppression mechanism
exists, nothing refused on drain, the negatively pinned FIFO carve-out, the
substring pins the narrowing would red). Recon: three read-only Explore
agents over the escrow write path, the locking surface, and the
routes/monitor seam before any code.

COMMITS (spec to close): 0b87229b2d spec pair; ccc81cf4e6 gate + honest
occupancy + observability; b847072c55 TxNeverStarted widening; 8a91fafa62
the FOR NO KEY UPDATE narrowing; 57c7ee92d7 the bounded plain writers;
19e47fb9b5 the drain refusal; fa958644fd the delivery-arms extraction;
d715a7e5c8 the ledger bounds; c626080516 the commitGrant FIFO close;
7ab41bdf09 the four-lane review fix round; 136e18721c the recorder-arm
pins; b54a6e5b45 the narrowed-mode behavioral pin; 793528b26b the
park-refusal counter + the rider mutation section; 22523b4449 the
reclaiming saturation probe + accept-rung coverage; 7d9fb28dbb the
mutation re-verification rows.

DELIVERABLES vs the spec, all nine landed (order held: occupancy before the
FIFO close):
1. Honest occupancy: the guild-flush term joined the exclusion comment and
   a pinned relation (scraped DB_HEAVY_STATEMENT_TIMEOUT_MS exceeds the
   whole workload sum); the started-request ceiling is DERIVED at 157s
   (pool checkout + session-default BEGIN/SET LOCAL + five workload
   statements + FIVE inter-statement idle windows at the save tier + lock
   wait + driver-backstop COMMIT, the review round adding the idle term the
   first 107s cut omitted) with scrape pins on both docblocks that quote
   it; the flush-tier tightening stays REJECTED per the 06 ruling,
   re-affirmed at the constant.
2. The realm escrow gate (server/woc_market_escrow_gate.ts): cap 4 (equal
   to scraped SAVE_CONCURRENCY, below the pool default, both-saturated
   under pool minus two, all relation-pinned), immediate typed refusal, no
   queue; slot held for the WORK lifecycle; the review round added the
   hold-ceiling reclaim (300s, above 157s + the 60s heavy allowance,
   counted and loud) and the fresh-review round made the SATURATION PROBE
   reclaim (a bare stats read made a full wedge's outage permanent because
   the pre-check refused before any acquire could reclaim); custody-only by
   pin (sweep, monitor, and the grant entry all flat-zero).
3. Observability: pendingKeys gauge woc_character_save_pending_keys (the
   serial writer's pre-plumbed accessor, all three GameStateSource
   implementations); gate occupancy gauge woc_escrow_gate_in_flight;
   counter kinds realm_refused + settled + grant_busy (ordered vocabulary
   pin, zero-backfill, help string current); contention classes deadlocks +
   txNeverStarted counted beside idleTxKills + lockWaitTimeouts, all four
   on the stuck readout with the gate stats, the hrtime-bracketed
   escrowSerialize numbers, stampHighWater crossings, and parkRefusals; the
   saveAll-wave measurement pinned as a fact (one wedged FIFO costs one
   worker slot, the wave drains every other character and honestly waits).
4. TxNeverStarted widening: eleven tails take the tag to their contention
   arm (typed contended, or false on the no-open-settlement probe: parking
   assumes least); the two recorded exceptions are exact-count pinned (the
   plain-pool advisory reads where the tag cannot occur; the delivered-save
   count-then-rethrow keeping commitGrant's evidence).
5. The narrowing: all 21 lock clauses FOR NO KEY UPDATE (16 blocking + 5
   SKIP LOCKED, judged together: the claims' FK-share skip change traced
   benign and an improvement); zero plain FOR UPDATE left, completeness
   pinned comment-stripped with sibling flat-zeros; real-SQL proofs with
   plain-mode negative controls (freed bid insert against a guarded
   listing, freed abandon against the escrow-held accounts row,
   same-account NO KEY self-conflict at the cap), and the source's own mode
   bound behaviorally (a held FOR KEY SHARE never blocks the real escrow
   transaction: the mutation campaign's ex-survivor, closed in-round).
6. The bounded plain writers: all 38 row-writing sites ride boundedWrite
   (ONE merged SET LOCAL query, lock 2s + idle at the SAVE tier per the fix
   round: the seam's round-trip gaps are pure protocol idle and a 2s kill
   destroys a pooled client), classified and counted; the five SKIP LOCKED
   sweep claims stay direct BY JUDGMENT (non-blocking by construction), as
   do the module-level retention prunes (nightly, budget-bounded,
   failure-isolated; a 2s refusal would only defer work to the next night)
   and the reads; a routing completeness pin holds 38 bounded vs exactly 5
   sanctioned direct write sites so the workload-filtered rigs cannot hide
   an un-routed writer. clearBuyNowLock is best-effort by FULL contract:
   retry once on contention (an un-cleared lock's expiry mints an abandon
   record against the blameless holder), then swallow everything loudly.
   The two money-path signature recorders answer typed 'contended' mapped
   to the retryable confirm_in_flight at both callers (per-site judgment
   the spec demanded: 500ing a payment already on chain was the defect,
   and the old 15s wait usually won where the new 2s bound often loses).
   The 57014 ruling STANDS untouched.
7. The drain refusal: BOTH escrow entries (createListing and the directed
   acceptance, which escrows through it) refuse market_paused FIRST and
   IO-free, before the health guard's two pooled reads and before any
   step-up proof is consumed; wired to the health module's drain flag
   through the optional dep (absent in every rig). The saturation pre-check
   rides beside it for the same pre-burn reason.
8. Ledger bounds: park maps cap at 512 through wocParkRow (existing ids
   always re-park; refusals counted on the readout; the parked stat counts
   only standing parks), the relation pinned against scraped SWEEP_BATCH
   with the 4096 SQL-sanity ceiling; stamp maps (exactly-once intents)
   never shed: a counted, re-arming high-water warn at the TOTAL across
   both maps, direct-rig pinned through a failing mail persist.
9. The commitGrant FIFO close: the delivered save rides the buyer's
   per-character FIFO through custody's bounded persistGrantSerialized
   (in-slot serialize proven fresher than the wait by a mid-wait bag
   change; account/session/nonce/serialize re-validated UNDER the slot,
   every dimension independently pinned), with 'busy' parking the row
   (claim, grant intent, ledger entry intact) counted as grant_busy, and
   the delivery batch stopping the scope after WOC_GRANT_BUSY_BUDGET (2)
   busy parks like a contended pass, so a save-wave wedge costs the LOCKED
   sweep segment a bounded number of deadlines per pass, never one per row
   (the convergent blocking find of the review round; the eager confirm
   entry shares the bound through its own scope). The claims-ledger park
   subset is intact (lease_lost, transient-throw, claim_missing arms
   unchanged); the sanctioned-FIFO-entries pin counts the two custody
   entries exactly; the extraction paying for it moved the delivery arms
   to server/woc_market_delivery.ts (move-audited character-identical
   after normalization by the fresh reviewer, the four diffs being exactly
   the rider's intended edits).
   Conditional not built: the F1 low-water cursor (blocked-prefix growth
   never observed; the condition is recorded in the spec).

REVIEWS. Four read-only lanes via plain Agent (privacy-security,
database-performance, server-hot-path, test-coverage), all prompted for
coverage: roughly 40 findings; the three implementation lanes converged on
ONE blocking cluster (the per-row FIFO wait inside the locked delivery
segment: up to 2 x SWEEP_BATCH x 5s of advisory-lock hold, plus the same
waits inline in the eager confirm), and the coverage lane found two blocking
pin holes (the workload-filter routing blindness over 36 of 38 bounded
writers; three of the grant entry's four guard dimensions unpinned, the
ownership fence included). EVERY finding applied or judged with the file
open; the fix round (7ab41bdf09 + 793528b26b) was then re-reviewed FRESH,
which found the dead-reclaim-behind-the-pre-check blocking interaction (two
individually sound fixes composing into the exact outage they prevented)
plus the fake-union type gap, both fixed in 22523b4449 with the directed
acceptance's rung coverage; nits applied (the misattributing retry log, the
approximate in-flight arithmetic comments, the spec-tier amendment note).

JUDGED this round (binding; do NOT re-raise):
- The gate's transient over-free after a reclaimed sequence later settles:
  SUPERSEDED by the qa-checklist round, which moved the gate to
  identity-tokened holds (a reclaimed hold's late release is a no-op, so
  the over-free window no longer exists; pinned directly).
- The pool "reserve" arithmetic (gate + wave <= pool minus 2) is SIZING,
  not enforcement: nothing fences the remaining clients, which also serve
  every non-market read; the gate comment says exactly this.
- The session_lost race trade at the FIFO close: a buyer disconnecting
  between grantCopy and the slot can have the leave flush persist the
  granted bags while the row parks unfinalized for the operator; the close
  is the SAFER direction (the pre-captured blob committing was the exact
  stale-ordering hazard the rider fixed) and the expectation is recorded at
  the arm.
- The SKIP LOCKED claims' FK-share skip change (narrowed claims no longer
  skip rows held only by an in-flight FK-child insert): every child traced,
  benign and a slight improvement (fewer spurious skips); recorded here as
  the judgment the mode rename implies.
- The started/settled arithmetic is APPROXIMATE (a deadline-cancelled
  sequence whose flush then rejects books two entered kinds): stated at
  the vocabulary; the gate stats and gauge are the instantaneous truth.
- insertSale has no production caller (the sale row is written inside
  finalizeDeliveredSettlement): pre-existing dead interface member,
  recorded as a maintainer cleanup item, not this rider's regression.
- The routing pin's leading-verb regex would miss a hypothetical WITH-CTE
  writer: no such site exists; noted in the pin's comment territory as
  future-gameability, not a current gap.
- The per-site lockWaitTimeouts split and pgPool high-water stay 22-owned
  (the 17 QA judgment carried).
- The per-tail behavioral coverage of the widening is 2 of 11 shapes with
  the count pin decisive against both regression directions: judged
  acceptable by the coverage lane and adopted.
- The eager-confirm entry keeps its inline scope literal (bounded to the
  same 2-deadline budget); its park-count discard stays as documented.
- 57014 remains incident-shaped on statement blowouts (the 05 ruling,
  upheld again): under the bounded seam contention surfaces as 55P03, so
  the ruling and the classification never collide.

MAINTAINER RULINGS OPEN (the rider QA re-judges, then Fernando):
- The woc_market.ts ceiling raise 4000 -> 4037 inside the rider (net 447
  DOWN across the rider, 4484 to 4037): the raise covers the
  persistGrantSerialized interface contract doc, the escrowSaturated dep
  with its two pre-burn rungs, and the busyParks scope field, argued as
  declaration surface no sibling can absorb. Root CLAUDE.md makes any
  raise a maintainer decision; recorded here rather than silently taken.
- server/woc_market_db.ts still has NO ratchet row (the 17 QA question,
  carried); its rider growth is net +158 lines, all SQL-adjacent
  (boundedWrite, counters, the narrowing comments).

QA-CHECKLIST ROUND (ran LAST per the charter, static-only beside the gate
run): verdict READY with 2 should-fix and 4 nits, ALL applied
(961aa1e411). S1: the gate's positional FIFO hold retirement
UNDER-reported a wedged hold's age on out-of-order settles (the docs
claimed the safe direction backwards) and let churn starve the reclaim;
cured at the root with identity-tokened holds (exact ages, the reclaim
hits only the wedged hold, no over-free, churn-starvation and late-release
no-op pinned). S2: pre-check saturation refusals were counted nowhere, so
realm_refused stayed flat during sustained saturation; the probe now
counts its true answers and the main.ts wiring emits the kind on the same
arm (both halves mutation-proven). Nits: the retry's doubled worst-case
latency stated at clearBuyNowLock; the flat-zero pins gain the
characterSaveQueues token (the door-closing judgment: a narrowing getter
on game.ts costs lines against its exact ceiling, so the pin closes the
second door instead); the two pre-narrowing lock-mode comments and their
CLAUDE.md mirror read mode-neutral; the delivery rig's partial ctx behind
a throwing proxy. The checklist's clean sweep is its own record: zero src/
files in the diff, no new player string, no new env name, no DDL, commit
hygiene and the no-"phase" rule verified across all commits, CLAUDE.md
claims checked symbol by symbol, and the exactly-once property probed
hardest and unbroken under the busy park.

VALUES REGISTRY (the rider QA re-judges): gate cap 4 = SAVE_CONCURRENCY,
hold ceiling 300_000 > 157_000 + 60_000; WOC_GRANT_BUSY_BUDGET 2 per scope
across both batch arms and the eager entry; park cap 512 in [8 x
SWEEP_BATCH, 4096]; stamp high-water 512 on the two-map total, counted,
re-arming; boundedWrite = BEGIN + ONE merged SET LOCAL (lock 2s, idle 10s
save-tier) + statement + COMMIT, envelope pinned once raw; the started
ceiling 157_000 derived and scrape-pinned in two docblocks; counter
vocabulary eight kinds ordered; recorders' contended -> confirm_in_flight;
clearBuyNowLock retry-once-swallow-all; drain + saturation rungs pre-burn
on both escrow entries.

MUTATION RECORD (the rider section + re-verification block in
phase-20-mutation-log.md): 30 distinct mutants, 28 BIT, 1 deliberate green
control, 1 first-scoring survivor upgraded to BIT in-round (the bond
suite's freed-insert proof holds its own raw-client lock, so the escrow
source's mode needed the KEY-SHARE-holder behavioral pin before the strip
could bite: the wrong-suite class), 4 stale-verdict re-runs after pin edits
all BIT. Serial lane over the committed tree; the two pg mutants ran alone.

SUITE GROWTH: directed_sql 110 -> 116 (the floor reference in state.md and
the gate docs should read 116); service 274 -> 283; escrow_queue 26 -> 36;
NEW woc_market_escrow_gate (8) and woc_market_delivery (2) suites;
local_ledgers 3 -> 5; fake fidelity 11 unchanged; the pg battery 236 ->
241 (three narrowing proofs and the plain-writer bound in bond, the
narrowed-mode binding in delivery), zero skips throughout.

VALIDATION at the tip (all re-run fresh): npx tsc --noEmit clean; the
seven-suite pg battery 241 tests zero skips with TEST_DATABASE_URL on the
command line only, single lane; the DB-free marketplace set 974 tests
across 23 files; npm run ci:changed exit 0 (warnings only, pre-existing);
node scripts/gate_select.mjs on the committed tree at code tip 7d9fb28dbb:
PASS, ALL 12 STEPS green, full-suite fallback (2,943 test files passed plus
the env-gated perf-budget skip; 42,059 tests with the 2 expected fails and
the 26 known default skips), browser regressions 131, typecheck and all
builds green, malware scan PASS (6,423 files, 0 high after priors). Run
with TEST_DATABASE_URL on the command line only, no tail pipe, a clear
field (no concurrent pg-suite runs; the mutation lane was idle). The two
docs commits on top (this registry, a7d2587dbc and the gate-note wrap) are
docs-only, the packet's recorded wrap pattern. RE-RUN after the
qa-checklist fix round at the FINAL tip 5f34d0769f (code tip 961aa1e411
plus the registry docs): PASS again, ALL 12 STEPS green, full-suite
fallback, 42,061 tests with the same expected fails and known skips,
browser 131, typecheck, all builds, malware scan PASS; the pg battery and
ci:changed were additionally re-run green at that tip before the gate.

NEXT = docs/woc-marketplace-hardening/rider-escrow-write-path-qa.md, GAME
repo, worktree wocc-marketplace, FRESH session, newest origin/release/**
sync first; it audits b72873d24e to the recorded tip. After its PASS push:
the second rider (the per-request auth-guard reads, design constraints in
the 17 SESSION START DECISION bullet in state.md), then
phase-21-devnet-dry-run.md.

## Auth-guard read cache rider implement round (the second settled rider)

GAME repo, worktree /Users/fernando/Documents/wocc-marketplace, branch
feature/woc-marketplace. Session start f844a72eaa (the escrow rider QA tip,
pushed). Release sync: EMPTY (origin/release/v0.40.0 tip 65b91fa190 was
already an ancestor of HEAD; "Already up to date", no merge commit, no audit
owed). LOCAL per R4: nothing pushed; the rider QA session pushes on PASS.

SPEC PAIR minted first (ab058a21f9): rider-auth-guard-reads.md carries the
cluster verbatim from the 16 QA deferral and the 17 SESSION START DECISION,
plus a findings-context section recording the recon corrections (three
read-path lanes, a bust-surface lane, a cache-idiom lane, and main-thread
probes): the guard runs BEFORE the read limiter, not behind it; the admin
gate already resolves through the separate adminDb() bundle with NO
moderation read; the hot offers GET rides the ACTIVE guard, which is why the
cache covers the whole bundle; the bust surface measures 20 statements in 16
functions across five files; the quota-consume stored procedure falls outside
the cached projection by COLUMN; the generic cached_read factories stale-serve
and so cannot carry an auth read; multi-realm processes sharing one database
make the TTL bound real; no caller anywhere distinguishes an expired token
from a deleted one, and no UPDATE auth_tokens exists (no sliding expiry to
conflict with).

COMMITS (spec to close): ab058a21f9 spec pair; 46911ec2c1 the pure-core
extraction; bd856f76b3 the cache module; a933edf2b1 the marketplace wiring;
14027a6d2c the writer busts + the discovery pin; e854b21f3f the eighth pg
suite + server/CLAUDE.md; 1ca8645274 the mutation log; f0dc5f48d1 the fix
round (discovery window hardening, the decorative assert, the lint unroll).

DELIVERABLES vs the spec, all seven landed:
1. The pure core (server/auth_guard_core.ts): tokenInfoFromRow (fail-closed
   scope allowlist + read-time expires_at re-check, strictly-greater bound)
   and computeModerationStatus (the exact ban/suspension/deactivation ladder,
   every time compare at read time, byte-identical prose, a fresh object per
   call), with the row types and the moved AccountModerationStatus
   re-exported from db.ts so every importer compiles unchanged. db.ts is
   fetch + pure compute on both reads (authTokenRowForToken now SELECTs
   expires_at; the SQL qual stays as belt) and ends the rider at 4832 lines,
   net 44 DOWN from 4876 under its 4980 ceiling.
2. The cache (server/woc_auth_guard_cache.ts): raw rows only, both arms TTL
   5s / LRU 1024 with counted eviction, per-key single-flight, the lost-bust
   cancel rule, NO negative caching (null probes install nothing: the
   eviction-lever defense), NO stale-serve (a failed refresh propagates and
   installs nothing), the read-time expiry drop of a dead token entry, the
   account-to-tokens index with the amortized residue sweep (bound 4x the
   token cap), per-arm stats, and the boot-configured singleton whose free
   bust functions the writers call.
3. The busts at every discovered writer, post-COMMIT where transactional:
   db.ts saveToken / revokeTokensExcept / revokeToken / revokeReadToken /
   revokeCompanionToken (account-keyed: the prefix cannot address the cache,
   over-busting is the safe direction) / consumePasswordResetRequest /
   setAccountDeactivated; moderation_db.ts moderateAccount (one call after
   the four-arm transaction, beside its hooks) / muteAccountChat /
   liftAccountChatMute / reactivateAccountAudited / resetChatStrikesAudited;
   chat_filter_db.ts applyChatStrike / resetChatStrikes;
   general_chat_quota_db.ts setGeneralChatRateLimit (both the DELETE and the
   upsert side).
4. The marketplace-only wiring: main.ts arms the singleton over the two real
   fetchers and injects the instance through WocMarketRuntime.authGuardDb;
   the routes' guard thunk resolves test override FIRST, then the injected
   cache, then the direct reads, so every existing rig is untouched; BOTH
   player guards read through it; the admin gate keeps resolving through
   adminDb(); stats ride the stuck readout; shutdown clears the singleton.
5. The pins: the core matrix suite (21); the cache mechanics suite (17); the
   discovery pin (comment-stripped whole-server walk, COLUMN-precise
   classification that excludes the quota consume structurally, enclosing
   function attribution with a loud totality arm for hoisted/module-scope
   SQL and an unclassifiable arm for a SET list outrunning the window, the
   exact 20-statement reconciliation map, the single reasoned
   accounts-DELETE exemption, and the import-boundary equality that keeps
   the cache reachable from exactly the writers plus main.ts); the wiring
   suite (real middleware chains: cache live on both guards, override
   precedence, revocation flip, and the ADMIN BEHAVIORAL CONTRAST: one
   shared token store, revocation refuses the admin gate on the very next
   request while the player cache still serves); the hot-reads wiring pins
   (one configure call, real fetchers, stats field, shutdown reset).
6. The eighth pg suite (tests/woc_market_authguard_pg_integration.test.ts,
   fixed database wocc_woc_market_authguard_verify, the stepup suite's boot
   pattern): the token qual against live/expired/deleted rows, the raw-row
   fetchers over real timestamptz, and the REAL writer-to-bust chain for
   revokeToken, the companion prefix delete (sibling survivor seeded), the
   revoke-except keep, the password-reset consume, moderateAccount
   ban/suspend/unban, the live strike writers, the quota policy setter both
   directions, and the deactivation flip. 11 tests; skips green without the
   env var; the gate dry-selection probe confirms the suite SELF-SELECTS
   into the always-run floor (nine pg suites in the floor now).
7. Docs and registry: server/CLAUDE.md gains the module row, the extended
   bust rule, and the TTL's cross-process meaning; this section; state.md.

REVIEWS. Four read-only lanes dispatched via plain Agent
(privacy-security-review, server-hot-path-reviewer,
database-performance-reviewer, test-coverage-auditor), all prompted for
coverage. All four first completed with narration-only output (14 to 34
tool calls each) and ALL FOUR DELIVERED FULL REPORTS after one nudge each
(the 2026-08-11 pattern, not the zero-delivery one), the dbperf lane with
measured plan evidence and a runtime proof. The MAIN THREAD independently
found the round's one substantive defect BEFORE the reports landed and two
lanes then proved the same race live: an ACCOUNT-keyed bust could not
cancel an in-flight token fetch (nothing is indexed until install), so a
revocation sweep could be outrun by an install of the pre-delete row and a
revoked token could answer for one TTL in the SAME process, against the
contract. Fixed with a content-keyed install veto (the row's account
checked against a recent-bust ledger at install time; a stranger's racing
fetch still installs), plus the ledger's two-pass soft-bounded prune the
dbperf lane's probe demanded. Every other finding applied in the same
round: shutdown flushes but keeps the singleton armed (the W2 reboot
shape), LRU caps re-sized against the 5,000-player realm admission cap
(the 1,024 figure sat under the working set and LRU degrades as a cliff),
an alertable prometheus gauge for both arms, the quota NOTIFY listener now
busts the guard cache (closing the cross-process gap for the policy
columns), the discovery classifier gained the accounts-upsert arm,
schema-qualified names, a statement-bounded window, non-exported function
heads, and a structural bust-after-last-COMMIT pin, the keyed busts are
proven keyed by stranger survivors on every arm, the wiring suite proves
the 403 bodies and the per-request staff re-read, the pg suite pins a long
TTL with a raw-SQL warm-stale control (every bust proof decisive by
construction, never by wall-clock accident) and covers revokeReadToken
plus the four audited moderation writers, and the TTL docblock's win claim
was replaced with the measured per-surface factors (3x trade window, 2x
idle Exchange, 4x awaiting chain). Fix commits 98813d67a2 and 02108093eb;
the fix round's own code carries its own mutants and the edited pins'
verdicts were re-run (the mutation log's review-round block).

JUDGED this round (binding; do NOT re-raise):
- Pre-bust in-flight joiners can receive the pre-revocation answer ONCE
  (the flight they joined resolves for them; nothing installs). This is the
  cached_read epoch discipline verbatim, indistinguishable from the request
  having arrived a moment earlier; recorded at the cache header.
- saveToken notifies on INSERT although a fresh random token can have no
  cached entry: kept so the auth_tokens writer class carries ZERO discovery
  exemptions (the call is a no-op by construction and one line).
- resetChatStrikesAudited busts only when a row actually reset (found):
  a no-row update changes nothing the cache serves.
- INSERT INTO accounts (registration) is out of the discovery classifier BY
  RULE: a freshly created account cannot be cached (no token exists yet);
  the classifier scans UPDATE accounts SET and DELETE FROM accounts only,
  and the reasoning is recorded in the pin's header territory.
- The read-scope-only revokeReadToken busts the token unconditionally even
  when its scope qual deleted nothing (a full token passed): over-bust,
  harmless, simpler than threading the rowCount.
- The wiring-suite moderation rows for the admin contrast rely on the admin
  gate having NO moderation read at all (AdminAuthDb): that absence is the
  production design (staff is trusted operator authority), not a test gap.
- The unit LRU/eviction fixtures use injected small caps rather than the
  1024 production constant (deriving a 1024-entry fixture would be pure
  runtime); the production values are exact-pinned with the TTL scrape pin,
  and the index-sweep fixture DERIVES from WOC_AUTH_GUARD_INDEX_SWEEP_FACTOR.
- Cross-process staleness stays the recorded 17 acceptance (TTL 5s ceiling)
  for every projection column EXCEPT the chat-quota policy pair, whose
  existing NOTIFY channel now busts the guard cache in every process at
  zero cost (the dbperf lane's suggestion, adopted); a NOTIFY channel for
  bans/revocations remains the recorded option for 22's pre-enable audit.
- The stats shape stays the five-counter WocMarketReadCache form (reads,
  refreshes, evictions, busts, entries), not the spec's hits/misses
  wording: refreshes IS the residual DB query rate, reads minus refreshes
  approximates hits (a flight joiner counts as neither), and matching the
  sibling caches keeps the readout comparable (dbperf P2, judged).
- Post-COMMIT placement is uniform in DISCIPLINE, not in shape: four
  transactional writers bust after the finally, two after COMMIT inside the
  try (matching the bustDiscordStatus precedent at the same site); the
  structural pin holds bust-after-last-COMMIT for every shape (dbperf P2,
  recorded).
- The companion-token surface has no per-account mint cap, so a determined
  authenticated account can thrash the token arm back to the uncached
  baseline (never past it, never wrongly): the evictions counter and gauge
  are the signal; the mint-cap fix belongs to the account surface and is
  recorded for 22's pre-enable audit (hot-path P2, judged).
- The invalid-bearer probe floor stays: a well-formed unknown 64-hex bearer
  still costs one unmetered point read per request (the guard runs before
  the limiter, and negative caching is refused on purpose); the cache
  relieves authenticated repeat callers only. Recorded so no reader
  assumes the floor is gone (hot-path F4).
- The guardDb thunk keeps the runtime-injection shape rather than resolving
  through the module singleton getter (the dbperf alternative): injection
  preserves rig isolation (no test pays for wiring it never asked for),
  and the shutdown bustAll-keep-armed fix closes the consistency hole the
  getter would have closed, without coupling the routes to the cache
  module (judged).
- The cap env knobs the hot-path lane suggested stay code constants per
  the escrow rider's convention (prefer constants unless an operator
  genuinely needs the knob); 22's pre-enable audit re-judges with the
  gauge data in hand.
- The hot-path lane's micro-allocation nits (the seed promise on a miss,
  the second now() per verdict, the Date copy in the fetcher) are declined
  with reasons: each is semantically necessary or noise against the two
  round-trips the hit removes; recorded here so they are not re-raised.

VALUES REGISTRY (the rider QA re-judges): WOC_AUTH_GUARD_CACHE_TTL_MS 5_000
(scrape-pinned to its own docblock, anchored; the ONE accepted staleness,
cross-process, except the quota policy columns which the NOTIFY listener
busts across processes); WOC_AUTH_GUARD_TOKEN_CACHE_MAX 10_240 and
WOC_AUTH_GUARD_ACCOUNT_CACHE_MAX 5_120 (re-sized in the review round
against the 5,000-player realm admission cap, relation-pinned: tokens above
accounts, accounts at or above the realm cap);
WOC_AUTH_GUARD_INDEX_SWEEP_FACTOR 4 (index residue bound 4x the token cap,
swept amortized); WOC_AUTH_GUARD_RECENT_BUSTS_MAX 512 with
RETENTION_MS 60_000 and MIN_AGE_MS 20_000 (the veto ledger's soft bound:
never drop an entry younger than the fetch deadline); guard precedence
override > runtime cache > direct reads; bust vocabulary
bustWocAuthGuardToken / bustWocAuthGuardAccount / bustWocAuthGuardAll (the
flush lever the review round restored); the prometheus gauge
woc_auth_guard_cache{arm,kind} zero-backfilled; shutdown = bustAll, never
reset (the singleton stays armed); the discovery reconciliation 20
statements in 15 writer functions across 4 writer files (chat_filter_db 2,
db 7, general_chat_quota_db 1, moderation_db 5), plus the ONE exempted
delete (deleteUnusedFederatedProvision in federated_auth_db.ts, the 16th
function and 5th file the older "16 across 5" phrasing counted); the
import boundary exactly {chat_filter_db, db, general_chat_quota_db,
http/game_metrics, main, moderation_db}. The veto ledger's min-age floor
is RELATION-pinned against the exported db deadlines (min age at or above
DB_QUERY_TIMEOUT_MS + DB_POOL_CONNECT_TIMEOUT_MS, retention above the
floor: the qa-checklist round's S4), and bustWocAuthGuardAll is exercised
by the unit suite with its no-production-caller note (N1).

MUTATION RECORD (the auth-guard rider section in phase-20-mutation-log.md,
including the review-round and qa-checklist blocks): 27 distinct live
mutants, 26 BIT, 1 deliberate green control, 0 unexplained survivors; one
superseded row
(the negative-install strip, its region rewritten by the veto fix, retired
for its v2); the one pg mutant (the token qual strip) ran alone in its own
lane; every stale verdict re-run after its source or pin moved (three
re-verification blocks). Whole log 368 distinct mutants.

SUITE GROWTH (final, after the review fix round): NEW auth_guard_core
(21), woc_auth_guard_cache (20), auth_guard_bust_coverage (4),
woc_market_auth_guard_wiring (7), and the authguard pg suite (13);
token_scope_db 5 to 7 (the live-expiry fixture correction plus the two
read-time belt arms); woc_market_hot_reads 67 (the wiring pins folded into
the production-wiring test); game_metrics grew the gauge test. The pg
battery is EIGHT suites, 254 tests, zero skips (241 + 13).

VALIDATION at the tip (all run fresh): npx tsc --noEmit clean; the
EIGHT-suite pg battery 252 tests zero skips, one lane at a time with
TEST_DATABASE_URL on the command line only, clear field; the DB-free
marketplace battery 14 files 850 tests; the guard-adjacent and new suites
20 files 1012 tests; the moderation/chat/quota set 68; the S3 guard,
monolith budget (db.ts 4832 under 4980; no ratcheted file grew), and
architecture tests green; suite_duration_budget green with the new pg
suite; npm run ci:changed exit 0 (warnings only) after the fix round.
node scripts/gate_select.mjs on the committed tree at 3e767bf483: PASS,
ALL 12 STEPS green, full-suite fallback (the branch-vs-release diff spans
412 paths including full-suite triggers, the conservative fail-safe; the
selective speedup does not apply on this branch): 42,637 tests passed with
the 2 expected fails and 369 known skips across 3,015 files, browser
regressions 131, typecheck and all builds green; TEST_DATABASE_URL on the
command line only, no tail pipe, clear field. Independently reproduced by
the qa-checklist agent at the same tip (its own run, same 12-step PASS).
RE-RUN at the final code tip after the qa-checklist fix round: the result
is recorded in the gate re-run note at the end of this section.

MAINTAINER RULINGS RE-SURFACED (open, not re-decided): the woc_market.ts
ceiling raise (+53 across the escrow rider's two raises, net 4484 to 4036
DOWN); the woc_market_db.ts no-ratchet-row question (largest marketplace
file at 4783); the escrow gate hold-ceiling SIZING deferral (300s buys one
queued heavy save). None is touched by this rider.

QA-CHECKLIST ROUND (ran LAST beside the gate): verdict READY, 0 blocking,
4 should-fix + 2 nits, ALL applied: S1 the missing gate note (above), S2
the stale suite counts (corrected above), S3 state.md's self-contradicting
cap figure (corrected there), S4 the veto ledger's bare 20s floor (now
70s/90s, covering the 65s driver backstop plus checkout wait, the
black-holed-server case, relation-pinned against the exported db
deadlines), N1 the unexercised flush lever (now unit-exercised with its
no-production-caller note), N2 the 16-function phrasing (spelled out in
the values registry). Its adversarial pass probed and REFUTED three
candidate gaps itself (out-of-tree writers are out-of-process dev tooling;
the woc_market_strikes suspended_until write targets a different table;
the hook chain ahead of each bust is throw-proof). The checklist also
verified the moderation prose byte-identical against the pre-rider
function, the S3 corpus unaffected by the relocation, commit hygiene
across all twelve commits, and every acceptance criterion.

GATE RE-RUN at the final code tip 1f9f8aac4a after the qa-checklist fix
round: PASS again, ALL 12 STEPS green, full-suite fallback, 42,980 tests
passed with the 2 expected fails and 26 known default skips across 3,014
files plus the env-gated perf-budget skip, browser regressions 131,
typecheck and all builds green; TEST_DATABASE_URL on the command line
only, no tail pipe, clear field (the mutation lane was idle). The docs
commits on top of 1f9f8aac4a (this note and the mutation-log rows) are
docs-only, the packet's recorded wrap pattern. The qa-fix round's own
code carries three mutation rows (floor regression, gutted flush lever,
the floor-pass re-run), all BIT; rider mutation totals close at 27
distinct live, 26 BIT, 1 green control.

NEXT = docs/woc-marketplace-hardening/rider-auth-guard-reads-qa.md, GAME
repo, worktree wocc-marketplace, FRESH session, newest origin/release/**
sync first; it audits f844a72eaa to the tip recorded in the final gate note
and pushes on PASS per R4. After its PASS:
docs/woc-marketplace-hardening/phase-21-devnet-dry-run.md.

## Auth-guard read cache rider QA round (the paired QA session)

GAME repo, worktree wocc-marketplace, branch feature/woc-marketplace.
Audited f844a72eaa..e26c3ed9ec (code tip 1f9f8aac4a + the docs wrap) per
rider-auth-guard-reads-qa.md; this session's release sync was EMPTY
(origin/release/v0.40.0 tip 65b91fa190 still an ancestor; no merge commit,
no audit owed). VERDICT: PASS-WITH-FOLLOWUPS, every fix applied in-session
(commits 27262d293d fix + 7dd34268a8 test + 7b6e0badb0 the re-reviewed
second fix + 3e77e6f44e the qa-checklist round + the docs wrap), pushed
per R4.

WHAT THE AUDIT DID. Every charter probe ran on the main thread: the
discovery pin was gamed with EIGHT planted writer shapes in the throwaway
worktree (hoisted module-scope SQL, new-file writer, buried projection
column, second accounts DELETE, new-file upsert, class-method writer all
RED correctly; schema-qualified and lowercase-keyword writers both EVADED,
the round's first two findings); the install veto was attacked with four
interleaving probes (post-bust recovery, double-bust mid-flight, burst
prune vs live flight, moderation-arm lost-bust: all held); the 20-protocol
independent spot-checks re-proved seven logged pins with the QA's own strip
designs at different sites (all BIT); scope containment was verified by
diffstat (23 files, no non-market guard surface touched), by the claudium
per-request canary suite, and by an independent import grep; the registry's
counts (suite sizes, 20-site reconciliation, 27/26/1 mutation totals, line
counts incl. db.ts 4832 = net 44 down, whole-log 368) all reconciled
against reality with zero drift found.

REVIEWER REALITY: four lanes dispatched; security and hot-path delivered
FULL reports unprompted (a first), coverage delivered unprompted,
db-performance stayed silent after its one nudge, so that dimension
carries the main thread's pass plus the implement round's delivered dbperf
lane. The two delivered perf/security lanes independently measured the
same quadratic-prune stall (~71-74ms at the 5,000-account fan-out) and the
security lane executed the post-bust join race live.

FIX ROUNDS RE-REVIEWED FRESH (the unreviewed-fix rule), and it earned its
keep: a fresh security lane over the FIRST fix round executed a DEFEAT of
the new join guard (a second same-account bust after the joiner arrives
overwrites the single ledger slot and hides the bust from the joiner's
arrival-time comparison; the pre-bust row was accepted, probe-confirmed).
The SECOND fix (7b6e0badb0) widens the join guard to the install veto's
own condition: ANY bust at or after flight start makes every joiner
refetch, so the ledger-overwrite class dies structurally; the recorded
once-per-flight stale answer now covers the flight CREATOR only (a
deliberate tightening of that acceptance, safe direction). It also
deepens the install freeze one level (the freezeShared precedent, with
the frozen-Date setTime limit recorded), pins the freeze (it was
unpinned), records the freshly-owned-row contract on the readers
interface, and makes the floor/anchor comments state their enforced
bounds honestly. The same lane confirmed everything else held: joiner
fan-out collapse, bustAll coverage, no livelock (async, structurally
terminating), the prune gate correctness-neutral, the 80s floor
load-bearing (it forced a poisoning repro at 70s), no new bearer
exposure, and every new pin decisive on revert.

THE QA-CHECKLIST ROUND (dispatched LAST; the first agent died silently
after its one nudge, its respawn delivered in full): verdict READY, 0
blocking, 2 should-fix + 4 nits + one adversarial catch, ALL applied
(3e77e6f44e): the joiner-termination invariant PINNED (N vetoed joiners
collapse onto ONE fresh flight; the mutant that disables the flight
cleanup dies fatally red in the spin the pin documents), a join-veto
refetch counter on stats/readout/gauge (bust-storm refetches separable
from misses), the redundant test-only size accessors folded into the
stats fields, the unclassifiable message naming its interpolated arm, the
header stating the join re-check beside the install veto, the readout
comment and the pg helper named honestly. Its VERIFY items: the prune
bench figures stand as session-measured claims (the mechanism is what is
pinned; the bench script was a scratchpad throwaway), the pg suite and
the gate both re-ran at the final tip. It also flagged the TTL
fetch-start anchor's brownout regime (a probe slower than the 5s TTL
installs already-expired, so cross-time reuse stops during a brownout
while single-flight still collapses concurrent readers) as a real regime
change: recorded in-code and HERE for the maintainer, not treated as a
new ruling.

FINDINGS: 34 total this round (21 from the main audit + four lanes, 6
from the fresh fix-round review, 7 from the qa-checklist round); 25
APPLIED across four commits, 9 judged-declined with reasons (below).
The applied set:
1. SECURITY (the round's one real race): a reader arriving AFTER an
   account-keyed bust could join the PRE-bust token flight and be answered
   with the pre-revocation row (the bust cannot cancel a flight the index
   has never seen; the implement round's veto closed only the INSTALL
   half). Fixed with a content-keyed JOIN GUARD: a joiner whose arrival
   strictly postdates the account's bust refetches at flight settle; the
   pre-bust joiners keep the recorded once-per-flight acceptance; same-ms
   ties count as pre-bust on the join side while the install veto keeps
   its fail-closed tie. Pinned + mutation-proven (qa_join_veto_strip).
2. AVAILABILITY: the veto ledger's over-cap prune walked the whole map
   TWICE per bust while wedged inside the floor window; the quota
   listener's reconnect resync busts every live account, a measured ~73ms
   synchronous event-loop stall at the 5,000-account realm cap (both
   lanes measured it independently). Fixed with an amortization gate (a
   failed pass records the earliest instant anything can cross the floor;
   busts before that skip the walk): re-measured 0.8ms / ONE pass at the
   same fan-out. Pinned (prune-pass counter) + mutation-proven.
3. Discovery-scan evasions (the QA's own probes): schema-qualified table
   names and lowercase SQL keywords evaded every regex. Fixed: all four
   table regexes gained the qualifier arm and the i flag (verified
   zero new matches across server/, so the 20-site reconciliation is
   unchanged), plus an outright ban on interpolated TABLE names and an
   unclassifiable-arm red for interpolated fragments inside guard-table
   statements, all pinned by synthetic-source self-probes so the widened
   classifier cannot regress silently.
4. TTL anchored at fetch START (was install time: the documented 5s
   cross-process ceiling was silently 5s + fetch RTT). Pinned + proven.
5. Veto floor margin: MIN_AGE 70s (exactly the derived deadline sum) to
   80s (+10s event-loop headroom); the relation pin now requires >= sum
   + 5s so the margin cannot regress to zero.
6. Observability: the account-index size and bust-ledger size (both
   soft-bounded BY DESIGN) joined the stats payload, the stuck readout
   (via the existing authGuard field), and the prometheus gauge as
   arm=index / arm=recent_busts series; installed rows are now frozen
   shallow (decoration-poisoning defense); the module header's
   flights-bound and idle-high-water prose was made honest.
7. Pin-quality set (coverage lane): the veto fence-release direction
   pinned (a permanent-veto mutant survived the whole shipped suite: the
   exact silent perf cliff); the retention pass pinned independently of
   the floor pass; the decorative young-entry assert made exact (toBe(2)
   plus a live-veto proof); the refusal matrix over the cached bundle
   grew its suspended/deactivated/unknown-bearer rows; the pg revocation
   writers got per-dimension violating fixtures (cross-account survivors
   for revokeTokensExcept and the password-reset consume, the full-scope
   survivor and refused-full-delete for revokeReadToken, the same-prefix
   stranger survivor for revokeCompanionToken, this last mutation-proven
   in the pg lane); the gauge test matches exact sample lines on both
   arms; the core suite pins per-branch mute/policy carry-through and the
   undefined-policy half; the direct read path gained mute/strikes/policy
   and lapsed-suspension parity rows (the spec's parity-matrix gap); the
   moderation-arm lost-bust cancel and bustAll counter accumulation are
   exercised.

JUDGED-DECLINED this round (binding; do NOT re-raise):
- A backward wall-clock step between flight start and bust admits a
  pre-bust row past the veto (security I2): consistent with the server's
  clock usage everywhere; a monotonic-clock retrofit is not this cache's
  call. Recorded.
- The residue sweep's threshold-crossing walk lands inside one request
  (~5.9ms at the 40k crossing, hot-path 3): amortized O(1), two orders
  rarer than the prune it mirrors, now observable via the index series;
  22's pre-enable audit re-judges with gauge data.
- The per-account index has no local bound (hot-path 4): same
  authenticated mint lever as the recorded companion-token thrash bound;
  a local cap must also bust entries to stay sound, too subtle for a QA
  fix round; FOLDED into the recorded 22 mint-cap deferral (owner:
  22 pre-enable audit).
- The hot_reads source pins ride that file's own line-first stripper
  rather than the shared helper (coverage nit): pre-existing file-local
  lexer, safe polarity (stripping only strengthens the positive pins);
  swapping it mid-QA risks the file's many existing pins. Recorded as a
  cleanup candidate, owner maintainer.
- The runtime-without-authGuardDb fallback arm (REAL_GUARD_DB) is
  unpinned at the unit level (coverage nit): it is the pre-rider default
  every deployment exercises at boot-before-wiring, identical to the old
  behavior; a unit exercise needs a live pool for no new information.
- The busts stat counting read-time expiry drops alongside writer busts:
  documented at the drop site instead of split (the series means
  "entries invalidated"); a separate counter is not worth the shape
  change against the sibling caches.
- The flights map stays uncapped (hot-path 6, reported for coverage):
  one small entry per concurrent in-flight probe, proportional overhead
  on the pool's own pending queue; header prose corrected rather than a
  cap added.
- A vetoed joiner's re-read double-counts in the reads stat (fix-round
  review): the re-read IS a real read; the inflation only appears during
  a bust storm and refreshes stays exact; noted in the code.
- The gauge's arm label now carries index/recent_busts beside the two
  real arms, so a sum-by-kind recording rule would mix them (fix-round
  review): help text warns, no in-repo rule aggregates it; a separate
  metric name is recorded as a 22 cleanup candidate.

MUTATION RECORD (the rider QA section in phase-20-mutation-log.md): 23
distinct new live mutants (7 independent spot-checks incl. one pg, 16
fix-round pins incl. one pg, the ledger-overwrite reintroduction, and
the flight-cleanup spin), ALL BIT (one by fatal red), 0 survivors; 93
stale-verdict re-run events across three blocks (every mutant whose
pinning suite or source region moved, re-run at the tip that moved it),
all re-BIT, pg rows alone in their lane, every revert byte-identical.
Rider cumulative 50 distinct live, 49 BIT, 1 green control; whole log
391.

SUITE GROWTH this round: woc_auth_guard_cache 20 to 29;
auth_guard_bust_coverage 4 to 6 (interpolation ban + synthetic
self-probes); woc_market_auth_guard_wiring 7 to 10; auth_guard_core 21 to
24; game_metrics gauge test extended (exact-line, both arms, three
soft-bound series); account_server 41 to 43 (direct-path parity); the
authguard pg suite 13 tests (fixtures strengthened in place). The pg
battery stays EIGHT suites, 254 tests, zero skips.

VALIDATION at the tip (all fresh this session): npx tsc --noEmit clean
after every fix commit; the EIGHT-suite pg battery 254 tests zero skips
one lane at a time (61+66+40+34+10+11+19+13), clear field,
TEST_DATABASE_URL on the command line only; the DB-free marketplace +
auth + guard-adjacent battery 22 files 1267 tests; claudium canary +
moderation/chat/quota set + S3 + monolith + architecture + suite-duration
green (re-run after the fix rounds); npm run ci:changed exit 0 (warnings
only); an intermediate full gate at 7b6e0badb0 PASSED ALL 12 STEPS
(full-suite fallback, 42,998 tests + browser 131, TEST_DATABASE_URL on
the command line only, no tail pipe);
node scripts/gate_select.mjs on the committed tree at the FINAL code tip
3e77e6f44e: PASS, ALL 12 STEPS green, full-suite fallback (the
conservative fail-safe on this branch), 42,999 tests passed with the 2
expected fails and 26 known skips across 3,014 files plus the env-gated
perf-budget skip, browser regressions 131, typecheck and all builds
green, malware scan PASS; TEST_DATABASE_URL on the command line only, no
tail pipe, detached run with the exit code captured to a file (the
full-suite fallback outlives the harness's 10-minute background cap).
The docs commits on top of 3e77e6f44e are docs-only, the packet's
recorded wrap pattern.

MAINTAINER RULINGS RE-SURFACED (still open, not re-decided): the
woc_market.ts ceiling raise (+53 across the escrow rider's two raises,
net 4484 to 4036 DOWN); the woc_market_db.ts no-ratchet-row question
(largest marketplace file at 4783); the escrow gate hold-ceiling SIZING
(300s buys exactly one queued heavy save). None touched by this round.

PUSHED per R4 after PASS: origin feature/woc-marketplace (code + packet
docs); the throwaway worktree wocc-marketplace-authmut deleted after the
campaign closed. NEXT =
docs/woc-marketplace-hardening/phase-21-devnet-dry-run.md.

## 21 devnet dry run, session 1 (2026-08-20, SERVICE + GAME repos, BLOCKED ON FUNDING)

Two-repo session per the phase spec; service primary. SESSION START: both
worktrees verified (pwd + branch), both CLEAN; service fetch found
origin/master already contained (no merge); game fetch found
feature/woc-marketplace 0 behind origin/release/v0.40.0 (tip 65b91fa190
already an ancestor; no merge, no audit owed). Memory scan done
(reusable-gotchas Solana/RPC + exactly-once clusters,
open-source-repo-sensitive-material, install-dependencies-when-needed).

RULING GATE FIRST, as the spec demands: the R5 open half (devnet mint)
was presented with options and a recommendation and RULED by Fernando
in-session: a FRESH throwaway devnet mint, decimals 6, all keypairs in
gitignored local files. A companion gap surfaced during the recon carried
its own ask: the Birdeye venue and the chain arm shared the one WOC_MINT
knob and the fixed dev price was gated behind the FAKE chain, so a
real-chain devnet run had no env-configurable price. RULED:
WOC_MARKET_PRICE_MINT (venue override, default WOC_MINT). Later, when no
Birdeye key proved available on the machine, a THIRD ask amended the
plan: the fixed dev price DECOUPLED from the fake-chain gate (NODE_ENV
allowlist alone), with the spot figure operator-supplied at 0.0001476
USD per WOC. All three rulings recorded in state.md Rulings (R5 now
CLOSED IN FULL) before the matching code.

SERVICE COMMITS (LOCAL per R4, nothing pushed): 7284fbe the venue mint
split (marketPriceMint precedence, wallet-grade validAddress refusal on
a set-but-invalid override, compose pass-through kept blank, env docs +
MARKET_SETTLEMENT env-table row + CLAUDE.md line); 2eedcfb the dev price
over the real chain arm (devPriceSource rides explicitlyDevOrTest alone;
gate pins rewritten, the dev-NODE_ENV-alone arm and a bootstrap-level
real-chain fixed-price pin added). Validation: npm run build clean, npm
test 599 tests / 592 pass / 0 fail / 7 default-tier pg skips, twice.
Four new pins mutation-proven at the 20 protocol in a throwaway service
worktree at 2eedcfb (occurrence-asserted, run-proven 55 tests per run,
reverted byte-identical, worktree deleted): m21_pricemint_refusal_strip,
m21_pricemint_override_ignored, m21_devprice_gate_always_on (failing
test name captured in a dedicated re-run), m21_devprice_recoupled; all
BIT; logged in phase-20-mutation-log.md (21 section; whole log 395 at
that point, 401 after the review rounds recorded below).

ENVIRONMENT STAGED: five fresh keypairs (authority/fee payer, escrow,
treasury, buyer, seller) written ONLY after git check-ignore verified
every filename; .env.devnet (gitignored) with local random secrets and
the escrow key injected file-to-file, never through a terminal;
dedicated woc_devnet_service database created on the dev Postgres; the
idempotent setup script added to the packet dir (devnet_setup.mjs; it
rides this session's closing packet-docs commit);
devnet RPC health-probed OK; the Ankr fallback needs its own key so the
run is single-RPC (recorded: probe-not-resend works single-RPC, only
crash-replace needs two, out of scope).

BLOCKED: the public devnet faucet answered 429 at every request size all
session, and Fernando answered CANNOT FUND TODAY; no Birdeye key exists
locally either (answered NO KEY AVAILABLE). So the mint is not created
and every on-chain leg is parked: bond cycle (with the double-release
balance asserts and probe-not-resend observation), settlement e2e,
hostile burn-redirect, and the carried contention observations (escrow
gate, auth-guard cache, 16 lost-lock anti-phase). The 11 venue-cadence
observation is recorded NOT OBSERVABLE keyless (R5 amendment). Per-leg
status lives in state.md "21 devnet dry-run evidence"; devnet.md carries
the recipe and the exact resume runbook. The phase stays OPEN; NOTHING
pushed anywhere (R4: the 21 QA pushes on PASS after the legs run).

REVIEW ROUND (all three lenses fresh, prompted for coverage; every
finding applied or judged with the file open): the security lens over
270e337..2eedcfb returned 12 findings, 0 blocking; the correctness lens
over the evidence trail returned 12 findings, 0 blocking, with a
verified-clean list reproducing every checkable number (test counts,
mutant arithmetic, hashes, pubkeys, DB, the 0-SOL on-chain balance
corroborating the blocker record). Fix round 6c1b01f applied the
security cluster: the CONFINEMENT (fixed price + live arm + live default
mint refuses to construct), the venue override honored only under the
dev/test allowlist, decode screens on BOTH configured mints (typo = the
designed 503, not a boot crash; also closes the correctness lens's
placeholder-boot footgun), boot warns for both splits, compose pinning
the two dev knobs empty, plus the doc truth-ups (dev_chain header,
trust-the-env breaker note, compose comments). Correctness fixes: the
premature "committed" wording trued, the R5 record trued to five
keypairs and the one upfront 1,000,000 WOC mint, ensureSol re-reads and
judges the balance, the manual-funding floor raised to 0.7 SOL with the
spend rationale, mint-record crash-ordering breadcrumb, runbook literals
(port 8798, x-woc-economy-secret, the shared WOC_ECONOMY_INTERNAL_SECRET
name both sides, blank-Birdeye inventory row, fill-WOC_MINT-before-boot,
re-copy-after-reinstall). The fix round was RE-REVIEWED FRESH (10
findings, 0 blocking): applied as 8db7734 (the MIRROR confinement, a
venue override with the chain on the live default now refuses too;
warns moved below the last construction refusal so they describe only a
running market; warn-capture and compose active-line pins; float
threshold Math.round; compose PRICE_MINT comment; .env.example
every-arm decode note; the mutation-log prose corrections). JUDGED, no
change, with reasons: the shared validAddress stays shape-only for the
WALLET screens (the mint values got the decode check; a live-arm escrow
wallet must equal the signer pubkey so the wallet class is covered
structurally); the devnet RPC load-balancer re-read race is accepted
(idempotent rerun recovers, comment records it); the confinement staying
keyed on the DEFAULT_WOC_MINT constant is accepted and recorded in its
comment. RECORDED FOR THE MAINTAINER, pre-existing and outside this
diff (security lens): the Python payout service's
DAILY_REWARD_WOC_USD_PRICE fixed-price knob has NO environment gate at
all and compose forwards it raw, so a production .env value silently
fixes that service's WOC price; owner: the 22 acceptance-bar audit
(deferral, not fixed here: it is the live daily-reward rail, out of
packet scope). Final round-3 self-review with files open (the round-3
diff is tests, docs, and the two moved/widened blocks, re-proven by the
mutant batch). Validation at the final tip 8db7734: build clean, suite
603/596/0/7 skips; mutation record for the session: 10 distinct mutants
ALL BIT (log sections; whole log 401), 10 stale-verdict re-run events
all re-BIT.

RIDER MINTED same session, post-close (Fernando: devnet SOL arrives only
near the end, asked for a file runnable now): rider-close-out-prep.md +
rider-close-out-prep-qa.md pull the 21-independent half of 22 forward
(ruling gate over the five parked questions: Not-now lock release,
outage forfeit, terms re-consent, fail-then-pay-again contract,
pg-suites-in-CI; the ops runbook absorbing every scattered 22-runbook
obligation; the 19/22 wocDecimals + settled-total cross-repo ask; the
acceptance-audit prep with devnet rows OPEN; the follow-ups draft).
phase-22-close-out.md carries the matching shrink note. Session order is
now: the rider pair FIRST (runnable immediately), the 21 resume when SOL
exists, then 21 QA, then the shrunken 22.

## Close-out prep rider implement round (2026-08-20, THREE repos, LOCAL per R4)

Session start: game 5f86e975af on feature/woc-marketplace (0 behind
origin/release/v0.40.0, sync a NO-OP), service 8db7734 on
integration/woc-market-settlement (0 behind origin/master), dashboard
145d120 on integration/woc-market-trading (0 behind origin/master); all
three trees clean; no release-merge-audit owed. Baselines re-proven before
any change: service 604 tests at tip after the round (from 603), dashboard
276, both green.

RULING GATE: the five parked questions were presented with
recommendations; Fernando delegated in-session ("do whatever is absolutely
best for the feature and project") and the recommendations were adopted as
rulings R12 to R16 (records in state.md Rulings; commit b06708443b landed
BEFORE any implementation). R12 Not-now document-only (release route =
product debt), R13 outage forfeit document-only plus a named follow-up
(AMENDED same session, see below), R14 terms re-consent re-parked to R6's
enable-time checklist, R15 fail-then-pay-again settled on paper, R16
pg-suites-in-CI = CHANGE CODE. The five re-surface items were re-surfaced
verbatim, not re-decided (woc_market.ts ceiling, woc_market_db.ts
no-ratchet-row, escrow hold-ceiling sizing, auth-rider TTL brownout, R11).

DELIVERABLES, all four landed:
1. Ops runbook docs/woc-market-runbook.md (game bd14b215ad, corrected
   b23d0b2f6d): sixteen sections absorbing every swept obligation (the
   sweep lane walked state.md and progress.md end to end; seed list of
   fourteen all found plus eleven unlisted obligations). VERIFIED CLAIM BY
   CLAIM by a dedicated correctness lane against both repos: 2 HIGH (the
   outage remedy cited a dashboard refund flow that cannot refund a
   terminal forfeit and an outage-locked readout that does not exist;
   procedure rewritten to manual evidence gathering plus a treasury-side
   restitution transfer, R13 record amended), 7 MEDIUM and ~10 LOW claims
   corrected (720h review clamp, live _open2 index plus the review state
   in the detection query, admin-secret 503 posture, DEPLOY.md citation
   truth, stuck-bond age knob, ledger-consulting terminal entries, RPC
   defect classes, 50k-per-table sweep bound, six rate buckets, halt-line
   count, forfeit-only typed confirmation). The verification also
   surfaced a NEW PRE-ENABLE GAP: no sanctioned surface drives
   transitionSettlement for review resolution (hand SQL forbidden by
   design); recorded in the runbook, the audit, and follow-ups section 4.
2. The 19/22 cross-repo ask, CODE COMPLETE both repos. SERVICE (2c4a261 +
   06f6725 + 52fa0c2): MarketAdminOverview.wocDecimals from the WIRED
   settlement config via MarketSettlementService.configuredWocDecimals
   (never env; the http rig wires 9 against an empty env as the decisive
   pin), MarketVolumeTotals.settledBase = SUM(amount_base) both stores; a
   settled bond sits in-window in BOTH the http and pg rigs so a kind
   drift inflates the pins (found unpinned by the reviews, closed, strip
   proven at both stores); heldUsdCents pinned; docs updated with the
   one-scalar caveat. DASHBOARD (53913d7 + e37cd02 + 43457cb + dfd0f4d):
   effectiveWocDecimals prefers the reported figure with the constant
   fallback (older service byte-identical), the wocDecimalsMismatch
   banner renders on the Trading tab (string reworded: names the
   constant-fallback surfaces, verify-on-chain instruction, two-sided
   disagreement wording), legsReconcile upgrades to the real sum
   reconciliation on settledBase with the visible windowReconcileNote
   downgrade line when absent, the loader screens a garbled wocDecimals
   or settledBase into the overview error (no payload value can reach
   10n ** BigInt), and every BigInt money parse is capped at the
   NUMERIC(40,0) width with DECISIVE over-length arms (exact-sum 41-digit
   fixtures after the first arm proved vacuous).
3. Acceptance audit prep docs/woc-marketplace-hardening/acceptance-audit.md:
   every non-devnet row evidenced (the R9 grep ran this session: both
   acceptTerms send sites carry the player's real choice, PASS); devnet
   rows OPEN with the pointer; the enable-time rows named OPEN-ENABLE.
4. Follow-ups draft docs/woc-marketplace-hardening/follow-ups.md, grouped
   by owner from the full deferral sweep (closures cross-checked), plus
   the rider's own additions (weight re-harvest at first CI run,
   WOCC_PG_DIFFERENTIAL alignment, CIC flake watch, the review-resolution
   operator route as a PRE-ENABLE requirement, the dashboard release-form
   overview-gate question).

R16 IMPLEMENTATION (game 462c234031, hardened 0343ed9271 + 1fd4692460):
pr-gate, release-gate, and nightly's tests job each carry a per-job
postgres:16-alpine service (health gate in options, no step added, port
5432 so the 5433 dead letter stays dead) and a job-level
TEST_DATABASE_URL; the gate-integrity review PROVED the client_perf pg
suite red on every fresh database (CREATE INDEX CONCURRENTLY never built
by ensureSchema; fixed test-first against a virgin database) and EXECUTED
two pin defeats (file-wide counts survive relocation; a hand-listed job
set survives a matrix split), both closed: the pin now derives the
vitest-running job set from the run lines with guard-coupled lane/i18n
exemptions, and tests/ci_pg_presence.test.ts (a CI_GUARD_SUITES member,
honest local skip) reds inside GitHub Actions whenever the variable is
missing. Accepted container-boot cost recorded at the service block;
qa-gate.md and tests/CLAUDE.md carry the real-SQL arm, the four
graph-classified suites, the stale-weight caveat, and the local asymmetry.

REVIEW ROUNDS: five recon lanes, then gate-integrity + security +
correctness + runbook-verification lanes, then a FRESH review of every
fix round (three rounds deep on the gate side; the final hardening round
was specified by the fresh gate reviewer and self-reviewed with files
open plus five adversarial mutants in lieu of a fourth spawn). Every
finding applied or judged. JUDGED-DECLINED (do not re-raise): the
older-service downgrade note rendering on healthy zero-sale windows
(visible-downgrade by design, calm copy); settledBase null landing on
the caution line (out of contract; the economy proxy relays bodies
verbatim); the shared tests/helpers pg-gate refactor across all 20
suites (the derived-set pin plus the guard suite covers the class; kept
as a follow-ups option); parameterizing the existing jobSource helper
instead of the aligned-boundary sibling (recorded chore); the
gate-review's PG17-local-vs-PG16-CI caveat (CI pins 16; the plan-shape
suites run there). Reviewer reality: all lanes delivered after one nudge
each (the idle-nudge gotcha); the service dist/ stale-mutant artifact the
fix-round reviewer caught was erased by the next tsc run and the
commit-before-mutating rule is re-learned (two uncommitted comment edits
were eaten by mutant reverts and re-applied).

MUTATION RECORD (the rider section of phase-20-mutation-log.md): 18
distinct mutants, all BIT, 0 survivors, 3 stale-verdict re-run events all
re-BIT; whole log 419.

VALIDATION at the tips: service npm run build clean, 604/597/0 default,
604/604 zero skips with CLAUDIUM_TEST_DATABASE_URL on the command line;
dashboard 281/281, check 0 errors, build complete, test:security 66/66;
game npx tsc --noEmit clean, ci:changed exit 0 (warnings only), the
workflow pin battery 330 green across eight suites, gate_select PASS all
12 steps at 0343ed9271 mid-round (full fallback; TEST_DATABASE_URL on the
command line only), and the FINAL gate run at the registry tip recorded in
state.md (the closing note is authoritative). NOTHING PUSHED anywhere
(R4); the paired QA session pushes on PASS.

NEXT: docs/woc-marketplace-hardening/rider-close-out-prep-qa.md, FRESH
session, three repos, diffs: game 5f86e975af..the registry tip, service
8db7734..52fa0c2, dashboard 145d120..dfd0f4d; pushes on PASS per R4.

## Close-out prep rider QA round (2026-08-20, THREE repos, verdict PASS-WITH-FOLLOWUPS, every finding applied or judged)

Session start: game e6ea9968f6 on feature/woc-marketplace (0 behind
origin/release/v0.40.0, sync a NO-OP; no release-merge-audit owed),
service 52fa0c2 (0 behind origin/master), dashboard dfd0f4d (0 behind
origin/master); all trees clean.

AUDIT: eleven read-only lanes (gate-integrity-reviewer and
test-coverage-auditor as repo reviewers, nine workflow lanes:
runbook-vs-game with 40+ claims verified, obligation sweep, audit-table
honesty with ten rows re-derived, service security + correctness,
dashboard security + correctness, cleanup/constraints, ruling ledger),
plus the QA's own hands: five runbook spot-checks, the R9 grep
reproduced independently (four send sites, two surfaces, no literal),
follow-ups line refs spot-checked, the closing commit verified
docs-only, the rider mutation-log arithmetic re-derived (18 distinct +
3 re-runs confirmed).

THE HEADLINE: the gate review DEFEATED the third pin shape with a
measured exploit (a run-line recognizer misses a shard clone whose
command is a `run: |` block scalar; half the matrix loses its database
with every pin green; the same recognizer already missed the two live
browser jobs). Rebuilt as SHAPE FOUR (game 2b9f583b2f): complete
job-key classification (every key pg-wired, guarded DB-less, or
test-free; set-equality completeness), token-scan cross-checks over
comment-stripped span content, expression-run refusal, the browser
coupled guard (script-to-config-to-include-to-scan chain through the
shared walker), widened quoted/host-bound 5433 matchers with positive
controls, and the WOCC_EXPECT_PG sentinel pinned beside the URL so
tests/ci_pg_presence.test.ts arms on ANY runner brand. The FRESH
re-review of that fix round found three residual doors (an unguarded
dbless classification; a step-level env override blanking legs under a
satisfied job-level pin; an unclassifiable job-level uses) plus
spelling gaps, ALL closed in 1e932c5b61: the dbless forcing function
(every member names its coupled guard, label set pinned),
exactly-one-occurrence pins on both variables per wired job, job-level
uses and expression-initial lines refused as novelty, the token
alternation widened, unrecognized two-space jobs-body lines refused
instead of swallowed, and the four other workflow files enumerated from
the git index and pinned test-free.

MUTATION SPOT-CHECKS (the QA's own strips; the full record is the
rider QA section of phase-20-mutation-log.md): FOUR SURVIVORS proven by
execution and closed with new pins: the memory volumeTotals WINDOW
BOUND was entirely unpinned (all three overview windows silently agree
with it stripped; service d9a4f9b adds the two-day-old settlement
fixture in BOTH stores, the empty-window zero-string shape, and the pg
heldUsdCents pin); the decimals-0 edge unpinned on BOTH repos (a falsy
coercion or a positive-only clamp re-scales a valid 0-decimal mint
silently; service decimalsAt('0'), dashboard clamp/loader/banner-zero
pins in c0e99d2); the banner's below-constant direction unpinned
(every fixture sat above the constant). 17 new distinct mutants all
BIT, 24 stale-verdict re-runs all re-BIT, 1 compile-refused strip;
whole log 436. CONCURRENCY PROBE (the gate review's minimum ask): the
full pg battery (17 suites, 333 tests) three times as one parallel
vitest invocation against a virgin database, all green; the
TRUNCATE-vs-INSERT class stays the widened watch item in follow-ups
5.3, failure direction RED.

OTHER FINDINGS APPLIED: client_perf's migration beforeAll gains the
120s budget its siblings use (the default 10s hookTimeout was a
merge-bar flake on the shared CI database, and a timed-out hook
abandons the advisory-lock client); the two 5432 dead-letter fallbacks
moved to 5433 (5432 is live inside CI legs now; both suites verified
never-connecting); the "rides every selective shard" comments
corrected (one leg executes the sentinel; the env is job-level so one
suffices); WOCC_EXPECT_PG declared in turbo.json; runbook corrections
(the refresh-recovery levers narrowed to the two that work, verified
against the dashboard code; the R12 Not-now behavior documented with
WOC_MARKET_BUY_NOW_LOCK_SECONDS; capacity literals anchored to
DB_POOL_MAX_CLIENTS, WOC_MARKET_ME_READOUT_DEADLINE_MS,
RETENTION_SWEEP_UTC_HOUR, WOC_MARKET_LISTINGS_RETENTION_DAYS;
stuck-age's COALESCE fallback stated; the suspension correlation via
the stuckBonds raw account id absorbed; the missing
connectionTimeoutMillis surfaced as an operator note); audit-table
repairs (the dev-database classes re-cited to their real 06 ledger
record with the verdict token fixed; the all-or-nothing boot pins
re-attributed to market_bootstrap.test.ts; R14's re-park destination
ACTUALLY given its checklist item in the counsel memo plus the
RECORDED-vs-SHOWN sentence; the four consent send sites named; OPEN-21
residuals cross-referenced inline on three rows; validation rows moved
to the QA tips); follow-ups additions (classifier asymmetry + the
vite-exclude re-skip class, the shared-helper guard-move dependency,
the TRUNCATE-vs-INSERT watch widening, the abandons-FK closure of
record, the read-bucket 429 re-judgment, SEC-9 and
manipulation-economics marked as needing Fernando's judgment, the
wallets-arm exponent screening + treasury parse cap, WOC_DECIMALS
parser unification); dashboard CLAUDE.md's token bullet names both
payload-holding panels; the brittle no-banner negative anchored to the
banner sentence (fede8de); qa-gate.md and tests/CLAUDE.md updated to
the shape-four and sentinel reality.

JUDGED-DECLINED this round (do not re-raise): the R13 record's
un-struck original remedy sentence (historical ruling record; the
amendment in the same bullet and runbook section 12 carry the corrected
procedure); null wocDecimals landing as the overview error (out of
contract, fail-honest, the settledBase-null principle); the 0..18 range
open-coded in loader and clamp (rule of three; both sides pinned at
19); the overview-outage banner-strip residual (documented section
independence; the release-form gate question is follow-ups 7.1b); a
schema CHECK tying settlement kind to non-null legs (the reconciliation
exists to catch exactly that class at render); mutation-log rows naming
files only in section prose (format consistency); the whole-log census
divergence (predates the rider; reconciliation deferred to 22 with the
caveat recorded in the log).

FIX-ROUND RE-REVIEWS: the gate side re-reviewed FRESH (no criticals, no
vacuous assertions; its three warnings closed in 1e932c5b61, which was
itself validated reviewer-prescription-plus-mutants: 4 new mutants and
all 13 prior CI verdicts re-run, all BIT). The docs side: the spawned
fresh reviewer stalled through two nudges, so the re-review completed
as the sanctioned careful self-review with files open (every claim in
0bba4ea5d5 verified against code, including the refresh-recovery
mechanics re-derived from periodic_refresh.ts and MarketTradingPanel).

VALIDATION at the tips: service npm run build clean + 605/598/0
default + 605/605 pg zero skips (CLAUDIUM_TEST_DATABASE_URL on the
command line); dashboard 282/282 + check 0 errors + build complete +
test:security 66/66; game npx tsc --noEmit clean, the workflow pin
battery green, the sentinel proven red-without-URL and green-with-URL,
and gate_select PASS ALL 12 STEPS TWICE (040a1ca7a1 mid-round and
87bc9df8be at the registry-adjacent tip, both full-suite fallback,
43,000 tests + browser 131, TEST_DATABASE_URL on the command line
only; the first run failed at changed-files biome on a format diff in
the new pin, fixed in 040a1ca7a1). This wrap-up commit is the only one
past the gated tip, docs-only per the closing-note convention.

PUSHED per R4: game feature/woc-marketplace, service
integration/woc-market-settlement:feature/woc-market-settlement (PR
#31), dashboard
integration/woc-market-trading:feature/woc-market-trading-controls (PR
#13); secret sweep of every outgoing diff clean (fixture values only).
PR CI AFTER THE PUSH, all green: dashboard PR #13 gate checks 2/2 pass
(about 1m each); service PR #31 test checks 4/4 pass. The game branch
has no PR, so its first CI run (and the shard-weight re-harvest,
follow-ups 5.1) waits for the eventual 22 PR.

DEFERRED (owners recorded): the CI shard-weight re-harvest fires at the
FIRST real CI run of the R16 wiring (no PR exists on the game branch,
so that is the eventual 22 PR; follow-ups 5.1); the whole-log census
reconciliation (22); the TRUNCATE-vs-INSERT and CIC flake watches
(first CI runs); everything in follow-ups.md by section.

LATE REVIEWER ADDENDUM (same session, after the push): the stalled docs
fix-round reviewer delivered its report after the verdict; per the
14-QA late-lane precedent its findings were applied and re-pushed. Two
should-fix runbook corrections (the refresh-recovery levers gained the
real third one, leaving the Trading TAB and returning remounts the
panel; the connectionTimeoutMillis note re-scoped to the REWARD
SERVICE's pools, since the game pools carry
DB_POOL_CONNECT_TIMEOUT_MS 5s) plus the stuckBonds gate citation
(internal.ts, not the monitor) and the loader-persists wording; its
coverage nit predicted the upper-window-bound survivor, confirmed by
execution and closed with future-settled fixtures in BOTH stores
(service 70b71b6; both upper-bound strip mutants BIT, whole log 438);
the dashboard no-banner negative gained the unreadable-arm sentence
(cff8102). Everything else in its report verified the fix round
accurate; the C.4 memo claim is unverifiable from the public repos by
design (the memo is private) and stands as written.

NEXT: docs/woc-marketplace-hardening/phase-21-devnet-dry-run.md resumes
once devnet SOL exists (devnet.md bottom section is the runbook), then
phase-21-qa.md, then the shrunken phase-22-close-out.md.
