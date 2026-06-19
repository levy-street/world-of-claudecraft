# PR 3 — Native Character Marketplace + buyback-burn

> **Status:** DRAFT / implementation plan. Stacked on **PR 2** (`feat/woc-sns-tradeable`) → PR 1 → #473. Flag-gated; no behavior change on `main` by default.

## Summary
List a bound character for sale in **USDC** (`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`) at a seller-chosen price. On sale: **70% → seller, 30% → buy `$WOC` on a DEX and burn it.** Every secondary-market trade becomes deflationary pressure on `$WOC`, capturing gray-market RMT value on-platform. Shares the buyback-burn primitive with stubs #469 / #466.

## A. Listings — off-chain orderbook + trustless on-chain escrow
Long-lived passive listings, OpenSea / Magic-Eden style. A Solana tx is pinned to a recent blockhash that expires in ~60–90s, so a naive pre-signed sale is impossible; the listing authorization is **the asset sitting in escrow**, not a pre-signed transaction. Seller is offline at sale time; only the buyer signs at fulfillment.

- **List** `POST /api/market/list` `{ characterId, priceUsdc, expiresAt }` — current owner only; character must be offline, unlisted, and not guild-leader-with-members (or auto-handled on settle). Transfers the character's subdomain into the **marketplace escrow program PDA** (CPI to SNS `transfer`); records `seller, price, expiry, split` on-chain and mirrors to a `market_listings` DB table for discovery/search. **Cancel** anytime before expiry to reclaim. Expiry seller-chosen, hours → months (configurable cap).
- **Buy** `POST /api/market/buy` `{ listingId }` — buyer submits one tx; the program settles **atomically**: subdomain escrow → buyer, **70% USDC → seller, 30% USDC → buyback vault**; emits an event. PR 2's claim/transfer cleanup then runs (reassign `account_id`, clear stale state). Gear/progress follow the character.
- **Escrow program** (`programs/character-market/`, Anchor): instructions `list`, `cancel`, `buy`; holds the subdomain in a PDA; verifies price/expiry; enforces the 70/30 split; USDC mint pinned. Needs build + **security audit** + devnet→mainnet deploy + upgrade-authority custody. Interacts with PR 2 ownership-resolution: a subdomain owned by the escrow PDA reads as "listed/locked," controlled by the lister until sold/cancelled.

## B. Buyback-and-burn keeper (`server/buyback.ts`, new)
- The 30% USDC accrues in the buyback vault. A keeper (server job; ideally permissionless) **batches** vault USDC, swaps USDC → `$WOC` via a DEX aggregator (**Jupiter**) with a slippage cap, then SPL-`burn`s the received `$WOC`. Batching limits fees/slippage/MEV vs per-sale swaps. Records each buyback (USDC in, `$WOC` out, burn sig) for transparency. Config: `BUYBACK_MIN_BATCH_USDC`, `BUYBACK_SLIPPAGE_BPS`.

## C. Client UI
List / set price / cancel on owned characters; a browseable marketplace (price, level, gear preview via the existing armory / player-card render); buy + post-buy claim; a public "‹X› `$WOC` bought back & burned" transparency counter. Explicit USDC-spend + irreversibility disclosures.

## D. Tests
Listing lifecycle (list / cancel / expire); atomic settle splits 70/30 + transfers subdomain; only-owner / offline guards; buyback keeper batches + swaps (mock Jupiter) + burns; escrow-PDA-owned reads as "listed" in ownership resolution. Anchor program (bankrun / litesvm): `list` / `cancel` / `buy` incl. wrong-mint, underpay, expired, double-settle.

## Verification
`anchor test` (program) green; `npx vitest run` green; `tsc` clean. Devnet e2e: list from wallet A (assert subdomain escrowed, character locked) → buy from wallet B hours later (assert 70% USDC → A, 30% → buyback vault, subdomain → B, character + gear claimable by B) → run keeper (assert USDC swapped to `$WOC` and burned); cancel path returns the subdomain to A.

## Risks
Largest single artifact (a real on-chain program); could itself split (program → indexer/orderbook → keeper → UI). **Strongest money-transmission / securities / consumer-protection exposure** of the stack — legal review gates mainnet. Buyback swap is MEV/slippage-exposed (batch + slippage-cap); `$WOC` DEX liquidity must be deep enough or 30% buybacks move price.
