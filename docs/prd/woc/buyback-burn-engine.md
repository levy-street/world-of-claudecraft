# Transparent fee-recycling buyback-&-burn engine (no second token)

> **STATUS: PROPOSAL / DISCUSSION STUB.** Adapts Kintara mechanic #7 (KSTR: trading/creator fees auto-buy KINS + buy back KSTR; an agent loops it into in-game gold). **Deliberately drops the second speculative token.** Depends on a controlled $WOC fee stream + [woc-transparency-and-treasury].

| | |
|---|---|
| **Tier** | 3 — Treasury/ops |
| **Ease** | 2/5 build / 4/5 governance |
| **Flywheel** | 5 (reflexive programmatic demand) |
| **Sustainability** | Sink + buy pressure |
| **Reg risk** | **Med–High** (treasury ops / market activity) |

## What
KSTR's insight: route protocol revenue into **automatic, on-chain, transparent $KINS buys** on a loop, so demand scales with activity. We adopt the *engine*, not the *second token* (a KSTR-style token adds a fresh financial instrument + reg surface + splits attention). Instead: an autonomous, **published-wallet, fully auditable** engine that takes $WOC's existing revenue — pump.fun/LP **creator fees** and the **treasury slices from [cosmetic-marketplace] + [cosmetic-spin-burn]** — and programmatically **buys $WOC on the open market and burns it** (and/or funds holder cosmetic airdrops), on a fixed cadence.

## Why it's a flywheel
Converts ecosystem activity into constant, rules-based **buy + burn** pressure — the reflexive layer Kintara gets from KSTR, without launching a token. More marketplace/spin activity → more treasury → more buyback-burn → tighter float.

## Proposed behavior
- A published, single-purpose wallet. Inflows: creator/LP fees + treasury splits. Outflows: market-buy $WOC → burn (and/or fund cosmetic drops).
- **Rules-based and transparent:** fixed cadence, published addresses, every action on-chain and shown on the [woc-transparency-and-treasury] page. No discretionary trading.
- Optionally a public "engine status" readout (last buyback, total burned) — extends the shipped holder-flair/transparency surfaces.

## Constraints (non-negotiable)
- **No second token.** This is plumbing for $WOC, not a new asset.
- **No price/return promises.** Framed as protocol-owned cosmetic-funding + deflation, never as yield, investment, or a guarantee — this is the securities line.
- **Maximum transparency**, published addresses, automated/auditable.
- Cosmetic-only on any reward leg; never funds gameplay power.

## Open questions
- **Governance/custody:** the engine necessarily *holds and moves funds* — who controls keys, and how do we minimize custody (multisig? a published automated program)? This is the hardest rule tension here.
- **Do we even control the $WOC creator-fee stream?** (Ties to the "is the team the token issuer/operator" question — prerequisite for this PR.)
- Buy-and-burn vs. buy-and-fund-cosmetic-drops vs. split — which mix?
- Cadence + per-cycle caps to avoid being front-run / looking like price manipulation?

## Out of scope
A KSTR-style second token, staking, yield products, any discretionary/active trading, promises of price support.
