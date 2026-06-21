# Cosmetic marketplace settled in $WOC (non-custodial, burn + treasury split)

> **STATUS: PROPOSAL / DISCUSSION STUB.** Adapts Kintara mechanic #2 (marketplace routes the economy through the token; 5% to treasury). Depends on [dual-currency-boundary]. **Scope-expanding: introduces $WOC spend transactions, currently out of scope.**

| | |
|---|---|
| **Tier** | 2 — Economy |
| **Ease** | 2/5 |
| **Flywheel** | 4 (recurring throughput sink) |
| **Sustainability** | Sink + treasury |
| **Reg risk** | Med |

## What
Kintara makes $KINS the reserve currency every player routes through, and skims 5% of marketplace throughput to treasury. We can't copy the gold↔token cash-out (that's the P2E line we ruled out in [dual-currency-boundary]). The compliant version: a **cosmetics-only storefront priced in $WOC**, where settlement is a **user-signed on-chain payment** split between a **burn address** and a **community treasury address**, and the server grants an **account-bound, non-resellable cosmetic** after reading the confirmed tx.

The recurring sink isn't a fee on gameplay — it's the cosmetic spend itself plus the burn slice.

## Why it's a flywheel
Turns cosmetic demand (the holder-flair status loop already shipped in v0.11) into actual $WOC throughput: to *get* the cosmetic you must *spend/burn* $WOC, not merely hold a threshold. Every purchase removes float (burn) and funds the treasury that powers [buyback-burn-engine].

## Proposed behavior
- Storefront lists cosmetic items (skins/dyes/flair/realm themes) priced in $WOC at live price.
- Buyer signs one transaction: e.g. **70% burned, 30% to a published treasury wallet** (split TBD). Non-custodial — we never hold keys or funds.
- Server verifies the on-chain transfer/burn, then grants the cosmetic to the account (off-chain entitlement). Cosmetics are **account-bound and non-transferable** — they have no secondary-market value, so this is a sink, not a securities/exchange surface.
- All burns + treasury inflows are publicly visible (feeds [woc-transparency-and-treasury] / [buyback-burn-engine]).

## Constraints (non-negotiable)
- **Cosmetic-only, account-bound, no resale value, never power.**
- **Non-custodial.** User signs; server reads. `src/sim/` untouched.
- **No Gold involvement** — purchases are $WOC-only, no Gold→$WOC bridge.

## Open questions
- Burn/treasury split ratio? (Kintara: 50/50 spinner, 95/5 marketplace.)
- Direct-to-burn proof vs. a thin verifier service — what's the minimal non-custodial settlement we trust?
- Do we allow player-listed *cosmetic* items (P2P) with a burn fee, or operator-only catalog v1? P2P reintroduces transfer/exchange reg surface.
- Jurisdiction/age gating shared with [cosmetic-spin-burn]?

## Out of scope
Gold trading, $WOC payouts to sellers, resellable/tradeable cosmetics with cash value, staking, custody of user funds.
