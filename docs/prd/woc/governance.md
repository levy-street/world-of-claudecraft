# Feature Stub — Off-chain governance

> 🚧 **STATUS: STUB — opening discussion.** This is a *feature stub*, not an implementation. It exists to open a focused discussion thread around the **Off-chain governance** `$WOC` flywheel mechanic before any code is written.

| | |
|---|---|
| **Tier** | 0 · Foundations |
| **Ease** | 4/5 |
| **Flywheel** | 3 |
| **Sustainability** | Infra |
| **Reg risk** | Med |

## What
Off-chain (Snapshot-style) holder voting on content priorities, the cosmetic catalog, and treasury spend.

## Why it's a flywheel
Ownership → engagement: holders who steer the game are more invested and evangelize it.

## Proposed approach (for discussion)
- A Snapshot space keyed to the $WOC mint.
- Advisory votes first; binding scope decided later.
- The server reflects outcomes; no on-chain execution in v1.

## Constraints (non-negotiable)
- **Cosmetic-only / no pay-to-win** — token utility is appearance, convenience, access, or realm-operation; never power.
- **Non-custodial** — the chain owns assets; `src/sim/` stays pure (no network / wallet deps).

## Open questions
- Advisory or binding?
- Quorum / proposal thresholds?
- What is in-scope to vote on vs. dev-reserved?

## Out of scope
This PR adds **no implementation** — it is a stub to anchor discussion. Part of the proposed `$WOC` GameFi roadmap.
