# WOC P2P Marketplace: Readiness and Security Review

Cross-repo review of the P2P $WOC marketplace, prepared for the team continuing the build.
Reviewed 2026-08-11.

## Verdict

The marketplace is well architected and not yet safe to enable on a production realm.
The money boundary, the sim token firewall, the oracle design, and the fail-closed
discipline are all real and enforced. The defects concentrate in four places: the
multi-step custody/settlement lifecycle, a missing on-chain bond releaser, cross-tier
authorization, and unreconciled launch policy. Every blocker is fixable and scoped; none
is a design dead end.

Do NOT set `WOC_MARKET_ENABLED=1` on a production realm until the ship-blockers below are
closed with tests that would fail on the old behavior.

## Scope and method

| Surface | Branch / PR | Review worktree |
|---|---|---|
| Game | `feature/woc-marketplace` (tip `dce4dbff62`, off release/v0.37.0) | `/Users/fernando/Documents/wocc-market-review` |
| Economy service | PR #31 `feature/woc-market-settlement` | `/Users/fernando/Documents/woc-rewards-service-pr31` |
| Ops dashboard | PR #13 `feature/woc-market-trading-controls` | `/Users/fernando/Documents/woc-rewards-dashboard-pr13` |

Twenty independent reviewers (12 cross-repo finders plus 8 repo specialists), with direct
code verification of every critical / P0 finding. All three repos build; existing suites
pass (game 1524, service 413, dashboard 131). One merge gate is red (the monolith ratchet).
This was a static review: no devnet transaction, EXPLAIN, or load test was run, and no
production or shared system was contacted. No game PR is open yet.

Integration state (updated 2026-08-11, resolved): the game branch was 194 commits behind
`release/v0.37.0`; it has now been brought current. `release/v0.37.0` was merged into
`feature/woc-marketplace` (merge commit `a52da32c89`, pushed; the branch is 0 behind). The four
content conflicts were resolved: `android/gradle.properties` took the release's documented JVM
args (a superset), `src/ui/i18n.resolved.generated/pending.ts` was regenerated via
`npm run i18n:build` rather than hand-merged, and the two pin tests
(`tests/command_schema.test.ts`, `tests/world_api_parity.test.ts`) hit the "merge trap" both
sides warn about: each added a member independently, so the real totals are one higher than
either auto-merged value, set from a suite run (send 198, dispatch 211; IWorld 321, method 236).
The merge validated clean on `tsc`, the pin suites, `architecture.test.ts`, the S3 localization
guard, and the full marketplace test set (866 passed). Still owed before opening a PR: a full
`node scripts/gate_select.mjs` run and a semantic re-review of the auto-merged coordinators
(`hud.ts`, `sim.ts`, `game.ts`, `online.ts`, `world_api.ts`). No game PR is open yet, and
`hud.ts` remains monolith-red (the pre-existing H7, not caused by the merge).

---

## Ship-blockers (P0)

Each of these can lose a player an item or money, bypass authorization, or violate a policy
the operator's own contract sets.

### B1. Seller cancel (and admin suspend) can race a live buy-now settlement, duplicating the item and charging the buyer
`server/woc_market_db.ts:1019` cancelListingIfUnbid, `server/woc_market.ts:1537` adminSuspendListing.
A buy-now settlement never changes the listing status (the lock lives in separate columns),
so the row stays `active` through offered, confirming, confirmed. `cancelListingIfUnbid`
guards only `status='active'` and open bids; it checks neither the buy-now lock nor a live
settlement. A seller can cancel while the buyer's signed payment is confirming: the item is
mailed back to the seller, then the chain settles and `deliverOne` mails the same snapshot to
the buyer under a different custody ref, so the book-once ledger cannot catch it. Result: item
duplicated, buyer's payment executed (90% to the seller wallet), seller keeps the original. The
identical shape fires for `adminSuspendListing` expiring a confirming settlement whose broadcast
payment still lands. No crash required. Found independently by three reviewers, verified in code.

