# Realm Token Launchpad (per-realm SPL Token-2022 currency)

> STATUS: PLAN FOR REVIEW. This is a written implementation plan and product
> spec, not code. It exists so the economics, the architecture, and the
> regulatory posture can be agreed before any of it is built. It extends the
> realm-provisioning economy already shipped on `feature/woc-realm-stake-escrow`
> (#475 stake-to-provision, buy-a-realm, affiliate, buyback keeper) and the
> proposed off-chain governance stub (`feature/woc-governance`).

| | |
|---|---|
| **Tier** | 3 to 4 - Realm ownership + GameFi flywheel |
| **Flywheel** | 5 (realm owners recruit + retain players; locked $WOC stake is a sink; per-realm trading fees feed the revenue split) |
| **Sustainability** | Sink for founding ($WOC locked), facilitator for the per-realm token |
| **Reg risk** | High (a tradeable, optionally power-bearing per-realm token + presale). Mainnet is gated on geo-screening + counsel sign-off. |
| **Constraints** | Non-custodial. `src/sim/` stays pure. Founding stays legacy $WOC. The canonical realm stays cosmetic-only. |

## 1. Goal: what we are building and why

People already fork this codebase to launch their own clone with their own
narrative and their own token. Too many of those launches rug: the dev takes the
liquidity and abandons the game, and players are left holding a worthless token.

We lean into that clone economy instead of fighting it. We turn realm
provisioning into a launchpad that makes the honest path the easy path: a realm
founder can deploy their own token as that realm's in-game currency, but only
through a flow that bakes in the anti-rug commitments a burned audience checks
for (locked liquidity, renounced authorities, vested founder proceeds), with a
prelaunch and community-vote stage so a themed realm has to earn its launch, and
a presale that bootstraps real liquidity in SOL, USDC, or $WOC.

Concretely, the founder, inside the existing provision flow, can choose to:

1. **Register a realm token** as that realm's spending currency (replacing the
   $WOC display currency for that realm only).
2. **Run a community launch vote** so holders decide whether a themed realm
   actually goes live.
3. **Run a presale** that raises SOL / USDC / $WOC into a non-custodial escrow,
   refundable if a soft cap is missed.
4. **Launch the token on a bonding curve** that auto-migrates to an AMM with
   **permanently locked liquidity**, so the founder can never pull the rug.
5. **Earn ongoing trading fees** that flow through the existing per-realm revenue
   split (operator share, global treasury, affiliate cut, $WOC buy-and-burn).

Two more mechanics make the anti-rug story structural, not aspirational:

6. **A share of every realm token funds the Levy Street Fund**, a transparent
   on-chain platform portfolio that holds a slice of every realm's token and is
   shown daos.fun-style: each holding with its amount and live value, and a total
   AUM. The platform's upside is tied to every realm's success, in public view.
