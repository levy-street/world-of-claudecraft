# Merch store (Printful dropship)

> **STATUS: SKELETON, targeting v0.27.** The homepage Store tab, the `/api/merch/*` BFF routes, and the client checkout skeleton ship behind `MERCH_STORE_ENABLED` (off by default). The economy service's merch surface (catalog, orders, payments, Printful) is the pending half; until it ships the tab stays hidden and every route answers its typed unavailable body.

| | |
|---|---|
| **Tier** | 2 - Monetization |
| **Ease** | 3/5 |
| **Flywheel** | Monetization |
| **Sustainability** | Revenue |
| **Reg risk** | Medium - physical goods, payments, shipping PII |

## What
A merch store on the main website: players buy physical goods (shirts, hoodies, mugs) from a homepage Store tab and pay with **Claudium**, **card (Stripe)**, or **Solana** (SOL now; the quote shape carries `mint`, so USDC is an enable, not a rework). Printful produces and dropships every order; the game runs no inventory.

## Why it's a flywheel
Real revenue plus an IRL brand surface, and the first physical Claudium sink: Claudium earned or bought in game closes its earn-to-spend loop on goods with real-world value. Still one-way - merch grants no in-game power and Claudium never cashes out.

## Planned behavior
- `GET /api/merch/products` (public) lists the service catalog; the homepage Store tab reveals itself only when it answers `enabled: true`.
- One authed `POST /api/merch/checkout` carries items + shipping + rail + an idempotency key. Stripe answers the `clientSecret` intent (the same embedded checkout Claudium uses); SOL answers the native quote (`reference`/`transactionBase64`; the wallet signs, then `POST /api/merch/checkout/native/confirm` on the existing retry ladder); Claudium settles synchronously by debiting the balance under the idempotency key.
- Order lifecycle (service-owned): `pending_payment -> paid -> submitted -> in_production -> shipped -> delivered`, terminal `payment_failed | expired | canceled | refunded | fulfillment_failed`. `GET /api/merch/orders` returns PII-light references only (status, item names, tracking link).
- Webhooks relay raw through the BFF (the service is not publicly reachable): `POST /api/merch/stripe/webhook` and `POST /api/merch/printful/webhook` forward body + signature header verbatim; the service verifies both signatures. The relays key on the service env pair alone, NOT the kill switch: flipping `MERCH_STORE_ENABLED` off is a complete player-surface rollback that still delivers payment/fulfillment callbacks for orders placed while the store was on.
- Fail-closed: flag off or service dark means the player surface behaves byte-identically (the webhook-relay exception above is the one deliberate difference), the tab stays hidden, and every proxy call resolves to its typed unavailable result - never a throw.
- Abuse posture mirrors the Claudium money surface: checkout and native-confirm carry the two-tier rate limits (pre-auth per-IP, post-auth fused IP+account) on BOTH dispatch arms; the public catalog probe is per-IP limited and TTL-memoized game-side (30s), so homepage traffic can never become an upstream flood.

## Service contract (the economy service's pending half)
Internal base URL + `x-woc-economy-secret`, same as the Claudium surface:

| Method/path | Body -> Response |
|---|---|
| `GET merch/products` | `{ enabled, products: [{ productId, name, description, imageUrl, variants: [{ variantId, label, usd, claudium, inStock }] }] }` |
| `POST merch/checkout` | `{ accountId, rail: 'stripe'\|'sol'\|'claudium', items, shipping, email, idempotencyKey, payer? }` -> `{ orderId, rail, totalUsd, totalClaudium, stripe?, native?, paid?, balance?, reason? }` |
| `POST merch/checkout/native/confirm` | `{ reference, signature }` -> `{ settled, orderId, reason? }` |
| `GET merch/orders/:accountId` | `{ orders: [{ orderId, status, createdAtMs, totalLabel, items, trackingUrl }] }` |
| `POST merch/stripe/webhook` | raw + `stripe-signature` -> `{ received }` |
| `POST merch/printful/webhook` | raw + `x-pf-webhook-signature` -> `{ received }` |

Service-side schema draft (illustrates the contract; NOT this repo's DB): `merch_products` / `merch_variants` / `merch_orders` (`UNIQUE(account_id, idempotency_key)`, the `UNIQUE(tx_sig)` replay guard, `UNIQUE stripe_payment_intent`, `UNIQUE native_reference`, `printful_order_id`, `tracking_url`) / `merch_order_items` / `merch_shipping` - the only PII table, service-side only.

## Constraints (non-negotiable)
- **Cosmetic-only / no pay-to-win** - merch never grants in-game power.
- **Non-custodial** - the client wallet signs; the server verifies, never signs.
- **The game server computes no price/total/verification** - thin BFF, structural twin of the Claudium surface; `src/sim/` untouched.
- **Shipping PII never lands in the game DB or logs** - it passes through the checkout POST once, unlogged, and lives only in the economy service.

## Open questions
- Reuse the Claudium Stripe webhook endpoint + secret (service routes by PaymentIntent metadata) instead of the separate merch pair the skeleton registers?
- Claudium price per variant: a fixed peg conversion or service-set merchandising? (The contract assumes service-set.)
- Should the game mirror order references locally for service-off visibility? (The skeleton says no: the service stays the single source of truth, and a mirror adds PII-adjacency for no reader.)
- Regulatory/ToS pass (consumer law, tax/VAT jurisdictions, crypto-for-goods posture) before the service half ships.

## Out of scope
The economy-service merch implementation, refund/chargeback admin tooling, inventory beyond Printful stock flags, VAT/tax jurisdiction policy, and USDC enablement timing.
