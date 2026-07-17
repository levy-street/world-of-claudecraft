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
- Wallet Standard drives installed-extension selection. Reown AppKit's dedicated
  Solana adapter adds the desktop web WalletConnect QR fallback without custody.
- On iOS and Android web, the picker shows direct Phantom and Solflare options
  instead of the desktop QR. Each uses the wallet's encrypted provider-method
  universal link, so approval happens in the native wallet app and returns to the
  original browser tab. The web desktop QR is a WalletConnect pairing QR:
  scan it with a compatible WalletConnect scanner, not a Solana Pay-only scanner.
  A universal Camera-app QR would require a separate wallet-specific cross-device
  handoff.
- Installed Home Screen web apps do not offer wallet connection. Phantom and
  Solflare return links reopen a browser instead of the isolated Home Screen app.
  Players must open the game in Safari or Chrome until a server-mediated handoff
  is implemented.
- The website Electron build opens a short-lived authorization page from its
  fixed API origin in the player's normal browser instead of showing a
  WalletConnect QR inside Electron. Create, claim, complete, and result requests
  therefore stay off a separately selected realm origin.
  Chrome, Safari, or the chosen default browser can see its installed Solana
  wallet extensions. For a purchase, the renderer sends only the Claudium quote
  reference. The game server resolves the exact economy-service transaction it
  authorized for that account and linked wallet before the browser signs it. The
  browser returns only the result to the desktop app through the registered
  `worldofclaudecraft://wallet-handoff` URL.
- Desktop browser handoff secrets contain 256 bits of entropy, expire after five
  minutes, authorize one completion, are bound to the authenticated account, operation,
  expected wallet, and source IP, and travel in the URL fragment so web-server
  logs and referrers do not receive them. The game session token never leaves the
  desktop app.
- The server issues short-lived sign-to-link challenges, validates the wallet signature, and persists one verified wallet per account in Postgres.
- The browser wallet app can disconnect without removing account verification; unlinking is an explicit account action.
- Website desktop/mobile and the website Electron build support the flow. Steam
  and Capacitor iOS/Android keep it disabled.
- Verified account balance is distinct from an unverified connected-wallet preview.
- Linking is opt-in; the game is fully playable without ever connecting a wallet.

## Constraints (non-negotiable)
- **Cosmetic-only / no pay-to-win** - token utility is appearance, convenience, access, or realm-operation; never power.
- **Non-custodial** - the chain owns assets; `src/sim/` stays pure and deterministic.

## Open questions
- Should the featured external-wallet list change beyond Phantom, Solflare, and
  Backpack?
- Should future account models support many wallets, or keep one verified wallet per account?
- How much wallet rotation and unlink history should be visible to players and operators?

## Out of scope
Custody, arbitrary transactions, staking, and gameplay power remain out of scope.
The only transaction handoff is a server-built Claudium purchase that is already
bound to the linked wallet and existing purchase intent.
