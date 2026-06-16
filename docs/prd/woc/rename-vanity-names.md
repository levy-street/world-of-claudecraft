# Feature Stub — Rename + vanity names

> 🚧 **STATUS: STUB — opening discussion.** This is a *feature stub*, not an implementation. It exists to open a focused discussion thread around the **Rename + vanity names** `$WOC` flywheel mechanic before any code is written.

| | |
|---|---|
| **Tier** | 1 · Easy sinks |
| **Ease** | 5/5 |
| **Flywheel** | 2 |
| **Sustainability** | Sink |
| **Reg risk** | Low |

## What
Charge $WOC for character / guild renames and reserved vanity names.

## Why it's a flywheel
Low flywheel — a clean convenience sink; identity is a reliable willingness-to-pay.

## Code hooks
Reuses the existing `force_rename` path (`server/db.ts`).

## Proposed approach (for discussion)
- $WOC-priced rename + a name-reservation registry.
- Route payment through the burn / treasury split.
- Keep the existing name moderation / censorship rules.

## Constraints (non-negotiable)
- **Cosmetic-only / no pay-to-win** — token utility is appearance, convenience, access, or realm-operation; never power.
- **Non-custodial** — the chain owns assets; `src/sim/` stays pure (no network / wallet deps).

## Open questions
- Price points?
- How do we prevent reserved-name squatting?

## Out of scope
This PR adds **no implementation** — it is a stub to anchor discussion. Part of the proposed `$WOC` GameFi roadmap.
