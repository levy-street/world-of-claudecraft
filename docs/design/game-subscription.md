# Game subscription foundation

Release target: `release/v0.45.0`. One account subscription, USD 5.00 per month,
fiat through Stripe only. No Claudium, WOC, SOL, USDC, wallet prerequisite,
free trial, or gameplay benefits are introduced by this change.

## Implemented in the game

`src/subscription_contract.ts` defines the `game_monthly` plan and strict wire
decoders. `server/subscription_proxy.ts` delegates billing to the existing economy
service transport. `server/claudium.ts` serves the same handlers under both HTTP
dispatch modes, with active-account authentication and rate limits.

| Game endpoint | Economy-service endpoint | Purpose |
| --- | --- | --- |
| `GET /api/claudium/subscription` | `GET subscriptions/:accountId` | Account billing status |
| `POST /api/claudium/subscription/checkout` | `POST subscriptions/checkout` | Hosted Stripe subscription Checkout |
| `POST /api/claudium/subscription/portal` | `POST subscriptions/portal` | Hosted billing management and cancellation |

Client mutation bodies contain only `plan: "game_monthly"`, `rail: "stripe"`, and
an `idempotencyKey` of 16 to 128 ASCII letters, digits, underscores or hyphens.
The game supplies the authenticated account ID and expected price. Caller account
IDs, price IDs, amounts, redirect URLs and other fields are rejected.

The store section is composed by `StoreSubscription`; the native mobile store
restriction remains in force. Status refreshes on deliberate store entry/refresh,
not on the existing background store timer. Concurrent refreshes share one request.
A checkout retry reuses its purchase-intent key. A successful redirect grants
nothing and does not set the account to active. Reopen the store to fetch fresh status.

`WOC_SUBSCRIPTIONS_ENABLED` defaults off; only the exact value `1` enables proxy
calls. The existing `WOC_ECONOMY_SERVICE_URL` and `WOC_ECONOMY_INTERNAL_SECRET`
configure transport. Missing service support, invalid responses and outages fail
closed. The subscription card is hidden when unavailable. No Stripe keys or price
IDs belong in the game client.

Status reads share the existing public-read IP quota (60/minute), before database
authentication, on both dispatch modes. Checkout and portal share the existing
purchase quota (10/minute) with Claudium top-ups. No tick/login subscription lookup,
game database schema, timer, or persistent subscription cache is added.

## Economy-service contract, required before activation

This PR does not implement these endpoints in the separate service repository.
Until that implementation and Stripe configuration are verified, keep the game
flag off. A successful status response has this shape; timestamps are Unix seconds:

```json
{
  "plan": "game_monthly",
  "price": { "currency": "usd", "unitAmount": 500, "interval": "month" },
  "available": true,
  "status": "active",
  "cancelAtPeriodEnd": false,
  "currentPeriodEnd": 1900000000,
  "canCheckout": false,
  "canManage": true
}
```

Statuses are `none`, `incomplete`, `incomplete_expired`, `trialing`, `active`,
`past_due`, `canceled`, `unpaid`, and `paused`. Unknown or malformed status and price
data disable the section. `canCheckout` is allowed only for `none`, `canceled`, or
`incomplete_expired`; pending payment, delinquency and scheduled cancellation must
never offer a second subscription. `canManage` must be derived from the account's
owned Stripe customer, not a caller-supplied customer ID.

Mutations receive the trusted `accountId`, fixed `plan`, `rail`, `price` and
`idempotencyKey` from the game. Return `{ "ok": true, "url": "..." }` only for a
valid owned session. Checkout URLs must use `https://checkout.stripe.com` and
portal URLs `https://billing.stripe.com`; custom Stripe domains are not supported.
Failures return `{ "ok": false, "url": null }`. The existing secret header gates
all internal service endpoints. Redirect responses must not be used.

Required service behavior:

- Create a recurring Stripe Price for exactly 500 USD cents, interval `month`,
  interval count 1, and validate it against configuration before advertising it.
  Decide and disclose tax handling before launch; no promotions or trials are
  implied by this foundation.