### B2. Delivery finalization is non-atomic with no reconciliation, giving three dupe/loss windows
`server/woc_market.ts:1799 / :1839 / :1886 / :1906`.
The deliver -> transition('delivered') -> insertSale -> closeListing -> markItemDisposed ->
bond-refund sequence is a chain of separately-committed statements.
(a) A crash after `delivered` but before `closeListing` leaves the listing reopenable; the
reclaim arm re-auctions or returns an already-delivered item (dupe). `delivered` is excluded
from both the live-settlement unique index and `liveSettlementForListing`.
(b) `handToBuyer` mails a second copy when the character save merely throws (pool exhaustion),
while the live in-memory grant persists on the next autosave.
(c) `bookCustodyOnce` treats any existing claim row as booked without reading `booked_at`, so a
kill between the claim insert and the durable mail write completes the settlement with the item
destroyed (buyer paid, nothing delivered). The PRD's promised failure direction ("visible and
stuck, never duplicated") is inverted: re-running the sweep is what completes the loss.
Found by four reviewers, verified in code.

### B3. The production bond releaser does not exist
`service/src/market/bootstrap.ts:299`, `service/src/market/service.ts:470`.
`WOC_MARKET_ESCROW_JSON` is parsed only to check its pubkey equals the escrow wallet, then
discarded. The releaser is `overrides.releaser ?? dev?.releaser`, and `solana_chain.ts` ships
only a builder and verifier, so in any non-dev deployment it is undefined and `refundBond` /
`forfeitBond` return `release_not_wired` permanently. Bonds are charged at bid time and can never
be returned. The crash-safe release protocol the chain-wiring doc specifies is also unbuilt. The
wiring doc's own words: "A bond that can be collected and not returned is worse than no bond at all."

### B4. The on-chain verifier accepts a settlement whose 3% burn leg was redirected to an attacker wallet
`service/src/market/solana_chain.ts:230`.
Settlement verification checks the expected seller and treasury credits and the payer's total
debit (which includes the claimed burn amount), but it does not prove an actual SPL Token burn
or supply decrease, and it does not reject an unexpected third-party credit. Because the payer's
total debit still matches, the burn portion can be redirected to an attacker wallet while
verification passes. The fix is to validate an SPL Token burn for the expected mint and amount
(or an equivalent supply decrease) and reject unexplained credits. Recommend a targeted devnet
test to confirm before accepting.

### B5. Service admin-tier auth bypass: a query string on exact-match ops-only paths skips the admin secret
`service/src/server.ts:131`.
The new marketplace admin routing normalizes the path correctly, but the existing Claudium refund
and gift-card clawback gates compare the raw URL exactly while their handlers strip the query
string later. Appending a query string changes the matched raw path so the second admin-secret
tier is skipped, while the request still reaches the normalized handler with the game/internal
secret. Pre-existing, but in the same authorization seam PR #31 modifies, so it must be fixed
before deploying the combined system. The internal and admin secrets are also compared with plain
`!==` rather than a constant-time compare (the game server does this correctly). Fix: normalize
the path once before all authorization and dispatch decisions.

### B6. TOTP is a phantom control, and createListing moves custody on a stolen bearer alone
`error_codes.ts:250`, `.env.example:135`, api_error catalog, `components.css .wm-totp`; no server enforcement.
The error codes, the `WOC_MARKET_TOTP_THRESHOLD_CENTS` env knob, the translated i18n strings, and
the `.wm-totp` CSS all exist, but no server code reads the threshold or enforces a second factor
(verified by grep). An operator setting the threshold gets no protection. Worse, `createListing`
and `acceptDirectedOffer` move custody on a session bearer alone: a token thief lists a victim's
valuables at the $0.25 floor for a confederate to buy, the victim's wallet never signing anything.
This is the vector the p2p PRD names as unfixed.

