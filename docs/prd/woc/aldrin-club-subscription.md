# Aldrin Club subscription

> **STATUS: DRAFT, opening discussion.** This PR ships a working, feature-flagged
> server implementation plus tests, and documents the remaining client work. It
> is OFF by default (`ALDRIN_ENABLED=0`) and grants nothing until an operator
> funds and discloses the treasury and buyback vault. Opened to settle the design
> (perk scope, split economics, the Stripe caveat) before it goes live.

| | |
|---|---|
| **Tier** | 2 - Recurring revenue |
| **Ease** | 3/5 |
| **Flywheel** | 4 |
| **Sustainability** | Burn + Treasury |
| **Reg risk** | Medium (recurring fiat + crypto payments) |

## What
A $20/month premium membership, the "Aldrin Club", payable in SOL, USDC, $WOC, or
fiat card (Stripe). Membership is account-level and grants a set of cosmetic,
convenience, and access perks (never power). For the on-chain rails, every payment
is split 50/50: half funds the disclosed treasury, half is removed from $WOC
supply (bought-and-burned for SOL/USDC, burned in the same transaction for $WOC).

## Why it's a flywheel
Recurring revenue is the steadiest sink we can build: instead of a one-time fee it
pulls value out of supply every month a member stays subscribed. Every SOL/USDC
membership becomes a standing buy-and-burn order, and every $WOC membership burns
directly, so subscriber growth maps straight to recurring deflation plus a funded
treasury. The visible perks (an aura, regalia, a club mount, a lounge) create the
social pull that recruits the next member.

## Pricing and payment rails
- Price is authored in USD cents (`ALDRIN_PRICE_USD_CENTS`, default 2000) so the
  charge is a stable $20 regardless of rail.
- USDC: charged 1:1 (20 USDC).
- SOL and $WOC: the USD price is converted to a base-unit amount at quote time
  using a live Jupiter quote against USDC, then pinned in the quote for a short
  TTL (`ALDRIN_QUOTE_TTL_SECONDS`, default 600s) so FX cannot drift before the
  user signs. Rounding always ceils, so a quote never underprices the membership.
- Stripe: a standard $20/month Checkout subscription.
- One paid period extends membership by `ALDRIN_PERIOD_DAYS` (default 30) from
  whichever is later, now or the current expiry, so paying early never burns
  remaining days and a lapsed member restarts cleanly.

## Revenue routing (the 50/50 split)
The split percentage is one knob, `ALDRIN_BURN_BPS` (default 5000 = 50%).

```
SOL / USDC payment (single user-signed transaction, memo = quoteId)
    50%  ->  ALDRIN_TREASURY            (disclosed, on-chain-auditable)
    50%  ->  ALDRIN_BUYBACK_VAULT  -->  keeper swaps to $WOC on Jupiter  -->  burn

$WOC payment (single user-signed transaction, memo = quoteId)
    50%  ->  ALDRIN_TREASURY
    50%  ->  burned in the same transaction (no swap needed; it is already $WOC)

Stripe (fiat card)
    100% ->  project Stripe balance.  The 50/50 economics are a treasury policy on
             this rail: the buyback share is periodically off-ramped to USDC and
             run through the same buyback keeper. v1 records the fiat earmark; the
             automated fiat -> USDC -> burn off-ramp is out of v1 scope (see below).
```

The buyback half of SOL/USDC accrues to one vault and is swapped-and-burned in
batches by a keeper (`server/aldrin_buyback.ts`), the same pattern as the in-flight
protocol-wide buyback-and-burn engine. Production should run a single keeper for
every sink (marketplace fees, subscriptions, ...) rather than one per feature.

Why fiat is treated as a treasury policy and not an in-transaction split: you
cannot trustlessly burn $WOC straight from a fiat card. Settling fiat, off-ramping
to USDC, and buying $WOC back is a custodial, manual-or-scheduled treasury action.
v1 is honest about that line instead of pretending the burn is automatic.

## Membership and perks: cosmetic, convenience, access only (no pay-to-win)
The project rule is non-negotiable: token and paid utility is appearance,
convenience, access, or realm-operation, never power. The request mentioned "buffs
and gear access", so this draft deliberately interprets those as cosmetic and
convenience, and the perk model (`ALDRIN_PERKS` in `server/aldrin_club.ts`) has no
"power" kind by construction. A runtime guard (`assertNoPowerPerks`, asserted by
the test suite) fails the build if a power perk is ever added.

Proposed perks:
- Aura (cosmetic): the "buff", a purely visual golden aura plus a buff-frame icon
  with zero stat effect.
- Regalia (cosmetic): the "gear access", an appearance-only transmog set, no item
  stats. Granted account-wide via the existing cosmetics entitlement pipeline.
- Mount (cosmetic): an exclusive club mount appearance (reuses the mount pipeline).
- Title and name color (cosmetic): "Member of the Aldrin Club" and a gold
  nameplate.
- Lounge (access): a members-only social zone and chat channel.
- Wardrobe, queue, stipend (convenience): extra cosmetic loadout slots, priority
  login at capacity, and a monthly cosmetic-only vanity credit (never spendable on
  power).

Explicitly rejected unless the founders sign off and accept the design change: XP
or gold boosts, stat buffs, gear with combat stats, and any consumable that
affects an outcome. These would break leaderboards and the no-pay-to-win rule.

## Architecture and data flow
New code follows the repo's pure/IO split and module-first conventions.

