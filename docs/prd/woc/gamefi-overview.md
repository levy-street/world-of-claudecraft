# $WOC GameFi — overview & status

> **STATUS: CORE IN REVIEW.** The shared economic core is built, tested against a real database, and runs ([PR #799](https://github.com/levy-street/world-of-claudecraft/pull/799), draft). The three player-facing mechanics (#478/#479/#480) and the on-chain escrow are scoped but not yet implemented. **Nothing is live; nothing earns yet.**

| | |
|---|---|
| **Tier** | 4 - GameFi flywheel |
| **Flywheel** | Rake · Burn · Emission |
| **Reg risk** | High (#478/#479 wagering/tournament) · Medium (#480 emission) |
| **Constraints** | Cosmetic-only / no pay-to-win · non-custodial · `src/sim/` stays pure |

## What

Three arena mechanics that let players earn `$WOC`, built on **one shared core** rather than three duplicated implementations. The core's job is to make a single rule true *in software*: **a season can never pay out more `$WOC` than it verifiably took in.**

| | Mechanic | How you earn | Token effect |
|---|---|---|---|
| [#478](https://github.com/levy-street/world-of-claudecraft/pull/478) | **Arena GambleFi** (winner-takes-all) | Stake `$WOC` head-to-head; winner takes the pot minus a burn-rake | **Net-positive** — stakes are peer-to-peer (zero new supply), every match burns a cut, and you must hold `$WOC` to play |
| [#479](https://github.com/levy-street/world-of-claudecraft/pull/479) | **Arena Championship** (seasonal PvP) | Ranked season; entry fees (+ optional treasury) fund a prize pool; champion NFT trophy | **Neutral→deflationary** — prizes are redistributed entry fees minus a burn; any treasury top-up is buyback-sourced and capped below fees |
| [#480](https://github.com/levy-street/world-of-claudecraft/pull/480) | **Seasonal leaderboard rewards** | Top arena / lifetime-XP players earn from a reward pool each season | **Pure emission — hard-capped**: can only pay out what #478/#479 rake (and on-market buybacks) already pulled in |

## The rule, made mechanical (buy pressure > sell pressure)

Every `$WOC` movement is recorded against a season as either a **sink** (a stake, fee, burn, or on-market buyback — demand) or an **emission** (a payout — supply hitting the market). Before any payout, a per-season ledger check **refuses to pay more than was verifiably sunk**, serialized so concurrent payouts can't both spend the same budget. Net supply change per season is therefore structurally **≤ 0** — an unfunded faucet simply pays **~0** instead of inflating.

On top of that, recipient-side anti-dump levers keep winnings from hitting the market in a wave: **hold-to-qualify / hold-to-earn**, **holder multipliers**, **vesting/lockups**, and the **non-liquid NFT trophy** as the headline Championship prize.

## Architecture

- **One shared `gamblefi-core`** ([#799](https://github.com/levy-street/world-of-claudecraft/pull/799)) that #478/#479/#480 stack on: the payment-verification primitives, the flow-ledger invariant, and a **buyback keeper** that turns marketplace/treasury revenue into either a burn or an on-market `$WOC` buy that funds the reward pool.
- **Custody is on-chain and non-custodial:** stakes and prizes live in a Solana **escrow program (PDA)** that releases funds only along program-enforced paths. The server can name a match winner (the game is server-authoritative) but can never redirect, alter, or seize funds. This program is designed and **deferred until #478 begins**; it requires a security audit before any real `$WOC` moves.

## Status at a glance

**Done & in review (the core, #799):** verification primitives · the flow-ledger invariant (proven against a real Postgres, including a concurrent-payout stress test that never over-pays) · the buyback keeper (burn or buy-and-fund). 81 tests green; boots and runs end-to-end against a real database.

**Not built yet:** the three mechanics themselves · the on-chain escrow program · jurisdiction gating / KYC.

## Straight talk

- **Not live, not earning.** #480 pays ~0 until GambleFi/Championship actually generate rake — that's the cap working as designed, not a defect. It will not be described as "buyback-funded" until the revenue is real.
- **High regulatory surface.** Staking (#478) and paid-entry tournaments (#479) are gambling-adjacent in many jurisdictions; they will be jurisdiction-gated and need counsel before launch.
- **One path is unproven outside mainnet:** the keeper's live swap/signing needs a funded devnet/mainnet dry-run before launch. Everything else is tested.

## How to engage

The architecture and the economic guardrail are open for review **now** in [#799](https://github.com/levy-street/world-of-claudecraft/pull/799); per-feature economics are discussed in [#478](https://github.com/levy-street/world-of-claudecraft/pull/478) / [#479](https://github.com/levy-street/world-of-claudecraft/pull/479) / [#480](https://github.com/levy-street/world-of-claudecraft/pull/480). The most useful feedback right now is on the **knobs**: rake/burn percentages, season cadence, hold-to-qualify thresholds, vesting schedules, and which jurisdictions are in scope.