### B7. Two policy launch gates the PRD names are unresolved
`TERMS_AND_CONDITIONS.md:45, 58, 65`; `wallet-link.md:56`; `holder-cosmetic-flair.md:14`; `README.md`.
The Terms still prohibit selling in-game items for real money (line 45), state items "have no
monetary value and cannot be redeemed for real money" (line 58), and say wallet verification
"involves no transaction and no transfer of funds" (line 65). The policy PRDs and README still
assert token utility is "never power," with no marketplace carve-out for trading stat-bearing epic
gear. The PRD makes counsel-revised Terms and a stated adopted-position preconditions of enablement.

---

## High severity (fix before enable)

- **H1. Dashboard game proxy has no role check.** `src/pages/api/game/[...path].ts:43`. Any
  signed-in operator (including "external" roles) reads seller wallet addresses and p2p payloads
  that the same PR's policy layer declares internal-only. The authorization test never exercises a
  non-privileged role, so it ships green.
- **H2. Dashboard hardcodes 9 token decimals; the live mint is 6.** `src/components/market_trading_view.ts:53`.
  Every operator token figure (bonds, settlements) is 1000x understated, feeding refund/forfeit decisions.
- **H3. Oracle heartbeat warms a different instance than the one that prices requests; in practice it
  runs one venue.** `service/src/market/bootstrap.ts:340 and :257`. After quiet periods the price gate
  reports stale and players see false paused windows. The second venue (Pyth) has no $WOC feed, so the
  cross-venue deviation gate the PRD requires can never fire.
- **H4. Payment-loss cluster.** `server/woc_market.ts:1269, 1243, 1914`. Quote-expiry is checked before
  the signature is recorded, so a payment broadcast near expiry is refused with no ledger trace;
  `refreshBondQuote` overwrites the reference of a paid, awaiting-finality bond; `cancelOpenBidsForListing`
  drops paid-but-undecided bonds out of the polling set.
- **H5. Escrow character write bypasses the per-character save queue.** `server/woc_market.ts:892`. An
  autosave that serialized the bags before extraction can commit its stale snapshot after the escrow
  commits, restoring the item to durable bags while the listing also holds the escrowed copy: a no-crash
  dupe (sell it and keep it).
- **H6. bindOnTrade-armed commissioned gear passes every exchange lock.** `src/sim/exchange_eligibility.ts:77`.
  Still-armed commissioned gear can be sold and mail-delivered on the real-money rail; both sibling pipes
  (gold market, mail) refuse exactly this.
- **H7. Merge gate is red.** `src/ui/hud.ts:18809`, tests/monolith_budget.test.ts (20005 > 19600). The
  ~590-line p2p offer state machine landed on the `Hud` coordinator instead of a `src/ui/hud/woc_trade/`
  module. Must be extracted (not the ceiling raised).
- **H8. estimateView drops `split`; quoteView drops `signatureRequired`.** `server/woc_market_routes.ts:332`.
  The service computes the three USD fee legs but they never cross the wire, so the p2p "Fee / You receive"
  lines render blank for every player. quoteView dropping `signatureRequired` kills the dev-economy payment path.
- **H9. Buy-now racing auction close strands a bond forever.** `server/woc_market.ts:1614`, `woc_market_db.ts:1158`.
  The standing bid is marked `won` with no settlement created and the held bond is never routed to refund.
- **H10. Directed p2p bait-and-switch.** `server/woc_market.ts:1016`. The seller supplies the item only at
  acceptance; it is validated for eligibility but not matched against what the buyer agreed to.
- **H11. Scale foot-guns.** `woc_market_routes.ts:819-862`, `woc_market_proxy.ts:217`, `woc_market_sweep.ts:50-88`.
  Five hot GET routes carry no rate limit and no cached read (policy exists, unmounted); `/me` fans out six
  parallel queries into a 10-client pool; the price cache stores failures for the full TTL with no
  single-flight; the sweep holds a pool connection plus the advisory lock across up to ~50 minutes of chain calls.
