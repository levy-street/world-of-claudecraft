# Non-custodial wallet link

> **STATUS: IMPLEMENTED in v0.11.** Players can verify a Solana wallet for their account by signing a one-time message. The wallet remains non-custodial, and gameplay remains fully available without verification.

| | |
|---|---|
| **Tier** | 0 - Foundations |
| **Ease** | 3/5 |
| **Flywheel** | Foundation |
| **Sustainability** | Infra |
| **Reg risk** | Low |

## What
Let a player link a Solana wallet to their account by signing a message. The server stores the account-to-wallet mapping and reads on-chain state, such as balances or ownership, read-only. It never takes custody of keys, funds, or assets.

## Why it's a flywheel
Foundational rather than a flywheel itself: every other $WOC mechanic needs a verified wallet link before it can work.

## Implemented behavior
- Reown AppKit drives wallet selection in the browser.
- The server issues short-lived sign-to-link challenges, validates the wallet signature, and persists one verified wallet per account in Postgres.
- The browser wallet app can disconnect without removing account verification; unlinking is an explicit account action.
- Verified account balance is distinct from an unverified connected-wallet preview.
- Linking is opt-in; the game is fully playable without ever connecting a wallet.

## Constraints (non-negotiable)
- **Cosmetic-only / no pay-to-win** - token utility is appearance, convenience, access, or realm-operation; never power.
- **Non-custodial** - the chain owns assets; `src/sim/` stays pure and deterministic.

## Open questions
- Which additional wallet adapters should be enabled beyond the current Reown AppKit Solana flow?
- Should future account models support many wallets, or keep one verified wallet per account?
- How much wallet rotation and unlink history should be visible to players and operators?

## Out of scope
Custody, transactions, token transfers, staking, and gameplay power remain out of scope for this feature.
