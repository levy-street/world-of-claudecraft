# Multi-currency player trading: instance-aware offers, Claudium and $WOC legs

Status: implemented behind fail-closed flags (CLAUDIUM_TRADE_ENABLED, WOC_TRADE_ENABLED,
both default OFF). With the flags unset this change is behavior-neutral for money:
the trade window still swaps items and copper synchronously in one tick.

## Motivation

The live trade window (src/sim/social/trade.ts, src/world_api/trade.ts) moves any
non-quest, non-soulbound item plus copper. Three gaps motivated this work:

1. Correctness. Trading a signed, rolled, or enchanted copy silently stripped its
   ItemInstancePayload: the offer was keyed by item id only, validated with the
   instance-inclusive counter, and transferred with a fungible add. The recipient got
   a plain copy; the enchant, crafter signature, and rolled quality were destroyed.
   The World Market and Ravenpost mail both refuse instanced items outright; trade
   quietly degraded them. Additionally, trade ignored the noMarketList flag that both
   mail and market enforce, so lock-to-earner reward tokens could be traded away.
2. Open-ended item trading. Refusing instanced items (the market/mail answer) would
   shrink what players can trade exactly where trading matters most: crafted and
   enchanted gear. The fix here makes instanced copies first-class trade goods.
3. Currencies. Gold, silver, and copper are one integer with a display split, and the
   game also has two real external currencies: Claudium (server-authoritative soft
   currency, ledger inside the external economy service) and $WOC (a real SPL token,
   self-custodied in player wallets; the game server only ever reads balances over
   RPC). Neither had any trade representation.

## What ships

### Instance-aware offers (always on)

Offer rows are either fungible ({itemId, count}, validated against plain stacks only
via countFungibleItem, so a plain row can never consume a special copy) or an
explicit count-1 instance row. The wire carries only a SELECTOR for an instance row;
the sim matches it against the owner's real inventory, captures a clone of the real
payload into the offer, deep-equal revalidates at confirm, and transfers with
addItemInstance so the payload survives intact. Character-bound copies (boundTo) and
noMarketList items are refused at offer time, aligning trade with mail and market.

### An active decline

trade_decline (wire, appended) lets the invitee actively refuse; the requester gets a
structured tradeDeclined event. Duel and party always had this; trade only had
silent expiry.

### Two-lane confirm

- Classic lane (no external pledge): the existing synchronous, single-tick atomic
  swap, unchanged in ordering and emissions, still pinned by the player_trade parity
  golden. One addition: a structured tradeLedger event that the server intercepts
  (never delivered to clients) to write an append-only trade_ledger row and force an
  immediate lease-fenced two-row character save, closing the crash window in which
  one side's row could persist pre-trade state while the other persisted post-trade
  state.
- Settlement lane (any Claudium or $WOC pledge): on double-confirm the sim escrows
  BOTH offers out of the participants' bags and wallets into the session, parks the
  session in phase 'settling', and emits tradeSettle for the server's settlement
  orchestrator (server/trade_settlement.ts). Escrow means no cancellation, timeout,
  disconnect, or crash can double-spend goods: the goods are always either delivered
  crosswise or returned, with Ravenpost mail as the delivery net for offline owners
  and full bags (the mail and market never-destroy doctrine).

### The Claudium leg

Claudium balances live only in the external economy service; the game server holds a
read cache for offer clamping and settles authoritatively through an idempotent
service call (POST /v1/claudium/transfer with dedupe keys trade-<settlement>-<side>).
Failures refund executed legs with the mirrored refund dedupe key and unwind the
escrow.

IMPORTANT PRODUCT GATE: the economy service today enforces a deliberate, audited,
guard-tested invariant that Claudium is ONE-WAY: purchasable and spendable, never
transferable between players and never redeemable (its plan document lists "no peer
transfer" under hard invariants, and a guard test asserts the ledger exposes no
transfer reason). A P2P transfer endpoint is exactly the shape of a secondary-market
cash-out rail, so relaxing that invariant is a maintainer product and compliance
decision, not an implementation detail. This change therefore ships the GAME side of
the leg only, fail-closed: until the maintainer decides to relax the invariant and
the service ships the transfer endpoint, CLAUDIUM_TRADE_ENABLED must stay unset,
pledges are rejected in the sim with a clear error, and no Claudium input renders.
If the flag were ever set early by mistake, settlement fails closed and refunds the
escrow in full.

### The $WOC leg

$WOC is self-custodied; the server has no keys and never moves tokens. The paying
player pays wallet-to-wallet: at settle time the payer's trade window shows a
standard Solana Pay transfer request (recipient = counterparty's linked wallet,
spl-token = the $WOC mint, plus a unique random reference key). The server verifies
the payment over plain JSON-RPC polling at finalized commitment: it locates the
transaction via the reference, then validates the token-balance deltas for the payer
and recipient against the pledged amount in base units, computed with BigInt string
math only (no float ever touches a token amount). Ordering protects both sides: the
goods are escrowed before the payment request appears, and released only after the
payment is finalized; if the payment never arrives, the timeout refunds everything.
Both parties must have verified wallet links to pledge $WOC. Cancellation is allowed
until the first on-chain leg is verified; after that the trade can only complete.

