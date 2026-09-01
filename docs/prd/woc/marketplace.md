# $WOC marketplace and auctions

> **STATUS: IMPLEMENTED in v0.32, SHIPS DISABLED.** The auction service is code
> complete behind `WOC_MARKET_ENABLED` (default off, fail-closed in every
> distribution). Enabling it on a production realm is gated by the launch
> checklist below, which includes Terms and PRD policy updates and counsel
> sign-off. Source proposal: "$WOC Marketplace and Auctions" (July 2026).

| | |
|---|---|
| **Tier** | 2 - Trading |
| **Ease** | 2/5 |
| **Flywheel** | Demand and circulation: every sale settles in $WOC and burns supply |
| **Sustainability** | 7% of every sale to the treasury, 3% burned |
| **Reg risk** | High (real-value trading of game items; counsel gates launch) |

## What

An optional auction house, on browser web and the website-distributed desktop
app, where eligible items are sold for $WOC.
Sellers and bidders agree on a USD value; the number of $WOC tokens required is
calculated only when payment is requested, from a quote issued by the economy
service. The game is not pegging $WOC to USD: a $100 auction stays a $100
auction, and only the token count at settlement moves with the market.

Gold trading stays on the existing World Market (`src/sim/market.ts`),
untouched. Gold and $WOC listings are separate books; the game provides no
Gold/$WOC or Claudium/$WOC exchange. A direct Gold/$WOC lane was considered
during the 2026-08 dev-test round and DECIDED AGAINST for now: the
separate-books rule stands, and any future revisit is a deliberate PRD
change, not a gap.

## Why it's a flywheel

The marketplace gives $WOC its first player-to-player utility loop: earned items
become sellable for tokens, every settlement burns 3% and routes 7% to the
treasury, and demand for tokens comes from players who want items rather than
from speculation alone.

## Design

### USD-denominated pricing, $WOC settlement

- Every economic value is stored as integer USD cents: starting bid, reserve,
  current bid, buy-now price, final sale price, and fee reporting
  (`woc_market_db.ts`, all `*_cents` columns).
- The interface may show an estimated $WOC equivalent, always labelled as an
  estimate, sourced from the economy service price read (never computed in the
  game repo, and never computed in the client).
- Token amounts appear only on quotes and settlements, as base-unit strings
  issued by the economy service (`WocMarketQuote`), mirroring
  `ClaudiumWocIntent`.

### Auction formats

Sellers choose one of three formats at listing time:

- **Standard auction**: starting bid, optional hidden reserve, duration from a
  configured allowlist, no buy-now.
- **Buy-now listing**: fixed USD price, no bidding; the buyer takes a
  short-lived quote and settles immediately.
- **Auction with buy-now**: bidding proceeds normally; buy-now stays available
  until used or the auction ends. A successful buy-now closes the auction
  immediately and cancels (refunds) existing bids and bonds.

The reserve, buy-now price, and duration are frozen after the first confirmed
bid. Sellers choose at listing time whether a failed settlement offers the item
to the next eligible bidder or ends without a sale.

### Price source and health

The $WOC/USD price and all token math live in the economy service (the same
authority that already quotes the Claudium WOC rail). The proposal's oracle
requirements bind on the service: a time-weighted price rather than a single
trade, a minimum-liquidity requirement, a spot-versus-average deviation limit,
and freshness checks judged on the venue's publication time.

Deviation from the proposal, recorded deliberately (product ruling, 2026-08-16):
the proposal asks for multiple approved liquidity sources with a maximum
source-deviation limit. The service runs a SINGLE approved venue
(Birdeye, aggregating the on-chain DEX pools where all $WOC trading happens,
behind a liquidity floor). No independent $WOC price discovery exists: every
configurable venue is a lens on the same pools, no $WOC Pyth feed exists, and
the only other adapter available publishes no print time, which would defeat
the freshness check. The service's oracle stays venue-count agnostic and its
cross-venue deviation gate re-arms by itself if a second real venue is ever
wired in code, but the operator surface says outright that it is unarmed
today; the spot-versus-average limit (500 bps against a fifteen-minute
average) is the automatic circuit breaker, and the price the player sees
carries the venue's publish time as its "as of", never the poll time.

