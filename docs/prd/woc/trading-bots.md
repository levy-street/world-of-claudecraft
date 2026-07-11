# Rentable SOL/WOC trading bots

> **STATUS: GAME SIDE IMPLEMENTED (service side pending).** The game ships the thin fail-closed proxy (`server/trading_bots.ts`), the Trading Bots window, and the executable fake-service contract tests. The bot engine, vault custody, billing, and all validation land in the economy service (`woc-daily-rewards-service`) behind `/v1/tradingbots/*`, exactly as the Buy $WOC DEX swap was split. Both layers default OFF.

| | |
|---|---|
| **Tier** | 2 - Economy |
| **Ease** | 2/5 |
| **Flywheel** | Recurring $WOC sink + Claudium utility |
| **Sustainability** | Subscription revenue |
| **Reg risk** | High |

## What
Players rent one of a set of automated trading bots by the month, paying with either $WOC or Claudium. A renter deposits a SOL + $WOC pair into a per-player bot vault; the bot then trades that pair on the DEX through the economy service's existing Jupiter integration. The player can pause, tune, and withdraw at any time. The catalog of bots is service configuration; the game client renders it.

## Why it's a flywheel
- A recurring $WOC sink: monthly rentals paid in $WOC ride the same burn/treasury policy as other $WOC spends (policy applied service-side).
- Claudium utility: the premium currency gains a real recurring spend.
- Volume begets liquidity: bot trades are real DEX volume in the $WOC pair, deepening the market every other feature relies on.

## The set of bots (catalog v1)
Stable SKU ids are contract; numbers are service config and can change without a game release. Names and blurbs are localized client-side per id (an unknown id is hidden until a client release adds its strings).

| SKU id | Style | What it does with the vault pair |
|---|---|---|
| `grid` | Grid market maker | Places alternating buy and sell swaps around the mid price at a configured grid spacing and order size, recycling inventory both ways. |
| `dca` | DCA accumulator | Converts SOL into $WOC on a fixed interval, spreading entries over time. |
| `momentum` | Momentum trader | Rotates the pair toward the trending side on configured lookback signals, back to balance on reversal. |

Per SKU the config carries: `priceWocBaseUnits`, `priceClaudium` (monthly), `minDepositSol` / `maxDepositSol` / `minDepositWoc` / `maxDepositWoc` (base-unit digit strings), and a `params` schema (`key`, `min`, `max`, `step`, `default`) the dashboard renders as sliders. v1 param keys: `gridSpacingBps`, `orderSizeBps` (grid), `dcaIntervalMinutes` (dca), `momentumLookbackMinutes` (momentum).

## Player flow
1. **Catalog**: the Bots launcher (bags money footer, next to Buy $WOC) opens the window; the catalog renders the SKUs with monthly prices in both currencies.
2. **Rent**: pick a SKU and a payment currency.
   - `$WOC`: the service returns an unsigned payment transaction; the player's own wallet signs and sends it; the confirm call verifies the signature on-chain and activates the rental.
   - `Claudium`: a single call; the service debits its own Claudium ledger and activates the rental.
3. **Fund**: the player enters SOL and $WOC amounts within the SKU's bounds; the service returns an unsigned deposit transaction into the player's segregated vault; the wallet signs; the confirm call credits the vault.
4. **Run**: the dashboard shows vault balances, bot state, strategy params, recent trades, and a PnL summary; the player can start, pause, and update params.
5. **Withdraw**: pauses the bot and returns the vault balances to the player's linked wallet. Available at any time, subscription active or not.

## Architecture (the split is the contract)
- **Game repo**: `server/trading_bots.ts` is a thin proxy. It holds zero Jupiter, custody, pricing, or validation logic, forwards to the service with the internal secret plus the authenticated player id, and maps service error codes onto the registered `trading_bots.*` family. Token scope: `status` is an authenticated read (read-scoped tokens accepted); the six mutating routes (`subscribe`, `subscribe/confirm`, `deposit`, `deposit/confirm`, `withdraw`, `control`) require a full game session, because a Claudium rental debits the account ledger and `control` starts trading the funded vault with no wallet signature in the loop, and the repo invariant rejects read-scoped companion/OAuth tokens on every mutating route. The client window signs with the player's wallet through the same Wallet Standard seam the DEX swap uses. The game server never signs, never holds keys or funds. `src/sim/` is untouched: bots confer zero gameplay power.
- **Economy service**: owns the catalog, the Claudium ledger, payment verification (UNIQUE tx signature replay guards), the per-player vault, the strategy loop, Jupiter quote/swap execution, billing enforcement (auto-pause at expiry), and rate limits.
- **Fail-closed twice over**: every `/api/tradingbots` endpoint answers a stable 404 unless the game's `WOC_TRADING_BOTS_ENABLED=1` AND the service connection (`ECONOMY_SERVICE_URL` + `WOC_ECONOMY_INTERNAL_SECRET`) is configured; the service keeps its own independent flag. The client hides the launcher whenever the config read fails.