7. **A capped founder allocation is locked in immutable vesting** (and the Levy
   Street Fund's own bag is locked on stricter terms), so neither the founder nor
   the platform can dump. The bulk of supply sells through the open curve.

The platform's value proposition to players: "launch your clone here and you
physically cannot rug, and we show the proof on-chain, the founder's tokens are
vesting-locked, and the platform holds the bag right next to you." That is the
product.

## 2. Decisions locked for this plan

These were decided before writing the plan. They are the load-bearing choices.

| # | Decision | Choice | Consequence |
|---|---|---|---|
| D1 | What backs the realm-**founding** stake | **Keep $WOC** | The audited `realm_stake_escrow` program, the `usesToken2022` rejection gate, and the percent-of-supply tier math (`realm_tiers.ts`) are all untouched. The founder token is a separate asset. |
| D2 | Founder token's in-game **utility** | **Realm owner's choice (pay-to-win allowed)** | A new per-realm `monetization_policy` (`cosmetic` default, `power` opt-in). The canonical realm and every realm by default stay cosmetic-only / no-pay-to-win. Power-convertible realms are clearly labeled and gated on legal sign-off + geo-screening. `src/sim/` still never sees a mint (see section 6). |
| D3 | **Launchpad** for the curve + liquidity | **Integrate Meteora DBC + DAMM v2** | We do not write a custody-bearing bonding-curve program. We use `@meteora-ag/dynamic-bonding-curve-sdk` with DAMM v2 graduation + permanent LP lock, behind a thin `Launchpad` interface so Raydium LaunchLab is a drop-in fallback. |
| D4 | **Launch vote** model | **Off-chain tally weighted by verified $WOC held** | Gas-free, ships on the existing wallet-link + `cachedWocBalance` reader, sybil-resistant by capital. Advisory (non-binding). On-chain SPL Governance (Mythic fork) and Civic-gated quadratic are reserved upgrades. |

Two further choices are treated as **non-negotiable defaults** for this plan
(flag them now if either is wrong):

- **Non-custodial presale.** The server never pools contributor funds. It pins a
  quote, the contributor signs one transaction into a program-owned / founder-owned
  escrow, and the server only verifies the finalized transaction. This is the
  bright regulatory line (avoids FinCEN money-services-business + state
  money-transmitter exposure) and matches every existing money path in the repo.
- **Counsel + geo gate before mainnet.** A tradeable per-realm token (and any
  power-convertible realm) is flag-gated and default-off until OFAC / sanctioned-
  country IP screening and counsel sign-off are in place, mirroring the existing
  wager-feature sign-off precedent.

## 3. Constraints and invariants (non-negotiable)

These come from the root, `server/`, `src/sim/`, and `src/ui/` `CLAUDE.md`
files and the existing `$WOC` PRDs. The plan is designed around them.

1. **`src/sim/` stays pure and deterministic.** No DOM / network / wallet / RPC
   imports, no `Math.random` / `Date.now`. The sim must run byte-identically in
   browser, server, and the RL env. Enforced by `tests/architecture.test.ts`.
   The realm token's mint, decimals, RPC, and price never enter the sim. The sim
   only ever holds an opaque numeric balance (today's `copper`).
2. **Server is authoritative; trust nothing from the client.** Every economic
   outcome resolves server-side. New on-chain claims are accepted only after the
   server fetches the finalized transaction and verifies the exact deltas
   (`getFinalizedTx`, `ownerCreditedBase`), the same pattern as `verifyStakeLock`
   / `verifyBuyPayment`.
3. **Non-custodial.** The chain owns assets. The server holds, at most, a keeper
   key over the buyback vault (its existing role) and a *transient* mint keypair
   during token creation (renounced immediately after, see section 6). It never
   holds contributor or stake funds.
4. **SQL only in `*_db.ts`.** Logic modules carry zero raw SQL. New tables get a
   `*_db.ts` DAO; logic talks to an interface so tests use an in-memory fake.
   Every new money table carries a `UNIQUE(tx_sig)` replay guard and is written
   ledger-first, before any grant.
5. **Founding scarcity stays in $WOC.** The stake to provision a realm remains a
   percent of live $WOC supply (bronze 1% / silver 5% / gold 10%). A founder
   minting their own token cannot cheapen a tier, because tiers are never
   measured against the founder token.
6. **Cosmetic-only is the default and the canonical-realm rule.** The default
   `monetization_policy` is `cosmetic`. The canonical Claudemoon realm is always
   `cosmetic`. Power-convertibility is a per-clone opt-in, never the default, and
   never retroactively applied to existing realms.
7. **i18n: every player-visible string is a `t()` key, English at the source.**
   New strings go into a new flat English-only catalog domain spread into
   `src/ui/i18n.catalog/index.ts` (the pattern used by `realmOp`), never into a
   per-locale overlay (which would red-fail `tsc`). Server emits stable English;
   the client re-localizes at the boundary.
8. **The legacy Token-2022 rejection is NOT loosened on the founding path.**
   `usesToken2022` and the escrow's pinned `TOKEN_PROGRAM_ID` stay exactly as-is
   for stake/buy. A new, scoped Token-2022-aware verifier is added *alongside*
   them, used only for founder-token presale/contribution verification.
9. **The flow-ledger buy>sell invariant** (`flow_ledger.ts`) governs any token
   *emission* (rewards). The realm token's presale and trading are not emissions;
   if a realm token later pays rewards, those emissions get their own per-realm
   sink-bounded ledger modeled on `woc_seasons` / `woc_flow_ledger`.

## 4. What already exists that we reuse (do not rebuild)

### 4.1 Codebase (on `feature/woc-realm-stake-escrow` unless noted)

| Existing primitive | File | Reused for |
|---|---|---|
| Realm registry + lifecycle (`provisioning` to `closed`), roles, drift guard | `server/realm_db.ts`, `server/realm.ts` | Add `realm_tokens` registry + per-realm currency identity on the directory. |
| Stake tiers (bps of $WOC supply) | `server/realm_tiers.ts` | Unchanged. Gates which realms may tokenize (only committed, staked realms). |
| Provision orchestration: quote to on-chain verify to activate | `server/realm_provision.ts` | The activation point where a token-launch quote is pinned and the registry row is created. |
| Buy-a-realm quote/verify/confirm, multi-asset, 70/30 split | `server/realm_buy.ts`, `server/realm_buy_db.ts`, `server/realm_price.ts` | Fork into the presale contribution flow (quote to verify split-payment to confirm). |
| Buyback keeper (drains a vault, swaps on Jupiter, burns $WOC) | `server/realm_buyback_keeper.ts`, `server/payout_keeper.ts` | A new source-scoped keeper that claims DBC fees and routes the buyback leg to $WOC burn or LP seed. The terminal step is already pluggable. |
| Affiliate attribution + revenue hook | `server/affiliate_db.ts` (`getRealmAffiliate`) | The presale / fee split pays the affiliate bps out of the operator share. |
| Finalized-tx verify core + native-SOL helpers | `server/solana_tx.ts`, `server/solana_rpc.ts` (+ `wt-ad-marketplace` native-SOL helpers) | The Token-2022-aware contribution verifier. |
| 4-rail (SOL/USDC/WOC/Stripe) pure verifier | `wt-aldrin-club/server/aldrin_club.ts` | Lift the $WOC + optional fiat rails the buy path lacks. |
| Server-built, partial-signed, client-co-signed mint | `world-of-claudecraft/server/subdomain_mint.ts` | The non-custodial mint-creation template for the Token-2022 factory. |
| On-chain $WOC reader (holder tier, cached) | `server/woc_balance.ts` | Vote weight; per-realm-token balance reads. |
| Self-contained host-injected UI panel | `src/ui/realm_operator.ts`, `src/ui/realm_affiliate.ts` | The template for the prelaunch / vote / presale / liquidity panels. |
| REST `Api` class seam + wire reuse | `src/net/online.ts`, `src/net/wallet.ts`, `src/net/realm_buy.ts` | New REST methods + pure instruction builders. |
| In-world soft balance + money display | `src/sim/sim.ts` (`PlayerMeta.copper`, `formatMoney`), `src/world_api.ts` (`IWorld`), `src/ui/hud.ts` (`moneyHtml`), `src/ui/sim_i18n.ts` | Re-skin copper's *display* per realm. The sim stays pure. |

### 4.2 Solana ecosystem (integrate, with versions pinned + re-verified at build)

- **Token-2022** (program `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`):
  `@solana/spl-token` extension builders. We use the **boring metadata-only**
  profile: `getMintLen([MetadataPointer])` to size, `MetadataPointer` to itself,
  `InitializeMint` with `freezeAuthority = null`, `InitializeMetadata`, then
  `setAuthority(MintTokens, null)` to renounce after distribution.
- **Meteora Dynamic Bonding Curve** `@meteora-ag/dynamic-bonding-curve-sdk`
  (v1.5.x at time of writing, re-verify): partner config keyed to our feeClaimer
  PDA, per-realm curve + pool, quote asset SOL or USDC, auto-migrate to **DAMM v2**
  with **permanent LP lock**. Built-in decaying-fee anti-snipe.
- **Meteora Alpha Vault** `@meteora-ag/alpha-vault-sdk` (optional): whitelisted,
  per-wallet-capped, pro-rata-refund presale vault for anti-bot fairness.
- **Jupiter Lock** (`LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn`, audited,
  zero-fee): immutable founder/treasury vesting and any time-locked LP.
- **RugCheck / Birdeye**: scanners buyers actually use. A clean score (mint
  renounced, no freeze, LP locked, no permanent delegate, healthy holder
  distribution) is a launch acceptance test, not a nice-to-have.
- **SPL Governance / Realms (Mythic-Project fork)** and **Civic Pass**: reserved
  for the binding / quadratic vote upgrade. The deprecated `solana-labs`
  spl-governance crate must not be used.

## 5. Architecture and components

The shape: **founding stays $WOC and untouched; the realm token is a separate,
DB-registered, non-custodially-minted asset; the launchpad is an integration, not
a new on-chain program.** Components, each behind an existing seam:

1. **`realm_tokens` registry + `realm_token.ts` resolver.** New table keyed by
   `realm_id`: `mint`, `decimals`, `symbol`, `icon`, `status`
   (`none` | `prelaunch` | `voting` | `presale` | `live` | `graduated` | `closed`),
   `monetization_policy` (`cosmetic` | `power`), `curve_address`, `pool_address`,
   `lp_lock_address`, `fee_claimer_pda`, `launch_tx_sig` (UNIQUE replay guard),
   timestamps. A pure `realmTokenConfig(realmId)` resolver replaces the
   `woc_config` global-mint singleton *for currency display purposes only*
   (never for the founding stake), falling back to $WOC. `assertRealmSchema` is
   extended so a missing column fails at boot. Built first; no chain writes.

2. **Token-2022 mint factory (`server/realm_token_mint.ts`).** Builds one
   create-mint transaction (metadata-only, 9 decimals, freeze null), server
   partial-signs with a transient mint keypair, the founder co-signs and pays
   rent, the server verifies the finalized creation, inserts the registry row,
   and renounces mint authority after the initial distribution. Models
   `subdomain_mint.ts`. Adds `@solana/spl-token` as a dependency to the escrow
   worktree (justified: the alternative is hand-encoding Token-2022 init, which
   is more code and more risk).

3. **Community launch vote (`server/realm_vote.ts` + `realm_vote_db.ts`).**
   Off-chain DB tally weighted by `cachedWocBalance` holder-tier balance,
   one-vote-per-linked-wallet guard, quorum + Yes-threshold from env. A pass
   flips `realm_tokens.status` `voting` to `presale`. The on-chain SPL Governance
   path is left as a documented upgrade seam.

4. **Presale module (`server/realm_presale.ts` + `realm_presale_db.ts`).** Forks
   the `realm_buy` quote/verify/confirm split-payment machinery. Accepts SOL /
   USDC / $WOC (and optional Stripe fiat via the Aldrin rail). Per-contribution
   `UNIQUE(tx_sig)`, per-contributor cap, total-raise cap, soft cap with a refund
   path. Optionally fronted by Meteora Alpha Vault with the whitelist set to the
   realm's stakers / voters. Non-custodial: contributions land in a program- or
   founder-owned escrow; on soft cap met, proceeds atomically seed the curve / LP;
   on miss, the refund path runs.

5. **Meteora DBC launch service (`server/realm_launchpad.ts`).** A thin
   `Launchpad` interface (so Raydium LaunchLab is a drop-in fallback) wrapping the
   DBC SDK: one shared partner config with `feeClaimer` set to a realm-escrow
   **PDA** (not an EOA), per-realm pool + curve with the realm's quote asset and
   migration threshold read live from on-chain config (never hardcoded), and
   auto-migration to DAMM v2 with permanent LP lock. Mainnet-only liquidity;
   devnet uses a fixed-rate stub host.

6. **Per-realm fee / LP keeper.** A new `source`-scoped `PayoutKeeper`
   (`realm_token_<id>`) sharing the buyback advisory-lock discipline: drains the
   presale / treasury vault, routes the buyback leg to either $WOC buy-and-burn
   (deflation) or LP seed (the stated liquidity goal) via the pluggable terminal
   step, and claims DBC partner trading fees into the per-realm revenue split with
   the `getRealmAffiliate` cut applied.

7. **In-realm currency re-skin (cosmetic identity only).** `IWorld` gains a
   currency-identity field (symbol / icon) resolved server- and UI-side; `hud.ts`
   `moneyHtml` re-skins copper's *display*; `sim_i18n.ts` learns the new symbol.
   The sim keeps an opaque numeric balance and stable string keys. No mint /
   decimals / RPC enters `src/sim/`.

8. **Scoped Token-2022-aware verifier.** A new verifier function used only for
   founder-token presale / contribution verification, handling Token-2022 delta
   math (and transfer-fee accounting if ever enabled). The existing
   `usesToken2022` gate on stake / buy stays intact and hard-rejecting.

9. **Allocation + lock enforcement (`server/realm_token_alloc.ts`).** At launch
   the mint factory distributes the fixed supply per the allocation table
   (section 7): the public/curve share to the bonding curve, the liquidity share
   to the LP, and the founder / Levy Street Fund / realm-treasury shares into
   **immutable Jupiter Lock** vesting contracts (`cancelableBySender = false`,
   `cancelableByRecipient = false`). A realm token does not list (status does not
   reach `live`) until the founder lock, the levy lock, and the LP lock are all
   on-chain and verifiable. Pure split math is unit-tested; the lock addresses are
   persisted on `realm_tokens` for the dashboard's proof links.

10. **Levy Street Fund (`server/levy_fund.ts` + `levy_fund_db.ts`).** A single
    platform-owned **treasury wallet (PDA)** that receives the levy allocation of
    every realm token. A valuation keeper reads its on-chain holdings and prices
    each one (section "Levy Street Fund" below), caching a holdings snapshot for a
    public, daos.fun-style portfolio dashboard. It is a **display-only treasury,
    not a tradeable fund**: it never mints a fund-share token and offers no
    pro-rata redemption (the line that would create securities / Investment
    Company Act exposure). Its own bag is Jupiter-Lock vested on the strictest
    schedule, under a published no-sell / governance-gated-disposal policy.

11. **Portfolio valuation pipeline (`server/token_valuation.ts`).** A tiered,
    liquidity-aware mark per mint: pre-graduation, price from the Meteora DBC
    pool's `sqrtPrice` (and a size-aware `swapQuote` against the held balance);
    post-graduation, Jupiter Price API v3 (batched 50 mints/call) cross-checked
    against Birdeye / DEX Screener, with a SOL/USD reference from Pyth. Illiquid
    or null-priced holdings are marked as such and excluded from AUM (never
    zeroed). Reused by the Levy Street Fund dashboard and any token-balance
    display.

12. **UI panels** (host-injected, `realm_operator.ts` template): a prelaunch /
    token-status page, a vote panel, a presale-contribute panel, a read-mostly
    liquidity / lock-proof dashboard that links every commitment to Solscan, and
    the public Levy Street Fund portfolio page.

### Data flows

- **Founding (unchanged):** founder locks $WOC into the `realm_stake_escrow` PDA
  (legacy SPL); `verifyStakeLock` asserts the exact vault delta, payer-binding,
  and NOT Token-2022; `recordProvisionedStake` flips the realm `active`. The
  founder token is not involved; scarcity stays in $WOC.
- **Token registration:** active realm to founder requests a token to mint
  factory builds the Token-2022 create-mint tx to founder co-signs + pays rent to
  server verifies finalized creation to `realm_tokens` row (`status=prelaunch`,
  `launch_tx_sig` UNIQUE) to mint authority renounced post-distribution.
- **Launch vote:** client reads `GET /api/realms/{id}/token/vote` to `POST` vote
  with linked wallet to server reads `cachedWocBalance` for weight, records the
  tally with the per-wallet guard to on quorum + threshold, status `voting` to
  `presale`.
- **Presale:** client `POST .../presale/quote` to server pins legs + recipients +
  `memo == quoteId` + TTL to wallet signs one split tx (SOL/USDC/$WOC) to `POST
  .../presale/confirm` with the sig to server verifies recipient-leg credits +
  fee-payer + memo, inserts the contribution with `UNIQUE(tx_sig)` to on soft cap
  met, seed the curve / Alpha Vault; on miss, refund.
- **Allocation + locks at launch:** mint factory mints the fixed supply to the
  public/curve share to the bonding curve, the liquidity share to the LP, and the
  founder / Levy Street Fund / realm-treasury shares each into an immutable
  Jupiter Lock vesting contract to lock addresses persisted on `realm_tokens` to
  the token can reach `live` only once founder + levy + LP locks are all on-chain.
- **Bonding curve + graduation:** traders buy against the Meteora DBC pool (quote
  SOL/USDC) to at the migration threshold the SDK auto-migrates to DAMM v2 to LP
  permanently locked / burned to status `presale` to `live` to `graduated`,
  pool + lock addresses persisted.
- **Fee flow:** DBC `feeClaimer` PDA accrues trading fees to per-realm keeper
  claims to split to operator / global treasury / $WOC buy-and-burn per bps (with
  affiliate cut) to recorded in the revenue-share ledger.
- **Levy Street Fund accrual + valuation:** the levy allocation of each realm
  token lands in (or vests into) the Levy Street Fund PDA to a valuation keeper
  enumerates the PDA's token accounts, prices each (DBC `sqrtPrice` pre-grad;
  Jupiter v3 cross-checked post-grad; Pyth SOL/USD) to caches a holdings snapshot
  (per-token amount, price, value, weight; total AUM in SOL + USD) to served to
  the public portfolio dashboard. No fund-share token is ever minted.
- **In-world display:** server resolves `realmTokenConfig(realmId)` for symbol /
  icon (cross-process via `realm_tokens`) to surfaced on `IWorld` to `hud.ts`
  re-skins copper's display. The sim never sees the mint.
- **Teardown:** realm decommission / lapse to `realm_tokens` marked `closed`.
  Permanently-locked LP and the renounced mint remain on-chain (irreversible by
  design); fee-claim rights resolve per ownership; there is no server custody to
  unwind.

## 6. The pay-to-win decision, made safe (D2)

The founder may make their realm power-convertible. This is the most
consequential deviation from the existing cosmetic-only invariant, so it is
contained, not blanket-enabled.

**How the sim stays pure even when a realm is pay-to-win.** The in-sim soft
balance (`copper`) already buys power-bearing gear, and that is not pay-to-win
*because copper is earned in-game, not bought with money*. The line is crossed
only when real money buys the soft balance or power directly. So:

- **`cosmetic` realm (default, and always the canonical realm):** the founder
  token buys only appearance / convenience / access / realm-operation SKUs. It
  can never be converted into `copper` or buy a power-bearing SKU. The existing
  no-pay-to-win invariant holds unchanged.
- **`power` realm (founder opt-in):** the server may, after verifying an on-chain
  token transfer / burn and checking the realm's `monetization_policy`, credit
  `copper` to the player (or unlock a power SKU). The sim still only sees `copper`
  credited through its normal API; it has no idea the source was a token. No mint,
  decimals, RPC, or price ever crosses into `src/sim/`, so
  `tests/architecture.test.ts` stays green and determinism is preserved.

**Guardrails on `power` realms:**

- Off by default; set only at provision time or by an explicit, logged owner
  action; never retroactive to existing characters' earned balances.
- The realm-list and the realm's prelaunch page **label it "pay-to-win"** plainly
  (a `t()` string), so players opt in knowingly.
- Power-convertibility is flag-gated and default-off platform-wide until counsel
  sign-off + geo-screening (section 10). A token that buys gameplay advantage sits
  in the same high-reg-risk band as the wager features and the SNS-tradeable
  characters work, and inherits the same gate.
- The canonical economy and cross-realm play are unaffected: characters and
  currency are already realm-scoped, so a `power` realm's inflation is contained
  to that realm.

## 7. Economic model and fairness (the core ask)

"The economics need to be fair" because the audience has been rugged. Fairness
here is a stack of independently verifiable on-chain commitments, each surfaced
on the liquidity dashboard with a Solscan link, not a slogan.

1. **Liquidity is locked, provably.** Graduation migrates to DAMM v2 with
   **permanent LP lock** (liquidity can never be withdrawn); the founder keeps
   only the claimable fee stream. This is the single strongest anti-rug signal.
2. **Authorities are renounced.** Mint authority is renounced after the initial
   distribution; freeze authority is never set; no permanent delegate, no transfer
   hook, no pausable. The token scores clean on RugCheck / Birdeye by
   construction.
3. **Founder proceeds vest.** The founder's allocation and any presale carry vest
   through **Jupiter Lock** with `cancelableBySender = false` and
   `cancelableByRecipient = false` (immutable), so the dev cannot dump on day one.
4. **Pre-allocation is transparent and locked, not hidden.** This is a
   *structured* fair launch, not a zero-allocation pump.fun launch: a founder
   allocation, a liquidity allocation, a Levy Street Fund allocation, and a realm
   treasury allocation all exist, and the legitimacy comes entirely from the fact
   that **every non-public bucket is locked on-chain on an immutable schedule the
   buyer can read on Solscan / RugCheck.** The 2026 market bar is comprehensive
   coverage: all non-circulating supply provably locked. The bulk of supply still
   sells through the open curve at the same price for everyone.
5. **Anti-snipe at launch.** The DBC decaying-fee schedule (and optionally the
   Alpha Vault whitelist gated to stakers / voters) means early-block bots pay
   punitive fees and real participants get a fair entry.
6. **Soft-cap refund.** A presale that misses its soft cap refunds contributors
   (pro-rata if Alpha Vault). Funds are non-custodial throughout.
7. **Only committed realms tokenize.** A realm must already hold the staked $WOC
   to provision (bronze 1% of supply minimum); thin throwaway realms cannot spin
   up tokens. This gates per-mint proliferation and ties the founder's own capital
   to the launch.
8. **Revenue split is bounded and on-chain-sourced.** Trading fees split by
   configured bps across operator / global treasury / affiliate / $WOC buy-and-burn.
   The $WOC buy-and-burn leg ties every realm token's success back to $WOC demand.
   If a realm token ever pays *rewards*, those emissions get a per-realm
   sink-bounded flow ledger so it can never pay out more than it verifiably took
   in (the existing `flow_ledger` invariant, per realm).
9. **The platform holds the bag in public, and cannot dump it either.** The Levy
   Street Fund's allocation of each realm token is locked on the *strictest*
   schedule on the cap table and governed by a published no-sell / disposal
   policy, so the platform's own bag is not an overhang waiting to drop. Its
   holdings are displayed live (see the Levy Street Fund section), aligning the
   platform with every realm and proving it is not quietly selling.

### Default allocation (env-tunable, counsel-reviewed before mainnet)

A fixed supply (no live mint authority after launch), split so the bulk sells
through the open curve and every non-public bucket is immutably locked. These are
the starting knobs, grounded in 2026 structured-fair-launch norms (public/curve
30 to 50%+, liquidity 5 to 10%, team 10 to 20%, treasury 20 to 30%); tune per
realm within hard caps.

| Bucket | Default | Hard cap | Destination + lock |
|---|---|---|---|
| Public / bonding curve | 60% | n/a | Sold on the Meteora DBC curve at one price for everyone. Circulating. |
| Liquidity | 10% | n/a | Paired into the DAMM v2 pool at graduation, LP **permanently locked / burned**. |
| Founder | 12% | 15% | Immutable Jupiter Lock: **12-month cliff + 36-month linear** (`cancelableBySender = false`, `cancelableByRecipient = false`, `transferableBySender = false`). |
| Levy Street Fund | 8% | 10% | Platform PDA, immutable Jupiter Lock on the **longest** schedule (12-month cliff + 48-month linear); no-sell / governance-gated disposal. |
| Realm treasury | 10% | 15% | Realm operations (events, rewards, customization budget); vested or governance-gated, never instantly liquid. |

Rationale: the founder bucket is **capped at 15%** because a higher insider
allocation reads as rug-risk to the 2026 market regardless of vesting; credibility
comes from the lock, not the size. At launch roughly **40% of supply is locked or
LP-locked** (liquidity + founder + levy + treasury), which is the "large share
locked so they cannot rug" property, while 60% floats on the open curve. A realm
token may **not** list (`status` may not reach `live`) until the founder lock, the
levy lock, and the LP lock are all on-chain and linkable to RugCheck / Solscan.
The Levy Street Fund cut may optionally be supplemented by a small ongoing slice of
trading fees, but its *primary* form is this token allocation, so the fund holds
the actual realm tokens (the daos.fun-style portfolio of holdings).

## 8. The Levy Street Fund (platform portfolio)

A set share of every realm token (default 8%, see the allocation table) accrues
to the **Levy Street Fund**: a single platform-owned treasury wallet (a PDA) that
ends up holding a slice of every token launched on the platform, displayed
daos.fun-style as a live portfolio of holdings with each token's amount and value.
It aligns the platform with every realm's success and puts that alignment on a
public page.

**The one deliberate divergence from daos.fun: it is display-only, not a tradeable
fund.** daos.fun also mints a fund-share token with pro-rata redemption of the
underlying basket. We do **not**. The Levy Street Fund mints no share token, sells
no claim on the portfolio, and offers no redemption. It is a transparent treasury
whose holdings we *show*, nothing more. That distinction is the line that keeps the
platform out of investment-company / pooled-investment-vehicle territory; crossing
it (a tradeable claim on a managed basket of tokens) is the single largest
securities risk in this whole design and is explicitly out of scope (section 14).

**The platform cannot dump it either.** The fund's allocation of each realm token
is locked in an immutable Jupiter Lock on the **longest schedule on the cap table**
(12-month cliff + 48-month linear), and disposal is governed by a published policy:
no market-selling the bag; any disposal (buy-and-burn, OTC, or LP provisioning)
must pass a public, logged governance step. So the fund is not a hidden overhang
waiting to drop on holders; it is a long-term, transparent, locked holder beside
them. This directly answers the obvious objection that "a platform sitting on a big
bag of every token is itself a rug vector."

**Valuation pipeline (`server/token_valuation.ts`).** A holding's value = balance x
price; the price source is tiered by the token's liquidity state, because no single
feed covers the lifecycle:

- **Pre-graduation (on the DBC curve, no DEX route yet):** read the Meteora DBC
  pool's `sqrtPrice` and convert (`price = (sqrtPrice / 2^64)^2 x 10^(baseDec -
  quoteDec)`), and publish a **size-aware** mark via `client.state.swapQuote`
  against the fund's actual balance (realized quote-out, not instantaneous spot),
  so a thin curve cannot inflate the mark.
- **Post-graduation (a real route exists):** Jupiter Price API v3
  (`https://lite-api.jup.ag/price/v3?ids=`, batched 50 mints per call) as the
  primary USD source, cross-checked against Birdeye and DEX Screener; if they
  diverge beyond a threshold or pool liquidity is below a floor, mark the token
  illiquid rather than trusting the spot.
