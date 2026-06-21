# Cosmetic "spin" — burn $WOC for a cosmetic-only roll

> **STATUS: PROPOSAL / DISCUSSION STUB.** Adapts Kintara mechanic #3 (Spinner Wheel: ~$3 in $KINS, 50% burned / 50% treasury, no reward back → pure sink). Depends on [dual-currency-boundary] + [cosmetic-marketplace] spend rail. **Highest sink strength, highest reg risk — discuss carefully.**

| | |
|---|---|
| **Tier** | 2 — Economy |
| **Ease** | 2/5 build / 4/5 legal |
| **Flywheel** | 5 (the actual deflation engine) |
| **Sustainability** | Sink (hard burn) |
| **Reg risk** | **High** (loot-box / gambling) |

## What
The strongest demand mechanic in Kintara: a paid spin that **burns** the token on use. WOC version: the user signs a **burn of a fixed $WOC amount** (SPL burn of their own tokens, or transfer to an incinerator), then receives a **purely cosmetic** randomized reward (skin/dye/emote/flair). Optionally a slice routes to treasury instead of 100% burn. This is the only mechanic here that directly, repeatably destroys supply tied to engagement.

## Why it's a flywheel
Direct buy-and-burn pressure scaling with activity. Unlike the shipped hold-threshold flair (zero burn), every spin permanently removes $WOC from float. This is the mechanic that actually bends the supply curve.

## Proposed behavior
- Fixed-cost spin (USD-pegged in $WOC at live price, like Kintara's ~$3).
- User signs the burn; server reads confirmation; server grants a cosmetic-only reward from a published, **transparent-odds** table.
- Split TBD: 100% burn, or e.g. 50% burn / 50% treasury (Kintara model).
- Rewards are **account-bound cosmetics with no cash/secondary value.**

## Constraints (non-negotiable)
- **Reward pool is cosmetic-only — never power, progression, currency, or anything with resale value.** (This is also the core gambling-law mitigation: no cashable prize → arguably not a regulated lottery, but **needs counsel sign-off per jurisdiction**.)
- **Non-custodial** burn — user signs; we never take funds.
- Published odds; no dark patterns.

## Open questions
- **Legal first:** loot-box / gambling exposure varies wildly by jurisdiction (and is harsher when value is on-chain). Do we need geo-blocking, age gates, "no purchase / not gambling because rewards are non-cashable cosmetics" framing, or to avoid randomized rolls entirely (deterministic burn-for-known-cosmetic instead)?
- 100% burn vs burn/treasury split?
- Pity timer / duplicate protection (UX, not economics)?

## Out of scope
Any non-cosmetic reward, cashable/tradeable prizes, Gold cost, custody of stakes, power/progression payouts.