The game side enforces what it can observe, and fails closed:

- Quotes carry an expiry of 60 to 120 seconds (`WOC_MARKET_QUOTE_TTL_SECONDS`);
  an expired quote is never accepted for confirmation, the buyer requests a new
  one inside their settlement window.
- When the service is unreachable, degraded, or reports its oracle down, the
  marketplace suspends new purchases and settlements. Existing auctions keep
  counting down; no irreversible sale occurs until pricing recovers. This is
  the same graceful-degradation contract as `server/claudium_proxy.ts`.
- Operators can hard-pause the whole marketplace by flipping
  `WOC_MARKET_ENABLED` off (every mutating route refuses and the sweep stays
  idle); an audited in-dashboard runtime pause switch (the
  `antibot_config_db.ts` pattern) is a named follow-up.

### Bidding and bid bonds

A bid is a commitment to pay a USD value in $WOC, not a fixed token count. The
bid form shows the bid in USD, the current estimated $WOC requirement with the
price timestamp, a warning that the final token amount may change, the
settlement deadline that applies if the bid wins, and, before the first bond
charge, the commitment disclosures: a bid binds once its bond signs (no
withdraw; forfeit and a strike on non-payment), the anti-snipe close extension
and the late-payment refund, and, when the seller opted in, the automatic
second-chance cascade (the outbid bidder can become the buyer at their own bid
with the bond re-held).
The disclosures are grouped in a Bid terms well the form keeps collapsed by
default, behind one toggle directly above the Place bid control: fully open
they pushed the commit control below the fold on every screen. The well is
always composed with its resolved figures and precedes the control in reading
order; expanding it is never required to bid, and the terms-acceptance
checkbox stays inline beside its linked terms.

Every bid requires: a verified linked wallet (`server/wallet.ts`), sufficient
$WOC balance at bid time (`server/woc_balance.ts` cached read), an established
account, and acceptance of the Marketplace terms (recorded; linked beside the
checkbox at the moment of acceptance).
The custody-moving operations (`createListing` and the seller side of
`acceptDirectedOffer`) additionally require a wallet-signature STEP-UP
(ruling R1, closing finding B6): a fresh single-use server-built challenge
signed by the linked wallet, bound to the operation and every money figure it
authorizes, verified in the service (`server/woc_market_stepup.ts`). This
replaced the PRD's original TOTP threshold design, which was never enforced
server-side; the phantom scaffolding is deleted. The two `woc_market.totp_*`
error codes are kept by the append-only error-code contract, so their whole
localization surface stays with them (the catalog rows, the api_error mapping
rows, and the per-locale fills), each comment-marked retired and never raised.

Balance checks do not guarantee later possession, so every bid posts a small
refundable bond, denominated in USD and paid in $WOC when the bid is placed
(default 5% of the bid with configured minimum and maximum). The bond is a
service-issued transfer intent the bidder signs; a bid becomes active only when
the service confirms the bond transaction. Bonds are returned when a bidder is
outbid, when an auction ends below reserve, and when a buy-now closes the
auction. A winner who fails to settle forfeits the bond, never to the seller:
the game marks it `forfeit_due` and the economy service applies the
destination. The adopted destination is the treasury and burn split, one code
path with the settlement fee split (ruling R2 in the hardening packet); the
service currently routes forfeits to the treasury only, a recorded divergence
the bond-releaser work closes. Repeated defaults earn progressively longer
marketplace suspensions (marketplace-wide: a suspension blocks listing as
well as bidding; strike ladder in `woc_market_rules.ts`).

