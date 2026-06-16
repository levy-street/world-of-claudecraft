# Feature Stub — Premium listing slots

> 🚧 **STATUS: STUB — opening discussion.** This is a *feature stub*, not an implementation. It exists to open a focused discussion thread around the **Premium listing slots** `$WOC` flywheel mechanic before any code is written.

| | |
|---|---|
| **Tier** | 1 · Easy sinks |
| **Ease** | 4/5 |
| **Flywheel** | 2 |
| **Sustainability** | Sink |
| **Reg risk** | Low |

## What
Sell extra or longer auction-house listing slots for $WOC, beyond the free `MARKET_MAX_LISTINGS` cap.

## Why it's a flywheel
Low flywheel — a convenience sink for active traders.

## Code hooks
`MARKET_MAX_LISTINGS` / listing duration in the market system (`src/sim/sim.ts`).

## Proposed approach (for discussion)
- $WOC for +N slots or +duration.
- Route through the burn / treasury split.
- Cap to avoid listing spam.

## Constraints (non-negotiable)
- **Cosmetic-only / no pay-to-win** — token utility is appearance, convenience, access, or realm-operation; never power.
- **Non-custodial** — the chain owns assets; `src/sim/` stays pure (no network / wallet deps).

## Open questions
- How many extra slots / how much extra duration?
- Price curve?

## Out of scope
This PR adds **no implementation** — it is a stub to anchor discussion. Part of the proposed `$WOC` GameFi roadmap.