- **SOL/USD reference:** one Pyth Hermes pull per refresh, carrying a confidence
  band; flag holdings when the band is wide or the feed is stale.
- **Token-2022 specifics:** read decimals from the mint under the Token-2022
  program; if a transfer fee is ever enabled, value the net realizable amount.
- **Anti-manipulation + honesty:** value each holding off a short rolling median
  (or liquidity-weighted price), clamp single-refresh AUM jumps pending
  confirmation, and **exclude** null-priced / illiquid holdings from the AUM total
  rather than zeroing them (the bug daos.fun clones repeatedly ship). The fund's
  AUM / NAV is the only headline number; because the fund has no share token, there
  is no market price to confuse it with.

**Data + cadence.** A valuation keeper enumerates the PDA's token accounts
(`getParsedTokenAccountsByOwner` under the Token-2022 program, or a DAS read for
metadata), prices them on the tiered pipeline, and writes a `levy_fund_holdings`
snapshot (per-token amount, price USD + SOL, value, weight, source tag, confidence,
illiquid flag; plus the AUM totals) on a cache cadence of roughly 15 to 60 seconds.
The public dashboard reads the snapshot, never the chain directly, so it is fast and
rate-limit-safe. SQL lives in `levy_fund_db.ts`.

## 9. UI: prelaunch, voting, presale, liquidity

