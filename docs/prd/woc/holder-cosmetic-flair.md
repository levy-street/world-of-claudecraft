# Feature Stub — Holder cosmetic flair

> 🚧 **STATUS: STUB — opening discussion.** This is a *feature stub*, not an implementation. It exists to open a focused discussion thread around the **Holder cosmetic flair** `$WOC` flywheel mechanic before any code is written.

| | |
|---|---|
| **Tier** | 1 · Easy sinks |
| **Ease** | 3/5 |
| **Flywheel** | 4 |
| **Sustainability** | Sink |
| **Reg risk** | Low |

## What
Holding ≥ X $WOC unlocks a purely cosmetic nameplate badge / aura (read wallet balance; no power whatsoever).

## Why it's a flywheel
High flywheel — visible flex creates social demand to hold; status is contagious.

## Proposed approach (for discussion)
- Server reads the linked-wallet balance and grants a cosmetic flag.
- Threshold tiers (e.g. bronze / silver / gold) — cosmetic only.
- Re-check balance periodically; the flair is not a tradeable asset.

## Constraints (non-negotiable)
- **Cosmetic-only / no pay-to-win** — token utility is appearance, convenience, access, or realm-operation; never power.
- **Non-custodial** — the chain owns assets; `src/sim/` stays pure (no network / wallet deps).

## Open questions
- Balance thresholds / tiers?
- How often do we re-verify balance?
- Snapshot-held vs. continuously-held?

## Out of scope
This PR adds **no implementation** — it is a stub to anchor discussion. Part of the proposed `$WOC` GameFi roadmap.
