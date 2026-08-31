# State: cross-session cheat sheet

Updated by every session. Keep this file SHORT and current; it is what the next session
actually reads.

## Where we are

- CLOSE-OUT PREP RIDER QA DONE (2026-08-20, THREE repos, verdict
  PASS-WITH-FOLLOWUPS, every finding applied or judged, PUSHED per R4:
  game e6ea9968f6..the wrap tip to origin/feature/woc-marketplace;
  service 52fa0c2..d9a4f9b to feature/woc-market-settlement (PR #31);
  dashboard dfd0f4d..fede8de to feature/woc-market-trading-controls (PR
  #13)). All three syncs NO-OPS. Eleven audit lanes + the QA's own
  hands. THE HEADLINE: the gate review defeated the THIRD pin shape (a
  block-scalar shard clone invisible to the run-line recognizer), so the
  R16 pin is now SHAPE FOUR (2b9f583b2f hardened 1e932c5b61): complete
  job-key classification (wired / guarded-dbless with a forcing
  function / test-free), token cross-checks, novelty refusals
  (expression runs, job-level uses, unrecognized job spellings), the
  browser coupled guard, widened 5433 matchers with positive controls,
  exactly-one-occurrence env pins, the WOCC_EXPECT_PG sentinel arming
  the runtime twin on any runner, and the other four workflow files
  enumerated from the git index and pinned test-free. FOUR of the QA's
  own mutants SURVIVED the shipped pins and are closed with new tests:
  the volume WINDOW BOUND (both stores, service d9a4f9b), decimals-0
  (both repos), the banner's below-constant direction (dashboard
  c0e99d2). Mutation record this QA: 17 new distinct all BIT + 24
  stale re-runs all re-BIT (whole log 436); pg battery probed 3x
  parallel against a virgin database, green. Runbook corrected against
  code (refresh-recovery levers, R12 Not-now documented, anchors for
  every bare literal); audit citations repaired (boot pins to
  market_bootstrap, dev-database classes to the 06 ledger, R14's
  checklist item ACTUALLY added to the counsel memo); follow-ups gains
  the QA's items. Validation: service 605/605 pg zero skips + build;
  dashboard 282/282 + check + build + security 66/66; game tsc clean +
  gate_select PASS ALL 12 STEPS TWICE (040a1ca7a1 and 87bc9df8be, full
  fallback, 43,000 tests + browser 131, TEST_DATABASE_URL command line
  only). The QA round section in progress.md is the registry
  (JUDGED-DECLINED list binding). NEXT = RESUME
  phase-21-devnet-dry-run.md once devnet SOL exists (devnet.md bottom
  section is the runbook), then phase-21-qa.md, then the shrunken
  phase-22-close-out.md.
- CLOSE-OUT PREP RIDER IMPLEMENT DONE (2026-08-20, THREE repos, LOCAL per
  R4: nothing pushed; the paired QA pushes on PASS). All three syncs
  NO-OPS. RULING GATE: Fernando delegated in-session and the presented
  recommendations became R12 to R16 (records in Rulings; R13 AMENDED same
  session after the runbook verification proved its restitution mechanism
  nonexistent: manual treasury-side transfer, never the dashboard release
  flow). All four deliverables landed: the ops runbook
  (docs/woc-market-runbook.md, claim-by-claim verified, 2 HIGH + 7 MEDIUM
  corrections applied, and it surfaced a NEW PRE-ENABLE GAP: no sanctioned
  surface drives transitionSettlement review resolution); the 19/22
  cross-repo ask CODE COMPLETE (service reports wocDecimals from the wired
  config + per-window settledBase, tips 2c4a261..52fa0c2; dashboard
  prefers the reported exponent with the divergence banner, real sum
  reconciliation, screened leaves, capped money parses, tips
  53913d7..dfd0f4d); the acceptance audit prep (acceptance-audit.md, every
  non-devnet row evidenced, R9 grep PASS); the follow-ups draft
  (follow-ups.md). R16 implemented: per-job Postgres + TEST_DATABASE_URL
  in pr-gate/release-gate/nightly (game 462c234031 hardened through
  1fd4692460 after the gate-integrity review proved the client_perf suite
  red on fresh databases, test-first fixed, and executed two pin defeats,
  both closed with a derived job-set pin + the ci_pg_presence guard
  suite). Reviews: nine lanes total, every finding applied or judged;
  mutation record 18 distinct all BIT + 3 re-runs re-BIT (whole log 419).
  Validation: service 604/604 pg zero skips, dashboard 281/281 + check +
  build + security 66/66, game tsc clean + gate PASS all 12 steps at
  0343ed9271 mid-round and the FINAL gate at the registry tip. CLOSING
  GATE NOTE (authoritative): node scripts/gate_select.mjs PASS at
  3f571c38e6, all 12 steps green, full-suite fallback, 43,000 tests
  passed (2 expected fail, 27 skipped) + browser 131, malware scan 0
  high, TEST_DATABASE_URL on the command line only; this closing note is
  the only commit past the gated tip. The rider section in progress.md is the
  registry (JUDGED-DECLINED list binding). NEXT =
  docs/woc-marketplace-hardening/rider-close-out-prep-qa.md (FRESH
  session, three repos; diffs game 5f86e975af..tip, service
  8db7734..52fa0c2, dashboard 145d120..dfd0f4d; pushes on PASS), then
  RESUME phase-21-devnet-dry-run.md once devnet SOL exists, then
  phase-21-qa.md, then the shrunken phase-22-close-out.md.
- 21 DEVNET DRY RUN SESSION 1 (2026-08-20, SERVICE + GAME repos): R5
  CLOSED IN FULL by three in-session rulings (fresh throwaway devnet mint
  decimals 6; the WOC_MARKET_PRICE_MINT venue split; the same-day
  amendment decoupling the fixed dev price from the fake-chain gate after
  no Birdeye key proved available, spot 0.0001476 operator-supplied;
  records in Rulings). SERVICE commits LOCAL per R4: 7284fbe + 2eedcfb
  (the two ruled halves), then TWO review fix rounds 6c1b01f + 8db7734
  (confinement: NEITHER price split may ride the live default mint on the
  live chain arm; the override dev/test-gated; decode screens on both
  mints; boot warns below the last refusal; compose dev-knob walls, all
  pinned). Suite 603/596/0 at the tip; 10 distinct price-source mutants
  ALL BIT + 10 stale-verdict re-runs re-BIT (whole log 401). ENVIRONMENT
  STAGED: five keypairs + .env.devnet (gitignore verified BEFORE
  writing), woc_devnet_service DB, devnet_setup.mjs in the packet dir.
  ON-CHAIN LEGS BLOCKED: faucet 429 all session and Fernando answered
  cannot-fund-today, so the mint is uncreated and every leg is parked;
  per-leg status in "21 devnet dry-run evidence", resume runbook in
  devnet.md. Both syncs were no-ops. Review round: three fresh lenses
  (security, correctness, fix-round re-review), 34 findings total, 0
  blocking, every one applied or judged (registry: the 21 section in
  progress.md); flagged for the maintainer: the Python payout
  DAILY_REWARD_WOC_USD_PRICE knob has NO env gate (pre-existing, 22
  owns). THREE MAINTAINER RULINGS remain OPEN (re-surfaced, not
  re-decided): woc_market.ts ceiling +53 net 448 DOWN; woc_market_db.ts
  no-ratchet-row (4783); escrow gate hold-ceiling sizing; plus the
  auth-rider TTL brownout note (recorded, not ruled). NOTHING pushed
  anywhere (R4). NEXT, reordered 2026-08-20 at Fernando's request (devnet
  SOL arrives only near the end): RUN NOW =
  docs/woc-marketplace-hardening/rider-close-out-prep.md (FRESH session,
  three repos; the 21-independent half of 22: ruling gate over the five
  parked questions, the ops runbook, the 19/22 wocDecimals cross-repo ask,
  the acceptance-audit prep, the follow-ups draft), then its QA pair.
  WHEN SOL EXISTS = resume phase-21-devnet-dry-run.md (devnet.md bottom
  section is the exact runbook; the Birdeye key stays optional: the
  fixed-price path is ruled), then phase-21-qa.md, then the shrunken
  phase-22-close-out.md (devnet evidence rows, three gates, PR prep).
- AUTH-GUARD READ CACHE RIDER QA COMPLETE (2026-08-20, GAME repo, verdict
  PASS-WITH-FOLLOWUPS with every fix applied in-session, PUSHED per R4).
  Audited f844a72eaa..e26c3ed9ec; this session's v0.40.0 re-sync was EMPTY
  (tip 65b91fa190 still an ancestor). The audit gamed the discovery pin
  with eight planted writer shapes (six red correctly; schema-qualified
  and lowercase spellings EVADED and are now fixed + self-probed), attacked
  the install veto with four interleavings (all held), re-proved seven
  logged pins with independent strip designs, and reconciled every
  registry count (zero drift). 34 findings: 25 APPLIED (fix 27262d293d +
  test 7dd34268a8 + the re-reviewed second fix 7b6e0badb0, whose fresh
  security lane EXECUTED a defeat of the first join guard: a second
  same-account bust overwrote the single ledger slot and hid the bust
  from the joiner's arrival-time comparison; the guard now refetches
  joiners on ANY bust at-or-after flight start, and the once-per-flight
  stale answer covers the flight creator only; + the qa-checklist round
  3e77e6f44e: the joiner-termination pin, the join-veto refetch counter,
  accessor fold-in, honesty fixes), 9 judged-declined with
  reasons; headline fixes: the
  post-bust JOIN race (a reader arriving after an account-keyed bust could
  be answered from the pre-bust flight; closed with a content-keyed join
  guard, the join half of the implement round's install veto), the
  quadratic over-cap ledger prune (a measured ~73ms event-loop stall at
  the 5,000-account resync fan-out; amortized to one walk, re-measured
  0.8ms), TTL now anchored at fetch start, veto floor 80s (+10s headroom,
  margin relation-pinned), discovery scan hardened (qualifier + case +
  interpolation ban), soft-bounded internals (index, bust ledger) now on
  stats/stuck readout/prometheus, rows frozen shallow, refusal matrix and
  pg symmetric fixtures completed. Reviewer reality: 3 of 4 lanes
  delivered FULL reports (security + hot-path measured the same stall
  independently; the security lane executed the join race live); dbperf
  silent after one nudge, that dimension carries the main thread's pass.
  Mutation record: 23 new distinct mutants ALL BIT (one by fatal red) +
  93 stale-verdict re-run events all re-BIT (rider cumulative 50 live /
  49 BIT / 1 green control; whole log 391). Validation fresh: tsc clean, pg battery EIGHT
  suites 254 tests zero skips one lane at a time, DB-free battery 22
  files 1267 tests, claudium canary green, ci:changed exit 0, gate
  result recorded in the progress.md QA section. THREE MAINTAINER
  RULINGS remain OPEN (re-surfaced, not re-decided): the woc_market.ts
  ceiling raise (+53, net 448 DOWN), the woc_market_db.ts no-ratchet-row
  question (4783), and the escrow gate hold-ceiling sizing. The
  wocc-marketplace-authmut throwaway worktree is DELETED. NEXT =
  docs/woc-marketplace-hardening/phase-21-devnet-dry-run.md (GAME +
  service repos, FRESH session, newest origin/release/** sync first).
- AUTH-GUARD READ CACHE RIDER IMPLEMENT COMPLETE (2026-08-20, GAME repo,
  LOCAL per R4: nothing pushed; the rider QA session pushes on PASS).
  Session start f844a72eaa; the v0.40.0 sync was EMPTY (the release tip
  65b91fa190 was already an ancestor; no merge commit, no audit owed). Spec
  pair minted FIRST (rider-auth-guard-reads.md + its QA file, ab058a21f9,
  the cluster verbatim from the 16 QA deferral and the 17 SESSION START
  DECISION plus recon corrections: the guard runs BEFORE the read limiter;
  the admin gate already resolves through the separate adminDb() bundle;
  the hot offers GET rides the ACTIVE guard so the cache covers the whole
  bundle; the bust surface is 20 statements in 16 functions across 5 files;
  the quota consume classifies OUT by column; cached_read stale-serves and
  cannot carry an auth read). All seven deliverables landed: the pure core
  (auth_guard_core.ts, byte-exact verdicts computed from raw rows at read
  time; db.ts is fetch + compute and nets 44 lines DOWN to 4832), the cache
  (woc_auth_guard_cache.ts: TTL 5s, realm-sized LRU caps, no negative caching,
  no stale-serve, single-flight with the lost-bust cancel, read-time expiry,
  the account-to-tokens index for the prefix over-bust), busts at every
  discovered writer post-COMMIT, marketplace-only wiring (override > cache >
  direct; admin uncached by wiring AND by behavioral contrast), the
  discovery pin (column-precise, function-attributed, exact 20-site
  reconciliation, one reasoned DELETE exemption, the import-boundary
  equality), the EIGHTH pg suite (wocc_woc_market_authguard_verify, 11
  tests, real writer-to-bust chains, self-selects into the gate floor), and
  docs/registry. Reviewer reality: four lanes dispatched, four full
  reports delivered after one nudge each; the MAIN THREAD found the
  round's one substantive defect first and two lanes proved the same race
  live (an account-keyed bust could not cancel an in-flight token fetch,
  so a revoked token could install and answer for one TTL in-process).
  The review fix round (98813d67a2, 02108093eb) closed it with a
  content-keyed install veto plus a soft-bounded recent-bust ledger, and
  applied every other finding: shutdown flushes but keeps the singleton
  armed, caps re-sized to 10_240/5_120 against the 5,000-player realm cap,
  the woc_auth_guard_cache{arm,kind} prometheus gauge, quota NOTIFY
  listener busts (cross-process for the policy columns), the discovery
  classifier's upsert arm + statement-bounded window + bust-after-COMMIT
  structural pin, keyed-bust stranger survivors on every arm, the 403
  bodies over the cached bundle, and the pg suite's long-TTL rig with a
  raw-SQL warm-stale control plus revokeReadToken and the four audited
  moderation writers. Mutation record: 25 distinct live, 24 BIT, 1 green
  control, every stale verdict re-run; the qa-checklist round (READY, 0
  blocking) then landed the derived veto-ledger floor (70s/90s against the
  65s driver backstop, relation-pinned to the exported db deadlines), the
  exercised flush lever, the gate note, and the count corrections (rider
  mutants close at 27 distinct, 26 BIT, 1 green control; whole log 368).
  Validation: tsc clean; pg battery EIGHT suites 254 tests zero skips one
  lane at a time; DB-free marketplace and guard-adjacent suites green; S3 /
  monolith / architecture / suite-duration green; ci:changed exit 0; gate
  PASS ALL 12 STEPS TWICE (3e767bf483, independently reproduced by the
  qa-checklist agent, and the final code tip 1f9f8aac4a; both full-suite
  fallback, the second 42,980 tests plus browser 131). THREE MAINTAINER
  RULINGS remain OPEN (re-surfaced, not re-decided): the woc_market.ts
  ceiling raise (+53, net 448 DOWN), the woc_market_db.ts no-ratchet-row
  question (4783), and the escrow gate hold-ceiling sizing. The rider
  implement section in progress.md is the registry the rider QA consumes
  (JUDGED list and values registry binding). NEXT =
  docs/woc-marketplace-hardening/rider-auth-guard-reads-qa.md (GAME repo,
  wocc-marketplace, FRESH session, newest origin/release/** sync first,
  diffs f844a72eaa..the recorded tip, pushes on PASS per R4), then
  phase-21-devnet-dry-run.md stays owed after it.
- ESCROW WRITE-PATH RIDER QA COMPLETE (2026-08-20, GAME repo, verdict PASS,
  PUSHED per R4). Audited b72873d24e..7e07cf12a6. The v0.40.0 re-sync was
  NOT the expected no-op: 123 commits had landed (the GPU-preparation
  scheduler), merge a22f111644, four conflicts each RE-DERIVED from the
  merged tree (hud.ts unions both import edits and re-pins to the exact
  19154, main.ts to 11519, the shard table keeps this branch's newer harvest
  after verifying it a strict superset, pending.ts regenerated); reinstall
  needed because patches/ and the lockfile moved. release-merge-audit CLEAN:
  the incoming delta touches zero server files, zero routes, zero
  marketplace code, and both parents' intent was verified surviving in all
  12 material overlap files mechanically. 14 FINDINGS APPLIED, zero deferred
  as unfixed: three from the main thread (the unlocked-confirm docblock
  still called two functions plain-FOR-UPDATE re-reads after the narrowing,
  a dead import the delivery extraction left, the reserved word "phase") and
  eleven from the coverage lane (the acceptance drain rung had NO test and
  its sibling's title lied; neither entry pinned the rung's pre-burn
  POSITION; two of three stamp sites never armed the watcher under test; the
  routing pin was blind to a hoisted-SQL writer; the hold ceiling priced one
  sequence though the hold spans the FIFO queue; the depth-before-gate order
  was unpinned and a swap leaks a realm slot; the HELP line, the two new
  gauges' live-read claim, the cap-refused park's arm consequence, the
  hand-enumerated sibling list, and the line-only stripper). REVIEWER
  REALITY: four lanes dispatched, ONE delivered even after the one-retry
  nudge, so security, db-performance and hot-path carry ONE pass this round
  (the main thread's own probes) on top of the implement round's four lanes.
  16 MUTANTS, ALL BIT: six independent spot-checks of existing pins with the
  QA's own strip designs at DIFFERENT sites than the logged rows, plus ten
  proving every pin this round added. Validation: tsc clean; pg battery
  SEVEN suites 241 tests zero skips run TWICE one lane at a time; DB-free
  set 27 files 1171 tests; ci:changed exit 0; gate PASS on the committed
  tree. TWO MAINTAINER RULINGS SURFACED with recommendations (details in the
  progress.md QA section): the woc_market.ts ceiling raise is sound but the
  number to judge is +53 across TWO raises, not the recorded +37, with the
  net 4484 -> 4036 DOWN; and woc_market_db.ts still has no ratchet row while
  being the largest marketplace file at 4783, recommend adding one. NEW
  DEFERRAL (owner maintainer): the gate hold-ceiling SIZING buys exactly one
  queued heavy save, so a deep save queue can reclaim a legitimate hold; the
  prose and the pin were made honest about that bound rather than the
  constant changed. NEXT = the SECOND settled rider, the per-request
  auth-guard reads: MINT ITS SPEC PAIR FIRST from the 17 SESSION START
  DECISION bullet below (GAME repo, wocc-marketplace, FRESH session, newest
  origin/release/** sync first, implement stays LOCAL per R4), and
  phase-21-devnet-dry-run.md stays owed after it.
- ESCROW WRITE-PATH RIDER IMPLEMENT COMPLETE (2026-08-20, GAME repo, LOCAL
  per R4: nothing pushed; the rider QA session pushes on PASS). Session
  start b72873d24e; v0.40.0 sync merge 00334857e0 NON-TRIVIAL (59 commits,
  the controller cross-hotbar packet; four conflicts re-derived from the
  merged tree, release-merge-audit clean). Spec pair minted FIRST
  (rider-escrow-write-path.md + its QA file, commit 0b87229b2d, the cluster
  verbatim from the 16/17 registries plus recon corrections). All NINE
  deliverables landed in order (occupancy bound before the FIFO close):
  the honest occupancy tail (guild-flush relation + the DERIVED 157s
  started ceiling, scrape-pinned), the realm escrow gate (cap 4, hold
  ceiling 300s with a RECLAIMING saturation probe), the observability set
  (two gauges, three new counter kinds, four contention classes + gate +
  serialize + stamp + park-refusal numbers on the stuck readout, the
  saveAll-wave fact pinned), the TxNeverStarted widening (11 tails, two
  pinned exceptions), the FOR NO KEY UPDATE narrowing (21 clauses, zero
  plain left, real-SQL proofs with negative controls plus the
  KEY-SHARE-holder mode binding), the bounded plain writers (38 sites on
  the merged-query save-tier seam, routing completeness pinned, recorders
  answer typed contended -> confirm_in_flight, clearBuyNowLock
  retry-once-swallow-all), the drain + saturation pre-burn rungs on BOTH
  escrow entries, the ledger bounds (park cap 512 counted, stamp
  high-water total-size counted re-arming), and the commitGrant FIFO close
  (in-slot serialize, busy parks counted grant_busy and budgeted at 2 per
  scope, park subset intact, the delivery arms extracted to
  woc_market_delivery.ts paying woc_market.ts DOWN net 447 to 4037).
  Reviews: four lanes + coverage + a FRESH fix-round review; every finding
  applied or judged (the convergent blocker was the per-row FIFO wait in
  the locked segment; the fresh review caught the reclaim dead behind the
  saturation pre-check). Mutation record: 30 distinct, 28 BIT, 1 green
  control, 1 in-round-upgraded survivor, 4 stale-verdict re-runs BIT
  (rider section + re-verification block in phase-20-mutation-log.md).
  qa-checklist ran LAST (static beside the gate): READY, its 2 should-fix
  and 4 nits ALL applied in 961aa1e411 (identity-tokened gate holds cure
  the age-direction defect and retire the over-free judgment; the
  pre-check's refusals now count into realm_refused; door-closing pin on
  characterSaveQueues), with the 7 rewritten-region mutants re-run BIT
  (rider log totals 32 live / 30 BIT). Validation at the tip: tsc clean;
  pg battery SEVEN suites 241 tests zero skips; DB-free set 974+ tests;
  ci:changed exit 0; gate PASS all 12 steps at 7d9fb28dbb and RE-RUN at
  the final code tip after the qa-checklist round (the registry's final
  gate note is authoritative for the re-run's recorded result). TWO MAINTAINER RULINGS OPEN: the
  woc_market.ts ceiling raise 4000 -> 4037 inside the rider (net 447 DOWN
  overall; declaration-surface justification), and the standing
  woc_market_db.ts no-ratchet-row question (its rider growth +158, all
  SQL-adjacent). The rider implement section in progress.md is the
  registry the rider QA consumed (JUDGED and DEFERRED lists binding;
  values registry inside; the directed_sql floor is now 116). Its QA has
  now RUN and PASSED: see the bullet above, which owns the NEXT pointer.
- 20 QA COMPLETE (2026-08-20, GAME repo, verdict PASS-WITH-FOLLOWUPS, every
  finding applied or judged with the file open; PUSHED per R4, gate PASS all
  12 steps at 8581ee5b2d, full-suite fallback, 41,708 tests plus browser
  131; details in the progress entry's final validation note). Six audit lanes + the coverage
  auditor + qa-checklist over 057b54141a..31d07c6375: the inventory
  re-derivation found the ACCOUNT-scoping qual family separable only by
  realm (trade poll participants, bid and settlement activity reads, the
  directed addressee and its closed member; every fixture held only the
  queried account's rows), fixed with same-realm stranger fixtures and BIT
  mutants, plus a pinned-but-unlogged batch (step-up DDL trio, two CHECK
  negatives, bond-signature unique index, insert-side pair belt,
  liveSettlement states, reopen SET resets, suspend DESC flip, sweep lock
  realm, retention prunes) now logged, and three genuinely unpinned holes
  closed (the lapse sweep's inner status qual would have VOIDED a refund_due
  bond, the abandon prune's age cutoff had no pin, the real readout clamp
  was fake-pinned only). Fake fidelity: stuck-bond sample order, nested
  itemRef aliasing both sides of acceptance, fence hooks below the cap
  count, the twin-steal-records-nothing order, each with a reversion-BIT
  arm. Five at-cap fixtures now DERIVE from
  WOC_MARKET_BUY_NOW_ABANDONS_PER_HOUR (a green cap-bump control proves the
  suite tracks the constant). Gate dry-selection probe: all seven pg suites
  sit in the always-run floor, no coverage theater. Mutation record: 45 new
  mutants, 43 BIT, 1 judged single (expireDue inner status, double-strip
  proven, added to the judged table), 1 green control; 5 independent
  re-verifications of existing rows all BIT; battery 232 to 236, floor 110,
  fidelity 11. The 20 QA round section in progress.md is the registry
  (JUDGED and DEFERRED lists binding). NEXT = the settled riders (the escrow
  WRITE-path cluster, then the per-request auth-guard reads), owed BEFORE
  docs/woc-marketplace-hardening/phase-21-devnet-dry-run.md.
- 20 IMPLEMENT COMPLETE (2026-08-20, GAME repo, LOCAL per R4: nothing
  pushed; the 20 QA session pushes on PASS). Session start 057b54141a,
  release sync a NO-OP (343 ahead, 0 behind origin/release/v0.40.0). The
  "money/security SQL is fake-only" medium is CLOSED: all four deliverables
  landed. (1) The predicate INVENTORY is the "Real-SQL predicate inventory
  (20)" section below, with zero remaining fake-only or untested
  money/security predicates. (2) Real-SQL pins landed for every gap the
  241-mutant campaign proved, headlined by the new cross-realm isolation
  suite tests/woc_market_realm_scope_pg_integration.test.ts (realm quals
  were fake-only across the whole store), the bid intake refusal ladder
  (self-buy + wallet twin), settlement signature intake (offered-only CAS +
  tx_signature reuse typed), the custody intent ledger's one-way booked
  flip, the buy-now claim diagnosis ladder and cooldown scoping, the
  abandon exempt window's five arms, the activation ladder, finalize's
  guards, sweep batch predicates, strikes/terms upserts, the escrow stamp
  CAS, schema CHECK negatives, and two new DB-free lock-shape floor pins.
  (3) The mutation log (docs/woc-marketplace-hardening/phase-20-mutation-log.md):
  248 distinct mutants, 240 red-on-strip green-on-restore, 7 judged
  defense-in-depth singles EACH proven by a double strip that bit, 1
  deliberate no-op control; run in three scratch worktrees over the
  committed tree, never the shared tree. (4) Fake honesty: six divergences
  FIXED and pinned in tests/server/fake_woc_market_db.test.ts
  (submitBondSignature verdict order, the missing claim wallet-twin guard,
  the readout cap clamp, directedOfferById live-row aliasing that one
  service test exploited and now stages through an explicit hook, the
  delivered-page realm qual, the escrow comment), benign divergences
  documented in the 20 progress entry. Parked items: the 03/05 standing
  planner assertions are CLOSED (17's plan suite rotation test is exactly
  that assertion); the at-scale advisory-cooldown proof, p99.9 gap, and
  expiry-batch ceiling RE-DEFER to 21 (they need 21's at-scale rig); the
  pg-suites-in-CI posture RE-DEFERS to 22 (a gate-selection change owned by
  the close-out). Suite growth: 172 to 232 pg tests (seven suites, zero
  skips; the realm suite is 19 tests), 106 to 109 floor pins, service suite
  +1 settlementQuote entry-guards test, fake fidelity suite 3 to 7. The two
  reviewer rounds (test-coverage-auditor, database-performance-reviewer) ran
  over the committed spine and every finding was applied or judged, headlined
  by one PROVEN-vacuous pin (a slice over a lexicographic sort had gutted the
  listingsBySeller realm assertion) and a fake fidelity round two; the fix
  round was mutation-verified (round6, 9/9 bit, incl. the upgraded
  ex-survivor claim_open_settlement_advisory and the re-proven
  listingsBySeller pin), re-reviewed FRESH (0 blocking, 1 docs truth-up, 2
  nits, all applied), and the closing gate PASS (all 12 steps at 73e5f24fb0,
  full-suite fallback) is recorded in the progress entry's final validation
  note.
  The 20 implement round section in progress.md is the registry the 20 QA
  session consumes (JUDGED and DEFERRED lists binding). NEXT =
  phase-20-qa.md, GAME repo, wocc-marketplace, FRESH session, newest
  origin/release/** sync first; it diffs 057b54141a to the recorded tip.
- 19 QA COMPLETE (2026-08-19, DASHBOARD repo, verdict PASS-WITH-FOLLOWUPS,
  every finding applied or judged with the file open, PUSHED per R4:
  dashboard ae6e46c..145d120, FOURTEEN commits incl. seven QA fix commits,
  to origin/feature/woc-market-trading-controls, PR #13; game docs pushed
  after verifying feature/woc-marketplace 0 behind origin/release/v0.40.0).
  Session start 8eeaf8f, origin/master sync a NO-OP. Six coverage lanes +
  hands-on probes over ae6e46c..8eeaf8f: ONE BLOCKING, reproduced live: node
  --test treats positional args as glob patterns, so a renamed or deleted
  security suite silently SHRANK test:security while the step stayed green;
  fixed with the tests/harness/run_security_suites.mjs runner (single-source
  list, loud refusal before any spawn, exit propagation, entry proven end to
  end) and its guard suite; auth_policy joined the by-name list. Headline
  fixes: custody sample-row leaf screening (an object leaf in a spine-valid
  200 unmounted the Trading tab), optional gauge types, the p2p Listing
  cross-link column, listing: alias + token/free-text separation, one-read
  identity-keyed jump landings, the canonicalizer single-sourced into
  src/proxy_path.ts, economy actor ByteString clamp, underscore route
  helpers (phantom endpoints gone), a payout call-site drift scan set-equal
  both ways, and a same-filter stale race that isolates the quotes
  supersession. 28/28 mutants bit (11 independent spot-checks of the
  implement round's proofs + 17 new-pin mutants); harness integrity and CI
  honesty proven live; fix round RE-REVIEWED FRESH (0 blocking, everything
  applied in 145d120). Final tree: npm test 276/0, check 0 errors, build
  complete, npm audit 0, all re-proven from a FRESH clean clone. The
  workflow's MAIDEN Actions runs both GREEN on the push (32328875415 push
  1m06s, 32328875583 pull_request 1m10s). FOR FERNANDO: make the ci check
  REQUIRED on the protected branch (verified: no ruleset or protection
  exists on either branch yet) and confirm external-role POST payouts/send
  stays intended. The 19 QA round section in progress.md is the registry
  (JUDGED and DEFERRED lists binding). NEXT = phase-20-real-sql-coverage.md,
  GAME repo, FRESH session, newest origin/release/** sync first.
- 19 IMPLEMENT COMPLETE (2026-08-19, DASHBOARD repo, LOCAL per R4: nothing
  pushed in either repo; the 19 QA session pushes on PASS to
  origin/feature/woc-market-trading-controls, PR #13). Session start ae6e46c
  (the 18 QA tip AND the remote tip; origin/master sync a NO-OP). All five
  deliverables landed with red-first or mutation-proven tests: the repo's
  FIRST CI workflow (npm ci, security suites by name via test:security, full
  suite, check, build; read-only token; proven act-style from a clean clone
  of the committed tip TWICE since implement sessions do not push), the
  component-render harness (esbuild JSX load hook + happy-dom under act;
  devDeps esbuild + happy-dom, the sanctioned exception) closing EVERY
  18-round JSX deferral (release money guard, both submit outcomes, loaderRef
  supersession, tes-2 outage survival, four-panel composite actor, ARIA
  tablist, pill tones, notice clearing, decimals render, quotes affordance),
  npm audit 0 (was 11, lockfile-only), the data-truth batch (dead p2p trades
  incl. the settlement-bearing class, buy-now price, per-quote legs identity
  via quoteLegsMismatch since the window totals still lack a settled total,
  superseding list loaders + malformed-200 screening, loading affordances,
  case-lenient canonicalized release references, wocDecimalsMismatch banner,
  withdrawalReadiness gate, the 31-site ambient-locale sweep with a
  JSX-aware source scan), and the investigation UX (find box with exact
  id:/acct: tokens, account cross-links between the list views + custody to
  listings + audit WMB refs into the release form, consumed on hand
  navigation; the Custody subtab consuming /internal/woc-market/stuck as the
  THIRD game-proxy path with correct age axes and saturation labels; the
  payout proxy moved to a method-qualified explicit allowlist with the
  percent re-check and the x-woc-daily-reward-actor header on every request).
  Two fresh lenses (0 blocking) + a FRESH fix-round re-review (caught a real
  blanker regression: JSX closing tags read as regex openers; fixed +
  mutation-proven), every finding applied or judged; 12 mutation proofs bit.
  Tests 183 to 254, check 0 errors, build 0, clean-clone gate green. FOR
  FERNANDO: external role can still POST payouts/send (pre-existing policy,
  now pinned per-route; confirm intended) and the ci check must be made
  REQUIRED in repo settings. Seven commits ae6e46c..8eeaf8f. The 19
  implement round section in progress.md is the registry the 19 QA consumes
  (JUDGED and DEFERRED lists binding). NEXT = phase-19-qa.md, FRESH session.
- 18 QA COMPLETE (2026-08-19, PASS-WITH-FOLLOWUPS, every finding applied or
  judged with the file open, PUSHED per R4). DASHBOARD repo; session start e82303e
  (the implement tip AND the PR #13 remote tip); origin/master sync a NO-OP; game
  branch verified 0 behind origin/release/v0.40.0 e56707a675 so the game push is
  the 1-ahead docs commit only. Six fresh coverage lanes over c001d4a..e82303e:
  ONE blocking (the game proxy host-pinning bypass, a leading-slash params.path
  made new URL('//internal/...', base) protocol-relative and would send the
  dashboard secret to host 'internal'; fixed by mirroring the payout proxy's
  canonicalGamePath and building the URL from the normalized value, mutation-proven).
  The four named probes verified sound by hand (proxy bypass hunt clean, roles are
  server-session-keyed, decimals cover both directions, forfeit binds to the
  reference tail, actor-id survives rename). ~45 findings applied or judged;
  headline fixes: object-valued render leaves screened in market_summary_load (a
  malformed 200 could unmount the tab), OPERATOR_LOCALE extracted to one module and
  pinned by value plus a source scan, the rate/sample-window figures extracted to
  the tested view core, USDC_MINT_DECIMALS/SOL_DECIMALS added for the bare-argument
  decimal sites, the .wm-over-balance class renamed to .wm-error-line, the
  big-number probe rewritten decisive. Sixteen new-pin mutants bit. FIX ROUND
  RE-REVIEWED FRESH (three lanes over the unreviewed fix code): five real defects
  found and fixed in a second wave (releaseSubmitOutcome was decorative; the leaf
  screen missed leaves the view core COERCES not renders; describePriceReason said
  "healthy" on the halted line; sampleWindowLabel counterfeited "0 samples"; two
  bare SOL 9s remained), all round-2 pins bit. Eight fix commits (e82303e..ae6e46c);
  final tree npm test 183/0, check 0 errors, build complete; pushed to
  origin/feature/woc-market-trading-controls (PR #13). The 18 QA round section in
  progress.md is the registry the next sessions consume (JUDGED and DEFERRED lists
  binding; 19 owns the component-render harness, the MarketListViews stale-wins
  race and loading affordance, the ambient-locale money helpers, and the wocDecimals
  reconciliation guard).
- 18 IMPLEMENT COMPLETE (2026-08-19, DASHBOARD repo, LOCAL per R4: nothing
  pushed in either repo; the 18 QA session pushes on PASS to
  origin/feature/woc-market-trading-controls, updating PR #13). Session
  start c001d4a (= the PR #13 tip AND the remote branch tip, so the
  2026-08-11 premises were re-verified against exactly the reviewed tree;
  origin/master sync a NO-OP). All four deliverables closed with
  red-first tests: H1 (canReadGameMarketData gates the game proxy before
  secret use, external-role matrix over every proxied path with a
  zero-upstream pin), H2 (WOC_MINT_DECIMALS = 6 in woc_mint.ts, the one
  source; Claudium fallbacks unified; scan guard with per-arm probes and
  a SOL lamports allowlist), operation safety (WMB_-only release,
  forfeit confirmation typed as the SPECIFIC reference's last 8 chars,
  the 18 QA binding probe adopted early; whole-form reset on success;
  auditActor "id (username)" composite with auditActorDisplay rendering
  the human half), and overview resilience (market_summary_load
  allSettled per-read isolation, subtabs unconditional, monotonic load
  sequence, malformed-200 guards). Review: three coverage lenses, ZERO
  blocking, ~22 findings all applied or judged, then TWO fresh fix-round
  reviewers (both READY; their findings, incl. the literal-null 200
  body, the tokensPerUsd/venue-element render-path leaves, and the
  tested createSummaryLoader supersession factory, all applied); en-US
  operator number formatting (OPERATOR_LOCALE, formatUsd included)
  chosen over locale-dependent pins. Dashboard repo gained its first
  CLAUDE.md; README trued (external role, Trading tab, env vars).
  Validation final tree e82303e (session range c001d4a..e82303e, ten
  commits): npm test 164/164, check 0, build 0. The 18 implement round
  section in progress.md is the registry the 18 QA consumes (JUDGED and
  LEDGER-ITEM lists binding; 19 owns the payout-proxy allowlist upgrade,
  the component-render harness, payout actor forwarding, and the
  ambient-locale class now scoped to App.tsx/discount formatters).
- 17 QA COMPLETE (2026-08-19, PASS-WITH-FOLLOWUPS, every finding applied
  or judged with the file open, PUSHED per R4). Release sync a NO-OP (0
  behind origin/release/v0.40.0 e56707a675, the newest release branch).
  Nine audit lanes (db-perf, migration-safety, test-coverage as plain
  Agents; six workflow lanes incl. the four phase probes) + a FRESH
  fix-round reviewer + qa-checklist LAST; ZERO blocking findings against
  the implement round; the never-sweep verdict is SOUND (three lanes plus
  the session's own read: unbooked structurally unreachable, live
  referents shield at any age incl. review-state disputes, re-drive after
  prune impossible by construction, no livelock); the accounts-FK
  not-indexed decision UPHELD and converted into a pg catalog
  completeness floor (exactly the four allowlisted columns; partial and
  INVALID indexes do not count as coverage); five mutations run, five
  bit. Fix commits 30b3097e6a / 727f71c88c / fafe5e5afe / ebe9b24662
  plus docs 5419d66455: the delivered-save guard's 55P03
  count-and-rethrow tail (the twelfth guard joins lockWaitTimeouts,
  routing unchanged), the plan suite's realistic fixture moved to
  beforeAll (-t filtered runs fixed) with a NATURAL-cost prune probe and
  behavioral cascade/claimed_at arms, the FK completeness floor, the
  custody-ref prefix containment scan (positive control, exact-path
  allowlist), and the TRUE retention-default contract in server/CLAUDE.md
  (every retention window has a positive code default: unset prunes at
  the documented value, 0 is the explicit keep-forever, untrimmed reads
  make whitespace fail safe). REGISTRY DELTAS on the 17 implement entry:
  deleteUnusedFederatedProvision lives in server/federated_auth_db.ts;
  the classifier has 12 call sites; the phase-22 ops caveats gain the
  REVERSE mixed-fleet index flip (an old-binary boot re-creates
  woc_market_settlements_listing under ACCESS EXCLUSIVE). The 17 QA
  round section in progress.md is the registry the next sessions consume
  (JUDGED and DEFERRED lists binding; the escrow WRITE-path rider gains
  the plain-statement-writer bound class, headlined by the contended-arm
  clearBuyNowLock cleanup; 22's runbook gains the 365d memoRef-trace
  bound and the sweep-budget arithmetic). Gate PASS twice: 5419d66455
  and the final code tree ebe9b24662, all 12 steps, selective; the wrap
  commit on top is docs-only.
- 17 IMPLEMENT COMPLETE (2026-08-19, LOCAL not pushed per R4; release sync
  a NO-OP, 0 behind origin/release/v0.40.0 e56707a675; session start
  4799b24dc2). All four deliverables landed with their stale premises
  re-verified first: custody-claims retention (pruneBookedWocCustodyClaimsBatch,
  WOC_MARKET_CUSTODY_CLAIMS_RETENTION_DAYS 365, booked-only aged on
  booked_at behind the new woc_market_custody_claims_booked partial, a
  parsed-ref referent guard so a live settlement/listing row shields its
  claim at any age, ctid outer, boot warning wocCustodyClaimsRetentionWarning
  on the window relation) plus the knobless step-up drain
  (WOC_STEPUP_PRUNE_SLACK_DAYS 1), both registered before the listings
  tail; indexes woc_market_listings_live_price_desc and
  woc_market_settlements_listing_latest (supersedes _listing by
  create-before-drop); lock_timeout completed at insertPendingBid and
  activateBidTx (ALL twelve withTx guards now carry both bounds,
  ratcheted; held-lock pg proofs within [1.5s, 10s)); the priorWinners
  fold (nextCascadeBidder derives won/defaulted per account in SQL, the
  cascade arm's unbounded bid-list fetch is gone); the consolidated
  EXPLAIN list as the new tests/woc_market_plan_pins_pg_integration.test.ts
  incl the realistic-count poll-read preference proof; the pgPool gauge
  {total, idle, waiting} plus the 55P03 lockWaitTimeouts counter on
  GET /internal/woc-market/stuck; the accounts-cascade FK columns
  DECIDED not indexed (rationale in the 17 progress entry, QA re-judges);
  the boot-repair quals EXPLAINed one-off and recorded (discharged);
  monolith ratchet re-pinned DOWN at woc_market.ts 4484. Three typed
  reviewers plus a fresh fix-round reviewer plus qa-checklist (READY);
  roughly 55 findings, every one applied or judged; the headline was the
  measured hashed-SubPlan regression in the first prune cut, fixed and
  plan-pinned with a no-SubPlan assert. The 17 implement entry in
  progress.md is the registry the 17 QA consumes (JUDGED lists binding;
  values registry inside).
- 17 SESSION START DECISION (2026-08-19), the deferred perf rider scope,
  settled with reasons: NEITHER cluster lands in 17. (1) The escrow
  WRITE-path cluster (05/06 QA db-perf P2s, 12 sub-items per the 16 QA
  registry) goes to its OWN dedicated rider before 22, confirming the 16
  proposal: it is write-path work with its own pg review surface (the
  roughly 15-site FOR NO KEY UPDATE narrowing pass, the commitGrant FIFO
  hard-sequenced after the honest occupancy bound), it needs
  privacy-security in its reviewer set, and folding it into 17 would double
  the review surface of both diffs. (2) The per-request auth-guard-read
  cluster ALSO goes to a dedicated rider before 22, SEPARATE from the
  escrow rider: it is security-sensitive caching, not retention/index work
  (a token cache extends a revoked token's life by up to its TTL, including
  the ADMIN bearer, since require_admin resolves through the same
  db.accountAndScopeForToken; a moderation cache delays cross-process bans
  by the TTL; moderationStatusForAccount computes locked/suspendedUntil
  with Date.now at read time, so the ROW, not the computed result, must be
  cached), with roughly 20 bust sites across 6+ files and its own reviewer
  set (privacy-security + server-hot-path). It is NOT an enable blocker:
  both guard reads are indexed point reads (auth_tokens token probe,
  accounts id PK + one LEFT JOIN) already behind the 240/min read limiter;
  the win is efficiency, not safety, so deferring past 17 costs nothing at
  enable time. Sequencing: both riders land AFTER 19 and BEFORE 21 where
  feasible so 21's devnet contention run measures the shipped shapes;
  escrow rider first (its items carry internal ordering), auth-guard rider
  second; each as its own implement+QA pair. Design constraints recorded
  for the auth rider: consider scoping the cache to the marketplace
  guardDbBundle seam (woc_market_routes.ts) so the admin surface stays
  uncached; cache raw rows and re-check expires_at at read time (the SQL
  bakes expires_at > now() into the probe, so a result cache extends token
  life); the account-keyed bust design must handle revokeCompanionToken's
  prefix-keyed delete; recon detail in the 17 implement entry of
  progress.md.
- Next file to run: `docs/woc-marketplace-hardening/phase-19-dashboard-tooling.md`
  (DASHBOARD repo, worktree `/Users/fernando/Documents/woc-rewards-dashboard-pr13`,
  branch `integration/woc-market-trading`, FRESH session, own origin/master sync
  first). 19 owns the deferrals the 18 QA registry named: the component-render
  test harness (so JSX wiring and the money-guard call get pinned), the
  MarketListViews stale-response-wins race + shared busy flag + a loading affordance
  on filter change, the ambient-locale money helpers, and the wocDecimals runtime
  reconciliation guard (plus asking the service to report wocDecimals on the market
  payloads, shared with 22).
- 16 QA COMPLETE (2026-08-19, PASS-WITH-FOLLOWUPS, every finding applied or
  judged with the file open, PUSHED per R4). Release sync a NO-OP (0 behind
  origin/release/v0.40.0 e56707a675). Eight workflow lanes + three typed
  reviewers + a fresh two-lens fix-round review + 21 mutants ALL BIT +
  qa-checklist; ~85 findings, zero lane blockers; the db-perf BLOCK's four
  P1s judged with files open (two real: the unmapped 25P03 on the bid path,
  the 2s idle bound over the save-serialize window). Five fix commits
  1819f8917d / 2303baf2cc / 9f3d53003d / 48fe30cc58 / e3bd74c52a. REGISTRY
  DELTAS on top of the 16 implement bullet: browse cache fences DEEP PAGES
  (WOC_MARKET_BROWSE_CACHE_MAX_PAGE 2); EVERY mutating handler busts the
  actor readout on refusals too, createOffer busts (guardTerms records),
  the eager confirm's 'confirmed' answer drops the history map, bustHistory
  (caller-less) removed; myActivity carries a between-reads deadline
  (WOC_MARKET_ME_READOUT_DEADLINE_MS 6s); the bond budget break joins the
  SATURATED list and the arm returns due.length; the two save-bearing
  guards carry SAVE_IDLE_TX_TIMEOUT_MS 10s (the other ten keep 2s);
  idleTxKills + priceCache memo ages ride /internal/woc-market/stuck; the
  sweep destroys a client whose unlock answers false and the lock SQL is
  the exported WOC_MARKET_SWEEP_LOCK_SQL/UNLOCK_SQL pair every judge
  shares; proxy estimates are frozen; tradePartner is TRI-STATE in the sdk
  (404 = the only null-partner verdict) with a 5s re-armed backoff and a
  sequence guard in the trade controller; QUALITY_WORDS derives from the
  exported ITEM_QUALITY_LABEL_KEYS; the step-up flow lives in
  server/woc_market_stepup_flow.ts (ratchet row exactly 4487, zero
  headroom, delivery arms next candidate). The 16 QA round section in
  progress.md is the registry 17 consumes (JUDGED and DEFERRED lists
  binding; the focus_restore/15-QA discrepancy is recorded there).
- 16 IMPLEMENT COMPLETE (2026-08-19, LOCAL not pushed per R4; session start
  4cb60d0d3c, release sync ee6780bd76 TRIVIAL: origin/release/v0.40.0 was
  minted upstream, tip e56707a675, icons + CI workflows only, no audit
  owed). H11 closed; NINE commits (ab09d6e931 / 01130fb79b / 3d6e7ee99a /
  1b9bdcdb36 / 94d53a243a / 6113964df0 / 61868970db / 7ebb5491ce /
  60fc62f3fe, roster corrected by the 16 QA). THE VALUES REGISTRY the
  16 QA re-judges: read limiter woc_market_read 240/min shared across six
  GETs (status, browse, detail, me, history, offers), ip+account, TIER-1
  ONLY (tier2 'none' is load-bearing: 'global' costs two rate_limits
  UPSERTs per allowed poll); trade-partner deliberately on the 30/min
  QUOTE bucket (enumeration oracle). Read caches
  (server/woc_market_read_cache.ts): browse 3s/128 (itemIds===null
  queries only), listing rows 3s/256, history 10s/256 (known ITEMS ids
  only), activity 2s/512; busts = every mutating handler (16-row table
  pin) + moderation arms + wallet link/unlink via
  registerWocMarketReadCacheForBusts; values frozen defensively. Price
  cache (server/woc_market_price_cache.ts): success TTL 15s, failure memo
  3s, SWR bound 30s, single-flight; estimates on KeyedCachedRead 15s/256
  single-flight per usdCents. Sweep: sweepSegments() = expiry(locked),
  chain-polls(UNLOCKED, read-only confirms, CAS-proven), delivery(locked),
  bond-payouts(LOCKED, money RPCs need provable exclusion); watchdog warn
  60s repeating, readout + cache counters on GET /internal/woc-market/stuck;
  /me sequenced to ONE pool client (counted in unit + pg). /status now
  ships bond {rateBps 500, minCents 100, maxCents 5000, pendingTtlSeconds
  300}; six new i18n keys (bidBondSchedule, bidBondPayWindow,
  sellEmptyFloor, sellCollectibles{Both,Mounts,Chromas}) each with five
  non-Latin fills; sellEmpty RETIRED (its five fills removed; the release
  fill list loses that row). Monolith: server/woc_market.ts ENTERS the
  ratchet at 4487 (corrected by the 16 QA; the ledger extraction re-pinned
  the mid-session 4500) (drift-warn extracted to woc_market_drift_warn.ts, both
  wire screens + the warner judge through the exported
  WOC_MARKET_WIRE_PENDING_SET/FAIL_SET); woc_market_window.ts DOWN
  2618 -> 2614 (sales list + sell caption to chrome). saleView.item is OFF
  the wire (dead weight, no client reader). All twelve withTx guards carry
  the idle bound; the shared withTx arm logs 25P03 kills distinctly; the
  LOCKED bond-payout walk is budgeted (BOND_PAYOUT_BUDGET_MS 30s; the arm
  reports rows FETCHED and a budget break joins the saturated list,
  corrected by the 16 QA). DECIDED: the 50-row
  offers-inbox cap STANDS, no pagination (cost/benefit in the 16 progress
  entry; 22 re-checks against the abuse ledger). RE-DEFERRED with owners:
  the escrow WRITE-path cluster to a dedicated rider before 22 (decided at
  the 17 session start); trade-wire diff-cost note 22; p99.9 gap +
  advisory-cooldown proofs 20/21; contention run 21; EXPLAIN list +
  priorWinners 17; abandons-FK lock note 22; SEC-9 recording-window remedy
  22 (service-side; game-side single-flight shipped). The 16 implement
  entry in progress.md is the registry the 16 QA consumes (JUDGED
  no-change list inside: do not re-raise).
- 15 QA COMPLETE (2026-08-19, PASS-WITH-FOLLOWUPS, PUSHED per R4). Release
  sync: merge e32f7d8945 of origin/release/v0.39.0 tip ea9377db8e (136
  commits, one generated-i18n conflict, regenerated), release-merge-audit
  clean apart from the monolith re-pin it owed (sim.ts 12531, game.ts 10813,
  commit 5c67a708cd). The QA eyeball found and re-took ELEVEN defective
  captures (takeover modal, GPU toast, camera picker, four misframed mobile
  detail faces; rig framing fixed, debug dumps out of the committed dir).
  Five audit lanes plus a fresh fix-round review plus qa-checklist: ~25
  findings, all applied or judged (comment-stripped mobile pins, derived
  five-fill figures on digit boundaries, the escrow-restore clone with a
  mutation-proven non-aliasing pin, the hostile-quote escape test, the
  chrome module's direct test, itemNameColor at both Exchange sites, wider
  ticker-glue shapes). Fernando signed off BEAUTIFUL WITH NOTES; the notes
  shipped (9bdb94c81e): the large window (min(92vw,1440px) x
  min(92vh,920px), superseding the fitted-960x700 judgment), left-aligned
  wrapping columns, the sort-led padded control row (extracted to
  woc_market_chrome.ts, window DOWN to 2618), token-equivalence tooltips on
  the price cells, phone row rhythm (12px cells, 16px first row); every
  Exchange face re-captured at the new geometry (57774f4674, 608 rig checks).
  Gate on the final tree: full step list stage by stage, four full vitest
  shards (41,446 tests, zero failures), browser suite 131, tsc, all builds,
  malware scan, then the sign-off delta re-proven (565 related tests). NEW
  deferral with owner: the Exchange's recreated role=status regions go to
  the woc_market_view pure-core extraction pass. Real-notch inset check
  still owed on a device. backup-pre-reword-15 delete stayed
  permission-blocked (verified content-free; manual git branch -D). The 15
  QA round entry in progress.md is the registry the next session consumes.
- 15 IMPLEMENT COMPLETE (2026-08-18, LOCAL not pushed per R4). Release sync
  first: merge 3a98604c83 of origin/release/v0.39.0 tip b650d9d7d2, 150
  commits, NON-trivial (four conflicts), so the `release-merge-audit` skill ran
  on it: five lanes plus an adversarial verify, 14 verdicts all REAL, every one
  applied (commits a4fcac14d8, 01faddadf8). Its highest-value catch was a
  MARKETPLACE defect the release surfaced: the escrow-compensation add-back
  (`restoreInto`) granted without `movement: true`, so undoing an extraction
  moved a catalogued relic's Reliquary obtain tally; fixed test-first. It also
  corrected this phase file's own premises (the capture slug is
  `docs/screenshots/woc-market/`, the one the five CI sparse cones list; ten of
  sixteen captures predate the step-up, not all sixteen).
  The phase itself: the written DESIGN.md audit is
  `docs/woc-marketplace-hardening/phase-15-design-audit.md` (seven read-only
  lanes, roughly 215 findings, every row APPLIED / DEFERRED with an owner /
  JUDGED with a reason), then the work top to bottom in three commits
  (92da32bbb1 style, e6c054232d test, be35080962 scripts) plus the docs and
  capture commits. Presentation only: no view-core file changed.
  Highest-value catches: `var(--accent)` was declared NOWHERE, so seven
  marketplace declarations shipped resolving to inherit/currentColor (the money
  row's accent, the net and settled lines, the selected currency toggle, both
  spinner arcs) and a new css var() resolution ratchet now makes that class
  impossible; on the mobile sheet the bags window (z 95 !important) covered the
  ENTIRE trade window, arm included, so a phone player could not reach the offer
  (the two now split the sheet like the vendor dock, verified in a real 900x420
  viewport with zero overlap and every control still top-most at its centre);
  neither money sheet cleared the safe-area insets; the trade arm's spinner was
  an inline box inside the pressed Pay button, so it never spun; the browse
  table re-flowed every column on each per-second countdown rebuild; the toast
  strip shifted the control the player had just pressed; the sell form's money
  inputs and the arm's price field missed the touch floor; the seller never saw
  a resolved fee (the note named a percentage the economy SERVICE owns, so the
  fee now comes from the server's own split for the typed price); the bond note
  resolved the wrong bid's bond; the paused and suspended lines asserted a cause
  they cannot know and named only some of the actions they refuse; and the
  Exchange window had NO behavioral test at all (now
  `tests/woc_market_window_rig.test.ts`, 21 live cases incl. the busyGen close
  guard against a competing second run). Captures: the fresh set under
  `docs/screenshots/woc-market/` (desktop + landscape phone, lowest preset,
  stress and zero states, and a ru_RU pass for the wordiest fills); every
  TOTP-bearing capture is gone. Then TWO independent
  `frontend-seam-reviewer` passes with MOBILE in scope plus an i18n fill audit,
  every finding applied or judged with the file open (commits c3704ee08c,
  13f174395a, cd225ebe10, 6f823fe274), and a FRESH review of that fix round.
  What the review round added: the staged item's name took the icon FRAME class
  instead of a text colour (an epic read grey behind a stray halo); two
  sentences were joined in code with a hard space, deciding a locale's spacing
  and order; a fee resolved for one price field survived the format swap that
  rebuilt the form under it; a token amount under half a hundredth printed a
  flat zero; both offer-expiry reads used tests that do not reject NaN, which is
  exactly what the server's date projection yields; and the money sheets' height
  cap could push their bottom edge (with the sticky commit row pinned to it)
  BELOW the viewport once a top inset exceeded 10px. The session's own captures
  also found the mirror of the sticky-row defect at the TOP edge: the window
  header is sticky and a focus-scrolled control came to rest under it, invisible
  to a centre-point hit test, so the rig now measures the header's live bottom
  edge after every scroll (116 assertions). One DEFERRAL was created rather than
  shipped: `--panel-border` stays undeclared, because its only consumers are 13
  Dungeon Finder borders and declaring it repaints a window this pass never
  captured. Two further rounds followed (a fresh review of the fix round, then
  the repo's `qa-checklist` over the whole range), and both found real things:
  the scroll reserve was built on a flat token where the window's real padding
  is inset-aware, so it fell 15px short on any notched phone and no headless
  run could see it; pinning the sheets' bottom edge had quietly stretched both
  to full height; the sell tab's locked-items caption fired for copies the
  picker would never have listed; and the seller's fee estimate rode the
  keystroke on the bucket the PAYMENT path shares. All fixed and pinned.
  Verification at the end: the full vitest suite in four shards (41,314 tests,
  zero failures), the real-browser suite (20 files, 131 tests), `npm run build`,
  `tsc`, the malware scan, biome over the changed files, and the i18n and
  manifest freshness gates, all green on the committed tree. Deferrals with owners are in the 15 section of
  progress.md; the audit checklist is the row-by-row record. 14 QA COMPLETE (2026-08-17,
  PASS-WITH-FOLLOWUPS, every finding applied or judged with the file open,
  PUSHED per R4; release sync merge 8c0370585c of origin/release/v0.39.0 tip
  f42a67f341, trivial). Nine workflow audit lanes + six typed reviewers + the
  session's own mobile E2E arm over d3b15f6057..ffd8d63963; roughly 150
  findings; fix commits e68227b6bb / d1e3eb2199 / ea08ac4711, a FRESH
  four-lane re-review of that fix round (25 more, 50-mutant battery 44 BIT,
  6 survivors closed) and 6f67a96057. Highest-value catches: the client held
  its claimed settlement UNKEYED (a claim answering after the deal ended could
  be re-quoted and paid under the NEXT deal), the poll held the buyer's face at
  'paying' through the claim round trips (a false 'Confirming your payment'
  after a refused claim), the seller never saw the fee before accepting, the
  buyer read no payment deadline and no strike (and a pressed Pay silently
  shortens the window: its own deadline now renders), a review-parked or
  delivered settlement rendered the confirming sentences, and the /terms
  consent link was DEAD on iOS and the packaged desktop shell and REBOOTED the
  game on Android (fixed with the wiki_link resolver idiom; the seam round's
  Vite proxy that broke dev /terms is gone). The 14 QA ROUND bullet in the 14
  ledger entry below is the registry 15 consumes (JUDGED and DEFERRED lists
  are binding: do not re-raise; the 15-owned polish list grew: the mobile
  BAGS-over-trade-window stacking, the missing safe-area insets on
  #trade-window, the tablist named after one tab, the panel's bare name
  outside the perf gate's painter regex, the 4-vs-2 digit token precision,
  the Claudium ticker suffixes; 16 owns /me metering + the 50-row inbox cap
  decision; 17 the settlements (listing_id, id DESC) index; 22 the Not-now
  lock release question, the outage-forfeit ruling, R11, the terms text
  re-consent question and the fail-then-pay-again service contract).
- 14 IMPLEMENT COMPLETE (2026-08-17; session start d3b15f6057; seven code/doc
  commits, see the 14 ledger entry below). R9 RESOLVED at that session start
  (see Rulings). R11 (the relink follow-up) stays a pre-enable launch gate for
  Fernando. The 13 QA ROUND's JUDGED and DEFERRED lists remain binding: do NOT
  re-raise them; the 15-owned items (R10 hint dead end, sell-picker lock
  filter, stale TOTP screenshots, the wallet busy label, the WocMarketWindow
  behavioral rig) were deliberately NOT pulled forward.
- LOUD deploy handoff (DEPLOY.md records it): enable the market only with
  BOTH sides at or after the contract tips (game: the build that sends
  bidCents; service: PR #31 270e337+, the build whose bond quote answers
  bondCents). The skew directions are ASYMMETRIC by design: an old game
  against the new service refuses bond quotes fail-safe (the service demands
  the bid), while a new game against an old service TOLERATES the missing
  figure by falling back to its ceil mirror at the same knobs, so keep the
  bond knobs in lockstep until both sides are current. The service must also
  keep reserving awaiting_finality for ledger-MATCHED payments.
- 12 QA COMPLETE (PASS-WITH-FOLLOWUPS, every finding applied or judged with
  the file open; PUSHED per R4). Ten audit lanes over a6ff42f1c5..bd089672f9
  (three repo reviewers via Agent + seven workflow lanes incl. the four
  phase probes), a red-proof lane (all 7 registry claims reproduced or
  verified), and two mutation batteries (round 1: 17 mutants, 16 BIT, the
  one survivor a REAL pin gap; new-pin round: 18/18 BIT incl. that
  survivor). Six fix commits to the pushed tip; the fix round re-reviewed
  FRESH (two lenses) and every new pin mutation-proven. Highest-value
  fixes: the anti-snipe extension now also fires on a POLL-settled bond
  (the allowlist had un-extended the honest bidder whose confirm raced
  chain visibility), the Exchange window honors signatureRequired false
  (the dev payment path was unreachable there), a bond re-quote re-labels
  the prompt from the adopted figure, the two payment surfaces agree about
  confirmed/delivering answers, listingView carries cancelPending +
  directed, and the status wire stopped leaking the service's verbatim
  operational reason word. Details in the 12 QA ROUND bullet of the ledger
  entry below.
- 12 COMPLETE (GAME repo; session start a6ff42f1c5,
  tip bd089672f9, 9 commits). H8 closed (split + signatureRequired on the
  wire, wire-pin suite over every serializer), env truth closed (service URL
  + dashboard secret documented, dead TOTP knob deleted, two-direction guard
  test), the health-rail medium resolved honestly game-side (ops key on
  GET /v1/market/price; the SERVICE's /v1/health still has no
  market-settlement rail at 270e337, deferred with owner below), and ALL four
  cross-repo owed items adopted: the service-owned bond quote, the
  anti-snipe awaiting_finality allowlist, the two-settled-per-memoRef
  tolerance, and verdict localization. asOfMs verified untouched
  (number|null pass-through). Four review lanes + a fresh fix-round
  re-review + qa-checklist READY (0 blocking); every finding applied or
  judged. The 12 ledger entry below is the registry the 12-qa session
  consumed; progress.md carries the commit-by-commit round.
- 11 QA COMPLETE (PASS-WITH-FOLLOWUPS, every finding applied or judged with
  the file open, PUSHED per R4: service 8da6c03..270e337 to
  feature/woc-market-settlement updating PR #31; game docs pushed with it).
  Eight audit lanes over 8da6c03..03df5de: 0 blocking, 44 findings; red
  proof 11/11 REPRODUCED-RED; mutation 42 run, 41 BIT, the one survivor
  (overview crossVenueGateArmed hardcode) closed by a two-venue overview arm
  and re-proven. Fix round 5 commits, tip 270e337: floors re-sized from the
  venue cadence (staleness tight end 45 min, sample minimum 60; recorded as
  an R3 amendment note), refusal readout via a NON-MUTATING poll-clock view,
  parse-time warns for mis-set oracle knobs, window depth on the recovered
  line, spot/twap mirrored onto the overview, doc truth-ups everywhere the
  audit caught the prose lagging the one-judge design. Round-2 workflow over
  the fix round: two fresh lenses (13 findings, 0 blocking, all applied or
  judged), 16 new-pin mutants ALL BIT, completeness critic; the four rework
  pins proven by compiled-dist mutation. Suite 590 to 595 (588 + 7 env-gated
  skips default; 595/595 zero skips with CLAUDIUM_TEST_DATABASE_URL). The 11
  QA ROUND bullet in the ledger below is the registry 12 consumes.
- 11 COMPLETE (SERVICE repo, LOCAL not pushed per R4; session start 8da6c03,
  tip 03df5de, 5 commits; game docs commits e2f189e9a4 (the R3 ruling record,
  BEFORE code), c5ce2793e7 (PRD claim revised) and this entry's commit,
  LOCAL). R3 RULED single-venue at session start and implemented; H3's
  shared-instance half pinned decisively under mocked timers with the
  quiet-period proof and a negative control; publish-time asOfMs on the wire
  and the honest venue surface; the fix round made the oracle the ONE judge
  of freshness per venue and the heartbeat now feeds an edge-triggered
  halted/recovered operator signal; the re-review round bounded every env
  knob in BOTH directions, capped the sample buffer, and made a paused
  refusal read the last heartbeat reading instead of polling; the cold-boot
  single-print exposure RULED record-and-document (an R3 amendment). Two
  fresh lenses (security/ops 14, correctness 21) plus a fresh re-review of
  the fix round (18), every finding applied or judged with the file open;
  the re-review's own fixes closed by careful self-review (narrow,
  test-covered, 11 mutants bit). Suite 560 to 590 (583 + 7 env-gated skips
  default; 590/590 zero skips with CLAUDIUM_TEST_DATABASE_URL). The 11
  ledger entry below is the registry the 11-qa session consumes;
  progress.md carries the commit-by-commit round.
- 10 QA COMPLETE (PASS-WITH-FOLLOWUPS, every finding applied or judged with
  the file open, PUSHED per R4: service ba7df0b..8da6c03 to
  feature/woc-market-settlement updating PR #31; game pushed at the end of
  the session, 0 behind origin/release/v0.39.0). Seven audit lanes in one
  workflow (hostile-fixture hunt: 56 shapes RUN through the real verifier,
  ZERO accepted_dishonest, the real wallet shape verified matched; security;
  correctness; coverage; docs; red-proof: all six registry claims
  REPRODUCED-RED on the 02713f2 build; mutation: 27 of 31 BIT, four real
  pin gaps closed); the refuter stage died on the session limit after 15,
  every finding judged in the main loop with the file open and primary
  sources. THE MULTISIG CALL: ba7df0b's restoration judged CORRECT with
  agave parse_token.rs (count-based labeling) and spl-token processor.rs
  (single-signer branch ignores trailing accounts) open; agave labels BOTH
  token programs 'spl-token' (parse_instruction.rs). The round's fixes:
  the chain-owned signature SHAPE screen before the first write (a junk
  string used to 500 through the RPC's -32602 and read to the game as
  service_unavailable, the abandon-ledger / anti-snipe exemption verdict),
  the payer-leg netting (treasury as buyer) gated on owesOthers plus the
  escrow-bidder refusal (the fix-round re-review caught the bond self-leg
  vacuity my first cut introduced), burn_authority_mismatch, the stray
  wallet named in the log (once per memo, clamped), the sweep
  failing/recovered warn with in-flight guard, non-positive budgets,
  attention.confirmingExpired24h on its own terminalReason read, and the
  doc truth-ups (bound measured from EXPIRY, five-under-six a two-knob
  precondition, the RPC-horizon premise re-anchored on
  MAX_REPLACEABLE_AGE_MS, vocabulary table, recovery caveat, deploy note).
  Pins closed incl. the pg EvalPlanQual race rig on BOTH sweep arms;
  21 + 11 mutants BIT over the committed rounds. Suite 536 to 560 (553 + 7
  env-gated skips default; 560/560 zero skips with
  CLAUDIUM_TEST_DATABASE_URL). The 10 ledger entry below is AMENDED IN
  PLACE with a 10 QA ROUND bullet, the registry phase 11 consumes.
- 2026-08-15 SYNC-ONLY session ahead of 10 QA (Fernando asked to stop after
  the merges): SERVICE origin/master still at df09756, already contained
  (no-op); baseline at ba7df0b re-verified (build clean; 536 tests, 530 pass,
  6 env-gated skips default; 536/536 zero skips with
  CLAUDIUM_TEST_DATABASE_URL). GAME re-synced to the NEWEST release branch,
  origin/release/v0.39.0 (v0.38.0 shipped to main via PR #3416, v0.39.0 minted
  from it; tip d2d1a8ad5c = the v0.38.0 tip + 6), merge f5df042a86, NON-trivial:
  five conflicts (hud.ts prewarm composition, generated pending.ts, the
  add/add pair tests/helpers/strip_comments.ts + .test.ts, monolith_budget),
  three ratchet reds on the union (hud re-pinned DOWN to 19120 exact, sim.ts
  to 12508 exact = release-side growth only, main.ts nine over -> the Exchange
  attach extracted to src/game/woc_market_wiring.ts in bf7aeb8a98, ceiling
  kept at the release's 11490, file 11489, three mutants bit); the release's
  Armory-prewarm removal was carried into the branch's
  preview_prewarm_wiring.ts; three.js 0.185.1 (patched) needed a fresh
  pnpm install. release-merge-audit (six lanes + a refuter per finding, 14
  findings ALL confirmed, none refuted): every overlap file a clean union,
  count pins 200/213/324 unchanged (run-confirmed), no route / world_api /
  net delta, both new db-mock sites green; two pin-prose nits applied
  (e362916958), nine doc premises corrected in this entry's commit, two i18n
  observations recorded (the 3 hudChrome.trade.woc non-Latin rows are
  pre-existing branch debt; entities.abilities.frenzied_regeneration.description
  overlays are reword-stale ON THE RELEASE, 18 locales, a maintainer follow-up
  on release/v0.39.0, not this branch). Gate GREEN at bf7aeb8a98 (gate_select,
  full-suite fallback, all 12 steps, 2850 files / 40533 tests, browser 129,
  WITH TEST_DATABASE_URL); DB-gated suites 18 files / 245 green zero skips.
  Everything LOCAL, nothing pushed (the 10 QA session pushes on PASS per R4;
  the game push then rides these sync commits).
- 10 COMPLETE (SERVICE repo, LOCAL not pushed per R4; session start 02713f2,
  tip ba7df0b, 6 commits). B4 closed red-first (three redirect shapes
  reproduced MATCHED on the old verifier); the two R5 items this file owned
  RULED by Fernando at session start and implemented (commitment split
  ratified code-owned; five hour confirming bound, both stores, sweep driver:
  expiry previously had NO production driver at all); the undecided confirm
  vocabulary split (not_yet_visible vs awaiting_finality) landed as the
  service half of the anti-snipe residual. Two fresh lenses plus a fresh
  re-review of the fix round, every finding applied or judged; the re-review
  REFUTED the fix round's multisig-impossibility rationale (count-based
  jsonParsed labeling) and the arm was restored money-safe. Suite 508 to 536
  (530 + 6 env-gated skips default; 536/536 zero skips with
  CLAUDIUM_TEST_DATABASE_URL). The 10 ledger entry below is the registry the
  10-qa session consumes; progress.md carries the commit-by-commit round.
- 09 QA COMPLETE (PASS-WITH-FOLLOWUPS, every finding applied or judged with
  the file open, PUSHED per R4: service aa44873..02713f2 to
  feature/woc-market-settlement updating PR #31; game pushed after this
  session's v0.38.0 re-sync, merge abd4a9e0e2, trivial, generated-i18n
  conflict regenerated). Nine lanes over aa44873..3346878: ZERO blocking in
  the implement range; all six red-first registry claims REPRODUCED-RED; all
  seven mutation arms BIT by name in both stores. The round's own fixes (5
  commits, tip 02713f2): entry adoption closing the registered
  paid-after-expiry edge, typed signature_already_settled on the
  settled-signature collision (both stores; was an unhandled 23505 500), the
  undecided late-visibility window, the rejected-write entry-vocabulary fix,
  the rpc probe-list membership pin, the actor intake bound, fifteen
  test-decisiveness hardenings, and the doc truth-ups. Two fresh re-review
  lenses over the fix round, everything applied or judged; round-2
  mutation-proven. Suite 493 to 508 (502 + 6 env-gated skips default;
  508/508 zero skips with CLAUDIUM_TEST_DATABASE_URL). The 09 ledger entry's
  QA ROUND bullet below is the registry phase 10 consumes.
- 09 COMPLETE (SERVICE repo, LOCAL not pushed per R4; session start aa44873,
  tip 3346878, 9 commits). B3, the bond double-pay medium, and the bond-cents
  ownership mediums closed; R2 forfeit split landed one-code-path (so the R6
  Terms publication gate's R2 dependency is now met service-side); the two R5
  items this repo owns RULED by Fernando and implemented. Five red-first
  proofs; two fresh coverage lenses plus a fresh re-review of the fix rounds,
  every finding applied or judged with the file open. Suite 445 to 493 tests
  (488 + 5 env-gated skips default; 493/493 with CLAUDIUM_TEST_DATABASE_URL).
  The 09 ledger entry below is the registry the 09-qa session consumes;
  progress.md carries the commit-by-commit round. LOUD cross-repo handoff for
  12 inside the ledger entry: the game must adopt the bond-quote contract
  BEFORE the service ever deploys ahead of it, or bond quoting refuses.
- 08 QA COMPLETE (PASS-WITH-FOLLOWUPS, every fix applied, PUSHED per R4:
  service aa44873 to feature/woc-market-settlement, game to
  feature/woc-marketplace after this session's v0.38.0 re-sync). The fix
  round was re-reviewed FRESH (0 blocking, 7 should-fix, 8 nits, ALL
  applied in a fourth commit, mutation-proven where the re-review proved a
  pin gameable). Six fresh
  lanes + a dedicated red-proof lane over 70d4207..4b9e413: 0 blocking, all
  four red-first claims REPRODUCED-RED on a throwaway 70d4207 build. The
  round's own finds, all applied (8 should-fix + 13 nits): the railless
  durable-store gate was still denylist-shaped (DATABASE_URL now required
  unless NODE_ENV affirms dev or test), partial-Stripe strictness outside
  dev/test, both claudium escape flags trimmed, raw-first ASCII on BOTH
  secrets (a Unicode-whitespace-only admin secret used to read as unset
  silently), admin-tier trim/refusal pins, usdc percent pin, NEW
  compose_conformance.test.ts (staleness = oracle constant, NODE_ENV
  production, the deliberate CLAUDIUM_QUOTE_TTL_MS divergence documented),
  the in-memory seam's unreachability pin through the real buildEconomyApps
  call site, and the doc truth-up sweep. 12 mutations bit; suite 445/441/0/4.
  The 08 ledger's QA ROUND bullet below is the registry 09 consumes.
- GAME side this session: release/v0.38.0 re-synced (merge bfceae8d4b,
  NON-trivial, 33 conflicts; pins re-derived IWorld 324 = 86 + 238, sends
  200, dispatches 213; wireAura moved byte-identical to
  snapshot_timer_wire.ts to pay the merged game.ts overage). The
  release-merge-audit found THREE union-only reds (trade_money_shot.mjs
  restored; server_sim_facade fileURLToPath; woc-market joined the CI sparse
  cones) plus pin-quality repairs, all landed. Real-SQL suites 154 green
  zero skips; gate GREEN at ad197c0801 (full-suite fallback, all 12 steps:
  the gate grew four manifest steps since the "all 8" era, 39724 vitest +
  129 browser, WITH TEST_DATABASE_URL).
- 07 QA COMPLETE (PASS-WITH-FOLLOWUPS, every fix applied, PUSHED per R4).
  Release/v0.38.0 re-synced (merge 55c2ba992e, trivial: two CI-harness
  commits, no marketplace overlap, no count-pin surface; tsc clean and
  the four pin suites 377 green on the merged tree). Eight fresh audit
  lanes over the package; the unreviewed proofreader-fix round verified
  clean site by site. The round's own finds, all applied: the draft was
  missing three shipped mechanics (the seller opt-in second-chance
  offer, the one blocking find: it falsified "your bond is returned
  when you are outbid"; the anti-snipe extension; the buy-now abandon
  cooldown pair) plus wording drifts (10.4 cancel boundaries, bid
  withdrawal, bound items; 10.6 pause honesty; 10.7 rounding and wallet
  identity; the Section 9 bond-custody carve-out) and companion
  truth-ups (marketplace.md's third TOTP site and suspension scope and
  phantom store-catalog claim, wallet-link's server-vs-service-built,
  README's "sells no items", the p2p cap-knob anchor, the src/ui
  CLAUDE.md Exchange-checkbox honesty). New deferreds with owners in
  the amended 07 ledger entry (QA ROUND bullet). The amended draft
  postdates the recorded R6 send: Fernando forwards the AMENDED draft.
- 07 COMPLETE (docs only, zero code diff, LOCAL, not pushed per R4).
  Release/v0.38.0 synced (merge 8a1739d67a, trivial, no marketplace
  overlap; monolith_budget AUTO-MERGED, all four count-pin suites
  re-derived green from a run, 377 tests, renderer ceiling 13708 is the
  release's own extraction). The counsel package is READY and R6 is
  recorded sent-to-counsel 2026-08-13 (see Rulings). Deliverables:
  TERMS_AND_CONDITIONS_MARKETPLACE_DRAFT.md (beside the untouched live
  Terms) + the decision memo (held PRIVATELY outside the public repo, see
  Locked decisions) + the carve-out reconciliation + the staleness cluster
  fixes. A FRESH proofreader swept the package
  (1 blocking + 7 should-fix + 6 nits, ALL applied). The 07 ledger entry
  below carries the findings registry (the seller-side terms gap, the
  terms.html drift, the R2 forfeit-split publication gate, the locale
  README fills); the 07 QA session consumes it.
- 06 QA COMPLETE (PASS-WITH-FOLLOWUPS, every fix applied, PUSHED per R4).
  Release/v0.38.0 re-synced (merge ab2742012b, NON-trivial: three test
  conflicts plus two SILENT count-pin auto-merges, all re-derived from
  suite runs: IWorld 323 = 86 data + 237 methods, fanout exemptions 10,
  hud.ts ceiling DOWN to 19160, sim.ts 12436; release-merge-audit ran,
  faithful, zero findings across seven overlap groups). ea1bb82322
  verified FIRST (comment-only src hunk; every pin bit under mutation).
  Six fresh audit lanes found ZERO code blockers in the implement round;
  the QA round's own finds: the capacity model's fungible-first drift
  (receiver overflow, fixed by making fitsAfterSwap run the removal walk
  itself), the instanced matcher's missing crafted-marker leg, the
  missing guardTerms on the directed buyer (strike parity), and four
  blocking TEST gaps, all closed. ONE NEW OPEN RULING for Fernando (R9,
  in Rulings): the trade arm records implied terms consent. The 06
  ledger entry below is AMENDED IN PLACE; the 07 session consumes the
  amended entry and should glance at the final tests-only commit
  47399f77b7 first (34 lines, implements the qa gate's prescriptions).
- 06 implemented AND reviewed (LOCAL, not pushed per R4): H10, H12, H14,
  createDirectedOffer guardBalance, and the directed non-payment
  auto-close closed; BOTH opening judgments settled ((a) unwind made
  provable by the atomic listing stamp + the convergedOffers sweep arm;
  (b) NO boundTo stamping, the rationale truthed-up at
  exchange_eligibility.ts). A db-perf PRE-implementation checkpoint
  (BLOCK, A1-A8) reshaped the design before code; the pg suite ran RED
  first for all seven target behaviors; FOUR fresh reviewers plus a
  fix-round re-review plus qa-checklist ran, every finding applied
  including nits (the security round's CRITICAL: the trade session
  stripped staged slots to id+count, so the H10 pin's client source
  could not carry an instance payload; trade staging now previews
  per-copy identity through the swap's own selection walk). After the
  first gate pass, SIX closing rounds ran (two independent fresh
  reviews of the gate-round commit, every fix round re-reviewed fresh;
  the CLOSING ROUNDS bullet in the 06 ledger has the substance). Gate
  GREEN three times: 5287214294, 5ebb176a73 (all production code), and
  the final tip ea1bb82322 (each full-suite fallback, all 8 steps, run
  WITH TEST_DATABASE_URL so every pg suite executed). The 06 ledger
  entry below is the registry later sessions need; the phase-06-qa
  session consumes it, and should verify the final tests-only commit
  ea1bb82322 FIRST (it implements the last reviewer's prescriptions
  and is the one round without a fresh review of its own).
- 05 QA COMPLETE (PASS-WITH-FOLLOWUPS, every fix applied, PUSHED per R4).
  Release/v0.38.0 synced (merge b9e937c075, trivial: seven commits, no
  marketplace overlap, no count-pin surface). All four owed re-judgments
  UPHELD with their justifications repaired (the numbers, the
  quarantine-kick posture, 57014-stays-500, the carve-out, now owned by 16
  and sequenced after the honest occupancy bound). Five audit lanes plus a
  fresh fix-round re-review and qa-checklist; the QA round found and fixed
  one CRITICAL (TxNeverStarted stopped at the pool checkout: a stale
  socket failing at BEGIN still quarantine-kicked the seller) and one
  critical-class evidence destroyer (withTx's null asyncErr deref replaced
  every codeless failure with a TypeError), plus the kick-argument swap
  that sent untranslated jargon on the wire. The 05 ledger below is
  AMENDED IN PLACE for the changed seams; phase 06 consumes the amended
  entry and OPENS with two directed-rail judgments (the three-legged THROW
  residual; whether directed delivery should stamp boundTo). Full round in
  progress.md.
- 05 implemented AND reviewed: H5, H6, the coordinator-drift medium
  (broker custody extraction + the firewall tighten) closed; ledger entry
  below. A database-performance PRE-implementation checkpoint (BLOCK, five
  amendments) reshaped the design before any code; the three-reviewer
  round found three critical defects in the fix (the EPIPE rollback-proof
  hole, the ownership-order IDOR, the inverted restore-mail premise) plus
  two blocking test gaps, every finding applied and re-reviewed fresh.
- 04 QA COMPLETE (PASS-WITH-FOLLOWUPS, every fix applied, PUSHED per R4;
  gate GREEN at the final tip 8c1028e89d, full-suite fallback, all 8
  steps).
  Release/v0.37.0 synced (merge a43a1e8b52; the parity/command count-pin
  merge trap fired for real, pins re-derived from runs: IWorld 322/85/237,
  sends 199, dispatches 212; hud.ts ceiling 19177 after the
  crafting_deny_core extraction; game.ts ceiling 10859). The 04 ledger
  below is AMENDED IN PLACE for the QA round's changed seams (the reviewed
  sweep arm + confirmingOverdueSettlements split, the advisory-pass
  cooldowns, GUARD_IDLE = ESCROW_LOCK_TIMEOUT_MS, the signature shape
  check, the 720h confirming-hours clamp, the stuckBonds sample order, the
  lapse-straddle refresh guard, the poll-race standing answer, review in
  the settlement outcome arm); phase 05 consumes the amended entry.
  progress.md carries the full round (five lanes, deep mutation pass incl.
  one real hole closed, residuals with owners).
- Packet created 2026-08-11 from `review.md` (the 2026-08-11 three-repo review).
- 04 implemented AND reviewed (LOCAL, not pushed per R4): H4, H15, the
  anti-snipe medium, R8 both arms, and the 02 clearBuyNowLock handoff;
  ledger entry below. Six reviewer lanes ran (privacy-security,
  database-performance, test-coverage each TWICE; qa-checklist READY;
  migration-safety no critical/warning), every finding applied or owned
  across THREE fix rounds; 17 mutation spot-proofs bit; gate GREEN at
  0afdaa71a5 (full-suite fallback). A dedicated VERIFICATION session then
  re-ran the phase over the committed tree (fresh deliverables and
  test-coverage audit lanes, all three pg suites re-run green, three
  committed-round mutations re-bitten) and applied its findings as a
  further fix round: the route-level cancelPending wire pin (the one
  unpinned hop), typed confirm_in_flight on second/different signatures
  (both legs), the idempotent confirming-settlement retry, the lapseBid
  held-bond carve-out, the first-arrival extension anchor (kills the
  re-post creep), the cancelListingIfUnbid idle bound, the stuckBonds
  signature age axis, comment-stripped window pins via the extracted
  tests/helpers/strip_comments.ts, tunable literal pins (park delay and the
  anti-snipe trio), and the ledger corrections recorded in place. The fix
  round was re-reviewed fresh, which drove a second pass:
  outcome-answering retries of already-succeeded signatures on both legs,
  the leg-neutral confirm_in_flight copy (five fills refreshed), the
  held-survivor poll park, the split extension anchors (ruling recorded),
  the stuckSinceMs sample field, and the derived paid-subset pin
  (progress.md carries both rounds). Gate GREEN TWICE more (full-suite
  fallback, all 8 steps) at c7176d730b and at the final code tip
  6642c6e15b; eleven mutation proofs bit across the session. The H15 escape hatch that gated enable
  exists (the 'review' state). Items the DEDICATED phase-04-qa session still
  owns: re-judge the cooldown NUMBERS, the cancel-intent bid-block
  interpretation, the confirm_in_flight second-signature semantics, the
  stuckBonds axis change, and the confirming-hours no-upper-clamp posture
  (recorded in progress.md), and the R4 push. Deferred to
  phase 14 with owners: the anti-snipe deadline player-copy consequence, the
  cancel-intent client marker, the claim_cooldown remaining-time copy, and
  the after-close no-extension behavior note.
- 01 implemented AND QA'd (PASS-WITH-FOLLOWUPS, fixes applied, PUSHED).
- 02 implemented AND QA'd (PASS-WITH-FOLLOWUPS, every fix applied, PUSHED at
  the QA tip; gate GREEN at 301a8c7c22); see the ledger below and progress.md
  for the QA round, the reasoned resolutions, and the phase 03/04 handoffs.
- 03 implemented AND QA'd (PASS-WITH-FOLLOWUPS, every fix applied, PUSHED per
  R4). The AC3 park deviation is UPHELD (no integrity hole; Fernando can
  overrule, rationale in progress.md). The QA round's blocking finds (park
  rotation blinding the monitor; the unbounded redrive beat) are fixed; the
  03 ledger entry below was AMENDED IN PLACE for the changed seams (rotation
  column + exclusion, readout shape with asOfMs/saturated/updatedAtMs,
  per-entry contention scope, finalize re-lock + already_final, typed
  activateBid contention, ambiguous grantCopy refusal). Phase 04 consumes
  the amended entry, not the original.

## 21 devnet dry-run evidence

Cluster: Solana devnet (https://api.devnet.solana.com, single-RPC by
necessity: the Ankr fallback needs its own key). Mint: NOT YET CREATED
(fresh throwaway per R5, decimals 6; blocked on devnet SOL). Wallet roster
(pubkeys; keys only in gitignored service-worktree files, see devnet.md):
mint authority + fee payer HyD4RyRkeHF4EDzdWP1rMo7geNJbvsKb6umo45rzpE3C,
escrow 2XH5UwqWCCRKLWeCKbHdV6VNsx1nVsrXAydAHkQmUZvr, treasury
9fzukogxcT5c113MA7gNSeP1UMsc3eH27BXbBihWaUqf, buyer
DiuB5C4mgoHf8nhBdcFWe2hCxu65mZVpssG2yUE9iN1z, seller
Gpg44TKrWnkcVDtqoEwwwbjXB1MjxJ3naoTpZ1zpJz2a.

| Leg | Status | Signatures / notes |
|---|---|---|
| Environment: keypairs, run env, service DB, setup script | STAGED 2026-08-20 | no signatures yet; devnet.md is the recipe and resume runbook |
| Service price-source enablement (the two R5 code halves + two review fix rounds) | DONE 2026-08-20 | service commits 7284fbe (WOC_MARKET_PRICE_MINT) + 2eedcfb (dev price over the real chain) + 6c1b01f (confinement, allowlist gate, decode screens, warns, compose walls) + 8db7734 (mirror confinement, constructed-market warns, wall pins); suite 603/596/0 at the tip; 10 distinct mutants BIT, 10 stale-verdict re-runs re-BIT (20 log, 21 sections) |
| Bond cycle: quote, charge, confirm, refund, forfeit | BLOCKED (devnet SOL) | double-release balance asserts + probe-not-resend observation ride this leg |
| Settlement e2e: list, directed + public buy-now, pay, burn verify, deliver, fee split | BLOCKED (devnet SOL) | needs the dev realm against the staged service |
| Hostile burn-redirect rejection | BLOCKED (devnet SOL) | must record the 10 verifier reason |
| Observation: escrow gate + auth-guard cache under real contention; 16 lost-lock anti-phase | BLOCKED (rides the e2e leg) | carried from 16/17 and the riders |
| Observation: real venue cadence + halt/recovered lines (11) | NOT OBSERVABLE THIS RUN | no Birdeye key on this machine (R5 amendment records it); a keyed future run uses WOC_MARKET_PRICE_MINT |

Blocker record 2026-08-20: the public devnet faucet answered 429 all
session and Fernando could not fund manually that day; no Birdeye key was
available either (both asked and answered in-session, see the R5 records).
The phase stays OPEN; the resume runbook is devnet.md's bottom section.

## Repos and branches

| Repo | Worktree | Branch | Tip at packet creation |
|---|---|---|---|
| game | `/Users/fernando/Documents/wocc-marketplace` | `feature/woc-marketplace` | `a52da32c89` (merge of release/v0.37.0 at packet creation; the base moves at every session start, see Locked decisions) |
| service | `/Users/fernando/Documents/woc-rewards-service-pr31` | `integration/woc-market-settlement` | `70d4207` (= PR #31 tip) |
| dashboard | `/Users/fernando/Documents/woc-rewards-dashboard-pr13` | `integration/woc-market-trading` | `c001d4a` (= PR #13 tip) |

Pushes: game pushes fast-forward `origin/feature/woc-marketplace`; service pushes go to
`origin/feature/woc-market-settlement` (updates PR #31); dashboard pushes go to
`origin/feature/woc-market-trading-controls` (updates PR #13). Cadence per resolved R4:
QA sessions push on PASS; implement sessions never push (commands in
implementation-plan.md).

## Validation matrix

- Game, any code change: `npx tsc --noEmit` + the targeted `npx vitest run <files>` +
  `npm run ci:changed`.
- Game, `src/sim/` change: add `npx vitest run tests/architecture.test.ts`.
- Game, player-text or emit change: add `npx vitest run tests/localization_fixes.test.ts`
  (S3 guard; needs `npm run i18n:gen` first if i18n.status.json is missing; it is
  untracked and worktree-local).
- Game, wire/protocol change: add `npx vitest run tests/snapshots.test.ts tests/env_protocol.test.ts tests/bandwidth.test.ts`.
- Game, DDL change: boot the dev DB (`npm run db:up`) and run the marketplace real-SQL
  suites. Since 02 that concretely means
  `TEST_DATABASE_URL=postgres://eastbrook:<pw>@127.0.0.1:5433/eastbrook npx vitest run tests/woc_market_settlement_pg_integration.test.ts`
  (the suite creates and drops its own disposable database; without the env var it
  SKIPS green, so a green default-tier run is not evidence it ran). Since the
  auth-guard rider the marketplace battery is EIGHT suites: settlement, bond,
  delivery, directed, plan_pins, stepup, realm_scope, and authguard
  (`tests/woc_market_authguard_pg_integration.test.ts`), each on its own
  disposable database name so lanes can run different suites concurrently
  (never the SAME suite in two processes at once).
- Game, monolith-listed file: `npx vitest run tests/monolith_budget.test.ts`.
- Game, pre-merge / end of phase: commit first, then `node scripts/gate_select.mjs`
  (gate needs a committed tree; it stops at the FIRST failure, run later steps by hand if
  a known red is being carried).
- Service (in `service/`): `npm run build` then `npm test`.
- Dashboard: `npm test`, `npm run check`, `npm run build`.

## Real-SQL predicate inventory (20)

Classification rule: a money/security predicate counts as REAL-SQL PINNED when
deleting it turns a Postgres-suite test red, proven mutant by mutant in
`docs/woc-marketplace-hardening/phase-20-mutation-log.md` (248 distinct mutants,
240 red-on-strip, green-on-restore; the 20 QA round's appendix adds 45 more:
43 red-on-strip, one judged single with its double-strip proof, and one
deliberate green fixture-derivation control). After this round ZERO fake-only or
untested money/security predicates remain in `server/woc_market_db.ts` or its
SQL-bearing siblings (`server/woc_market_sweep.ts`; `server/woc_market.ts`
carries no SQL). The only mutation survivors are the judged
defense-in-depth singles below, each PROVEN by a double-strip mutant that bit,
plus the harness's deliberate comment-only control.

Scope boundary, stated once: service-layer TypeScript guards in
`server/woc_market.ts` (guardTerms, guardBalance, guardSuspended, the
self_offer arms, step-up call sites, strike fairness gates) execute the same
code over the fake and the real store, so a fake-backed service test IS a real
pin of the guard; the fake can only lie about SQL, which is what the pg suites
now pin. The two service guards found untested anywhere (settlementQuote
not_yours and quote_expired, the latter at its inclusive boundary) gained
tests this round, and both now carry log rows (qa20_svcquote_not_yours,
quote_expired_boundary), as does the deadline-before-revival order
(qa20_quote_revival_order against the failed-row arm).

Coverage by domain (predicate family, owning pg suite):

- Listing lifecycle: escrow atomicity, the fenced save, the accounts-lock cap
  count (closed-blind, directed-inclusive, boundary), the directed stamp CAS
  and its rollback, browse liveness and the directed-exclusion qual, the seller
  cancel ladder (not_yours/not_active/has_bids/paid-window/one-shot intent
  stamp/failed-expiry/open probe with rollback), suspend arms (closed, lock
  window, quoted-offered, won-only release, teardown carve-out, held-to-refund),
  terminal writes (close/settle/reopen never resurrect or relabel), claim-due
  status and due bounds, stranded age bound, dispose/return residue arms:
  `tests/woc_market_settlement_pg_integration.test.ts`,
  `tests/woc_market_delivery_pg_integration.test.ts`,
  `tests/woc_market_directed_pg_integration.test.ts`.
- Bids and bonds: the intake refusal ladder (self-buy account arm, seller
  wallet twin, directed not_found, inactive and lapsed close inclusive at the
  bound, cancel intent, bid floor inclusive, already_pending per listing and
  account and status), signature-first intake (pending-only, different-sig
  refusal, first-recording anchor, cross-bid reuse typed by the partial unique
  index), bond quote and abandon immovability on a signed bond, lapse guards
  (TTL gate, signed spare, held spare), the activation ladder (not_pending,
  closed and ended, tie superseded inclusive, active-only prior demotion, won
  prior untouched, supersede refund routing), bondsDue states, poll signed-only
  and rotation exclusion: `tests/woc_market_bond_pg_integration.test.ts`,
  `tests/woc_market_settlement_pg_integration.test.ts` (CAS floor, cascade,
  payout races).
- Settlements: the one-open-settlement partial unique index (insert, race,
  revival refusal, schema swap), insertSettlement's winner CAS and closed
  refusal pair, quote and signature offered-only CAS, tx_signature uniqueness
  answered typed, transitionSettlement from-set CAS and its 23505 arm, the
  overdue default-arm state set and deadline, the confirming review bound
  (inclusive), deliverable claim CAS, delivered-page state qual, finalize (the
  delivering/delivered CAS, once-per-listing sale index, close CAS with
  resolution kept, winner bond held-only flip, teardown carve-out):
  `tests/woc_market_settlement_pg_integration.test.ts`,
  `tests/woc_market_delivery_pg_integration.test.ts`,
  `tests/woc_market_bond_pg_integration.test.ts`.
- Custody exactly-once: claimCustodyRef's ON CONFLICT mutex, the one-way
  booked_at flip, intent writes refusing a booked claim, the mail-intent grant
  withdrawal, saveDeliveredCharacterBooked's lease fence and claim_missing CAS
  in one transaction, the crash-point matrix, booked-claims retention referent
  guards: `tests/woc_market_delivery_pg_integration.test.ts`.
- Buy-now claim: the diagnosis ladder (own account, not_active, no_buy_now,
  cancel_pending, lock expiry), the open-settlement refusal pair, the
  wallet-twin pair (locked re-check + the claiming UPDATE's NOT EXISTS), the
  steal recorder and its directed exemption, the exempt window (signature,
  reason set, per-buyer, per-window, dedupe), both cooldown probes (per-listing
  scope and window, account-scoped hourly cap and window, later-moment-wins),
  the directed cooldown exemptions on both passes, the holder-guarded clear:
  `tests/woc_market_bond_pg_integration.test.ts`,
  `tests/woc_market_directed_pg_integration.test.ts`.
- Directed offers: pair-pending index and both 23505 belts, the boot repair's
  realm-joined dedupe, resolve/accept-side pending CAS, reopen's three guards,
  converge window bounds and prune-fallout guard, expiry sweep's SKIP LOCKED
  and status quals, the ever-settled strike gate, strikes (increment,
  suspension never shortens, per-account clear), terms recorded once:
  `tests/woc_market_directed_pg_integration.test.ts`.
- Step-up: single-use consume (account, realm, race), expiry answered by the
  verifier, prune realm and boundary, nonce PK, operation CHECK, FK cascade:
  `tests/woc_market_stepup_pg_integration.test.ts`.
- Realm scoping, cross-cutting: every store statement's `realm` qual proven
  against a symmetric realm pair (reads return only the realm's rows, writes
  move only the realm's rows, the cap and cooldown ledgers count only the
  realm's evidence, character resolution and delivery targets stay inside the
  realm and the account): `tests/woc_market_realm_scope_pg_integration.test.ts`
  (new this round; per-test realm pairs so every count is exact and -t safe).
- Schema constraints: every money-state CHECK's negative arm (listing
  status/format/resolution, bid status/bond_state, settlement state, offer
  status, the jsonb object checks), bond_reference uniqueness, plus the
  existing index-shape and boot-repair pins:
  `tests/woc_market_settlement_pg_integration.test.ts`,
  `tests/woc_market_bond_pg_integration.test.ts`.
- Account scoping and participant privacy (added by the 20 QA round, which
  re-derived the inventory and found these quals separable only by realm):
  directedOffersForAccount's participant qual, bidsByAccount's and
  settlementsByAccount's account quals, directedOffersForBuyer's addressee
  and liveness quals (each now separated by same-realm stranger fixtures),
  the resolve and accept-side pending CAS, the ever-settled strike gate's
  listing qual, the auction extension's active guard, the lapse sweep's
  inner status qual (an aged resolved refund-due bid survives the sweep),
  the anti-enumeration verdict order on a cancel-stamped directed sale, the
  twin-steal-records-nothing transaction order, the confirming-poll status
  member, the claimDue inclusive bound, the residue dispose's
  already-disposed negative, the step-up DDL trio (nonce PK, operation
  CHECK, FK cascade), the listing resolution and bid status CHECK
  negatives, the bond signature unique index, the insert-side pair 23505
  belt, the sweep advisory lock's realm dimension, the four retention
  prunes' money quals (incl. the abandon prune's age cutoff, floor-pinned
  by the QA round), and the real readout cap clamp:
  `tests/woc_market_realm_scope_pg_integration.test.ts`,
  `tests/woc_market_bond_pg_integration.test.ts`,
  `tests/woc_market_directed_pg_integration.test.ts`,
  `tests/woc_market_settlement_pg_integration.test.ts`,
  `tests/woc_market_delivery_pg_integration.test.ts`,
  `tests/woc_market_stepup_pg_integration.test.ts`,
  `tests/server/woc_market_directed_sql.test.ts`,
  `tests/woc_market_sweep.test.ts`, `tests/server/woc_market_service.test.ts`,
  `tests/woc_market_rules.test.ts` (the exempt-list composition pin).
- Lock shapes and EPQ belts that no deterministic live race can reach are
  pinned at the always-run DB-free floor through the REAL methods on recording
  pools (`tests/server/woc_market_directed_sql.test.ts`): the finalize
  pre-lock's winner arm, the activation open-set pre-lock order (new), the
  suspend pre-lock's won member (new), the offer expiry sweep's outer
  EvalPlanQual qual, plan-class regressions in
  `tests/woc_market_plan_pins_pg_integration.test.ts`.

Judged defense-in-depth singles (each single strip is behaviorally invisible
behind its live twin; the DOUBLE strip named beside it bit, so the pair is
load-bearing and pinned):

| single survivor | twin that masks it | double-strip proof |
|---|---|---|
| claimBuyNowLock locked re-read realm qual | the lock-free peek's realm qual (pinned alone) | realm_2869_2914_combined BIT |
| claimBuyNowLock open-settlement transaction arm | the advisory arm (now pinned alone: the floor's lock-free refusal test) | claim_open_settlement_double BIT |
| claimBuyNowLock wallet-twin locked TS re-check | the claiming UPDATE's NOT EXISTS | claim_wallet_twin_double_strip BIT |
| claimBuyNowLock wallet-twin NOT EXISTS | the locked TS re-check | claim_wallet_twin_double_strip BIT |
| claimBuyNowLock zero-rows own_listing verdict | both twin guards above | claim_zero_rows_double BIT |
| insertSettlement INSERT..SELECT status belt | the FOR UPDATE closed check (pinned alone) | insertSettlement_closed_double_strip BIT |
| reopenDirectedOffer NOT EXISTS pair guard | the pair index's named 23505 belt | reopen_notexists_plus_catch BIT |
| expireDueDirectedOffers inner status qual | the outer EvalPlanQual status qual (floor-pinned) | qa20_expireDue_status_double_strip BIT |

Deliberate non-goals, unchanged: pure ORDER BY and LIMIT bounds that select
display order or batch size without gating money (the rotation orders and the
readout saturation caps ARE pinned), column projections, and the `40P01` arm
of the contention mapping (deadlock-victim runs are nondeterministic; the
mock-pool partition test owns it).

## Rulings

Resolved (Fernando, 2026-08-11):

- R1 (phase 13, B6): RESOLVED: wallet-signature step-up on custody-moving ops; delete
  the phantom TOTP scaffolding. THRESHOLD SUB-POINT RESOLVED (Fernando, 2026-08-16,
  proposed and confirmed at the 13 session start): step-up on EVERY custody-moving
  call, NO threshold env knob at all. Grounds: a low-value carve-out is exactly the
  B6 attack surface (floor-priced listings to a confederate), and no knob means no
  misconfiguration surface, which satisfies the unset-means-more-protection
  constraint by construction.
- R10 (phase 13, the item-lock question parked by the 04 QA round; resolved Fernando,
  2026-08-16, proposed and confirmed at the 13 session start): a LOCKED item copy
  (player item lock, issue 3042) REFUSES $WOC exchange listing with a typed refusal
  and honest copy; the seller unlocks first, matching the salvage/craft/vendor
  posture. Scoped to the $WOC surface this packet owns. Deferred with owners: the
  gold-market listing path keeps its current allow posture (a follow-up outside the
  packet, noted for the 22 close-out audit alongside the R7 queue), and the
  buyer-inherits-mark hygiene issue (a copy sold on the gold market still arrives
  wearing the seller's lock flag) rides the same follow-up.
- R2 (phase 09): RESOLVED: forfeited bonds follow the PRD treasury + burn split, one
  code path with the settlement fee split.
- R3 (phase 11, H3, resolved Fernando 2026-08-16, proposed and confirmed at the
  11 session start): SINGLE-VENUE posture, honestly stated. Grounds: no
  independent $WOC price discovery exists (every configurable venue is a lens on
  the same on-chain DEX pools); the only configurable-today second source,
  Jupiter's price API, publishes NO print time (the existing adapter stamps
  poll time, which under the oracle's newest-publish staleness key would make
  the whole oracle permanently un-stale with Birdeye frozen), and Birdeye's
  measured ~25-minute print cadence against a near-live second print would
  halt trading as venue_deviation on every 5% move between prints. Ruled:
  - Remove the dead Pyth venue path (pythSource) and its
    WOC_MARKET_PYTH_WOC_FEED_ID knob from bootstrap, compose, .env.example
    and docs; the oracle stays N-venue capable (median/deviation logic and
    tests kept; the cross-venue gate re-arms by itself when a second REAL
    source is ever constructed) but the inert WOC_MARKET_MAX_VENUE_DEVIATION_BPS
    env knob is retired (code default 500 bps stays; a knob for a gate that
    cannot arm is a false affordance; it returns with any future second venue
    and is re-judged against that venue's real behaviour then).
  - Staleness stays 3600000 ms (one hour): measured, not tightened; two
    tighter values halted the market on real prints (a 38-minute print is on
    record) and compose, oracle and source share the constant by design. The
    compensation is honesty: asOfMs becomes the newest venue PUBLISH time on
    the wire (the player's "as of" shows the print time, not the poll), and
    the ops surface reports per-venue age, configured and live venue counts,
    whether the cross-venue gate is armed, and the distinct-print count
    behind the TWAP.
  - Spot-vs-TWAP deviation TIGHTENS 1000 -> 500 bps (code constant; compose
    and .env.example stay blank so the constant rules): the sole automatic
    circuit breaker under one venue, the same disagreement bound the design
    already accepted between two venues, halving the walk a manipulator can
    push through per 15-minute window (about 18% -> 9.5% by the TWAP
    arithmetic); a legitimate 5%+ jump between prints halts until the TWAP
    converges, self-clearing within one window.
  - The PRD claim (docs/prd/woc/marketplace.md, "multiple approved liquidity
    sources, maximum source-deviation limits") is revised to the single-venue
    truth in this session's game-side docs commit (07 did not take it).
  - Observation for 22, not this phase: the real manipulation cost is set by
    WOC_MARKET_MIN_LIQUIDITY_USD against WOC_MARKET_MAX_USD_CENTS; no oracle
    bound fixes that ratio.
  AMENDED by the 11 review round (2026-08-16, the two fresh lenses plus the
  fresh re-review of the fix round; Fernando ruled the cold-boot item at the
  same session):
  - The walk arithmetic above assumed a continuous republisher AND that the
    gate caps the move; neither holds. The breaker is a HOLD-TIME cost: an
    out-of-bound print halts trading but is still recorded (deliberately, or
    a legitimate move would halt forever), so the average absorbs it and the
    halt clears within one window (about 2.5 minutes for a 6% step, 7 for
    10%, 13 for 50%); a manipulator must hold the moved price through the
    halt and the settlement that follows, against arbitrage. What the 1000 ->
    500 tightening buys is that moves between 5% and 10%, which used to pass
    silently, now cost a multi-minute halt. At the deployed cadence (Birdeye
    republishes $WOC on the order of tens of minutes against a fifteen-minute
    window) the window holds ONE distinct print for most of every cycle and
    the comparison is print-to-print. The tightening stands; the stated model
    is corrected in the code, the docs and here.
  - The env parser also caps the TIGHTENING direction (ORACLE_BOUND_RANGES:
    window up to an hour and never past the staleness ceiling, samples up to
    90, staleness down to the default window, spot down to 100 bps; decimal
    integers only), because an absurd tightening is a permanent halt
    indistinguishable from a broken venue.
  - "compose, oracle and source share the constant" is no longer the design:
    the ORACLE is the one judge of freshness, per venue (the market's Birdeye
    source hands up every print it can parse, VENUE_AGE_SCREEN_OFF_MS), so an
    over-age print is refused as stale WITH its print time instead of dying
    at the source as no_price with nothing to show (stale was unreachable in
    production under two equal ceilings). A stale print never enters the
    median; a stalled sibling can never ride a fresh one; a future print
    beyond the skew allowance or an unparseable publish time counts as no
    print.
  - Every oracle env knob may only TIGHTEN its code default (window longer,
    samples more, staleness shorter, spot narrower); a widening value falls
    back to the default. The effective bounds ride the health surface.
  - COLD BOOT, ruled by Fernando (2026-08-16): a freshly booted oracle holds
    one print with no predecessor to compare against, so for the first
    venue republish after a deploy the breaker reads zero and a print moved
    BEFORE the deploy is accepted as-is (pre-existing; made visible by
    distinctPrints). Ruled: RECORD AND DOCUMENT, NO GATE. A distinct-print
    gate would recreate the permanent-halt incident (steady state holds one
    print too) and a one-republish warm-up would halt the market for tens of
    minutes after every deploy. Runbook consequence (22): do not deploy or
    restart the service while a high-value settlement window is live without
    pausing the market first. The proper fix is a named follow-up: a durable
    last-accepted-print anchor that survives restarts, age-bounded so a long
    outage cannot halt the market forever (needs its own ruling; a candidate
    for a numbered phase per R7 or for 17's DB work).
  AMENDED by the 11 QA round (2026-08-16, the eight-lane audit and its fix
  round; principle unchanged, values re-sized): the tightening floors the
  review round chose were sized to the window alone, and the audit showed a
  LEGAL tightening could halt the market for the tail of every republish
  cycle (staleness floor 15 min at a 25-to-38-minute cadence), reset the
  breaker at any thirty-minute gap, or park a quiet realm on a permanent
  insufficient_samples (sample floor 90 at the 10 s heartbeat's real-world
  lateness). The floors are now sized from the venue cadence: staleness down
  to 45 minutes (three windows; the observed 38-minute print stays fresh and
  ceiling plus window keeps the breaker-reset gap at an hour), samples up to
  60 (two thirds of the window's heartbeat capacity). Every knob whose
  effective value differs from what the environment asked for is named in a
  boot warn line. The refusal arms report the poll-clock window through a
  non-mutating view, and the recovered operator line carries the window
  depth it reopened on, so a breaker reset is visible in the log.
- R4 (all phases): RESOLVED: push after each QA PASS (or PASS-WITH-FOLLOWUPS with fixes
  applied), repos the pair touched; implement sessions never push; FAIL pushes nothing.
  Exact push commands live in implementation-plan.md commit rules.
- R8 (phases 04/06, resolved Fernando 2026-08-12): the public buy-now
  claim-then-abandon loop gets BOTH arms, no strikes:
  - Cooldown: after an account abandons (or times out) a public buy-now lock,
    it cannot re-claim THAT listing for a cooldown, plus a small account-wide
    abandons-per-hour cap that triggers a broader claim cooldown. The phase
    proposes the numbers; QA re-judges them. Public abandons still carry no
    strike (strikes stay reserved for real payment defaults; directed-sale
    abandons keep their existing strike).
  - Cancel-intent: a seller's cancel on a LOCKED listing marks it
    cancel-pending instead of refusing: no NEW lock claims from that moment,
    the current holder keeps their full window, and an unpaid expiry closes
    the listing cancelled (return flight home) instead of relisting. Bounds
    the seller's worst-case cancel denial at exactly one lock window. Compose
    with the 02 liveness guards (a PAID window proceeds to settlement as
    usual; cancel-pending must never tear a live settlement) and the 02
    handoff that clearBuyNowLock carries no holder guard.

Resolved at the close-out prep ruling gate (Fernando, 2026-08-20, delegated
in-session: "do whatever is absolutely best for the feature and project";
the session's recommendations were presented first and adopted as proposed,
recorded here as his rulings):

- R12 (the Not-now lock release question, parked by the 14 QA round):
  DOCUMENT ONLY. "Not now" keeps the buy-now lock running until the 270s
  TTL lapses; a retry re-quotes the same settlement; expiry fires the
  abandon cooldowns. An explicit release endpoint is a free lock-cycling
  denial lever unless it joins the abandon-cooldown accounting, which makes
  it a custody-adjacent server feature, not a small route; it stays product
  debt with an owner in the follow-ups list and the runbook documents the
  shipped behavior. Exposure is bounded at one lock window and R8's
  cancel-intent bounds the seller's worst case.
- R13 (the outage-forfeit ruling, parked by the 14 QA round): DOCUMENT
  ONLY plus a named code follow-up. The strike side stays outage-fair
  (strikeDefaultingBuyer spares outage-locked winners); the bond forfeit
  stays ungated per R2. The runbook records the operational remedy: pause
  trading during an economy-rail outage; after recovery, identify
  outage-window defaults from the same evidence the strike-fairness path
  reads and make players whole through the dashboard's refund-bond flow.
  The automatic arm (the payment deadline pauses while the rail is
  observed down, capped at one full window, or forfeit converts to refund
  on outage evidence) is a named follow-up that needs its own ruling and
  the 21 devnet evidence before code.
  AMENDED same session by the rider's runbook verification lane, which
  proved the remedy's two mechanisms do not exist: a forfeited bond is
  TERMINAL (the release protocol answers already_forfeited, the dashboard
  deliberately proxies no bond-refund, and non-releasable states can
  return the success-shaped nothing_collected that the dashboard renders
  as a refund notice), and nothing durable records "outage-locked" per
  row (the strike gate probes health at strike time). The corrected
  remedy, carried by runbook section 12: identify affected defaults BY
  HAND from the pause audit trail, the halted/recovered lines, and the
  settlement deadlines; restitution for a forfeited bond is a MANUAL
  TREASURY-SIDE TRANSFER approved by Fernando and recorded in the ops
  log, never the dashboard release flow. The ruling's disposition
  (document only, automatic arm needs its own ruling) is unchanged.
- R14 (the terms re-consent question, parked by the 14 QA round): RE-PARK
  to R6's enable-time checklist (owner: counsel via R6). Production holds
  no real acceptances while WOC_MARKET_ENABLED is off, so the enable-time
  checklist verifies that and keys acceptance to the counsel-approved text
  (re-keying the durable flag if the label changed), making launch
  re-consent moot. The post-launch reword policy remains counsel's
  question; versioned acceptance is the code change if counsel ever rules
  rewords need re-consent. The acceptance audit records the
  RECORDED-vs-SHOWN distinction.
- R15 (the fail-then-pay-again service contract, parked by the 14 QA
  round): DOCUMENT ONLY. The contract is settled on paper in this rider
  from the shipped state machine: transaction_failed only reports an
  atomically failed transaction (a failed Solana transaction moves
  nothing), a payment landing after quote_expired is recovered by the
  ledger-proven adoption arm (the 09 QA paid-after-expiry fix), and a
  timed-out confirming row goes EXPIRED, never rejected, keeping adoption
  open (the R5 five-hour bound). The acceptance audit cites the code and
  pins; the empirical observation stays a 21 devnet evidence row. A gap
  found by the code walk comes back to Fernando as a code item.
- R16 (the pg-suites-in-CI standing posture, 20/22): CHANGE CODE. The game
  repo's CI test jobs gain a Postgres service and TEST_DATABASE_URL so the
  floor-resident real-SQL suites run at the merge bar; the suites
  self-classify into the always-run floor so no selection-semantics change
  is needed, and the wiring must hold the fixed-db-name collision class
  (never two concurrent batteries against one fixed-name database; an
  isolated database instance per CI job satisfies it). The diff takes the
  gate-integrity-reviewer per the dispatch rule; the accepted cost is
  container boot plus the measured battery in the jobs that host floor
  suites.

Still open (a phase that hits one asks at session start):

- R5 (phases 09/10/21): the chain-wiring operational decisions. The two 09
  items are RESOLVED (Fernando, 2026-08-14, proposed and confirmed at the 09
  session start):
  - SOL fee funding and monitor: the releaser preflights fee plus rent against
    the escrow's SOL (refuses insufficient_sol_fee, bond stays held and
    retryable); the admin overview reports the balance and flags it under
    WOC_MARKET_ESCROW_MIN_SOL_LAMPORTS (default 0.05 SOL); funding stays a
    MANUAL op (no automated cross-wallet top-up).
  - ATA rent on refund: the ESCROW pays it (idempotent create funded by escrow,
    rent joins the preflight), so the bidder is always made whole in full; the
    bounded griefing exposure (about 0.002 SOL per bond cycle via account
    re-closing) is accepted and visible through the low-SOL monitor.
  The two 10 items are RESOLVED (Fernando, 2026-08-14, proposed and confirmed
  at the 10 session start):
  - Verifier commitment level: the existing split is RATIFIED and pinned.
    Verification MATCHES at 'confirmed' (the incident-driven read: a
    finalized-level getParsedTransaction returns null for tens of seconds
    after broadcast, indistinguishable from absence, and once cost a real
    player their payment); crediting (the settled write) requires 'finalized'
    observed via signature status, and the releaser/probe paths stay
    finalized-only. Both levels become code-owned exported constants, NO env
    knob (lowering the credit bar is a money-safety foot-gun; precedent:
    code-owned MAX_REPLACEABLE_AGE_MS). The pending answer vocabulary
    SPLITS: matched-at-confirmed-awaiting-finality keeps awaiting_finality;
    nothing-visible-yet answers a distinct stable reason, so a fabricated
    signature is distinguishable on the wire. That is the service half of
    the anti-snipe fabricated-signature residual assigned to 10; the game
    adopts the distinction in 12 (extension only on the matched arm).
  - Confirming timeout: FIVE HOURS, code-owned MAX_CONFIRMING_AGE_MS,
    applied through the existing expiry sweep seam. Deliberately UNDER both
    6h bounds: the game's poll receives the service's stable terminal
    verdict before its own H15 review park fires (review stays the genuine
    service-unreachable backstop), and the terminal call lands while RPC
    signature history can still decisively answer a re-verify. A timed-out
    confirming row goes EXPIRED, never rejected, so the ledger-proven
    adoption arm remains the recovery path and the bound is money-safe even
    against a real payment unobserved for the whole window. Values noted
    here for 21 per the 10 spec.
  The 21 item is RESOLVED (Fernando, 2026-08-20, proposed and confirmed at
  the 21 session start), closing R5 in full:
  - Devnet mint: a FRESH throwaway devnet SPL mint created for the dry run,
    decimals 6 (matching the live mint and DEFAULT_WOC_DECIMALS). Mint
    authority, escrow, treasury, buyer, and seller wallets are fresh local
    keypairs held only in gitignored local env files (gitignore coverage
    verified BEFORE any key is written); supply is minted upfront to the
    buyer (1,000,000 WOC, enough for every leg; the session ask said per
    leg, implemented as the one upfront mint and recorded so). Pubkeys and
    transaction signatures are recorded in state.md; keys never leave the
    machine and nothing durable outlives the run (teardown is deleting the
    local files). The prior claudium devnet mint was considered and
    declined: its authority keypair survives in no checkout, so it cannot
    fund wallets.
  - Price venue during the run (companion gap surfaced with the ask): the
    Birdeye venue and the chain arm shared the single WOC_MINT knob, and
    the fixed dev price is gated behind the fake-chain arm, so a
    real-devnet-chain run had no env-configurable price source. RULED: add
    WOC_MARKET_PRICE_MINT, the venue's mint override, defaulting to
    WOC_MINT so every existing deployment is byte-identical in behavior;
    validated at boot; with tests. The dry run then prices the REAL mainnet
    WOC on the real venue while settling on the devnet mint, preserving the
    11 observation item (real venue cadence and the halt/recovered lines).
    AMENDED the same day, mid-run: no Birdeye key exists on this machine and
    none was obtainable in-session, so Fernando additionally ruled the fixed
    dev price DECOUPLED from the fake-chain gate: devPriceSource rides the
    NODE_ENV dev/test allowlist alone (WOC_MARKET_DEV_CHAIN no longer
    required), so a devnet run prices from WOC_MARKET_DEV_USD_PER_TOKEN
    (set locally to the operator-supplied spot, 0.0001476 USD per WOC,
    2026-08-20) while the REAL chain arm settles the devnet mint. The
    production posture holds (unset NODE_ENV refuses; compose pins
    production). The 11 real-venue-cadence observation is recorded NOT
    OBSERVABLE on devnet without a key; WOC_MARKET_PRICE_MINT stays the
    path for a keyed future run.
- R6 (phase 07, B7): counsel owns final Terms language. The phase produces drafts and a
  decision memo; counsel sign-off is a launch gate tracked here, not a packet deliverable.
  STATUS 2026-08-13: package READY, recorded SENT-TO-COUNSEL (the send is
  `TERMS_AND_CONDITIONS_MARKETPLACE_DRAFT.md` plus the decision memo, held
  privately at `/Users/fernando/Documents/woc-counsel/counsel-decision-memo.md`
  outside the public repo; Fernando forwards them).
  Sign-off remains the launch gate; the memo's enable-time checklist (the R9
  affordance for BOTH surfaces: the trade panel and the Exchange checkbox's own
  terms link, the seller terms gate if counsel confirms, the R2 forfeit split plus
  its client disclosure, terms.html/privacy reconciliation) enumerates what must
  land before R6 can flip to granted. NOTE (07 QA, 2026-08-13): the QA round
  amended the draft after this status was recorded (second-chance offer,
  pause honesty, bond-custody carve-out, and sibling fixes; see the 07
  ledger's QA ROUND bullet), so the copy forwarded to counsel must be the
  amended draft at the QA tip.
- R7 (scope adds, unanswered 2026-08-11): Fernando was offered four deferred
  nice-to-haves as packet phases and did not select any: dispute-case UI, marketplace
  player wiki/guide page, game-side audited runtime pause, numeric reserve guard. They
  stay in the follow-ups queue; if he opts any in later, add it as a new numbered phase
  before phase 21 and update progress.md and the plan table.
- R9 (phases 07/14/22, raised by the 06 QA round 2026-08-13): RESOLVED
  (Fernando, 2026-08-17, directed in the 14 session prompt): the trade
  window's $WOC arm gains its terms affordance modeled on the Exchange
  checkbox, using the 07 draft's adopted language, and the offer-send and
  pay arm STOP hard-coding acceptTerms: both sends carry the player's real
  choice (durable acceptance learned from /me, or the consent row's own
  checkbox). IMPLEMENTED in 14: the consent row (checkbox + a live /terms
  link, draft 10.3) renders on the buyer's compose and pay faces and hides
  once acceptance is durable; the Exchange checkbox gained the same link
  and both labels now name the Marketplace terms; the reworded
  termsLabel/terms_required copy is on the release re-translation list.
  Residual for 22's pre-enable audit: verify both surfaces against the
  counsel-approved terms text once R6 grants (the /terms page must carry
  the marketplace sections before enable).
- R11 (phase 13 security follow-up, raised by the 13 fresh security re-review
  2026-08-17, UNANSWERED; a pre-enable launch gate): the step-up RAISES the bar
  on a stolen bearer but is NOT an absolute "a stolen session cannot move
  custody" guarantee, because the wallet-link RELINK path
  (`POST /api/wallet/link`) needs only the INCOMING wallet's signature and is
  an upsert (and `DELETE /api/wallet/link` needs no signature at all), so a
  bearer thief can relink to their own wallet FIRST, then sign every step-up
  challenge and take sale proceeds to their own wallet. The step-up's live
  wallet re-read closes the issue-to-use window but not a relink BEFORE
  issuance. The wallet-link flow is out of phase 13's scope, so 13 corrected
  the over-claim in the module header and DEPLOY.md and records this. Options
  (need Fernando's ruling; the wallet-link flow is the surface): (a) require
  the OUTGOING wallet's signature (or password/TOTP re-auth) to relink/unlink;
  (b) a link-age cooldown so a wallet linked under N hours cannot authorize a
  custody move (`wallet_links.linked_at` exists); (c) refuse relink while the
  account holds live escrowed listings. Inert while WOC_MARKET_ENABLED stays
  off; the pre-enable audit (22) must resolve it. Also close `DELETE
  /api/wallet/link`'s missing rate limit in the same pass.
  - R11 CLOSED (2026-08-26, owner ruled option (a) alone, plus a
    wallet-changed email; the cooldown (b) was considered and rejected as
    over-blocking): branch `fix/wallet-relink-reauth`. Server:
    `server/wallet_reauth.ts` (the pure re-auth core; the CURRENT wallet's
    signature over the same challenge message wins outright, else password
    plus the second factor when enrolled via replay-safe
    `verifyLoginTwoFactor`; passwordless accounts answer 403 pointing at
    Set-a-Password), wired into `walletLinkCore` (relink to a DIFFERENT
    address only; first links and same-wallet re-verifies stay prompt-free)
    and a rewritten `handleWalletUnlink` (no-wallet no-op; PASSWORD arm only:
    a link challenge cannot be action-scoped to a removal, so honoring a
    signature there would let a same-wallet re-verify signature replay as an
    unlink; the QA round also caught and closed an empty-message signature
    bypass on this path, now pinned by tests). `DELETE
    /api/wallet/link` now carries `rateLimit(WALLET_LINK_POLICY)` on both
    dispatch arms (the missing-rate-limit rider above). Refusals carry stable
    `wallet.reauth_*` codes (catalog + client matcher + M16 fills). The
    compensating alert emails linked/changed/removed on every custody edit
    (first links included: that path stays signature-only by design). Client:
    `src/ui/wallet_reauth_prompt.ts` collects the password proof BEFORE the
    challenge (a refused attempt would consume the single-use nonce);
    `linkWallet`/`unlinkWallet` carry the proof. The step-up module header
    was corrected from deferral to closed. Review round 2 (Fernando +
    Trev, 2026-08-26, applied in-branch): the password arm now shares the
    account failed-credential budget (authThrottled pre-check answering
    the shared auth.too_many_failed_attempts identity, recordAuthFailure
    on the bad-password/bad-2FA arms, clear on success: the
    handleAccount2faDisable template), the co-signature arm is pinned
    against current.pubkey with REAL ed25519 keys, the client re-reads
    link state inside the flow (stale-cache self-heal), and the prompt
    got the FocusManager trap plus a DOM suite.
  - R11 TRACKED FOLLOW-UPS (raised in review round 2, deferred loudly,
    not silently): (1) the relink co-signature signs the standard LINK
    message, whose text ends "authorizes no transaction" while what it
    actually authorizes is redirecting future sale proceeds; a distinct
    replace-wallet message naming both addresses and the real consequence
    is the fix, and the signed text's domain line (the raw Host header,
    server/wallet.ts requestDomain) should be allowlisted in the same
    pass. (2) The signature arm has NO client: the prompt collects the
    password only, so an Apple/Discord-provisioned account with a linked
    wallet cannot change or remove it from any shipped client until it
    sets a password (Set-a-Password is self-service; the 403 names it).
    This is the recorded product stance per the owner's option-(a)
    ruling: the currentSignature arm is bare-API-only surface today.

## Locked decisions

- Base: `feature/woc-marketplace`, already merged up to release/v0.39.0 (sync merge
  f5df042a86 of tip d2d1a8ad5c, 2026-08-15). Every game phase
  re-syncs the latest `release/**` at phase start; service/dashboard phases re-sync
  `origin/master`.
- Packet docs live in the game repo only; service and dashboard phases are specified here
  and executed in their own worktrees.
- COUNSEL MATERIAL STAYS OUT OF THE PUBLIC REPO (Fernando, 2026-08-13): the game repo is
  open source, so the counsel decision memo lives privately at
  `/Users/fernando/Documents/woc-counsel/counsel-decision-memo.md` and is referenced from
  packet and shipped docs by pointer only, never committed. The Terms DRAFT itself stays
  public (clearly bannered; a ToS is public by nature). Any future counsel-bound
  document follows the same rule. Before every push, confirm no counsel file entered
  the branch.
- The custody/settlement lifecycle fixes land as focused phases 02 to 06 (the review's
  "one change" recommendation, split along test seams to keep sessions small; QA between
  each keeps the shared root cause honest).
- i18n: English-only via the sanctioned pending mechanism during the packet; release
  fills are maintainer release work. The 3,255 pending Latin fills the review counted are
  NOT packet debt.
- UI bar: DESIGN.md is the design-language standard; the marketplace must look like a
  beautiful classic MMORPG window family (Fernando, 2026-08-11: this is a HUGE part of
  the game). Phase 15 is the dedicated beautify pass (padding/tokens, no truncation,
  formatted numbers and times, readable images, stress captures); its QA requires
  Fernando's eyeball sign-off on the screenshot set.
- Every session starts by entering its worktree (SESSION START block at the top of every
  phase and QA file) and syncing: game from the newest `origin/release/**`, service and
  dashboard from `origin/master`. Prompts pasted into fresh sessions rely on this.
- CLAUDE.md upkeep: every phase updates the nearest local CLAUDE.md its diff makes stale
  (concise, anchor rule, no bloat; create a small top-level one in the service or
  dashboard repo if absent); every QA verifies it.

## Known gotchas carried from the review session

- The count-pin merge trap keeps firing: after the v0.38.0 re-sync the run-derived
  totals are send 200, dispatch 213, IWorld 324 (86 data + 238 methods), unchanged by
  the v0.39.0 sync (f5df042a86: no conflict and no silent auto-merge on either pin
  file, the release touched none of src/world_api, src/net/online.ts, server/game.ts;
  re-confirmed by running tests/command_schema.test.ts + tests/world_api_parity.test.ts
  on the merged tree). If a later
  release merge conflicts (or silently auto-merges) there again, re-derive from a
  suite run, never take either side's number.
- `npm run i18n:build` does NOT run `i18n:scan`; the S3 guard needs `i18n.status.json`
  present (full `npm run i18n:gen` creates it). Bit the review session at push time.
- (RESOLVED by 01) `hud.ts` was monolith-RED until the p2p controller extraction;
  the gate no longer carries a known red.
- The marketplace test set on the game branch was 866 passing at packet creation; the
  full suites: game 1524, service 413, dashboard 131.
- Dashboard `npm audit`: 11 vulnerabilities at review time (phase 19 owns it).
- kickSession argument order: the branch fixed a wire/log swap (c0955c6126) that
  the RELEASE still carries on its own tree; the v0.38.0 merge kept the branch's
  fixed order. A future release merge must not re-apply the release's order
  (the second argument crosses the wire to the player).

## Findings-to-phase map (from review.md)

- B1 -> 02. B2a -> 02+03. B2b, B2c -> 03. B3 -> 09. B4 -> 10. B5 -> 08. B6 -> 13. B7 -> 07.
- H1, H2 -> 18. H3 -> 11. H4 -> 04. H5, H6 -> 05. H7 -> 01. H8 -> 12. H9 -> 02.
  H10, H12, H14 -> 06. H11 -> 16. H13 -> 14. H15 -> 04.
- Mediums: fake-only SQL -> 20. Fee-split divergence + forfeit burn -> 09. Bond
  double-pay -> 09. Stuck-custody monitor -> 03 (+ dashboard view 19). Compose default,
  fail-open configs -> 08. Anti-snipe unpaid-bid extension -> 04. DB scale (indexes,
  retention, lock_timeout) -> 17. i18n error surfaces + currency -> 14. Dashboard cluster
  -> 18+19. validateReleaseRequest regex -> 18. Service bond-quote usdCents -> 09.
  createDirectedOffer guardBalance + directed auto-close + bond-size ownership -> 06/09.
  UNIQUE(listing_id) sale invariant -> 02. Env documentation + health rail -> 12.
  Browser-only gate server posture -> 13 (note in scope). Coordinator drift (sim
  extraction, firewall regex) -> 05. Doc staleness -> 07. Runbook -> 22.

## Per-phase ledger (append as phases complete)

- 14 ux-honesty (2026-08-17, GAME repo, session start d3b15f6057 = the 13 QA
  tip; release sync NO-OP (origin/release/v0.39.0 f48c7a3a9b already an
  ancestor, no merge, no release-merge-audit owed); commits 22de5a4107
  (server honesty), fe5165c2eb (trade honesty + seller controls), 1de30be50e
  (informed commitment), 76bacd06ed (localized money surface), 8a0d55d3ca
  (docs + quote_expired reword), df79314e15 (lint floor), plus the review
  fix round and this entry's docs commit; LOCAL not pushed per R4.
  Validation: npx tsc --noEmit clean; all market suites + trade suites +
  snapshots/env_protocol/bandwidth + architecture/monolith/hud_update/
  dialog_root/fanout/perf + i18n gates green; the FIVE market pg suites
  142/142 zero skips WITH TEST_DATABASE_URL; ci:changed exit 0. Closes H13,
  the wallet-bridge i18n medium, and the wocUsdText currency medium, plus
  the 14-owned deferrals from 02/04/06/07/11/12/13. The registry the 14-qa
  session consumes:
  - R9 RECORDED FIRST (see Rulings: resolved by Fernando in the session
    prompt; both money sends now carry the player's REAL consent and both
    consent controls link /terms).
  - SELLER CONTROLS (H13): the decline/withdraw routes PRE-EXISTED (the 06
    handoff was right; no new server command): the client wiring was dead in
    three layers and is now live. The seller's review face carries Decline
    (resolveOffer 'decline', youDeclined line, wocTradeFinished pre-marked
    so the lingering row cannot double-report); the buyer keeps Withdraw
    (now with its own youWithdrew line). Cancel sale: the seller's
    awaiting_payment face (trade arm) and the Activity "My listings" rows
    (the ONLY surface a directed listing renders on; gate mirrors the
    browse pane: active, no cancel-intent, unbid) both drive the ordinary
    cancel route; a cancelPending answer keeps the deal held (the buyer may
    still pay; the poll converges the outcome), a plain ok ends it.
  - HONEST ENDINGS (H13's false-payment line): wocOfferPhase MOVED into
    src/ui/hud/woc_trade/woc_trade_offer_view.ts (the 01 deferral) and
    'settled' now requires listingResolution 'sold'; a closed-not-sold
    listing is the new 'closed' phase, with wocOfferClosedReason naming
    cancelled/suspended/unpaid (unknown resolutions read UNPAID, never an
    invented cause). finishClosedWocTrade reports once per offer id and
    KEEPS the trade session open (a dead deal leaves two players at a live
    window); resolveClosedWocTrade handles settled AND closed after the
    window shut, and tells a buyer whose deal is still LIVE what remains
    (offerStandsUntil with the TTL time / dealAwaitsPayment). The other
    side's decline/withdraw/expiry reports once off the lingering row's
    status. A CONFIRMED or DELIVERING confirm answer gets its own log line
    (paymentConfirmed) and role-split status sentences; "on its way by
    mail" now waits for delivered/sold. The poll's keep-comparison gained
    the settlementState dimension so confirming -> confirmed repaints.
  - INFORMED COMMITMENT: the p2p Pay flow is TWO-STEP: payWocTradeOffer
    claims the lock once (stores wocTradeSettlementId; a Not-now retry
    re-quotes THAT settlement, never a second buyNow into its own
    buy_now_locked) and stages the quote; the review face shows the token
    total, USD, quote expiry (static time; no countdown driver), and only
    signWocTradeQuote drives the wallet. Pre-bid disclosures land BEFORE
    the first bond charge: bidBindingNote (binding once the bond signs, no
    withdraw, forfeit + strike on non-payment: draft 10.4/10.5),
    bidCloseNote (anti-snipe extension + a late payment refunds, the 04
    behavior notes), offerNextNote (the second-chance disclosure, gated on
    the listing's offerNext). The offer's expiry renders on the review face
    (offerExpiresAt); price edits blank stale fee lines IMMEDIATELY; a
    below-min courtesy hint names the floor from ONE /status fetch per
    controller (hint-only, the server refusal stays the authority; NO wire
    change was needed, minPriceCents already rode /status).
  - LOCALIZED MONEY SURFACE: src/ui/wallet_bridge_reason_text.ts classifies
    bridge failures (structural cancel names; a byte-exact map over the
    bridge-authored strings DRIFT-PINNED against src/net + the launcher; a
    conservative decline-prose heuristic; flavored generics so a failed
    SIGNATURE never says payment); all four market sinks + the Claudium
    checkout render classified lines and console.warn the raw error.
    claudiumCheckoutErrorText keeps the unknown-message passthrough because
    that channel MIXES the checkout's own t() throws (scoped + documented);
    main.ts SHRANK 11490 -> 11486. The Exchange notice stores UNRESOLVED
    state (key/api/pending/bondPending/bridge kinds) resolved at render
    (resolveNotice), closing the 12-deferred language-switch staleness. The
    bond leg gained its own pending voice (wocBondPendingText + 4 keys);
    the five common fail reasons (quote_expired / transaction_failed /
    refunded / superseded / confirming_overdue) each explain themselves
    (FAIL_KEYS; the generic remainder pin shrank 20 -> 15). usd_text.ts is
    the ONE USD spelling (Intl currency; negatives and suffix locales):
    wocUsdText delegates, the window/Claudium/daily-rewards sites converted,
    and tests/usd_text.test.ts sweeps src/ui for the `$${` class with a
    positive control. rateNote names the venue price print (the 11/12
    as-of re-judge); pausedBanner and sellFeeNote trued to the draft;
    item_mismatch explains the lock/state arm; quote_expired stops
    promising a quote the lapse-straddle arm cannot grant.
  - SERVER HONESTY: strikeDefaultingBuyer is the ONE strike-fairness path
    for all three arms (the auction-default arm rode bare strikeAccount and
    struck outage-locked winners); the bond FORFEIT stays ungated per R2
    and the outage-forfeit question is RECORDED FOR 22 (needs Fernando).
    claim_cooldown carries WHEN a retry can first succeed (cooldownRefused
    returns retryAtMs; BOTH arms probed, the LATER wins: per-listing
    newest-abandon + reclaim window, cap = the cap-th-newest in-window row
    leaving the rolling hour; pg pins assert EXACT retry moments incl. the
    max-combining case; the service refuses with params.retryAfterSeconds
    ceiled with a 1s floor; throwRefusal passes params to HttpError; the
    client renders hudChrome.wocMarket.claimCooldownRetry via formatDuration
    with the plain sentence as the no-params arm: the parametric leaf lives
    under hudChrome because the apiError catalog is a strict bijection with
    the code registry). Activity bid/settlement rows are ITEM-NAMED
    (bidsByAccount/settlementsByAccount join the listing item id via a
    correlated PK subquery, since the shared unqualified COLS lists make a
    JOIN ambiguous; '' when the listing is pruned, collapsing to null on
    the wire; WocActivityBidRow/WocActivitySettlementRow types; FakeDb
    mirrors; wire pins + value arms updated; the window renders item cells
    with keys activity:bid:/activity:settle: inside the pinned namespace).
    The two admin 409 envelope arms emit REGISTERED codes (the 02-owed
    admin-envelope conversion; serializeAdmin already carries codes; no
    admin-UI consumer exists in-repo). WocMarketFail gained params (the
    parsed error body, the ApiError convention) so parametric codes render;
    fail()/userFacingApiError sites pass params through. Comment truth-ups:
    the offer-status prose (decline=seller, withdraw=buyer) and the SDK's
    inverted resolveOffer comment.
  - REWORDED KEYS FOR THE RELEASE FILL (per Fernando's in-session
    instruction, existing translations NOT refreshed; the pending-based
    worklist CANNOT see rewords, so THIS LIST is the release re-translation
    to-do): hudChrome.wocMarket.termsLabel, rateNote, pausedBanner,
    sellFeeNote; apiError.woc_market.terms_required, item_mismatch,
    quote_expired. NEW keys carried ONLY the five forced non-Latin fills
    (M16 floor): 17 trade.woc keys (cancelSale included; the QA audit
    corrected the count from 16, 38 new keys in all), 6 walletBridge, 9
    wocMarket bond/fail, claimCooldownRetry, termsLink, quoteExpiresAt,
    bidBindingNote, bidCloseNote, offerNextNote (Latin locales re-pend as
    usual). QA CORRECTION to the reword rationale: the seven reworded keys
    had NO Latin translations at all (pending everywhere), so the ordinary
    pending worklist covers them; the reword list stays only as the reminder
    that the English changed. The 14 QA round reworded and added more keys
    (see its bullet); the same posture applies.
  - JUDGED, no code change (do not re-raise): the outage-window bond
    FORFEIT left per R2 (a money-policy call recorded for 22, not 14's);
    the 06-suggested server-side staged-shape check DECLINED (the table is
    consensual and visible to both, the money side pins exactly one copy
    server-side, and a cross-system trade-shape validator adds coupling
    for no custody hole); keep-last-known-good adoption estimates kept
    (12's judgment; the immediate-blank rule covers the price-edit case);
    the trade window's relocalize stays DEFERRED to 15 with the fanout
    exemption row's reason REWRITTEN to record this round's re-judgment
    (consent SEND is a boolean judged server-side; live money flows have
    data motion within a poll beat); the Claudium unknown-message
    passthrough kept (channel mixes its own localized throws); the
    daily-rewards/claudium hardcoded-$ fixes taken IN scope (same defect
    class, and they make the repo-wide sweep pin possible); cancel-intent
    client marker confirmed already satisfied by 12's badges.
  - MUTATION/RED registry (for the QA red-proof lane): M1 closed-collapses-
    to-settled (the H13 defect restored) bit 4 tests across two suites; M2
    the decline button rendered dead again bit 2; M3 the activity-cancel
    unbid gate dropped bit the window pin; M4 raw err.message passthrough
    restored in the bridge module bit 3; the strike-gate mutant (auction
    arm back to bare strikeAccount) bit the outage service test by name.
    Development reds observed before their fixes: the one-step payTo driver
    failed the review-line ladder until the sign step existed; the raw
    'user declined in wallet' render failed the classified-decline
    assertion; the wire-pin key sets and the cooldown toBe('claim_cooldown')
    pins ran red against the new shapes before their updates. NOTE the
    M2-restore wrong-occurrence trap fired for real (the python restore
    replaced BOTH ': \'\';' occurrences and left a stray Decline on the
    awaiting-payment face; caught by re-read, fixed in the same commit).
  - REVIEW ROUND (three fresh lanes over d3b15f6057..HEAD, coverage
    prompts; fixes in 6349b61f62): the xplat CRITICAL was the resolved-offer
    verdict lines being UNREACHABLE (the offers read filtered resolved rows
    the instant they resolved and my test rode an impossible fixture); the
    fix extends the closed-listing grace precedent to just-resolved rows on
    o.updated_at (both resolve paths stamp it), rebuilds the FAKE read to
    full Pg fidelity (pending AND accepted rows, the listing/settlement
    join fields, both grace clauses; the old fake was 'pending'-only, a
    pre-existing gap this pass made load-bearing), and pins the lingering
    verdict + its exit in the directed pg suite. The coverage lane's four
    blockers all closed: the send-arm consent mutant (unconsented send
    pinned FALSE; ok-implies-durable recorded as the semantics), the
    auction arm's exempt-vocabulary dimension (service_unavailable spares
    the strike under a healthy oracle; default + forfeit still land, the
    mid-outage bond state pinned at its observed 'forfeited'), the SDK
    params echo pin (a real param now rides; params scoped to coded bodies
    per the apiErrorFromBody convention), and the item-join SQL (both
    activity reads pinned against real Postgres; the pruned-'' arm is
    UNREACHABLE under the CASCADE FKs, recorded as defensive). Also landed:
    throwRefusal takes the WHOLE refusal (params can never be dropped at a
    call site again), the strict no-prose Claudium classification (a
    localized fill containing a cancel-family word can never rewrite an
    unrelated checkout sentence into the cancel copy), hasOwn on the
    message map, the comment-stripped drift corpus, the widened
    src/{ui,game,net} usd sweep, per-role delivering-status pins, the
    retired-ledger re-adoption pin, all three close-time arms with the
    exact expiry line, the cooldown floor/cap-arm/error-code-params
    assertions, and the admin envelope proven end to end through
    withErrors (body = { success:false, data:null, error: <code> }).
    JUDGED from the round, no change: the raw-source main.ts pin (the
    naive block-comment strip swallows glob strings; anti-pins fail loud);
    the "$4.00 USD" doubling in dailyRewards.usd matches its pre-existing
    sibling call sites (a copy decision for the release fill pass); the
    bidBindingNote states the strike unconditionally while the gate spares
    outages, asymmetry in the player's favor.
  - REVIEWER-DEATH RESIDUAL for the 14-qa session: the frontend-seam lane
    died silently TWICE (the typed reviewer, then a general-purpose retry;
    both unresponsive to two nudges each, the 13 round's usage-limit death
    mode). Their dimensions were covered by a careful main-loop self-review
    with files open (verdict: no blocking findings; 15-notes recorded: the
    CLOSED_KEYS log-line table lives in the controller rather than the
    view core, the consent checkbox carries no data-focus-key across a
    rebuild, mobile consent-row sizing). The QA session MUST re-run a fresh
    frontend-seam lane with MOBILE explicitly in scope (the consent row's
    11px label and the checkbox/link touch targets on a money surface
    cannot be judged from CSS text; the qa-checklist report flagged the
    same two residuals).
  - The qa-checklist agent, presumed dead in the first write of this entry,
    DELIVERED a full report late: verdict READY, zero blocking, four
    action items, all applied in the follow-up round below. Its remaining
    VERIFY items, owned by the QA session: the frontend-seam mobile arm
    (above); a database-performance lane over the market SQL deltas (the
    cooldown probes, the correlated item lookups, the offers-read grace OR,
    and NOW the two indexes the fix round added, which are themselves
    unreviewed DDL); no scripts E2E click-through covers the consent row,
    quote review, seller Decline / Cancel sale, or item-named Activity rows
    (unit-covered only). Pre-existing residuals it surfaced, already owned
    elsewhere: public/terms.html carries no Marketplace section yet (22's
    pre-enable audit, TERMS.HTML DRIFT); the sellFeeNote burn/treasury
    percentages restate service-side tunables with no pin coupling copy to
    the constants (recorded for 22 with the terms drift).
  - QA-round fixes (commit after the review-round one): the consent link's
    var() named a custom property defined NOWHERE so its fallback always
    won (now var(--gold), matching .wm-terms-link); an explicit closed-deal
    face in trade_woc_panel so a dead deal can never fall through to the
    review face and offer Decline / Withdraw (panel pin, both roles); the
    2s offer poll could never use the pending-only partial indexes once the
    grace OR landed and seq-scanned per poll, MEASURED on a 200k-row scratch
    rig (2398 buffers to 206, 6.8ms to 0.15ms) and fixed with two additive
    non-partial (realm, account, created_at DESC) indexes, existence-pinned
    in the directed pg suite; the fake's offers read now mirrors ORDER BY
    created_at DESC LIMIT 50 and stamps real creation clocks (new fidelity
    suite tests/server/fake_woc_market_db.test.ts).
  - GATE LESSON (recorded so the QA session does not repeat it): running
    gate_select with the whole main-checkout .env exported (set -a; source)
    poisons tests/server/http/characterization.test.ts, whose leaderboard
    and project-stats goldens expect the empty-degrade payloads of its
    dummy DATABASE_URL (the file only ||= -defaults it). Seven goldens
    red against the populated dev db. Pass ONLY TEST_DATABASE_URL on the
    gate command line; never export DATABASE_URL.
  - GATE RESULT: node scripts/gate_select.mjs PASS, all 12 steps green
    (the planner fell back to the FULL vitest suite for this diff, so the
    pass covers the whole matrix: 41k tests, tsc, all builds, the browser
    suite, i18n gen + freshness), run on the final committed tree with
    TEST_DATABASE_URL only, tree clean after. Re-run after the seam round
    below; the result line for that run is appended at the bottom of this
    entry.
  - SEAM ROUND (the two frontend-seam lanes recorded dead above both
    DELIVERED late, independent and thorough; every finding applied or
    judged, so the reviewer-death residual is VOID and the QA session's
    owed re-run narrows to the true VERIFY arms: the mobile E2E/capture
    pass and the Capacitor _blank check). Applied (one commit): the
    35-row refill of the five non-Latin overlays for the SEVEN reworded
    keys (both lanes escalated it: pausedBanner told ja/ko/ru/zh players
    the OPPOSITE about an in-flight payment, the consent caption and its
    link named different documents, sellFeeNote asserted the exactness
    the reword retracted; Latin locales stay on the release list, which
    now covers ONLY them); the pressed-Pay busy face (deps.paying,
    disabled + spinner through the claim RTTs); the lapsed-quote guard
    (Sign re-checks the clock at the click, spends the stale quote with
    the quote_expired line, Pay re-quotes the HELD settlement; paint-time
    disabled via deps.nowMs, deliberately outside the sig); focus keys on
    all seven actionable controls + a capture/restore pin; the mobile
    touch floors for the consent row and BOTH terms links (40px label,
    24px box, inline-flex link floors; the Exchange link lacked one too);
    the sig's quote projection (structural fields, not the transaction
    blob); WOC_TRADE_CLOSED_KEYS hoisted; rel noreferrer on both links;
    /terms proxied in dev (it 404ed on :5173); the fanout reason narrowed
    (the quote review and consent row are deliberately STATIC faces, so
    "data motion covers it" was false; posture stands on the
    boolean-not-label ground, 15 owns relocalize + form_draft); the
    role=status announce on the quote title; the CLAUDE.md caveat that
    public/terms.html does not yet carry the linked Marketplace section
    (22's pre-enable publication).
  - SEAM ROUND JUDGED, no change (rationales the QA session should not
    re-litigate without new evidence): confirm-refusal keeps the paying
    face until the 2s poll adopts server truth (a signature may already
    be broadcast; re-arming Pay invites a second wallet prompt for money
    in flight; the wallet-DECLINE branch restores because nothing was
    sent); DECLINE_PROSE stays on for the market wallet sinks (they are
    sign-only channels where "User rejected the request" is the standard
    decline; a subclass/symbol marking of bridge-authored throws is the
    15 hardening); the Claudium collision claim is FALSE at the tip
    (claudiumCheckoutErrorText passes proseDeclines false, the heuristic
    never runs there); the usd_text sweep note was stale (the widened
    src/{ui,game,net} sweep + positive control landed in the review
    round); the "{amount} USD" suffix doubling stays a release-fill copy
    decision, now recorded WITH the suffix-locale rationale (drop the
    suffix when the formatter supplies the currency); canSend/canPay
    staying un-gated on the checkbox is the Exchange's own posture and
    the server refusal renders localized (15 may add the hint-ladder
    arm); the activity item cells pass no instance payload because the
    wire ships itemId only (a follow-up only if instanced copies trade
    here); the two bare-named cores follow the local reason_text family
    and are triple-registered; daily_rewards' err.message line is
    pre-existing debt outside this pass; the quote-face termsRow stays
    as belt-and-braces; no focus-steal on the quote face's appearance
    (the family has no such idiom; role=status announces it).
  - FOR THE QA SESSION from the seam round: run the mobile E2E arm
    (scripts/mobile_*.mjs + a landscape capture) over the consent row
    and quote face; verify the /terms link opens on the Capacitor shells
    (target=_blank vs the native Browser.open idiom, see
    src/net/native_discord.ts); the seam fixes themselves are UNREVIEWED
    code (the review-the-fix-round rule).
  - GATE, second and third runs: the post-seam-round full run FAILED on
    exactly one test, the delivery pg suite's finalize-vs-suspend
    interleave, whose accepted set named only two of the race's three
    legal serializations: under full-suite load finalize committed WHOLE
    before suspend took its locks, so the guard correctly refused over
    the closed listing with not_active while every downstream invariant
    held (finalized, exactly one sale). Judged a pre-existing
    outcome-set gap, not a regression (no server code in the round
    touches that flow); the set now names the third arm with its
    rationale, and the suite ran green three consecutive times after.
  - GATE, FINAL: node scripts/gate_select.mjs PASS on the finished tree,
    all 12 steps green (full-suite fallback, 41k tests incl. the widened
    interleave, tsc, all builds, the browser suite), TEST_DATABASE_URL
    only, tree clean after. This is the run the QA session diffs against.
  - DEFERRED with owners: 15 (visual polish of the NEW faces: the quote
    review layout, consent-row styling incl. mobile, the activity cancel
    button placement; plus the standing 15 list: R10 hint dead end,
    sell-picker lock filter silence, stale TOTP screenshots, wallet busy
    label, WocMarketWindow behavioral rig, trade-window relocalize
    decision); 16 (per-actor offer fan-out watch continues; woc_market.ts
    extraction); 21 (devnet observes the real cooldown params, the bond
    pending voice, and the quote-review flow end to end); 22 (the
    outage-forfeit ruling for Fernando; R11; verify both consent surfaces
    against counsel text; the R9 residual above).
  - 14 QA ROUND (2026-08-17, GAME repo, verdict PASS-WITH-FOLLOWUPS, every
    finding applied or judged with the file open; PUSHED per R4). Release sync:
    merge 8c0370585c brought origin/release/v0.39.0 tip f42a67f341 (5 commits,
    druid feral enablement + its i18n fills; no marketplace overlap, no
    conflicts, tsc + the four count-pin suites green on the merged tree, no
    release-merge-audit owed). QA range d3b15f6057..ffd8d63963 (11 commits).
    NINE workflow audit lanes (server honesty, state-machine truth table,
    trade-arm client, Exchange + money surface, the four fix rounds re-reviewed
    incl. 6349b61f62, i18n/hygiene, dead code/docs truth, the /terms shell
    lane, a 43-mutant battery in a scratch worktree) plus SIX typed reviewers
    via Agent (frontend-seam with MOBILE in scope, cross-platform-sync,
    database-performance with a measured 200k-row rig, migration-safety with an
    empirical triple re-apply of the DDL, privacy-security, test-coverage: the
    last one reported LATE, after the push; its dimension had been covered by
    the two mutation batteries meanwhile, and its report is judged in the
    LATE COVERAGE LANE paragraph at the end of this bullet) and the QA
    session's own mobile E2E arm. The adversarial verify
    stage was stopped after 30 votes (29 confirmed, 1 severity refute) because
    at three lenses per finding it would have run for hours; every finding was
    judged in the main loop with the file open instead. Findings: roughly 150 across the lanes and reviewers (9 audit
    lanes 91 incl. 4 blocking-rated; frontend-seam 9 should-fix + 11 notes;
    security 1 blocking + 2 should-fix + 4 nits; migration-safety 3 + 4 + 4
    info; database-performance 5 P1 + 6 P2; cross-platform 3 + 4), plus the
    session's own four (the seller's 'Payment received' line, the buyer-voice
    compose copy, the seller never seeing the fee before accepting, the /terms
    shells). Everything applied except the JUDGED and DEFERRED lists below;
    the fixes landed as e68227b6bb (server/DB), d1e3eb2199 (the money faces),
    ea08ac4711 (the capture rigs) and, after a FRESH four-lane re-review of
    that fix round (client correctness, server/DB + pins, i18n fills, a
    50-mutant battery: 44 BIT, the 6 survivors REAL pin gaps closed) found 25
    more, 6f67a96057 (the kept keyed claim, its own deadline on the faces, the
    re-review's pins and refills; self-reviewed with the files open, every
    new pin proven by the battery's described mutants).
    Mutation battery round 1: 43 mutants, 36 BIT, 4 SURVIVED (all four REAL
    pin gaps, closed: the index column list, the fake db's two grace clauses,
    the bondPending resolve dispatch; the fifth survivor was the defensive
    finishClosed double-report guard, recorded), 1 INVALID (the pruned-listing
    '' arm is unreachable under the CASCADE FKs, its comment reworded).
    THE MOBILE E2E ARM (owed by the seam round): two dev-only rigs now render
    the money faces in a REAL landscape phone viewport at the lowest preset
    and MEASURE them: scripts/woc_trade_mobile_shot.mjs (every $WOC arm face
    through the real controller/panel/CSS in the offline game: 40px consent
    label, terms link and buttons, 24px checkbox, on screen and top-most at
    the tap point) and scripts/woc_market_shot.mjs (whose seed was DEAD since
    the step-up landed and now performs the listing step-up plus lists by the
    real bag index; its mobile arm opens the buy-now and auction panes and
    asserts the consent row, the bid field, and the disclosures' DOM order
    ahead of Place bid). All floors PASS; the one real miss was the bid amount
    field at 37px, floored to 40. Six landscape captures landed under
    docs/screenshots/woc-market/ (after-mobile-trade-* and after-mobile-buy-now
    -consent / -auction-disclosures) as the round's visual evidence. Observed
    and recorded for 15: on the mobile sheet layout the BAGS window the trade
    open shows stacks OVER the trade window (the rig hides it to measure); a
    pre-existing stacking question, not this round's.
    THE CAPACITOR CHECK (owed): a relative target=_blank href="/terms" is a
    DEAD link on iOS (capacitor://localhost/terms handed to UIApplication.open,
    an unregistered scheme), NAVIGATES the game WebView on Android (no
    multiple-window support; http://localhost is the in-app host; the
    WebViewLocalServer html5 fallback serves index.html: the game reboots
    mid-flow), and is DENIED by the packaged desktop shell (it loads
    app://worldofclaudecraft, whose window-open handler opens only http(s)).
    Verified from the Capacitor and Electron sources; fixed with the wiki_link
    idiom, not Browser.open: src/ui/terms_link.ts (pure resolveTermsUrl:
    same-origin '/terms' only for an http(s) origin outside the native app,
    the canonical https URL otherwise; CANONICAL_TERMS_URL shared from
    client_origin.ts with wallet_connect.ts), the DOM hosts pass
    location.origin in (the panel stays host-agnostic; the controller and the
    Exchange window resolve it), pinned in tests/terms_link.test.ts across
    the web / dev / app:// / capacitor:// / http://localhost arms. The seam
    round's Vite '/terms' proxy was REMOVED: it rested on a false 404 premise
    (STATIC_PAGE_ALIASES already served public/terms.html; measured 200
    without it, 502 with it and no server) and had made dev /terms depend on
    a running server with a built dist.
    THE DATABASE-PERFORMANCE LANE (owed): the two new account indexes are a
    measured WIN (BitmapOr, 3258 -> 170 buffers on the reviewer's own 200k rig;
    the schema comment's figures reproduce) and stay exactly as shaped; the
    residual is that the cost is linear in the account's RETAINED offer
    history (WOC_MARKET_OFFERS_RETENTION_DAYS is the control; recorded at the
    DDL, pre-enable measurement owed to 21/22). The two pending-only partials
    were DEAD (no statement could use them once accepted rows rode the read)
    and are RETIRED by idempotent DROPs; the correlated item lookups are
    plan-identical to a JOIN (measured) and now qualify their outer column
    (an unqualified listing_id would rebind the day the listings table grows
    such a column: a silent NULL item id, or a hard error when several rows
    match, both reproduced by the reviewers); the two cooldown probes
    run in ONE round trip with a bound OFFSET (the in-transaction re-check
    holds the listing row lock); the read takes the SERVICE clock through the
    seam and orders by id after created_at (the fake was deterministic where
    Pg was not); pins: the DB-free floor now covers the verdict grace arm,
    the tiebreak, both index definitions and the retirement; the pg suite
    pins the indexdef columns, EXPLAINs the real statement under SET LOCAL
    enable_seqscan off (no Seq Scan on the offers table), and claims at
    EXACTLY retryAtMs on both cooldown arms (one second before refuses); the
    fake gained the twins of both grace clauses under the seam's clock.
    Deferred with owners from this lane: /me is UNMETERED and its 6-way fan-out
    draws 6 of 10 pool clients (16, H11); the 50-row inbox cap truncates the
    OLDEST live offers with an abuse angle (16/22, a pagination decision); the
    settlements (listing_id, id DESC) index for the LATERAL per-row sort (17).
    THE FIX-ROUND RE-REVIEW'S OWN CATCHES (all applied): the round's guard
    DROPPED a successful claim when the deal moved on mid-claim, and the close
    path cleared the held settlement, so the same deal re-adopted inside the
    lock window claimed again and was refused buy_now_locked over the buyer's
    OWN lock (no same-account arm server-side) while the settlement lapsed
    into a strike: the claim is now KEPT, keyed to its offer, and re-quoted;
    p2pBindingNote promised the 10-minute hold while a pressed Pay opens the
    270s lock window (Not now keeps it running): the settlement's own
    deadlineAtMs now renders on the pay and quote faces and the note names
    the shorter window; a pressed Pay under durable consent still dropped
    focus to body (no other rung): the tabs end the ladder; the lapsed-quote
    line borrowed the Exchange's 'Request a fresh one' with no such control
    (own key: Not now, then Pay); a window closed mid-signature printed the
    strike warning (the close arm reads the signing flag first); notInstant
    said escrow happens when the SELLER accepts (both must); the game
    server's hand-off shape failure was mapped to 'bad_response' (blames the
    wallet: now 'unavailable'); ja/zh_CN/zh_TW closeSellerHold named an
    Activity tab the Exchange labels 取引履歴 / 动态 / 動態; ru
    settlementConfirmedDelivering read as a noun; ru rateNote borrowed the
    Marketplace brand word for the external venue; ko variableWarning lost
    the buyer address; the ru variableWarning refill had dropped its native
    dash; the index retirement was pinned on a FRESH database only (now on
    the upgrade path too); the plan pin's ROLLBACK moved into finally; the
    fake's cooldown boundary twin on both arms; the seller CREATE's negative
    pin; three comment truth-ups (a rebound column answers NULL silently, the
    retired pair is the ACCOUNT partials, the retention knob on one line);
    the moved test title and three docblocks reworded off the bare word.
    THE FIX ROUNDS RE-REVIEWED (98f4cc1afb, 433841c53f, 0609cfaf75 and
    6349b61f62 too): 0609cfaf75's third serialization is LEGAL under the
    exactly-once invariants (suspend pre-locks the winner bid then the
    listing; finalize-first commits closed/sold and suspend reads not_active
    having written nothing) and the widened set still fails on double sale,
    suspend-after-finalize, and no sale; the seam round's non-Latin refill of
    rateNote translated 'venue' as the game's own Exchange (取引所 / 거래소 /
    биржа / 交易所, a mis-attributed price source on a money surface),
    refilled as the external trading market; the /terms proxy above; the
    lapsed quote now SAYS so beside the disabled Sign; the four new trade.woc
    fills that dropped the Ravenpost brand were aligned to the sibling rows.
    THE HONESTY FIXES the lanes found ON TOP of the round (all applied, all
    pinned): the client held its claimed settlement UNKEYED, so a claim
    answering after the deal ended (partner cancelled, window closed) left a
    settlement and a staged quote for the NEXT deal's Pay to re-quote and
    Sign to pay (reproduced by the trade-arm lane against the tip; the
    security lane found the same class through an adopted-offer swap): the
    settlement and quote are keyed to their offer id, every post-await write
    bails unless the deal still stands, the adopt branch drops a foreign
    settlement, and Sign refuses one; the poll held the buyer's face at
    'paying' through the CLAIM round trips (a poll beat mid-claim rendered
    'Confirming your payment on the network...' with no Pay and no consent
    row after a refused claim or Not now): a separate signing flag now holds
    it only while a signature is out; a review-parked settlement rendered the
    confirming sentences with a spinner (own review keys per side, no
    spinner); a delivered answer left a live Pay button until the poll's
    finalize ('delivered' is a settling state); the seller's paying line
    claimed 'Payment received' for money the chain had not decided; the
    buyer's compose face spoke in the seller's voice ('You receive', 'when the
    buyer pays', 'Your item moves into escrow'): buyer-perspective copy, and
    the fee + net now render on BOTH review faces before the commit click
    (the seller never saw the fee before accepting; the adopted split had NO
    consumer, contradicting the H8 closure's rendering claim); the buyer read
    no payment deadline and no strike (the auction arm's bidBindingNote had
    no p2p twin): p2pBindingNote from the new /status directedHoldSeconds
    (untimed twin while unknown), an unpaid ending names the strike to the
    buyer, dealAwaitsPayment names it; the buyer's settled/paymentConfirmed
    lines promised mail for a copy handToBuyer puts in the bags; closing the
    window mid-deal printed only the sim's 'Trade cancelled.' (now: the
    seller's held copy, a payment that continues, a parked review, and a
    verdict that landed since the last poll is reported at close); Decline /
    Withdraw / Cancel sale had no in-flight guard and a raced answer rendered
    the bid-bond copy (one click one request, a trade-flavored not_pending
    line); a cancel answered cancel-pending left Cancel sale live (recorded on
    the face); the quote face lacked the fee legs the Exchange shows for the
    same answer and no quoteExpired line; the claim's own quote was discarded
    for a second round trip; Pay/Sign/resolve did not repaint synchronously;
    the pressed Pay dropped focus to body (a single-candidate restore; now a
    ladder); the Exchange labelled confirmed/delivering 'Confirming' and
    toasted 'Purchase complete' for them; the browse pane offered Cancel on a
    cancel-pending listing and the Activity digest omitted currentCents (a
    landing bid left a dead Cancel and the start price); claim_cooldown said
    'Try again in 1,800 seconds' (a shared duration_text core: 30 minutes);
    the moneyUsd '{usd} USD' suffix doubled the currency under Intl in every
    non-en locale (pl 'USD USD', en-CA 'US$1.00 USD'; dropped, with
    dailyRewards.usd); the offer-next, bond and close disclosures understated
    the mechanics (the outbid bidder is auto-promoted into a BINDING
    settlement); buy now disclosed no walk-away cost; the desktop wallet
    hand-off's six bridge strings were outside the map (raw English on the
    Electron Claudium checkout); the consent caption was 11px on mobile;
    settlementFailConfirmingOverdue said 'under review' on FAILED rows only;
    the last inline-English admin arm; the SDK's empty-code arm; the fake db's
    default zero clock made every row linger forever; the wocUsdText alias;
    the duplicated termsLabel key (10 non-Latin rows retired); the usd sweep
    hand-rolled its walker (now the shared one, self-audited, wider shapes);
    the main.ts ceiling lowered to its real size; the direct wocOfferPhase
    pins moved beside their module; CLAUDE.md upkeep (src/ui: the trade arm's
    home, duration_text, terms_link, canCancelListing, the drift corpus;
    server: the poll read's grace + indexes + retirement + the one-trip probe
    + directedHoldSeconds; src/net: the drift corpus) and both PRDs trued.
    JUDGED, no code change (do not re-raise): "Not now" keeps the buy-now
    lock until it lapses (a release route is a new server feature: recorded
    for 22 as product debt, bounded by the lock TTL and the seller's cancel);
    the sim's 'Trade cancelled.' sentence on the window's Cancel/X during a
    live payment stays (the sim session's shared teardown; the honesty lines
    now follow it; routing Cancel/X to tradeClose past review is a sim-seam
    change for 15/22 to judge); DECLINE_PROSE and the Claudium passthrough
    stay judged; the bond leg's one-step sign is the Exchange's own posture
    (recorded); the trade arm's 4-digit vs the Exchange's 2-digit token
    precision (15 polish); Activity bid/settlement cells colour by def
    quality (recorded); the offer wire carries no cancelPending (the trade
    face records the seller's OWN answer instead; a wire field only if the
    buyer's face ever needs the intent); the drift pin is one-directional by
    design (a new bridge throw degrades to the localized generic); the word
    'phase' in the round's prose and one commit body is the wocOfferPhase
    domain sense (the new prose was reworded to 'payment machinery' / 'the
    wocOfferPhase'; the commit body stays: no rewrite of the pushed spine);
    the panel's bare name escaping the perf gate's painter regex, the trade
    window's missing safe-area insets and the tablist named after one tab
    (15); the R11 relink gate and the terms.html content stay 22's.
    RESIDUAL for 22's pre-enable audit: durable consent recorded under the
    OLD checkbox label ('variable-token settlement terms') hides the row for
    players who accepted before the reword (whether the reword needs
    re-consent is the R6/R9 counsel question); pausedBanner tells a winner
    payments wait while the settlement window keeps running (the outage
    forfeit ruling); the fail-then-'pay again' copy on quote_expired /
    transaction_failed presumes no tokens moved (a service-contract question
    for 21's devnet run).
    GATE: node scripts/gate_select.mjs PASS on the committed tree at
    12395705bb (TEST_DATABASE_URL on the command line only), all 12 steps
    green: full-suite fallback (292 changed paths incl. vite.config.ts and
    the fake db helper), 2891 test files / 41133 tests (2 expected fail, 26
    skipped) with 8 workers, browser suite 19 files / 129, i18n + manifest
    freshness, malware scan, ci:changed, tsc + every build; tree clean after.
    Pushed per R4 right after (this closing line is the only commit past the
    gated tip).
    LATE COVERAGE LANE (same day, after the push): the test-coverage-auditor's
    report (audited at 8c0370585c, before the fix rounds; 14 mutants, 8 BIT
    6 SURVIVED there; 3 blocking + 8 should-fix + 5 nits, all TEST gaps, no
    code defect) judged against the pushed tree with the files open. Already
    closed by the fix rounds: the raw-message half of the controller payment
    sink (the declined-quote test), the indexdef + EXPLAIN pins on the two
    directed-offer indexes, the resolveOffer decline/withdraw route pin.
    Applied in 58212e3475 (tests only, every new pin proven by a targeted
    mutant that BIT, 10/10): the payment-FLAVOR pin on the controller sink
    (an unknown wallet message renders signFailed, never signFailedConfirm)
    and the Exchange sign-slice pins (kind bridge, flavor payment, no
    err.message); the activity item join reached through TWO listings with
    DIFFERENT items in both pg suites (a single-listing seed passed a
    de-correlated lookup); the cooldown max-combiner in the direction where
    the per-listing re-claim outlasts the cap drain, pg AND fake (every
    prior both-arms case had the cap later, so cap-wins survived); the
    Pay-in-flight repaint (wocTradePaying in the signature, the buyer twin
    of the seller's Accept pin); the signature's structural quote projection
    (figures yes, transactionBase64 never, all four in-flight flags); the
    exact offerExpiresAt line (non-empty had accepted any note); the quote
    review's quoteExpiresAt line present, and absent with no wire expiry,
    plus the announced title; the role-correct paid-line negative (the buyer
    arms had pinned the SELLER's phrase); the open-session check on every
    closed arm; rel/target on the terms link; the usd_text sweep and the
    wallet-bridge drift corpus on the shared single-pass stripper (the
    block-first form hid about 2.7k chars of src/net from the sweep; no
    offender surfaced once visible). JUDGED no change: the CSS-scan pin for
    the consent link's color token (no sibling pin exists to mirror, the
    mobile floor pins own the link's contract, a token-value pin freezes
    styling); the WocMarketWindow source-text pins (the behavioral rig is
    15's, already deferred above); the retryAfterSeconds <= 0 arm (unreachable
    behind the service floor, the junk-value arm pinned). GATE re-run on the
    committed tree at 58212e3475: PASS, all 12 steps green (full-suite
    fallback, 2891 test files / 41139 tests, browser 19 / 129, freshness +
    malware + ci:changed + tsc + every build; tree clean after); pushed per
    R4 right after.
- 13 listing-step-up (2026-08-16/17, GAME repo, session start 19e4cd87ce =
  the 12 QA docs tip, release sync a no-op at 0 behind origin/release/v0.39.0
  tip d2d1a8ad5c; ~16 code and doc commits to tip 813e2a51e0, LOCAL not pushed
  per R4; validation npx tsc --noEmit clean, all market suites +
  snapshots/env_protocol/bandwidth + architecture + monolith + i18n gates
  green, FIVE market pg suites green zero skips WITH TEST_DATABASE_URL,
  ci:changed exit 0; GATE GREEN at ae1ba36b87: node scripts/gate_select.mjs
  full-suite fallback, all 12 steps, 2855 test files (1 env-gated skip) +
  browser 19 files + all builds, run WITH TEST_DATABASE_URL so every pg suite
  executed inside it). Closes B6 and the browser-only-gate medium. The registry
  the 13-qa session needs:
  - BOTH RULINGS RECORDED FIRST (docs commit 6e4664e9a1, before code): R1
    threshold = step-up on EVERY custody-moving call, NO env knob (a low-value
    carve-out is the B6 attack surface; no knob = no misconfiguration surface).
    R10 = a locked item copy (issue 3042) REFUSES $WOC exchange listing with a
    typed woc_market.item_locked code, matching the salvage/craft/vendor
    posture; the gold-market allow posture and the inherited-mark hygiene are a
    deferred follow-up (22).
  - THE STEP-UP PROTOCOL (its OWN sibling module server/woc_market_stepup.ts,
    never grown into woc_market.ts): a single-use, 5-min, server-built
    wallet-signed challenge. verifyStepUpProof owns the refusal ladder
    (invalid / expired / wallet-relink / binding / ed25519 via
    verifySolanaSignature); stepUpBindingDigest is a sha256 over operation +
    the COPY fingerprint (itemCopyPin: id + instance, not just id) + format +
    every money figure + offerNext (create) or offerId + item + agreed price
    (accept). buildStepUpMessage names the action, the copy (sanitized:
    copyDescriptor strips control chars by code point + length-caps, so an
    attacker instance string cannot line-forge the popup), the realm, nonce,
    expiry. The store rides the WocMarketDb seam: createStepUpChallenge,
    consumeStepUpChallenge (atomic DELETE ... RETURNING scoped realm+account,
    expiry NOT judged in SQL so the verifier answers expired honestly),
    pruneStepUpChallenges (issue-time, the growth bound + the realm-leading
    index woc_market_stepup_challenges_realm_expiry which DROPs the superseded
    single-column one). DDL is additive/idempotent inside WOC_MARKET_SCHEMA
    with the accounts FK cascade + operation CHECK.
  - ENFORCEMENT IN THE SERVICE METHODS, never middleware: guardStepUp runs
    inside createListing (public arm only; args.directed skips it because the
    seller's acceptance already spent an offer-bound proof, and the public
    route structurally cannot set directed, pinned) and inside
    acceptDirectedOffer (side==='seller' only; the buyer stays bearer-only,
    their money path signs its own payment). The public arm FORCES
    expectInstance present (null if omitted) so the extraction's stale_copy
    check always runs and the signed = claimed = extracted copy (closes the
    opt-out swap the re-review found). Step-up runs BEFORE business validation
    (no params/eligibility oracle; the accepted cost is a wasted signature on a
    bad param, documented). issueStepUpChallenge validates itemId against ITEMS
    before minting (closes the itemId newline-forge), and the directed arm
    refuses not_found for a legacy null-item offer. Six new refusal codes
    (stepup_required + five verifier reasons) with five non-Latin fills each,
    plus woc_market.item_locked; challenge issue endpoint
    POST /api/woc-market/step-up/challenge on its OWN rate bucket
    (WOC_MARKET_STEPUP_POLICY, 20/min = double the list bucket). The devsig arm
    (signatureRequired false + accept devsig:<nonce>) rides the SAME
    double-gated ALLOW_DEV_COMMANDS + WOC_MARKET_DEV_SERVICE switch as the dev
    economy, so it is production-unreachable; prod verifies real ed25519.
  - DIRECTED REOPEN money-safety: reopenDirectedOffer now resets
    seller_accepted + item_ref (KEEPS buyer_accepted, a liveness choice) so a
    spent step-up proof cannot re-drive custody after a proved-rollback reopen,
    and a relink between the two attempts is re-verified by the fresh seller
    proof.
  - CLIENT (both surfaces): the Exchange window submitListing and the trade
    panel's SELLER acceptance mint the challenge, sign the SERVER message via
    hooks.signMessageBase58 (the same lazy wallet bridge as the payment
    signer, one new hook field wired through woc_market_wiring.ts keeping the
    lazy-load pin green), and send the proof; devsig skips the wallet ONLY on
    an explicit signatureRequired false. Honest states: the trade Accept has a
    re-entrancy guard (wocTradeAccepting) AND a disabled Waiting pending face
    that JOINS the repaint signature (it never painted before the re-review
    caught it) and resets on window close; the decline copy is
    hudChrome.wocMarket.signFailedConfirm (no "payment", since no funds move)
    and the listing busy label is hudChrome.wocMarket.listing (not "Confirming
    on chain"); the locked-copy hint (hintAcceptLocked) fires only when the
    lock is the SOLE obstacle (not an ineligible-category copy). The $WOC
    market is OFF the IWorld seam by design, so no offline mirror; the sim
    token firewall is untouched (isItemLocked extracted to a dependency-free
    item_lock_flag.ts leaf so exchange_eligibility stays a runtime leaf).
  - TOTP RETIRED per R1: the .wm-totp CSS, stale comments, PRD prose, and the
    dead threshold knob (12 removed the .env.example row) are gone; the two
    woc_market.totp_* error codes + their catalog/overlay rows STAY by the
    append-only AIP-193 contract (precedent commit 108665ec2d), each
    comment-marked retired-never-enforced. A scoped guard test asserts the
    market service, routes, step-up module, and styles carry no totp remnant.
    JUDGED DEVIATION (do not re-raise): the phase spec said delete the codes
    "end to end"; that collides with the append-only catalog + the parity
    test's set-equality dimension, so the codes are kept-and-retired, matching
    the paying-side precedent.
  - REVIEWS: four fresh lanes over 19e4cd87ce..1641015d0d
    (privacy-security-review, frontend-seam-reviewer, cross-platform-sync,
    test-coverage-auditor via Agent); the fix round re-reviewed FRESH by three
    lanes (security 1 blocking + 5 should-fix + 6 nits; coverage 3 blocking +
    ~10 should-fix; frontend 1 blocking + 3 should-fix + 6 notes) - the two
    blocking classes BOTH re-reviewers converged on (the copyDescriptor
    line-forge and the expectInstance opt-out swap) plus the frontend blocking
    (the pending face never painted) were all closed in fix-round-2; every
    finding applied or judged with the file open. qa-checklist ran LAST and
    returned READY (0 blocking, 2 should-fix observations); its adversarial
    pass named migration-safety + database-performance as the two lanes not yet
    run, both then dispatched: BOTH returned PASS/no-critical, converging on one
    WARNING (the account_id FK had no covering index, FIXED here with
    woc_market_stepup_challenges_account + a pg index-existence pin) and INFO
    (the operation CHECK is a future-value trap, commented with the
    settlement-state evolution precedent; the retention_sweep registration is
    recommended-not-required, deferred to 17). Mutation: the 10 implement-round
    mutants + 7 first-fix mutants + 5 fix-round-2 mutants (FM8 sanitizer, FM9
    opt-out normalization, FM10 seller-only reopen, FM11 locked-category gate,
    FM12 pending-face sig arm) ALL BIT by name.
  - JUDGED, no code change (do not re-raise): step-up before validation is a
    tiny wasted-signature edge, not an oracle (documented; client pre-validates
    common params); the unknown_item refusal at challenge issue is a nil-leak
    oracle (item ids are public wiki data); resetting only seller_accepted on
    reopen is the deliberate liveness choice (buyer consent is not a custody
    proof); the itemCopyPin `c`/craftedRecipeId slot is null on the public arm
    by design (extraction ignores it too, so binding and extraction agree);
    characterId/itemIndex are unbound because the COPY identity (bound) is what
    matters and is pinned; the window-suite step-up pins stay source-scan
    (comment-stripped betweenCode) with the live-DOM arm deferred to the
    browser suite, since the identical ladder is behaviorally proven in the
    trade-controller rig; the pg suites stay env-gated by standing repo posture
    (20 owns real-SQL gating; this session ran them green zero skips).
  - DEFERRED with owners: 14 (UX honesty / error i18n OWNS localizing the
    wallet bridge's own thrown English strings in src/net/wallet.ts +
    mobile_wallet_deeplink.ts, a pre-existing gap shared with the payment path,
    so the step-up decline still shows English from the bridge on an ordinary
    decline; also the as-of copy carried from 11/12); 15 (screenshot pass MUST
    capture the step-up prompt on desktop AND mobile at the lowest preset, and
    re-capture the TOTP-field "after" shots H13 flagged as stale); 16 (the
    woc_market.ts extraction: guardStepUp/issueStepUpChallenge are thin
    coordinator consumers but the file is still ~4300 untracked lines - 16 owns
    the module_budget row + extraction); 17 (DB retention/indexes OWNS the
    RECOMMENDED-not-required retention_sweep registration for
    woc_market_stepup_challenges: both DB reviewers ruled prune-on-issue + the
    rate limiter + 5-min TTL SUFFICIENT for safety, so 13 added only the
    account-leading FK-cascade index and the CHECK-evolution note; a
    pruneStepUpChallengesBatch + tables[] entry would add the dead-realm drain,
    prune observability, and best-effort prune LIMIT the reviewers noted as P2);
    21 (devnet: observe the real step-up end to end); 22 (the R11 relink
    follow-up is a pre-enable launch gate - see Rulings; also DELETE
    /api/wallet/link's missing rate limit).
  - R11 RAISED (see Rulings, UNANSWERED, pre-enable launch gate): the step-up
    RAISES the bar but is not an absolute "a stolen bearer cannot move custody"
    guarantee, because relinking the wallet needs only the INCOMING wallet's
    signature; a bearer thief can relink first, then sign. Fernando ruled 13
    handles it by the honest-claim framing (module header + DEPLOY.md corrected)
    + this deferral; the wallet-link flow is out of 13's scope. Do NOT re-raise
    as a 13 blocker.
  - RED-FIRST REGISTRY for the QA red-proof lane (each reproduced before its
    fix): (1) a bearer-only createListing and a bearer-only seller
    acceptDirectedOffer both listed/escrowed on the 19e4cd87ce build (no
    stepup_required); (2) a locked copy listed successfully on both the claimed
    and extracted arms pre-39a244f50c; (3) bondCents-style N/A here; (4) the
    seven fix-round mutants and five fix-round-2 mutants each bit exactly their
    named tests (drop expectInstance, drop offerNext, remove itemId-at-issue,
    keep-accepts-on-reopen, dead locked-hint, remove re-entrancy guard,
    never-disable pending face, remove sanitizer, revert opt-out normalization,
    keep-seller-accept-on-reopen, remove locked-category gate, remove
    pending-face sig arm); (5) the copyDescriptor line-forge reproduced by
    direct execution (attacker instance strings forged lines) before the
    sanitizer; (6) the opt-out swap reproduced (omit expectInstance -> escrow a
    different copy) before the public-arm normalization.
  - 13 QA ROUND (2026-08-17, GAME repo, verdict PASS-WITH-FOLLOWUPS, every
    finding applied or judged with the file open; PUSHED per R4). Release sync
    was NON-trivial this time: merge 220b9b018f brought origin/release/v0.39.0
    tip f48c7a3a9b (80 commits: castle branch + icon-art passes), two conflicts
    (generated i18n pending regenerated via i18n:gen; hud.ts monolith ceiling
    re-derived to the exact merged 19170, not either side's number). The
    release-merge-audit ran CLEAN: sim.ts/hud.ts/main.ts/index.html/play.html/
    the styles all exact-union with zero loss, whole-repo tsc clean,
    architecture 109/109, ci_workflow 25/25; the two trap lanes that died on a
    Fable-5 usage limit were re-run inline (release touched NO server/ files, no
    injected-helper signature change, the release-authored db-mock test passes
    on the merged tree). QA range 19e4cd87ce..ae1ba36b87. Baseline: all market
    suites + the FIVE pg suites green zero skips WITH TEST_DATABASE_URL (142/142
    pg). Independent mutation battery: 22 mutants, 21 bit; the ONE survivor (the
    safeMessagePiece code-point control-char arm) was a REAL code AND pin gap,
    closed. Red proof: both reds confirmed at the source (pre-step-up builds
    carried no stepUp param on either custody op; pre-R10 builds had no
    item_lock_flag leaf and no `return 'locked'` arm) and by the guard-removal
    mutation direction. Reviews: privacy-security, frontend-seam, test-coverage
    via Agent + seven probe lanes via workflow; the fix round re-reviewed FRESH
    (security + coverage lenses), which CAUGHT the first fix round's own defects
    and drove a fourth commit (see the RE-REVIEW CORRECTIONS below).
    THE ROUND'S OWN FIXES (commits a996d3c023, 379610f66d, cd689125d4, then the
    correction 234cc9b708):
    * CODE: safeMessagePiece GUARDS a non-string descriptor field to empty
      (the route's optionalInstance is a size-capped UNCHECKED cast, so a
      `{signer:{length:1}}` reached charCodeAt and answered 500; the first fix
      used String(), which the re-review showed STILL throws on {toString:1},
      so the final form is typeof-guard-to-empty) and strips C1 (0x80-0x9f,
      e.g. NEL) by code point plus the Cf format class and lone surrogates (Cs,
      which node-pg would mangle to U+FFFD and desync the stored message from
      the signed one), capping by code point so an astral pair never splits; the
      newline forge was double-covered by the whitespace collapse, which is why
      the code-point arm was both unpinned and incomplete. woc_market_window
      close now rides a GENERATION COUNTER (busyGen), not a flat busy reset: the
      re-review showed a flat reset breaks the invariant that busy means "a
      mutation is in flight" (pollFromServer gates on it) and lets an abandoned
      run's finally clear a newer run's guard, enabling a second createListing
      (a double-escrow for two identical copies). close() bumps busyGen, withBusy
      settles only if it still owns the generation, and submitListing captures
      the index up front and bails after each await when a close moved the gen.
    * TESTS (every new load-bearing pin mutation-proven by name): a
      devsig-wiring source pin over server/main.ts (stepUpDevSig is the
      ALLOW_DEV_COMMANDS && WOC_MARKET_DEV_SERVICE conjunction, never a literal;
      a flip to true is a TOTAL production bypass that left every other test
      green); the TTL literal pin (was a constant-self-compare); the no-oracle
      PARAMS half (a bad price combo reads stepup_required); the directed-accept
      relink refusal; the realm-leading prune index + superseded-index-absent
      pins; the directed offerId decode bound + the pre-branch expectInstance
      decode; the mislabeled locked-extraction test rewritten so the extraction
      actually runs (null-claim over a locked copy -> stale_copy, extractAttempt
      recorded, copy restored); the null-copy escrow test's exact stale_copy
      reason; the comment-stripped route-to-policy scan; the trade-panel
      signFailed anti-pin (signFailedConfirm is a superstring); the
      absent-signatureRequired behavioral case (the client still signs); the
      wocTradePaying close-reset assertion; C1/Cf/non-string sanitizer +
      Format-line + CSPRNG-source pins.
    RE-REVIEW CORRECTIONS (commit 234cc9b708, driven by the FRESH re-review of
      the fix round - the fixes were unreviewed code): (1) the String() coercion
      still threw on {toString:1} and the pin missed it because {length:3} has a
      callable toString - the sanitizer now guards to empty and the test uses the
      reachable trigger; (2) the flat window busy-reset broke two documented
      invariants and enabled a double-escrow - replaced with the busyGen
      generation counter + capture-index-up-front + post-await bails; (3) the
      devsig-wiring pin was comment-gameable (a comment quoting the wiring above
      a `true` line would ship the bypass green) - now comment-stripped AND
      bounded to exactly one stepUpDevSig site; (4) the superseded-index pin was
      vacuous (the old index is never created on a fresh DB) - now seeds the old
      index and re-runs the real boot to prove the DROP removes it. Also added
      the PAY-path absent-signatureRequired behavioral cover, the message-less
      decline fallback pin, the offerId type dimension, the node:crypto nonce
      provenance, the lone-surrogate sanitizer arm, and routed the two new source
      scans through the shared stripComments. Every corrected pin re-mutation
      -proven by name (the three sanitizer arms, the devsig flip, the DROP-index
      removal). NEW deferral: a live-DOM behavioral rig for WocMarketWindow
      (which has no instantiation harness today, so the busyGen fix is source
      -pinned for structure) is owed to 15, the window UX-honesty phase.
    GATE REMEDIATION (two merge-induced infra reds, neither a marketplace
      defect; commits 2d597f6395 and 4835b3ce8c): (1) the v0.39.0 sync widened
      the ci:changed base scope, surfacing a pre-existing non-null assertion in
      a trade-controller test and a line-wrap the busyGen pin left unformatted -
      both fixed on the touched files. (2) The merge updated
      patches/three@0.185.1.patch and the lockfile, so node_modules was stale
      and the release's degenerate-normal three-bundle test failed; a
      pnpm install --frozen-lockfile re-applied the patch (LESSON: any merge
      touching patches/ or the lockfile needs a reinstall). (3) The merge's union
      of both parents' new test files dropped the shard-weight table below the
      95% coverage floor (each parent was just above it; ci_shard_partition
      completeness pin) - refreshed by merging real local durations for the 151
      newly-uncovered non-browser suites, preserving every CI-harvested weight so
      the balance/heavy pins are undisturbed. Gate GREEN after these on the final
      tip.
    JUDGED, no code change (do NOT re-raise): the frontend BLOCKING (the R10
    hintAcceptLocked dead end) is RECLASSIFIED should-fix and DEFERRED to 15 -
    it is not a custody bypass (the spec's blocking bar), and there is NO
    security or custody hole because createDirectedOffer refuses a locked copy
    at listingEligibility -> exchangeHardLock, so the directed offer pin is
    always UNLOCKED and the server would accept after an unlock; the bug is the
    client's frozen sim.tradeInfo.myOffer snapshot, and `locked` is part of copy
    identity (structurallyEqual / itemCopyPin), so a robust fix touches the sim
    trade-snapshot refresh (with acceptance-reset side effects) and is out of
    the B6/R10 charter. The two-ops race is proven at the store layer (atomic
    DELETE...RETURNING) and guardStepUp is strictly consume-then-verify with no
    verify-before-consume path, so no end-to-end two-createListing test is owed.
    The shape screen caps signature at 256 vs decodeBase58's 128: a 129-256 char
    sig passes the screen then fails decode as signature_invalid, a refusal
    either way (defense in depth, left). directedBuyerAccount absent from the
    create_listing binding is no live gap (createListingHandler hardcodes null;
    a satisfies-exhaustiveness link is a future-value note). characterId/
    itemIndex stay unbound because the COPY identity is bound and pinned. The
    devsig "absent means sign" rule lives in four client sites, all source-scan
    pinned; a shared resolver is optional.
    DEFERRED with owners: 14 (ux-honesty) - the wallet bridge's own thrown
    English (src/net/wallet.ts, mobile_wallet_deeplink.ts's "wallet app did not
    return in time") still renders untranslated at BOTH new decline sinks
    (window line ~1849, trade controller line ~406), pre-existing and shared
    with the payment path; 15 (ui-polish) - the R10 lock-hint dead end (full
    mechanism above; fix = re-push the offer on a staged copy's lock change, or
    resolve the lock from live inventory), the Exchange sell picker silently
    filtering locked copies with no "why" (woc_market_view.ts, unlike the trade
    hint), re-capture the stale TOTP screenshots (4 of 10 in
    docs/screenshots/woc-market/ still show the removed field, H13), and the
    "Waiting for your wallet" busy label that shows before the mint and through
    the dev arm; 17 (db-retention) - the retention_sweep registration for
    woc_market_stepup_challenges (DB reviewers ruled prune-on-issue + rate limit
    + 5-min TTL sufficient, unchanged); RELEASE MAINTAINER - the two retired
    woc_market.totp_* keys sit in 15 locale pending blocks, so
    I18N_RELEASE_TIER=1 hard-fails until filled (pre-existing; the keys predate
    13). NOTE ONLY (out of scope, pre-existing, not in the 13 diff):
    server/wallet_link.ts:35 carries an em dash in a comment; the gate copy scan
    is changed-files-only so it does not red, but it is a standing rule
    violation for a future unrelated cleanup.
- 12 wire-completeness (2026-08-16, GAME repo, session start a6ff42f1c5 =
  the 11 QA tip, release sync no-op at 0 behind origin/release/v0.39.0
  d2d1a8ad5c; 8 code and doc commits to tip bd089672f9 plus this entry's
  docs commit, LOCAL not pushed per R4; validation
  npx tsc --noEmit clean, all market suites + snapshots/env_protocol/
  bandwidth + i18n gates green, real-SQL suites zero skips WITH
  TEST_DATABASE_URL, ci:changed exit 0, gate_select recorded in
  progress.md). The registry the 12-qa session needs:
  - H8 CLOSED both halves: estimateView carries split (the client already
    rendered it: the Fee / You receive lines light up with no client
    change; the standing-offer poll now ALSO stores the adoption estimate's
    split so a window reopened mid-deal renders them) and quoteView carries
    signatureRequired (the dev-economy payment path's skip-the-wallet
    switch; fail-safe absent-means-true on the client) plus the new
    bondCents. settlementView carries a SCREENED failReason; both confirm
    handlers carry a SCREENED pending reason. The wire-pin suite
    (tests/server/woc_market_wire_pins.test.ts) pins every market
    serializer's EXACT sorted key set through the REAL route handlers plus
    value/screening arms; mutation-proven (drop bit 3, rename bit 4,
    vocab-member delete bit 2 suites, raw-passthrough bit 1).
  - BOND CONTRACT ADOPTED (the LOUD 09 handoff): placeBid sends
    bidCents = the inserted row's amount with NO echo and adopts the
    response's bondCents; refresh echoes the STORED figure and re-quotes
    exactly ONCE through a bond_amount_drift refusal (which carries the
    expected figure); adoption is BOUNDED by adoptableBondCents (positive
    integer at or under the bid; out-of-bounds refuses quote_unavailable
    fail-safe; deliberately NOT clamped to BOND_MAX, the service owns its
    cap; the bid bound transitively protects the INT column) and rides the
    signature-fenced setBidBondQuote CAS (pg-proven both arms: a signed
    bond keeps figure AND reference); a post-drift success without a
    figure refuses (never persists a refuted number); an absent figure on
    the PLAIN path falls back (older service); BOTH re-price paths re-run
    guardBalance when the adopted figure exceeds what the first guard was
    sized with; the drift echo is pre-screened (an unadoptable carried
    figure refuses after ONE call). woc_market_rules.ts bondCents() moved
    round -> ceil (the service's rule; pinned at the half-cent boundary
    2001 -> 101) and is DEMOTED to render-only (pre-quote display:
    minNextBidBondCents and the balance-guard estimate; the decision on
    the pre-quote display source is: keep the mirror, drift self-heals
    through adoption). The dev economy mirrors the whole contract (ceil
    bond from bidCents, drift refusal carrying the figure, echo round
    trip) and its settlement quote legs moved from floor 90/3 to the
    shared ceil-and-remainder devSplit (the 09-named cent-level drift).
    The bond prompt labels itself from out.bond.bondCents ?? the row.
  - ANTI-SNIPE ALLOWLIST (the 10 residual): the pending-arm extension now
    fires ONLY on WOC_MARKET_LEDGER_MATCHED_REASON = 'awaiting_finality'
    (rules.ts constant with rationale; red-first: not_yet_visible and a
    null reason extended on the old denylist). service_unavailable,
    not_yet_visible, null, and unknown words extend nothing (service-level
    always-run arms for all three plus the pg three-word matrix asserting
    outcome shapes). The abandon-exemption list deliberately did NOT gain
    awaiting_finality: it is a PENDING word, pending arms return before
    any fail_reason write, and a confirming settlement never reaches the
    abandon recorder (the expiry sweep expires only offered/failed rows),
    so a member would be a dead alternate; the rules.ts comment records
    the reasoning and the re-judge trigger. An UNRECOGNIZED pending word
    now warns once per word on the dev channel (the allowlist otherwise
    fails silently toward never extending on a service rename; tested).
  - TWO-SETTLED TOLERANCE (the 09/10 handoff): verified the game is
    reference-keyed end to end and never queries by memo (the
    WocMarketEconomy interface header now states the contract); the bond
    leg is structurally safe (its re-quote CAS refuses once a signature
    exists); the settlement leg's revival re-quote RETIRES a
    (reference, signature) pair and now logs it (clamped to printable
    ASCII, once per retirement, scoped to rows with a RECORDED signature;
    an unsigned re-quote is the routine refresh and traces nothing, with
    the comment recording that the service still holds an unsigned retired
    quote by memoRef). Pinned: the revival flow confirms ONLY the fresh
    stored reference (confirmAsked spy), the trace names the retired pair,
    a first quote and an unsigned re-quote trace nothing.
  - VERDICT LOCALIZATION: rules.ts owns the two screened vocabularies
    (WOC_MARKET_WIRE_PENDING_REASONS sorted-literal-pinned;
    WOC_MARKET_WIRE_FAIL_REASONS 24 words, sorted-literal-pinned after the
    audit caught the constant-self-comparison sweep; unknown words
    collapse to the stable 'other'; rows and logs keep verbatim words for
    operators). The client maps through the new
    src/ui/woc_market_reason_text.ts (the api_error_i18n pattern; maps
    exported for the drift pin: mapped words must be vocabulary members
    and the deliberately-generic remainder is pinned as a 20-word
    literal). Nine hudChrome.wocMarket keys with all five non-Latin fills
    (M16): four terminal burn/credit verdicts, three pending kinds, two
    NON-CAUSAL generics (the audit caught "did not match" accusing late
    payers; now "This payment could not be completed."). Renders: the
    Exchange failed row's WHY line (gate decided in the VIEW CORE as
    failDetailReason: failed rows only, expired rows excluded because the
    sweep COALESCEs a chain-refused try's reason across expiry;
    behaviorally tested), the repaint signature digests the verdict (a
    revival can change it while state stays failed), the
    still-confirming settlement toast stopped claiming purchase complete
    and says WHICH pending, the bond pending toast likewise, the trade
    arm logs the same line and names the review state (the Exchange
    parity the review caught). Window source pins are comment-stripped.
  - ENV TRUTH: .env.example gains WOC_MARKET_SERVICE_URL (with the
    distinct-from-claudium and /v1/market/price probe guidance) and
    DASHBOARD_INTERNAL_SECRET (names only), drops the dead
    WOC_MARKET_TOTP_THRESHOLD_CENTS row (13 still owns deleting the code
    scaffolding per R1; the PRD sentence trued up). The guard test
    (tests/server/woc_market_env_docs.test.ts) sweeps an explicit corpus
    in BOTH directions (undocumented read; dead documented knob across
    all three prefixes) with a positive control naming the two original
    misses one per extraction form and a market-prefixed corpus-reality
    arm; mutation-proven both directions. DEPLOY.md gains the market
    block: the honest health probe, the bidirectional deploy coupling,
    the awaiting_finality reservation as a named breaking change, and the
    dashboard-secret bullet. server/CLAUDE.md and src/ui/CLAUDE.md record
    the new seams.
  - REVIEWS: four parallel lanes over the five-commit base
    (cross-platform-sync 0 critical / 4 warnings; privacy-security 0
    critical / 3 warnings; frontend-seam 0 blocking / 5 should-fix;
    test-coverage 2 BLOCKING test gaps, both closed: the unpinned confirm
    screening and the fail-vocabulary self-comparison), the fix round
    fe195677ad re-reviewed FRESH (0 critical / 4 warnings, all applied in
    65d4ddfc2c; its test lane was cut off, and its named test checks were
    judged in the main loop with files open), qa-checklist READY (0
    blocking; its 2 should-fix + 2 suggestions applied in bd089672f9).
  - JUDGED, no code change (do not re-raise): the dev economy never
    answers a pending confirm (deliberate dev asymmetry; the pending
    vocabulary has no offline path and 21 observes the real words); the
    confirm endpoints as a weak matched-vs-unseen oracle (info gain nil
    on a public chain, owner-gated, rate-limited); signatureRequired is
    presentation-only (the server verdict still decides; a spoofed false
    buys nothing); the balance re-guard can surface market_paused after
    the insert (any guardBalance refusal is honest; same class as the
    pre-existing quote_unavailable path); the controller split pin reads
    private state (accepted at the extraction seam); the pg suites stay
    env-gated by standing repo posture (20 owns real-SQL gating; this
    session ran them green zero skips); the game-side signature regex
    tightening SKIPPED as the 10 registry allowed (the service owns shape
    via isPlausibleSignature; the game's SIGNATURE_SHAPE screen stands);
    expired-row game-written words (listing_cancelled, listing_suspended,
    schema_dedupe) stay OUT of the fail vocabulary (never rendered;
    screen to 'other' harmlessly; comment records it).
  - DEFERRED with owners: 14 (UX copy breadth: specific lines for
    quote_expired / transaction_failed / refunded / superseded /
    confirming_overdue now the wire carries them; the as-of copy re-judge
    from 11; the notice channel stores resolved strings so a runtime
    language switch leaves stale text, pre-existing, the pending toast is
    the longest-lived; pending-reason UX polish beyond the toast); 15
    (hoist the trade controller's log-color hex literals to constants and
    add the hex scan; the fee-line visual check rides the screenshot
    pass); 19 (dashboard may render settlement failReason and the
    confirmingExpired24h attention field); 21 (devnet: observe the real
    pending words end to end, verify the awaiting_finality reservation
    against the live verifier, note the dev-economy pending asymmetry);
    21/22 service rounds (the /v1/health matrix still has NO
    market-settlement rail at 270e337 and its 'marketplace' rail names
    keeper keys this market never reads: add a market rail keyed on real
    names or document the absence; game-side ops guidance already keys on
    /v1/market/price); 22 (runbook: the bidirectional deploy coupling and
    the reserved-word breaking-change rule).
  - RED-FIRST REGISTRY for the QA red-proof lane (all reproduced before
    their fix): (1) the wire-pin suite ran 14 red on the c6cf146cec^
    build (split, signatureRequired, failReason, confirm reasons all
    missing); (2) bondCents(2001) answered 100 under round (ba4d44f890^);
    (3) not_yet_visible and a null reason both extended the close on the
    55917385bd^ denylist (service-level, unwrapped outcomes); (4) the
    controller discarded the adoption estimate's split (stash A/B red on
    e9b8dfaee0^); (5) the env guard red in both directions on mutation
    (dead row re-added; documented row removed); (6) the fix-round pins
    proved their mutants: raw-passthrough screen, vocab-member delete,
    echo recompute, sig drop, each bit exactly one named test; (7) the
    refresh re-guard and skip-echo tests are constructionally decisive
    (first guard passes by construction; one call asserted).
  - 12 QA ROUND (2026-08-16, PASS-WITH-FOLLOWUPS, every finding applied
    or judged with the file open; seven fix commits ef1d825236,
    e0c4eee393, 8484a3ce50, 8402dc5f93, 1b28affbbe, 88cc70c61d,
    9ae040b680 on the audited tip; PUSHED per R4). The registry 13
    consumes:
    - VERIFIED: all four earlier red proofs REPRODUCED-RED exactly as
      recorded (14 red wire pins; the ceil pin alone; both anti-snipe
      arms plus the revival trace; the split-adoption test), the env
      guard red both directions, claim 7 judged decisive with the file
      open. Round-1 mutation battery 17 mutants: 16 BIT, ONE SURVIVOR
      (devSplit ceil-to-floor: no absolute leg pin existed at an odd
      amount) closed and re-proven; new-pin battery 18/18 BIT (incl.
      that survivor by name); wave-3 battery 10/10 BIT (both bond-leg
      and the settlement-poll fail-warn call sites, the cancelPending
      status gate, the status healthy-value hardcode, the badge render,
      the trace-before-CAS revert, the finish split clear, the walk
      classifier, the devsig branch inversion). Wire lockstep verified
      BOTH directions cross-repo (xplat: 59 fields, every vocabulary
      word the service emits is a member, the awaiting_finality
      reservation confirmed downstream of a real ledger match in the
      service source at 270e337; asOfMs number|null untouched).
    - THE ROUND'S OWN FIXES (beyond the implement round's claims): the
      anti-snipe extension now ALSO fires on a POLL-settled bond, from a
      fresh per-row clock (the allowlist had un-extended the honest
      bidder whose synchronous confirm raced chain visibility and whose
      bond the ledger then settled; a fabricated string never settles,
      so the allowlist posture holds); the verdict drift channel gained
      a fail-side twin on BOTH legs including the rowless bond leg (a
      refused bond keeps no fail_reason anywhere), logSafe-keyed dedupe,
      a 100-word cap with one suppression line, and logSafe moved to the
      intake screen's 256 so a full signature survives for exact-match
      reconciliation; the retirement trace emits only AFTER its CAS
      lands; the refused-signature warn joined the clamp; listingView
      gained cancelPending (gated on active status: the stamp is never
      cleared) and directed booleans, serialized AND rendered as
      Activity badges with five non-Latin fills; the status wire price
      is PROJECTED (the verbatim service operational reason word no
      longer crosses; values pinned, not just keys); the placeBid
      response bid mirrors the row's quote expiry; devSplit clamps its
      ceil legs so a sub-floor estimate cannot mint a negative seller
      leg (legs byte-identical at and above the 25-cent floor,
      brute-verified); the Exchange window honors signatureRequired
      false via the trade arm's devsig skip (branch ORDER pinned) and a
      bond re-quote re-labels the prompt from the adopted figure; the
      two payment surfaces make the SAME claim about a confirmed or
      delivering answer (the trade arm's ladder mirrors the window; a
      failed retry is refused server-side and cannot reach the settled
      line); the adoption-stored fee split dies with its deal at all
      four offer-clear sites; the bond prompt names the BOND, not the
      bid (quoteBondFor reworded with five non-Latin fills; Latin rows
      re-pend for the release fill); the orphaned bidBondConfirming key
      and fills deleted; woc_market_reason_text.ts registered in the
      pure-core purity scans; the dead wocSettlementInFlight wrapper
      deleted with its membership re-pinned through wocOfferPhase; the
      WHY line renders LAST in its row with its own wrapped-row class;
      wrapper key-set pins for /me, /status, and the three quote
      responses; the pending vocabulary's remainder pinned EMPTY beside
      the fail remainder's 20; a comment-stripped scan pins every
      game-written fail_reason word to the vocabulary or the pinned
      expired-only exclusion trio; the env guard gained the new-reader
      discovery walk (lstat, depth-bounded, classifier positive
      control), a bracket-literal arm, and the PREFIXES-derived corpus
      regex; DEPLOY.md's skew claim corrected (old game refuses; new
      game TOLERATES an old service by mirror fallback at the same
      knobs) with concrete contract-tip probes and per-surface auth
      notes; the render-only-mirror doc claims trued (the mirror also
      sizes the guard and seeds the row).
    - JUDGED this round, no change (do not re-raise): the warn-capture
      test helper consolidation (correct at every site; churn in a
      money-path suite outweighs the ceremony; the helper lands with the
      next new site); bondCentsOf mapping a malformed-present figure to
      the absent-arm fallback (deliberate layering: the drift arm still
      refuses and the wallet signs the service-minted amount);
      keep-last-known-good for a transiently failed adoption estimate
      (mirrors the tokens handling; 14 may polish); the trade arm's
      settled line for confirmed/delivering (the Exchange parity call;
      a distinct confirmed-awaiting-delivery line is 14's copy
      decision); the sub-floor blank fee lines in production (fail-closed
      screen; 14 owns the min-price hint arm); toContain money pins in
      the panel render test (full-line toBe would couple to copy 14
      changes); the fee sum as burn+treasury (the proxy enforces the
      three-leg sum); the dead ?? '' fallback after the null gate
      (harmless defensive); the JSON-stringify-drops-undefined superset
      hole in the wire pins (needs an optional row property a fixture
      leaves unset; fixtures are full rows on purpose); S3's server arm
      not covering this rail (deliberate: the rail emits stable tokens,
      the reason-text suite is the guard); the twin
      WocSettlementView/WocListingView interfaces (pre-existing
      structural-typing seam; the parity lane watches it); the
      poll-anchor two-extensions budget nuance and the
      supersede-still-extends arm (bounded by the anti-snipe cap, needs
      a real broadcast payment); MARKET_BACKFILL_DRY_RUN outside
      .env.example (deliberate ops-flag exception, documented in its
      runbook and the config.ts comment); the wave-3 fresh-clock read
      has no distinguishing test (a fake-clock rig cannot advance
      mid-pass without rebuilding the poll; reviewed by reading).
    - NEW DEFERRALS with owners (on top of the implement round's list):
      14 (render surfaces for quote_expired-class copy AS BEFORE, plus:
      a distinct confirmed-awaiting-delivery line for the trade arm;
      the min-price hint arm for the trade panel with status
      minPriceCents threaded in; the debounce-stale fee lines; the
      wocUsdText Intl currency formatting, suffix-currency locales and
      negatives, trade arm vs Exchange divergence named by the lane;
      offerView.expiresAtMs countdown; bond-flavored pending copy for
      the bond leg now bidBondConfirming is gone); 15 (screenshot pass
      MUST capture: the fee lines as before, the WHY line's wrapped row
      at mobile width with the ru fill, the new Activity badges, the
      activity-row wrap across all three lists); 16 (saleView.item
      ships the full InvSlot per sale row, the heaviest dead wire
      weight); 17 (fail_reason accepts an unbounded service string
      verbatim; bound the column write); 21 (the dev chain's
      dev_chain_unknown_memo / dev_chain_leg_mismatch words will fire
      the pending drift warn on devnet: expected, dismiss knowingly);
      21/22 service rounds (as before, plus: a service-side test naming
      clampedBondCentsForBid against the game mirror closes the
      cross-repo anchor; mirror-vs-service bond drift is invisible to
      operators, a monitoring line or knob-lockstep check belongs in
      the runbook); 22 (runbook as before); 16 ALSO owns the two
      qa-checklist suggestions taken as one unit with its woc_market.ts
      work: extract the drift-warn cluster (logSafe, WIRE_DRIFT_WARN_CAP,
      wireDriftWarns, the three note methods) into a sibling
      woc_market_drift_warn.ts, add a monolith_budget row for
      server/woc_market.ts at the same time, and screen through the
      exported WIRE_*_SET Sets so both screens share one judge; 16/21
      also observe the poll settled-arm's one best-effort listing
      transaction per settled bond per pass under a real burst.
    - CLOSING VERDICTS: qa-checklist READY, 0 blocking, 0 should-fix
      (its adversarial pass independently traced and CLEARED the trade
      ladder against every reachable ok-state, the devsig double-gating,
      the browse booleans as non-disclosures, the round-to-ceil money
      safety, and SETTLING_STATES staying live; it NAMED the
      no-BOND_MAX-clamp property as ruled, not a surprise). Gate GREEN
      at 4377a38458: gate_select full-suite fallback, all 12 steps,
      2854 files / 40635 tests + 2 expected fails, browser 129, WITH
      TEST_DATABASE_URL so every pg suite executed inside it; the four
      market pg suites additionally ran 132/132 zero skips three times
      standalone during the round.
- 11 oracle-health (2026-08-16, SERVICE repo, session start 8da6c03 = the
  10 QA tip, origin/master already contained at df09756; 5 commits, tip
  03df5de, LOCAL not pushed per R4; validation npm run build + npm test in
  service/, 590 tests 583 pass 0 fail 7 env-gated skips default tier and
  590/590 zero skips with CLAUDIUM_TEST_DATABASE_URL, baseline was
  560/553/7). The registry the 11-qa session needs:
  - R3 RULED AND IMPLEMENTED (see Rulings, incl. the review-round
    amendments; game commit e2f189e9a4 recorded the ruling BEFORE code):
    single-venue posture. bootstrap.ts: pythSource gone, sources =
    [birdeyeSource] (or the dev price), VENUE_AGE_SCREEN_OFF_MS exported (the
    market's BirdeyePriceOracle gets Number.MAX_SAFE_INTEGER as maxAgeMs: it
    screens envelope shape, the liquidity floor and future skew only; the
    ORACLE judges age), ORACLE_HEARTBEAT_MS exported. oracle.ts:
    DEFAULT_MARKET_ORACLE_CONFIG.maxSpotDeviationBps 500 (was 1000),
    maxVenueDeviationBps code-owned (marketOracleConfigFromEnv ignores the
    env; every other knob may only TIGHTEN, and only within
    ORACLE_BOUND_RANGES: window [15 min default, 1 h] and never past the
    staleness ceiling, maxAge [default window, 1 h default], minSamples
    [3, 90], spot [100, 500]; decimal integers only; a widening value falls
    back to the default, an absurd tightening clamps to the range).
    MAX_ORACLE_SAMPLES 3600 hard-caps the buffer (oldest out under request
    load). compose and .env.example: the Pyth feed knob and the
    venue-deviation knob removed, spot left blank; compose_conformance.test.ts
    pins both files three ways plus every numeric oracle knob in .env.example
    against the code constants.
  - FRESHNESS (deliverable 3): MarketPriceHealth.asOfMs = the newest FRESH
    venue publish time clamped to the poll clock (never the future; healthy
    and refusals; on an all-stale reading the newest print judged, with the
    spot those prints imply and the standing average still on the readout;
    null only when no venue priced); price() and estimate() carry it (the
    game renders it as "as of {time}"); a PAUSED refusal on either surface
    carries MarketPriceOracle.latest()?.asOfMs, the heartbeat's last reading,
    and never polls the venue (pausedAsOfMs in service.ts).
    Per-venue judgement inside health(): priced requires finite usdPerUnit >
    0, finite publishMs > 0, publishMs <= nowMs + MAX_ORACLE_FUTURE_SKEW_MS;
    ageMs = max(0, now - publish); fresh = ageMs <= maxAgeMs; only fresh
    prints enter the median and the deviation gate; a stale venue is listed
    with price, age and fresh:false; all-stale answers 'stale'. Samples stay
    POLL-stamped for the mean (identical arithmetic in-window; a
    publish-keyed warm-up count would halt a slow republisher), carry the
    newest fresh publish for distinctPrints, and insert in observation order
    (concurrent polls can land inverted; the prune walks from the head).
  - SURFACE (deliverable 4): diagnostics gains distinctPrints, bounds
    (window, maxAge, minSamples, both deviation bounds), venues[] as
    MarketVenueReading {name, usdPerToken, publishMs, ageMs, fresh},
    configuredVenues, liveVenues (= the median array length, passed in, so
    crossVenueGateArmed = liveVenues >= 2 can never claim an armed gate the
    code would not fire); admin.ts overview.price mirrors every field
    (typed, MarketVenueReading re-exported).
  - ONE INSTANCE (deliverable 1, already fixed in 08): pinned in
    market_bootstrap.test.ts under t.mock.timers (setInterval only): prime +
    ticks + reads sample arithmetic in the market's own diagnostics; the
    quiet-period test (20 min of idle heartbeat > the 15 min window, next
    request healthy on price and estimate); the negative control (stop hook,
    mocked time still ticks, venue reads stay flat, then insufficient_samples);
    the structural belt (comment-stripped, whitespace-tolerant count of
    `new MarketPriceOracle(` in the compiled module = 1).
  - OPERATOR SIGNAL: src/market/price_gate_signal.ts createPriceGateSignal
    (halted: reason + newest print age, floored at zero; still halted:
    reason change; recovered: duration + reason), fed by the heartbeat only
    (one poll in flight at a time, the sweep's guard, so edges arrive in
    order), edge-triggered like the sweep warn; a boot logs the honest
    warm-up pair (insufficient_samples then recovered; an alert keyed on the
    halted line must expect it). Pinned directly
    (market_price_gate_signal.test.ts) and through the real wiring (60
    anchored ticks, a 6% print halts once, stays silent, recovers with
    duration; a stalled poll suppresses the next tick's poll).
  - REVIEWS: two fresh lenses on the three-commit diff (security/ops: 14
    findings, 0 blocking; correctness: 21 findings, 1 blocking = the
    cold-boot item, RULED record-and-document), every finding applied or
    judged; the fix round a616f73 was re-reviewed FRESH (18 findings, 0
    blocking, 8 should-fix + 10 nits; the load-bearing ones: the venue-fetch
    mock leaked across the file via MockTracker restore order, the sample
    buffer had no count cap, the tightening direction was unbounded, the
    paused quote path polled the venue, the heartbeat lacked the sweep's
    in-flight guard, and the "5% per publication" claim overstated the
    breaker); its round 03df5de closed by careful self-review (narrow,
    test-covered, 11 mutants bit).
  - JUDGED, no code change (do not re-raise): the cold-boot single-print
    exposure (Fernando: record and document, no gate; runbook note for 22;
    the durable anchor is a named follow-up needing its own ruling); a
    min-span warm-up gate (same decision); the TWAP-equals-last-print
    steady state at the deployed cadence (a doc truth, not a gate change:
    the breaker is a per-publication step limiter); the boot warm-up warn
    pair (honest, two lines per deploy); the structural construction scan is
    belt-only (the sample arithmetic is the decisive pin; a factory wrapper
    would evade the scan, not the arithmetic); the two-parser split
    (positiveInt vs num) is moot for age now that the source does not parse
    the knob; distinctPrints keys on the newest fresh publish per reading
    (documented; a per-venue evidence count is a multi-venue concern the
    posture excludes); the warmed() test helper duplicated in two files (rule
    of three, the repo's own rule); the fix-round commit subject at 82
    columns (style only, the repo requires scope and body); the double
    floating rounding of a multi-sample average (0.0010000000000000002 for a
    steady 0.001 over real-clock spans; the dev-chain pin compares within
    1e-12; the base-unit rounding downstream is pre-existing and unchanged).
  - DEFERRED with owners: 19 (dashboard) renders venues[].ageMs and fresh
    from the SERVICE (its priceVenueRows still derives age from the browser
    clock), crossVenueGateArmed (today "Venue spread: -" is indistinguishable
    from agreement), distinctPrints beside samples, and bounds; 14 (UX
    honesty) re-judges the game copy "Current rate: about {tokens} $WOC per
    USD, as of {time}" now that the time is the venue print (may read oddly
    beside a 45-minute-old time; "venue print" wording is the candidate); 12
    (game wire): nothing owed, asOfMs stays number|null and the game passes
    it through (the dev proxy stamps now(): dev-only twin), noted for
    awareness; 21 (devnet): observe the halted/recovered lines against the
    real venue, confirm the real Birdeye updateUnixTime semantics (last
    trade) and that no false `stale` appears at the real cadence under the
    one-judge design; 22: the manipulation economics (WOC_MARKET_MIN_LIQUIDITY_USD
    25k against WOC_MARKET_MAX_USD_CENTS $100k per quote: a 5% move on a
    $25k pool costs hundreds and is worth $5k on a $100k settlement; the
    reviewer's fix candidate: tie the quote ceiling to the venue's OBSERVED
    liquidity, which birdeye_price.ts already reads), the runbook (pause
    before deploying during a live high-value settlement; the two halt lines
    per incident and the warm-up pair at every restart), and the cold-boot
    anchor follow-up ruling (recorded in the service's TODOS.md too); 17 (DB)
    is the natural home if the anchor is ruled in.
  - RED-FIRST REGISTRY for the QA red-proof lane (reproduced before their
    fix on the 8da6c03 build): (1) asOfMs on the wire and in health = the
    poll clock; (2) a Pyth feed id alone constructs a market; (3) the venue
    knob honored (999999 accepted) and spot at 1000 (a 6% jump passed); (4)
    compose carried WOC_MARKET_PYTH_WOC_FEED_ID and
    WOC_MARKET_MAX_VENUE_DEVIATION_BPS; on the a616f73^ oracle: (5) a print
    24h in the future accepted healthy; (6) a two-hour-old print entering
    the median beside a fresh venue (spot 0.0015 off 0.002 and 0.001); (7)
    no bounds/fresh on the surface; (8) a widening env value accepted; on the
    03df5de^ code: (9) a stalled heartbeat poll stacked behind the next tick;
    (10) a paused estimate polled the venue; (11) a print inside the skew
    allowance logged a negative age. The one-instance claim's red form is
    structural (fixed in 08): the private second oracle mutant fails four
    tests by name.
  - 11 QA ROUND (2026-08-16, PASS-WITH-FOLLOWUPS, every finding applied or
    judged with the file open, 5 commits 03df5de..270e337, PUSHED per R4;
    suite 590 to 595, 588 + 7 env-gated skips default, 595/595 zero skips
    with CLAUDIUM_TEST_DATABASE_URL; the fix-round chain was REWORDED via a
    local-only rebase for commit-message attribution, content unchanged:
    trees 5236897=cda1277, 9c60aa9=7209c52, b865c56=2246046, 5a97aa9=ee19b1c,
    so round evidence citing the old hashes cites identical trees). The
    registry 12 consumes:
    - VERDICTS over 8da6c03..03df5de: red proof 11/11 REPRODUCED-RED on the
      named old builds; mutation: the QA registry named 42 mutants (the
      implement round's 41 plus the .env.example min-samples drift), 41 BIT,
      ONE SURVIVED (the admin overview hardcoding
      crossVenueGateArmed false: the only wire pin asserted false under a
      single-venue rig), closed by a two-venue overview arm and re-proven;
      44 findings, 0 blocking. Registry annotation for any by-name re-run:
      two pins were deliberately renamed by the fix round ('a print the
      VENUE SOURCE accepts is never rejected by the oracle as stale' is now
      'a 38-minute print inside the one ceiling prices healthy end to end
      through the real venue source'; 'recovery logs once with the duration
      and the reason it recovered from' now ends 'and the window depth').
    - FIXES at symbol level: ORACLE_BOUND_RANGES re-sized from the venue
      cadence (maxAgeMs.tightest 3 windows = 45 min, minSamples.tightest 60;
      the R3 amendment note in Rulings records the rationale); read()
      reports refusal windows through the non-mutating windowSamples(nowMs)
      view (samples / distinctPrints / twapUsdPerToken mean what they say
      beside reason: stale, and a spuriously future clock cannot destroy
      state; the stale-spell pin asserts both); marketOracleConfigFromEnv
      gains a warn callback naming every knob whose effective value differs
      from what was written (range clamp, widening fallback, junk, the
      window-outruns-ceiling invariant quoting the operator's raw text, the
      retired cross-venue knob), wired to console.warn in buildMarketApps;
      createPriceGateSignal's recovered line carries the window depth
      (samples and prints; new PriceGateReading type) and floors the
      duration at zero; MarketAdminOverview.price gains spotUsdPerToken and
      twapUsdPerToken; the oracle header states the sub-bound compounding
      corollary and the recording-gap predecessor exposure (cold boot, venue
      silence past ceiling plus window, outage, liquidity-floor dip: one
      recorded class).
    - PINS CLOSED (16 round-2 mutants BIT in two groups, plus the four
      rework pins BIT by compiled-dist mutation at the final tip): cap
      eviction direction (oldest out, price-step fixture), off-default
      bounds all five fields, literal tight ends with the cadence and margin
      asserts, parser warn lines exact incl. the two-line clamp-plus-outrun
      case, exact skew and staleness boundary edges, both healthy 38-minute
      venue rows, the env-to-surface bounds arm through buildMarketApps, the
      two-venue overview arm (armed flag, median spot AND twap by value),
      paused settlementQuote and the cold-pause null, request reads not
      moving the operator signal, MAX_ORACLE_SAMPLES and
      VENUE_AGE_SCREEN_OFF_MS as literals, the .env.example discovery sweep
      in compose_conformance.
    - JUDGED, no code change (do not re-raise): the structural construction
      scan stays belt-only (re-affirmed); the boot warm-up pair's 10s/20s
      arithmetic assumes a quiet healthy-venue boot (the doc says so); the
      compose and template sweeps see bare line-anchored numerics only
      (house style, tolerable until the template grows commented values);
      the future-print venue row stays nulls (the real source screens future
      prints to null before the oracle sees them, so the row cannot carry
      what never arrives; the host-clock runbook note covers diagnosis);
      commit subjects near 80 columns (ruled class).
    - DEFERRED with owners (amends the implement round's list): 19
      (dashboard) also renders spotUsdPerToken / twapUsdPerToken beside the
      deviations and the recovered line's depth vocabulary if it surfaces
      logs; 16 (game hot path) plus 22 (economics) own the recorded SEC-9
      mechanism: request-path reads record oracle samples and the game
      proxy's estimate cache is keyed per usdCents, so a client varying the
      amount can shorten the effective averaging window under the sample cap
      (candidates: heartbeat-only recording or a per-second recording
      limit); 22 also owns the adapter body-timeout observation (the venue
      fetch timeout covers headers only; a stalled body parks every poll on
      undici's default for minutes, fail-closed) alongside the runbook, the
      economics and the cold-boot anchor ruling; 21 (devnet) observes the
      halted/recovered lines now carrying the window depth, and the real
      Birdeye updateUnixTime semantics; 14 unchanged (the as-of copy); 12
      unchanged (nothing new owed; asOfMs stays number|null pass-through).
- 10 chain-verifier (2026-08-14, SERVICE repo, session start 02713f2 = the
  09 QA tip, origin/master already contained at df09756; 6 commits, tip
  ba7df0b, LOCAL not pushed per R4; validation npm run build + npm test in
  service/, 536 tests 530 pass 0 fail 6 env-gated skips default tier and
  536/536 zero skips with CLAUDIUM_TEST_DATABASE_URL, baseline was
  508/502/6). The registry the 10-qa session needs:
  - B4 CLOSED, sufficiency plus necessity: settlement_proof.ts
    (service/src/market/) adds two pure checks the verifier runs after the
    leg checks and before the payer-debit check: burnedBaseFor (a real SPL
    Token burn of the quoted mint NAMING the quoted payer under either
    jsonParsed authority label, burn and burnChecked, both token program
    labels, inner instructions flattened, amounts summed, malformed amount
    strings parse to 0n) and unexpectedCredit (reverse walk of the delta
    map; any positive delta outside payer-plus-expected refuses). Reasons:
    burn_missing (no burn of the quoted mint under the payer), burn_mismatch
    (wrong total), unexpected_credit; the wrong-mint settlement stays
    leg_mismatch, so the acceptance bar's triple is pairwise distinct.
    Check order legs -> burn proof -> whitelist -> payer debit; order
    affects reasons only, never admission (conjunctive refusals).
  - R5 RULED AND IMPLEMENTED (see Rulings; game commit 71f36c695f recorded
    the ruling BEFORE code): MATCH_COMMITMENT 'confirmed' /
    CREDIT_COMMITMENT 'finalized' (solana_chain.ts, code-owned, no env
    knob), behaviorally pinned (the fake connection records the read
    commitment; the three-status finality matrix pins crediting).
    MAX_CONFIRMING_AGE_MS five hours (quotes.ts, code-owned): both stores'
    expirePastDue gain a confirming arm (to expired, reason
    confirming_expired, submittedSignature preserved so entry adoption
    stays the recovery path), pending arm first with the budget shared,
    oldest expiry first in both stores; pg gains the
    woc_market_quotes_confirming_due partial index and outer status+due
    guards on BOTH arms (the pre-existing pending arm was subselect-only
    and could expire a concurrently settled row under EvalPlanQual).
    buildMarketApps now drives expiry with a one minute unref'd interval
    (stopExpirySweep beside stopOracleHeartbeat): expireStaleQuotes
    previously had ZERO production callers, so NOTHING expired quotes on a
    live deployment, pending rows included.
  - VOCABULARY SPLIT (the anti-snipe service half): confirm's undecided
    arms answer the verifier's own reason (not_yet_visible on the live
    chain; dev arm surfaces its dev_chain_* words by design) and
    awaiting_finality is reserved for the MATCHED arms plus the reason-less
    fallback and the raced stored-row answer. pending:true is unchanged, so
    the game wire is compatible today.
  - REVIEWS: two fresh lenses on the final diff (security: 1 should-fix +
    7 nits, 0 blocking; correctness: 1 should-fix + 9 nits + 1 observation,
    0 blocking), every finding applied or judged; the fix round ca568cc was
    re-reviewed FRESH (1 should-fix + 3 nits + 1 observation), its round
    ba7df0b closed by careful self-review (narrow, test-covered,
    mutation-proven).
  - THE REFUTED REFUTATION (the round's big lesson, judged with the parser
    argument in view): the fix round removed the multisigAuthority
    acceptance arm on an on-chain-impossibility rationale; the fresh
    re-review proved the rationale FALSE (agave's jsonParsed picks
    authority vs multisigAuthority purely by the instruction's account
    count while the token program's single-owner branch ignores trailing
    accounts, so multisigAuthority-equals-payer is an ordinary, executable,
    honestly-paid burn) and the removal would have terminally rejected real
    money (rejected rows never re-verify). ba7df0b restored the arm
    (either label must NAME the quoted payer; economics forced by the
    delta and debit checks) with positive and negative pins.
  - JUDGED, no code change (do not re-raise): owner-less token balance rows
    stay invisible to the delta map and whitelist (refusing would convert
    an RPC quirk into terminal rejections of real payments; not
    attacker-reachable via transaction shape on an honest RPC; documented
    at the site); delegate-authorized burns stay refused fail-closed
    (documented; the built transaction burns under the owner); the
    edge-triggered status-outage warn accepts flap noise (hysteresis would
    add clock state for log cosmetics); unref on the sweep interval is not
    directly asserted (matches the heartbeat's accepted standing); pg tie
    order under equal expires_at_ms is unspecified and may transiently
    differ from the memory store under a binding budget (converges next
    sweep; commented).
  - JUDGED SURVIVOR (mutation, recorded): deleting the pg pending-arm
    ORDER BY fails nothing because the planner's partial-index scan order
    coincides with sorted order on this table shape; the pin IS decisive
    against real order regressions (the DESC variant bites by name) and
    the clause is correct-by-construction. Fifteen other mutants BIT by
    name under full-suite runs (list in progress.md).
  - DEFERRED with owners: 12 (game wire) owes tolerating and localizing
    the new reasons (not_yet_visible pending; burn_missing, burn_mismatch,
    unexpected_credit terminal; confirming_expired is ops-visible only,
    terminal entry answers 'expired') and gating the anti-snipe extension
    on the matched arm (awaiting_finality), closing the fabricated-
    signature residual; 21 (devnet) verifies the jsonParsed label
    assumptions against a real RPC (spl-token-2022 label string, the
    multisigAuthority count-labeling, burnChecked info shapes) and
    exercises the burn proof end to end per the wiring doc's test plan; 22
    re-judges the pre-existing uncaught getParsedTransaction throw (a full
    RPC outage rejects out of confirm through the route as a 500; distinct
    from the degraded-statuses arm the new warn covers) and the inherited
    connectionTimeoutMillis note. The game review-state resolution arms
    (H15's review -> confirmed / review -> failed) can now build against
    the service's stable five-hour verdict: that stays with 12/14 as
    already registered.
  - RED-FIRST REGISTRY for the QA red-proof lane (all reproduced before
    their fix, on the 02713f2 build): (1) burn-redirect, (2)
    short-burn-with-redirect, and (3) extra-credit-rider each verified
    MATCHED by the old verifier (the B4 exploit class; five more vectors
    were reason-contract reds); (4) the confirming five-hour bound
    (expireStaleQuotes returned 0 and the row stayed confirming, service
    and pg arms both); (5) the pg schema pin for the confirming-due index
    red at 02713f2; (6) both vocabulary-split arms (unseen and
    terminal-entry undecided answered awaiting_finality). The sweep
    driver's red form is structural: expireStaleQuotes had no src caller
    at 02713f2 (grep evidence), and stopExpirySweep fails tsc there.
  - 10 QA ROUND (2026-08-15, PASS-WITH-FOLLOWUPS, every finding applied or
    judged with the file open, 5 commits ba7df0b..8da6c03, PUSHED per R4;
    suite 536 to 560, 553 + 7 env-gated skips default,
    560/560 zero skips with CLAUDIUM_TEST_DATABASE_URL). The
    registry phase 11 consumes:
    - THE MULTISIG CALL, judged with the parser and the token program open
      (agave parse_token.rs parse_signers: 'multisigAuthority' iff
      accounts.len() > 3, no multisig-existence check; spl-token
      validate_owner's non-multisig branch ignores the trailing slice;
      process_burn passes it; a fee payer must be system-owned so a real
      multisig can never be keys[0]): ba7df0b's restoration is CORRECT and
      money-safe; refusing the label terminally rejects honestly-paid burns.
      Also from parse_instruction.rs: agave labels BOTH token programs
      'spl-token', so 'spl-token-2022' is a defensive alias it never emits
      (comment and test trued; the 21 label check narrows to "confirm the
      alias is inert on the chosen RPC").
    - FIXES at symbol level: MarketChainVerifier.isPlausibleSignature (new
      interface member; live = isSolanaSignatureShape from the new
      service/src/market/signature_shape.ts, base58 to exactly 64 bytes,
      dependency-free; dev = true), screened by
      MarketSettlementService.plausibleSignature BEFORE the first write on
      the live confirm path and at confirmTerminalEntry (invalid_signature /
      the stable terminal, no write, no verify call): a junk string used to
      500 through getParsedTransaction's -32602 and read to the game as
      service_unavailable, the abandon-ledger and anti-snipe exemption
      verdict (SEC-2, cross-repo griefing rail closed on the service side;
      the game's WOC_MARKET_ABANDON_EXEMPT_FAIL_REASONS premise now holds).
      solana_chain.ts verify: the leg loop skips owner === payer (a
      self-transfer nets to nothing; the debit check's netting branch, dead
      until now, pins it; reachable when the treasury wallet buys),
      burnedBaseFor(instrs, mint, null) counts any-authority burns so a
      foreign-authority burn answers the NEW reason burn_authority_mismatch
      (refusal unchanged, only named), console.warn names the stray wallet
      on unexpected_credit, add() skips non-string owners. quotes.ts /
      store_pg.ts expirePastDue return 0 for limit <= 0. bootstrap.ts
      sweep: edge-triggered failing/recovered warn. admin.ts
      attention.confirmingExpired24h (its own read through the new
      MarketQuoteFilter.terminalReason filter in both stores). The fix-round
      re-review's own belts (2c2ae78): bondQuote refuses the escrow wallet as
      a bidder (self_dealing) and the verifier's payer-leg skip is gated on
      owesOthers (another leg or the burn must keep the debit equation
      binding; the all-self-legs shape refuses leg_mismatch), the
      stray-credit warn is once per memo and clamps the RPC-supplied owner,
      the sweep chain gains a trailing catch and an in-flight guard, and the
      null-authority burn pass counts only attributed burns. Docs:
      MAX_CONFIRMING_AGE_MS is measured
      from quote EXPIRY; the five-under-six ordering is a deployment
      precondition (WOC_MARKET_QUOTE_TTL_MS well under one hour, unclamped;
      game WOC_MARKET_CONFIRMING_REVIEW_HOURS at or above six); the second
      horizon is release_protocol's MAX_REPLACEABLE_AGE_MS (the "RPC history
      prunes around six" premise contradicted it); the recovery caveat once
      the game acted on a terminal answer (out-of-band re-confirm of the
      preserved signature; the overview counter is the operator's cue); the
      confirm vocabulary table; treasury-rotation knob note; first-sweep
      backlog deploy note.
    - PINS CLOSED (mutation-proven, 21 mutants BIT over the committed fix
      round; the four implement-round survivors now bite): pg sweep outer
      status guards BOTH arms under a real lock-wait race, confirming arm
      ORDER BY, shared budget remainder, catalog indexes, non-positive
      budget; payer_mismatch on its own; the real wallet-emitted shape;
      leg over-credit; batched settlements; 2^53 exactness and the uiAmount
      decoy; delegate burn / delegate-funded leg; owner reassignment;
      treasury-as-buyer; authority-mismatch word; stray log; recovery warn
      once; reserved matched-arm word both entries; rejected reason on the
      row for every B4 word; every confirming-expired entry arm; the
      preserved signature in the memory store; a rejecting sweep swallowed,
      cadence kept, warned once; the ops rail counter and listing reason.
    - JUDGED, no code change (do not re-raise): balance-row BigInt throw
      on a malformed amount stays a retryable throw (documented at the site;
      22's RPC-defect policy item, with I24 malformed envelopes and the
      lenient/canonical amount asymmetry); relayer / fee-sponsored
      transactions are payer_mismatch by design (21 real-wallet note); the
      null-owner add() skip is unpinnable (identical outcome); Q5e two-memo
      one-payment is the 09 index's case; D21 PRD sentence pre-existing,
      game-side; SEC-6 refuted as the registered 12 handoff; the EPQ comment
      refutation accepted in substance (EvalPlanQual re-checks the LAST
      committed version); SEC-11 treasury rotation is pre-existing and out
      of range (documented in the knob table, 22 runbook).
    - DEFERRED with owners (amends the implement round's list): 12 (game
      wire) owes tolerating and localizing burn_authority_mismatch alongside
      burn_missing / burn_mismatch / unexpected_credit (terminal) and
      not_yet_visible (pending), gating the anti-snipe extension on
      awaiting_finality (and reading a live verifier's awaiting_finality as
      "the ledger showed the payment"; the reason-less fallback and raced
      stored-row arms also emit it but are unreachable by a fabricated
      signature), and considering a game-side signature regex tightening
      (the service now decides shape, so it is optional); 12/14 own the
      game's revisability of a bid or settlement it lapsed or failed on a
      confirming_expired verdict the service later adopts (the ops overview
      counter is the operator's cue; the review-state arms are the seam);
      18/19 (dashboard) may render attention.confirmingExpired24h (additive
      field); 21 (devnet) verifies the shape screen against a real wallet
      flow (fee-sponsored / gasless wallets would be payer_mismatch), the
      inert 'spl-token-2022' alias, the multisigAuthority count-labeling and
      burnChecked info shapes, exercises the burn proof end to end, and
      carries the first-sweep backlog deploy note; 22 owns the RPC-defect
      policy (uncaught getParsedTransaction throw, malformed balance rows
      and envelopes: retryable 500 vs terminal), the treasury-rotation
      runbook rule (or persisting the treasury wallet on the quote), and the
      connectionTimeoutMillis note. Ruling text note for R5 (SEC-10): the
      confirming bound is also the length of a free price option for a buyer
      who pre-submits a durable-nonce signature and broadcasts only if the
      price moves; bounded now at expiry plus five hours where it was
      unbounded, worth weighing if the TTL or bound ever changes.
- 09 bond-releaser (2026-08-14, SERVICE repo, session start aa44873 =
  the 08 QA tip, origin/master already contained at df09756; 9 commits,
  tip 3346878, LOCAL not pushed per R4; validation npm run build + npm
  test in service/, 493 tests 488 pass 0 fail 5 env-gated skips default
  tier and 493/493 zero skips with CLAUDIUM_TEST_DATABASE_URL, baseline
  was 445/441/4). The registry the 09-qa session needs:
  - B3 CLOSED all-or-nothing: WOC_MARKET_ESCROW_JSON becomes a retained
    signer; SolanaMarketBondReleaser (service/src/market/
    bond_releaser_solana.ts) adapts the settlement rail's prepared
    machinery with the verbatim signer-equals-escrow guard re-checked at
    prepare, the R5 fee+rent preflight, and broadcast of exactly the
    persisted bytes; shared instruction assembly (transfer_instructions.ts)
    with the unsigned builder so the paths cannot drift. buildMarketApps:
    live chain without the key refuses (red-proven); the generic gate
    covers the override bag too (code-only allowReleaserlessChain is the
    single seam that may construct a releaserless market, the runtime
    release_not_wired refusal's only reachable path); MarketApps.releaseRail
    ('override'|'dev'|'live'|'none', derived from the resolved instance)
    pins the wiring; probe set = every configured RPC endpoint.
  - DOUBLE-PAY CLOSED (both classes reproduced red on the pre-protocol
    path: crash-after-broadcast retry re-sent; concurrent refund+forfeit
    both paid). The protocol (release_protocol.ts): prepare durable-free,
    ONE claim CAS settled->releasing persisting direction + signed tx +
    attempt start + attempt-signature trail BEFORE broadcast,
    probe-before-resend on retry (finalized adopts without re-send;
    active/unknown refuse; replaceable re-prepares keyed on the OLD
    signature, age-bounded), direction-guarded signature-keyed finalize
    that clears the signed blob and keeps the trail. Guards live in each
    statement's WHERE on the row's own columns (EvalPlanQual-safe); the pg
    suite proves one claim winner under a real blocked interleave and pins
    every CAS arm.
  - THE GUARDED UPDATE + ADOPTION (two sequential blockers found by the
    review rounds, both red-proven): quotes.update(quote, expectedStatus)
    refuses when the row moved (a late confirm could revert a finalized
    release and re-arm the sweep: the stomp); confirm's settled write then
    gained ADOPTION arms (expired, superseded: states no money ever left)
    because the ledger-proven payment outranks an unpaid terminal, else a
    sweep/supersede landing in confirm's read-verify-write gap abandoned a
    paid bond as nothing_collected; any other refusal re-reads and answers
    in the entry checks' exact vocabulary. Stomp pin intact: releasing/
    refunded/forfeited/rejected stay immovable.
  - AMOUNT OWNERSHIP: bond-quote takes bidCents; ONE clamped policy
    (peg.ts clampedBondCentsForBid: ceil bps, WOC_MARKET_BOND_MIN_CENTS
    100 / WOC_MARKET_BOND_MAX_CENTS 5000, never above the bid); optional
    caller echo usdCents refused on mismatch with bond_amount_drift, the
    refusal CARRYING the expected bondCents so a knob change cannot strand
    a bid; response carries bondCents; marketFeeSchedule and the overview
    fees gained the clamp pair. R2 forfeit split: splitForfeitProceeds
    (same module, same ceil/remainder discipline, 7:3 of the whole bond at
    defaults, exact-sum) feeds legs treasury + burnBase burn; refund moves
    the exact base units whole.
  - R5 RULED AND IMPLEMENTED (see Rulings): preflight refusals
    insufficient_sol_fee; overview attention gains releasing count,
    escrowSolLamports, tri-state escrowSolLow (null = unmeasured, never
    "fine"); one-shot boot warning under the floor; admin quote rows gain
    releaseTo, releaseClaimedMs, releaseAttemptSignatures (the
    reconciliation handle; the signed blob never leaves the service).
  - REASON VOCABULARY (wire, game passes through): bond_amount_drift,
    release_in_flight, release_direction_conflict, release_unverifiable,
    release_unavailable, destination_account_unsupported,
    insufficient_sol_fee, not_configured, release_failed, send_failed;
    dev chain adds dev_chain_transaction_superseded /
    dev_chain_unknown_transaction. routes.ts refusal() now typed to
    WireQuoteResponse and carries signatureRequired.
  - AGE BOUND: MAX_REPLACEABLE_AGE_MS (release_protocol.ts, 6h,
    code-owned constant) refuses to trust a replaceable verdict for an
    attempt older than the bound (RPC history prunes; an old "absent"
    stops being evidence); replaceReleasePrepared refreshes the clock so
    recovery across replace cycles measures the CURRENT attempt. The
    age-parked case has its own operator remedy documented in
    MARKET_CHAIN_WIRING.md (reconcile by the attempt trail), distinct from
    the inside-bound release_unverifiable case (second, genuinely
    independent RPC endpoint; independence is an operator obligation the
    code cannot verify).
  - REVIEWS: two fresh coverage lenses (security: 18 findings, 1 blocking;
    correctness: 14 findings, 2 blocking) then a FRESH re-review of the
    two fix-round commits (1 blocking + 5 should-fix + 5 nits), every
    finding applied or judged with the file open; the final two commits
    were closed by careful self-review (narrow, test-covered). Reviewer
    PoCs independently reproduced both double-pay classes; the pg
    claim-CAS mutant (status guard removed) was BIT.
  - JUDGED, no code change (do not re-raise): single-endpoint 'finalized'
    trust in combineProbeStates matches the confirm path's RPC trust model
    (quorum-for-finalized would wedge single-RPC deployments; commitment
    policy is 10's charter); retry pacing/attempt caps belong to the
    game's sweep (04's cooldowns; the attempt trail gives visibility);
    livePendingByMemoRef stays (pre-existing, pg-tested, no src caller);
    a raced REJECTED write leaves an expired/superseded row terminal-unpaid
    with a slightly different reason string (a mismatched signature proves
    nothing about payment, no adoption); the sum asserts in peg.ts are
    defense-in-depth by construction (commented as such).
  - PRE-EXISTING EDGE registered, not this session's regression: confirm
    on an ALREADY-expired/superseded row answers the terminal reason at
    entry without consulting the ledger, so a buyer who signed before
    expiry and broadcast after is told terminal while the money reached
    escrow; QA/10/21 judge the remedy (probing the chain for expired
    quotes on confirm).
  - DEFERRED with owners, the LOUD one first: phase 12 (game) MUST adopt
    the bond-quote contract BEFORE any deploy of the service ahead of the
    game (today the game sends usdCents only, so its bond quoting would
    refuse invalid_amount): send bidCents, adopt the response's bondCents
    (also present on drift refusals), retire or demote woc_market_rules.ts
    bondCents() to render-only (its round-half-up disagrees with the
    service ceil at half-cent boundaries), and decide the pre-quote
    display source (the service exposes the clamp only on the admin
    overview; a game-facing schedule read may be wanted). DEPLOY-ORDER
    COUPLING is a Fernando note for the eventual rollout. Also to 12: the
    game dev economy's floor-based 90/3 split (woc_market_proxy.ts) vs the
    service ceil rule; health.ts RAIL_KEYS.marketplace still names
    WOC_RPC_URL + MARKET_KEEPER_KEYPAIR_JSON, keys the market never reads
    (the wiring doc carries the KNOWN DRIFT note). To 21: dev chain probe
    never answers active/unknown (fidelity note; devnet exercises the real
    states). To 22 pre-enable audit: whether the age bound deserves an env
    knob and whether an audited manual-adopt lever for parked releases is
    wanted; probe-endpoint independence in the deploy runbook. Production
    pg pools still carry no connectionTimeoutMillis (inherited 08 note;
    NOT addressed this session, the release path is chain-bound not
    pool-bound; 10/22 re-judge).
  - RED-FIRST REGISTRY for the QA red-proof lane (all five reproduced
    before their fix): (1) the four ownership behaviors against the old
    bondQuote; (2) crash-after-broadcast re-send and (3) refund-vs-forfeit
    both-paid on the pre-protocol path; (4) live-chain-without-key built;
    (5) the late-confirm stomp and (6) the terminal-adoption abandonment,
    both in-suite. The throwaway pre-protocol red file was deleted after
    recording; its two cases live on as the crash/race suite against the
    new seam.
  - 09 QA ROUND (2026-08-14, verdict PASS-WITH-FOLLOWUPS, tip 02713f2,
    PUSHED per R4; the registry additions phase 10 consumes):
    - ENTRY ADOPTION shipped (confirmTerminalEntry in service.ts): the
      registered paid-after-expiry edge is CLOSED. A ledger-proven finalized
      payment adopts an already-expired or already-superseded quote at
      confirm entry through the same guarded adoption write as the mid-call
      arms; a matched-but-unfinal payment answers awaiting_finality; an
      UNDECIDED verdict answers awaiting_finality only inside
      MAX_LATE_PAYMENT_VISIBILITY_MS (service.ts, ten minutes past expiry,
      code-owned) and the stable terminal answer past it; a decided mismatch
      stays terminal and writes nothing; refunded/forfeited/rejected never
      re-verify at entry. QA was the named judge on this edge and ruled
      fix-now; 10 no longer owes the confirm-side remedy. The residual half
      (a buyer the game never re-polls for) remains with 12's contract
      adoption.
    - NEW confirm reason: signature_already_settled (terminal). The
      settled-signature uniqueness now fails TYPED on both stores: the
      memory store carries the same one-credit-per-signature check the pg
      partial index enforces, throwing the pg 23505 shape, and both
      settled-write sites catch exactly code 23505 with constraint
      woc_market_quotes_settled_signature (the constraint NAME is
      load-bearing and pinned in real SQL; renaming the index would turn
      the refusal back into a 500). Reachable via a crafted transaction
      carrying two memo instructions matching two identical-leg quotes;
      previously an unhandled 500 the game re-read forever.
    - JUDGED, no code change (do not re-raise): the confirming-write
      boolean in confirm() stays deliberately UNCHECKED (its refusal must
      fall through to verification or the mid-call adoption arms never see
      the payment; commented at the site); the double-signed-memo residual
      (two distinct transactions, one memo) stays reconciliation-only and
      is documented in MARKET_SETTLEMENT.md; the terminal-row verify RPC
      cost is accepted (internal tier; bounding it risks re-opening the
      abandonment; front-door rate limiting stays with 22); the
      MEMO_PROGRAM_ID/tokenProgramForMint duplication across
      settlement/claudium is a follow-up chore; the whitespace-only admin
      actor passing the empty gate is pre-existing.
    - DEFERRED adds: 12 (game wire) also owes tolerating TWO settled quotes
      for one memoRef (superseded adoption makes it legitimate: the old
      adopted quote and the fresh one, each backed by its own payment; the
      game bond ledger must key on the reference). Everything else in the
      earlier DEFERRED bullet stands.
    - Smaller contracts added: marketRpcEndpoints (bootstrap.ts, exported,
      membership-pinned: every configured RPC endpoint joins the probe set,
      deduped, claudium precedence); admin actor bounded to 200 code points
      at intake (server.ts adminActor); compose_conformance now pins the
      COMPLETE WOC_MARKET_* shadow set with a self-enforcing discovery
      sweep (a new shadowed compose knob fails until it joins the table);
      the in-memory livePendingByMemoRef answers newest-first like pg.

- 08 service-auth-hardening (2026-08-14, SERVICE repo, session start 70d4207
  = PR #31 tip, origin/master already contained; 12 commits, tip 4b9e413,
  LOCAL not pushed per R4; validation npm run build + npm test in service/,
  439 tests 435 pass 0 fail 4 env-gated skips, baseline was 413). The
  registry the 08-qa session needs:
  - B5 CLOSED: service/src/http_guard.ts (requestPath, requestQuery,
    secretsMatch, printableAscii) is the one interpretation of a request
    target; server.ts hands the normalized path to every gate AND every
    handler (handler signatures now path + URLSearchParams; market
    routes.ts matchers take the normalized path). isOpsOnlyPath is
    EXPORTED with membership pinned both directions; the two exact-match
    ops entries (refund, clawback) are served by handleClaudium/handleNative
    with cross-reference comments at both ends. Bypass red-proof recorded:
    refund?x=1 with internal secret alone returned 200 on the old routing.
    NO decoding, NO slash collapsing, NO fragment stripping by design
    (gates and handlers compare the identical string; unrecognized shapes
    404 with both secrets, socket-pinned; the two wallet-segment captures
    exclude '#', the only routes where a fragment survived to a handler).
  - SECRETS: length-guarded timingSafeEqual both tiers (mirrors the game
    server pattern); env values trimmed with printable-ASCII checked on the
    RAW value FIRST (a Unicode-space or newline pad refuses loudly at boot
    instead of being trimmed into a secret no client can send; the message
    names padding; .env.example documents it); unset internal secret
    throws, unset or whitespace-only admin secret 503s; space-padded
    secret authenticates its transported form (pinned); boot-refusal tests
    ride a helper that closes an unexpectedly started server (a regression
    fails by name instead of hanging the file); readout limits normalized
    at the edge via intParam (garbled/zero/empty fall back, pinned; the
    stores clamp too).
  - FAIL CLOSED: service/src/dev_env.ts explicitlyDevOrTest (NODE_ENV
    exactly development or test; unset refuses) with ALL THREE escapes on
    it: the market dev chain, CLAUDIUM_ALLOW_IN_MEMORY, and
    CLAUDIUM_ALLOW_FAKE_STRIPE (the third found by the fix-round reviewer
    still on the not-production denylist). buildMarketApps refuses a null
    pool unless the CODE-ONLY overrides.allowInMemoryStores test seam is
    set (config-unreachable; the explicit null pool buildEconomyApps
    passes through refuses too), so an enabled market requires
    DATABASE_URL. All refusals red-proven on the old gates.
  - COMPOSE + ORACLE: WOC_MARKET_PRICE_MAX_AGE_MS compose default 120000
    -> 3600000 = DEFAULT_MARKET_ORACLE_CONFIG.maxAgeMs with the
    permanent-halt WHY beside it; pythSource imports the constant;
    MARKET_SETTLEMENT.md's stale 30-minute prose trued to one hour. REVIEW
    BONUS BUG FIXED: bootstrap constructed TWO MarketPriceOracle
    instances, the heartbeat and boot prime warmed one while
    MarketSettlementService quoted from the other (the exact false outage
    the heartbeat exists to prevent); now one shared instance, red-proven
    by the min-samples-2 priming arm.
  - REVIEWS: two fresh coverage lenses (security: socket probes over every
    exotic target shape, no bypass survives; correctness: mutation-proved
    the bypass pin), fix round 1 re-reviewed fresh, fix round 2
    re-reviewed fresh (mutation-verified every new pin, incl. proving two
    then-unpinned behaviors, both closed in round 3), round 3 (docs,
    comments, tests only) careful self-review. Every finding applied
    including nits.
  - JUDGED, no code change (do not re-raise): bond-refund/bond-forfeit on
    the internal tier is BY DESIGN (the game drives its own settlement
    lifecycle; destinations resolve from the STORED quote, never the
    request, so a compromised game server could grief-forfeit but not
    steal; the routes.ts header now says exactly this and that the
    admin-exclusive levers are pause + the audited read surface); the
    webhook's query-string variant adds no pre-auth surface the bare
    path lacks (signature-verified either way); NODE_ENV=test stays in
    the allowlist (the phase spec prescribes dev/test); the security
    lens's "recover records anonymous money moves" was REFUTED in part
    with the file open (an empty actor refuses execution as
    invalid_request; 'unknown' lands only on refused audit rows); a
    duplicated admin-actor header is recorded verbatim as joined
    (self-inflicted by an admin-secret holder); limit=0 on
    credits/recoveries now falls back to the default instead of one row
    (pinned).
  - DEFERRED with owners: the oracle stamps TWAP samples with nowMs, not
    the venue's publishMs, so a FROZEN print re-samples itself and
    spot-vs-TWAP can never fire, and the default config is single-venue
    so the venue-deviation gate is structurally inert: BOTH to phase 11
    (its charter is oracle health, venue posture, quote timestamps; feeds
    R3). Front-door rate limiting and a secret entropy floor: 22
    pre-enable audit (compose binds loopback by default; matters if
    ECONOMY_BIND=0.0.0.0 for the remote dashboard). The purchases
    fromMs/toMs and cosmetics/recoveries cursor params are still
    untested (the limit plumbing IS pinned): service test debt, 21/22.
    Production pg pools carry no connectionTimeoutMillis: note for 09. A
    genuinely NEW money route omitted from isOpsOnlyPath remains a
    review-time matter (the membership pin plus the CLAUDE.md rule are
    the guards).
  - Service repo gained a top-level CLAUDE.md (auth contract, fail-closed
    gates, validation commands). ARITHMETIC CORRECTION by the QA round: the
    range's baseline ran 417 tests (413 passing), so the growth is 417 to
    439 totals; the original "was 413" conflated the pass count with a
    total.
  - 08 QA ROUND (2026-08-14, verdict PASS-WITH-FOLLOWUPS, every fix applied;
    FOUR commits on 4b9e413, tip aa44873, PUSHED per R4; suite 445 tests
    441 pass 0 fail 4 env-gated skips; 12 + 2 mutation proofs bit). Fixes the
    round added on top of the implement range: DATABASE_URL required unless
    NODE_ENV affirms dev or test EVEN WITH NO MONEY RAIL (the un-flagged
    in-memory fallback was the one denylist-shaped gate left; red-proven);
    the partial-Stripe coherence refusal fires outside dev/test, message
    /partial Stripe configuration/ (unset NODE_ENV might BE production);
    CLAUDIUM_ALLOW_IN_MEMORY and CLAUDIUM_ALLOW_FAKE_STRIPE trimmed like
    the dev chain's flag; printable-ASCII checked raw-first on BOTH secrets
    before the emptiness decision (Unicode-whitespace-only now refuses
    loudly by name on either secret); admin space-pad-authenticates and
    newline/NBSP refusal pins; usdc malformed-percent 400 pin; NEW
    service/test/compose_conformance.test.ts (compose staleness default
    equals DEFAULT_MARKET_ORACLE_CONFIG.maxAgeMs, NODE_ENV: production
    pinned, CLAUDIUM_QUOTE_TTL_MS 600000-vs-60000 documented deliberate and
    pinned with its WHY); allowInMemoryStores unreachability pinned through
    env-flag shapes AND the real buildEconomyApps call site; timingSafeEqual
    presence pin scoped to the secretsMatch body; "outside production" test
    renamed to the allowlist contract; MARKET_SETTLEMENT.md bond-lifecycle
    and CLAUDIUM_WOC_REFERENCE_MAX_AGE_MS truth-ups (that knob's CODE
    default falls back to CLAUDIUM_ORACLE_MAX_AGE_MS, one minute; the hour
    lives in the deployed env); MarketRouteDeps deleted; escape-hatch
    comments say every consumer and the trim contract; .env.example and
    CLAUDE.md carry the service-wide DATABASE_URL rule.
  - 08 QA RE-REVIEW of the fix round (fresh lane, 0 blocking, 7 should-fix,
    8 nits, ALL applied in the fourth commit aa44873): the money-rail
    DATABASE_URL arms had gone vacuous under the loose regex the new
    railless gate also satisfies (deleting the rail gate stayed green;
    fixed with specific messages plus the one shape only the rail gate
    catches, mutation-proven BIT); the compose NODE_ENV pin passed on a
    commented-out line (anchored active); the quote-TTL "pinned both
    sides" claim had no code-side pin (DEFAULT_CLAUDIUM_QUOTE_TTL_MS now
    exported, shared by both builders, imported by the test); the compose
    walk-up accepted a stray ancestor compose (anchored on the .git
    sibling); stripeCheckoutMode gained its untested 'real'-in-production
    arm; docker-compose.yml now REQUIRES DATABASE_URL at interpolation
    (the :? form, replacing a silent in-container crash loop);
    .env.example gained the commented NODE_ENV=development knob (commented
    on purpose: shipping it live would arm the escape flags on a copied
    prod .env) and lost its pre-existing em dash; MARKET_SETTLEMENT.md now
    states the forfeit destination truthfully (the CONFIGURED treasury;
    refund from the stored quote; neither from the request) and the
    service-wide database rule; consumer enumerations went count-free
    (five explicitlyDevOrTest call sites now: three escapes plus two
    strictness gates). DEPLOY NOTES for Fernando before this reaches
    production: (1) confirm the live .env sets DATABASE_URL, since both
    compose interpolation and the boot now require it; (2) an admin secret
    of only non-printable whitespace now refuses the whole boot where it
    used to leave the service up with a 503 ops tier.
  - 08 QA JUDGED, no code change (do not re-raise): health?x=1 answers 200
    where the raw compare 404ed (uniform normalized contract, pinned on
    purpose); a second literal '?' follows the RFC reading where old
    per-handler splits truncated (comment records it); the DATABASE_URL
    construction test's internal pg.Pool has no teardown (the env-DSN
    branch is the pin's point; pg connects lazily; a pg change surfaces as
    a loud timeout); the timing pin stays textual, function-scoped, with
    the behavioral RangeError case as the true guard.
  - 08 QA NOTES for later phases (game side, from the v0.38.0 sync audit):
    i18n release-fill debt at the merged tip is SIZED (re-counted after
    the v0.39.0 sync, f5df042a86): 3450 pending rows, all
    marketplace-owned (the release side is at zero pending since the
    v0.38.0 fill, 1ca5e2515a): hudChrome.wocMarket 1995, hudChrome.trade
    660 (hudChrome.trade.woc.tabGold pending in every non-English locale),
    apiError.woc_market 600, entities.letters 135, hudChrome.plurals 60;
    composition is 229 rows in each of the 15 Latin-script locales plus 3
    hudChrome.trade.woc rows (pricePlaceholder, tabGold, tabWoc) in each
    of zh_CN, zh_TW, ko_KR, ja_JP, ru_RU (maintainer release fill per the
    locked decision; 22's pre-enable audit should carry the number). The release dead-code sweep deleted wallet_e2e.mjs
    and four market *_shot.mjs scripts; wallet_e2e was the only
    live-Postgres proof a freed wallet can relink to another account, so
    20/21 own restoring that proof as a real-SQL test.
    scripts/trade_money_shot.mjs was restored (branch-owned pins reference
    it). Release-owned defect surfaced to Fernando in the session wrap:
    server/ad_spend.ts answers 400 with raw English err.message instead of
    a stable ERROR_CODES key (invisible to the parity pin, unlocalizable).
    Phase 13: the TOTP rows moved to error_codes.ts around lines 263/265
    (the phantom-TOTP premise itself re-verified true). Phase 15: the
    screenshots directory is docs/screenshots/woc-market, and any NEW
    screenshot slug must join the FIVE sparse-cone blocks in
    .github/workflows/ci.yml plus the SPARSE_CONE literal in
    tests/ci_workflow.test.ts in the same change or CI test jobs cannot see
    the files. Phase 22: the CI required-check contexts were all renamed
    (dbe8ffd28e); re-derive before PR prep. Phases 12 to 16: after the
    v0.39.0 sync (merge f5df042a86 plus the bf7aeb8a98 extraction) hud.ts,
    sim.ts, and game.ts sit at EXACT zero headroom (19120, 12508, 10818)
    and main.ts sits ONE line under its 11490 ceiling (11489; the merge
    itself landed main.ts nine over and bf7aeb8a98 moved the Exchange
    attach to src/game/woc_market_wiring.ts rather than raise, so any
    further main.ts line owes an extraction); the budget test also forbids
    sitting more than 400 lines UNDER a ceiling, so large extractions must
    lower their ceiling same-change.
    New release-side rules that bind future game phases: any player-visible
    sanction follows src/sim/moderation/CLAUDE.md; every aura-wipe site
    routes through the aurasSurvivingDeath / aurasSurvivingCleanSlate
    seams; npm run gate takes a machine-wide loopback lock (GATE_NO_LOCK=1
    opts out) while gate_select does not. v0.39.0 (f5df042a86) adds:
    Hud.update(paint) has a paint cut (hud.ts `if (!paint) return;`, the
    exact above-cut call list pinned by tests/hud_update_drive.test.ts
    'the hidden-frame paint cut'; new per-frame non-paint work goes above
    the cut AND into that list, paint work stays below); main.ts frames are
    gated by src/game/presentation_gate.ts (gate.render / gate.paint,
    hud.update(false) on hidden desktop frames); every ws-importing
    scripts/**/*.mjs needs a row in tests/world_auth_scripts.test.ts
    (scripts/woc_market_shot.mjs already has one) and sends chat and /dev
    cheats only through chatCommandMessage from scripts/lib/world_auth.mjs,
    never a top-level { t: 'chat' } frame; tests/helpers/strip_comments.ts
    is the release's lookbehind helper now (the branch's copy was
    superseded; every branch consumer's verdict is unchanged); the Armory
    catalog is warmed nowhere (docs/design/armory-preview-warming.md) and
    src/ui/preview_prewarm_wiring.ts composes paperdoll + portrait only.
- 07 policy-terms-drafts (2026-08-13, session start 8a1739d67a = the trivial
  release/v0.38.0 sync (30 commits, GPU-hitch + night-lighting + OTA trains,
  no marketplace overlap; monolith_budget AUTO-MERGED: renderer.ts ceiling
  13708, lowered by the release's own fire-light extraction; all four
  count-pin suites re-derived from a run, 377 green, no re-pin needed);
  DOCS ONLY, zero code diff; LOCAL, not pushed per R4). The registry later
  sessions need:
  - DELIVERABLES: `TERMS_AND_CONDITIONS_MARKETPLACE_DRAFT.md` (repo root,
    beside the UNTOUCHED live Terms; complete revised document; new Section
    10 with the R9 acceptance-surface requirement at 10.3 and a proposed 18+
    floor at 10.2; old 10 to 22 renumbered 11 to 23, every cross-reference
    verified; `[COUNSEL]` marks judgment passages); the decision memo
    (adopted position, nine counsel questions, exact-changes list,
    enable-time checklist), held PRIVATELY at
    `/Users/fernando/Documents/woc-counsel/counsel-decision-memo.md` per the
    Locked decision below; the never-power carve-out consistent across README
    (Highlights AND Web3), wallet-link.md, holder-cosmetic-flair.md, and
    marketplace.md launch gate 1; staleness fixes in marketplace.md,
    p2p-woc-trade.md, DESIGN.md, malware-scan-catalog.md, the
    release-malware-audit and privacy-security-review agent docs, and the
    docs/, src/net/, src/ui/ CLAUDE.md files. Deed/reliquary "never power"
    lines verified to govern a DIFFERENT system and left alone.
  - SELLER TERMS GAP (new finding, memo question 1): only the paying paths
    run `guardTerms` (`placeBid`, `buyNow`, `createDirectedOffer`);
    `createListing` and the seller's directed accept record and require NO
    acceptance, so a seller can escrow and sell having never accepted, while
    draft 10.2/10.3 promise seller acceptance. If counsel confirms the
    draft, 13/14 own the gate and the 22 pre-enable audit must verify it
    (the memo's enable-time checklist carries it beside R9).
  - FORFEIT DESTINATION: R2 decided treasury+burn (one code path with the
    fee split) but the service routes forfeits ALL-TREASURY today (the
    review's fee-split divergence, 09 owns closing it). Draft 10.5 states
    the split, so Terms publication gates on 09's implementation PLUS a
    client forfeit-destination disclosure (the bid-bond note says only
    "forfeited"); both recorded in the memo checklist.
  - TERMS.HTML DRIFT: `public/terms.html` is hand-maintained and has drifted
    from `TERMS_AND_CONDITIONS.md` independently of the marketplace (its
    acceptable-use section is a different, longer text with NO real-money
    bullet at all). Publication is a reconciliation, not a copy-across; the
    privacy pair (`PRIVACY_POLICY.md` + `public/privacy.html`) owes the
    marketplace data classes and retention windows at the same moment (memo
    question 9), plus the section 14 rescope: its "has no connection to
    your account data" token sentence goes false once marketplace rows tie
    $WOC activity to accounts.
  - DEFERRED WITH OWNERS (docs-only scope kept them out): the 20
    `docs/i18n/README.*.md` locale files carry pre-carve-out Web3 wording
    (four claim sites each, with pre-existing Highlights drift): maintainer
    release fill via the i18n-locale-fill skill, NOT packet debt;
    `server/db.ts`'s bank-entitlement comment cites "the $WOC PRDs pin
    cosmetic-only" language the PRDs no longer use (next code change that
    touches it); the guide catalog's "No pay to win, ever" line joins the
    recorded P2 wiki/guide follow-up; the privacy-security-review agent's
    Scope Gate still omits the `woc_market*` modules (tooling follow-up);
    DEPLOY.md has zero WOC_MARKET env/runbook coverage (12/22 own);
    `.env.example` misses `WOC_MARKET_SERVICE_URL` and
    `DASHBOARD_INTERNAL_SECRET` and still documents the dead TOTP knob
    (12/13 own). marketplace.md now records R1's supersession of TOTP; the
    phantom scaffolding inventory for 13's deletion list: the two
    `woc_market.totp_*` error codes, their api_error catalog rows and locale
    fills, `.wm-totp` CSS, the commented `.env.example` knob.
  - VALIDATION: copy floor clean over every added line; anchor rule held;
    `npm run ci:changed` exit 0, zero errors; zero code diff (fifteen .md
    files: thirteen package files plus the two ledger files; the QA round
    corrected the original fourteen count). FRESH proofreader over the whole package: 1 blocking (draft 10.5
    pointed at a marketplace-interface disclosure that does not exist) + 7
    should-fix + 6 nits, EVERY finding applied. The proofreader also
    verified the renumbering reference-by-reference and the factual claims
    against code (guardTerms call sites, no TOTP anywhere under
    woc_market*, handToBuyer grant-with-mail-fallback, the review state's
    driverless transition pair, the cap counting both halves).
  - Handoffs: 07-qa verifies the package (docs-only: no repo reviewers per
    the dispatch rule; re-run the claim greps and the internal-consistency
    sweep). 14/15 build the trade-panel terms affordance against draft
    Section 10.3's language. 22's pre-enable audit gains the memo's
    enable-time checklist. R6 is recorded sent-to-counsel in Rulings.
  - QA ROUND (2026-08-13, verdict PASS-WITH-FOLLOWUPS, every fix applied,
    PUSHED per R4; session start 55c2ba992e = the trivial release/v0.38.0
    re-sync, two CI-harness commits, no marketplace overlap, no count-pin
    surface). Eight fresh audit lanes (fix-site re-verify,
    completeness-vs-code, claim greps, overpromise, cross-doc consistency,
    renumbering, anchor rule, fresh proofreader); the unreviewed
    proofreader-fix round verified clean site by site against code. The
    round's own finds, ALL applied:
    - DRAFT vs SHIPPED MECHANICS (one blocking + siblings): Section 10.5
      now discloses the seller opt-in second-chance offer (an outbid
      runner-up can be promoted at their own bid with a fresh settlement
      window; a still-held or refund-pending bond is re-held and
      forfeitable, a returned bond never; strikes apply on default;
      [COUNSEL]), the anti-snipe extension, and the buy-now abandon
      cooldown pair; 10.4's cancel sentence trued (any standing bid
      refuses, including a bond still being paid; a cancel during an
      unpaid buy-now window is the automatic cancel-intent; support waits
      out in-flight payments) and bid withdrawal scoped to signed bonds
      (abandonBid exists for unsigned pending bonds); the bound-items
      sentence scoped to boundTo copies (the eligibility policy tolerates
      soulbound mounts and noMarketList plates by design); 10.6's pause
      paragraph trued (settlement windows keep running, broadcast
      payments still verify and deliver; [COUNSEL] for the tolling
      question); 10.7 gained the round-up-per-leg rounding, the
      listing-time wallet identity, and addresses-visible-on-chain (they
      are published nowhere else); Section 9's money bullet carves the
      bid bond out of "we never hold your funds" ([COUNSEL]: the bond IS
      operator-held player money between placement and return or
      forfeit); the change summary now discloses the survival-list
      expansion and the [COUNSEL] flag on old Section 16.
    - COMPANION TRUTH-UPS: marketplace.md's third TOTP site (Open
      questions) reads superseded-by-R1 and drops the phantom "shipped
      as configuration" claim; "bidding suspensions" corrected to
      marketplace-wide; the eligibility bullet's store-catalog
      consultation replaced with the real WOC_MARKET_EXCLUDED_ITEM_IDS
      mechanism (the service merge is specified, not built); wallet-link
      "server-built" corrected to "service-built" (the malware-audit
      invariant hangs on that word); README's "sells no items" scoped to
      not-a-party-to-any-marketplace-sale (the Claudium store sells
      items); the p2p Landed row's literal cap count replaced by the
      knob name; the src/ui CLAUDE.md Exchange bullet no longer holds
      the checkbox up as a compliant model (it owes its own terms link).
    - NEW DEFERRED WITH OWNERS (code surfaces a docs phase cannot touch):
      the Exchange window's terms checkbox owes a terms link or
      presentation before enable per draft 10.3 (14/15 own beside R9;
      memo question 1 already describes the gap to counsel); the auction
      default arm strikes and forfeits with NO oracle-health gate while
      strikeDirectedBuyer health-gates, so a winner locked out by a
      pricing pause can be struck for the outage (14 owns the gate
      decision, 22 audits); the pausedBanner copy ("no sale settles
      until pricing is healthy again") and sellFeeNote's flat "90
      percent to you" both overstate vs the trued draft (14 owns); no
      bidder-facing disclosure that a listing is offer-next (14 owns);
      woc_market_rules.ts's excludedItemIds comment repeats the phantom
      store-catalog merge and its strikes comment still says "bidding
      suspensions" (next code change touching either); the cascade
      re-quote arm the woc_market.ts cascade comment describes is
      UNREACHABLE as shipped (the bond flow refuses any bid not in
      pending_bond, and a cascade-promoted bid is stamped won), so a
      refunded runner-up proceeds bond-free with nothing forfeitable; 09
      owns converging the mechanic and the comment, and the draft's
      second-chance sentence ("a bond already returned is not taken
      again; only a bond we hold can be forfeited") must be revisited if
      09 builds the re-quote arm; a wind-down
      runbook so 10.10's return-and-resolve promise is operable (drain
      with the flag ON, then flip off: a bare WOC_MARKET_ENABLED=0
      freezes sweeps, returns, and refunds; 22 owns via the runbook).
    - LEDGER CORRECTIONS: the phase diff is fifteen .md files (thirteen
      package files plus the two ledger files), corrected in both
      ledger entries; the privacy-pair residual now also names
      PRIVACY_POLICY.md section 14's token sentence.
    - COUNSEL PACKAGE NOTE: these amendments postdate the recorded R6
      send. Fernando forwards (or re-forwards) the AMENDED draft, and
      should flag that the memo's "operator never touches funds"
      simplification inherits the draft's new bid-bond carve-out, and
      that the memo's Section 8 question should consider the Claudium
      store by name.
    - VALIDATION: copy floor clean over every added line; anchor rule
      held; npm run ci:changed exit 0 on the fix round; tsc clean and
      the four count-pin suites 377 green on the re-synced tree; live
      Terms and public/terms.html byte-untouched across the whole
      outgoing range; the counsel memo verified absent from the branch
      (tree scan plus content grep), only the two sanctioned ledger
      pointers present; a fresh reviewer re-verified this QA fix round
      before the push.
- 06 directed-rail-integrity (2026-08-13, session start b948aa64fb = the
  trivial release/v0.38.0 sync (16 commits, the chronomancer train, no
  marketplace overlap, no count-pin surface), gate GREEN at 5287214294,
  LOCAL, not pushed per R4): H10, H12, H14, createDirectedOffer
  guardBalance, and the directed auto-close closed. The registry later
  sessions need:
  - JUDGMENT (b) SETTLED: NO boundTo stamping this packet. The
    anonymous-escrow premise genuinely does not cover a named directed
    deal; the standing rationale is the ESCROW LIFECYCLE (every
    compensation exit would need its own binding decision) and is now
    written at exchange_eligibility.ts. Lifting it is an offered product
    follow-up (the R7 pattern), sized as stamp-at-delivery across
    grant/return/restore/mail/park. Consequence: offer CREATION runs
    listingEligibility on the pinned item, so bind_armed refuses at
    offer time.
  - JUDGMENT (a) SETTLED: UNWIND, made provable. escrowInsertListing
    stamps offer.listing_id INSIDE the escrow transaction (CAS on
    accepted-and-unstamped; zero rows aborts typed 'not_pending' and the
    copy restores). Invariant: listing exists IFF the offer is stamped;
    resolveDirectedOffer lost its post-hoc stamp arm (the one
    offers-then-listings lock edge, deleted). A proven-rollback throw
    also reopens in-request; ambiguity writes nothing; the NEW
    convergedOffers sweep arm unwinds aged accepted-unstamped rows from
    durable truth (reopen inside the TTL, expire past it) inside a
    TWO-SIDED window: WOC_MARKET_OFFER_CONVERGE_SECONDS = 300 clears
    every transaction bound; WOC_MARKET_OFFER_CONVERGE_MAX_AGE_SECONDS =
    86400 refuses rows the listings prune's ON DELETE SET NULL
    un-stamped long after their deal completed (NOT rollback evidence;
    without it the arm relabeled real history). Behind
    woc_market_offers_accepted_unstamped, ORDER BY updated_at, narrow
    projection (id + expires_at), per-row sweepError isolation, no park.
    The seller-quarantine and parked-copy legs of the three-legged
    residual STAND.
  - H10 FINGERPRINT SEMANTICS: the identity is the sim's itemCopyPin
    3-tuple (item id + instance payload + crafted provenance; NO new
    serializer); item_pin stores its fixed-width sha256 hex DIGEST (a
    raw client-derived serialization banked kilobytes per row). Stamped
    at CREATION; the buyer's client sends the partner's ONE staged slot
    of COUNT ONE (the one_item hint arm covers the WHOLE table: a second
    slot, a stack, or an ineligible companion all block the send;
    WocTradeModel.agreedItem is the pinned copy). Authoritative check:
    itemPinDigest(extract.extracted) inside the serialized escrow job;
    mismatch restores + refuses typed 'item_mismatch' (NEW leaf
    woc_market.item_mismatch, 409, five non-Latin fills; its own code,
    the fix is a fresh deal). A NULL pin (pre-pin row) refuses too. THE
    LOAD-BEARING PREREQUISITE (the security round's critical): the trade
    session used to strip staged slots to id+count, so NO client source
    carried the identity (and the seller could not even resolve an
    instanced accept). Trade STAGING now previews per-copy identity:
    stagedOfferSlots (src/sim/social/trade.ts) runs the swap's own
    selection walk (removeSellUnitsFromInventory, extracted byte-faithful
    from removeVendorSellUnits) over a scratch deep copy, groups by
    itemCopyPin, ships FULL payloads on the trade wire (a judged accept:
    consensual mutual inspection; a publicInstanceView trim would alias
    copies differing in hidden fields), and the swap consumes the pinned
    copies first (trade-scoped matchers: isTradeLocked only, the shared
    helper's wider lock routed armed copies around the pin) with a
    per-unit generic-walk fallback; a decoupled inventory hub's
    unattributable remainder keeps the old id+count shape. The capacity
    model merges by item id first (per-copy slots double-counted the
    giver's stock, the receiver-overflow class). The seller's directed
    accept resolves from sim.tradeInfo.myOffer (the cleaned per-copy
    truth), never the HUD-local id-only compose list;
    inventoryIndexOfStaged compares payloads order-independently
    (itemInstancePayloadsEqual). The offer intake bounds itemInstance at
    INSTANCE_MAX_JSON_BYTES = 2048 (both intakes ride optionalInstance;
    the bound also caps nesting depth for the recursive sortedJson,
    which a 64 KiB body overflowed into a 500, verified).
  - H12 HOLD + STRIKE POLICY: WOC_MARKET_DIRECTED_HOLD_SECONDS =
    WOC_MARKET_SETTLEMENT_WINDOW_SECONDS (identity pinned;
    directedParams' durationHours is shape-validation-only, documented
    inert). Worst-case escrow occupancy: one hold + one settlement
    window. STRIKES exactly once per walk-away: never-claimed expiry via
    closeDueAuctions' directed branch (resolution 'unsettled'), strike
    AFTER the close CAS and gated on everSettledForListing probed AFTER
    the CAS ('failed' is not OPEN; the open-probe alone double-struck);
    claimed-then-unpaid keeps the overdue arm's strike, and that arm
    AUTO-CLOSES 'unsettled' BEFORE striking (custody before penalty: the
    strike awaits a health read that can reject; the expiry CAS fires
    once). BOTH strike arms ride strikeDirectedBuyer: no strike while
    the price oracle is unhealthy (buyNow refuses market_paused in the
    same window; the sweep still closes and returns, only the penalty
    pauses; an intra-window blip is an accepted residual) and no strike
    on the shared exempt vocabulary (service_unavailable; TODAY
    unreachable on a settlement row by construction, the same standing
    R5 gap the public exemption carries, documented at the helper; the
    health probe is the live gate). An UNEXPIRED claim lock refuses the
    directed close (the 270s lock outlives the 600s hold routinely; the
    row waits via 'ending' + the 300s stranded reclaim, documented). ONE
    pending offer per (buyer, seller) pair
    (woc_market_offers_pair_pending, UNIQUE partial; 23505 answers the
    NEW typed 'offer_pending', woc_market.offer_pending 409 + five
    fills; already_pending's copy describes a pending BID): the
    strike-farming bound; a boot repair expires all-but-newest pending
    per pair ahead of the index (a populated dev database must not fail
    the whole boot; unbatched, pre-enable rationale recorded). REOPEN is
    pair-aware: flipping accepted back to pending is an INSERT into that
    index, so every reopen site (typed refusal, proven-rollback,
    converge) no-ops when a fresh offer occupies the pair (NOT EXISTS
    arm + 23505 race belt) and the converge arm expires the blocked row
    at its TTL. A directed listing accepts NO bids (insertPendingBid
    refuses 'not_found' FIRST, anti-enum; an active stranger bid
    diverted the directed close into the auction close where the bidder
    wins the escrow).
  - H12 CAP: directed listings count against the shared 12 cap in BOTH
    byte-identical halves (countActiveBySeller + the in-transaction
    count; the false mitigation rationale rewritten at both sites and
    the PRD question resolved). cap_reached at acceptance rides the
    typed restore + reopen. No creation-time cap check (a moving fact;
    the create-time invariant covers static facts, documented).
  - H14 SEMANTICS: wallet_links.pubkey is UNIQUE, so the twin is the
    SEQUENTIAL RELINK (list under W recorded on listing.seller_wallet,
    unlink, relink W on a second account, buy). Guard layers: buyNow
    fast path from values in hand (A7: no advisory wallet read); the
    locked re-check in claimBuyNowLock (lock-first-then-check, PROVEN
    string equality only: undefined === undefined must not fire, the JS
    twin of NULL = NULL); the NOT EXISTS predicate inside the claiming
    UPDATE with zero rows answering typed 'own_listing' (the deref-500
    guard). The UPDATE arm is RECORDED defense-in-depth (only a real-SQL
    interleave distinguishes it; pinned structurally + the relink dance
    real-SQL test). The directed rail refuses 'self_offer' wallet twins
    at creation AND completion (live-vs-live reads; defense in depth
    under UNIQUE).
  - ESCROW BUDGET: ESCROW_STATEMENT_TIMEOUT_MS 5000 -> 4000 over FIVE
    workload statements (the cap count no longer skips directed rows;
    the stamp is the fifth); the tunables relation moved to *5 (27000 <
    30000), the statement count pinned 5-directed/4-public, the
    delivery escrow-cost bound derives to 160ms and held (the cost loop
    now closes each measured row: it leaned on the old cap exemption).
    A2: expireDueDirectedOffers carries the outer status qual (EPQ
    re-checks own columns; without it a raced acceptance could be
    expired over its committed listing) + FOR UPDATE SKIP LOCKED.
  - RETENTION + INDEXES: woc_market_directed_offers_listing (the FK
    referent index the listings prune pays a per-row seq scan without)
    + the accepted-unstamped partial + the pair-pending unique, all
    boot DDL with the pre-enable rationale recorded.
    pruneResolvedWocOffersBatch (house pool-first shape, ORDER BY behind
    woc_market_offers_resolved_updated) + WOC_MARKET_OFFERS_RETENTION_DAYS
    (default 180, matches listings so a deal's rows age out together) +
    the main.ts registration (BEFORE the listings entry, which stays
    LAST) + the wiring and config-table pins. item_id stamps at CREATION
    and the seller's acceptance no longer rewrites it (display honesty).
  - PLAN PROOFS (one-off evidence, session scratchpad; STANDING planner
    assertions remain phase 20 per the recorded precedent): the widened
    cap count = Index Only Scan on woc_market_listings_seller_live, no
    heap filter; the converge read = partial index + LIMIT pushdown, no
    sort; offers-by-listing = the new FK index; the wallet probe
    seq-scans at 300 rows (small-table artifact, PK exists).
  - TESTS: new pg suite tests/woc_market_directed_pg_integration.test.ts
    (17 tests; ran RED first for all seven target behaviors: the relink
    claim succeeding, the 12h hold, both cap halves, no auto-close, no
    never-claim strike, bait-and-switch accepted; plus the converge
    three-way + young/ancient guards, the prune-fallout regression, the
    SKIP LOCKED interleave, the pair bound, exactly-one-strike, the
    offers prune). The DB-free floor gained the stamp/converge/expiry/
    ever-settled/prune/insert pins and the wallet-predicate
    defense-in-depth pin; the service suite the full refusal matrix +
    strike exemptions + close-arm branches + the blocked-reopen arc; the
    trade suite the staging/grouping/fallback/overflow repros; the
    controller suite the instanced accept resolution. The fake db
    mirrors every new semantic and gained seedListingRow (the direct
    residue seam; the widened cap closed the escrow-path staging the
    residue tests leaned on). REFUSAL_ERRORS is 51 rows exact.
  - INHERITED RED REPAIRED IN PLACE: tests/admin_guilds_db_integration
    red on the release tip itself (env-gated, CI never runs it;
    accountDetail gained the general-chat quota LEFT JOIN while the
    rig hand-picks its DDL modules); the rig now applies
    GENERAL_CHAT_QUOTA_SCHEMA. Flows back to the release when this
    branch merges.
  - CLOSING ROUNDS (after the first gate pass; commits f618eaf146,
    da5ca53b4b, d3f831b17e, 685fd0eb00, 5ebb176a73, ea1bb82322): two
    independent fresh reviews of the gate-round commit converged, then
    each fix round got its own fresh review (the final tests-only
    commit excepted; the QA session verifies it first), every finding
    applied. The substance: inventoryIndexOfStaged
    now compares the FULL itemCopyPin triple (the crafted marker leg was
    missing; a staged crafted copy resolved to its unmarked twin and
    refused item_mismatch, with discriminating tests both directions);
    the seller accept mirrors the whole-table one_item rule: the model
    gains acceptHint naming the RIGHT obstacle (nothing sellable =
    needs-item, wrong table shape = one_item, past review = nothing,
    which also retired the stale needs-item copy during
    awaiting_payment), judged over the sim's AUTHORITATIVE offer table
    (stagedAuthoritative, the table the player sees rendered; the
    compose list stays correct for the pre-push gates) with both
    hand-offs pinned, the panel renders it verbatim, and the controller
    belt is the ONLY accept-time enforcement (the trade window's Accept
    never consults the model), arm order matching the model's ladder
    (the ambiguity previously only surfaced as a server-side
    item_mismatch);
    reopenDirectedOffer returns whether the row really flipped and the
    converge stat stops counting blocked no-ops (service pin at
    expiresAtMs - 1000); both acceptance-path reopen swallows report
    through the new offer_reopen sweep-error tag (the typed refusal and
    the escrow root cause stay the caller-facing truths, proven by a
    throwing-reopen test); the pair index joined the house
    INVALID-carcass convention (DO drop ahead of CREATE, convention pin
    now enumerates all three repair pairs) and its name became one
    exported constant (WOC_MARKET_OFFERS_PAIR_PENDING_INDEX) consumed by
    the DDL and BOTH 23505 discriminators, with the insert harmonized
    (foreign-constraint 23505 rethrows, pinned); a deterministic
    real-Postgres interleave (uncommitted racer; the wait OBSERVED from
    a separate pool connection, since a transaction freezes its
    pg_stat_activity snapshot at first read; COMMIT only after the
    block is asserted) proves the 23505 belt swallows by constraint
    name in 20ms; the offer_reopen report is pinned on BOTH catches
    (typed-refusal and proven-rollback throwing arms) with
    count-not-presence restore assertions (the harness seeds identical
    copies, so presence checks were vacuous); the boot dedupe repair
    gained the one-time validity gate; the
    quest hook collapsed to ONE fire per removal batch (every per-id
    fire saw the same final state); the instance intake bound measures
    real utf8 bytes (a non-ASCII payload was getting ~3x the named
    budget, pinned); plus prose/title truth-ups. Recorded as
    informational, NOT defects: the two marker-less staged producers
    (the remainder fallback line and the controller pre-send fallback)
    cannot resolve a crafted-only bag and fail SAFE client-side
    (hintAcceptNeedsItem), both effectively unreachable in a real Sim;
    an all-ineligible table deliberately answers await_their_items over
    one_item (ladder precedence, pinned with the WHY).
  - Deploy notes: guardBalance on offer creation is fail-closed (an
    economy outage blocks directed offer creation, intended); dev
    databases carrying THIS BRANCH's earlier builds can hold raw-JSON
    pins (acceptance refuses, the deal reopens; dev-only) or
    accepted-unstamped rows WITH a live listing from an old binary's
    post-hoc stamp crash (the converge arm would reopen them: wipe such
    dev DBs or expire the rows; production unreachable, the marketplace
    has never shipped). A REINDEX CONCURRENTLY of the pair index names
    its transient index _ccnew; a violation raised against THAT name
    rethrows (a 500) rather than no-opping, which is fail-safe but worth
    knowing during index maintenance.
  - Handoffs: phase 13 step-up covers acceptDirectedOffer per the
    out-of-scope note. Phase 14 needs NO new server command for the
    offer lifecycle (decline/withdraw routes exist; the directed cancel
    remains cancelListingIfUnbid and auto-close shrinks its need); 14/15
    own SHOWING the buyer the pinned copy (agreedItem renders nowhere
    yet; the one_item gate carries the honesty until then), the
    one_item/offer_pending/item_mismatch copy surfaces (now including
    the seller-side accept: the model disables over a multi-slot table
    and the belt logs hintOneItem, but no inline panel copy explains the
    disabled button yet), and the trade
    window's richer payload display (tooltips can now show real rolls).
    Phase 16's cluster gains: the estimate-per-offer-create amplifier
    note (bounded by the LIST limiter; memoize per usdCents if it shows
    in latency) and the trade-wire payload diff cost note (bounded by
    bag capacity, change-gated). Phase 20 owes standing planner
    assertions incl the two new partial indexes. Phase 22's pre-enable
    audit: the bindOnTrade scan line stands; add the two dev-db classes
    from the deploy notes above.
  - QA ROUND (2026-08-13, verdict PASS-WITH-FOLLOWUPS, every fix applied,
    PUSHED per R4; commits c67af5f62f, cedbaae8f2, 19eb3c74d6,
    9c9854ee85, 47399f77b7 on the ab2742012b sync merge). The amendments
    the 07+ sessions consume:
    - CAPACITY MODEL REWORKED: fitsAfterSwap no longer re-describes the
      removal; it RUNS shippedOfferUnits (the walk removeOffer itself
      delegates to) over scratch copies of both bags and lands each
      returned unit with the boundTo-stamp arrival arm. Found because
      the old fungible-first model passed a pinned INSTANCED arrival the
      swap could not merge (a 16/16 receiver ended at 17 slots,
      red-first repro in tests/trade.test.ts). Third drift of that
      model's class (#2139, #2605, this); a walk cannot drift from
      itself. The old conservative unmatched-unit tail was dropped as
      unreachable in a live Sim (countItem and the walk read the same
      array); source pin bounds the walk calls at exactly two and
      negatives a second index walk.
    - removeInstancedMatchingUnit gained the CRAFTED-MARKER leg (the UI
      comparator's closing-round fix had no sim twin: a staged crafted
      copy could ship its payload-equal unmarked twin, laundering
      provenance past the disenchant gate and the H10 fingerprint);
      discriminating tests both directions; the generic fallback stays
      marker-blind BY POSTURE with the scope now written at the call.
    - guardTerms NOW GATES createDirectedOffer (strike parity: every
      path that can strike sits behind terms; order matches placeBid;
      the route decodes acceptTerms strictly; the sdk requires it; the
      controller sends true, see R9). terms_required pre-existed end to
      end, so no new code, copy, or fills.
    - The accept belt READS THE MODEL (canAccept/acceptHint) instead of
      re-deriving the ladder; past-review the belt logs NOTHING (the
      'nothing' arm); canAccept gained its production consumer. The
      sweep-error fallback logs code+message+STACK (no detail, null-safe
      code read at both log sites; the production branch now has its own
      test). Own-property ITEMS lookups at all three client-string
      sites.
    - JUDGED, no code change (do not re-raise): strike non-decay vs the
      public cooldown pair is DOCUMENTED design (the directed rail is
      the auction-default rail minus the bond); the buyer-notice gap on
      a late seller accept is bounded by the 600s offer TTL + the
      withdraw lever, surface owned by 14; the client-only one_item
      quantity rule overlaps the recorded 14/15 honesty residual (a
      server-side staged-shape check noted for 14's consideration); the
      padlock (item_lock `locked`) rides the pin, so toggling it
      mid-deal refuses item_mismatch: fail-safe, 14's copy surfaces
      should explain it; per-actor offer fan-out is rate-limited
      (10/min) and pair-bounded per victim, watch at 14/16.
    - NEW TESTS the next sessions inherit: the pg suite is 23 (return
      flight incl. parcel book + item_disposed + idempotent second pass;
      the seeded boot-repair dedupe, whose survivor is HIGHEST ID = last
      inserted, now said at the DDL; byte-identical duplicate
      acceptance; instanced+crafted end-to-end); the service suite
      gained the instanced happy path proving BOTH digest sites agree,
      the crafted leg both directions, the ever-settled DB-free twin,
      the converge old-bound arm + the 24h literal pin, the
      cap-refusal-before-custody witness (extractAttempts), and the
      sweep-fallback shape; routes CAPTURE the forwarded offer body;
      tests/items_sell_units.test.ts is the walk's direct suite;
      trade.test.ts pins pinned-copy-first, both marker directions,
      quest-log-order batch deltas, and both capacity-model halves.
      All mutation-proven (9 session probes + the lanes' 12).
    - MERGE RE-DERIVATIONS (for the next sync): IWorld 323 = 86 data +
      237 methods; language-fanout exemptions 10; hud.ts ceiling 19160
      (the release's map extraction LOWERED it); sim.ts 12436. The
      parity union pin at the bottom of world_api_parity auto-merged
      silently AGAIN (both sides claimed 322): the file's own NOTE
      predicted it; only suite runs decide.
    - Deploy note added: the sweep fallback's log line now carries the
      stack (no err.detail; locates a failed arm across its call
      sites). Phase 22's pre-enable audit gains R9 (the implied-consent
      panel affordance) beside the two dev-db classes.
- 01 branch-baseline (2026-08-11, session start e4c3dde956, tip 418f75b876,
  LOCAL, not pushed per R4): branch was already current with
  origin/release/v0.37.0 (no sync merge needed). All five coordinator
  re-reviews of merge a52da32c89 CLEAN; non-drift findings applied (W9_TAGS
  trade_close row, ClientWorld tradeClose send pin in tests/trade.test.ts,
  custody facade fix in server/woc_market_custody.ts, two comment fixes). H7
  closed: the trade window + p2p offer machine now live in
  src/ui/hud/woc_trade/ (woc_trade_controller.ts in UI_DOM_MODULES,
  woc_trade_offer_view.ts in UI_PURE_CORES, index.ts barrel) with new
  view-core transition tests (tests/woc_trade_offer_view.test.ts) and a
  controller deps-bag suite (tests/woc_trade_controller.test.ts); hud.ts
  19347 lines, ceiling LOWERED 19600 to 19400. hud_update_drive guard moved
  to a module row; language fanout has a NOT_A_LANGUAGE_GATE row for
  lastTradeSig. `node scripts/gate_select.mjs` GREEN on tip 418f75b876; the
  planner fell back to mode=full (branch-wide diff), so the full vitest
  suite, browser regressions, typecheck, and all builds ran green: the
  review's owed full-gate run is discharged. frontend-seam-reviewer and
  qa-checklist findings ALL applied (1 blocking biome error, dead
  imports/fields, re-bounded source-pin slices, the controller suite);
  deferrals recorded in progress.md. (Figures superseded by the 01 QA entry
  below: ceiling now 19347, gate re-verified at the QA tip.)
- 01 QA (2026-08-11, session start 07fda3fd46, verdict PASS-WITH-FOLLOWUPS
  with every applicable fix applied, tip 1d7bdbafa0 plus this docs commit,
  PUSHED per R4): seven audit lanes (four workflow lenses, frontend-seam,
  test-coverage, privacy-security on the custody commit) plus a fresh
  fix-round auditor and qa-checklist (READY, 0 blocking). All five fix
  commits are test-or-fidelity work: the move is now byte-identical (log tag
  reverted), hud.ts imports via the woc_trade barrel, ceiling closed to
  EXACTLY 19347 (zero headroom, per the phase spec; seam reviewer dissented,
  recorded in progress.md), controller fake-hooks arm covers every REST-facing
  guard, pins comment-strip with agreed slice bounds, new guards pin the
  server trade_close arm, the Hud staged() live binding, E2E reach-through
  names, language-fanout exemption drift, and a server-wide sim.postOffice
  facade scan. 41 mutations all failed as expected. Gate GREEN at 07fda3fd46
  and again at 1d7bdbafa0 (full suite 37278 + browser 117); one intermediate
  run flaked on the known heavy-suite timeouts under reviewer load, all green
  in the clean rerun. Deferral list with owners in progress.md (phases 12,
  14, 15, 16). NEXT = phase-02-settlement-state-guards.md fresh session.
- 02 settlement-state-guards (2026-08-11, session start 0f029bacf9, LOCAL, not
  pushed per R4): B1, H9, the B2a groundwork, and the sale invariant closed.
  The registry later phases need:
  - Error codes: `woc_market.settlement_in_flight` (409) with catalog leaf
    `apiError.woc_market.settlement_in_flight` and five non-Latin fills.
    Seller cancel maps an unexpired lock to `buy_now_locked` and a live
    settlement to `settlement_in_flight`; the admin suspend route answers 409
    with its own admin-envelope English. The 02 QA round added
    `woc_market.contended` (409, the bounded lock-wait or deadlock-victim
    refusal on cancel/suspend/buy-now; retry immediately) and
    `woc_market.sale_conflict` (409, an admin sale correction blocked by a
    standing non-excluded row), both with catalog leaves and five non-Latin
    fills; the admin sale route answers the conflict with its own 409
    envelope line, and the admin suspend route answers contention with a 409
    envelope line too. The phase 14 admin-envelope conversion (the owned
    raw-English deferral) also owns switching those two bespoke lines to the
    registered codes, which are wired end to end and filled but reach the
    wire today only on the player-facing routes.
  - Indexes: `woc_market_settlements_open` (UNIQUE partial, state IN offered/
    confirming/confirmed/delivering/delivered) REPLACED
    `woc_market_settlements_live`; `woc_market_sales_listing_once` (UNIQUE
    partial ON woc_market_sales(listing_id) WHERE excluded = false). Both ride
    boot DDL with idempotent pre-flight repair UPDATEs above them (settlement
    losers demoted to expired with fail_reason 'schema_dedupe' plus any prior
    reason appended after a colon, so sweep with LIKE 'schema_dedupe%'; later
    duplicate sales voided excluded = true), a recorded decision AGAINST
    concurrent_indexes.ts: the tables are pre-enable empty and a CONCURRENTLY
    build can leave an INVALID carcass that silently drops the invariant.
    Since the 02 QA round the repair gates read pg_index VALIDITY (not
    to_regclass), and each CREATE is preceded by a drop of an INVALID
    same-named carcass: a failed hand-run CONCURRENTLY build can no longer
    satisfy IF NOT EXISTS while enforcing nothing (proven by a real carcass
    test). DB-free structural pins for the whole DDL surface live in
    `tests/server/woc_market_directed_sql.test.ts`.
  - Db seam: `cancelListingIfUnbid(realm, id, seller, nowMs)` refuses
    `buy_now_pending`, `settlement_live`, and `contended`, and expires
    'failed' rows (fail_reason 'listing_cancelled') on success; new
    `suspendListingIfSafe` proceeds only over failed or UNQUOTED offered (a
    stamped, unexpired quote refuses like confirming: the buyer may already
    have broadcast payment); `insertSettlement` takes `winnerBidId` +
    `winnerFrom` (won stamped in-tx, CAS from the caller's pickable set:
    close arm ['active'], cascade ['outbid']), locks the LISTING row and
    re-checks status under it (the snapshot predicate alone provably lets a
    settlement land on a just-closed listing), and returns 'listing_closed',
    'winner_gone', and 'contended' distinctly; `nextCascadeBidder` replaced
    promoteNextBidder (selection only); `markBidStatus` grew an optional
    `from` CAS; `markBidOutbidQueueRefund` is the atomic loser demote
    (outbid + held-bond refund in one statement, CAS from 'active');
    `closeListingIfNoOpenSettlement` guards the no-winner close arms (refusal
    parks the listing 'settling'); `reopenListing` fail-closes against open
    AND retry-eligible 'failed' settlements (the reclaim arm never expires a
    failed row: its deadline belongs to the overdue sweep's
    default/forfeit/strike/cascade pass, and the suspend expiry's CTE
    releases a dead settlement's 'won' bid to cancelled/refund_due so no bond
    can strand); `transitionSettlement` reports the revival-vs-open-index
    23505 as false
    (settlementQuote refuses instead of 500ing); `setSaleExcluded` returns
    'ok' | 'miss' | 'conflict'.
  - LOCK ORDER RULE for a market transaction touching bid rows AND the
    listing row: bids first (the whole open set, by id: activateBid pre-locks
    it since the 02 QA round, the reproduced 40P01 fix; insertSettlement
    stamps its one winner bid), listing second; the reverse deadlocks.
    Transactions that take no bid row lock carry documented carve-outs in
    place (cancelListingIfUnbid, insertPendingBid, escrowInsertListing).
    Guard transactions run `SET LOCAL lock_timeout` (ESCROW_LOCK_TIMEOUT_MS)
    and surface 55P03/40P01 as the typed 'contended' refusal. Now also
    recorded in server/CLAUDE.md (the woc_market Key-files row).
  - Ops caveats for the phase 22 runbook: the deploy is forward-only (an OLD
    binary against the NEW schema re-opens the settlement-less-won-bid window
    and its reclaim arm can still reopen delivered-but-unclosed listings; the
    market must stay disabled through any mixed-fleet window). The disable is
    also load-bearing for BOOT AVAILABILITY: an old binary writing between
    the repair scan and the CREATE INDEX makes the new boot's index build
    fail, roll back, and exit; the retry self-heals but a persistent writer
    is a boot loop. Under the new schema an old binary's double delivery now
    THROWS at insertSale (23505) instead of minting a silent duplicate: the
    safer direction, but a new old-binary failure mode. Never hand-drop
    `woc_market_settlements_open` or `woc_market_sales_listing_once` during
    an incident: the validity gate re-arms and the next boot demotes any
    surviving duplicate open settlements as schema_dedupe. Detection queries, PRE-upgrade only (after
    a successful boot both return zero by construction): duplicate open
    settlements `SELECT listing_id FROM woc_market_settlements WHERE state IN
    ('offered','confirming','confirmed','delivering','delivered') GROUP BY
    listing_id HAVING count(*) > 1`; duplicate sales `SELECT listing_id FROM
    woc_market_sales WHERE excluded = false GROUP BY listing_id HAVING
    count(*) > 1`. POST-upgrade audits: repaired settlements `SELECT * FROM
    woc_market_settlements WHERE fail_reason LIKE 'schema_dedupe%'` (any that
    reached confirming may still land on chain: reconcile by hand, and check
    their bids for a stranded 'won' + 'held' bond pair, which no sweep arm
    reaches); repaired sales `SELECT s.* FROM woc_market_sales s WHERE
    s.excluded = true AND EXISTS (SELECT 1 FROM woc_market_sales t WHERE
    t.listing_id = s.listing_id AND t.excluded = false)` (also matches
    legitimate operator voids with a standing correction). Before enable,
    EXPLAIN the two repair quals against the grown tables (rides the phase
    16/17 EXPLAIN list).
  - HARD PREREQUISITE FOR ENABLE, recorded from the 02 security review: a
    settlement stuck in 'confirming' now has NO escape hatch at all (cancel,
    suspend, and reclaim all refuse; the old unsafe suspend arm that could
    expire it was the B1 dupe vector and is gone). Phase 04 (H15, the bounded
    confirming resolution) is what restores an exit; it must land before
    WOC_MARKET_ENABLED is ever set. R8 (lock-spam cancel denial) is the other
    02-raised ruling.
  - Handed to phase 03 by the 02 QA round (delivery/reconcile scope): a
    settlement that reaches 'delivered' without its close tail (crash between
    the delivered CAS and closeListing, or the deferred insertSale 23505)
    leaves the listing in 'settling' FOREVER with no sweep arm reading
    'delivered' and no operator escape (cancel, suspend, reclaim all refuse):
    the reconcile arm needs a delivered-re-drive, and deliverOne should
    refuse when listing.itemDisposed is already true (belt against the
    return-then-deliver dupe shape).
  - Handed to phase 04 (buy-now lock lifecycle): `clearBuyNowLock` carries no
    holder guard (any caller clears whoever's lock); safe at every current
    call site, but a guarded variant would make the safety local. Rides
    beside R8.
- 03 delivery-exactly-once (2026-08-12, session start e71a8cfd21, commits
  1196e2bb28 + 9f8097c1fb + a08653dbd2, LOCAL, not pushed per R4): B2a, B2b,
  B2c and the stuck-custody monitor closed. What later phases consume:
  - Monitor endpoint (phase 19 dashboard view; shape as amended by the 03 QA
    round): GET /internal/woc-market/stuck, dashboardGate
    (DASHBOARD_INTERNAL_SECRET), admin envelope, parameter-free.
    data = WocStuckCustodyReadout: { asOfMs, unbookedClaims: { count,
    saturated, sample: [{ custodyRef, claimedAtMs, grantCharacterId,
    mailIntent }] }, stuckDelivering: { count, saturated, sample:
    [{ id, listingId, createdAtMs, updatedAtMs }] } (updatedAtMs is the
    class's age signal, createdAtMs is settlement provenance: render stuck
    age from updatedAtMs), undisposedListings: { count, saturated, sample:
    [{ id, resolution, updatedAtMs }] } }.
    Counts SATURATE at 1000 with the explicit saturated flag (count 1000
    means "1000 or more"); samples cap at 20; rows aged >= 10 min ON
    updated_at for BOTH the delivering class (stamped at the delivering
    claim, so a slow payment leg is not instantly "stuck") and the
    undisposed class; park rotation writes the dedicated sweep_parked_at
    column and NEVER the age columns (the 03 QA round's blocking find: the
    old rotation re-stamped updated_at faster than the stuck threshold, so
    a parked return could never surface). asOfMs is stamped per refresh:
    the cached read stale-serves through an outage, and the dashboard must
    render age from it. Served from a 30s cached read (single-flight,
    frozen object, deliberately non-busted; cold failures negative-cached
    5s). The 5-minute log beat prints only when something is stuck, warns
    once per failure streak AND once per staleness streak (age > 10x TTL),
    and runs even when WOC_MARKET_ENABLED=0; monitor stop() drains an
    in-flight beat before the pool closes.
  - Custody rail attribution (phases 04/05/21/22): every claim carries at
    most one intent, grant_character_id (direct rail, stamped BEFORE the bag
    grant) or mail_intent_at (mail rail, stamped BEFORE the parcel exists;
    markCustodyMailIntent is also the one legal grant-to-mail conversion,
    only after a grantCopy refusal). Resume rules: booked = done; grant
    intent resumes ONLY via this process's pendingGrants session continuity
    (same characterId + lease nonce, snapshotCopy, never a second grantCopy);
    mail intent resumes ONLY via an UNWRITTEN pendingMail entry (no parcel
    can exist yet) or hasParcel (the parcel still in the live book); once an
    attempt reached the post office, in-process memory proves nothing about
    collection, so only the in-book check authorizes. EVERYTHING else parks
    visibly (bare claims incl. all pre-upgrade rows, collected letters,
    lease fences, restarts, relogs). ITEM-FREE letters (the sold notice)
    skip the ledger entirely: they cannot duplicate and nothing re-notifies,
    so a durable claim only polluted the readout. A lease fence proves only that THIS write lost, never
    that an earlier autosave did: that reasoning is load-bearing, do not
    weaken it. Since the 03 QA round: a provable grant resume refreshes its
    pendingGrants stamp on every attempt (the proof is session identity plus
    nonce, not entry age, so sustained lock contention cannot expire a live
    retry into a park; an entry with NO attempts for 10 minutes still prunes
    and parks), and grantCopy has a fourth refusal, 'ambiguous' (the grant
    touched the live bags but the session state is unprovable), which PARKS
    instead of converting to mail. unclaimCustodyRef, clearCustodyGrantIntent,
    saveDeliveredCharacter and cancelOpenBidsForListing are GONE from the db
    seam; new members: custodyRefState, markCustodyMailIntent,
    markCustodyGrantIntent, saveDeliveredCharacterBooked (atomic fenced
    bags+booking, lock_timeout + heavy statement timeout, characters-row
    carve-out from the market lock order), finalizeDeliveredSettlement,
    deliveredUnclosedSettlementsPage, disposeSoldResidueListings,
    touchSettlementRow, stuckCustodyReadout.
  - Reconcile semantics (phase 21; as amended by the 03 QA round): deliverOne
    returns advanced|parked|skip|contended; parked rows rotate ONCE on
    sweep_parked_at at park time (batch order = COALESCE(sweep_parked_at,
    updated_at), shared verbatim with the two partial rotation indexes),
    back off in-process for 60s, and while backing off are EXCLUDED from the
    batch reads (deliveringSettlements / undisposedClosedListings take the
    caller's backed-off id set), so a standing parked set costs no batch
    slots and no per-pass writes; sweep_parked_at clears on the terminal
    transitions (finalize, dispose) so a recovered row cannot carry a stale
    rotation key. 'skip' (a hand-moved row, finalize 'stale' after custody
    booked) clears the parked entry and raises sweepError (it is invisible
    to every monitor class, so the log line is the only trace, and
    reopenListing could re-auction such a row: never hand-move settlement
    state). A contended finalize stops the batch and the pass claims nothing
    further (the check runs BEFORE claimDeliverableSettlements); contention
    is scoped per entry (the sweep pass owns one scope, the eager confirm
    entry mints its own), so a request-thread delivery can neither clobber
    a pass mid-flight nor inherit a stale verdict; the next pass retries.
    activateBid's 'contended' surfaces to the bond-confirm caller as
    standing:false pending:true (never "outbid": the bond is held and the
    next poll retries the activation). Delivery stats count rows
    ADVANCED with park EVENTS on the separate 'parked' stat; a slow pass
    (>1s) logs even at zero counts. finalizeDeliveredSettlement
    distinguishes 'finalized' from 'already_final' (re-runs neither
    re-count nor re-send the seller notice) and sets both lock_timeout and
    the heavy statement_timeout; after the listing lock it re-locks the
    open-bid set (buy-now finalize can race insertPendingBid), and
    activateBid maps 40P01/55P03 to a typed 'contended' the bond poll
    retries. The redriven beat runs once per minute over 500-listing id
    pages (partial index woc_market_listings_live_ids) but finalizes at
    most SWEEP_BATCH rows per beat (each costs a realm mail-book write on
    the shared serial writer); a truncated fetch resumes behind the last
    processed row, an exhausted cycle resets the cursor. Sold-undisposed
    residue converges in its own 'disposed' arm (same minute cadence, own
    error isolation, FOR UPDATE SKIP LOCKED); WITHOUT a standing sale row
    it parks forever (operator-only exit, on purpose). The seller sold
    notice is best-effort by decision: a crash between finalize and the
    notice loses it for good (item-free, sale durable, pinned by test);
    notice failures log under the 'deliver_notice' tag.
  - Lock order registry update: suspendListingIfSafe now pre-locks
    ('pending_bond','active','won') because its expiry CTE cancels a dead
    settlement's winner; finalizeDeliveredSettlement pre-locks the open set
    plus the winner, and (since the 03 QA round) RE-LOCKS the open set after
    taking the listing lock, because a buy-now finalize runs while the
    listing is still 'active' and insertPendingBid (listing-lock-first) can
    commit a new bid in the window between the pre-lock and the listing
    lock; a crossing activateBid surfaces as 40P01 and both sides retry
    typed ('contended' from finalize, and activateBid itself now maps
    40P01/55P03 to a typed 'contended' the bond poll retries instead of a
    raw arm failure). Both sides of the former suspend cycle are pinned by
    a live concurrency test in
    tests/woc_market_delivery_pg_integration.test.ts.
  - Ops caveats for the phase 22 runbook, appended to the 02 list: BEFORE
    upgrading a realm that ever ran the market, verify
    `SELECT count(*) FROM woc_market_custody_claims WHERE booked_at IS NULL`
    is zero (legacy NULL intents are UNKNOWN, not "no attempt": the new
    binary parks them, which is safe but each parked row is a delivery an
    operator must finish). BEFORE a binary ROLLBACK, drain
    `SELECT custody_ref FROM woc_market_custody_claims WHERE booked_at IS
    NULL AND grant_character_id IS NOT NULL` to zero: the OLD binary adopts
    any bare claim as booked and completes the sale with nothing delivered.
    NEVER delete an unbooked claim row to unstick a delivery: the next pass
    mints a FRESH claim that skips the parcel-in-book gate by construction,
    re-arming the duplication (warning written at the DDL); resolve parked
    rows by hand-delivering then stamping booked_at, or by confirming
    non-delivery first, and the phase 22 runbook owes the step-by-step
    re-drive procedure for each parked class. The permanent-park classes:
    crash-before-blob-persist and a deterministic parcel refusal (mail rail,
    hand-delivery is the fix once non-delivery is confirmed), plus the GRANT
    classes (non-null grant_character_id: an ambiguous grant refusal, a
    lease fence, or a dead session), where the item may ALREADY be in the
    buyer's bags and hand-delivering without checking mints the dupe:
    confirm the buyer does NOT hold the item first. Do not overlap the
    market-enable rollout with a rolling restart: boot DDL holds
    AccessExclusive on woc_market_custody_claims, woc_market_settlements,
    and woc_market_listings (the sweep_parked_at ALTERs) for the whole
    schema transaction, so realm B's boot blocks realm A's market writes
    for its duration. During a mixed-fleet window the OLD binary also loses
    woc_market_settlements_state_created (the new boot drops it), so its
    readout sample sorts the delivering set unindexed: diagnostic-only and
    transient, but expect that read to be slower until the fleet converges.
    Same class, reverse direction for the retention round's supersede: an
    old-binary boot RE-CREATES woc_market_settlements_listing (its schema
    still carries the CREATE with no DROP) and the next new-binary boot
    drops it again, each flip a synchronous build/drop under ACCESS
    EXCLUSIVE on woc_market_settlements; free pre-enable (empty table),
    so avoid mixed-fleet boot ping-pong after enable.
    onSweepError logs raw pg errors
    (detail/where can echo character names and item JSON; fine today, but
    revisit before any account or wallet column joins those rows). The
    EXPLAIN list for phases 16/17 gains: the redrive page probe
    (listing_id = ANY page, now behind woc_market_listings_live_ids), the
    three readout sample+capped-count pairs, the two COALESCE rotation-order
    batch reads against their partial indexes, and the
    disposeSoldResidueListings subquery (now behind
    woc_market_listings_sold_undisposed). Claims-table retention (phase 17):
    booked rows are prune-eligible provenance; unbooked rows are the
    operator queue and MUST NOT be pruned; the listings prune leaves booked
    claim rows behind (no FK), so age booked rows on booked_at, never on
    referent. Release-merge premises recorded by the 03 QA sync audit:
    steady per-realm DB connections are now 13, not 10 (the chat-quota
    feature's dedicated 2-client pool + 1 LISTEN connection; phase 16/22
    capacity math must count them); the repo now has its first pg
    LISTEN/NOTIFY exemplar (createGeneralChatQuotaListener) and a second
    dedicated-Pool idiom, relevant to phases 16/19/22 (advisory-lock
    namespaces verified disjoint); the quota admin write locks the accounts
    row FOR NO KEY UPDATE and can contend briefly with escrowInsertListing's
    FOR UPDATE (no deadlock cycle; phase 22 lock-registry note); phase 14
    must NOT scope-creep into the release's quota admin-envelope English
    (release-side domain, not packet debt).
- 04 bond-payment-lifecycle (2026-08-12, session start 3f20375918, LOCAL, not
  pushed per R4): H4, H15, the anti-snipe unpaid-bid medium, ruling R8 (both
  arms), and the 02 clearBuyNowLock handoff closed. The registry later
  sessions need:
  - Signature-first intake, BOTH legs: confirmBond and confirmSettlement
    record the submitted signature BEFORE any expiry verdict; the quote_expired
    refusal no longer exists on either intake (the chain's verdict decides,
    surfaced as confirm_failed when it refuses; the code stays registered).
    A decided-against bond keeps its signature as the ledger trace until the
    poll lapses it; the recorded signature blocks refresh and abandon with the
    new 409 `woc_market.confirm_in_flight` (catalog leaf + five non-Latin
    fills). setBidBondQuote is a CAS (pending_bond AND bond_signature IS NULL,
    returns boolean); abandonPendingBid adds the same signature arm. Since
    the 04 QA round: both intake routes shape-check the signature
    (signatureField, safe printable characters only, length 256; control
    characters were a log-forging vector); refreshBondQuote refuses
    quote_expired when the quote would OUTLIVE the seat (now + quote TTL
    past placed_at + pending TTL: a straddling quote invited a broadcast
    whose signature arrived against a lapsed bid where nothing records it,
    the residual now being only the sweep-cadence boundary race); a
    confirm whose activation the POLL won answers standing from the row's
    REAL status (activateBid 'not_pending' re-read, never a false
    "outbid"); and a recorded-signature retry against a review-parked
    settlement answers the state (review joined the outcome arm;
    not_active read as "purchase gone" for money under review). From the
    verification round: a SECOND, DIFFERENT signature against a signed
    pending bid refuses confirm_in_flight on both legs (was not_pending /
    not_active, a false dead-row verdict; the second string has no ledger
    slot by design, the reference-scoped service verdict is the double-spend
    backstop); a SAME-signature retry on a confirming settlement re-asks the
    chain instead of refusing, skipping the recording write so the retry
    never re-stamps updated_at (the H15 age axis); a revived failed row's
    replaced signature is logged (dev channel) since the new recording
    overwrites it (the refusal survives on fail_reason and in the service
    ledger); lapseBid gained AND bond_state = 'pending' and returns whether
    it lapsed, so a reorg-flipped verdict can never void a HELD bond into a
    state no refund arm reads, and the poll PARKS the held survivor
    (rotation + backoff, visible via stuckBonds) instead of letting it
    re-own the batch head every pass; and a retry of the signature that
    already SUCCEEDED answers the outcome, not a refusal, on both legs
    (bond: standing for active/won, not standing for outbid, no re-drive,
    no churn; settlement: the current state for
    confirmed/delivering/delivered, no second sale; a 'failed'
    same-signature retry still refuses, the revival owns it).
  - Paid-but-undecided carve-out: the suspend and finalize bid teardowns skip
    (status pending_bond AND bond_signature IS NOT NULL AND bond_state
    'pending') rows; such a bid stays in confirmingBonds until the chain
    decides, and a settled verdict against a closed listing routes the held
    bond to refund_due through activateBid's supersede arm. The overdue
    default arm's markBidStatus('defaulted') call now passes a ['won'] CAS
    (the optional from parameter itself predates this work).
  - H15 knob and state: WOC_MARKET_CONFIRMING_REVIEW_HOURS (env, default 6,
    empty/non-positive falls back; cfg.confirmingReviewMs via
    wocMarketConfig(); documented in .env.example; the parse cases incl. the
    fail-dangerous empty string are pinned in
    tests/server/woc_market_routes.test.ts, not the config suite). Since the 04 QA round the H15
    park is the sweep's OWN 'reviewed' arm with its own SWEEP_BATCH budget
    (confirmingOverdueSettlements, aged on updated_at, which nothing
    re-stamps while the poll returns undecided; ordered-index pushdown on
    woc_market_settlements_state_updated): sharing the overdue batch let a
    confirming backlog own the batch head and starve the offered/failed
    expiry work, and the split RESOLVES the recorded 16/17 UNION ALL item.
    overdueSettlements is single-arm again (offered/failed on deadline_at).
    The knob CLAMPS at 720 hours with a one-time first-read warn (the QA
    judgment superseding the no-upper-clamp posture: a huge value silently
    disabled the park and could 22008 the arm), and the lapse-straddle
    refresh refusal is the typed woc_market.bond_window_closed (409,
    catalog leaf + five non-Latin fills; REFUSAL_ERRORS is 48 rows). The sweep parks over-bound
    rows in the NEW settlement state 'review' (fail_reason
    confirming_overdue) with NO default/forfeit/strike/cascade. 'review' is OPEN: it rides the renamed
    unique index woc_market_settlements_open2 (six states; the old _open is
    dropped AFTER open2 exists; the repair gate and carcass drop retarget to
    open2; predicate text shared via OPEN_SETTLEMENT_STATES_SQL, the fake's
    OPEN_SETTLEMENT_STATES mirrors it), blocks reopen/suspend/cancel/insert,
    and exits the polling set. The state CHECK constraint evolves in place
    (gated DROP+ADD NOT VALID per the house pattern, once per legacy
    database; standing values are valid by construction, and the gate's
    retarget to open2 re-runs the dedupe repair scan exactly once more on
    databases that carried the _open generation). Operator resolution arms
    (phases 09/19/21): transitionSettlement review -> confirmed (paid,
    delivery resumes) or review -> failed (unpaid, the overdue default pass
    takes over); semantics documented at the /internal/woc-market/stuck route.
    The client renders 'review' as hudChrome.wocMarket.settlementReview
    ("Payment under review", five fills).
  - Readout (phase 19 consumes): WocStuckCustodyClasses gained
    reviewSettlements { count, saturated, sample: [{id, listingId,
    createdAtMs, updatedAtMs}] } (no age filter) and stuckBonds { count,
    saturated, sample: [{id, listingId, account, placedAtMs}] } (aged on the
    same confirming bound; since the verification round the age AXIS is
    COALESCE(bond_signature_at, placed_at), the poll park's own axis, so the
    readout reports on the mechanism it describes, and the sample carries
    stuckSinceMs (render stuck age from IT; placedAtMs stays as placement
    provenance); main.ts wires bondStuckAgeMs from the knob; since the 04
    QA round the sample ORDERS on the indexed placed_at, never the
    unindexed COALESCE, whose top-N sort scaled with the whole signed
    pending set exactly during the incident the readout reports).
    stuckCustodyReadout now takes bondOlderThanMs; the log beat counts both
    new classes. Bonds have NO automatic time-based exit (a refund_due on a
    never-landed payment would pay out through today's blind releaser, B3);
    the exit paths are the chain deciding or operator resolution, and the
    stuckBonds class is the visibility bound. Phases 09/10 (releaser CAS,
    verifier timeout per R5) own the automatic exit. The POLL COST is
    bounded separately (the db round): a bond still undecided past the
    5-minute pending TTL rotates to the poll tail (poll_parked_at, the new
    rotation column and partial index; confirmingBonds orders on
    COALESCE(poll_parked_at, placed_at) and takes the caller's backoff
    exclusion), so a standing never-decided set cannot occupy the batch
    head; young confirming bonds keep the full 5s cadence. The park AGES ON
    THE SIGNATURE RECORDING (bond_signature_at, stamped by
    submitBondSignature with the caller's clock, first recording wins;
    legacy rows fall back to placed_at), on its own tunable
    (WOC_MARKET_BOND_POLL_PARK_SECONDS, a rules CONSTANT, not an env knob;
    its value coincides with the pending TTL, so the rules suite also pins
    the constant identity at the comparison site): placement age says nothing about
    how long the chain has had the transfer, and a bidder signing late in
    their window must not be parked seconds after submitting. After a
    restart the in-process backoff is empty but the rotation stamps persist,
    so the first pass re-polls parked rows once and re-parks them. The
    anti-snipe extension anchors on the SAME submission moment (captured
    before the chain round trip: anchoring after it drifted with RPC
    latency and a slow confirm could null the settled arm's own extension).
  - Anti-snipe: insertPendingBid no longer extends (extendEndsToMs param
    GONE from the db seam and the fake); the one extension point is
    extendAuctionForBondProgress (listing-lock-only carve-out, best-effort:
    contended loses only the extension, never the recorded signature), fired
    by confirmBond AFTER the chain verdict and only when it is settled or
    pending, and never on the proxy's pending+service_unavailable outage arm
    (the security round: extending on the raw submission let a fabricated
    string move the clock; a refused verdict extends nothing; on settled the
    extension runs BEFORE activation so a last-seconds verdict is not read
    as past the close). Anchors are SPLIT BY ARM (the verification round,
    two passes): the PENDING arm anchors on the FIRST recording moment
    (bond_signature_at, which submitBondSignature RETURNS; a legacy no-stamp
    row falls back to placed_at even on resubmit), because a fresh-clock
    anchor per resubmit let one pending-forever signature re-post its way
    (rate limit 60/min) to holding the close at now plus the extension
    continuously to the cap; the SETTLED arm anchors on the verdict moment
    (the paid-bond extension the window always granted; repeating it needs
    repeated contended activations of a REAL payment, which the cap
    bounds). Cap math unchanged
    (antiSnipeExtendedEndMs). BEHAVIOR NOTE for phase 14 copy: a PENDING
    signature first recorded outside the window cannot extend on re-posts,
    and a signature
    bond routes to refund_due via the supersede arm (money-safe; the old
    "an in-flight confirmation can never land after a close" guarantee is
    deliberately gone). Residual, service-contract-dependent: if the economy
    reports a fabricated signature as pending, the extension still fires
    ONCE; phase 10 (R5 verifier semantics) owns closing that.
  - R8 arm one (numbers PROPOSED here, QA re-judges): per-listing re-claim
    cooldown WOC_MARKET_BUY_NOW_RECLAIM_COOLDOWN_SECONDS = 1800; account cap
    WOC_MARKET_BUY_NOW_ABANDONS_PER_HOUR = 3 per rolling
    WOC_MARKET_BUY_NOW_ABANDON_WINDOW_SECONDS = 3600 (rules constants).
    Ledger table woc_market_buy_now_abandons (FKs to listings/accounts,
    UNIQUE (listing_id, account, lock_expires) as the window dedupe key;
    lock_expires IS the abandon moment, app clock). TWO recorders, deduped on
    the window key: the overdue sweep's public buy-now arm (canonical,
    records BEFORE the holder-guarded clear) and claimBuyNowLock's steal arm
    (closes the crash-window gap between the sweep's recording and its lock
    clear; the immediate self-steal is closed by the open-settlement probe
    below). Directed listings record nothing and are exempt from both guards
    (they keep the strike). claimBuyNowLock diagnoses every
    refusal class from a LOCK-FREE advisory read (the db round: refusing
    under FOR UPDATE serialized every hopeful behind the holder at a
    measured hundredfold amplification); since the 04 QA round the cooldown
    probes run in the advisory pass TOO (committed ledger rows cannot
    un-cool inside any cooldown window, so a cooled-down account's retries
    never take the listing lock; proven lock-free by a pg pin racing a
    held row lock); only the self-steal, whose abandon row is minted
    inside the transaction, pays the guard transaction,
    and every advisory answer is re-run authoritatively under the lock
    (typed refusals cancel_pending / claim_cooldown / contended; old
    diagnosis order kept). An OPEN settlement refuses the claim as 'locked' BEFORE any
    recording (a buy-now listing stays 'active' through confirming and
    delivery, so a rival's probe must never stamp a PAYING holder). BOTH
    recorders run ONE shared statement (RECORD_ABANDON_SQL, exempt list as a
    BOUND parameter) whose exempt predicate refuses a window only for a
    refusal class that is NOT mintable on demand:
    WOC_MARKET_ABANDON_EXEMPT_FAIL_REASONS = service_unavailable ONLY. The
    round-2 security re-review removed the bare-signature exemption (one
    fabricated request bypassed the arm); round 3 removed quote_expired too
    (attacker-mintable: wait out the 90s TTL, post any string, the
    signature-first intake records it and the service answers
    quote_expired). Cost accepted: a genuinely late honest buyer eats ONE
    recoverable abandon row. The failed-row expiry PRESERVES fail_reason
    (offered rows still stamp window_elapsed): ops note, an
    expired-from-failed row reads its refusal reason, not window_elapsed.
    The exempt string is a wire-shaped coupling with the service's reason
    vocabulary (pinned against the proxy); R5/phase 10 note, now THREE
    dependents: bond residency, the extension gate, and restoring any
    late-payment exemption, which is UNSOUND until a verdict can distinguish
    a real transfer from a posted string. The new guard
    transactions bound idle-in-transaction holds (GUARD_IDLE_TX_TIMEOUT_MS,
    equal to ESCROW_LOCK_TIMEOUT_MS at 2000ms since the 04 QA round: 500ms
    was four times tighter than the lock-wait tolerance with no
    measurement behind it, and a false fire discards a pool client),
    and the verification round extended the bound to cancelListingIfUnbid,
    which this work grew two round trips inside its lock window (the older
    untouched guards still ride the phase 16 retrofit);
    25P03 arrives ASYNCHRONOUSLY (the session is terminated, the SQLSTATE
    lands on the client error event or the next query depending on stall
    shape, both measured), so withTx captures the async error, prefers
    whichever error carries a code, and DISCARDS the dead client; the typed
    'contended' is pinned by a real stall test. Retention: pruneWocBuyNowAbandonsBatch
    registered in the nightly sweep, WOC_MARKET_ABANDONS_RETENTION_DAYS
    (default 30, .env.example).
  - R8 arm two: cancel_requested_at on listings (additive; partial index
    woc_market_listings_cancel_rotation, the round-three rename; the paid
    probe reads the shared PAID_SETTLEMENT_STATES_SQL, OPEN minus
    'offered', pinned to the open list). cancelListingIfUnbid on an unexpired
    lock: a PAID window (any settlement past 'offered') still refuses
    settlement_live; an unpaid one stamps and returns 'cancel_pending', which
    the service maps to { ok: true, cancelPending: true } (route sends
    cancelPending, SDK forwards it, the window toasts
    hudChrome.wocMarket.listingCancelPending). From the stamp: claimBuyNowLock
    AND insertPendingBid refuse 'cancel_pending' (bids blocked too, to keep
    the one-window bound; interpretation recorded for QA). The sweep's new
    'cancelClosed' arm (after the expiry arm, so the overdue arm records the
    abandon first) converges stamped, window-ended listings through
    closeCancelPendingListing (same guards as the seller cancel; 'failed'
    expiry only, and an open settlement ABORTS via TxAbort so the
    speculative failed-expiry rolls back, the sibling cancel's shape) and
    flies the item home; a PAID window proceeds to settlement and finalize
    closes it sold (the stamp dies with the closed row). A converge 'skip'
    PARKS (touchListingRow rotation on sweep_parked_at, 60s in-process
    backoff, excluded from cancelPendingListings via its excludeIds), so a
    paid window sitting unresolved for operator-scale time costs no batch
    slots; the cancel-pending partial index rides the shared rotation
    expression. clearBuyNowLock(id, holderAccount) is holder-guarded
    everywhere (the four buyNow unwinds pass the claimer, the sweep passes
    the settlement buyer).
  - New error codes (all 409, catalog leaves + five non-Latin fills each):
    woc_market.confirm_in_flight, woc_market.cancel_pending,
    woc_market.claim_cooldown. confirm_in_flight's copy is LEG-NEUTRAL
    ("Your payment is still confirming."): the settlement leg answers it
    too since the verification round, so bond-specific wording lied there
    (the reword refreshed the five non-Latin fills in the same change). Snapshots updated (error_codes.test.ts,
    api_error_code_parity.test.ts); REFUSAL_ERRORS is 48 rows since the 04
    QA round added woc_market.bond_window_closed.
  - Tests: new real-SQL suite tests/woc_market_bond_pg_integration.test.ts
    (34 tests after the 04 QA round; its rig is the third copy, the
    pg-harness extraction still rides phase 20); settlement suite retargeted
    to open2 and cancel-intent; service suite has DB-free arms for the
    review park, the claim cooldown, the tried-buyer skip, the recorder
    dedupe and the converge park (the CI floor); the structural floor pins
    the teardown carve-outs, the bond/lock statements, both prunes and the
    new DDL. Seventeen mutation spot-proofs bit post-commit (eight on the
    implement round, six on the review-fix round, three on the round-three
    residuals), and a follow-up verification session independently re-ran
    three headline mutations (park axis to placement, holderless clear,
    confirming arm dropped) at the final tip: each bit its named tests with
    the suites provably running.
  - Migration-safety verdict (verified live vs Postgres 16, no critical or
    warning): all DDL additive/idempotent; the 'review' CHECK evolves NOT
    VALID once per legacy DB (constraint name woc_market_settlements_state_check
    confirmed auto-named and under the 63-byte limit); the open->open2 swap
    never gaps uniqueness (single boot transaction, superset predicate); the
    _cancel_rotation rename converges from all three historical shapes
    (reproduced the in-place-redefinition failure and the fix); every new
    predicate index-covered; the exempt-list parameterization closed the one
    runtime interpolation. TWO actionable INFOs folded to owners: (a) the
    overdueSettlements OR arm's pushdown loss (RESOLVED by the 04 QA round:
    the confirming park is its own read and arm now, both arms index-served). (b)
    ROLLBACK runbook (phase 22): an OLD binary against the new schema fails
    CLOSED but strands 'review' rows (no transition path; a second settlement
    takes a raw 23505 from open2, safe-direction no-double-sell, surfaces as
    internal.error until re-upgrade) and resumes taking lock claims/bids on a
    cancel_requested_at listing (nothing destroyed). Standing constraints
    restated: the boot repair is unbatched (safe only pre-enable-empty; the
    first populated-table repair must batch), and the widened CHECK stays
    convalidated=false on legacy DBs (cosmetic; an operator may VALIDATE
    CONSTRAINT out of band).
  - Handoffs: phase 06 (directed rail) inherits the cancel-intent seams and
    the directed exemptions; phase 09 executes review/stuck-bond resolutions
    (releaser CAS is the prerequisite for ANY automatic bond exit, and the
    held-bond reorg carve-out in lapseBid means a held+refused row waits for
    phase 09 tooling or an operator); phases
    16/17 EXPLAIN list gains the two new
    readout classes and the claimBuyNowLock ledger reads (the
    overdueSettlements OR-arm item is RESOLVED: the 04 QA round split the
    confirming park into its own read, restoring pushdown for both arms); the abandons FK
    adds a non-cyclic blocking edge (a claim can briefly wait on the previous
    abandoner's accounts row when that account is in escrowInsertListing;
    bounded by lock_timeout, phase 16/22 lock-registry note); phase 12 owns
    the env docs sweep (the two new knobs are already in .env.example; note
    WOC_MARKET_CONFIRMING_REVIEW_HOURS has no upper clamp, so a huge value
    silently disables the H15 park and the stuckBonds class, a posture the
    QA session should judge); phase 21
    exercises review resolution end to end; phase 22 runbook owes the
    review-state operator procedure (verify on chain, then the transition).
    Added by the 04 QA round: phase 13 opens with the ITEM-LOCK question
    (the release's player item lock gates salvage/craft/vendor only; the
    $WOC listing path deliberately matches the gold market and does not
    consult it, and whether a locked copy should refuse exchange listing
    is Fernando's call; a locked copy sold on EITHER market today arrives
    at its buyer still wearing the seller's mark); phase 14 copy list
    gains the quote_expired leaf now also answering the lapse-straddle
    refresh refusal (no fresh quote will come, the copy says to request
    one); phase 16 owes the p99.9 inter-statement event-loop gap
    measurement behind the 2000ms idle bound and the at-scale
    advisory-cooldown concurrency proof; phase 20 owes standing planner
    assertions for the two rotation indexes; phase 22 runbook gains two
    lines, never disable WOC_MARKET_ENABLED while payments are in flight
    (both intakes refuse before recording and the sweep freezes recorded
    rows), and the boot dedupe can demote a 'review' loser to failed only
    when open2 never built (edge, safe-direction, reconcile by hand).
- 05 custody-entry-hardening (2026-08-13, session start f07ca88278 = the
  trivial release sync merge, LOCAL, not pushed per R4): H5, H6, and the
  coordinator-drift medium closed. The registry later sessions need:
  - THE ESCROW FIFO (H5): createListing's whole custody critical section
    (extract, authoritative re-check, escrowInsertListing, compensation)
    runs as ONE job on GameServer's per-character save queue
    (WocMarketCustody.runSerialized over GameServer.enqueueCharacterWrite;
    the keyed FIFO itself is serial_writer.ts createKeyedSerialWriter, and
    the weapon-skin/hotbar queues plus the market depth-warn wrapper now
    ride the same module). Commit order is enqueue order across ALL of a
    character's writers, so a stale pre-extraction autosave always commits
    BEFORE the escrow write and can never resurrect an escrowed item.
    Ownership resolves BEFORE the job (ownsLiveCharacter, zero side
    effects: a foreign character id must never occupy the victim's escrow
    slot or force their guild-book flush). The job is depth-capped at ONE
    per character and deadline-bounded (ESCROW_QUEUE_WAIT_MS 5s, covering
    the guild-book flush; a cancelled job has extracted nothing; a job
    that STARTED answers its real outcome, never contended; waits past
    ESCROW_QUEUE_WARN_MS 2s warn, throttled 30s). Dirty guild books flush
    atomically FIRST and an in-job re-check refuses 'contended' (a
    character row must never carry book-paired deltas without its book
    half). Every custody blob (extract, grant, snapshot) serializes
    through GameServer.serializeCharacterForPersist: the session save
    fixups ride every durable write (a raw sim.serializeCharacter was a
    jail escape; character_save_fixups.ts owns the rationale, extracted
    from saveCharacter). wocCustodySession refuses left AND quarantined
    sessions for every custody op. QA amendments: the warn threshold and
    its throttle are injectable (createWocMarketCustody opts) and
    ESCROW_QUEUE_WARN_THROTTLE_MS (30s) is exported and ladder-pinned;
    kickSession sends its SECOND argument on the wire, so both escrow
    terminal arms send the matcher-covered 'character taken over' literal
    with the cause in the leave reason (the implement round had them
    swapped); the depth-cap slot follows the WORK settling (now pinned);
    saveCharacter's post-commit steps (lastSave, deed publish, level
    feed) deliberately do not run on the escrow write and catch up one
    ordinary save later.
  - COMPENSATION SPLIT ON PROOF: server/pg_rollback_proof.ts
    throwProvedRollback is an ALLOWLIST of proven-abort SQLSTATE classes
    (22/23/25/40/42/53/54/55 + 57014); Node errnos (EPIPE et al, five
    uppercase chars) and connection-class codes classify AMBIGUOUS. QA
    amendments: TxNeverStarted also tags a BEGIN failure (a stale pooled
    socket fails there, not at connect, in the same correlated volume;
    nothing can commit before BEGIN returns; the tag skips withTx's
    code-preference and the client is discarded), and the preference
    helper is null-safe (a codeless failure used to be REPLACED by a
    TypeError dereferencing the null asyncErr: evidence destroyed,
    classification unchanged; the pin asserts the original message
    survives). withTx DISCARDS the client on ANY codeless failure (the
    db-perf P1: a COMMIT at the 65s driver backstop rejects codeless
    with its response outstanding, and a best-effort ROLLBACK can
    consume that stale reply, so a "returned" client would answer the
    next borrower with it; coded failures with a landed rollback stay
    poolable, both arms pinned). restoreCopy's premise is restated truthfully: quarantined
    sessions never reach it because BOTH quarantine arms are terminal.
    restoreInto stays deliberately uncapped (compensation must never be
    refusable; overfill beats losing the only copy). A
    proven-rollback throw or typed refusal restores via
    restoreCopy(pid, characterId, slot): into the LIVE bags while the
    extraction pid's player entity exists (every teardown flush queues
    BEHIND the job, so the restored copy rides it to durability), by
    return parcel only once the player is gone. lease_lost ALSO fires
    escrowSessionLost('fenced') (kick, saveCharacter's own displaced-
    zombie signal). An AMBIGUOUS throw restores NOTHING and fires
    escrowSessionLost('ambiguous'): quarantine + kick, so the session
    reloads from the durable row, which is correct in BOTH branches of an
    unknown COMMIT (committed: item-free blob + listing; rolled back: the
    item still in the bags); the full extracted slot is logged
    (escrow_outcome_unknown) for the operator.
  - escrowInsertListing: workload-scoped ESCROW_STATEMENT_TIMEOUT_MS (5s,
    exported + ladder-pinned in tunables; measured p50 3.5ms / max 8.3ms
    on a 27KB blob, re-measured and asserted by the delivery pg suite's
    escrow-cost test), the idle-in-transaction bound, and 55P03/40P01/
    25P03 mapped to the typed 'contended' (return union widened; the
    service restores and answers woc_market.contended). ESCROW_LOCK_
    TIMEOUT_MS and GUARD_IDLE_TX_TIMEOUT_MS are now exported and
    literal-pinned. QA amendment, the honest occupancy ceiling: the 5s
    allowance bounds the FOUR workload statements (the tunables relation
    pins exactly those plus the lock wait and pool checkout, scraping
    AUTOSAVE_SECONDS from source); BEGIN and the installing SET LOCAL
    ride the 15s session default and COMMIT the 65s driver backstop, so a
    wedged transaction CAN exceed one autosave interval (the wait
    deadline and depth cap bound the player-facing impact; the tail rides
    16 with the guild-flush 60s term).
  - RECORDED CARVE-OUT: commitGrant (the delivery twin) deliberately does
    NOT ride the FIFO yet: its stale-autosave direction is buyer item
    LOSS, operator-recoverable through the claims-ledger park subset, and
    FIFO-routing sweep grants needs a head-of-line bound first. Recorded
    at the method, source-pinned (exactly one runSerialized call site in
    the service; no enqueueCharacterWrite reference; the pin now ALSO
    sweeps the sweep and monitor siblings). QA judgment: STANDS as
    follow-up, owner 16, SEQUENCED after the honest occupancy bound
    (closing it first would import the unbounded hold into the sweep) and
    gated on the park subset staying intact.
  - H6: exchangeHardLock consumes the shared per-copy transfer-lock
    predicate, so the woc rail refuses exactly what the gold market,
    mail, and guild bank refuse; the ARMED state reports its own
    'bind_armed' reason (joins the woc_market.not_eligible wire group,
    REFUSAL_ERRORS is 49 rows; no new catalog leaf). The predicate body
    moved to the dependency-free src/sim/transfer_lock.ts leaf
    (item_instance_transfer re-exports it; exchange_eligibility keeps an
    empty runtime import graph). Both client pre-filters (Sell picker,
    trade-window exchange arm) inherit the refusal SILENTLY (no per-lock
    copy exists; phases 14/15 own explanatory copy if wanted). An
    unbind returns a commission piece to the ARMED state, covered.
  - EXTRACTION: src/sim/broker_custody.ts (extractTradableCopyImpl with
    the mount-dismount arm, grantTradableCopyImpl on the one-call
    canGrantCopies/grantCopies pair; thin same-named Sim delegates stay
    for the server bridge; grantTradableCopy finally has tests incl. the
    #2139 per-dimension refusals and a zero-rng pin with positive
    control). src/sim/daily_rewards_stub.ts holds the offline
    daily-rewards readout (value-pinned by its own suite). Monolith
    ceilings: sim.ts ratcheted 12660 -> 12428 exact; game.ts HELD at its
    exact pre-existing 10859 (the FIFO/fixups/depth-warn extractions paid
    line for line for the new host members).
  - FIREWALL: FIREWALL_ALLOWED is exactly ['src/sim/daily_rewards_stub.ts']
    with an existence + pattern-hit + read-only-projection shape pin (one
    export function, no control flow, type-only imports); sim.ts,
    types.ts, holder_tier.ts are fully scanned. The pattern set is
    calibrated against the REAL server corpus: lamports, base58, bs58,
    keypair, secret/private key, blockhash, spl-token, send/sign
    transaction, woc-amount shapes, money-affixed signature compounds
    (tx/txn/bond/settlement/burn/transfer/der/escrow/payer/seller/mint +
    signature_reused/required/field/header/verified/atMs/bytes), treasury
    suffixes + base/cut/fee/account. Bare 'signature' and 'token' stay
    out (49 measured content false positives; riftToken/chatTokens).
    QA amendments: non-vacuity floor 460 of the real 475 files (the
    recorded 474 was wrong at write time); FIREWALL_ALLOWED membership
    pinned exactly; the projection shape pin refuses re-exports,
    generator exports, enum/interface/default, dynamic import, try, and
    the logical operators, each with a named offender case; every
    pattern alternative has a positive control; the compound arms'
    missing LEFT boundary is documented as deliberate over-match.
  - OBSERVABILITY: the wocEscrowQueue counter (game-signals seam, kinds
    started / deadline_refused / depth_refused / books_dirty_refused /
    flush_failed, zero-backfilled) plus a 30s-throttled realm-global
    queue-wait warn. A checkout-failed OR begin-failed transaction is
    tagged TxNeverStarted (exported from woc_market_db, import-pinned)
    and maps to 'contended' on the escrow write ONLY. QA amendment: the
    counter is fully pinned (name literal, closed vocabulary both
    directions, zero pre-registration, per-kind increment per refusal
    arm, never-throws).
  - Handoffs: phase 06 opens with TWO directed-rail judgments: (a) the
    acceptDirectedOffer throw-arm residual, now THREE-legged since the
    ambiguous park arm (offer stuck 'accepted' with no listing, the
    seller quarantined and kicked, the copy parked out of the bags; the
    acceptance predates the park arm, so re-judge the acceptance itself);
    (b) whether directed delivery should stamp boundTo on hand-off and
    inherit the trade-window named-recipient exception (today a
    commission piece passes the gold trade window but is refused by the
    $WOC arm beside it; refusing is the safe direction, recorded at
    exchange_eligibility.ts). Phase 16 owns the escrow-queue additions
    from the hot-path round (the guild-book flush still rides the 60s
    logout allowance inside the deadline, the dominant occupancy term; a
    pendingKeys FIFO gauge; widening TxNeverStarted -> contended to the
    other guards, commitGrant's park arm now explicitly included; a
    completed/terminal sibling kind for the wocEscrowQueue counter; the
    per-listing serialize cost attribution; the gold-World-Market
    straddle: the escrow write persists the character row alone, the
    same crash window the 30s autosave has, pre-existing realm-wide;
    from the db-perf close-out: a realm-global escrow in-flight
    semaphore, a contention-class label on the 'contended' path, a
    draining refusal on createListing, and the FOR NO KEY UPDATE
    narrowing of the accounts lock)
    plus the saveAll-wave suppression measurement; phase 22's pre-enable
    audit gains one line (scan standing listings' item payloads for
    bindOnTrade-armed copies that entered before H6). The 04 ledger's
    "REFUSAL_ERRORS is 48 rows" is superseded: 49 since bind_armed.
    Accepted without code change (QA round; do not re-raise): the FIFO
    self-deadlock rule stays comment-enforced (a runtime guard would
    false-positive the sanctioned void-kick-from-job pattern); the
    escrow write skips saveCharacter's post-commit steps by design; the
    guild-bank deficit ladder is reachable at listing rate
    (self-inflicted only); architecture.test.ts's hand-rolled walker is
    pre-existing repo-wide debt.
- 02 QA (2026-08-11, session start 20fdcc5288, verdict PASS-WITH-FOLLOWUPS
  with every fix applied, gate GREEN at tip 301a8c7c22, PUSHED per R4):
  release/v0.37.0 synced (merge b40a178643; generated-i18n conflict
  regenerated; merge audit clean except the hud.ts ceiling, fixed by the
  preview_prewarm_wiring extraction, ceiling now EXACTLY 19338). Seven audit
  lanes plus a fresh fix-round re-review; the registry bullets above were
  updated in place and progress.md carries the full round. The db-seam facts
  phase 03 inherits: insertSettlement locks the LISTING row (snapshot
  predicate alone was proven insufficient against a concurrent closer);
  closeListingIfNoOpenSettlement guards the no-winner close arms; the
  reclaim PARKS failed settlements for the overdue default pass (never
  expires them; reopen refuses over failed rows); the suspend expiry
  releases a dead settlement's won bid via its CTE; 'contended' and
  'sale_conflict' are registered refusals; the boot repairs gate on index
  VALIDITY via to_regclass. Twelve mutation proofs all bit. Real-SQL suite
  41 green. NEXT = phase-03-delivery-exactly-once.md fresh session.
