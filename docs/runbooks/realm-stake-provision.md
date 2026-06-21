# Runbook: Realm stake-to-provision (#475)

Operator reference for the $WOC stake-to-provision feature: a player stakes $WOC
into a non-custodial on-chain escrow to found a realm, and recovers it via a
timelocked decommission/release. The on-chain program is `realm_stake_escrow`
(`solana/programs/realm_stake_escrow`); the server logic is `server/realm_provision.ts`
+ the `realm_db`/`realm_stake_db`/`realm_quote_db` persistence; the client lock tx
is `src/net/realm_escrow.ts` + `signAndSendRealmLock` in `src/net/wallet.ts`.

## Configuration (no secrets in the bundle)

Server env (no `VITE_` prefix):

| Var | Default | Meaning |
|---|---|---|
| `WOC_MINT` | mainnet $WOC | The mint staked. Set to the cluster's $WOC (devnet: a test mint). |
| `SOLANA_RPC_URL` | mainnet-beta | Server-side RPC for the supply read + lock/PDA verification. |
| `REALM_ESCROW_PROGRAM_ID` | the deployed id | The escrow program id (see `solana/PROGRAM_ID.txt`). |
| `REALM_MAX_PER_ACCOUNT` | 3 | Live realms + open quotes per account (anti name-squat). |
| `REALM_QUOTE_TTL_MINUTES` | 30 | How long a quote is valid to lock + confirm. |
| `REALM_UNSTAKE_TIMELOCK_SECONDS` | 259200 (72h) | Server-side migration window before a realm can finalize-close. |
| `REALM_TIER_BRONZE_BPS` / `_SILVER_BPS` / `_GOLD_BPS` | 100 / 500 / 1000 | Stake tiers as bps of supply (1% / 5% / 10%). |
| `REALM_SUPPLY_CACHE_SECONDS` | 15 | TTL of the in-process $WOC-supply cache (caps the supply RPC). |

Client env (`VITE_`-prefixed, baked at build time):

| Var | Default | Meaning |
|---|---|---|
| `VITE_REALM_RPC_URL` | mainnet-beta | RPC the browser builds + sends the lock tx against. |
| `VITE_REALM_CHAIN` | `solana:mainnet` | The wallet sign-and-send chain. MUST match `VITE_REALM_RPC_URL`. |

> IMPORTANT: `VITE_REALM_RPC_URL`/`VITE_REALM_CHAIN` default to mainnet so a
> production build never silently targets a testnet. For a devnet test build,
> pass both (e.g. `VITE_REALM_RPC_URL=https://api.devnet.solana.com`,
> `VITE_REALM_CHAIN=solana:devnet`) as Docker build args / CI env. RPC and chain
> must be the same cluster (a blockhash from one is invalid on another).

## Devnet (shared, reusable across worktrees)

`source ~/.config/solana/woc-devnet/env.sh` provides `REALM_ESCROW_PROGRAM_ID`,
`WOC_DEVNET_MINT`, `WOC_DEVNET_RPC`, and the key paths. Program + mint keypairs
persist in `~/.config/solana/woc-devnet/`; the funded deploy/signer wallet is
`~/solana-volume-bot/deployment-wallet.json` (the global `solana config` keypair).
Build/deploy the program with `anchor build --no-idl` then
`solana program deploy solana/target/deploy/realm_stake_escrow.so --program-id <persisted keypair>`.

## Lifecycle + recovery

- A `provisioning` realm whose quote expires unconfirmed is auto-`closed` by the
  reconciler (`reconcileRealmLifecycle`, boot + daily in `main.ts`), freeing the
  name + per-account slot.
- A `decommissioning` realm whose owner already released on chain (PDA closed)
  but never called `POST /api/realms/:id/release` is auto-finalized by the same
  reconciler. The reconciler never force-closes a realm whose stake is still
  escrowed on chain.
- The escrow is non-custodial: a staker can always release their own stake
  on-chain (owner-signed, after the program timelock) even if the DB record is
  closed/abandoned. Funds are never server-custodied.

## Rollback

The three tables are additive (`realms`, `realm_stakes`, `realm_quotes`) and are
created via `ensureSchema`. To roll the feature back, stop issuing quotes
(remove the routes / set `REALM_MAX_PER_ACCOUNT=0` is not supported, so gate at
the proxy) and `DROP TABLE realm_quotes, realm_stakes, realms CASCADE;`. Existing
on-chain stakes are unaffected and remain owner-recoverable via the program. The
default env realm is re-seeded on the next boot. `assertRealmSchema` fails the
boot fast if a realm table drifts (a required column is missing).

## Monitoring

Server logs (stderr) to alert on:
- `realm: $WOC supply read failed` — the supply RPC is down; quotes 503.
- `realm: PDA-closed read failed` — the verification RPC is down; releases 409 (retryable).
- `realm: account N tried to decommission realm M it does not own` — authz abuse signal.
- `realm lifecycle: reclaimed X provisioning, finalized Y decommissioning` — the daily reconciler.