- **H12. Directed p2p incentives and holds are wrong.** `server/woc_market.ts:915, :1398`, `woc_market_db.ts:807`.
  A directed sale holds the item up to 12 hours, not the 600s window; a buyer who accepts and never pays is not
  struck; directed listings are exempt from the 12-listing cap, so an accomplice pair can lock unbounded escrow.
- **H13. UX honesty gaps on the money surface.** `hud.ts:19117`, `trade_woc_panel.ts:105`, `woc_market_window.ts:800`.
  The seller cannot decline an incoming offer (dead wiring) and cannot cancel a directed listing (PRD mitigation
  unreachable); any closed listing reads as "settled," printing a false "You have received a payment"; Activity
  pay rows never name the item; the p2p Pay flow skips the quote-review panel; there is no pre-bid "bids cannot be
  withdrawn" disclosure; and every committed "after" screenshot shows the removed TOTP field.
- **H14. Public buy-now allows a same-wallet self-deal.** `server/woc_market.ts` buyNow, `server/woc_market_db.ts:1172`
  claimBuyNowLock. The bid path refuses a bidder whose wallet equals the seller's (`sellerWallet === wallet`), but
  `claimBuyNowLock` checks only `seller_account <> buyer_account`, never the wallet. A second account sharing the
  seller's verified wallet can buy-now the seller's own listing, wash-trading a price into the public sales history.
  (Confirmed in code; surfaced by the Grok second opinion, see reconciliation below.)
- **H15. Settlements stuck in `confirming` never expire.** `server/woc_market_db.ts:1693` overdueSettlements selects
  only `offered` / `failed`. A settlement in `confirming` (economy hangs or perpetually returns pending) is polled
  forever with no bounded resolution, so the escrowed item is held indefinitely; if the payment actually settled on
  chain but the service cannot confirm, the buyer paid and the item is stuck. Bound the confirming age and add an ops
  tool. (Confirmed in code; surfaced by the Grok second opinion.)

---

## Medium and fast-follow (representative)

- **Money/security SQL is fake-only.** Self-buy guard, shill-bid wallet-twin guard, escrow atomicity, book-once
  `ON CONFLICT`, realm scoping, and settlement state CAS are exercised only against `FakeWocMarketDb`; deleting the
  shipped predicate stays green. Only directed-sale/bond/ops predicates got real-SQL pins.
- **Fee split diverges; forfeits skip the burn.** The dev economy computes the split two ways (displayed net does not
  equal money moved). Forfeited bonds route 100% to the treasury, not the PRD's treasury+burn split.
- **Bond release double-pay (service).** `service/src/market/service.ts:473`. Bond release is read-check-act with a
  blind last-write-wins update and no CAS; a crash-retry or concurrent refund+forfeit can pay one bond twice. The
  memo does not stop a second SPL transfer. (We filed this high; the Grok second opinion rates it critical, which is
  defensible for a money-doubling bug. Fix with persist-before-broadcast, probe-on-retry, and a status CAS into
  `releasing` before send, before any releaser ships.)
- **Stuck custody has no monitor.** Nothing reads the `booked_at IS NULL` unbooked-claims index, and no metric or
  endpoint surfaces stuck `delivering` settlements or closed-undisposed listings. The PRD's "visible and stuck" story
  has no consumer.
- **Compose default halts the market.** `docker-compose.yml` defaults price staleness to 120000ms (2 min), the exact
  value the code comments call a permanent-halt bug; the code default is 1 hour.
- **Dev chain fails open on unset NODE_ENV.** A stray flag turns a real deployment into free items. The market can
  also run real settlements against in-memory stores when `DATABASE_URL` is missing.
- **Anti-snipe extends on unpaid pending bids.** `server/woc_market_db.ts:1267`. The auction end is extended at bid
  placement, before the bond confirms (deliberate, to stop an in-flight confirmation landing after close). A
  multi-account griefer with distinct wallets can burn the 30-minute extension cap; bounded by the cap and the
  per-account `already_pending` guard, but worth constraining to bids that have made bond progress. (Surfaced by the
  Grok second opinion; confirmed in code.)