All panels are self-contained modules injected by `main.ts` into hidden
auth-screen panels (the `realm_operator.ts` template), with REST methods on the
`Api` class and a new English-only `i18n.catalog` domain (`launchpad`).

- **Prelaunch / token-status page.** Per realm: token identity (symbol / icon),
  current `status`, the `monetization_policy` label (with the pay-to-win banner
  when applicable), and the founder's launch checklist (register to vote to
  presale to launch).
- **Vote panel.** Shows the question ("should this themed realm launch?"), the
  weighted tally, quorum / threshold progress, and the connected wallet's weight.
  One vote per linked wallet. Read of `cachedWocBalance` drives weight.
- **Presale-contribute panel.** Asset selector (SOL / USDC / $WOC; Stripe if
  enabled), live raise progress vs soft / hard cap, per-wallet cap remaining, the
  quote to sign, and the refund terms. The sign flow reuses `src/net/wallet.ts`
  and a pure builder modeled on `src/net/realm_buy.ts`.
- **Liquidity / lock-proof dashboard.** Read-mostly: pool address, LP-lock proof,
  renounced-authority proof, founder + levy vesting schedules, and the live
  RugCheck-style checklist, each a Solscan link. This is the trust surface that
  differentiates us from the rugs.
- **Levy Street Fund portfolio page (public).** The daos.fun-style holdings view,
  reading the `levy_fund_holdings` snapshot: a header with total AUM in SOL and
  USD (and 24h change), then one row per holding showing {realm + token logo,
  symbol, amount, price in USD and SOL, value, percent of portfolio}, sortable by
  value, with illiquid holdings flagged and a per-row source / confidence tag. No
  buy / sell / redeem controls (it is display-only). Each holding links to its
  realm and to Solscan; the fund's own lock and no-sell policy are linked at the
  top so the page doubles as proof the platform is not dumping.