| Module | Role |
|---|---|
| `server/aldrin_config.ts` | Env config: price, period, split bps, treasury + vault, mints, RPC, Stripe + keeper flags. Mirrors `woc_config.ts`. |
| `server/aldrin_club.ts` | Pure, IO-free domain logic: membership clock, split math, quote shape + expiry, perk catalog, and the pure on-chain verdict. Unit-tested without a DB or network. |
| `server/aldrin_solana.ts` | Solana IO shell: parse a finalized tx into the pure `ParsedOnchainPayment` (incl. the native-SOL lamport path), and the Jupiter FX quote. |
| `server/aldrin_buyback.ts` | Buyback-and-burn keeper for the SOL/USDC split, behind an injectable executor (testable). |
| `server/aldrin_stripe.ts` | Stripe webhook HMAC verification via `node:crypto` (no SDK dependency) and event -> grant mapping. |
| `server/aldrin_club_db.ts` | SQL: `aldrin_quotes` (single-use intents) and `aldrin_payments` (immutable ledger, UNIQUE reference = replay guard). |
| `server/aldrin_club_http.ts` | HTTP shell wiring req/res to all of the above. |
| `server/db.ts` | `AccountCosmetics.aldrinClub` membership record + `setAldrinMembership` (rides the existing cosmetics sync to the client). |

Crypto purchase flow:
1. Client requests a quote (`POST /api/aldrin/quote { method }`). The server pins
   the base-unit amount, the treasury and buyback payees, and a memo equal to the
   quoteId, then persists the quote.
2. Client builds, signs (linked wallet), and broadcasts a single transfer that
   pays the treasury and the buyback vault (or burns, for $WOC), carrying the memo.
3. Client submits the signature (`POST /api/aldrin/confirm { quoteId, signature }`).
   The server fetches the finalized tx, verifies success, the legacy SPL program
   (rejecting Token-2022), the memo binding, the payer spend, the treasury credit,
   and the burn/buyback credit, appends to the ledger (idempotent on signature),
   then grants/extends membership.

Stripe flow: Checkout subscription with `client_reference_id = accountId`; the
webhook (`POST /api/aldrin/stripe/webhook`) verifies the signature, maps the event
to a grant, and extends membership idempotently on the Stripe event id.

## API
- `GET  /api/aldrin` (auth): status, price, enabled rails, perk catalog, membership.
- `POST /api/aldrin/quote` (auth): `{ method }` -> a single-use payment quote.
- `POST /api/aldrin/confirm` (auth): `{ quoteId, signature }` -> verify + grant.
- `POST /api/aldrin/stripe/webhook` (Stripe-signed, not bearer): verify + grant.

## Security and abuse
- Server-authoritative: the client cannot forge membership; the HUD only mirrors a
  server-set record.
- Replay-safe: the on-chain tx signature and the Stripe event id are UNIQUE ledger
  keys, so a resubmitted payment is an idempotent no-op rather than a double grant.
- Bound payments: the memo equals the quoteId, the payer must be the account's
  linked, signature-verified wallet, and the quote names exact payees and amounts.
- Custodial surface is minimized: only the buyback keeper wallet (SOL/USDC swap +
  burn) and the Stripe keys are custodial; both come from env/KMS, never git. The
  treasury can be a multisig.
- Fail closed: with the feature flag off, or treasury/vault/Stripe unset, the
  relevant rail is refused rather than half-working.

## What this draft implements vs. follow-up
Implemented and tested in this PR:
- All pure economics (split, pricing, membership clock, quote lifecycle, on-chain
  verdict, Stripe signature verification), with 21 unit tests.
- Config, DB schema + queries, entitlement persistence, the four HTTP routes, and
  the client `Api` methods + the `AccountCosmetics.aldrinClub` seam.

Deliberate follow-up (called out so nothing is silently missing):
- Client: a HUD membership panel, the i18n catalog keys for its strings, and the
  in-browser transaction builder that constructs the split/burn transfer and
  drives the wallet signature. The `Api` methods and the read-model seam are ready.
- Perk rendering: wiring the cosmetic aura, regalia transmog, club mount, title,
  name color, and lounge access into the sim/render/UI cosmetic pipelines.
- Buyback keeper production wiring: loading the keeper key and executing real
  Jupiter swaps + burns (the orchestration and the executor seam exist here).
- Stripe Checkout-session creation (needs the live secret key) and the fiat ->
  USDC -> burn off-ramp for the fiat buyback share.
- Convergence with the $WOC commerce core: when `woc_config.ts` / `solana_tx.ts` /
  `woc_payment.ts` / `buyback.ts` land on main, fold the Aldrin equivalents into
  them so mints, RPC, sink routing, and the keeper have one source of truth.

## Constraints (non-negotiable)
- **Cosmetic-only / no pay-to-win** - membership utility is appearance,
  convenience, access, or realm-operation; never power.
- **Non-custodial by default** - the chain owns assets; users sign their own
  payments; `src/sim/` stays pure and deterministic. The only custodial seams are
  the buyback keeper and Stripe, both isolated and disclosed.
- **Server-authoritative and replay-safe** - membership is granted only after a
  verified, single-settlement payment.

## Open questions
- Final split: is 50/50 right, or should treasury versus burn differ by rail?
- Final perk list and balance: are wardrobe slots, priority queue, and a cosmetic
  stipend acceptable as convenience, or should the club be cosmetic-only?
- Is a monthly stipend (even cosmetic-only) too close to power or value transfer?
- Treasury custody: single key or multisig, and who discloses the address?
- Stripe: do we want true auto-renewing subscriptions (and the dunning, refund,
  and chargeback handling that implies) in v1, or one-month Checkouts to start?
- Regulatory: recurring fiat plus a token buy-and-burn may have securities and
  money-transmission implications by jurisdiction; what review is required before
  enabling?

## Out of scope
On-chain minting of a membership NFT, secondary trading of memberships, gifting,
regional pricing, proration/refunds, and any gameplay-stat advantage remain out of
scope. Part of the proposed $WOC GameFi roadmap.