- Create Checkout Sessions with `mode=subscription` and fiat card payment methods
  only. Do not enable Stripe crypto payment methods. Use server-configured success
  and cancel URLs, the account's stored Stripe customer and account/plan metadata.
- Keep one customer mapping per account and enforce one live subscription or
  pending checkout per account/plan transactionally across processes. Scope
  idempotency to account, action and plan. Reuse an open Checkout Session across
  retries and reconcile unknown outcomes before creating another; expire abandoned
  sessions deliberately. A fresh client key must not permit duplicate subscriptions.
- Create portal sessions for the authenticated account's mapped customer only.
  Enable cancellation and payment-method updates; restrict plan changes so the
  fixed-price contract cannot be changed through the portal.
- Verify Stripe signatures against the raw webhook body. Handle subscription
  creation/update/deletion and invoice paid/payment-failure events durably.
  Dedupe events, tolerate retries and out-of-order delivery, and reconcile current
  Stripe state rather than letting stale events overwrite newer state. Acknowledge
  only after durable processing or durable enqueue; failures must remain retryable.
- Keep subscription invoice events separate from one-time Claudium fulfillment.
  Never credit Claudium for subscription renewals. Define refund/dispute handling,
  reconciliation and event retention in the service before enabling live billing.
- Keep billing status separate from gameplay entitlements. Benefits and entitlement
  policy need a separate product decision and implementation.

References: [Stripe subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks),
[Checkout subscriptions](https://docs.stripe.com/payments/checkout/build-subscriptions),
[customer portal integration](https://docs.stripe.com/customer-management/integrate-customer-portal).

## Activation checks

Use Stripe test mode to verify initial payment, authentication-required payment,
renewal, failed renewal, cancellation at period end, immediate cancellation,
duplicate checkout requests, expired sessions, duplicate and reordered webhooks,
and cross-account denial. Verify desktop and mobile-web checkout/portal return paths.
No live purchase or deployment is part of this foundation change. Fill remaining locale
strings before the release gate. Focused regression coverage lives in
`tests/subscription_contract.test.ts`, `tests/subscription_sdk.test.ts`,
`tests/server/subscription.test.ts` and `tests/store_subscription.test.ts`.

## Local validation, 2026-09-28

Passed:

```sh
npx vitest run tests/subscription_contract.test.ts tests/subscription_sdk.test.ts tests/store_subscription.test.ts tests/server/subscription.test.ts tests/daily_rewards_store_behavior.test.ts tests/i18n_completeness.test.ts tests/architecture.test.ts tests/css_corpus.test.ts tests/css_value_validity.test.ts --maxWorkers=2
npx vitest run tests/monolith_budget.test.ts --maxWorkers=2
npx tsc --noEmit
npm run build:server
npm run build
git diff --check
```

The final focused run passed 284 tests, and the coordinator budget check passed
22 tests. Earlier targeted runs also passed the Claudium route suite, HTTP surface
inventory/completeness, localization matcher and store-window contract tests.
Explicit `biome check` over the changed source/test/CSS files passed with warnings.
`npm run ci:changed` inspected no files because this work is uncommitted; it is not
counted as lint evidence. Database-performance and security reviews are resolved.

`node scripts/gate_select.mjs` was attempted and stopped at `i18n freshness` because
regenerated locale artifacts are unstaged. It did not complete the full merge bar.
The five non-Latin locale fills required by M16 are included; other new locale
fills remain for the release tier. Full-suite Vitest, the repository browser suite,
live Stripe and packaged Electron checkout were not run. Component screenshots
are in [subscription-foundation](../screenshots/subscription-foundation/README.md).

The initial handoff was local on `feature/stripe-subscription`, based on
`origin/release/v0.45.0`, without a commit or PR.

## Publication validation, 2026-09-30

The seven focused subscription, store-integration and coordinator-budget suites
passed (184 tests), and `npx tsc --noEmit` and `git diff --cached --check` passed.
The pre-merge gate was restarted with generated artifacts staged; freshness and
the malware scan passed. See the PR for the final gate and CI outcome.
No deployment or live billing configuration change is included.