- **Realm-list integration.** `mergeRealmDirectory` surfaces each realm's currency
  identity and (when `power`) the pay-to-win label, so players see it before they
  pick a realm.

Wire / i18n discipline: new client/server messages are REST (not WS) following
the `quote` / `confirm` shape; all new strings are English-only catalog entries;
server emits stable English mapped to `t()` keys client-side; the S3 localization
guard stays green.

## 10. Regulatory posture

We are a **non-custodial facilitator**, and we reduce rugs structurally rather
than just enabling launches. The plan, not legal advice; counsel sign-off is a
gate.

- **Non-custodial throughout.** Verify-only; no server-pooled contributor funds.
  This is the load-bearing fact for avoiding money-services-business / money-
  transmitter classification.
- **Structural anti-rug as a launch precondition** (section 7): locked LP,
  renounced authorities, immutable founder vesting are required, not optional.
- **Securities exposure.** A tradeable token with utility / revenue-share can be
  an investment contract; a power-convertible token raises the bar further.
  Mitigations: avoid managerial-effort / profit-promise language in all copy,
  position as a game currency, keep the facilitator (not issuer, not curator)
  posture, and gate `power` realms behind explicit sign-off.
- **Levy Street Fund posture (the highest-risk surface).** A platform that
  accumulates and *displays* a portfolio of tokens it helped launch must not also
  sell a claim on that portfolio. The fund is therefore display-only: no
  fund-share token, no redemption (section 8). This keeps it a transparent
  treasury rather than a pooled investment vehicle. A written counsel memo on
  Investment Company Act status and on what statements are safe on the portfolio
  page is a precondition to enabling the page on mainnet.
