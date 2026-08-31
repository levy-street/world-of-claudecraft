# Follow-ups list (DRAFT until phase 21 closes out)

The post-packet queue: every deferral still open in progress.md/state.md,
the P2/P3 PRD gaps not taken, and the external gates, grouped by owner.
Drafted by the close-out prep rider (2026-08-20) from a full sweep of both
registries with closures cross-checked; phase 22 finalizes it after the 21
devnet legs (the OPEN-21 block empties into evidence rows or new items).
Line refs cite state.md/progress.md at the rider tip. Do not re-raise items
recorded here as judged or conditional; the owning round's registry is
binding.

## 1. OPEN-21: waiting on the devnet legs (blocked on devnet SOL)

Bond cycle with the double-release balance assert; settlement e2e with the
burn verify; the hostile burn-redirect rejection; escrow-gate and auth-guard
contention observations plus the 16 lost-lock anti-phase; the halt/recovered
line observation (recorded NOT OBSERVABLE without a venue key; fixed-price
path ruled); the three at-scale proofs (advisory-cooldown concurrency, p99.9
inter-statement gap, expiry full-batch ceiling); jsonParsed label assumptions
against a real RPC; the signature shape screen against a real wallet flow;
real pending words end to end (the dev-chain words WILL fire the drift warn
on devnet: expected, dismiss knowingly); the real step-up, cooldown, and
quote-review flows; the poll settled-arm burst behavior; the offers-read
retained-history cost measurement. Per-leg status: state.md "21 devnet
dry-run evidence"; resume runbook: devnet.md.

## 2. Maintainer rulings OPEN (Fernando; re-surface, never re-decide)

1. woc_market.ts ceiling raise: +53 across the escrow rider's two raises,
   net 4484 to 4036 DOWN; rider QA recommends APPROVE at the corrected
   number. (progress.md 5967-5971)
2. woc_market_db.ts has no monolith ratchet row at 4783, the largest
   marketplace file; recommendation on record: add one (sibling seam
   woc_market_<domain>_db.ts); same gap covers woc_market_delivery.ts and
   woc_market_custody.ts. (progress.md 5417-5431)
3. Escrow gate hold-ceiling sizing: 300s buys exactly one queued heavy save;
   prose and pins made honest; raising the constant is a sizing decision.
   (progress.md 5433-5447)
4. The durable last-accepted-print oracle anchor (the R3 cold-boot
   follow-up): survives restarts, age-bounded; needs its own ruling; also in
   the service's TODOS.md. (state.md 1427-1439)
5. The R13 automatic outage arm: payment deadline pauses while the rail is
   observed down (capped), or forfeit converts to refund on outage evidence;
   needs its own ruling AND the 21 evidence before code. (state.md R13)
6. R11 wallet relink gate: UNANSWERED, a pre-enable launch gate; three
   drafted options; close DELETE /api/wallet/link's missing rate limit in
   the same pass. (state.md R11)
7. R7's four declined nice-to-haves: dispute-case UI, marketplace
   wiki/guide page, game-side audited runtime pause, numeric reserve guard.
   Opting one in later = a new numbered phase. (state.md R7)
8. Auth-guard cache TTL brownout regime: a probe slower than the 5s TTL
   installs an already-expired entry; recorded, not ruled.
   (progress.md 6076-6080)
9. Dashboard repo settings: make the ci check REQUIRED (verified: no
   ruleset or protection exists on either branch today); confirm the
   EXTERNAL role's POST payouts/send stays intended; decide on a scheduled
   npm-audit job. (progress.md 4812-4816, 4580-4582)
10. R12 product debt: an explicit buy-now lock release route ("Not now"
    today holds the lock to TTL by ruling); if ever built it must join the
    abandon-cooldown accounting or it is a free lock-cycling denial lever.
    (state.md R12)

## 3. External gates (counsel, deploy sequencing)

1. R6 counsel sign-off on the Terms package: THE launch gate. The forwarded
   copy must be the 07-QA-AMENDED draft; the memo's enable-time checklist
   enumerates what must land before R6 flips to granted. Raise on
   forwarding: the bid-bond carve-out vs the "operator never touches funds"
   simplification, and the Claudium store in the Section 8 question.
