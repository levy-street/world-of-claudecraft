# Membership

This feature builds on the subscription checkout foundation from PR #4281.
Recurring membership remains available. A separate tradable token grants 30 days
when redeemed, added to any remaining account membership time. Expiry disables
extra character slots and armour benefits until renewal; it does not delete items
or characters.

Active members can open other characters' banks through bank tabs, use ten extra
character slots, receive soulbound class and specialization armour, and pay half
the auction house tax. Armour follows character level through level 19 and
perfects at level 20 to item level 25. Its full-set experience bonus is 20%.
The implementation uses existing item stat budgets and class/spec preferences.
The seven armour slots are helmet, shoulders, chest, waist, legs, gloves and feet.
The experience bonus applies once with the full set equipped. Existing base
characters remain playable after expiry; characters created in membership slots
remain stored but cannot enter the world until renewal. Other-character bank
transfers require a banker and an offline target character in the same realm.
Soulbound, quest and locked copies cannot cross character banks.

## Paid rewards, trial and yearly bundle

The monthly subscription costs USD 5 and credits 500 Claudium (USD 5 value) after
each verified payment. The yearly bundle costs USD 50, credits 6,000 Claudium
(USD 60 value) per paid annual invoice, and supplies the existing Dreadspark
Groundshaker tank as the placeholder mount. Its soulbound ignition key is mailed
to the character used for checkout. Riding skill is required; keeping the key in
bags or bank preserves ownership after membership expires. The initial annual
payment grants the mount once; renewal and receipt retries cannot duplicate it.

Both recurring plans offer one seven-day, card-required trial per account. The
trial activates game benefits until its verified deadline but grants no Claudium
or mount. After the trial the chosen plan charges and renews monthly or yearly
until canceled. Tradable token purchases/redemptions do not award Claudium.

The game fixes all prices and selects the annual recipient from the authenticated
live session. `POST /api/claudium/subscription/annual/claim` verifies the service's
original paid-invoice receipt and uses the existing bounded custody delivery path.
Subscription checkout reminders are persisted separately per account and plan;
opening the store retries receipt collection without creating another checkout.
Trial/currency/annual offers require the new validated service capability metadata.

Ordinary gold auction listings record the seller's reduced fee when listed, so
offline settlement keeps the agreed fee. Immediate order fills use the seller's
current membership. The separate real-money Exchange fee is unchanged.

## Tradable token purchase

`src/membership_token_contract.ts` owns the one-time offer: SKU
`membership_token_30d`, USD 5, quantity one, 30 days. This reuses the foundation's
USD 5 price as the default; it is a separate one-time purchase, never a recurring
Stripe price. The inventory item ID is `membership_token`.

`server/membership_token_store.ts` validates all economy responses and accepts
only the authenticated account and server-selected live character. Caller-selected
prices, recipient IDs, redirect URLs and item IDs are rejected. The offer and
checkout stay unavailable unless `WOC_SUBSCRIPTIONS_ENABLED=1`, a live game
recipient exists, and the external economy service supports the contract.

The same-origin authenticated API is registered in `server/claudium.ts` and shared
by both HTTP dispatch modes:

- `GET /api/claudium/membership-token` reads the validated offer.
- `POST /api/claudium/membership-token/checkout` accepts only `rail: "stripe"`
  and a bounded `idempotencyKey`.
- `POST /api/claudium/membership-token/claim` accepts only `idempotencyKey` and
  verifies the corresponding paid receipt before durable mail delivery.

The store preserves the latest purchase intent in browser storage so returning
from checkout or refreshing can resume collection. Payment does not activate the
membership: collecting the mailed token and redeeming it are separate actions.

## External economy deployment requirement