- **Geo / sanctions gating.** OFAC SDN screening plus IP geolocation excluding
  sanctioned countries and any in-scope-restricted retail jurisdiction; never
  tolerate VPN circumvention by design. Applied as middleware on the vote /
  presale / claim routes.
- **Mainnet gate.** Tradeable tokens and `power` realms are flag-gated, default-
  off, until geo-screening + counsel sign-off, the same gate the wager features
  sit behind.

## 11. Phased delivery (each phase shippable)

| Phase | Deliverable | Depends on | Acceptance check |
|---|---|---|---|
| **0. Registry + identity** | `realm_tokens` table + `assertRealmSchema` extension + pure `realmTokenConfig(realmId)` + `RealmToken` types; directory surfaces per-realm currency. No chain writes. | #475 (landed) | New `*_db.ts` integration test (in-memory fake + real-DB); `assertRealmSchema` fails on a dropped column; directory merge test. |
| **1. Launch vote (asset-only)** | `realm_vote.ts` + `realm_vote_db.ts` weighted tally, per-wallet guard, REST + vote panel + `launchpad` i18n domain. Pass flips `voting` to `presale`. | 0; `woc_balance` (exists) | Tally unit tests (weights, quorum, double-vote rejection); panel renders; S3 i18n guard green. |
| **2. Presale (asset-only, non-custodial)** | `realm_presale.ts` + `realm_presale_db.ts` forking `realm_buy` quote/verify/confirm; SOL/USDC (+$WOC, +Stripe optional); `UNIQUE(tx_sig)`, caps, soft-cap refund; presale panel. | 1; `realm_buy` machinery (exists) | Verifier rejects wrong-amount / wrong-recipient / replayed sig; refund path test; non-custodial (no server settle key) asserted. |
| **3. Token-2022 mint factory + allocation/locks** | Boring fair-launch mint (metadata-only, 9dp, freeze null), server partial-sign + founder co-sign, verify + record `launch_tx_sig` UNIQUE, renounce authority; distribute the fixed supply per the allocation table; immutable Jupiter Lock for the founder, Levy Street Fund, and realm-treasury buckets; `realm_token_alloc.ts` split math; a token may not list until founder + levy + LP locks are on-chain. Scoped Token-2022 verifier. Devnet dry-run. | 0; add `@solana/spl-token` | Devnet: mint created, metadata present, authorities renounced, locks immutable + verifiable, RugCheck-clean; split math sums to 100%; listing blocked until all locks present; legacy stake/buy verifiers still reject Token-2022. |
| **4. Bonding curve + LP graduation** | Meteora DBC launch service: shared partner config + feeClaimer PDA, per-realm curve, auto-migrate to DAMM v2 + permanent LP lock; optional Alpha Vault; `Launchpad` abstraction with Raydium fallback. Mainnet-only liquidity. | 3 (mint), 2 (presale feeds curve); mainnet sign-off | Mainnet dry-run: curve trades, migrates at threshold, LP provably locked; status transitions persisted. |
| **5. Fee / revenue keeper** | Source-scoped `PayoutKeeper`: buyback leg to $WOC burn or LP seed (pluggable terminal step); claims DBC fees into the revenue split with affiliate cut; lock-proof dashboard panel. | 4 (pool + feeClaimer); buyback keeper engine (exists) | Keeper drains a seeded vault end-to-end; split math + affiliate cut tests; advisory-lock no-double-spend. |
| **6. Levy Street Fund + portfolio dashboard** | `levy_fund.ts` + `levy_fund_db.ts` + `token_valuation.ts`: the platform PDA accrues each realm's levy bucket (locked); a valuation keeper marks holdings (DBC `sqrtPrice` / `swapQuote` pre-grad, Jupiter v3 + cross-check post-grad, Pyth SOL/USD); a `levy_fund_holdings` snapshot powers a public, display-only daos.fun-style portfolio page. No fund-share token, no redemption. | 3 (levy bucket exists), 4 (graduated tokens get DEX prices) | Valuation tiers unit-tested (curve math, illiquid excluded not zeroed, divergence rejection); AUM matches a fixture wallet; dashboard renders; no buy/sell/redeem path exists; levy lock is on the longest schedule. |
| **7. In-world currency re-skin** | Per-realm currency symbol / icon on `IWorld`; `hud.ts` re-skins copper display; `sim_i18n` matcher; per-realm procedural icon. Sim stays pure; `cosmetic` realms keep power on soft copper, `power` realms allow verified token-to-copper credit. | 0 (resolver); parallel with 3 to 6 | `tests/architecture.test.ts` green (no mint in sim); money-display + re-localize tests; `monetization_policy` gate test. |
| **8. Regulatory hardening + mainnet gate** | Non-custodial-facilitator ToS, OFAC + geo middleware on money routes, RugCheck/Birdeye clean-score acceptance test, pay-to-win labeling, counsel memo on the Levy Street Fund (Investment Company Act) + sign-off. Flag-gated default-off. | 2 to 6; legal review | Geo middleware blocks excluded IPs; flags default-off; counsel memo + sign-off recorded before any mainnet enablement. |

