<!-- server/: the authoritative game server. Local conventions only.
     Root CLAUDE.md (architecture, the one-sim invariant, build/test) loads
     alongside this; don't repeat it here. server/ is NOT under src/. -->

# server/: authoritative game server

esbuild-bundled for Node via `npm run server` (output `dist-server`); persists to
Postgres and serves the built client from `dist/`.

## Module-first: where new server code lands
- **A new REST endpoint** is a `RouteDef` module (`server/<domain>.ts`) registered in
  `server/http/registry.ts` (recipe below), never an inline handler in `main.ts`.
- **New WS/loop-side behavior** is a sibling module, never another `GameServer`/`main.ts`
  method cluster. Pure decision logic (join rules, command parsing, rate windows) goes in a
  host-agnostic module a Vitest imports directly (exemplars: `linkdead.ts` `planJoin`,
  `moderation_commands.ts`); anything needing IO goes behind an injected deps bag or a narrow
  host interface so it tests without a DB or HTTP server (exemplars: `ws_auth.ts`
  `createWsAuth`, `moderation_service.ts`). `wallet_link.ts` (pure, IO-free) versus
  `wallet.ts` (DB+HTTP shell) is the same split for REST domains.
- **A new domain's tables** go in an exported `<DOMAIN>_SCHEMA` DDL constant in its
  `<domain>_db.ts`, applied by `ensureSchema` (`db.ts`) under the advisory lock (exemplars:
  `SOCIAL_SCHEMA`, `MAPS_SCHEMA`); only core character/account/token/world-state DDL lives
  in `db.ts` `SCHEMA` itself.
- **Tests** go in `tests/` (endpoint tests via the `FakeDb` helpers below). Bug fixes are
  test-first: a failing repro (extract the pure core if buried), then the smallest green change.

## Key files
The load-bearing seams, not an inventory (`ls server/*.ts` for the live set; a `<domain>.ts`
logic module pairs with a `<domain>_db.ts` that owns its SQL).

