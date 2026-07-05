# Feature Stub — Realm revenue share

> 🚧 **STATUS: STUB — opening discussion.** This is a *feature stub*, not an implementation. It exists to open a focused discussion thread around the **Realm revenue share** `$WOC` flywheel mechanic before any code is written.

| | |
|---|---|
| **Tier** | 3 · Realm ownership |
| **Ease** | 2/5 |
| **Flywheel** | 5 |
| **Sustainability** | Emission (from revenue) |
| **Reg risk** | High |

## What
Realm owners earn a share of the (cosmetic-sink) revenue generated in their realm, split with the devs. Metered per realm via playtime / activity.

## Why it's a flywheel
The strongest flywheel — a direct incentive to grow your realm — and also the highest-risk.

## Code hooks
Per-realm metering already exists: `play_sessions`, `server/admin_db.ts`.

## Proposed approach (for discussion)
- Meter per-realm cosmetic-sink revenue; pay owners a disclosed share.
- Frame owners as **operators earning fees for work**, not passive investors.

## Constraints (non-negotiable)
- **Cosmetic-only / no pay-to-win** — token utility is appearance, convenience, access, or realm-operation; never power.
- **Non-custodial** — the chain owns assets; `src/sim/` stays pure (no network / wallet deps).

## Regulatory note
**⚠ Securities exposure (Howey).** Revenue-share to token holders can be an investment contract. Scope any share to in-game cosmetic-sink revenue, frame it as operator fees, never market "buy $WOC to earn yield," and get counsel + gate by jurisdiction before any launch. Engineering is the easy part; compliance is the gate.

## Open questions
- Owner / dev split %?
- Which revenue is in-scope (cosmetic-sink only)?
- Jurisdiction / compliance gating?

## Out of scope
This PR adds **no implementation** — it is a stub to anchor discussion. Part of the proposed `$WOC` GameFi roadmap.