Phases 0 to 2 ship with no new mint and no mainnet dependency (pure registry +
asset-only vote + asset-only presale), so the riskiest chain work (3 to 6) is
de-risked and sequenced behind shippable value.

## 12. Risks and mitigations

| Severity | Risk | Mitigation |
|---|---|---|
| High | Token-2022 AMM/DEX incompatibility strands liquidity (transfer hook / fee tokens are not reliably swappable on Raydium/Orca/Jupiter; Orca rejects freeze / permanent-delegate pools without a TokenBadge). | Ship boring metadata-only Token-2022 (no hook / freeze / delegate, 9dp, mint renounced). Pre-clear Orca TokenBadge + Jupiter/Raydium token-list per launch. Keep the `Launchpad` swappable. |
| High | Rug vectors erode trust and trip scanners (retained mint authority, freeze, permanent delegate, mutable fee, cancelable vest). | Renounce mint authority post-distribution; never set freeze; no delegate / hook / pausable; mandatory permanent LP lock; immutable Jupiter-Lock vesting; clean RugCheck/Birdeye as an acceptance test. |
| High | Securities / money-transmission exposure (tradeable, optionally power-bearing token + presale). | Strictly non-custodial; facilitator ToS with jurisdiction + sanctioned-country exclusion; OFAC + IP geo-gating; no profit-promise copy; counsel sign-off gate; `power` realms behind the same gate. |
| High | Pay-to-win breaks the no-pay-to-win invariant. | `monetization_policy` per realm, `cosmetic` default, canonical realm always cosmetic; power realms labeled + gated; the sim only ever sees opaque `copper`. |
| Medium | `src/sim/` purity / determinism regression if token identity or an RPC read leaks in. | Surface identity on `IWorld` and resolve server/UI-side only; sim carries an opaque balance + stable keys (the `holder_tier.ts` precedent); guarded by `tests/architecture.test.ts`. |
| Medium | New hot-key surface (transient mint keypair, per-realm vaults / keepers); a misconfigured curve / feeClaimer / lock is irreversible. | Mint keypair held only transiently then renounced; feeClaimer is a program-owned PDA, not an EOA; base58 + KMS secrets; devnet dry-run before any mainnet pool; one keeper per currency with advisory-lock discipline. |
| Medium | Replay / double-spend across many contributions + the launch tx. | `UNIQUE(tx_sig)` on every money row + `launch_tx_sig`; ledger-first insert before any grant; quote TTL shorter than any reservation hold. |
| Medium | Pre-liquidity pricing gaps (Jupiter returns null with no DEX route; DEX-priced rails are mainnet-only). | Tolerate null routes (503 / disabled, existing pattern); use the bonding curve itself as the pre-graduation price; fixed-rate card model for fixed-price presale legs; keep early phases asset-only + price-tolerant. |
| Medium | Per-mint proliferation fragments liquidity and multiplies ops; abandoned realms strand mints / LP. | Gate launches behind the stake-to-provision minimum; shared quote asset for routing; document that closed-realm mints / LP remain on-chain by design (the lock is the point); track per-mint rent. |
| High | Levy Street Fund as a securities surface: a platform that accumulates AND sells a claim on a managed basket of tokens it launched is a likely investment company / pooled-investment vehicle. | Display-only treasury: no fund-share token, no pro-rata redemption, no managed-return claims (section 8). Counsel memo on Investment Company Act status before the page is enabled on mainnet. |
| High | Platform-bag overhang / centralization: holding a large share of every token is itself a perceived rug and a market overhang. | Lock the levy bucket on the strictest schedule on the cap table (12mo cliff + 48mo linear); published no-sell / governance-gated disposal policy; full public transparency of the holdings; the bag is capped (default 8%, hard cap 10%). |
| Medium | Portfolio valuation is wrong or gameable (thin-pool spot manipulation; NAV mistaken for market price; AUM under-report from null prices). | Tiered liquidity-aware marks (DBC `swapQuote` against held balance pre-grad; Jupiter v3 cross-checked with Birdeye / DEX Screener post-grad); rolling median + clamp; exclude (never zero) illiquid holdings; no fund share token means no market-vs-NAV confusion. |
| Low | i18n catalog-domain churn red-fails `tsc`. | New strings only in a new flat English-only `launchpad` domain spread into `i18n.catalog/index.ts`; map server error codes to `t()` keys client-side; keep the S3 guard green. |

