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
| `REALM_AFFILIATE_BPS` | 1500 (15%) | Affiliate commission as bps of a referred realm's revenue (drawn from the operator's share). Capped at 5000. |
| `REFERRAL_BONUS_DAYS` | 30 | Window (days from signup) in which a referred player's earnings are bonused. 0 disables the bonus. |
| `REFERRAL_REFEREE_BPS` | 1000 (10%) | The referred player's XP + gold welcome boost on their own earnings, in bps. |
| `REFERRAL_REFERRER_BPS` | 500 (5%) | The referrer's XP + gold commission on their referred players' earnings, in bps. |

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

## Buying a realm with SOL or USDC

An alternative to staking $WOC (#475). Instead of locking $WOC into the escrow,
a player buys a realm OUTRIGHT with SOL or USDC: they pay the live market value of
the chosen tier's $WOC threshold (priced via Jupiter), and the realm comes online
immediately. A purchase is FINAL and non-refundable: there is no escrow, no stake,
and no timelock, so decommissioning a bought realm just closes it (see Lifecycle).

The payment is split atomically in ONE buyer-signed transaction:
- a treasury share (default 70%) to the treasury address (`REALM_TREASURY`), and
- the remainder (30%) to a buyback vault (`REALM_BUYBACK_VAULT`) that a keeper
  later swaps to $WOC on Jupiter and BURNS (the deflationary half of the deal).

The server holds no settlement key: it prices the tier, pins the exact two legs in
a short-lived quote, and (after the buyer signs and lands the tx) verifies the
finalized split on chain before recording the purchase. The pricing + split math is
`server/realm_price.ts`; the orchestration (`realmBuyInfo` / `prepareBuyQuote` /
`verifyBuyPayment` / `confirmBuyQuote`, gated by `buyConfigured()`) is
`server/realm_buy.ts`; the two tables are `server/realm_buy_db.ts`; the swap+burn
keeper is `server/realm_buyback_keeper.ts`; the native-SOL split reader
(`parseNativePayment`) is `server/solana_rpc.ts`.

### Pricing (reference-scaled, not full-size)

Pricing reads ONE Jupiter ExactIn quote for a fixed REFERENCE $WOC notional
(`REALM_BUY_PRICE_REF_WOC`, default 1000000 $WOC) and scales it linearly to the
tier size. Quoting the whole tier directly would bake in enormous price impact (the
Gold tier is 10% of supply) and quote a price far below fair value, so a liquid
reference trade gives a clean mid-market unit price that the tier is scaled against.
The quote is the only network touch and is briefly cached
(`REALM_BUY_PRICE_CACHE_SECONDS`, default 30). On devnet or an unlisted mint there
is no DEX route, so `priceTierInCurrency` returns null, `GET /api/realms/buy/info`
returns 503, and the buy UI is unavailable: buying is effectively a mainnet feature.

### Routes

| Route | What it does |
|---|---|
| `GET /api/realms/buy/info` | Authed + rate-limited. Returns each tier's $WOC-equivalent and its live SOL + USDC price, the 70/30 split, and the recipient addresses. 503 (`buy_unavailable`) when buying is unconfigured, the supply read fails, or no route exists. A currency with no route yields a null price for that currency only (the UI disables it) without sinking the whole response. |
| `POST /api/realms/buy/quote` | Authed + rate-limited; requires a linked wallet. Validates name + per-account cap + tier + currency, prices the tier at the live market, reserves a `provisioning` realm, and pins the exact `treasuryBase` / `buybackBase` legs the client must pay (both tagged with `memo == quoteId`). The quote is valid for `REALM_BUY_QUOTE_TTL_MINUTES`. |
| `POST /api/realms/buy/confirm` | Authed. Verifies the finalized split payment matches the quote (correct currency, both legs at least the quoted amounts, right memo, fee payer == buyer wallet), then atomically records the purchase, activates the realm, and grants the owner role. |

The per-account cap (`REALM_MAX_PER_ACCOUNT`, default 3) is shared with the stake
path: owned realms plus open quotes of EITHER acquisition path count against it.
Affiliate attribution (`REALM_AFFILIATE_BPS`) works identically to the stake path
(first-touch, never a self-referral, best-effort), see the Affiliate section.

### Configuration

Buying is DISABLED unless both recipient addresses are set and DISTINCT (a single
shared address would let one combined transfer satisfy both legs); `buyConfigured()`
enforces this and the routes 503 until it holds.

| Var | Default | Meaning |
|---|---|---|
| `REALM_TREASURY` | (falls back to `WOC_TREASURY`) | The 70% recipient owner address. Buying is disabled unless this AND the buyback vault are set and distinct. |
| `REALM_BUYBACK_VAULT` | (required, no fallback) | The 30% recipient owner address. Must be set explicitly (the buyback leg never silently falls back to the marketplace `BUYBACK_VAULT`); to share that vault, point this at it deliberately. The buyer's split accrues here regardless of whether the keeper is enabled. |
| `REALM_BUY_TREASURY_BPS` | 7000 (70%) | Treasury share as bps; the buyback leg is the exact remainder (no rounding dust unaccounted for). Clamped to 0 to 10000. |
| `REALM_BUY_QUOTE_TTL_MINUTES` | 10 | How long a buy quote is valid. Short by design: it pins a market price, so it must be long enough to sign + land + finalize, short enough to bound staleness. (Shorter than the 30 min stake quote TTL.) |
| `REALM_BUY_PRICE_REF_WOC` | 1000000 | The reference $WOC notional priced to derive the unit price (human $WOC; clamped 1 to 1e9). |
| `REALM_BUY_PRICE_SLIPPAGE_BPS` | 50 | Slippage hint on the PRICING quote only (not a binding swap); a tolerant value is fine for a market estimate. |
| `REALM_BUY_PRICE_CACHE_SECONDS` | 30 | TTL of the per-currency price cache so a burst of quote requests mostly hits cache. |
| `JUPITER_API` | `https://quote-api.jup.ag/v6` | Jupiter quote API base. Shared with the existing marketplace keeper. |
| `USDC_MINT` | mainnet USDC | The USDC mint priced + accepted (SOL prices against wrapped SOL, paid in native lamports). |

### The realm bond (ongoing skin in the game)

A staker stays a $WOC whale for the realm's life; a buyer who paid cash once would
otherwise have no ongoing exposure. The bond closes that gap: a bought realm's owner
must KEEP HOLDING a $WOC amount (a fraction of the tier threshold) in their linked
wallet. It is a HOLD requirement, not a lock: nothing is escrowed, the $WOC stays
liquid and is verified periodically against the same cached balance reader the
holder-tier badge uses (`server/woc_balance.ts`). Logic lives in `server/realm_bond.ts`.

Enforcement: at quote time the buyer must already hold the bond (else `bond_required`,
HTTP 409). On the lifecycle reconciler's cadence (boot + daily, via
`reconcileRealmLifecycle`), each owner's CURRENT linked wallet is read once and its
bonded realms are walked oldest-first against the CUMULATIVE bond (one wallet cannot
back several realms with one realm's worth of $WOC). A wallet that falls short starts a
grace window; if it recovers the grace clears; if the grace elapses still short, the
realm lapses (closes, freeing the name + the per-account cap slot). A transient RPC
failure is skipped (never lapses a realm); an unlinked wallet counts as fully short.
The operator dashboard (`GET /api/realms/mine`) returns `bondBase` + `bondGraceUntil`
per bought realm so the owner is warned to top up before a lapse.

| Var | Default | Meaning |
|---|---|---|
| `REALM_BOND_BPS` | 1000 (10%) | The bond as bps of the tier's $WOC threshold (the amount a staker would lock). 10% means a buyer holds a tenth of the staker's commitment, scaled to tier. 0 DISABLES bonds entirely (buying carries no ongoing hold). Clamped 0 to 10000. |
| `REALM_BOND_GRACE_DAYS` | 7 | How long an under-bonded wallet has to top back up before the realm lapses. Clamped 0 to 365. |

### The realm-buyback keeper (ships DISABLED)

`server/realm_buyback_keeper.ts` drains the 30% buyback vault on a cadence, swaps
the proceeds to $WOC on Jupiter, and BURNS the $WOC. It reuses the proven
`PayoutKeeper` state machine (durable swap then settle, TWAP chunking,
recover-by-signature crash safety); only the I/O wiring is realm-specific, and it is
the ONLY code that holds the realm vault key (which only ever touches the 30%
buyback slice). It is a no-op unless explicitly enabled.

| Var | Default | Meaning |
|---|---|---|
| `REALM_BUYBACK_VAULT` | (none) | The vault owner address (same as above). Required to enable the keeper. |
| `REALM_BUYBACK_VAULT_SECRET` | (none) | Base58 secret key of the vault. The ONLY hot key in this feature. Boot fails fast if it does not match `REALM_BUYBACK_VAULT`. If unset, NO realm keeper runs. |
| `REALM_BUYBACK_CURRENCIES` | `USDC,SOL` | Which paid currencies this vault buys back (one keeper per currency). Restrict to e.g. `USDC` to sweep only USDC. |
| `REALM_BUYBACK_SOL_RESERVE` | 0.03 (SOL) | Native SOL kept in the vault for fees + rent; only the surplus above this is swept. |
| `REALM_BUYBACK_SOL_THRESHOLD` | 0.05 (SOL) | SOL pool size that triggers a batch immediately. |
| `REALM_BUYBACK_SOL_MIN_BATCH` | 0.02 (SOL) | Fee-aware floor: never swap a SOL batch below this, even past cadence. |
| `REALM_BUYBACK_SOL_TWAP_SPLIT_ABOVE` | 5 (SOL) | SOL pools above this are split into TWAP chunks (price-impact control). |
| `REALM_BUYBACK_SOL_TWAP_CHUNK` | 1 (SOL) | Max SOL per child swap. |

(USDC batches reuse the marketplace `DEFAULT_PAYOUT_POLICY`: threshold 250, min
batch 25, TWAP split above 1000, chunk 250, all in USDC; cadence 6h; slippage
ceiling 1.00%.)

### Operational notes (safety)

- **The keeper ships DISABLED.** If `REALM_BUYBACK_VAULT_SECRET` is unset, no realm
  keeper runs; the buyer's 30% split still accrues to the vault, so nothing is lost
  while it is off, it just is not yet swapped + burned.
- **Use a DEDICATED vault to auto-burn SOL purchases.** If the operator points
  `REALM_BUYBACK_VAULT` at the SAME address as the marketplace `BUYBACK_VAULT`, the
  existing marketplace keeper covers the USDC buyback but NOT SOL (it has no
  native-SOL leg). To auto-burn SOL purchases, set a dedicated `REALM_BUYBACK_VAULT`
  (distinct from `BUYBACK_VAULT`) plus its secret. Do NOT run two keepers against the
  same vault.
- **Source isolation in the shared table.** The realm keeper writes to the shared
  `buyback_batches` table under its own sources (`realm_usdc` / `realm_sol`, one
  keeper per currency) so a SOL batch and a USDC batch never recover each other, and
  it takes a distinct Postgres advisory lock (`0x574f4304`) from the marketplace
  keeper (`0x574f4303`). The two keepers can run concurrently (different vaults,
  source-scoped batches); only sibling realm processes sharing the realm vault are
  serialized, via `withRealmBuybackKeeperLock`.
- **Token-2022 rejected, native SOL via lamport deltas.** USDC verification uses the
  SPL token-delta parser and rejects a Token-2022 look-alike mint (transfer hooks /
  fees would make "sent" != "received"); SOL verification uses native lamport deltas
  (`parseNativePayment`). The payer is bound by fee-payer identity and the RECIPIENT
  legs are what is measured, so a third-party fee payer cannot impersonate the buyer.

### Tables + replay guard

Two additive tables (`server/realm_buy_db.ts`), applied by `db.ts` `ensureSchema`
(via `REALM_BUY_SCHEMA`, after `REALM_SCHEMA` since they reference `realms` +
`accounts`) and checked by `assertRealmSchema` at boot:
- `realm_buy_quotes` is the short-lived authorization (parallel to the stake path's
  `realm_quotes`): it pins the provisioning realm, the currency, the total, the
  70/30 leg amounts, and the recipient addresses. Expired quotes (and their
  abandoned provisioning realms) are reclaimed by `reclaimExpiredBuyProvisioning`
  before each new quote.
- `realm_purchases` is the permanent record, with `pay_tx_sig UNIQUE` as the replay
  guard: a re-confirmed payment hits a 23505, rolls the whole confirm transaction
  back (mapped to 409 `payment_already_recorded`), and consumes the quote.

## Lifecycle + recovery

- A bought realm has no escrowed principal, so `requestRealmDecommission` closes it
  immediately (frees the name + the per-account slot); a staked realm instead enters
  the unstake timelock. The two are distinguished by whether an active stake exists.
- A `provisioning` realm whose buy quote expires unconfirmed is auto-`closed` by
  `reclaimExpiredBuyProvisioning` (run before each new quote), mirroring the stake
  path's `reclaimExpiredProvisioning`.
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

## Affiliate program

Salespeople recruit realm founders with an affiliate link and earn `REALM_AFFILIATE_BPS`
(default 15%) of the revenue their referred realms make.

- Every account self-serves a stable code (`affiliate_codes`, created lazily on
  `GET /api/affiliate/me`); the share link is `<origin>/?aff=<code>`.
- The founder's client captures `?aff=<code>` (persisted in `localStorage` across
  the login hop) and sends it with `POST /api/realms/quote`. `prepareProvisionQuote`
  resolves it and writes `realm_affiliates(realm_id, affiliate_account_id, bps)`:
  first-touch (one affiliate per realm), never a self-referral, best-effort (an
  unknown code attaches no affiliate and never fails founding). The row cascades
  with the realm.
