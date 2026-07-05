# Feature Stub — Seasonal leaderboard rewards

> 🚧 **STATUS: STUB — opening discussion.** This is a *feature stub*, not an implementation. It exists to open a focused discussion thread around the **Seasonal leaderboard rewards** `$WOC` flywheel mechanic before any code is written.

| | |
|---|---|
| **Tier** | 4 · Competitive & seasons |
| **Ease** | 3/5 |
| **Flywheel** | 3 |
| **Sustainability** | Emission (treasury) |
| **Reg risk** | Med |

## What
Top arena / lifetime-XP players earn $WOC from a treasury-funded reward pool each season.

## Why it's a flywheel
Moderate flywheel — rewards retention and competition; sustainable only while the treasury is sink-funded, not minted.

## Proposed approach (for discussion)
- Define reward tiers; pay from the treasury (never new emissions).
- The server computes standings from the existing leaderboards.
- Hard-cap rewards to treasury inflows.

## Constraints (non-negotiable)
- **Cosmetic-only / no pay-to-win** — token utility is appearance, convenience, access, or realm-operation; never power.
- **Non-custodial** — the chain owns assets; `src/sim/` stays pure (no network / wallet deps).

## Open questions
- Reward tiers / amounts?
- Which leaderboards count?
- How do we prevent emission-funded inflation?

## Out of scope
This PR adds **no implementation** — it is a stub to anchor discussion. Part of the proposed `$WOC` GameFi roadmap.