Only ONE side of a trade may offer $WOC. The sim refuses a $WOC pledge when the
counterparty's current offer already carries one (whoever pledges second is
rejected), and confirm fails closed if both offers somehow carry $WOC. The reason is
irreversibility: a two-sided $WOC pledge has no safe automatic terminal state, because
one leg can finalize on-chain while the other never pays, and neither the server nor
the sim can claw back a settled leg. A net single leg loses no expressiveness: any
economic outcome (A pays B, B pays A, a WOC-priced item sale either direction) is a
single directed $WOC leg plus the goods/copper on the other side, so the one-leg rule
constrains nothing a trade actually needs while removing the only irreversible
double-spend edge.

### Persistence and recovery

The trade_settlements anchor row and both characters' post-escrow rows are written in
ONE transaction (insertSettlementAndSaveBoth), so the escrow anchor can never persist
apart from the emptied bags it accounts for; a lease-fence miss on either character
rolls the whole thing back and the escrow simply returns in memory. Every external leg
executes only after that anchor commits, so a crash at any point recovers
deterministically at boot.

Recovery decides per leg, not on an OR: it completes only when the trade carried a
$WOC leg AND every pledged $WOC leg is verified; everything else refunds by mail and
reverses ONLY the Claudium legs that actually executed (a persisted per-leg
claudium_*_exec flag, idempotent refund dedupe key). Before both the timeout unwind
and boot recovery refund, one FINAL on-chain verify runs against the payer/recipient
pubkeys persisted on the row: a payment that landed in the last poll interval (or just
before a crash) completes the trade instead of losing the payer's money. The same
final check guards player cancellation (the pay-then-cancel race): a cancel is refused
if the final verify finds the payment landed. Recovery claims each open row atomically
(status -> 'recovering', RETURNING) before acting, so a same-realm double-boot cannot
both deliver the mail or double-write the ledger; a row stuck in 'recovering' from a
crash mid-recovery becomes reclaimable after ten minutes.

trade_ledger keeps an append-only record of every completed trade (both lanes) with
denormalized names for moderation use. If an unwind runs after a real transfer already
executed (a reversed Claudium leg, or the should-be-unreachable case of a verified
$WOC leg), it still writes a ledger row recording the executed amounts (goods/copper
zeroed, settlement_id set), so no real movement is ever unrecorded.

Residual risk: a $WOC payment can still finalize on-chain AFTER the final verify has
already run and the settlement refunded (the payer signed late, past the timeout).
This is inherent to a non-custodial leg the server cannot claw back. The refunded row
keeps its reference and (null) signature columns, and WOC_TRADE_TIMEOUT_MS bounds the
window; the client shows the payment window so a player knows when it has closed. An
operator reconciles a late payment manually via the on-chain reference recorded on the
row. This is a deliberately narrow, manually-recoverable edge, not an automatic
fund-loss path.

The World Market's Claudium purchases (server/market_settlement.ts, the same rails)
are stricter still about ambiguity: the idempotent transfer's dedupe key is
realm-scoped (market-realm-listing-seq; the listing and purchase counters are
per-realm while the economy service ledger is account-global), and an AMBIGUOUS
transfer failure (service unreachable or a lost response, reason 'unavailable')
never fails the pending purchase, because the transfer may have committed. The lot
stays locked and anchored while the same dedupe key retries on the poll ticker,
live and across restarts, until the service answers either way; past the timeout
window it keeps retrying and logs loudly every poll. Only a definitive service
refusal (a concrete reason such as insufficient balance) fails the pending closed
and unlocks the lot. The lock persisting until the service answers is the intended
conservative behavior: an ambiguous external failure never unlocks goods.

## Determinism and host parity

The sim never fetches a balance or talks to a service: the server injects a rails
view through SimConfig.tradeRails (feature flags + wallet links + cached Claudium
balance), and every other host omits it, so offline both rails read unavailable,
pledges are rejected with a clear error, and offline trades remain items + copper.
The trade path still draws no rng; the settlement clock is server wall-clock, outside
the sim. The RL env observation surface is untouched.

## Rollout

1. Merge with flags unset: item/copper trading gains the correctness fixes and the
   ledger; no external currency is reachable.
2. WOC_TRADE_ENABLED=1 (requires Solana RPC config; boot throws on a malformed flag)
   after operator and tokenomics sign-off. $WOC never leaves player custody: the
   server only verifies wallet-to-wallet payments, so no service-side invariant is
   implicated.
3. CLAUDIUM_TRADE_ENABLED=1 only after the maintainer explicitly decides to relax
   the economy service's one-way invariant (see the product gate above) and the
   service ships the idempotent transfer endpoint this PR's game side is written
   against. Boot throws on half-config.

Open maintainer decisions: whether $WOC trading between players is wanted (this PR
makes it possible and safe, not mandatory); whether Claudium should EVER be
player-transferable, which supersedes an audited one-way invariant and carries
secondary-market cash-out risk; fee policy (none is taken today on any leg); and
whether the trade ledger should back a support/dispute tool.
