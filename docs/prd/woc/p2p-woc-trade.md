# Trading items for $WOC, player to player

Design packet. Goal: a player can sell a $WOC-tradable item directly to another
named player for $WOC, entered from the existing trade window.

Decided with the requester: gold and $WOC are mutually exclusive in one deal, the
standard 10% fee applies, and there is **no bond** but the buyer receives nothing
until payment is completed and verified.

## This cannot be the existing trade, and the reason is not policy

The in-game trade is a **single-tick atomic swap**. After both sides confirm and a
final revalidation passes, everything moves at once:

```ts
metaA.copper = metaA.copper - session.offerA.copper + session.offerB.copper;
const grantsToB = removeOffer(ctx, session.offerA.items, session.a);
grantOffer(ctx, grantsToB, session.b);
```

A $WOC payment is asynchronous. The buyer signs, the chain reaches finality, and
that takes seconds to minutes and can fail. No tick can wait for it. Swap the item
first and a failed payment means the item is gone unpaid.

Independently, `src/sim/social/trade.ts` sits inside the token firewall's scanned
tree and is not on its three-file allowlist, so no wallet, token or settlement
identifier may appear in it. That is not a formality: the same trade code runs
headless in the RL env, where there is no wallet, no chain and no signature.

## What it is instead: a directed buy-now listing

Reuse the exchange rail with a named counterparty. Concretely, a directed sale is
`format: 'buy_now'` plus a designated buyer, which means the fee split, custody
escrow, settlement window, quote/confirm path, sales history and strike ladder all
apply unchanged. The new surface is small.

The trade window becomes an **agree-terms** surface that hands off, rather than a
swap surface. Same discoverability, honest about what happens.

### Escrow timing protects both sides

- **Item escrows when the deal is agreed.** Otherwise the seller could take the
  payment and keep the item.
- **Item delivers only on verified payment.** Otherwise the buyer could take the
  item without paying. This is the requester's stated rule and it is already how
  marketplace custody works.

So the sequence is: agree, item leaves the seller's bags into escrow, buyer pays,
service verifies, item arrives by mail. **A $WOC trade is not instant**, and the
UI has to say so rather than looking like a swap that stalled.

## Gold versus $WOC is structural, not a validated rule

Worth stating because it is the cheapest correctness property here. The two are
different mechanisms:

- A gold trade is the sim's atomic swap and carries `TradeOffer.copper`.
- A $WOC trade is a directed listing, which **has no copper field at all**.

So there is no reachable state where both exist. The trade window picks a mode and
the modes are different code paths. Nothing needs to validate "not both", which is
strictly better than validating it, because a validation can be bypassed and a
missing field cannot.

## What is already built and reused verbatim

| Need | Existing |
|---|---|
| Which items may be sold for $WOC | `exchangeItemCategory` + `exchangeHardLock` + the policy |
| Taking the item safely out of the bags | `extractTradableCopy` (exact-copy escrow) |
| Delivering it | `mailSystemParcel` with a custody ref, book-once |
| The 10% fee | `splitMarketProceeds`, sum-exact 90 / 7 / 3 |
| Pricing, quoting, verifying | the settlement quote and confirm path |
| Non-payment consequence | the strike ladder |

## What is new

**1. A designated buyer on a listing.** `WocListingParams` has no counterparty
field. Add one keyed on **account**, not character: the wallet check is
account-level (`verifiedWallet(account)`), and the delivery character is already
recorded separately on the settlement.

**2. Directed listings must never appear in public browse.** This is a security
requirement, not a nicety. `browseListings` filters on realm plus status plus
optional quality/format/itemIds:

```ts
const where: string[] = ['realm = $1', "status IN ('active', 'settling', 'ending')"];
```

A directed row leaking into that result set lets a stranger buy an item meant for a
friend. It needs excluding there, and the detail endpoint must refuse it for anyone
other than the two parties.

**3. `buyNow` needs a designated-buyer guard**, refusing anyone else. Use the
404-flavoured `not_yours` shape rather than a new "not for you" code, matching the
existing anti-enumeration convention: a stranger who guesses an id learns nothing.

**4. The counterparty's wallet status on the wire, and NOT on `TradeInfo`.**
`TradeInfo` is built by the sim (`IWorldTrade`) and carries `otherPid`,
`otherName`, the offers and the accepted flags. Wallet verification is
account-level server data, and the sim may not know about wallets at all. So it
must ride a **sibling field fed by the server**, not a new member of `TradeInfo`.
Adding `otherWalletVerified` to `TradeInfo` is the obvious move and it breaches the
firewall.

