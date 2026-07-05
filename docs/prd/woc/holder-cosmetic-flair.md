# Holder cosmetic flair

> **STATUS: IMPLEMENTED in v0.11.** Verified $WOC holders receive cosmetic holder-tier presentation in supported identity surfaces. The feature is display-only and does not affect combat, rewards, progression, or economy power.

| | |
|---|---|
| **Tier** | 1 - Easy sinks |
| **Ease** | 3/5 |
| **Flywheel** | 4 |
| **Sustainability** | Sink |
| **Reg risk** | Low |

## What
Holding at least the configured $WOC thresholds unlocks purely cosmetic holder-tier presentation, such as nameplate and profile flair. Wallet balances are read-only, and the flair grants no power.

## Why it's a flywheel
High flywheel: visible status creates social demand to hold.

## Implemented behavior
- The server reads the verified linked-wallet balance through the $WOC balance cache and derives a holder tier from shared thresholds.
- Holder tier and balance are broadcast as identity metadata for online players.
- The client renders holder-tier badges in supported in-world, inspect, and player-card surfaces.
- Public player-card holder badges use verified linked-wallet balances only, not unverified connected-wallet previews.
- Balance refresh is periodic and read-only; the flair is not a tradeable asset.

## Constraints (non-negotiable)
- **Cosmetic-only / no pay-to-win** - token utility is appearance, convenience, access, or realm-operation; never power.
- **Non-custodial** - the chain owns assets; `src/sim/` stays pure and deterministic.

## Open questions
- Final balance thresholds and tier names?
- How often do we re-verify balance?
- Snapshot-held versus continuously-held eligibility?

## Out of scope
On-chain minting, staking, transfer mechanics, and any gameplay-stat advantage remain out of scope for this feature.