The service repository is
[`levy-street/woc-daily-rewards-service`](https://github.com/levy-street/woc-daily-rewards-service).
`woc-deploy` currently configures its `master` branch as the Claudium economy
service. The older subscription proposal in that repository's PR #13 uses a
different contract and does not supply these endpoints. The companion implementation
is now present locally on `codex/membership-billing`, based on service master
`d5e3bcfda6c95f640e19dd05e52fd4727354fcfe`. Its `service/docs/MEMBERSHIP.md`
documents configuration, payment verification and operator recovery. Subscription
and token fulfillment use separate receipts; paid recurring invoices credit the existing Claudium ledger.

This game repository does not contain the external economy service. Deploy and
verify its companion implementation before enabling token sales. Its
secret-authenticated token endpoints implement this contract:

- `GET membership-tokens/offer`: return `available`, `canCheckout`,
  `sku: "membership_token_30d"`, `days: 30`, and
  `price: { currency: "usd", unitAmount: 500 }` with no recurring interval.
- `POST membership-tokens/checkout`: accept game-supplied `accountId`,
  `characterId`, `realm`, `sku`, `quantity: 1`, `days: 30`, fixed `price`,
  `rail: "stripe"`, and `idempotencyKey`. Bind the order immutably to this full
  identity and return `ok` plus a Stripe-hosted HTTPS checkout `url`.
- `POST membership-tokens/receipt`: accept `accountId`, `characterId`, `realm`
  and `idempotencyKey`; return a stable `receiptId`, `settled: true`, the same
  account/character/realm/SKU/quantity/days/price only after trusted verified
  payment success. A redirect or client assertion never settles an order.

Receipt IDs are globally unique, immutable, and 16 to 128 ASCII letters, digits,
underscores or hyphens. Scope checkout idempotency to the authenticated account
and reject reuse with changed immutable purchase details. The service owns Stripe
webhook signature verification, durable payment state, refunds, reconciliation,
and operator recovery of a purchase whose browser intent was lost. Service
deployment and Stripe test-mode verification remain activation prerequisites.

Recurring membership refresh also requires `POST subscriptions/batch`, accepting
`{ accountIds: number[] }` with at most 250 unique account IDs and returning
`{ available: true, subscriptions: [...] }`. Each entry contains its `accountId`
and the existing subscription snapshot fields, including an explicit inactive
snapshot for accounts without a subscription. The response must contain exactly
the requested accounts without duplicates. Prove this capability before enabling
membership: the existing per-account login endpoint alone is insufficient.

Periodic refresh performs one indexed prepaid-time query and one external request
per batch, with four concurrent batches and a five-second external deadline.
There is no per-account fallback during an outage. Previously verified recurring
authority keeps its original deadline, never an extended deadline; local prepaid
time remains independently verifiable. Cohort timers and account-indexed session
lookups keep recurring work bounded. All durability work uses the existing shared
database admission gate inside its character or mail write queue.

## Delivery durability

`server/membership_token_delivery_db.ts` inserts the paid receipt and one custody
parcel in one bounded Postgres transaction. It locks account before character,
uses local lock/statement/idle deadlines, and makes no network request while
holding a database connection. A replay checks the receipt's immutable identity
and never remints after collection. Receipt rows are deliberately retained
forever, even after character deletion, because pruning enables paid-order replay.
Growth is one small indexed row per paid token order.

The existing `mail_custody_overlay.ts` boot replay recovers a committed delivery
lost before live mail booking. Paid token overlays, like vault reward overlays,
are excluded from the residue reaper; only atomic durable mailbox baking removes
them. The game host serializes delivery with the existing mail writer. No claim
rewrites or scans the whole realm mail book.

`membership_token_delivery.ts` coalesces identical receipt attempts, admits one
attempt per account and at most four per realm, and expires unstarted work after
five seconds. Admission remains held until the underlying work settles. A lost
commit acknowledgement retains a bounded process-local proof that the parcel has
never been live-booked. A retry must reverify the immutable receipt in Postgres
before using that proof. Successful booking clears it, so later collection cannot
authorize a second delivery. At most 64 unbooked recovery proofs are retained;
capacity exhaustion fails closed until recovery succeeds or boot replay runs.
The viewer-identical token offer uses a shared immutable 30-second read cache.

Checks live in `tests/server/membership_token_store.test.ts`,
`tests/membership_token_contract.test.ts`, the token delivery database suites,
and the subscription SDK/store suites.