- `GET /api/affiliate/me` + `/api/affiliate/realms` back the affiliate dashboard.
- **Payout is pending #477.** No in-realm revenue flows yet, so nothing pays out.
  When the #477 USDC split lands, it reads `getRealmAffiliate(realmId)` and pays the
  affiliate `bps` of gross **out of the operator's share** (buyer price, $WOC burn,
  and the creator share are unchanged). Affiliates are paid in USDC to their linked
  wallet, on the same rail as the operator payout. To disable the program, set
  `REALM_AFFILIATE_BPS=0`; existing attributions remain but accrue nothing.

## Referral XP + gold bonus (unified with the affiliate link)

The affiliate code is the single referral identity: registering via `?ref=<code>`
(or a legacy card slug) records the relationship in `referrals`, and founding via
`?aff=<code>` records the realm affiliate. On top of the realm 15%, a referred
player's first-30-days earnings are bonused on BOTH sides, minted server-side
(never taken from anyone):

- Referred player: +`REFERRAL_REFEREE_BPS` (10%) on the XP and gold they earn.
- Referrer: +`REFERRAL_REFERRER_BPS` (5%) of those same earnings.

Mechanism (no sim change, RL core untouched): the reconciler reads the referred
character's monotonic `counters.xpGained` + `counters.lootCopper`, and on each
leave bonuses the NEW earnings since a per-character checkpoint (`referral_progress`)
within the window. The referee boost is granted via `sim.grantBonus` (the checkpoint
advances past the granted XP so it is never re-counted); the referrer's cut accrues
to `referral_rewards` (pending + lifetime) and is granted to their live character on
their next login (claim-on-join). Anti-abuse: first-touch + no self-referral, the
30-day window, %-of-REAL-earnings (a fake referee who never plays earns nothing),
and the existing bot detection. Set `REFERRAL_BONUS_DAYS=0` to disable.