- **DB scale.** `directedOffersForAccount` (polled every 2s per open trade window) cannot use its partial indexes and
  seq-scans a never-pruned table; `woc_market_directed_offers` and `woc_market_custody_claims` grow forever with no
  retention; `price_desc` sort and the FK-cascade columns are unindexed; the bid path has no `lock_timeout`.
- **i18n.** 15 Latin locales carry 217 new pending rows each (3,255 release fills) the release gate will block on; all
  five sold-letter locale fills translate a stale English draft; wallet-bridge failures render raw English
  `err.message`; `wocUsdText` concatenates a hardcoded "$" instead of Intl currency.
- **Dashboard is not yet an investigation tool.** No CI runs the PR's security tests; the 863-line Trading React is
  untested; bond forfeit fires on one unconfirmed click; there is no search, cross-links, or paging; `legsReconcile`
  does not reconcile and `p2pOutcome` mislabels dead trades; buy-now listings show a wrong price; an overview 503
  (one `Promise.all`) can blank the whole panel including game views that still work; after a treasury forfeiture the
  treasury destination stays selected for the next operation; and audit attribution logs a mutable username rather
  than an immutable actor ID.
- **`validateReleaseRequest` accepts settlement references for a bond-only operation.**
  `src/components/market_trading_view.ts:286`. The regex `/^WM[BS]_[0-9a-f]{32}$/` accepts both `WMB_` (bond) and
  `WMS_` (settlement) references, but release is bond-only, so an operator can submit a settlement reference to the
  bond-release path. Confirmed in code; surfaced by the Codex second opinion.
- **Dashboard dependency audit.** `npm audit` currently reports 11 vulnerabilities (5 high, 5 moderate, 1 low),
  including an `esbuild` dev-server advisory and a `yaml` stack-overflow. Resolve before deploying the combined system.
- **Service bond-quote trusts the caller's `usdCents`.** `service/src/market/routes.ts:97` passes `body.usdCents`
  straight to `bondQuote` and does not recompute the bond from the service-side `bondBps`, so the game owns the bond
  amount on the wire (behind the internal secret). The service should own bond cents; this is the same ownership
  drift as the game/service bond-formula mismatch, sharpened.
- **`createDirectedOffer` skips the balance plausibility guard.** `server/woc_market.ts:937`. `guardBalance` runs in
  `placeBid` and `buyNow` but not on directed-offer creation. Debatable (escrow and payment happen later), but the
  auction paths and the directed path are inconsistent.
- **No `UNIQUE(listing_id)` invariant on the sales table**, which would make the delivery double-sell (B1/B2a)
  fail closed at the database rather than silently mint a second sale row.
- **Undocumented required env; wrong health rail.** `WOC_MARKET_SERVICE_URL` and `DASHBOARD_INTERNAL_SECRET` are read
  but absent from the game `.env.example`; the service health rail keys on names the market never reads.
- **Directed non-payment leaves the listing active** until the seller cancels or the duration ends (targeted
  denial-of-use); prefer auto-close and return on settlement expiry.
- **Bond size computed in the game** (`bondCents` with clamp) while the service uses pure bps ceil with no clamp:
  drift risk; the service should own bond cents on the wire.
- **Browser-only gate is client-only** (`!NATIVE_APP && !DESKTOP_APP` in main.ts, since moved to `src/game/woc_market_wiring.ts` by bf7aeb8a98); the server accepts market REST
  from any authenticated session (listing does not need a browser wallet).
- **Coordinator drift.** `extractTradableCopy` / `grantTradableCopy` grew onto `sim.ts` instead of a module behind
  SimContext; `grantTradableCopy` has no test; the token-firewall allowlist exempts `sim.ts` wholesale and the regex
  misses `signature` / `lamports` / `base58` shapes.

---

## What is genuinely strong (keep this bar)

1. The money boundary is real and enforced: all token math, quotes, splits, and confirmation live in the service; the
   game passes integer USD cents and renders results verbatim; no secret reaches the client bundle.