**5. The trade window's $WOC arm**, its mode exclusivity, and the copy for the
"recipient must connect a wallet" case, which is a new `t()` key.

## The no-bond decision and its residual risk

Accepted: no bond. The seller is protected against loss because the item returns if
payment never lands. What remains is a **targeted denial-of-use**: a buyer can
agree, lock a specific player's item in escrow for the settlement window, and walk
away, repeatedly.

That is materially milder than the auction case that motivated bonds, because the
seller chose this counterparty rather than being exposed to any stranger. Three
mitigations that cost no custody:

1. **The window is already short.** `WOC_MARKET_SETTLEMENT_WINDOW_SECONDS` is 600.
2. **The seller can cancel before payment.** A directed listing has no standing
   bid, so the `has_bids` guard that blocks cancelling a live auction never fires.
   Confirmed reachable: the trade arm's Cancel sale on the seller's
   awaiting-payment face and the Activity "My listings" rows both drive the
   ordinary cancel route (cancel-pending on a locked window, recorded on the
   face until the poll converges).
3. **A strike still applies.** The progressive ladder is bond-independent, so
   non-payment can carry its consequence without anything at risk up front. This
   is the cheapest teeth available and I would take it.

## Decisions (all four resolved)

**1. The seller enters USD.** The window shows the equivalent $WOC at the time of
the trade, and that figure is what the balance check uses.

Two consequences.

The displayed $WOC is a **preview, not a commitment**. USD is what is agreed; the
token amount is recomputed by a fresh quote at payment time, so the buyer may pay
more or fewer tokens than the window showed. That is the same exposure an auction
has and the existing `variableTokenWarning` copy already covers it, but here the
number is shown next to a price the two players just negotiated, so it will read as
a promise unless the copy says otherwise.

The balance check is **doing more work here than it was built for**. `guardBalance`
says so itself:

> Balance is a bid-time plausibility gate, never a guarantee (the bond is the
> enforcement).

With no bond there is no enforcement behind it, and it compares against a cached
chain read. So it can pass and payment can still fail, from a moved price or a
balance spent elsewhere. That is acceptable because the item returns, but the UI
must not present it as a guarantee that the buyer can pay.

**2. Items one way, $WOC the other, and $WOC only.** The buyer's side of the deal
is $WOC and nothing else. This is what makes the directed-listing shape fit exactly:
one seller's items, one price, one buyer. No two-way escrow, and the bigger build is
avoided.

**3. Show the net AND the fee.** Both, for transparency.

**This number must come from the server.** The view core's contract is explicit:

> The client computes NO price, token, or increment values: everything economic in
> this model is a passthrough of server-provided numbers.

And the fee schedule is not in the status payload today, so the client cannot derive
the net even if it were allowed to. Two ways to supply it, and the second is better:

- Ship the fee bps in `/status` and let the client do the USD arithmetic. Cheap, but
  it breaches the rule above and risks drift, because `splitMarketProceeds` rounds
  the burn up, then the treasury up, and gives the seller the remainder. A client
  computing a flat percentage would disagree by a cent.
- **Have the service return the split for an amount.** `/estimate` already takes
  `usdCents`; returning the three USD legs alongside the token figure makes the
  displayed net authoritative and drift-proof. Recommend this.

**4. Range stops mattering once both parties confirm.** Before mutual confirm the
window behaves normally and is proximity-gated. At mutual confirm the item escrows,
the directed listing exists, and separation is irrelevant.

This has an implementation consequence that decides the shape of the whole feature.
The sim's confirm **performs the swap** the moment both sides have accepted:

```ts
if (session.a === r.meta.entityId) session.acceptedA = true;
else session.acceptedB = true;
if (!(session.acceptedA && session.acceptedB)) return;
// ... straight into the atomic swap
```

So a $WOC deal can never route its confirm through `tradeConfirm()`. Two options:

- Reuse the sim session for NEGOTIATION only (items, accepted flags) and intercept
  the final confirm server-side. Saves the offer UI plumbing, but the sim session is
  proximity-gated and dies when players separate, which fights decision 4, and it
  means a session whose confirm must never be allowed to reach the sim.
