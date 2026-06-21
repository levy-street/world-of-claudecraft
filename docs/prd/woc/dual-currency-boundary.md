# Dual-currency boundary: Gold faucet ⇄ $WOC reserve

> **STATUS: PROPOSAL / DISCUSSION STUB.** Adapts Kintara mechanic #1 (Gold/$KINS separation). Keystone policy PRD — defines the demarcation the other $WOC-sink proposals build on. Nothing here ships code on its own.

| | |
|---|---|
| **Tier** | 2 — Economy architecture |
| **Ease** | 2/5 (policy + a spend rail) |
| **Flywheel** | Foundation |
| **Sustainability** | Sink (one-way) |
| **Reg risk** | Low–Med |

## What
Kintara's success rests on one decision: the inflationary in-game faucet pays **Gold** (off-chain), and the scarce on-chain token is the **reserve / settlement layer**. Gameplay rewards never dilute the token. We already have Gold (g/s/c). This PRD formalizes the boundary for WOC and — critically — keeps it **one-way** to stay inside our rules.

- **Gold** stays the entire gameplay economy: drops, vendors, trading, progression. Unchanged.
- **$WOC** becomes a **spend-only cosmetic / convenience / realm-operation currency**: you may *burn/spend* $WOC for appearance + access goods.
- **Hard line: Gold is NEVER convertible TO $WOC.** No play-to-earn, no cash-out. The only $WOC flow is *in* (buy/burn for cosmetics), never *out*.

That one-way rule is what separates us from Kintara's P2E loop (which makes gameplay = income) and keeps us clear of pay-to-win and "token as financial reward."

## Why it's a flywheel
Foundational. It gives $WOC a structural job in the economy (the cosmetic/access reserve) without making it a gameplay-power or income asset. Every other sink below plugs into this rail.

## Proposed behavior
- A published policy doc + a single shared `src/sim/`-external spend primitive: "user signs an on-chain $WOC action → server verifies confirmation → grants an off-chain, account-bound cosmetic/convenience entitlement." Non-custodial; `src/sim/` stays pure and never reads token state.
- An allow-list of what MAY be priced in $WOC: cosmetics, appearance, account conveniences (e.g. extra character slots — *if* deemed convenience-not-power), realm-operation (host/name/theme a realm). Everything power/progression/reward stays Gold.

## Constraints (non-negotiable)
- **One-way only.** No Gold→$WOC, no $WOC payouts to players, no cash-out. (This is the anti-P2E guardrail.)
- **Cosmetic / convenience / access / realm-operation only — never power.**
- **Non-custodial.** Server reads chain; user signs. `src/sim/` deterministic and token-agnostic.

## Open questions
- Does "convenience" (extra char slots, cosmetic loadout presets) stay safely inside no-pay-to-win, or is it the thin end of the wedge? Where exactly is the convenience/power line?
- Spend = burn vs spend = treasury vs split? (Resolved per-feature in #2/#3.)
- Do we need jurisdiction/age gating at the spend rail level (shared by #2/#3)?

## Out of scope
Gold→$WOC conversion, player payouts, staking, lending, any gameplay-power purchase. These stay permanently out — they are the line, not a roadmap item.
