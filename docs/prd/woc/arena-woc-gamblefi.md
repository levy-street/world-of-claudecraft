# Feature Stub — Arena WOC GambleFi (winner-takes-all)

> 🚧 **STATUS: STUB — opening discussion.** This is a *feature stub*, not an implementation. It exists to open a focused discussion thread around the **Arena WOC GambleFi (winner-takes-all)** `$WOC` flywheel mechanic before any code is written.

| | |
|---|---|
| **Tier** | 4 · Competitive & seasons |
| **Ease** | 3/5 |
| **Flywheel** | 4 |
| **Sustainability** | Rake / Burn |
| **Reg risk** | High |

## What
Both players stake $WOC into a head-to-head match pot; the winner takes all, minus a burn-rake.

## Why it's a flywheel
High engagement plus a burn-rake sink — but it is real-money gambling.

## Code hooks
Builds on the existing Elo arena (`src/sim/sim.ts:4414`), which has no payout today.

## Proposed approach (for discussion)
- Escrow both stakes; pay the winner the pot minus a burn-rake.
- Strictly skill-based PvP — never sell power.
- The burn-rake routes through the split.

## Constraints (non-negotiable)
- **Cosmetic-only / no pay-to-win** — token utility is appearance, convenience, access, or realm-operation; never power.
- **Non-custodial** — the chain owns assets; `src/sim/` stays pure (no network / wallet deps).

## Regulatory note
**⚠ Real-money gambling exposure.** Wagering on match outcomes carries licensing / AML / age-gating obligations; skill-based framing varies by region. Gate by jurisdiction and get counsel before enabling wagers.

## Open questions
- Rake / burn %?
- Anti-collusion / smurf protection?
- Jurisdiction gating?

## Out of scope
This PR adds **no implementation** — it is a stub to anchor discussion. Part of the proposed `$WOC` GameFi roadmap.