| File | Role |
|---|---|
| `main.ts` | HTTP server + the prefix-ladder dispatch (`routeHttpRequest` sends `/api` `/admin/api` `/oauth` `/internal` to four flag-gated entries) + the RETAINED legacy handler ladder, WS `/ws` upgrade wiring (builds the `createWsAuth` deps bag), boot/shutdown, leaderboard cache (migrated routes live behind `server/http/`, see its `CLAUDE.md`) |
| `game.ts` | `GameServer`: owns the `Sim`, the 50 ms loop, interest-scoped snapshots, command dispatch, chat. **Largest file; extract beside it, never grow it** (Module-first above) |
| `ws_auth.ts` | the whole WS auth handshake behind an injected deps bag (`createWsAuth`): strict first-frame `ONLINE_WORLD_AUTH_TYPE` check before credential or DB work, moderation/character checks, per-IP cap, the realm admission cap (`MAX_PLAYERS_PER_REALM`, default 5000, explicit 0 disables; checked with an in-flight admission counter so racing handshakes cannot admit past it; resumes and admins exempt), lease acquire, `game.join`. Unit-testable without a DB or HTTP server. Its rejection literals are wire contract the client matches verbatim (`src/ui/api_error_i18n.ts`): change one and the matcher in the SAME commit. Every refusal sends an `{t:'error'}` frame before closing (never a bare close code): the client classifies the literal, so a frameless refusal turns into a silent retry loop |
| `msg_rate_limit.ts` / `msg_lanes.ts` / `list_read_guard.ts` | the inbound WS flood defense: the pre-parse gate (frame + byte buckets and the shared abuse window that kicks), the post-parse per-class lanes, and the ignore/block list-readout meter (see "Inbound WS flood defense") |
| `ws_backpressure.ts` | the OUTBOUND counterpart to the flood defense: terminates a session whose `ws.bufferedAmount` climbs past the hard limit. `ws.send()` never blocks and a non-draining client's socket stays OPEN, so without this one frozen tab or deliberately non-reading attacker accumulates an unbounded write buffer and can OOM the realm; `readyState` checks do not catch it |
| `linkdead.ts` | pure session-lifecycle decision core: `planJoin` (resume/reject/join) + `LINKDEAD_GRACE_MS` (see Persistence) |
| `keepalive_sweep.ts` | pure self-clocked keepalive-sweep decision (`keepaliveSweepDelayed`, `KEEPALIVE_STALL_FACTOR`): a sweep that fires late (an event-loop stall) re-arms every session instead of terminating them, so one stall can never mass-disconnect the realm; a genuinely dead socket still reaps one clean interval later |
| `db.ts` | `pg` pool, core `SCHEMA` DDL + `ensureSchema`, character/account/token/world-state queries. Owns the timeout ladder (connect < statement default < the `runWithStatementTimeout` heavy allowance < the driver-side `query_timeout` backstop; constants + rationale at the top, relation pinned by `tests/server/tunables.test.ts`): wrap a known-long read in `runWithStatementTimeout`, never lift the session default, and remember `SET LOCAL` cannot lift the driver backstop. Boot DDL runs on a dedicated non-pool `Client` so schema setup is never capped |
| `account.ts`, `totp.ts` | account self-service routes: password change/forgot/reset, verified email change, data export, TOTP 2FA (`totp.ts` is the pure RFC 6238 core) |
| `admin_permissions.ts`/`admin_routes.ts`/`staff_db.ts` | fine-grained admin authz: permission vocabulary + role bundles / declarative route-to-permission map (fail-closed, guarded by `tests/admin_routes.test.ts`) / `accounts.admin_roles` SQL + `admin_role_changes` audit |
| `moderation_commands.ts`/`moderation_service.ts`/`moderation_db.ts` | pure parser for the in-game moderator chat commands (`/kick` `/mute` `/ban` `/suspend` `/spectate` `/jail`, ..., with duration caps) / the moderation service behind a host interface, wired into `GameServer` / writes + unified history |
| `chat_filter.ts`/`chat_filter_db.ts` | host-agnostic profanity/slur filter (soft cosmetic + hard server-enforced tiers) / admin word-list SQL |
| `bot_detector/contract.ts` / `stub.ts` | `BotDetector` seam (`#bot-detector`): the contract interface / the no-op stub used when the private clone is absent |
| `antibot_config_db.ts` | per-realm JSONB state plus append-only audit history for the bot-detector runtime config (the admin Bot Detector > Configuration panel); validation and live apply happen inside the detector (`BotDetector.applyConfig`) |
| `woc_balance.ts` | $WOC Solana RPC reads: holder-tier flair and connected-wallet balance, cached per wallet so the RPC URL (and any embedded key) never ships in the client bundle. No longer the only Solana RPC reader: the Seeker cluster below reads `SOLANA_RPC_URL` through its own transport |
| `seeker_*.ts` | the Solana Seeker genesis-token entitlement cluster: attestation-gated claim routes (`seeker_entitlement.ts`) with ownership verified against Solana RPC through its own hardened transport (`seeker_rpc_transport.ts`: `validatedSeekerRpcUrl` HTTPS-only, no embedded credentials, responses capped at `SEEKER_RPC_MAX_RESPONSE_BYTES`) |
| `woc_market.ts` (+ `woc_market_rules.ts`/`woc_market_db.ts`/`woc_market_routes.ts`/`woc_market_proxy.ts`/`woc_market_custody.ts`/`woc_market_sweep.ts`/`woc_market_sweep_watchdog.ts`/`woc_market_monitor.ts`/`woc_market_stepup.ts`/`woc_market_read_cache.ts`/`woc_market_price_cache.ts`/`woc_market_drift_warn.ts`/`woc_market_local_ledgers.ts`/`woc_market_stepup_flow.ts`/`woc_market_delivery.ts`/`woc_market_escrow_gate.ts`) | the $WOC Exchange (docs/prd/woc/marketplace.md): USD-cent auctions settled in $WOC. Pure rules core / schema + atomic transition SQL / RouteDef surface + operator arms / economy-service client with the dev-gated in-memory arm / the one bridge into the live Sim (escrow extraction, custody mail) / the per-realm advisory-locked sweep / the stuck-custody monitor / the wallet step-up challenge protocol. Config-gated off (`WOC_MARKET_ENABLED`); the game computes no token math. CUSTODY MOVES ARE STEP-UP GATED (B6/R1): `createListing` and the SELLER side of `acceptDirectedOffer` verify a single-use wallet-signed challenge IN THE SERVICE METHOD itself, never in middleware a future route could miss (`woc_market_stepup.ts`: server-built signed message, sha256 binding digest over the operation and every money figure it authorizes, atomic `consumeStepUpChallenge` DELETE scoped to realm+account, current-wallet re-check so a relink invalidates, expiry judged from the consumed row so it answers its own honest refusal; the dev economy's double-gated switch alone enables the devsig form); challenges are issued at `POST /api/woc-market/step-up/challenge` on their own rate bucket, the buyer's acceptance stays bearer-only (their money path signs its own payment), and the internal directed consummation call skips re-verification because the seller's acceptance already spent an offer-bound proof (the public route structurally cannot set the skip; pinned in the routes suite). Delivery is exactly-once by construction: the close tail commits as ONE transaction (`finalizeDeliveredSettlement`, a real CAS whose re-run reports `already_final` so converged work is never re-counted or re-notified; the minute-scale `redriven` beat converges an older binary's delivered-but-unclosed residue forward over bounded id pages, at most `SWEEP_BATCH` finalizes per beat, and `disposed` is its own sibling arm for sold-but-undisposed residue), the claims ledger attributes every ref to a rail (`grant_character_id` / `mail_intent_at`) and a resume needs PROOF: a mail claim re-mails only while its parcel is still in the live book (or this process's own UNWRITTEN attempt: once an attempt reached the post office, only the in-book check authorizes), a grant claim retries only its own live session, and anything unprovable (both intents NULL, a collected letter, a lease fence, a restart, an ambiguous grant refusal) PARKS, since a fence rejection cannot disprove an earlier autosave. What enforces exactly-once is layered on purpose: SQL enforces one CLAIM row per ref (`custody_ref` PK) and the one-way `booked_at` flip; the second-copy prevention itself is the sim's in-book dedupe plus the park subset, never the database alone. The direct hand-off books atomically with its fenced character save (`saveDeliveredCharacterBooked`). Sweep arms are error-isolated per arm AND per row (`onSweepError`); delivery stats count rows ADVANCED with park EVENTS on their own `parked` stat; parked rows rotate on the dedicated `sweep_parked_at` column (`touchSettlementRow`/`touchListingRow`) with an in-process minute backoff, and the stuck readout ages on `updated_at`, which rotation NEVER writes (rotating the age column hid parked rows from the monitor by construction). Anything parked is surfaced by `woc_market_monitor.ts`, one cached readout (counts SATURATE at a cap with an explicit `saturated` flag, stamped `asOfMs` so a stale-served readout is datable, cold failures negative-cached) behind `GET /internal/woc-market/stuck` (dashboard secret, `server/internal.ts`) plus a minutes-scale log beat that runs even while the market is disabled and warns once per failure OR staleness streak; its `stop()` drains an in-flight beat before the pool closes. LOCK ORDER for a market transaction that touches bid rows AND the listing row: bids first (`suspendListingIfSafe` pre-locks the open set PLUS 'won' by id, `activateBid` the open set; `insertSettlement` stamps its one winner bid; `finalizeDeliveredSettlement` pre-locks the open set plus the winner), listing second; the reverse order deadlocks. A transaction that takes no bid row lock documents its carve-out in place (`cancelListingIfUnbid`, `insertPendingBid`, `escrowInsertListing`, `saveDeliveredCharacterBooked`, `claimBuyNowLock`, `extendAuctionForBondProgress`, `closeCancelPendingListing`). EVERY explicit marketplace row lock is `FOR NO KEY UPDATE` (the write-path rider's narrowing: guard-vs-guard exclusion is self-conflict, and FK-child INSERTs' KEY SHARE no longer waits out unrelated guards; the completeness pin holds the counts and the bond pg suite proves both halves), and EVERY withTx guard bounds BOTH its lock wait (`SET LOCAL lock_timeout`, `ESCROW_LOCK_TIMEOUT_MS`) and its idle hold, surfacing 55P03/40P01/25P03 and the never-started tag as the typed `contended` refusal (all four contention classes counted on the stuck readout) (the completeness floor in `tests/server/woc_market_directed_sql.test.ts` counts both bounds at all thirteen sites: the twelve guards plus `boundedWrite`, the shared seam every direct row-locking plain writer rides since the escrow write-path rider, so those too refuse contention at the 2s ceiling counted instead of camping the 15s session default unclassified (`clearBuyNowLock` is best-effort by contract, retry-once-then-swallow-all with a loud line: its callers are compensation arms after a decided answer and the lock ages out; the two signature recorders answer a typed `'contended'` their callers map to the retryable `confirm_in_flight`, never a 500 on money in flight); `insertPendingBid` and `activateBid` were the last guard holdouts, and the bond pg suite proves the held-lock refusal lands within the deadline). THE ESCROW ENTRY RIDES THE SAVE FIFO (H5): `createListing`'s whole custody critical section (extract, authoritative re-check, `escrowInsertListing`, compensation) runs as ONE job on GameServer's per-character save queue (`WocMarketCustody.runSerialized` over `GameServer.enqueueCharacterWrite`), so a stale pre-extraction autosave always commits BEFORE the escrow write and can never resurrect an escrowed item; the job is depth-capped at one per character with a wait deadline (both refuse the typed `contended`, and a cancelled job has extracted nothing), dirty guild books flush atomically FIRST (never from inside the job: FIFO self-deadlock), every custody blob serializes through `serializeCharacterForPersist` (the session save fixups; a raw serialize is a jail escape), a thrown escrow write restores the copy only on rollback PROOF (`server/pg_rollback_proof.ts`; an ambiguous throw parks the copy out of the bags, loudly), and its transaction carries the workload-scoped `ESCROW_STATEMENT_TIMEOUT_MS` instead of the heavy save allowance. The delivered-save twin (`commitGrant`) rides the FIFO too since the escrow write-path rider closed its carve-out: custody's `persistGrantSerialized` re-serializes the buyer's blob INSIDE the FIFO slot (a stale pre-grant autosave can no longer roll a delivered item back out of the durable bags) under a wait deadline whose 'busy' answer PARKS the row with its claim, grant intent, and ledger entry intact, counted as the `grant_busy` kind, and the batch driver stops the scope's settlement work after a small busy budget, so a save-wave wedge costs the locked delivery segment a bounded number of deadlines per pass, never one per row. PAYMENT INTAKE is signature-first on BOTH legs (`confirmBond`/`confirmSettlement`; the route layer shape-checks the signature to safe printable characters first, the log-forging guard): the submitted signature is recorded in the ledger BEFORE any expiry verdict, so no refusal can discard the trace of money in flight; the chain's verdict decides, and a paid-but-undecided bond (`pending_bond` with a recorded signature, bond unheld) is IMMOVABLE: quote refreshes (`setBidBondQuote` CAS), abandons, and every teardown skip it, leaving it with `confirmingBonds` until the chain decides (a settled verdict against a closed listing routes it to `refund_due` via `activateBid`'s supersede arm). A decided-AGAINST verdict lapses only an UNHELD bond: `lapseBid` refuses on a held one (a reorg flip) and the poll parks that survivor, since voided held money is unreachable to every refund arm. A retry of the recorded signature after the verdict answers the OUTCOME on both legs (bond standing, or the settlement's current state), and a DIFFERENT signature while one is deciding answers `woc_market.confirm_in_flight` (leg-neutral copy). The bond poll rotates: a bond still undecided past the poll park delay (`WOC_MARKET_BOND_POLL_PARK_SECONDS`, its own tunable, aged on the signature recording) parks on `poll_parked_at` (`touchBidPollRow`, its own rotation column and partial index; `confirmingBonds` orders on the shared `BOND_POLL_ROTATION_ORDER` text and takes the caller's backoff exclusion), so a never-decided set cannot own the batch head while young bonds keep full cadence. The H15 bound: the sweep's own `reviewed` arm (`confirmingOverdueSettlements`, a separate read with its own `SWEEP_BATCH` budget so a confirming backlog can never own the deadline-expiry batch head) parks 'confirming' rows older than the config knob `WOC_MARKET_CONFIRMING_REVIEW_HOURS` (default 6, clamped at 720 hours so the bound cannot be configured out of existence, `wocMarketConfig().confirmingReviewMs`) in the OPEN operator state `review` (fail_reason `confirming_overdue`; no default/forfeit/strike/cascade, the payment may have landed; operator resolution is the review -> confirmed / review -> failed transition pair, driven by POST /internal/woc-market/settlements/:id/resolve (dashboard-secret gated, realm-scoped CAS; `woc_market_review_resolution.ts`); hand SQL is forbidden, it bypasses the transition CAS). The settlement-state CHECK evolves in place once per legacy database (gated DROP+ADD NOT VALID; without it a pre-'review' database would 23514 on the first park). The one-open-settlement index is `woc_market_settlements_open2` (the open states incl. `review`; predicate text shared via `OPEN_SETTLEMENT_STATES_SQL`, with `PAID_SETTLEMENT_STATES_SQL` its open-minus-'offered' probe sibling (a separate literal; the structural floor pins the subset relationship)); the readout gains the `reviewSettlements` class (no age filter: rows enter `review` already aged by the sweep) and the `stuckBonds` class (aged on the same knob). Anti-snipe extension rides BOND PROGRESS (`extendAuctionForBondProgress`, fired only on a settled chain verdict, at `confirmBond` or the bond poll's settled arm, or on the ONE ledger-matched pending word at `confirmBond`, `WOC_MARKET_LEDGER_MATCHED_REASON` = the verifier's `awaiting_finality`: an allowlist, so `not_yet_visible`, `service_unavailable`, and any unknown pending word extend nothing, since a fabricated signature mints those for free; never the raw submission, never a refusal), never placement; anchors split by arm (pending on the FIRST recording, which the submit returns, so re-posts cannot creep the close; settled on the verdict moment, the poll's observation clock for a poll-settled bond). THE BOND FIGURE IS SERVICE-OWNED: bond quotes send the BID (`bidCents`) and adopt the response's `bondCents` onto the bid row through the `setBidBondQuote` CAS (a `bond_amount_drift` refusal carries the expected figure to adopt and re-quote; `woc_market_rules.ts bondCents()` is the ceil-rule pre-quote mirror: display, guard sizing, and the inserted row's seed until adoption), and the wire repeats service verdict words to players only through the screened vocabularies (`screenWirePendingReason`/`screenWireFailReason`: known words verbatim, unknown collapse to the stable `other`; rows and logs keep the verbatim word for operators). The economy seam is REFERENCE-keyed end to end (one memoRef can legitimately hold TWO settled service quotes via entry adoption; a settlement revival re-quote logs the retired reference+signature pair as the operator's reconciliation trace). The buy-now abandon-loop defenses: `claimBuyNowLock` diagnoses every refusal class from a LOCK-FREE advisory read for evidence already committed (the cooldown probes read the abandon ledger there too, so a cooled-down account's retries never take the listing lock; only the self-steal, whose abandon row is minted inside the transaction, pays the guard transaction) and re-runs each check authoritatively inside it (refusing under the row lock serialized every hopeful behind the holder); an OPEN settlement refuses the claim as `locked` BEFORE any recording (a rival's probe must never stamp a PAYING holder), both recorders (the steal arm and the overdue arm) run the ONE shared statement (`RECORD_ABANDON_SQL`) whose exempt predicate refuses a window only for a chain-plausible refusal class (`WOC_MARKET_ABANDON_EXEMPT_FAIL_REASONS`; a bare posted signature deliberately does NOT exempt, or one fabricated request would bypass the cooldown arm; the failed-row expiry preserves `fail_reason` so the class survives; retention: `pruneWocBuyNowAbandonsBatch` over the `woc_market_buy_now_abandons` ledger, `WOC_MARKET_ABANDONS_RETENTION_DAYS`), and `claim_cooldown` refuses on the per-listing re-claim cooldown or the account-wide hourly cap, carrying WHEN a retry can first succeed (`retryAtMs` from the store: the two probes run in ONE round trip and the announced moment is the FIRST admissible one, pinned at the boundary; `retryAfterSeconds` in the refusal params, rendered as a localized multi-unit duration by the client) (public listings only; directed sales keep their strike, tunables in `woc_market_rules.ts`); `clearBuyNowLock` is HOLDER-guarded. THE DIRECTED RAIL keeps every promise the public rail keeps (the directed-rail hardening): a directed offer pins the agreed copy's fingerprint at CREATION (`item_pin`, the fixed-width sha256 DIGEST of the sim's `itemCopyPin` string, never the raw serialization; acceptance validates the AUTHORITATIVE extracted copy inside the escrow job and refuses the typed `item_mismatch`, its own wire code; the pin's client source is honest because trade STAGING itself previews per-copy identity, `src/sim/social/trade.ts` `stagedOfferSlots` over the swap's own selection walk, and the offer intake bounds `itemInstance` at `INSTANCE_MAX_JSON_BYTES`); ONE pending offer per (buyer, seller) pair (`woc_market_offers_pair_pending`, 23505 answers the typed `offer_pending`, its own code since `already_pending` describes a pending BID: the strike-farming bound); a directed listing accepts NO bids (`insertPendingBid` refuses `not_found`, anti-enumeration, before any other verdict); the directed hold is the settlement window (`WOC_MARKET_DIRECTED_HOLD_SECONDS = WOC_MARKET_SETTLEMENT_WINDOW_SECONDS`, a pinned identity), never an auction duration; directed listings COUNT against the shared 12-listing cap in BOTH halves (the service pre-check and the in-transaction count are byte-identical predicates; loosening one reopens the race); an accepting buyer who never pays is STRUCK (never-claimed: the `closed` arm's directed branch, gated on `everSettledForListing` probed AFTER the close CAS so the overdue arm's strike for a claimed-then-unpaid window can never double it; claimed-then-unpaid: the overdue arm, which now also AUTO-CLOSES the directed listing `unsettled` so the return flight brings the item home with no seller cancel; ALL THREE strike arms (both directed arms AND the auction-default arm) ride `strikeDefaultingBuyer`, which spares the strike while the price oracle is unhealthy AND on the shared exempt refusal vocabulary `WOC_MARKET_ABANDON_EXEMPT_FAIL_REASONS`, since a payment default presumes payment was possible (the auction arm's bond FORFEIT stays ungated per R2; the outage-forfeit question is recorded for the pre-enable audit); an UNEXPIRED claim lock refuses the directed close outright, the buyer is mid-payment); `createDirectedOffer` runs `guardTerms` (the strike parity gate: every path that can strike sits behind terms, and it is what makes the pay arm's recorded terms premise true) and `guardBalance` and refuses wallet twins (`self_offer`); the SAME-WALLET self-deal guard (the relink dance: the listing records `seller_wallet` at creation and `wallet_links.pubkey` is UNIQUE, so the twin is sequential) lives in `claimBuyNowLock` as a locked re-check PLUS a NOT EXISTS predicate in the claiming UPDATE (zero rows answers the typed `own_listing`, never a deref 500), with a service fast path in `buyNow` from values already in hand. The escrow transaction STAMPS the consummated offer's `listing_id` atomically with the insert (listing exists IFF the offer is stamped; a zero-row stamp CAS aborts `not_pending`), which is what lets the `convergedOffers` sweep arm prove rollback and unwind the accepted-unstamped residue (reopen inside the TTL, expire past it) inside a TWO-SIDED age window: `WOC_MARKET_OFFER_CONVERGE_SECONDS` clears every transaction bound on the young side, and `WOC_MARKET_OFFER_CONVERGE_MAX_AGE_SECONDS` refuses rows the listings prune's ON DELETE SET NULL un-stamped long after their deal completed (NOT rollback evidence; without the old bound the arm would relabel real history); a proven-rollback escrow throw also reopens in-request, an ambiguous one writes nothing and leaves the converge arm the durable truth. `expireDueDirectedOffers` carries the outer status qual + FOR NO KEY UPDATE SKIP LOCKED (EvalPlanQual re-checks only own columns; without the qual it could expire an offer whose listing just committed). `ESCROW_STATEMENT_TIMEOUT_MS` is 4000 over FIVE workload statements (the cap count no longer skips directed rows and the stamp is the fifth; the tunables relation prices exactly that). Retention: `pruneResolvedWocOffersBatch` (`WOC_MARKET_OFFERS_RETENTION_DAYS`) prunes resolved offers; the offers table carries the `listing_id` FK index (`woc_market_directed_offers_listing`) so the listings prune never pays a per-row sequential scan. `pruneBookedWocCustodyClaimsBatch` (`WOC_MARKET_CUSTODY_CLAIMS_RETENTION_DAYS`, default a full year, comfortably above the listings window) prunes BOOKED claim rows only, aged on `booked_at` with a parsed-ref referent guard (a claim whose settlement or listing row still exists never prunes, whatever its age: the exactly-once evidence outlives every possible re-driver); unbooked rows are the operator queue and are structurally out of reach. `pruneExpiredWocStepUpChallengesBatch` is the knobless nightly drain for realms that stopped issuing step-up challenges (prune-on-issue stays the primary reaper). The trade arm's 2s offer poll (`directedOffersForAccount`, the SERVICE clock passed through the seam) returns pending and accepted rows PLUS just-resolved rows and closed listings inside `SETTLED_OFFER_GRACE_MS` (the verdict read: the non-resolving side learns declined / withdrawn / expired off the lingering row) and runs on the two additive non-partial `(realm, buyer_account|seller_account, created_at DESC)` indexes `woc_market_offers_buyer_all`/`_seller_all` (boot DDL under the same pre-enable-empty rationale; the pending-only inbox/outbox partials they superseded are retired by idempotent DROPs; the cost is linear in the account's RETAINED offer history, so `WOC_MARKET_OFFERS_RETENTION_DAYS` is the control and the DB-free structural floor plus the pg suite's index-definition and EXPLAIN pins keep the shape); its LATERAL latest-settlement probe seeks `woc_market_settlements_listing_latest` (`(listing_id, id DESC)`, superseding the single-column FK index by idempotent DROP), and the `price_desc` browse sort has its own DESC-expression partial (`woc_market_listings_live_price_desc`; the ASC id tiebreak is shared with `price_asc` for page stability, which is exactly why a backward scan of the ASC index cannot serve it); `/status` also carries `directedHoldSeconds` so the trade arm's commitment note names the deadline whose lapse earns a strike. The guard transactions this work added or grew (incl. `cancelListingIfUnbid`) also bound idle-in-transaction holds (`GUARD_IDLE_TX_TIMEOUT_MS`, equal to `ESCROW_LOCK_TIMEOUT_MS` by ruling; 25P03 joins the typed `contended` codes). A seller cancel on an unpaid locked window stamps CANCEL-INTENT (`cancel_requested_at`: no new claims or bids, the holder keeps their window, the `cancelClosed` sweep arm (batch read behind `woc_market_listings_cancel_rotation`) closes it cancelled after an unpaid expiry with a park-rotate-backoff for skipped rows; a paid window still refuses `settlement_in_flight` and cancel-pending never tears a live settlement). Pins: the DB-free structural floor in `tests/server/woc_market_directed_sql.test.ts`, the wire-shape suite `tests/server/woc_market_wire_pins.test.ts` (every serializer's exact key set through the real handlers, the screened vocabularies, the bond figure by value, the item-named activity rows: `bidsByAccount`/`settlementsByAccount` join the listing's item id so pay rows can name what the money is for), and the env-truth guard `tests/server/woc_market_env_docs.test.ts` (every market env name documented and live, both directions) always run; the interleaves in `tests/woc_market_settlement_pg_integration.test.ts`, the delivery crash-point matrix in `tests/woc_market_delivery_pg_integration.test.ts`, the bond/lock lifecycle suite `tests/woc_market_bond_pg_integration.test.ts`, the directed-rail suite `tests/woc_market_directed_pg_integration.test.ts` (fingerprint, hold, shared cap, wallet twin, strike/auto-close, converge, expiry-vs-stamp interleave, deadlock probe, offers prune), the realm-isolation suite `tests/woc_market_realm_scope_pg_integration.test.ts` (realm and account scoping proven against symmetric realm pairs holding the same accounts; the step-up realm quals are proven in the step-up suite), the step-up suite `tests/woc_market_stepup_pg_integration.test.ts` (single-use consume, expiry, prune, nonce and operation constraints), and the plan-class suite `tests/woc_market_plan_pins_pg_integration.test.ts` (the consolidated EXPLAIN list: every hot read pinned to an index plan via the recording-pool + `enable_seqscan = off` recipe, plus the realistic-row-count poll-read preference proof) need `TEST_DATABASE_URL`. Its settlement-guard unique indexes deliberately ride boot DDL, not `concurrent_indexes.ts` (pre-enable-empty tables; rationale at the DDL). THE HOT READ SURFACE IS METERED AND CACHED (H11): seven marketplace GETs carry `rateLimit(WOC_MARKET_READ_POLICY)` (seller-history joined at the Browse click-through: click-driven only, never polled, its own bounded-LRU cache arm) (one shared read bucket sized against the real poll cadences at the constant in `ratelimit.ts`, and TIER-1 ONLY, the documented high-volume opt-out: tier-2 'global' would spend two `rate_limits` UPSERTs per allowed poll); `GET /trade-partner` deliberately stays on the SMALLER quote bucket (an existence-plus-wallet oracle over free-text names must not inherit the widened polling budget). The read paths with a database cost (`browse`, `listingDetail`'s row, `salesHistory`, `myActivity`) read through the injected `WocMarketReadCache` (`woc_market_read_cache.ts`: the `KeyedCachedRead` seam per surface, single-flight, LRU-bounded, values frozen defensively). Caller-minted key entropy is fenced out: item ids are shape-screened at the routes (`ITEM_ID_SHAPE`, sorted and de-duplicated), item-FILTERED browse queries and UNKNOWN-item history reads bypass the cache entirely, so a flood cannot evict the hot shared pages. The cache is OPTIONAL on `WocMarketDeps` (absent = uncached, the test rigs) and the SAME instance rides the routes runtime, whose mutation handlers own the busts (every successful market mutation busts the listings surface and the actor's readout; the three moderation arms bust what they change; sweep transitions deliberately ride the short TTLs). The directed-listing party gate runs per request OVER the shared cached row, so a warm cache never widens visibility; wallet link/unlink writes bust the activity readout through `registerWocMarketReadCacheForBusts` (identity never waits out a TTL); the cache counters ride the internal stuck readout (all pinned in `tests/server/woc_market_hot_reads.test.ts`). `myActivity` runs its six reads SEQUENTIALLY on purpose (one pool client at a time; the counted bound lives in the hot-reads suite and the settlement pg suite). The price read rides `woc_market_price_cache.ts` (single-flight, short failure memo so an outage never blanks prices for a full TTL, stale-while-revalidate bounded at `WOC_PRICE_STALE_SERVE_MAX_MS` so the health gate still converges); estimates share the keyed cache seam per usdCents. THE SWEEP LOCKS PER SEGMENT: `sweepSegments()` is the pass plan (`sweepPass()` runs it whole for tests); the shell holds the advisory lock and its one pool client only per LOCKED segment. The read-only confirm polls (`chain-polls`) run UNLOCKED, holding no client across their chain round trips, their writes being single-winner CAS transitions (a deploy-overlap peer costs duplicate confirm round trips, never duplicate effects; pg proof in the settlement suite); the money-moving `bond-payouts` segment stays LOCKED (bondsDue is an unclaimed read, so game-side exclusion of the refund/forfeit RPCs is provable rather than resting on the service's reference idempotence alone). The plan shape is pinned by identity in the hot-reads suite. `woc_market_sweep_watchdog.ts` is the mid-flight voice: pass/segment stamps from the shell, a repeated overrun warn past one confirm timeout, and a readout merged into `GET /internal/woc-market/stuck` (which also carries the read-cache counters, the price-cache memo ages, the 25P03 `idleTxKills` counter, its 55P03 twin `lockWaitTimeouts`, and the `pgPool` occupancy gauge: sustained `waiting > 0` is the brownout precursor). `woc_market_drift_warn.ts` owns the verdict-drift channel (`logSafe`, the capped once-per-word warns), judging membership through the exported `WOC_MARKET_WIRE_PENDING_SET`/`WOC_MARKET_WIRE_FAIL_SET`, the same Sets the wire screens use. `/status` also carries the bond schedule mirror (`bond.rateBps`/`minCents`/`maxCents`/`pendingTtlSeconds`) so client disclosure copy resolves live figures (`tests/woc_market_copy_figures.test.ts`); `woc_market_local_ledgers.ts` owns the process-local ledger arithmetic (`pruneWocLocalLedgers`, `wocBackedOffIds`); `woc_market_stepup_flow.ts` owns the step-up FLOW (`stepUpProofRefusal`, `issueStepUpChallengeFlow`) behind a `WocStepUpFlowCtx` slice, returning refusal REASONS the coordinator wraps (`tests/server/woc_market_stepup_flow.test.ts`); `woc_market_delivery.ts` owns the delivery arms (the batch driver, the eager and crash-recovery entries, both residue converges, the book-once custody rail, the direct hand-off with its grant ledger, the return flight) behind a `WocDeliveryCtx` slice, with the ledgers staying on the service as live state; `woc_market_escrow_gate.ts` is the realm-global escrow in-flight bound (custody-only by decision: the sweep and the monitor never acquire it; identity-tokened holds so ages are exact and the leak reclaim, run by the acquire AND the pre-burn `saturated()` probe, hits only the wedged hold), refusing saturation as the typed `contended` counted under `realm_refused` at BOTH arms, and BOTH escrow entries (`createListing` and the seller-side acceptance) refuse while the process drains, ahead of any step-up consumption (the optional `draining`/`escrowSaturated` deps off the health flag and the gate's probe). |
| `bank_ledger.ts` | append-only `bank_ledger` observer: diffs `Sim.bankInfoFor` around each bank dispatch and writes the moved delta via a fire-and-forget FIFO (audited offline by `scripts/bank_audit.mjs`) |
| `bank_entitlements.ts` | pure bonus-slot source registry + `computeBankBonus` (email verified / Discord / wallet / qualified referrals); stamped at the fresh-join handshake via the injected `WsAuthDeps.bankBonusForAccount`, never client-supplied |
| `deeds_db.ts` / `deeds_records.ts` | deeds SQL boundary (`character_deeds` upserts, rarity counts, recent earns, broadcast opt-out; the board roll-up is `deedsBoardRanked` in `db.ts`, aggregated SQL-side with Renown passed as parameters) / the `deedUnlocked` observer: fire-and-forget FIFO upserts, the `isMarqueeDeed` predicate, and the dual storefront mirror fan-out (BOTH the Steam and Epic `onDeedRecorded` hooks fire after each upsert, D21; the marquee guild/friend broadcast fan-out itself lives in `game.ts`); the sim decides unlocks, this only records them |
| `deeds_board.ts` / `deeds.ts` | the Renown leaderboard's pure scoring core (account-level dedupe, entry floor, score-then-earliest tie-break; Renown values come from the content table, never SQL) / the `RouteDef` API surface (public rarity read, broadcast toggle), TTL-cached in `main.ts` |
| `steam/` / `epic/` | the env-gated (`STEAM_ENABLED` / `EPIC_ENABLED`, off by default) storefront achievement mirrors: link-not-login association plus the deed-to-achievement push, mirror-never-authority. The shared pattern is documented in `server/steam/CLAUDE.md`; `server/epic/CLAUDE.md` covers only the Epic deltas |
| `reliquary.ts` / `reliquary_rarity_db.ts` | the Reliquary API surface: registry-only `RouteDef`s mirroring the deeds rarity rung (static `routes`, `configureReliquaryRuntime` injection, no legacy twin); the rarity aggregate unnests `characters.state` JSONB in place and shares the deeds rarity TTL cache + single flight in `main.ts`, so the characters walk never gains a second cadence |
| `guild_bank_state.ts` (+ `guild_bank_op_guard`/`op_log`/`counterparty`/`log`) | guild bank host glue: the escrow-merge save path (a session persists only its OWN unflushed op deltas, never the shared live book; the row is rebuilt inside the transaction, and a refused book half aborts the paired character half via `GuildBankEscrowRefused`), the dedicated op token bucket, unflushed-op-log compaction, counterparty ledger rows, and the member-visible activity-log read. SQL seam: `db.ts` `loadGuildBankRows`/`saveCharacterAndGuildBankState`; design record `docs/guild-bank/escrow-fix-plan.md` |
| `claudium.ts` / `claudium_proxy.ts` | CLAUDIUM, the server-authoritative soft currency: a thin authenticated pass-through that computes NO peg/price/balance (ALL economy logic lives in the external service), proxied through `claudium_proxy.ts`, which fails closed with typed unavailable results and never throws when the service is unset or unreachable. The shared `handleClaudiumApi` core is called by BOTH dispatch arms (mirrors the daily-rewards twin) |
| `parse/` | the combat parse recorder: a read-only observer at the tick drain that segments play into fights and ships gzip NDJSON to the external parse service; see `server/parse/CLAUDE.md` |
| `email/` | transactional + marketing email, the ONE place `server/` renders final localized text itself; see `server/email/CLAUDE.md` |
| `daily_rewards.ts`/`daily_rewards_db.ts` | wallet-gated daily reward tasks + Discord winner announcements; participation bans are WRITTEN in `moderation_db.ts` (`setDailyRewardsBan`, permanent or timed via `durationHours`, recorded in the moderation audit; `tests/moderation_db.test.ts`), this pair owns only the eligibility read (`banForAccount`, `tests/daily_rewards_ban_db.test.ts`) |
| `discord.ts` (+ `discord_oauth`/`discord_db`/`discord_relay`/`discord_activity`/`discord_link_changes`/`discord_status_cache`/`discord_bot_counters`/`http/discord_bot_metrics`) | Discord integration: link/unlink OAuth shell + rewards, in-game `!` community-command relay, activity feed the bot drains, the bounded linked-member change feed the outbox carries, the keyed `/api/discord` status cache busted on every write, and the bot's governor counters exposed as prometheus series |
| `github.ts` (+ `github_oauth`/`github_db`/`github_contributors`) | GitHub contributor linking for the developer badge + merged-PR tally |
| `oauth.ts`/`oauth_db.ts`, `character_sheet.ts`, `profile_page.ts`, `avatar.ts` | read-only companion API: OAuth code+PKCE and device grants (scope `character:read`), pure sheet normalizer, public SEO profile pages + generated avatars |
| `maps.ts`/`maps_db.ts`/`maps_routes.ts`, `user_assets*.ts` | map editor: custom-map persistence with fork lineage / hardened player GLB uploads (both mirror the `SocialService`/`SocialDb` split) |
| `tick_profiler.ts` / `tick_rate_meter.ts` | debugging the 50 ms budget: rolling per-phase loop timings, achieved wall-clock tick rate (the two can disagree, see the meter header) |
| `mob_scan_tick_stats.ts` | folds the sim's per-tick mob-scan visit counters (`Sim.mobScanCounters`, observer-only) into the `PERF_TICK_LOG` heartbeat tokens (`aggroVisits=`/`threatVisits=`) and the admin tick-capture accumulators; `game.ts` keeps only the holder and the apply call |
| `cached_read.ts` / `deeds_board_warm.ts` / `discord_status_cache.ts` | the three shared-read cache shapes: single-key `createCachedRead` (TTL, single-flight, stale-on-error, joiner-refusing bust) / the extended `singleFlight(run, epochOf?)` for per-scope epoch-keyed board flights / the keyed bounded per-account cache behind `GET /api/discord` (see Hot paths) |
| `auth_guard_core.ts` / `woc_auth_guard_cache.ts` | the per-request auth-guard reads' pure core (token scope/expiry verdict + the moderation status ladder, computed from raw rows at read time) and the marketplace-scoped cache over them: raw rows only, no negative caching, no stale-serve, keyed busts every projection writer calls (post-COMMIT where transactional; completeness discovered by `tests/server/auth_guard_bust_coverage.test.ts`), consumed ONLY through the woc_market_routes guard bundle via `WocMarketRuntime.authGuardDb` (the admin gate and every other guard surface stay on the direct db reads; the import boundary is pinned). `WOC_AUTH_GUARD_CACHE_TTL_MS` (5s) is the cross-process revocation/ban delay ceiling: process-per-realm shares one database and accounts/auth_tokens are not realm-scoped, so a write committed by ANOTHER realm process is invisible here until the TTL lapses |
| `retention_sweep.ts` | the advisory-locked, self-clocked nightly sweep of batched per-table prunes; every table that grows without bound registers here (see Hot paths) |
| `concurrent_indexes.ts` | post-boot `CREATE INDEX CONCURRENTLY` seam for new indexes on big live tables |
| `realm_readout_memo.ts` / `event_frame.ts` / `interest_candidates.ts` | broadcast build-once seams: per-pass realm readout memo (rides `maybeRaw`), serialize-once event frames (sent via `sendRaw`), per-cell shared interest gathering (see Hot paths) |

## Invariants, YOU MUST keep these
- **Trust nothing from the client.** Movement intent + `cmd`s arrive over WS;
  every combat/loot/quest/economy/talent outcome resolves *inside the `Sim`*.
  `dispatchMessage` (game.ts) type-checks each field before calling a `sim.*`
  method, keep that guarding when you add a command.
- **Wire protocol lockstep with `src/net/online.ts`.** Server sends `hello` /
  `snap` (with `self`/`ents`/`keep`) / `events` / `social` / `censor` / `error`; client
  first sends `{ t: ONLINE_WORLD_AUTH_TYPE, token, character }`. The versioned discriminator
  rejects mixed built-in world layouts in both rolling-deploy directions before admission.
  Any wire change must land in both files together.
- **No browser/render/ui imports.** This bundles for Node, import only from
  `src/sim/`, `src/world_api.ts`, and `node:*`. Never from `render/`/`ui/`/`game/`/`net/`.
- **SQL lives only in `db.ts` and `*_db.ts`.** Logic modules (`game.ts`,
  `social.ts`, `admin.ts`) carry zero raw SQL: `SocialService` talks to a
  `SocialDb` interface so tests use an in-memory fake. Don't inline `pool.query` in a logic module.
- **`ALLOW_DEV_COMMANDS=1` gates the whole dev-cheat surface** (dev/E2E only, **never prod**):
  every `dev_*` case in `dispatchMessage` (game.ts), `Sim.devCommands` (set from the env var
  when `GameServer` constructs the `Sim`, enabling the full `/dev` chat set in
  `src/sim/dev_commands.ts`, `handleDevChat`: level, teleport, give, spawn, heal, and friends),
  and the dev-only `GET /api/perf` read (both dispatch arms).

## Persistence model
- Character level + full state (gear/bags/bank/quests/position/money/talents/arena/lifetimeXp/
  deeds/deedStats/activeTitle/renown) stored as **JSONB** in `characters.state`;
  `serializeCharacter` converts to and from the `Sim`.
  Same-blob atomicity is the bank's anti-dupe cornerstone: the personal bank NEVER gets its own
  `world_state` row. Treat the bank rollout as forward-only (a pre-bank binary's save drops the field).
- **Per-character load lease** (`character_leases`): acquired at the WS handshake between
  `getCharacter` and `game.join` (90 s TTL, heartbeats on the autosave loop, nonce-fenced release),
  so two processes can never double-load one character. The steal predicate has three arms
  (expiry, same holder, same AUTHENTICATED account), so a player whose old process died
  reclaims their own character immediately instead of waiting out the TTL; rows with a NULL
  `account_id` fail that arm closed. Character saves are lease-fenced: every fenced
  character-write path (the `db.ts` save pair plus `saveCharacterStateOnClient` inside the
  marketplace escrow and delivered-save transactions)
  takes the session's lease nonce and lands only while the row still carries it (an in-statement
  EXISTS fence, never check-then-write), and a fenced-out session is kicked with the existing
  takeover signal, so a displaced zombie can never overwrite live state. `bank_ledger` is the
  append-only per-op audit trail (`scripts/bank_audit.mjs` replays it offline).
- **Disconnect is not leave.** `linkdead.ts` holds a dropped session in-world for
  `LINKDEAD_GRACE_MS` (5 min); `planJoin` (pure, unit-tested) decides resume/reject/join, and a
  resume never re-acquires the lease. Forced disconnects (moderation, takeover, anti-bot) skip
  grace and tear down via `GameServer.leave()`. Never resume a session whose teardown has begun
  (the `left` flag): the reconnect would get a zombie whose lease is released under it.
- Every durable LIVE-SESSION character write rides the per-character FIFO
  (`GameServer.enqueueCharacterWrite`, backed by `serial_writer.ts` `createKeyedSerialWriter`):
  commit order is enqueue order across autosaves, leave flushes, the marketplace escrow
  persist, and (since the escrow write-path rider) the marketplace delivered save
  (`commitGrant` through custody's bounded `persistGrantSerialized`: in-slot serialize, a
  wait deadline that parks instead of blocking the sweep), and every write's blob carries
  the session save fixups (`character_save_fixups.ts`: jail/spectate position, stowed pet,
  the jail flag). Recorded exception: the offline
  admin/boost writers, which never race a live session. Cross-queue order is the character
  FIFO first, THEN the market serial writer; never enqueue from inside a market thunk, an
  open transaction, or another job for the same character.
- Save cadence: autosave every **30 s** (`AUTOSAVE_SECONDS`), on `leave`, and on
  `SIGINT`/`SIGTERM` shutdown (`saveAll`). World Market is a per-realm JSONB row (`world_state`
  key `market:<realm>`), realm-scoped like everything else; the one-shot legacy `'market'` row
  backfill lives in `server/market_backfill.ts`, its rollback story in
  `docs/api-pipeline/phase-20-rollback-runbook.md`.
- **Character names are globally `UNIQUE`** (catch `23505`, return 409 "name taken").
- Leaderboards (`topLifetimeXp`, `topArenaRatings`) sort on JSONB expressions and
  are read through the **in-memory cache in main.ts**, never per-request under load.

## Hot paths: shared reads, retention, broadcast
One process serves a whole realm, so per-request and per-tick cost is what scales.
Three seams keep it flat; use them, never re-invent them.

- **Shared (viewer-identical) reads are cached with single-flight.** Three shapes:
  `createCachedRead(refresh, {ttlMs})` (`cached_read.ts`) for a single-key read (TTL,
  single-flight, stale-on-error, and a bust that refuses in-flight joiners), the
  extended `singleFlight(run, epochOf?)` (`deeds_board_warm.ts`) for per-scope board
  flights keyed on `() => boardEpoch`, so the existing `bustBoardCaches` epoch bump also
  evicts readers that joined mid-refresh, and the keyed bounded per-account
  `discord_status_cache.ts` (a Map of CachedRead entries with LRU eviction) for the one
  account-scoped hot read, `/api/discord`. Exemplars: `admin_overview_cache.ts` (dual-arm
  memo), `daily_rewards_board_cache.ts` (day-scoped), the leaderboard/guild/arena/deeds
  flights in `main.ts`; pinned by `tests/server/board_read_single_flight.test.ts`.
  Rules: a new endpoint whose response is identical for every caller (a board, a count,
  an aggregate) reads through one of the first two shapes, never a per-request
  `pool.query` (the keyed third shape is for an account-scoped hot read);
  anything a moderation action can change MUST be bust-wired in the same change (TTL
  alone delays enforcement); a deliberately non-busted read (a moderation-invariant
  COUNT) records why in a comment. The marketplace auth-guard cache
  (`woc_auth_guard_cache.ts`) extends this rule to the two guard reads: ANY new write
  that changes what `authTokenRowForToken` or `moderationRowForAccount` returns must
  call the matching `bustWocAuthGuard*` in the same change; the discovery pin
  (`tests/server/auth_guard_bust_coverage.test.ts`) reds on an unbusted writer.

- **Every table that grows without bound gets a retention story in the same change.**
  The nightly sweep (`retention_sweep.ts`, registered after listen in `main.ts`) runs
  batched prunes under a per-run budget; windows are env keys in `.env.example`, each
  with a POSITIVE code default, so an unset key prunes at the value its `.env.example`
  row states; `0` is the explicit keep-forever, and the reads are deliberately
  untrimmed so a whitespace value numbers to 0, the safe side for a delete. A new
  per-event, per-session, or per-day table
  either registers a prune primitive in its `*_db.ts` or carries an explicit
  keep-forever comment at the DDL. Fold before deleting when readers need lifetime
  history (`play_session_retention_db.ts` is the exemplar: an atomic fold-into-rollups
  CTE, then delete). Prune SQL: batch via a LIMIT subquery; no ORDER BY unless the
  cutoff column is indexed (unindexed, it plans a full sort per batch; pin the absence);
  NOT EXISTS over NOT IN for referent guards (NOT IN falls off a work_mem cliff).

- **SQL shape on hot paths.** A query the planner should serve from an expression index
  must share the index's SQL text verbatim (one shared module-level constant, e.g.
  `LIFETIME_XP_EXPR` in `db.ts`, used by both the query and the DDL). Hot views prefer plain UNION
  arms over OR-joined EXISTS (`DAILY_REWARD_EXCLUDED_ACCOUNTS_VIEW_SQL`). Known-long
  reads ride `runWithStatementTimeout` (see the `db.ts` timeout ladder), and new indexes
  on big live tables go through `concurrent_indexes.ts`, never boot DDL.

- **The broadcast loop builds shared things once per pass, never per session.** A
  realm-wide viewer-independent readout builds and stringifies ONCE per pass via
  `realm_readout_memo.ts` and rides `maybeRaw(...)` (the dungeon-finder
  boards are the tenants); events stringify once per batch (`event_frame.ts`) and go out
  via `sendRaw`, never re-`send` per session; interest gathering scans each occupied
  grid cell once (`interest_candidates.ts`) and re-applies each viewer's exact radius.
  Refactors here prove byte-identity with pinned tests (`tests/bandwidth.test.ts`,
  `tests/snapshots.test.ts`); cadence gates use a `>=` dueness tracker, never
  `tickCount % N` (catch-up ticks stride past a modulo and stall the gate).

## Inbound WS flood defense (`msg_rate_limit.ts`, `msg_lanes.ts`, `list_read_guard.ts`)
Three pure metering modules (injected `nowSec`, no `Date.now`; unit-tested without a
server) verdict every inbound frame; `game.ts` is a thin consumer. The design record is
`docs/design/player-performance/packet-3-input-cadence.md`.
- **Order and placement are load-bearing.** The pre-parse gate (frame ceiling + byte
  budget, sized against the real client cadence model in `src/net/input_send_cadence.ts`)
  verdicts ABOVE `JSON.parse`, so a flooder buys token math, never parse CPU. The
  per-class lanes (movement / command / chat) are post-parse at the dispatch switch, so
  one class can never starve another. Every verdict is allow-or-DROP, never queue or
  defer: deferred delivery shifts receive time and poisons the bot detector's timing
  strategies.
- **Detector placement contract:** movement drops before `observeInput` (a dropped frame
  reaches neither sim nor detector), command drops after `observeCommand`
  (observe-then-drop, the detector keeps seeing traffic shape). Keep these when touching
  the dispatch arms.
- **One shared abuse window.** Drops of every cause feed `tallyDrop` on the session's
  one window; sustained abuse kicks. Allowed frames never reset it: a counter that
  resets on any allow is dead code against interleaved refill (the retired
  consecutive-violations ladder was exactly that).
- **Every client-triggerable per-call DB read on this path must sit behind a meter** (a
  lane, a dedicated guard bucket, a ladder token, or a cached read). An ALLOWED
  under-ceiling frame books no drop, so an unmetered read is sustainable at the full
  frame ceiling and the abuse window can structurally never kick it. That is a defect,
  not a style choice; `list_read_guard.ts` exists because review found exactly this on
  the ignore/block readouts.
- **Closed vocabularies, pinned lockstep.** Drop causes are the fixed `WS_DROP_CAUSES`
  set on the game-signals seam (a new shed mechanism adds its cause there, never a
  per-player label). The kick literal (`MSG_RATE_KICK_REASON`) is byte-exact wire
  contract with the client matcher, and `tests/localization_fixes.test.ts` counts the
  `kickSession` sites passing it: a NEW kick arm must consciously join that pin, the
  matcher, and the frame pins together.

## Realms / auth / limits
- **One process = one realm.** Characters/friends/guilds/presence are scoped to
  `REALM`; every realm process shares one `DATABASE_URL`. Schema setup is
  serialized behind a `pg_advisory_xact_lock` (concurrent boots).
- Auth: scrypt + bearer token (`auth_tokens`, 64-hex). REST uses
  `Authorization: Bearer`; WS authenticates via the first message. Banned/suspended
  accounts blocked at both entry points (`moderationStatusForAccount`).
- Sign-in surfaces beyond password: Apple native sign-in (`apple_auth.ts`/`apple_auth_db.ts`),
  the native-app Discord login handoff (`native_discord_handoff.ts`), Electron desktop login
  codes (`desktop_login.ts`/`desktop_login_routes.ts`), and the companion OAuth grants
  (`oauth.ts`). Native apps must present a platform attestation (`native_attestation.ts`);
  the Electron `app://` desktop origins bypass Turnstile by Origin header alone, a deliberate,
  documented softening (see the `passesTurnstile` header in `turnstile.ts`).
- Rate limiting: `rateLimited(req)` on register/login + admin login. Behind a proxy
  set `TRUSTED_PROXY_IPS`; otherwise private/loopback sources are trusted to set XFF.

## Adding a typical command
1. Add the wire token to the shared `COMMAND_NAMES` table in `src/world_api.ts`
   (append-only; both `game.ts` and `online.ts` import it), then add the matching
   `case` in `dispatchMessage` (game.ts), validating every field, then call the
   `sim.*` method that owns the rule. A server-only case the client never sends (a
   `dev_*` cheat, an `enter_crypt`/`leave_crypt` legacy alias, the `social_refresh`
   push, the RL-only `targetNearest`) goes on the `DISPATCH_ONLY_COMMANDS` allowlist
   in `src/world_api.ts` instead, so the send-subset check stays green. 2. If it
   changes self-state the client reads, surface it via `selfWireJson` (use `maybe(...)`
   for heavy fields that ride only on change). 3. Mirror the wire shape in
   `src/net/online.ts`. 4. Add a Vitest. Command-schema lockstep is pinned by
   `tests/command_schema.test.ts` (W0b).

- **Delta-key registry.** The heavy self fields `selfWireJson` may omit are written
  with `maybe(...)`; the delta keys and their terse-key to IWorld-name mapping are
  pinned by `ALL_DELTA_KEYS` + `TERSE_TO_IWORLD` in `tests/snapshots.test.ts` (W0a),
  which owns the list and guards the `selfWireJson` (encode) to `applySnapshot`
  (decode) round-trip. A new heavy self field lands in `selfWireJson` (here) and
  `applySnapshot` (`online.ts`) in one commit, and is added to that registry. A value
  already serialized once realm-wide (the dungeon-finder board on `dfb`, built
  and stringified a single time per broadcast pass by the realm-readout memo) rides
  via `maybeRaw(...)` instead of `maybe(...)`, so the per-session diff reuses the one
  memoized string rather than re-stringifying it for every viewer. The `dfb`
  key is asserted directly in the round-trip test rather than mapped in
  `TERSE_TO_IWORLD` (they merge back into one `cupInfo` on decode), the same way `tal`
  fans out to several members and is asserted directly.

- The PHYSICAL `game.ts` restructure (facet-ordered dispatch, per-facet command
  modules, a facet-aligned encoder) is workstream #4; until it lands, add new
  commands inline as above. Scope and ownership:
  `docs/refactor/world-api-to-server-runtime-handoff.md`.

## The REST request pipeline (`server/http/`)
Every REST surface (`/api`, `/oauth`, `/admin/api`, `/internal`) runs through the in-house
pipeline under `server/http/` (its own `CLAUDE.md` is the spine reference). `main.ts` is a
prefix ladder: `routeHttpRequest` sends each prefix to one of four flag-gated entries
(`apiEntry` / `adminApiEntry` / `oauthApiEntry` / `internalApiEntry`), each built by
`selectApiEntry`. Under `API_DISPATCH=new` (the default) a matched `RouteDef` from the registry
runs the middleware onion; an unmatched path (and HEAD) delegates to the retained legacy handler
for that prefix. `API_DISPATCH=legacy` is the one-flag rollback to the old ladder. A migrated
route is served by BOTH arms until the ladder-deletion follow-up; the dual-edit rule (with its
`known_deviations.ts` ledger), the flag model, and the `RouteDef`/envelope contract live in
`server/http/CLAUDE.md`.

## Adding an endpoint (REST)
0. **Scaffold it.** `npm run new:endpoint -- --domain <slug> --method <METHOD> --path </api/...>
   [--public]` (`scripts/new_endpoint.mjs`) emits the `RouteDef` stub in a domain module, a typed
   `Infer`-derived schema (`server/http/schema.ts` combinators), a paired error code appended to
   `error_codes.ts`, the English `apiError.*` catalog entry plus its `API_ERROR_KEYS` client
   mapping, and a `FakeDb`-based test. It auto-attaches a `requireOwned` loader on a `:id` route
   unless `--public`.

Then fill the handler in by rung (real reference commits, reference by hash + module):
1. **Public read:** commit c07d677af, `server/leaderboard.ts`. Shows a static `export const routes`
   array, a `configure<Domain>Runtime` injection (avoids an import cycle), lenient query decoders,
   and `meta.publicRead` on an intentional public `:param`.
2. **Authenticated:** commit 14275d39e, `server/auth_routes.ts`. The canonical "add one
   authenticated endpoint" example.
3. **Owner-gated `:id`:** commit 5bba9353e, `server/characters.ts`. Uses the `requireOwned` loader
   (`server/http/middleware/require_owned.ts`) with `meta.requireOwned`; denial is 404
   (anti-enumeration); order is the auth guard, then the per-action limiter, then `withBody`, then
   `requireOwned<X>`, then the handler.

Register the domain's `routes` in `server/http/registry.ts` (import + spread into `apiRoutes`); the
registry sorts most-specific-first and runs the BOLA-shadow guard at build time.

## Error localization: emit the CODE, never English
A REST handler raises an `HttpError` (`server/http/errors.ts`) carrying a stable `<domain>.<reason>`
code appended to `server/http/error_codes.ts`, NEVER English prose (the server stays
language-agnostic). The client localizes code-first: `userFacingApiError` (`src/ui/api_error_i18n.ts`)
maps a code verbatim to `apiError.<domain>.<reason>`, English source in
`src/ui/i18n.catalog/api_error.ts`; `tests/api_error_code_parity.test.ts` fails a server code with no
client key. Contributors add English only, same as the WS emits above. A new `apiError.*`
English leaf that is wordy (any word of 4+ letters, i.e. most real prose) also needs its five
non-Latin fills (`zh`, `zh_TW`, `ja`, `ko`, `ru`) in the same change, or M16
(`tests/i18n_completeness.test.ts`) reds; `npm run new:endpoint` prints this reminder for the
leaf it appends.

## Endpoint tests: FakeDb, not a pg-mock
Test a migrated endpoint through its `routes` + `configure<Domain>Runtime` + the
`tests/server/helpers/` barrel: `fakeCtx` builds a well-formed frozen `Ctx` with a `FakeRes`, and
`FakeCharactersDb`/`FakeLeaderboardDb`/`FakeReportsDb` are type-only fakes with zero runtime `pg`.
Exemplar: `tests/server/leaderboard.test.ts` (unit-tests the pure read functions with a `FakeDb`,
then drives handlers via `routes` + `configureLeaderboardRuntime` + `fakeCtx`). This REPLACES the old
`vi.mock('../server/db')` + `sql.includes()` idiom for NEW endpoint tests.

## i18n: player-facing text is English at the source
- Like the sim, `server/` is **language-agnostic** (no `t()`, no DOM). `game.ts` emits
  English literals in `type:'log'|'error'` events (and forwards the sim's `'loot'`
  events), via `sendChatNotice(session, text)`, and via `broadcastSystem(text)`. The
  client re-localizes at the boundary: most
  strings through `src/ui/server_i18n.ts` (`localizeServerText`: an `EXACT` map + ordered
  `RULES` + a `RESTART_MESSAGES` table), a few (chat-rate limit, etc.) through the
  `localizeErrorText` arm (`src/ui/error_text_i18n_core.ts`, delegated by the hud) or the
  hud's own `localizeSystemText` arm. Durations re-localize via
  `localizeServerDuration`, which maps `formatDuration` output (`"5 minutes"`, `"1 hour"`,
  ...) onto the `time.*` keys. **Add the matcher entry in the same change** as a new emit.
- The **S3 guard** (`tests/localization_fixes.test.ts`) scans `game.ts` emit literals
  (`type/text`, ternary `text:`, `sendChatNotice`). It is **blind** to variable-routed
  emits (`broadcastSystem(step.text)` for the `RESTART_COUNTDOWN_STEPS`, the
  `chatMuteMessage()` return) and to `?? 'literal'` fallbacks, so localize those
  deliberately and back them with a dedicated test.
- `server_i18n.ts`'s `DICT` carries **explicit per-dialect entries** (`es_ES`, `fr_CA`,
  `en_CA`) as first-class keys, resolved at runtime by `getLanguage()` with no
  base-collapse: a new key needs a value in every locale block (`en_CA` stays English).

## Never do this here
- Never resolve gameplay (damage, drops, gold, XP) on the server outside the `Sim`.
- Never widen WS `maxPayload` (16 KiB) or skip field validation: one socket must not be able to crash the loop or OOM the process.
- Never serve a viewer-identical read with a per-request `pool.query`, and never leave a
  moderation-visible cache without a bust wire (Hot paths above).
- Never add a table that grows per event or session without a retention registration or
  an explicit keep-forever comment at the DDL.
- Never serialize a realm-identical broadcast payload per session: build once per pass,
  reuse the bytes.