2. R14 enable-time verification: production holds no pre-reword acceptance
   rows; key acceptance to the counsel-approved text; post-launch reword
   policy stays counsel's question (versioned acceptance is the code change
   if they rule re-consent).
3. Seller-side terms gate: sellers never accept terms in code while the
   draft promises it; memo question 1 owns the ruling.
4. terms.html/privacy publication is a RECONCILIATION (drifted texts), plus
   the marketplace data classes and retention windows in the privacy pair.
5. Deploy sequencing: service deploys AHEAD of game (DEPLOY.md coupling);
   the R16 CI change lands with the game PR (its first CI run is the
   weight-harvest source, see 5.1).

## 4. Pre-enable audit residue (22 finishes; itemized in acceptance-audit.md)

The bindOnTrade scan, the R14 verification, the claims-table empty-or-booked
check, the EXPLAIN of the two repair quals against grown tables, the
enable-vs-rolling-restart exclusion, and the R9 counsel-text verification of
both consent surfaces. All documented as procedure in
docs/woc-market-runbook.md section 3. PLUS, surfaced by the rider's runbook
verification: the OPERATOR ARM for resolving a parked review settlement
did not exist at packet close. CLOSED post-packet: the sanctioned surface
is POST /internal/woc-market/settlements/:id/resolve
(server/woc_market_review_resolution.ts through the transitionSettlement
CAS, dashboard-secret gated beside the stuck readout; runbook sections 3
and 10 record the procedure). Hand SQL remains forbidden.

## 5. Game repo: engineering follow-ups with owners

1. CI shard weights re-harvest (NEW, this rider): the weights file records
   every pg suite at its SKIPPED cost (or absent), so the first real-DB CI
   run mispacks; harvest via scripts/ci_shard_weights_harvest.mjs from the
   first green run of the R16 wiring and land the updated table promptly.
   Owner: the rider QA session or 22, at first CI run after push.
2. WOCC_PG_DIFFERENTIAL alignment (NEW): the two SQL differential blocks
   (tests/server/client_perf_summary_sql.test.ts, deeds_board_sql.test.ts)
   gate on WOCC_PG_DIFFERENTIAL=1 and read DATABASE_URL, so they stay
   silently skipped in CI after R16; aligning them onto TEST_DATABASE_URL is
   the same class of decision and deliberately NOT folded into the R16 diff.
   Owner: 22 or a gate follow-up (gate-integrity reviewer).
