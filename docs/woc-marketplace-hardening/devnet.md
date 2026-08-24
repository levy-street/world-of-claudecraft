# Devnet dry-run environment (21)

Torn down with the packet. Durable operator steps graduate to the 22 runbook.
Secrets NEVER appear here: keys live only in gitignored local files (coverage
verified with git check-ignore BEFORE any key was written). Pubkeys and
transaction signatures are safe to record and are the evidence.

## Status 2026-08-20: STAGED, on-chain legs BLOCKED on devnet SOL

Everything below the funding line is ready. The public devnet faucet
rate-limited this IP all day (429 on every request size) and no other funding
source was available in-session (Fernando: cannot fund today), so the mint
creation and every on-chain leg are parked. The resume runbook at the bottom
is the exact continuation.

## The ruled shape (R5, closed 2026-08-20; records in state.md Rulings)

- Mint: a FRESH throwaway devnet SPL mint, decimals 6, created by this
  environment; authority, escrow, treasury, buyer, and seller are fresh local
  keypairs. Nothing durable outlives the run.
- Price: no Birdeye key exists on this machine, so the fixed dev price runs
  over the REAL chain arm (the R5 amendment decoupled
  WOC_MARKET_DEV_USD_PER_TOKEN from the fake-chain gate; service commit
  2eedcfb). The figure is the operator-supplied live spot, 0.0001476 USD per
  WOC (2026-08-20). WOC_MARKET_PRICE_MINT (service commit 7284fbe) remains
  the path for a future keyed run that wants the live venue.

## Roster (devnet pubkeys; keys in the gitignored files named beside each)

| Role | Pubkey | Local key file (service worktree root) |
|---|---|---|
| Mint authority + setup fee payer | HyD4RyRkeHF4EDzdWP1rMo7geNJbvsKb6umo45rzpE3C | devnet-mint-authority-keypair.json |
| Escrow (WOC_MARKET_ESCROW_WALLET) | 2XH5UwqWCCRKLWeCKbHdV6VNsx1nVsrXAydAHkQmUZvr | devnet-escrow-keypair.json |
| Treasury (WOC_MARKET_TREASURY_WALLET) | 9fzukogxcT5c113MA7gNSeP1UMsc3eH27BXbBihWaUqf | devnet-treasury-keypair.json |
| Buyer | DiuB5C4mgoHf8nhBdcFWe2hCxu65mZVpssG2yUE9iN1z | devnet-buyer-keypair.json |
| Seller | Gpg44TKrWnkcVDtqoEwwwbjXB1MjxJ3naoTpZ1zpJz2a | devnet-seller-keypair.json |
| Mint | NOT YET CREATED (blocked on SOL) | pubkey recorded in devnet-mint-record.local.json after creation |

## What is staged

1. Keypairs: the five above, mode 0600, all matched by existing .gitignore
   rules (.env.*, *-keypair.json, *escrow*.json).
2. Service run env: `.env.devnet` in the service worktree root (gitignored).
   Names only: NODE_ENV=development, PORT (8798), DATABASE_URL (the dedicated
   woc_devnet_service database on the game dev Postgres, 127.0.0.1:5433,
   created), WOC_ECONOMY_INTERNAL_SECRET / WOC_ECONOMY_ADMIN_SECRET /
   GIFTCARD_PEPPER (random local values), WOC_ECONOMY_RPC_URL
   (https://api.devnet.solana.com; the Ankr devnet fallback needs its own
   key, so the run is single-RPC: probe-not-resend of a landed transaction
   works with one endpoint, only the crash-replace verdict needs two and that
   leg is out of scope), WOC_MARKET_ENABLED=1, the escrow/treasury wallets,
   WOC_MARKET_ESCROW_JSON (injected from the keypair file, never through a
   terminal), WOC_MINT=FILL_AFTER_MINT_CREATION, WOC_MARKET_PRICE_MINT (the
   mainnet mint, inert while the dev price is set), WOC_DECIMALS=6,
   WOC_MARKET_DEV_USD_PER_TOKEN=0.0001476, and CLAUDIUM_BIRDEYE_API_KEY left
   BLANK (blank reads as absent, so the fixed price stays the one venue).