## Custody model
- **v1 (this contract): service-managed vault, custodial within caps.** Each renter gets a segregated per-player vault the service controls, funded only by wallet-signed deposits, bounded by the SKU's hard deposit caps. Withdrawal pays out ONLY to the account's verified linked wallet. The service maintains a global kill switch that pauses all bots and leaves withdraw-only mode on. The UI displays the custody disclosure and the risk note before any deposit; this is deliberately NOT called non-custodial anywhere player-facing.
- **v2 (documented, not built): on-chain program vault.** Funds sit in a per-player PDA vault; the service's bot authority holds a constrained delegate that can only invoke swaps between the two pinned mints via Jupiter; withdrawal is owner-signed only. Moving to v2 changes no game-side wire shapes: the deposit/withdraw endpoints already pass unsigned transactions through.

## Service contract: /v1/tradingbots/*
Transport rules are identical to `/v1/dexswap`: JSON over the internal origin, `x-woc-economy-secret` on every call, `x-woc-player-id` on every authenticated call, amounts are base-unit digit strings, errors are `{ error: <code>, ... }` with the codes below.

| Method | Path | Request | 2xx response |
|---|---|---|---|
| GET | `/v1/tradingbots/config` | none (public read) | `{ enabled, wocMint, wocDecimals, solDecimals, claudiumEnabled, skus: [...] }` |
| GET | `/v1/tradingbots/status` | none | `{ subscription: { skuId, activeUntilMs } or null, claudiumBalance, vault: { sol, woc } or null, bot: { state, params } or null, trades: [{ tsMs, side, inAmount, inMint, outAmount, outMint, signature }], pnl: { periodDays, wocBaseUnits, bps } or null }` |
| POST | `/v1/tradingbots/subscribe` | `{ skuId, payWith, userPublicKey? }` | woc: `{ paymentId, paymentTransaction }`; claudium: `{ subscription }` |
| POST | `/v1/tradingbots/subscribe/confirm` | `{ paymentId, signature }` | `{ subscription }` |
| POST | `/v1/tradingbots/deposit` | `{ solAmount, wocAmount, userPublicKey }` | `{ depositId, depositTransaction }` |
| POST | `/v1/tradingbots/deposit/confirm` | `{ depositId, signature }` | `{ vault }` |
| POST | `/v1/tradingbots/withdraw` | `{ userPublicKey }` | `{ withdrawal: { id, status }, withdrawTransaction? }` |
| POST | `/v1/tradingbots/control` | `{ action, params? }` | `{ bot }` |

Service error code strings (left) map 1:1 onto the game's `trading_bots.*` codes: `disabled`, `unknown_sku`, `invalid_pay_currency`, `already_subscribed`, `subscription_required`, `subscription_expired`, `insufficient_claudium`, `invalid_amount`, `deposit_out_of_bounds`, `invalid_public_key`, `invalid_params`, `payment_not_found`, `payment_unverified`, `vault_busy`, `rate_limited` (with `retryAfterMs`), `upstream_error` (with `upstreamStatus`, `upstreamError`). Unknown codes surface as `upstream_error`, never swallowed.

Hard requirements on the service:
- **Idempotency**: `paymentId` / `depositId` are single-use; the confirm endpoints are idempotent on replay of the same `(id, signature)` pair and reject a signature that does not fund the expected destination for the expected amount. UNIQUE(tx signature) ledger-first, as in the presale/realm_buy pattern.
- **`x-woc-player-id` is an identity key here, not just a rate-limit key.** In the DEX swap contract this header only keys rate limits; in this family it selects whose subscription and vault money moves for, protected solely by the internal secret. The secret MUST be treated as a credential: rotated on any suspicion, never logged, distinct per environment. Withdrawals MUST pay out only to the account's verified linked wallet regardless of any request field.
- **Billing enforcement**: the service auto-pauses the bot at `activeUntilMs`; withdraw stays available forever. No auto-renew in v1.
- **Rate limits**: per-player on every authenticated route; `rate_limited` answers carry `retryAfterMs` for the client cooldown.

## Constraints (non-negotiable)
- **No pay-to-win**: bots touch only on-chain balances; no gameplay system reads any of this state, and `src/sim/` stays pure and deterministic.
- **The game server never signs**: the only signer on the game side is the player's wallet; the only key anywhere is the service's vault authority behind its own flag.
- **Fail-closed both layers**, default OFF; flag-off is byte-identical server behavior except the stable 404s.
- **Honest custody language**: v1 is custodial within caps and the UI says so; the risk note ("automated trading can lose value; rental fees are not refunded") shows before every deposit.

## Open questions
- Withdraw custody shape: unsigned owner transaction (v2-style) versus service-signed payout with a status poll. The proxy and UI support both; the service must pick one before enabling.
- Auto-renew (opt-in) and proration on mid-month withdraw.
- Whether the Claudium balance surfaces anywhere else in the game UI while the Claudium feature branches are unmerged.
- SKU addition process: a new SKU id needs a client release for its localized name/blurb; decide whether config should also carry an English fallback label for operators.

## Out of scope
Strategy quality or profit guarantees, leverage, multiple vaults per account, transferring or reselling rentals, secondary markets on bot output, and any gameplay effect of bot performance.