- **Do not use the sim trade session for $WOC mode at all.** The window in $WOC mode
  is a server-negotiated directed offer: the seller picks items and a USD price, the
  buyer accepts, the server escrows and creates the listing. The sim never
  participates, so proximity, swap-on-confirm and the firewall are all non-issues by
  construction.

Recommend the second. It costs new offer/accept plumbing, and it buys a $WOC path
with no entanglement in a machine that was built to do something else atomically.

## Second round of decisions

**Public sales history: YES, for every p2p $WOC trade.** No name suppression, so no
special-casing at all: the sales row already carries `sellerName` and `buyerName` for
auctions, and a directed sale flows into the same history unchanged. This is the
cheapest of the three to build and it closes the hole flagged above, where directed
trades would otherwise have been the only settlement path on the rail with no public
record.

**Strikes: YES, once both parties have accepted.** Mutual acceptance is the moment a
commitment exists, and it is also the moment the item escrows, so the two line up.
This falls out of reusing the settlement machinery rather than needing new work: a
directed sale creates a settlement, and the existing expiry sweep already strikes a
lapsed one. Before mutual acceptance there is no settlement and therefore no strike,
which is the right shape.

**2FA: removed on the paying side.** Scoped here to the directed p2p path; see the
note below about whether it should also come off auctions.

The reason it costs little is worth recording, because it is not obvious. The
marketplace PRD specified TOTP on `placeBid` and `buyNow` only, and both of
those require the buyer's own wallet signature to move any money. A stolen
session token does not carry the wallet key, so 2FA there is a step-up gate in
front of an action that already demands a stronger second factor. (Truth-up,
2026-08-13: that TOTP gate was specified but never enforced server-side, on any
path; finding B6. Built since: the wallet-signature step-up now guards the
custody-moving side, which per this analysis is where it belongs. Listing and
the SELLER's directed acceptance require a fresh challenge signed by the
linked wallet, `server/woc_market_stepup.ts`.)

**The gap it leaves untouched is on the other side.** `createListing` has NO 2FA at
all, and that is where a session-token thief can actually steal: list the victim's
valuables at the $0.25 minimum, have a confederate buy them, and the items leave
custody legitimately with the victim's wallet never signing anything. Removing 2FA
from the paying side does not create that hole and keeping it would not have closed
it, but it is the thing to fix if 2FA is meant to protect anything here.

## Remaining open questions

**1. Does 2FA come off auctions too?** Removed for the directed path above. The same
argument applies to `placeBid` and `buyNow` on an auction, since those also require a
wallet signature, and gating one path but not the other is hard to explain to a player
paying the same amount on the same rail. Not decided.

**2. Should `createListing` GAIN 2FA?** The theft vector described above is real and
unguarded today, independent of this feature. It belongs to the exchange rather than
to p2p trades, so it is noted here and tracked separately.

**3. Does a directed offer count against the 12-listing cap?**
RESOLVED by the directed-rail hardening (H12): a directed LISTING counts against the
shared per-account cap (`WOC_MARKET_MAX_ACTIVE_LISTINGS`) in both directions
(`countActiveBySeller` and the authoritative
in-transaction count both dropped the exemption), because it holds an item in custody
escrow exactly as a public listing does. A pending OFFER still escrows nothing and
counts toward nothing. The directed hold is the settlement window
(`WOC_MARKET_DIRECTED_HOLD_SECONDS`, identical to `WOC_MARKET_SETTLEMENT_WINDOW_SECONDS`
by a pinned identity), not an auction duration; an accepting buyer who never pays is
struck and the listing auto-closes with the item returned. The agreed copy is
fingerprinted at offer time (`item_pin`, the `itemCopyPin` 3-tuple) and acceptance
refuses `item_mismatch` for any other copy.

## Sequencing

This shares the builder, verifier and releaser with an auction, so it cannot be
tested end to end until those exist. It should land **after** the chain wiring
(`MARKET_CHAIN_WIRING.md` in the payout service), and reuse rather than
parallel-build.

## Implementation status

Updated 2026-08-13. The whole rail has landed: the offer, accept, decline, and
withdraw endpoints; escrow on acceptance with delivery on verified payment; the
trade window's $WOC arm (`src/ui/hud/woc_trade/`); the strike on a
never-paying buyer with the auto-close return flight; the agreed-copy
fingerprint (`item_pin`); the one-pending-offer-per-pair bound; and terms
acceptance gating both money paths (`guardTerms`). It ships disabled behind
`WOC_MARKET_ENABLED` with the rest of the marketplace.

