# Native Character Marketplace + buyback-burn

> **Status:** DRAFT / implementation plan. Originally PR 3 of the $WOC stack (stacked on `feat/woc-sns-tradeable`, then PR 1, then #473). Flag-gated; no behavior change on `main` by default.
>
> **The on-chain escrow program moved out of this repo (#1497 split).** The `character_market` Anchor program (section A) and its devnet proofs now live in the economy service (`levy-street/woc-daily-rewards-service`, `solana/programs/character_market`), behind the service handler at `service/src/economy/character-market`. The game no longer builds or verifies the program itself: when the client UI (section C) is built, it consumes the typed SDK seam (`@woc/economy-sdk` `economy/character_market`, program id `BE55pNoRLSCch5NmLcU6tg6NZFLe6yFw4Jnr3HfZBMpp`) over the secret-gated internal HTTP the game server already uses, so the Rust toolchain and the on-chain verification path stay in the service. This branch therefore removes the migrated program crate and the `Anchor.toml` that only existed to build it; no player UI is added here (there is none yet to refactor).

## Summary
List a bound character for sale in **USDC** (`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`) at a seller-chosen price. On sale: **70% to the seller, 30% to buying `$WOC` on a DEX and burning it.** Every secondary-market trade becomes deflationary pressure on `$WOC`, capturing gray-market RMT value on-platform. Shares the buyback-burn primitive with stubs #469 / #466.

## A. Listings: off-chain orderbook + trustless on-chain escrow
Long-lived passive listings, OpenSea / Magic-Eden style. A Solana tx is pinned to a recent blockhash that expires in about 60 to 90 seconds, so a naive pre-signed sale is impossible; the listing authorization is **the asset sitting in escrow**, not a pre-signed transaction. Seller is offline at sale time; only the buyer signs at fulfillment.

- **List** `POST /api/market/list` `{ characterId, priceUsdc, expiresAt }`: current owner only; character must be offline, unlisted, and not guild-leader-with-members (or auto-handled on settle). Transfers the character's subdomain into the **marketplace escrow program PDA** (CPI to SNS `transfer`); records `seller, price, expiry, split` on-chain and mirrors to a `market_listings` DB table for discovery/search. **Cancel** anytime before expiry to reclaim. Expiry seller-chosen, hours to months (configurable cap).
- **Buy** `POST /api/market/buy` `{ listingId }`: buyer submits one tx; the program settles **atomically**: subdomain escrow to buyer, **70% USDC to seller, 30% USDC to buyback vault**; emits an event. The SNS-tradeable claim/transfer cleanup then runs (reassign `account_id`, clear stale state). Gear/progress follow the character.
- **Escrow program** (`programs/character-market/`, Anchor): instructions `list`, `cancel`, `buy`; holds the subdomain in a PDA; verifies price/expiry; enforces the 70/30 split; USDC mint pinned. Needs build + **security audit** + devnet to mainnet deploy + upgrade-authority custody. Interacts with SNS-tradeable ownership-resolution: a subdomain owned by the escrow PDA reads as "listed/locked," controlled by the lister until sold/cancelled.

## B. Buyback-and-burn keeper (`server/buyback.ts`, new; follow-up PR)
- The 30% USDC accrues in the buyback vault. A keeper (server job; ideally permissionless) **batches** vault USDC, swaps USDC to `$WOC` via a DEX aggregator (**Jupiter**) with a slippage cap, then SPL-`burn`s the received `$WOC`. Batching limits fees/slippage/MEV vs per-sale swaps. Records each buyback (USDC in, `$WOC` out, burn sig) for transparency. Config: `BUYBACK_MIN_BATCH_USDC`, `BUYBACK_SLIPPAGE_BPS`.

## C. Client UI (follow-up PR)
List / set price / cancel on owned characters; a browseable marketplace (price, level, gear preview via the existing armory / player-card render); buy + post-buy claim; a public "X `$WOC` bought back and burned" transparency counter. Explicit USDC-spend + irreversibility disclosures.

## D. Tests
Listing lifecycle (list / cancel / expire); atomic settle splits 70/30 + transfers subdomain; only-owner / offline guards; buyback keeper batches + swaps (mock Jupiter) + burns; escrow-PDA-owned reads as "listed" in ownership resolution. Anchor program (bankrun / litesvm): `list` / `cancel` / `buy` incl. wrong-mint, underpay, expired, double-settle.

## Verification
`anchor test` (program) green; `npx vitest run` green; `tsc` clean. Devnet e2e: list from wallet A (assert subdomain escrowed, character locked), buy from wallet B hours later (assert 70% USDC to A, 30% to buyback vault, subdomain to B, character + gear claimable by B), run keeper (assert USDC swapped to `$WOC` and burned); cancel path returns the subdomain to A. The program's own devnet exercise (`programs/character-market/tests/devnet.mjs`) proves list / buy (70/30 split asserted) / cancel plus all six error paths against the live devnet deployment; results in `tests/devnet-results.json`, explorer screenshots in `tests/shots/`.

## Risks
Largest single artifact (a real on-chain program); split accordingly (program, then indexer/orderbook, then keeper, then UI). **Strongest money-transmission / securities / consumer-protection exposure** of the stack: legal review gates mainnet. Buyback swap is MEV/slippage-exposed (batch + slippage-cap); `$WOC` DEX liquidity must be deep enough or 30% buybacks move price.
