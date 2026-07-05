# Feature Stub — Paid respec + loadout slots

> 🚧 **STATUS: STUB — opening discussion.** This is a *feature stub*, not an implementation. It exists to open a focused discussion thread around the **Paid respec + loadout slots** `$WOC` flywheel mechanic before any code is written.

| | |
|---|---|
| **Tier** | 1 · Easy sinks |
| **Ease** | 4/5 |
| **Flywheel** | 2 |
| **Sustainability** | Sink |
| **Reg risk** | Low |

## What
Keep one free talent respec; charge $WOC for an instant respec or extra saved-loadout slots. Convenience, never power.

## Why it's a flywheel
Low flywheel — a convenience sink tied to theorycrafting.

## Code hooks
The existing respec + `SavedLoadout` system (`src/sim/content/talents*`).

## Proposed approach (for discussion)
- $WOC waives the respec cooldown / adds loadout slots.
- No stat advantage — the same talents are available for free.
- Route through the burn / treasury split.

## Constraints (non-negotiable)
- **Cosmetic-only / no pay-to-win** — token utility is appearance, convenience, access, or realm-operation; never power.
- **Non-custodial** — the chain owns assets; `src/sim/` stays pure (no network / wallet deps).

## Open questions
- Free-respec cadence?
- Loadout-slot cap?

## Out of scope
This PR adds **no implementation** — it is a stub to anchor discussion. Part of the proposed `$WOC` GameFi roadmap.
