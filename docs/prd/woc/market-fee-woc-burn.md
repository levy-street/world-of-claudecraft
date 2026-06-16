# Feature Stub — Market fee in $WOC + burn

> 🚧 **STATUS: STUB — opening discussion.** This is a *feature stub*, not an implementation. It exists to open a focused discussion thread around the **Market fee in $WOC + burn** `$WOC` flywheel mechanic before any code is written.

| | |
|---|---|
| **Tier** | 1 · Easy sinks |
| **Ease** | 4/5 |
| **Flywheel** | 3 |
| **Sustainability** | Burn |
| **Reg risk** | Low |

## What
Let players pay (or get a discount on) the existing 5% auction-house merchant cut in $WOC, and burn a share of it.

## Why it's a flywheel
Ties real, recurring in-game economic activity directly to $WOC demand and deflation.

## Code hooks
The existing copper fee `MARKET_CUT = 0.05` at `src/sim/sim.ts:4973`.

## Proposed approach (for discussion)
- Server-side: accept $WOC for the cut and route it through the burn / treasury split.
- Offer a discount vs. paying the cut in copper.
- No change to the copper World Market itself — the two coexist.

## Constraints (non-negotiable)
- **Cosmetic-only / no pay-to-win** — token utility is appearance, convenience, access, or realm-operation; never power.
- **Non-custodial** — the chain owns assets; `src/sim/` stays pure (no network / wallet deps).

## Open questions
- Discount size for paying in $WOC?
- What `burn %` of the fee?
- Opt-in, or default when a wallet is linked?

## Out of scope
This PR adds **no implementation** — it is a stub to anchor discussion. Part of the proposed `$WOC` GameFi roadmap.
