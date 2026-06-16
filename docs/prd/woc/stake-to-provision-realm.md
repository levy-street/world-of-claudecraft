# Feature Stub — Stake to provision a realm

> 🚧 **STATUS: STUB — opening discussion.** This is a *feature stub*, not an implementation. It exists to open a focused discussion thread around the **Stake to provision a realm** `$WOC` flywheel mechanic before any code is written.

| | |
|---|---|
| **Tier** | 3 · Realm ownership |
| **Ease** | 2/5 |
| **Flywheel** | 5 |
| **Sustainability** | Sink |
| **Reg risk** | Med |

## What
Stake ~1% of supply to provision your own realm (an isolated, env-parameterized server process on the shared database).

## Why it's a flywheel
Very high flywheel — realm owners recruit and retain players, growing the whole network; staked supply is locked (a sink).

## Code hooks
Realms already exist: `server/realm.ts`, `scripts/dev-realms.mjs`; shared Postgres with a `realm` column.

## Proposed approach (for discussion)
- Lock staked $WOC; provision a realm on a successful stake.
- Unstake → realm decommission flow.
- Owner gets realm config controls (see the realm-customization stub).

## Constraints (non-negotiable)
- **Cosmetic-only / no pay-to-win** — token utility is appearance, convenience, access, or realm-operation; never power.
- **Non-custodial** — the chain owns assets; `src/sim/` stays pure (no network / wallet deps).

## Open questions
- Stake size / lockup terms?
- Provisioning limits / who covers infra cost?
- What happens to a realm if the owner unstakes?

## Out of scope
This PR adds **no implementation** — it is a stub to anchor discussion. Part of the proposed `$WOC` GameFi roadmap.
