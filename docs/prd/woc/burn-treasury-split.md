# Feature Stub — Burn + treasury split

> 🚧 **STATUS: STUB — opening discussion.** This is a *feature stub*, not an implementation. It exists to open a focused discussion thread around the **Burn + treasury split** `$WOC` flywheel mechanic before any code is written.

| | |
|---|---|
| **Tier** | 0 · Foundations |
| **Ease** | 4/5 |
| **Flywheel** | — |
| **Sustainability** | Burn |
| **Reg risk** | Low |

## What
A single shared accounting path that splits every $WOC sink into a burn% (permanently removed from supply) and a treasury% (funds dev / servers / seasonal rewards / buybacks).

## Why it's a flywheel
The hub every sink plugs into — it is what turns in-game activity into deflation plus funding.

## Proposed approach (for discussion)
- Define `burn% / treasury%` split params (values TBD).
- Route **all** sinks through one server-side helper so accounting is consistent.
- Treasury address is disclosed and on-chain-auditable.

## Constraints (non-negotiable)
- **Cosmetic-only / no pay-to-win** — token utility is appearance, convenience, access, or realm-operation; never power.
- **Non-custodial** — the chain owns assets; `src/sim/` stays pure (no network / wallet deps).

## Open questions
- What are the default `burn%` / `treasury%`?
- Single key or multisig treasury?
- One global split, or per-mechanic overrides?

## Out of scope
This PR adds **no implementation** — it is a stub to anchor discussion. Part of the proposed `$WOC` GameFi roadmap.
