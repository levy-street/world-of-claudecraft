# Feature Stub — Price oracle (Pyth)

> 🚧 **STATUS: STUB — opening discussion.** This is a *feature stub*, not an implementation. It exists to open a focused discussion thread around the **Price oracle (Pyth)** `$WOC` flywheel mechanic before any code is written.

| | |
|---|---|
| **Tier** | 0 · Foundations |
| **Ease** | 3/5 |
| **Flywheel** | — |
| **Sustainability** | Infra |
| **Reg risk** | Low |

## What
Use an on-chain price oracle (e.g. Pyth) so prices can be set in a stable reference unit and settled in $WOC at buy-time — avoiding constant manual repricing as the token moves.

## Why it's a flywheel
Stability infrastructure: makes $WOC-denominated prices legible and predictable for players.

## Proposed approach (for discussion)
- Read a Pyth price feed server-side at quote time.
- Stable-unit catalog prices → the $WOC amount due is computed at purchase.
- A staleness / fallback policy is required.

## Constraints (non-negotiable)
- **Cosmetic-only / no pay-to-win** — token utility is appearance, convenience, access, or realm-operation; never power.
- **Non-custodial** — the chain owns assets; `src/sim/` stays pure (no network / wallet deps).

## Open questions
- Which reference unit (USD-equivalent)?
- Which oracle, and what staleness threshold?
- What is the fallback when the feed is stale?

## Out of scope
This PR adds **no implementation** — it is a stub to anchor discussion. Part of the proposed `$WOC` GameFi roadmap.
