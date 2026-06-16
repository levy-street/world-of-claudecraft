# Feature Stub — Non-custodial wallet link

> 🚧 **STATUS: STUB — opening discussion.** This is a *feature stub*, not an implementation. It exists to open a focused discussion thread around the **Non-custodial wallet link** `$WOC` flywheel mechanic before any code is written.

| | |
|---|---|
| **Tier** | 0 · Foundations |
| **Ease** | 3/5 |
| **Flywheel** | — |
| **Sustainability** | Infra |
| **Reg risk** | Low |

## What
Let a player link a Solana wallet to their account by signing a message — no funds custody. The server stores the account↔wallet mapping and reads on-chain state (balances / ownership) read-only.

## Why it's a flywheel
Foundational rather than a flywheel itself: every other $WOC mechanic needs a verified wallet link before it can work.

## Proposed approach (for discussion)
- Sign-to-link flow in `src/net/` + a server endpoint; persist `account ↔ wallet` in Postgres.
- The server only *reads* chain state — it never holds keys or funds.
- Linking is opt-in; the game is fully playable without ever connecting a wallet.

## Constraints (non-negotiable)
- **Cosmetic-only / no pay-to-win** — token utility is appearance, convenience, access, or realm-operation; never power.
- **Non-custodial** — the chain owns assets; `src/sim/` stays pure (no network / wallet deps).

## Open questions
- Which wallet adapters do we support?
- One wallet per account, or many?
- How do we handle wallet rotation / unlink?

## Out of scope
This PR adds **no implementation** — it is a stub to anchor discussion. Part of the proposed `$WOC` GameFi roadmap.