2b. Gate classifier asymmetry (NEW, rider QA's gate review): isCodePath
   codes only the .github/workflows/ prefix while decideTestMode widens on
   all of .github/, so a .github/actions/**-only PR classifies docs-only and
   runs no tests; harmless while no composite action hosts a test
   invocation (the job classification pin reds a uses: relocation OUT OF a
   wired job, and after the fix-round review it refuses any job-level
   uses: outright as unclassifiable novelty), but if one ever does, widen
   isCodePath first. Same review
   noted the cheapest remaining re-skip: a vite.config test.exclude glob
   removes a suite family from every runner while both pins stay green
   (pre-existing class, any suite family). Owner: gate follow-up
   (gate-integrity reviewer).
2c. Shared pg-gate helper option (JUDGED-DECLINED as a refactor in the
   close-out rider; kept here as the option of record): if the twenty pg
   suites ever adopt a shared TEST_DATABASE_URL gate helper, the
   ci_workflow lane and browser exemption guards are LITERAL text scans of
   the suite files and go blind the moment the literal moves into a helper
   import; the guard must move to the helper's importers IN THE SAME
   CHANGE. Owner: whoever takes the refactor.
3. CIC-vs-open-transaction flake class inside a shard's shared database
   (player_metrics + daily_rewards against Strategy-B siblings): watch the
   first CI runs; the surgical fix is a single-fork lane for that glob.
   Owner: whoever babysits the first runs. WIDENED by the rider QA's gate
   review to the general class: four suites TRUNCATE shared tables in
   beforeEach while twelve-plus siblings INSERT into them, all file-parallel
   against one database per CI leg. Probed by the QA: three consecutive
   full-battery runs (17 suites, 333 tests, one parallel vitest invocation
   against a virgin database, a HARSHER shape than any single CI leg) all
   green, so this stays a watch item, not a redesign; the remedy menu if it
   bites is a per-worker database name, a single-fork lane for the
   *_db_integration glob, or an advisory-lock mutex around the TRUNCATE
   suites. Failure direction is RED (never a silent skip).
4. woc_market_view pure-core extraction (owns the Exchange role=status
   regions / screen-reader announcements). Owner: a dedicated pass.
5. The design/UI cluster deferred past 15, each with its recorded owner:
   the R10 lock-hint robust fix (sim trade-snapshot refresh); #trade-window
   dialog contract (markDialogRoot, focus trap); over-balance red vs ranked
   hint; DESIGN.md rollout items (accent retune, tokens, .btn/.panel-title
   primitives, title case, --panel-border with Dungeon Finder captures);
   the mobile-chrome sweep (scroll-padding over the self-scrolling set);
   the house-wide touch-floor zoom question; the real-notch device check;
   the trade-window relocalize decision; trade rows' instance marks; token
   precision and Activity cell coloring; mobile bags-over-trade stacking.
   (progress.md 2981-3097, 3232-3264; state.md 2243-2266)
6. Seam/structure cluster: woc_trade controller deps-bag injection and the
   third `$` helper copy (rule of three reached); staged() command pair;
   command_facets reverse completeness (program-wide); insertSale dead
   member; `walked` write-only; the tests/server/helpers barrel omission;
   the hot-reads line-first stripper swap. Owners as recorded.
7. Money-path residuals with owners: signature squatting (verifier must be
   able to clear a signature whose contents pay a different reference;
   ~seven rotating funded accounts can still deny one listing); the second
   signature's missing ledger slot; fail_reason unbounded TEXT write bound
   (verified still open at server/woc_market_db.ts); the unreachable
   cascade re-quote arm vs its comment and the draft's second-chance
   sentence; cancel-intent undo affordance; R10 gold-market lock posture +
   buyer-inherits-mark; boundTo stamping for directed deals (R7-pattern
   product offer); battleground-seat escrow question (low confidence).
8. Stale-comment sweep (next touch of each file): woc_market_rules.ts
   store-catalog + suspensions comments; server/db.ts PRD citation; the
   guide catalog's "No pay to win, ever" line (rides the P2 wiki follow-up);
   server/wallet_link.ts em-dash comment.
9. Closure of record (rider QA sweep): the abandons-FK lock-registry edge
   ("stays recorded for the 22 runbook", progress.md 3376) DISSOLVED when
   the escrow write-path rider reworked the lock registry; nothing remains
   to document. Recorded here so the sweep trail shows it closed rather
   than dropped.
10. Read-bucket 429 sizing re-judgment (parked by 16 as "re-judged
   pre-enable"): the shared READ bucket's two-players-behind-one-NAT sizing
   (server/ratelimit.ts) must be re-judged against real venue traffic
   before enable; three or more worst-case players behind one NAT 429 each
   other's polls. Owner: Fernando at the pre-enable review (with 2.
   Maintainer rulings).

## 6. Service repo follow-ups

1. /v1/health has no market rail and its 'marketplace' rail names keeper
   keys this market never reads; add a real rail or document the absence
   (ops guidance keys on /v1/market/price meanwhile).
2. connectionTimeoutMillis still absent on production pg pools (inherited
   since 08).
3. SEC-9 request-path sampling window shortening (heartbeat-only recording
   or a per-second limit); the game half shipped in 16. NEEDS A JUDGMENT
   that the original assignment expected from 22 and the shrunken 22 will
   not make: take or decline the remedy. Owner: Fernando.
4. Manipulation economics: tie the quote ceiling to OBSERVED venue
   liquidity (birdeye_price.ts already reads it); the
   MIN_LIQUIDITY/MAX_USD_CENTS ratio is the real bound. NEEDS A JUDGMENT
   (same 22 reassignment as 6.3): take, decline, or defer with the venue
   choice. Owner: Fernando.
5. The adapter body-timeout observation; the RPC-defect retryable-vs-
   terminal policy; MAX_REPLACEABLE_AGE_MS env-knob question; the audited
   manual-adopt lever question; front-door rate limiting + secret entropy
   floor (matters if ECONOMY_BIND widens); a service-side test naming
   clampedBondCentsForBid against the game mirror; purchases cursor params
   untested; MEMO_PROGRAM_ID duplication chore.
6. The R5/SEC-10 note: the five-hour confirming bound is also a free price
   option for a pre-signed durable-nonce payment; re-weigh if the TTL or
   bound moves.
7. Python payout DAILY_REWARD_WOC_USD_PRICE env gate (pre-existing, outside
   this packet's diff): the runbook carries the operational rule; a code
   gate needs Fernando's ruling on the payout service.
8. WOC_DECIMALS parser unification (rider QA): the market bootstrap accepts
   0..18 with a silent fallback to 6 on nonsense
   (service/src/market/bootstrap.ts, wocDecimals) while the claudium
   bootstrap parses the SAME variable through integerConfig(1..18) and
   THROWS at boot on anything else; a combined boot cannot diverge (the
   throw wins) but a market-only deployment silently defaults where the
   other arm would refuse. Unify the bounds and add a boot warn on the
   fallback.

## 7. Dashboard repo follow-ups

1. The summary refresh wedge: a never-resolving fetch parks the 30s refresh
   permanently; a fetch deadline is the coherent fix (runbook documents the
   recovery levers meanwhile).
1b. The fund-moving release form renders OUTSIDE the overview gate that
   protects the pause control: during an overview outage the halt button
   vanishes while the release lever still submits (surfaced by the rider's
   runbook verification; MarketTradingPanel renders the form unguarded).
   Decide whether the release form should require the overview in hand.
2. Unrendered fields the producers already emit (verified absent from src/
   by sweep): settlement failReason, attention.confirmingExpired24h,
   distinctPrints, crossVenueGateArmed, twapUsdPerToken, spotUsdPerToken,
   venues[].ageMs + fresh (service-judged; priceVenueRows still derives age
   from the browser clock), the effective bounds. Also the game's conscious
   skips: sweep.lastOverrun, readCaches, priceCache ages.
3. Server-side search for the game-backed lists; offset paging for quotes
   and audit.
4. tsconfig type-checks src/ only; tests ride strip-types unchecked
   (align @types/react to runtime 18 first if changing).
5. Payout-service half: the actor header is authoritative only if that
   service prefers it over body-borne actors when it grows audit rows.
6. Wallets-arm exponent screening (rider QA, pre-existing beside the market
   fix): ClaudiumPurchasesPanel still lets the wallets payload's
   wocDecimals reach 10n ** BigInt(exponent) unscreened during render
   (decimalToBaseUnits has no bound check or try/catch), the exact class
   the Trading tab now screens; a fractional or huge reported value crashes
   the panel. Same pass: treasury_withdrawal_request.ts parses the
   service-supplied treasury balance with an uncapped, un-try/caught BigInt
   during render (the MONEY_BASE_RE cap pattern applies).

## 8. P2/P3 PRD gaps not taken (review.md backlog)

P2: dispute UI and case tracking (dashboard shipped resolution levers, not
case tracking); the player wiki/guide page; the game-side audited runtime
pause (the service pause via dashboard is the shipped control). P3: the
numeric reserve guard; the directed-escrow count bound rode the H12 shared
cap (verify in 22 whether the PRD row is satisfied or wants its own bound).

## 9. Maintainer i18n / release-fill debt (not packet debt)

The reworded-keys re-translation list (14/14-QA, recorded in state.md); 331
marketplace Latin pending rows; the hudChrome.dailyRewards.usd suffix
reconciliation; the two retired woc_market.totp_* keys sitting in 15 pending
blocks (release tier hard-fails until filled); the 3 hudChrome.trade.woc
non-Latin rows; frenzied_regeneration overlays reword-stale in 18 locales ON
THE RELEASE BRANCH (not this branch); the 20 docs/i18n README locale files'
pre-carve-out Web3 wording. Canonical workflow: the i18n-locale-fill skill.

## 10. Housekeeping

The backup-pre-reword-15 branch awaits a manual `git branch -D` (verified
content-free; the automated delete was permission-blocked). The 15
capture-set size call is SETTLED (keep), listed only against re-raising.