## 13. Open questions and unknowns

- **Token utility specifics.** What exactly does a `cosmetic` realm token buy
  (which SKUs: skins, names, mounts, realm-customization budget, access passes)?
  This determines the SKU catalog but not the architecture.
- **Default allocation split + the levy cut.** The percentages in the allocation
  table (public-curve / liquidity / founder / Levy Street Fund / treasury) and the
  vesting schedules are starting knobs to finalize with counsel; in particular the
  Levy Street Fund cut (default 8%) and the founder cap (15%).
- **Levy Street Fund extras.** Whether the levy is also fed by a small ongoing
  slice of trading fees (on top of the token allocation), and the exact
  governance mechanism for the no-sell / disposal policy.
- **Quote asset per realm.** SOL by default; allow USDC and $WOC? $WOC as a quote
  asset would create direct $WOC buy pressure but fragments routing.
- **Core convergence.** Four duplicated commerce cores exist across worktrees
  (two Solana RPC readers, three buyback keepers, four config files). Decide
  whether to converge (one `woc_config`, one native-SOL-capable `solana_tx`, one
  keeper) before or after building the presale, to avoid forking a fifth copy.
- **Contributor identity model.** Game account (linked wallet to `accountId`, the
  Aldrin model) vs pure wallet (challenge / sign, the ads model). Affects the auth
  seam, which FK the vote / presale ledgers reference, and KYC / geo obligations.
- **SDK version pinning.** Meteora DBC / Alpha Vault, Jupiter Lock, Streamflow,
  and the Mythic governance SDK move fast; pin versions and re-verify signatures
  against live repos at implementation time. Read fees / thresholds from live
  on-chain config, never hardcode.
- **Devnet limits.** The bonding-curve / LP / graduation path cannot be validated
  end-to-end on devnet (no AMM liquidity, dead faucet); Phases 4 to 6 need a
  funded mainnet dry-run, with a fixed-rate stub host for pre-mainnet tests.

## 14. Out of scope (for this plan / first delivery)

- A custom bonding-curve or AMM Anchor program (we integrate Meteora).
- On-chain binding governance (off-chain weighted tally first; SPL Governance is a
  documented upgrade seam).
- Token-denominated *reward emissions* (would require a per-realm sink-bounded
  flow ledger; specified as a follow-on).
- Cross-realm token bridging / unified liquidity.
- **A tradeable Levy Street Fund share token or pro-rata redemption of the
  portfolio.** Deliberately excluded: the fund is a display-only treasury (section
  8). A redeemable basket share is the securities line we do not cross in this
  plan; revisit only with a dedicated counsel-led workstream if ever wanted.
- The world editor (separate workstream; this plan only consumes the realm it
  produces).
