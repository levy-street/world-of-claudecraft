# Feature Stub — Transmog skin marketplace

> 🚧 **STATUS: STUB — opening discussion.** This is a *feature stub*, not an implementation. It exists to open a focused discussion thread around the **Transmog skin marketplace** `$WOC` flywheel mechanic before any code is written.

| | |
|---|---|
| **Tier** | 2 · Cosmetic economy |
| **Ease** | 2/5 |
| **Flywheel** | 5 |
| **Sustainability** | Burn |
| **Reg risk** | Med |

## What
$WOC-settled, burn-on-every-trade cosmetic NFT skins (transmog). Appearance changes only — never stats.

## Why it's a flywheel
The flagship sustainable flywheel: a curated cosmetic economy with a burn on every primary and secondary trade.

## Proposed approach (for discussion)
- Phase 1: an appearance layer (`skinOverrides`) with **no chain** — a transmog system that does not exist yet.
- Phase 2: chain settlement (mint / resale) with burn-on-trade.
- Extends the prior cosmetic-skin PRD (PR #336); non-custodial throughout.

## Constraints (non-negotiable)
- **Cosmetic-only / no pay-to-win** — token utility is appearance, convenience, access, or realm-operation; never power.
- **Non-custodial** — the chain owns assets; `src/sim/` stays pure (no network / wallet deps).

## Open questions
- Catalog ownership / curation cadence?
- Royalty-enforcement model (Solana does not enforce at protocol level)?
- Split %s on mint vs. resale?

## Out of scope
This PR adds **no implementation** — it is a stub to anchor discussion. Part of the proposed `$WOC` GameFi roadmap.