2. The sim token firewall holds: no wallet/token/settlement code in `src/sim/`, structurally scanned; no new Rng
   draws, tick order byte-identical, purity intact.
3. SQL is parameterized throughout; anti-enumeration is implemented twice (browse exclusion plus `not_found` for
   non-parties).
4. Custody design is dupe-safe by construction (escrow-by-removal snapshots the exact instance payload; book-once
   Postgres claims ledger); the bugs are in the lifecycle around it.
5. The oracle is fit for auctions: TWAP over a window, median across venues, deviation caps and staleness, seven
   machine-readable unhealthy reasons that halt trading.
6. Fail-closed discipline is consistent: browser-only client gate, `WOC_MARKET_ENABLED` off by default, service
   construction all-or-nothing, shared-address hazards refused at boot.
7. Settlement idempotency is thought through: the reference doubles as on-chain memo and idempotency key; a partial
   unique index prevents one signature settling two quotes; "pending" is kept distinct from failure.
8. The p2p shape avoids the sim trap: a $WOC deal is a directed buy-now listing, never routed through the sim's atomic
   swap; the counterparty wallet status rides a server-fed sibling field.
9. The player UI is well built: a real pure-core/painter split, a proper ARIA 1.2 combobox, honest degraded/paused/
   wallet states, thoughtful mobile CSS.
10. Internal-secret gating is fail-closed on the game side (length-guarded `timingSafeEqual`, denies on unset secret,
    dashboard-only admin secret split). The service side needs the same constant-time care.

---

## PRD gap backlog (21 gaps: 2 P0, 7 P1, 10 P2, 2 P3)

P0: production bond releaser unbuilt; Terms and Conditions revision.
P1: testnet dry run; policy PRD + marketing reconciliation; a second real oracle venue (or revise the claim);
custody + sweep monitoring; 2FA posture + the createListing vector; and five open chain-wiring operational
decisions (SOL fee funding and monitor, ATA-rent-on-refund policy, verifier commitment level and confirming timeout,
devnet mint, and where a forfeited bond belongs).
P2: dispute UI and case tracking; dashboard visibility of sales/strikes/custody; a game-side audited runtime pause
(the dashboard can already halt trading via the service pause, verified); player wiki/guide; and a documentation
staleness cluster (six docs contradict shipped behavior).
P3: the numeric reserve guard; a bound on directed-escrow count.

---

## Recommended sequence

1. Fix the custody/settlement lifecycle as one change: make listing-close and item-disposal atomic with the
   `delivered` transition (or add a reconcile arm for `delivered`-but-not-closed), gate cancel/suspend on the buy-now
   lock and any live settlement, distinguish a save throw from a lease-fence, and consult `booked_at` in
   `bookCustodyOnce`. This closes B1, B2, H5, and H9 together; they share a root cause. Add the confirming-age bound
   (H15) here too.
2. Build and wire the bond releaser with the crash-safe, concurrent-safe protocol (persist before broadcast, probe on
   retry, status CAS), then run the testnet dry run end to end (B3, plus the bond double-pay medium). Fix the burn-leg
   verification and the service admin-auth bypass (B4, B5).
3. Decide the 2FA posture and add a step-up on the custody-moving side (createListing/acceptDirectedOffer), or remove
   the phantom scaffolding and explicitly accept the vector (B6). Add the buy-now wallet-twin guard (H14).
4. Reconcile Terms, the policy PRDs, and marketing, with counsel sign-off (B7).
5. Extract the p2p trade controller off `hud.ts` to turn the merge gate green (H7).