## Rollback

The tables are additive (`realms`, `realm_stakes`, `realm_quotes`, plus
`realm_affiliates` and `affiliate_codes`, and the buy path's `realm_buy_quotes` +
`realm_purchases`) and are created via `ensureSchema`. To roll the feature back,
stop issuing quotes (remove the routes / set `REALM_MAX_PER_ACCOUNT=0` is not
supported, so gate at the proxy) and
`DROP TABLE referral_progress, referral_rewards, realm_affiliates, affiliate_codes, realm_buy_quotes, realm_purchases, realm_quotes, realm_stakes, realms CASCADE;`. Existing
on-chain stakes are unaffected and remain owner-recoverable via the program. The
default env realm is re-seeded on the next boot. `assertRealmSchema` fails the
boot fast if a realm table drifts (a required column is missing). To disable buying
without a rollback, unset `REALM_TREASURY` or `REALM_BUYBACK_VAULT` (or set them
equal): `buyConfigured()` goes false and the buy routes 503; existing purchases and
realms are unaffected. To stop the auto burn while leaving buying live, unset
`REALM_BUYBACK_VAULT_SECRET` (the 30% still accrues to the vault for a later sweep).

## Monitoring

Server logs (stderr) to alert on:
- `realm: $WOC supply read failed`: the supply RPC is down; quotes 503.
- `realm: PDA-closed read failed`: the verification RPC is down; releases 409 (retryable).
- `realm: account N tried to decommission realm M it does not own`: authz abuse signal.
- `realm lifecycle: reclaimed X provisioning, finalized Y decommissioning`: the daily reconciler.
- `realm buyback keeper cycle failed:`: a keeper cycle threw (swap/settle/RPC). The
  30% still accrues in the vault and a later cycle retries; persistent failures mean
  the SOL/USDC is not being burned.
- `realm buyback keeper enabled (...)` at boot lists the active currencies; its
  absence means the keeper is unconfigured (no `REALM_BUYBACK_VAULT_SECRET`), so
  purchases accrue but are not auto-burned.