Deviation from the proposal, recorded deliberately: the proposal suggests the
bond "counts toward payment" on a win. Here the winner pays the full price in
one atomic settlement transaction and the bond is refunded after settlement
confirms. Net economics are identical, and settlement stays a single signed
transaction containing payment and fee distribution.

Minimum bid increments use the configured USD ladder (under $10: $0.25, $10 to
$50: $1, $50 to $200: $5, over $200: $10). A bid inside the final two minutes
extends the auction by two minutes, repeatable up to a 30 minute total
extension cap. All timing is server-authoritative; the client shows UTC plus
local time.

### Completion and settlement

When an auction ends with the reserve met, the highest active bidder receives a
settlement window (default 10 minutes). Inside it they request quotes (each
valid 60 to 120 seconds), sign the one transaction containing seller payment,
burn, and treasury outputs, and post the signature. The server confirms
finality through the service and delivers the item exactly once. If the winner
does not settle: bond forfeited, marketplace strike recorded, and either the
next eligible bidder is offered the item at their own bid with a fresh window
(when the seller opted in) or the item returns to the seller.

Buy-now settlement takes a very short server-side lock on the listing (one
pending buyer at a time, lock lifetime tied to the quote expiry) so two buyers
cannot sign simultaneously; the listing is not reserved beyond that lock.

Completed transactions are processed idempotently: settlement state transitions
live in Postgres, delivery is a state transition in the same transaction as the
mail write, and reconciliation after a restart delivers the item exactly once.

### Fees

Every completed sale applies a 10% seller fee: 90% of the settlement amount to
the seller's verified wallet, 3% permanently burned, 7% to the treasury. The
split is computed by the economy service inside the settlement intent (the
`ClaudiumWocIntent` precedent) and shown to both parties before they confirm.
The buyer pays the final price plus their network fee. Treasury and burn
addresses are public and reported transparently.

### Item custody

Items remain ordinary server-authoritative game assets, never NFTs, and the
game never holds wallet keys. Custody is escrow-by-removal, the World Market
and Ravenpost precedent:

- Listing an item extracts the exact copy (including its
  `ItemInstancePayload`) from the seller's live bags and snapshots it on the
  listing row; the character save and the listing insert commit together, and
  the whole critical section runs as one job on the per-character save FIFO
  (`WocMarketCustody.runSerialized` over `GameServer.enqueueCharacterWrite`),
  so neither a crash nor a stale pre-extraction autosave can dupe or destroy
  the copy: every autosave serialized before extraction commits before the
  escrow write, and the escrow blob is serialized inside the job.
- An escrowed item cannot be equipped, destroyed, traded, or listed elsewhere,
  because it is no longer in any inventory.
- The copy returns to the seller by system mail when the auction ends unsold,
  the reserve is not met, or settlement ultimately fails; when settlement
  confirms it is delivered to the buyer, handed directly into an online
  buyer's bags (`handToBuyer`) with system mail as the durable fallback.
- The extraction seam re-enforces both bind-on-trade states (`boundTo` once
  the stamp has landed, and the still-armed `bindOnTrade` copy, refused as
  `bind_armed`) plus the `soulbound` / `noMarketList` / quest-kind refusals
  explicitly, as `docs/design/professions.md` requires for any instanced
  carriage.

### Eligibility policy

Eligibility is a per-server policy, not a hardcoded rule set
(`woc_market_rules.ts`). The existing server ships the restricted policy:

- Eligible: non-soulbound equipment of epic quality or higher.
- Eligible: **rideable mounts at every rarity** (the reins and ignition items,
  `kind: 'mount'`). Deliberately unfloored: a mount's rarity is a look and a
  speed tier rather than item power, so the equipment floor would hide every
  common, uncommon and rare mount while reporting it ineligible. The policy also
  tolerates `soulbound` for this category, so a bound mount still trades here.
  That was written when every reins item was soulbound, because holding the reins
  IS owning the mount (`src/sim/mounts.ts` `mountOwned`); v0.35.0 then un-soulbound
  the player reins deliberately, so ownership transfers through the ordinary
  economy too and only the developer-only tank stays bound. The tolerance is kept
  because it is what guarantees the rule that every mount trades regardless of
  tier, whichever ones content binds in future. No item def is modified either way.
