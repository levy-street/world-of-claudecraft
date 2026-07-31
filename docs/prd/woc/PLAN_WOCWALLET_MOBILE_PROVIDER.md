# Plan: Add WOC Wallet as a first-class mobile deep-link provider

Status: **ready for implementation**
Repo: `levy-street/world-of-claudecraft` (this tree)
Depends on: wallet-side responder already shipping in
`levy-street/woc-wallet-chrome-ext` (`src/mobile/`, provider id `wocwallet`,
base URL `https://wocwallet.app/ul/v1`).

---

## 1. Goal

Make **WOC Wallet** appear in the game's mobile Solana wallet picker (iOS web /
Android web) and complete connect / signMessage / signAndSendTransaction via the
same encrypted universal-link protocol already used for Phantom and Solflare.

Why: without this, players on phones can only use third-party wallets. The WOC
Wallet extension and hosted/native shells already implement the wallet half of
the protocol; the game never opens them because `PROVIDERS` and the platform
type union only list phantom/solflare.

## 2. Constraints and dependencies

| Constraint | Detail |
| --- | --- |
| Wire format | Must stay byte-compatible with Phantom-style `nacl.box` (existing client) |
| Response param | `${provider}_encryption_public_key` → `wocwallet_encryption_public_key` |
| Provider id | Stable string `wocwallet` (matches wallet repo `WOC_PROVIDER_ID`) |
| Base URL | `https://wocwallet.app/ul/v1` (wallet hosting / Capacitor UL domain) |
| i18n | Every changed player-visible string must update catalog + locales |
| Brand names | "WOC Wallet", "Phantom", "Solflare" stay as proper nouns in copy |
| Standalone PWA | Home Screen apps still disable wallet connect (unchanged policy) |
| Desktop web | Unchanged: Wallet Standard + Reown (extension already works) |

Dependencies: no new npm packages. Uses existing `tweetnacl` + `bs58`.

## 3. Edge cases

| Case | Behavior |
| --- | --- |
| Injected wallet named "WOC Wallet" on mobile browser | Hide deep-link option for `wocwallet` (same as Phantom in Phantom browser) |
| Hosted wallet domain down | Launch still opens URL; existing timeout rejects after 120s |
| User rejects in WOC Wallet | `errorCode` / redirect error path unchanged |
| Solflare/Phantom param special-case | Remove ternary; use generic `${provider}_encryption_public_key` for all three |
| Stored selection `woc.mobile.wocwallet` | Round-trips through `mobileProviderForId` |

## 4. Architecture / data flow

```
walletConnectionOptionsForPlatform(ios|android)
  → mobileProviders: ['wocwallet', 'phantom', 'solflare']
  → UI lists options (ids woc.mobile.*)
  → createMobileWalletClient('wocwallet')
  → buildConnectRequest → https://wocwallet.app/ul/v1/connect?...
  → OS opens WOC Wallet PWA/app
  → redirect with wocwallet_encryption_public_key + encrypted data
  → decryptConnectResponse('wocwallet', ...)
  → session in localStorage; SIWS proceeds as today
```

## 5. Files to change

1. `src/net/wallet_platform.ts`  -  type union + provider list + injected-name match
2. `src/net/mobile_wallet_deeplink.ts`  -  PROVIDERS entry + generic key param
3. `src/net/wallet.ts`  -  MOBILE_WALLET_IDS/NAMES/ICONS + mobileProviderForId
4. `src/ui/i18n.catalog/index.ts`  -  mobile help copy
5. `src/ui/i18n.locales/*`  -  same for every locale that hardcodes Phantom/Solflare
6. `docs/prd/woc/wallet-link.md`  -  document third provider
7. Tests: `tests/wallet_platform.test.ts`, `tests/mobile_wallet_deeplink.test.ts`

Then `npm run i18n:gen` for generated tables / status.

## 6. Unknowns / risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| `wocwallet.app` not live yet | MEDIUM | Code is correct; ops must deploy wallet host; players get timeout until then |
| Game PR malware / review gates | MEDIUM | Minimal, non-obfuscated diff; brand names only |
| Locale backlog after English reword | LOW | Update all locale files that contain the old English brand list |

## 7. Exit criteria

- Mobile platform options include `wocwallet` first
- Connect URL for wocwallet hits `https://wocwallet.app/ul/v1/connect`
- decryptConnectResponse works with `wocwallet_encryption_public_key`
- Unit tests green for platform + deeplink
- i18n gen clean for changed keys