Updated 2026-08-17 (the honesty round on the money surface): the seller's
Decline and Cancel sale are live client controls; a closed-not-sold listing
renders its own ending (cancelled / suspended / unpaid, never a false payment
line) and a review-parked or delivered settlement its own status; the p2p Pay
flow is two-step (claim, then a quote-review face with the token total, the fee
legs and the expiry, then Sign); the buyer reads the payment hold and the strike
before the shared Accept, and both sides read the fee and the net on the review
face; the consent row (checkbox plus the linked Marketplace terms) sends the
player's real choice on the offer send and the pay claim. The directed-rail
hardening record lives in the packet ledger
(`docs/woc-marketplace-hardening/state.md`); the sections below are the design
history plus, in "Landed", the original foundation table.

### Landed (game `12543c8d55`, service `f2ea381`)

| Piece | Where |
|---|---|
| `directed_buyer_account`, additive DDL + partial index | `WOC_MARKET_SCHEMA` |
| Account-keyed field on the params + row | `WocListingParams`, `WocListingRow` |
| Directed rows excluded from public browse | `browseListings` (SQL) |
| Detail refuses non-parties; `viewerAccount` is REQUIRED | `WocMarketService.listingDetail` |
| `buyNow` refuses a non-designated buyer as `not_found` | `WocMarketService.buyNow` |
| Shared per-account cap (`WOC_MARKET_MAX_ACTIVE_LISTINGS`) counts directed listings, both halves (the launch-time cap exemption was removed by the directed-rail hardening, H12) | `woc_market.ts`, `woc_market_db.ts` |
| Auction form + malformed account id refused | `validListingParams` |
| The three USD legs on `/estimate` | service `splitMarketProceedsCents` |

Tests: `tests/woc_market_rules.test.ts` (the directed-sale describe),
`tests/server/woc_market_service.test.ts` (the two-parties describe), and
`tests/server/woc_market_directed_sql.test.ts`, which exists because the
service tests run against `FakeWocMarketDb` and therefore stay green when the
real SQL predicate is deleted. That file drives `PgWocMarketDb` against a mock
pool and pins the predicate on every sort. Every gate above is mutation-tested.

### Since landed (originally the remaining list; all built)

1. **Offer / accept / decline endpoints.** `RouteDef` modules registered in
   `server/http/registry.ts`. The offer route accepts the counterparty's
   character NAME (the one handle the trade window has) and resolves it
   server-side (`characterByName`), so no account id ever crosses the wire;
   an account id in the request body would make any account a drop target,
   which is why the public `createListing` route still passes
   `directedBuyerAccount: null` unconditionally: only the offer rail creates
   directed listings.
2. **Counterparty wallet-verified status.** A server-fed sibling field, NOT a
   member of `TradeInfo`: the sim builds that and may not know about wallets
   (`src/sim/social/trade.ts` is inside the token firewall's scanned tree and
   not on its allowlist). Drives the "recipient must connect a wallet" copy.
3. **Escrow on mutual acceptance, delivery on verified payment.**
   `extractTradableCopy` then `mailSystemParcel` with a custody ref, reusing
   the settlement machinery so the existing expiry sweep supplies the strike
   and the sale flows into the public history unchanged.
4. **The trade window's $WOC arm.** The pure view core and panel are
   `src/ui/trade_woc_view.ts` and `src/ui/trade_woc_arm_painter.ts`; the offer
   machine (controller plus `woc_trade_offer_view.ts`) lives in
   `src/ui/hud/woc_trade/`. USD entry showing the $WOC equivalent, net AND
   fee from the server split, gold/$WOC mutual exclusivity, filtering to
   $WOC-tradable items, and the wallet-required message, with English `t()`
   keys in `i18n.catalog/hud_chrome.ts`.
5. **An auction-listed item is not offerable p2p** structurally: listing is
   escrow-by-removal, so a listed copy is no longer in any bag to stage.

### Two decisions worth re-reading

The sim trade session is NOT used for $WOC mode (see "Second round of
decisions"): its confirm performs the swap in the same tick, and a $WOC payment
is asynchronous. The window is an agree-terms surface that hands off.

`createListing` still has no step-up factor, which is the real theft vector on
this rail and is independent of this feature. The hardening packet's step-up
work (`docs/woc-marketplace-hardening/`) owns closing it before enable.