3. Setup script: `devnet_setup.mjs` beside this file. Idempotent:
   loads-or-creates the keypairs, airdrops or verifies SOL, distributes to
   escrow/buyer/seller, creates the decimals-6 mint once, creates the four
   ATAs, mints 1,000,000 WOC to the buyer. It resolves @solana/web3.js and
   @solana/spl-token by running from inside the service node_modules
   (gitignored): copy it to `service/node_modules/.devnet/setup.mjs` in the
   service worktree and `node` that path. It writes keys only to the
   gitignored service-worktree filenames above and prints pubkeys only.
4. Service tree: build + full suite green at 8db7734 (603 tests, 596 pass,
   0 fail, 7 default-tier pg skips). Four commits: 7284fbe the venue mint
   split, 2eedcfb the dev-price decoupling, 6c1b01f the security fix round
   (confinement, allowlist gate on the override, decode screens, boot
   warns, compose dev-knob walls), 8db7734 the re-review round (widened
   mirror confinement, warns describe only a constructed market, both
   walls pinned). Ten distinct price-source mutants all BIT
   (phase-20-mutation-log.md, the 21 sections).

## Resume runbook (next session, once devnet SOL exists)

1. Fund HyD4RyRkeHF4EDzdWP1rMo7geNJbvsKb6umo45rzpE3C with about 1.5 devnet
   SOL (faucet.solana.com gives 5 with a GitHub login), or retry the
   programmatic faucet after the rate window.
2. Re-run the setup script (idempotent): it distributes SOL, creates the
   mint, ATAs, and buyer supply, and writes devnet-mint-record.local.json.
3. Put the mint pubkey into `.env.devnet` WOC_MINT (replacing
   FILL_AFTER_MINT_CREATION). Do this BEFORE booting: the placeholder now
   fails the chain-mint screen and the market refuses to construct (503 on
   every market path), which is loud but easy to misread as a wiring bug.
   Note the fix round's confinement also means a fixed dev price REFUSES the
   live default mint on the live arm, so an unset WOC_MINT cannot slip
   through either.
4. Boot the service from the service worktree:
   `cd service && set -a && . ../.env.devnet && set +a && npm run build && node dist/service/src/server.js`
   (sourcing THIS dedicated file is fine; the never-source-the-whole-.env
   rule is about the game repo's .env around gate runs). If node_modules was
   reinstalled since setup, re-copy devnet_setup.mjs into
   `service/node_modules/.devnet/` before re-running it.
5. Probe `GET /v1/market/price` with the `x-woc-economy-secret` header set
   to the WOC_ECONOMY_INTERNAL_SECRET value from `.env.devnet`: expect a
   healthy dev-fixed price. The game server uses the SAME env name for its
   copy of the shared secret (server/woc_market_proxy.ts), and
   WOC_MARKET_SERVICE_URL points at http://127.0.0.1:8798.
6. Legs, every signature into the state.md evidence table: the bond cycle
   with BEFORE/AFTER balance reads and second-release no-op asserts
   (probe-not-resend observed in the service log), the game e2e (dev realm,
   npm run db:up + npm run server, ALLOW_DEV_COMMANDS=1 locally only,
   WOC_MARKET_SERVICE_URL + the shared secret pointing at this service;
   list, directed AND public buy-now, pay, burn proven on-chain per the 10
   verifier, deliver in-game, fee split on the real wallets), the hostile
   burn-redirect rejection with the recorded 10 reason, and the carried
   observation items (escrow gate + auth-guard cache under contention, the
   16 lost-lock anti-phase; venue cadence is NOT OBSERVABLE keyless, per the
   R5 amendment record).

## Teardown

Delete the five keypair files, `.env.devnet`, and
`devnet-mint-record.local.json` from the service worktree;
`DROP DATABASE woc_devnet_service` on the dev Postgres; delete this file
with the packet. The devnet mint and any devnet balances are worthless by
construction and need no on-chain cleanup.