Then the high-severity correctness and honesty items (blank fee lines, unreachable seller controls, false "payment
received," decimals, oracle heartbeat), then the scale foot-guns, then the fast-follow coverage and dashboard-tooling
work. The game branch is now current with release/v0.37.0 (merged and pushed 2026-08-11); before opening a PR, run a
full `node scripts/gate_select.mjs`, a semantic re-review of the auto-merged coordinators, and the service and
dashboard suites.

## Acceptance bar for "safe to enable"

- [ ] B1 to B7 closed with tests that would fail on the old behavior
- [ ] Full bond cycle on devnet with a double-release balance assert
- [ ] Confirming settlements have a bounded resolution path (H15)
- [ ] Buy-now and directed rails both enforce the wallet-twin self-deal guard (H14)
- [ ] Listing step-up auth decision implemented or explicitly accepted by security
- [ ] Dashboard cannot show 1000x-wrong balances, and an overview outage does not hide listings
- [ ] Counsel-approved Terms plus PRD/marketing language
- [ ] Ops runbook for pause, force-release, unbooked claims, and stranded settling
- [x] Game branch merged up to release/v0.37.0 and pushed (2026-08-11); still owed: full selective gate green plus a semantic re-review of the auto-merged coordinators

---

## Cross-review reconciliation (second opinion)

A separate model (Grok) reviewed the same three surfaces. The two reviews agree on the architecture read, the
verdict, all the strengths, and the launch/policy gates. The reconciliation below records where they differ so
nothing is lost.

### Grok findings this review adopted (verified in code, now folded in above)

| Grok ID | Finding | Where it landed here | Status |
|---|---|---|---|
| H2 | Public buy-now same-wallet self-deal (`claimBuyNowLock` checks only `seller_account`, not the wallet) | H14 | Confirmed. We had the same-wallet gap only for the directed rail; the public buy-now rail has it too. |
| H3 | Confirming settlements never expire (`overdueSettlements` selects only offered/failed) | H15 | Confirmed. We had the service-side quote-TTL gap but not this game-side unbounded confirming. |
| Med | Anti-snipe extends on unpaid pending bids (grief to burn the 30-min cap) | Medium list | Confirmed. Deliberate per the code comment and bounded, but worth constraining to bonded bids. |
| C3 | Bond release double-pay on crash / concurrent release | Medium ("bond release double-pay") | Same finding we filed; Grok rates it critical, which is defensible. Severity elevated in note. |

### Findings both reviews independently reached

Both caught: the unbooked-claim loss (Grok C1 / our B2c), the missing bond releaser (Grok C2 / our B3), the oracle
heartbeat warming the wrong instance (Grok C4 / our H3), no step-up on createListing (Grok H1 / our B6), in-memory
store when `DATABASE_URL` is missing (Grok H4), the compose 2-minute staleness default (Grok H5), the service confirm
not enforcing quote TTL (Grok H6), the dashboard 9-vs-6 decimals (Grok H8 / our H2), estimateView/quoteView wire
stripping (Grok H9 / our H8), and the medium set (directed non-payment leaving the listing active, cascade next-bidder
after bond refund, bond-size ownership drift, browser-only client-only gate, dashboard confirm/search gaps). The
strengths list and the launch gates match.

### Findings this review has that the Grok review did not

Our report additionally caught, and verified in code, several items the Grok review did not surface:

- B1: seller cancel / admin suspend racing a live buy-now settlement, a no-crash item dupe plus double credit. (The
  Grok review has the unbooked-claim loss but not this seller-triggerable dupe.)
- B2a: the reopen-after-`delivered` dupe (a crash between the `delivered` transition and `closeListing` lets the
  reclaim arm re-sell or double-return an already-delivered item).
- B2b: the `handToBuyer` save-throw dupe (a transient DB throw mails a second copy while the live grant persists).
- B4: the on-chain verifier accepting a redirected burn leg.
- B5: the service admin-auth query-string bypass and the non-constant-time service secret compares.
- H5: the escrow character write bypassing the per-character save queue (stale-autosave dupe).
- H6: bindOnTrade-armed commissioned gear passing every exchange lock (a laundering rail).
- H7: the red monolith gate (the Grok review notes the large coordinators but not the failing `monolith_budget` gate).
- H10: the directed p2p bait-and-switch (escrow never bound to the agreed item).
- H11: the scale foot-guns in depth (unmetered hot reads, the price cache that caches failures with no single-flight,
  the ~50-minute sweep stall holding the pool connection and advisory lock).
- The systemic test gap: money/security SQL predicates pinned only against the in-memory fake, plus most of the
  db-performance and migration-safety findings (retention, index fit, boot-DDL lock cost, FK-cascade indexing).

### Net

The two reviews are highly consistent. This review is the broader of the two (it caught several additional critical
paths, notably the seller-cancel dupe, the burn-leg redirect, and the admin-auth bypass), and the Grok review
contributed three real findings now folded in (H14, H15, the anti-snipe grief) plus a defensible severity elevation on
the bond double-pay. Combined, the ship-blocker set and the acceptance bar above reflect both.

## Third-review reconciliation (Codex second opinion)

A third model (Codex) reviewed the same three surfaces and reached the same verdict. Its eight confirmed
shipment-blockers each map one-to-one onto a finding this review already had: custody-not-exactly-once (B2),
non-atomic delivery finalization (B2a), cancel/suspend racing a live buy-now payment (B1), the missing bond releaser
plus double-release (B3 and the bond-double-pay medium), the verifier not proving the burn (B4), orphaned paid
transfers (H4), the dashboard proxy exposing player data (H1), and the query-string admin bypass (B5). It surfaced no
blocker this review missed.

### Codex findings adopted (verified in code, now folded in above)

| Item | Where it landed here | Status |
|---|---|---|
| Merge simulation: 65 ahead / 194 behind, conflicts in four files | Scope and method | Confirmed exactly (`git merge-tree`), and since RESOLVED: `release/v0.37.0` merged into `feature/woc-marketplace` and pushed (0 behind). |
| `validateReleaseRequest` accepts `WMS_` settlement refs for a bond-only op | Medium list | Confirmed: regex is `/^WM[BS]_[0-9a-f]{32}$/`. New dashboard bug. |
| Dashboard dependency audit (multiple high vulns) | Medium list | Confirmed: `npm audit` now reports 11 (5 high, 5 moderate, 1 low). |
| Service bond-quote trusts caller `usdCents` (bondBps unused on that path) | Medium list | Confirmed: `routes.ts:97` passes `body.usdCents` through. Sharpens our bond-ownership finding. |
| `createDirectedOffer` skips the balance guard | Medium list | Confirmed: `guardBalance` runs in placeBid/buyNow only. |
| No `UNIQUE(listing_id)` sale invariant | Medium list | Confirmed; a useful fail-closed DB invariant for B1/B2a. |
| Sharper burn mechanism (payer total debit matches, no SPL burn proven) | B4 description | Adopted; better mechanism than our original wording. |
| Sharper admin-bypass mechanism (Claudium refund / clawback exact-match) | B5 description | Adopted. |
| Dashboard UX: treasury destination stays selected after forfeit; audit uses mutable username | Medium (dashboard) | Adopted as nits. |

### Minor Codex nuances noted but not separately filed

Quote timestamps using polling time rather than venue publication time (freshness looks better than it is), and the
"purchase complete" message shown while a buy-now is still `confirming`, both fold into the oracle-freshness and
UX-honesty themes already covered (H3, H13). Codex's remediation ordering (real integrated RC, exactly-once custody,
safe chain ops, payment recovery, RBAC, oracle/config, UX, launch gates) matches this review's recommended sequence.

### Net across all three reviews

Three independent reviews (this one, Grok, Codex) converge on the same verdict and the same core blockers, which is
strong signal. This review remains the superset: it additionally holds the reopen-after-`delivered` dupe (B2a), the
escrow-write-bypasses-save-queue dupe (H5), the bindOnTrade laundering rail (H6), the directed bait-and-switch (H10),
and the depth on scale foot-guns (H11) and fake-only SQL test coverage. Codex contributed the merge-conflict
enumeration, the `validateReleaseRequest` bug, the dependency-audit data, and several precise mechanism sharpenings,
all now incorporated.