- Eligible: **mech chroma plates at every rarity** (the suit skins,
  `use.type === 'mechChroma'`), for the same reasons. Each plate carries
  `noMarketList`, which keeps it off the in-game gold market; tolerated here at
  the same scope. A plate is consumed on use and grants a permanent ACCOUNT
  cosmetic, so only an unused plate is ever listable: once applied there is no
  item left, which needs no rule of its own.
- Still defined and dark: serialized collectibles (no assets behind them yet).
- Excluded always, for every category: `boundTo` copies, quest items, anything
  currently sold for Claudium (kept out today by the operator-maintained
  exclusion list, `WOC_MARKET_EXCLUDED_ITEM_IDS`; the specified store-catalog
  merge through the service is not built), Gold, and Claudium themselves (not
  items, structurally unlistable). `soulbound` and `noMarketList` remain absolute for
  every category except the one that tolerates each, above.

Each category is an independent switch (`allowEquipment`, `allowMounts`,
`allowMechChromas`), so a realm can delist one collection without touching the
others, and the switches ride the `/status` payload so the Sell picker offers
exactly what the realm will accept.

The taxonomy and the lock predicate are ONE definition
(`src/sim/exchange_eligibility.ts`) consulted by all four enforcement points:
the server's `listingEligibility` (authoritative), the sim's
`extractTradableCopy` (defence in depth at the bags), and the two client
pre-filters, `sellableRows` (the Sell picker) and `wocTradableSlot`
(`src/ui/trade_woc_view.ts`, the trade window's exchange arm). They each
carried a copy of the same checks before, which is how a category the server
accepted could still be refused at escrow, or never be offered in the picker
at all. The per-copy locks (a `boundTo`-stamped copy, and since the H6 close a
still-armed `bindOnTrade` one) come from the shared transfer-lock predicate
(`src/sim/transfer_lock.ts`), the same rule the gold market, mail, and guild
bank gate on.

### Integrity

- Sellers cannot bid on their own auctions (account and linked-wallet checks).
- Bids cannot be withdrawn; there is deliberately no endpoint for it.
- Sellers cannot cancel after the first confirmed bid except through support
  (admin action that returns the item and refunds bonds). The support path is
  itself settlement-aware: while a payment may already be moving (an unexpired
  buy-now lock, any offered settlement holding a live quote, or a settlement in
  confirming and beyond), the admin suspend refuses too, and the resolution
  waits for the settlement to reach a terminal state (the bounded confirming
  resolution is what restores an operator exit there). A settlement parked in
  the operator `review` state is visible through the internal stuck readout
  (`server/woc_market_monitor.ts`), but the `review` to `confirmed` / `failed`
  resolution pair has no in-repo driver yet: those operator arms arrive with
  the service-side release tooling, and hand SQL is forbidden (it bypasses
  the transition CAS).
- Every settled sale lands in a public, per-item sales history (provenance);
  admins can exclude suspicious sales from public price statistics.
- Marketplace strikes and progressive suspensions are account-scoped and
  admin-visible; operator endpoints can suspend listings, and the runtime
  pause is the economy-service health signal plus the WOC_MARKET_ENABLED
  flag (an audited runtime pause switch is a follow-up).
- Step-up authentication for custody-moving operations is adopted but not yet
  built; it replaces the originally specified TOTP gate on high-value bids
  (ruling R1; see the note under "Bidding and bid bonds").

### Platforms, realms, configuration

- Browser web (desktop and mobile web) plus the website-distributed Electron
  desktop app, which is functionally a desktop browser we ship ourselves.
  Steam and Epic desktop builds and Capacitor iOS/Android stay fail-closed:
  tradeable-token functionality is against both stores' terms of service, so
  those builds must never attach the in-app Exchange UI, wallet code, or
  trading flow.
  The desktop gate reads the shell's distribution stamp through the preload
  bridge (`wocExchangeSupported`) and fails closed when the stamp is absent,
  unknown, or unreadable, treating such a build as a store build. On the
  website desktop build both Exchange signatures (the step-up challenge and
  the payment transaction) ride the existing external-browser wallet handoff:
  the server pre-registers each issued challenge and payable quote, the
  desktop app opens the player's browser with a single-use code, and the
  browser wallet signs the server-stored bytes (never renderer-supplied
  ones). Browser web keeps the in-page wallet flow unchanged. A wrapped
  non-native desktop shell denied by the gate may still reveal the same
  `$WOC Exchange` launcher as a confirm-then-open browser hand-off
  (`src/ui/woc_market_link.ts`), so the user lands in the supported browser
  web flow rather than an in-shell trading surface. Capacitor iOS/Android
  gets neither the real Exchange nor this hand-off launcher and stays fully
  silent: steering a mobile-app-store build to an external real-money
  marketplace is the anti-steering shape those stores restrict, and that
  broader step has not had its own counsel review.
- Listings, custody, and sales history are realm-scoped like the World Market;
  wallets, bonds, strikes, and suspensions are account-scoped.
- The service is configurable by server: the existing server runs the
  restricted eligibility policy; a future web3 server enables broader
  categories without rewriting settlement.

## Constraints (non-negotiable)

- **Token firewall**: no wallet, token, or settlement code or imports anywhere
  in `src/sim/`. The sim contributes only currency-blind item custody. The
  token scan in `tests/architecture.test.ts` enforces this structurally.
- **Non-custodial**: the chain owns funds; the game server never holds keys and
  only ever verifies signatures and service confirmations.
- **The game computes no token math**: prices, quotes, splits, and confirmation
  all come from the economy service; the game and client render what they are
  handed and refuse to synthesize fallbacks.
- **Graceful degradation**: the game boots and plays fully with the service off
  and with no wallet ever connected; marketplace reads return typed
  unavailable results and the UI degrades to a paused state.
- **Server authority**: every auction outcome, custody move, and delivery
  resolves server-side; the client is a renderer.

## Rollback and mixed-fleet safety (forward-only once enabled)

The schema itself is additive and idempotent, so a binary rollback needs no DDL
change. Two pieces of persisted state are NOT downgrade-safe, so **once
`WOC_MARKET_ENABLED=1` has run on a realm, that realm is forward-only** (the
bank-rollout precedent in `server/CLAUDE.md`):

- **Custody parcels carry instance payloads.** A pre-v0.32 mail loader mapped
  attachments to `{ itemId, count }` only, so booting an older binary rewrites
  the realm mail blob and strips the payload: an escrowed rolled epic returns
  as a plain copy.
- **The mail blob's `custodyRef` marker is advisory only.** An older loader
  drops it, and a player can delete an emptied custody letter. That is exactly
  why the authoritative book-once ledger is the `woc_market_custody_claims`
  table, which a downgrade cannot erase: a worker CLAIMS a ref in Postgres
  before booking the parcel, so a retry after any crash or rollback is a no-op
  rather than a second copy.

Before an intentional rollback of an enabled realm, drain custody: let the
sweep finish every settlement in `delivering` and every `status='closed' AND
item_disposed=false` listing (both are bounded backlogs the sweep retries),
then confirm `SELECT count(*) FROM woc_market_custody_claims WHERE booked_at IS
NULL` is zero. A non-zero count means an item is held with its parcel unbooked:
that is the deliberate failure direction (visible and stuck, never duplicated),
and it needs an operator to re-run the sweep or hand the item back before the
downgrade.

## Launch gates (policy deltas this feature introduces)

This feature deliberately supersedes two standing positions, and MUST NOT be
enabled on a production realm until they are reconciled:

1. **Cosmetic-only token utility: adopted position now stated.**
   `docs/prd/woc/wallet-link.md`, `docs/prd/woc/holder-cosmetic-flair.md`, and
   the README Web3 section now carry the marketplace carve-out: the game never
   sells power; token utility is appearance, convenience, access,
   realm-operation, or player-to-player trade; the marketplace transfers
   already-earned items between players at player-set prices. Fernando and
   counsel confirm the position through the decision memo (held privately
   with the counsel material, outside this repository) before enable.
2. **Terms and Conditions.** `TERMS_AND_CONDITIONS.md` still prohibits
   selling in-game items for real money and states wallet verification involves
   no transaction; the live Terms stay authoritative until counsel signs off.
   The counsel-ready revision is drafted beside them
   (`TERMS_AND_CONDITIONS_MARKETPLACE_DRAFT.md`, with the open questions in
   the privately held decision memo). Counsel must
   approve and publish the revision before enablement, following the
   `docs/prd/frontier-pvp-honor.md` precedent that legal review gates any
   money-attached feature.
3. **Economy service readiness.** The service must implement the marketplace
   quote, confirm, refund, and price-health surface this PRD specifies, with
   the oracle protections of section "Price source and health", and a testnet
   dry run must pass end to end.

## Implemented behavior (hook points)

- Server domain: `server/woc_market_routes.ts` (RouteDef surface),
  `server/woc_market.ts` (lifecycle behind injected deps),
  `server/woc_market_rules.ts` (pure increments, anti-snipe, bond, eligibility,
  strike ladder), `server/woc_market_db.ts` (`WOC_MARKET_SCHEMA`, SQL),
  `server/woc_market_proxy.ts` (economy-service client, plus the dev-only
  in-memory arm `createDevWocMarketEconomy`, wired only when
  `ALLOW_DEV_COMMANDS=1` and `WOC_MARKET_DEV_SERVICE=1`),
  `server/woc_market_sweep.ts` (the per-realm advisory-locked sweep shell),
  wiring and sweep registration in `server/main.ts`.
- Sim custody: `src/sim/broker_custody.ts` (the extraction facade and the
  grant-back, behind SimContext) over `src/sim/inventory_extract.ts` (the
  exact-copy escrow legality leaf), system-mail delivery through the existing
  `PostOffice`.
- Client: `src/net/woc_market_sdk.ts` (typed, never-throws),
  `src/ui/woc_market_view.ts` (pure core) + `src/ui/woc_market_window.ts`
  (painter shell), wallet signing through the existing Wallet Standard path.
- Admin: operator moderation arms on the /admin/api surface (suspend a
  listing, exclude a sale from public statistics, clear strikes, a per-seller
  listings read) behind the existing moderation.read / moderation.act
  permissions in server/admin_routes.ts. A dedicated dashboard page is a
  follow-up; the endpoints stand alone.

## Open questions

- Should high-value settlements additionally take a temporary security hold
  (admin-released) on top of the wallet-signature step-up (ruling R1, which
  superseded TOTP)? Not built: no such hold or configuration exists in code.
- Closely-linked-account bidding blocks beyond same-account and same-wallet:
  how much of the moderation shared-IP graph should auto-block versus flag for
  review?
- Should sales history fold into rollups after a retention window, or stay
  raw forever as provenance?

## Out of scope

- Direct P2P $WOC trading (proposal section 13) follows the auction house as
  its own change on the same settlement seams.
- Proxy (maximum) bidding.
- Cosmetic-entitlement and mount listings (no such tradeable assets exist yet).
- The separate web3 server (proposal section 14) beyond the per-server policy
  seam shipped here.
- Any on-chain item ownership; items stay off-chain game assets.
