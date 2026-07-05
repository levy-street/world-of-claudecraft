# PRD — Creator Skins Marketplace ($WOC buy-and-burn)

| | |
|---|---|
| **Status** | Draft / Proposed — RFC. Expands PR #469. **Not for merge.** Engineering may build behind a feature flag, but **no live USDC payment, creator payout, or on-chain $WOC buy-and-burn ships until §12 (CONFIRM-GATE) and §8.9 (legal counsel gate) are signed off in writing.** |
| **Owner** | TBD |
| **Created** | 2026-06-19 |
| **Source demand** | A creator-economy ask: let players author cosmetic skins, set a USD price, and sell them — while tying real external revenue to a verifiable $WOC supply burn. Positioned as the flagship of the "real economic activity → $WOC burn" family begun by PR #469. |
| **Related systems (file refs)** | In-game copper market: `src/sim/sim.ts:207` (`MARKET_CUT = 0.05`), `:205` (`MARKET_MAX_PRICE = 5_000_000`), `:9394` (cut copper destroyed, credited nowhere). Cosmetic skin path: `src/world_api.ts:287` (`changeSkin`) → `src/net/online.ts:852` (`change_skin` cmd) → `server/game.ts:1119` (ownership check) → `src/sim/sim.ts:1039` (`setPlayerSkin`). Appearance fields: `src/sim/types.ts:907` (`skin`/`skinCatalog`). Wire identity sync: `server/game.ts:201` (`identityFields`, gated by `hasIdentity`), `src/net/online.ts:566`/`:571` (deserialize). Render: `src/render/characters/visual.ts:288` (`setSkin`), `src/render/characters/assets.ts:~183` (`loadSkinTexInto` URL cache, `mechAssets()` lazy pattern), `src/render/characters/manifest.ts:~199` (`SKINS`). Ownership store: `server/db.ts:~221` (`AccountCosmetics`/`normalizeAccountCosmetics`). Web3 stubs: `server/solana.ts`, `server/billing.ts`, `bridge/src/payment/flow.ts`, `bridge/src/wallet/provision.ts`. Admin moderation to extend: `server/moderation_db.ts`, `src/admin/main.ts:72`, `src/admin/tables.ts` (`renderModerationQueue`), `src/admin/api.ts:57,64`. Companion: PR #469 copper-fee→$WOC burn — `docs/prd/woc/market-fee-woc-burn.md` (the sibling stub in this PR; this PRD is the revenue-backed flagship of the same burn family). |
| **Locked decisions** | (1) Cosmetic-only / no pay-to-win — guaranteed *structurally* (skin fields never enter `recalcPlayerStats`'s inputs), not by the ownership gate. (2) Sim stays pure: it carries an **opaque** creator-skin id and never resolves, validates, or prices it; all money and id-resolution live in `server/` + `bridge/` + CDN. (3) Buyers pay **USDC** (mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, 6 decimals). (4) Split is **fixed 70/30** on gross USDC regardless of the creator-set price. (5) All player-visible strings are `t()` keys (English-only PRs legal). |
| **Open / needs-confirmation decisions** | See §12 (CONFIRM-GATE, engineering + economic) and §8.9 (legal counsel gate). Nothing builds to mainnet until both are resolved. |
| **Scale** | Tens→hundreds of live skins at launch (curated), thousands later (open submissions). Per-purchase latency bound to a single payment verify; buy-and-burn is deferred + batched off the hot path. VRAM the binding client constraint (one 2048² atlas ≈ 16–21 MB resident). |

---

## 1. Summary

This PRD specifies a **Creator Skins Marketplace**: players author cosmetic skins, set **any USD price**, and sell them to other players who pay in **USDC on Solana**. Every sale is split by a **fixed 70/30 rule, independent of the creator-set price**: **70% USDC goes to the creator**, and **30% USDC is used to market-buy `$WOC` on a Solana DEX (Jupiter) and then SPL-burn it** — permanently reducing `$WOC` supply.

The feature must hold every World of Claudecraft invariant:

- **Cosmetic-only / no pay-to-win.** A creator skin is the same technical unit as today's hand-authored skins (one 2048×2048 sRGB texture atlas). Price buys *appearance*, never *power* — and this is guaranteed by structure (§5.4), not by vigilance.
- **Sim purity.** The deterministic 20 Hz sim never learns money, USDC, `$WOC`, slippage, or a marketplace exist. It carries one new **opaque string id** and never interprets it (§5.2).
- **Money lives in `server/` + `bridge/`.** All web3, the split, the DEX swap, and the burn are server/bridge-side, built on the existing (stubbed) `server/solana.ts` / `server/billing.ts` / `bridge/` seams.

It is the **flagship of the "real economic activity → $WOC burn" family** begun by PR #469 (the in-game 5% copper `MARKET_CUT` → $WOC burn). The two compose into one shared, public, on-chain-verifiable burn ledger.

**This is materially higher-risk than PR #469** because real USD-equivalent value flows in and is used to shrink the supply of a publicly-traded token. The securities posture (§8.2) is the irreducible high-severity item and gates the whole feature on written legal counsel (§8.9).

---

## 2. Background & motivation

### 2.1 What exists today

The game already has a complete, **deterministic, real-money-free** cosmetic skin system and an in-game copper market — and a set of **landed-but-unwired web3 stubs**.

- **Cosmetic skins (in-engine, cosmetic-only).** `Entity`/`PlayerMeta` carry `skin: number` + `skinCatalog: 'class' | 'mech'` (`src/sim/types.ts:907`). `skin` indexes a **statically compiled** `SKINS[visualKey]` array (`src/render/characters/manifest.ts:~199`; index 0 = embedded default, 1–3 = alt atlases). Equip path: `changeSkin` on `IWorld` (`src/world_api.ts:287`) → `change_skin` client cmd (`src/net/online.ts:852`) → server ownership check (`server/game.ts:1119`) → `sim.setPlayerSkin` (`src/sim/sim.ts:1039`). Other players within ~120 yd see the new look on the next interest-scoped snapshot via the `sk`/`cat` identity fields (`server/game.ts:201`; deserialize `src/net/online.ts:571`). Ownership lives account-level in `AccountCosmetics` (`accounts.cosmetics` JSONB, `server/db.ts:~221`).

- **In-game copper market.** A deterministic auction house entirely in `src/sim/sim.ts` with `MARKET_CUT = 0.05` (`:207`) — a 5% gold **sink**: the cut copper is simply **destroyed**, credited to no treasury or accumulator (`:9394`). Currency is copper (`PlayerMeta.copper`; 1g = 100c). **No real money anywhere in-game today.**

- **Web3 infra (stubs only).** `server/solana.ts` defines a **read/verify-only** `SolanaClient` (`getConfirmedTransfer`, `getTokenBalance`, `verifySignedMessage`); `createSolanaClient` throws `TODO(eliza)`. `server/billing.ts` defines `Quote` / `Entitlement` / `BillingStore` with a `recordPayment` replay guard (returns null if `txSig` already consumed) and a `verifyPayment` contract (finalized commitment, recipient == treasury, amount ≥ price, memo == quoteId, replay guard). `bridge/src/payment/flow.ts` stubs `payAndVerify` (quote → sign transfer → `sendAndConfirm('finalized')` → POST verify-payment → entitlement). `bridge/src/wallet/provision.ts` stubs **custodial** wallet provisioning **for agents only — never human players**. `.env.local` carries `VITE_WOC_MINT=3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth`, a Helius `VITE_SOLANA_RPC_URL`, and `VITE_REOWN_PROJECT_ID` — **all currently unused in code.** There is **no** DEX integration, **no** USDC handling, and **no** burn/swap/treasury logic anywhere yet.

### 2.2 The gaps this PRD closes

1. **No UGC pipeline.** All skins are hand-authored and compiled into the client at deploy. Creator skins require a **dynamic, DB-backed registry + CDN-served assets loaded at runtime** (no redeploy per skin), plus upload/validation/moderation.
2. **No opaque-id carrier in the sim.** *(Corrected from earlier drafts.)* The sim does **not** today carry any string skin id. `setPlayerSkin(pid, skin: number, catalog)` bounds `skin` to an integer (0..7 for class, 0..`MECH_CHROMAS.length-1` for mech) at `src/sim/sim.ts:1042-1043`; `PlayerMeta.skin` is `number` (`src/sim/types.ts:908`); the wire field `sk` is that integer and `cat` is literally `'mech'`. **Carrying a creator-skin id is net-new work** — a new field on `Entity`/`PlayerMeta`, a new wire identity field, new (de)serialize code, and a deliberate determinism decision (§5.2). This PRD does not treat it as a no-op.
3. **No real-money rail.** The web3 stubs must be implemented (read/verify side) and a **new keeper** (DEX swap + burn, signing side) added — kept strictly separate from the verify path (§4).

### 2.3 How this expands PR #469 and composes with it

PR #469 takes the existing 5% copper `MARKET_CUT` — today a pure in-sim sink — and ties a $WOC burn to it. But **copper is virtual**: minted and destroyed inside the deterministic sim with no external cost. A $WOC burn "against" copper-fee activity is a **signal/marketing burn** whose size is set by a house-chosen conversion policy, not by anyone spending real money. It is a fine ambient burn, but its budget is ultimately a house subsidy.

This marketplace is the **revenue-backed** sibling: every dollar burned is backed by a dollar a buyer actually paid. The two **compose, they don't conflict** — both feed the **same burn ledger** and the **same mint**. Recommended design: keep them as **separate executors** (different `source` tags, different funding accounts) but **one ledger schema** (§7), so an audit can always answer "how much of this burn was real-revenue-backed vs. fee-signal." Reporting them as one cumulative "total $WOC burned" figure with two labeled sources tells a coherent, honest story. (See §3.2 for the explicit, deliberately-not-overstated economic claim.)

---

## 3. The 70/30 economics & buy-and-burn flywheel

> **Every numeric default in this section is a tunable starting point, not a locked decision.** The split ratio, batch policy, slippage ceiling, and refund posture are economic levers the user must confirm before build — collected in §12.

### 3.1 The fixed 70/30 split

A creator sets any USD price `P_usd`. At checkout the buyer pays the USDC equivalent. **USDC is treated as $1.00** (1 USDC = 1_000_000 base units); depeg risk is documented in §8.6 and §12. The split is applied to **gross USDC received**, in integer base units, using **`bigint` throughout** (matching `getTokenBalance`'s `bigint`; never `number` at the money boundary — see §4.6):

```
gross_usdc      = quote.usdcBaseUnits            // bigint; what the buyer transferred
creator_usdc    = gross_usdc * 70n / 100n        // 70% → creator
burn_pool_usdc  = gross_usdc - creator_usdc       // remainder → buy-and-burn (≥ 30%)
```

Using `gross - creator` for the remainder (not a second floor) means **no base unit is ever lost to rounding** — the dust accrues to the burn pool, never to the house, never unaccounted. This mirrors the floor-with-remainder discipline of `MARKET_CUT` (`src/sim/sim.ts:207`). The 70/30 ratio is locked at 70/30 in this draft (confirm in §12).

| Creator price | gross USDC (base units) | creator 70% | burn pool 30% |
|---|---|---|---|
| **$1**   | 1_000_000   | 700_000 (`$0.70`)    | 300_000 (`$0.30`)  |
| **$10**  | 10_000_000  | 7_000_000 (`$7.00`)  | 3_000_000 (`$3.00`)|
| **$100** | 100_000_000 | 70_000_000 (`$70.00`)| 30_000_000 (`$30.00`)|

The split settles **in USDC**: the creator is paid in USDC; the burn pool holds USDC. `$WOC` enters only later, when the pool is swapped (§3.3). A creator selling a $10 skin nets exactly $7.00 of real value regardless of whether `$WOC` is at $0.001 or $1.00. There is **no `$WOC`-denominated payout anywhere**, so the marketplace never gives anyone a reason to model `$WOC` price into a purchase — preserving the cosmetic-only posture at the economics layer.

### 3.2 What the buy-and-burn actually does (stated honestly)

The 30% buy-and-burn has two **verifiable** properties:

1. **Recurring, real-USDC-backed buy pressure proportional to GMV.** Every settled sale routes 30% of real external USDC into a market buy of `$WOC`. The buys are real and 1:1 auditable against the public ledger (§3.4).
2. **Monotonic, irreversible supply reduction.** The bought `$WOC` is destroyed via SPL `burnChecked`, which decreases the mint's circulating and total supply on-chain. Supply only goes down; there is no re-issuance in this flow.

**What it does *not* guarantee.** *(Adjusted per adversarial review — earlier drafts overstated this.)* Buy-and-burn provides **recurring marginal buy pressure and supply reduction at the margin** — it does **not** guarantee durable price appreciation. Durable price support depends on demand exceeding emissions and sell pressure (including creators selling their 70% USDC for other assets, and any ongoing token unlocks), which this mechanism does not control. On a thin `$WOC` pool (§3.3) the buys that actually clear are small and their price impact dissipates. So the honest framing is: **"recurring small net buys; supply down at the margin; backed 1:1 by real revenue; fully auditable."** We deliberately do **not** market this as "number go up," and §8.2 makes that a hard ToS/product ban for securities reasons.

**Why it is still the flagship of the burn family (the honest, defensible claims):**

- **Real value in.** Every dollar burned is backed by a dollar a buyer paid — no subsidy, no "how much copper equals how much $WOC" policy knob.
- **Demand-driven, unbounded scale.** Copper fee volume is capped by in-game throughput and `MARKET_MAX_PRICE = 5_000_000` copper (`src/sim/sim.ts:205`); USDC GMV is capped only by how much creators sell.
- **Auditable 1:1 provenance.** Each burn ties to settled sales' USDC, giving the public ledger clean accounting.

### 3.3 The $WOC-side slippage problem, protection, and batching

"We wouldn't have to worry about liquidity" is true **only on the USDC leg** (deep; Jupiter always finds a route to sell it). The risk is entirely the **`$WOC` leg**: the USDC→`$WOC` pool(s) may be thin, so a naive per-sale buy of $3 into a shallow pool eats avoidable slippage, pays fixed route fees on tiny notional, and is trivially sandwich-able. Three layered mitigations:

**(a) Hard slippage protection on every swap.** Quote via Jupiter, compute `minOut` from a max-slippage ceiling, submit with that `minOut` so the swap **reverts rather than fills at a bad price**:

```
quotedWoc = jupiter.quote(USDC → WOC, amountIn = batchUsdc)
minOutWoc = quotedWoc.outAmount * (10_000n - MAX_SLIPPAGE_BPS) / 10_000n
// submit with minOutWoc; if the pool moved past tolerance, tx fails → hold (§3.5)
```

Default `MAX_SLIPPAGE_BPS = 100` (1.00%). This is the single most important guardrail: a thin pool can never force a bad execution — a bad execution simply doesn't happen.

**(b) Batching, never per-sale.** Accrue `burn_pool_usdc` into a single burn-vault account and run the buy-burn on a **cadence or threshold, whichever fires first**:

> **Default batch policy:** execute when accrued pool **≥ $250** OR **6 h** elapsed since the last successful buy-burn *and* a nonzero pool exists — **but never below a fee-aware floor `MIN_BATCH_USDC = $25`** (a $3 pool rolls forward indefinitely until it clears the floor; see §3.5). *(The fee floor is added per adversarial review: the cadence trigger must not fire on a $3 pool and burn more in fees than value swapped.)*

Batching cuts per-unit route/priority fees, reaches deeper into the book at a better average price, and gives MEV bots a far harder, less predictable target.

**(c) TWAP-style splitting for large batches.** If a single batch would itself move the pool past the slippage ceiling, split into N child swaps spaced over a window. Default: if `batchUsdc > $1,000`, split into chunks of `≤ $250` every ~2 min until drained, each independently slippage-protected. This is price-impact management, not market timing — order and spacing are policy, not prediction.

None of (a)–(c) touches the sim.

### 3.4 Burn accounting & transparency

Burns are **real SPL burns** — `burnChecked(mint = $WOC, amount, decimals)` from the burn-vault's `$WOC` token account. After each batch we record and publicly publish a **burn ledger** row (schema in §7, `burn_batches`):

| Field | Meaning |
|---|---|
| `batch_id` | Internal batch identifier |
| `buy_tx_sig` | Jupiter swap signature (USDC → $WOC) |
| `burn_tx_sig` | SPL burn signature |
| `usdc_in` | USDC spent this batch (base units) |
| `woc_bought` | $WOC received from the swap |
| `woc_burned` | $WOC actually burned (`woc_bought` minus sub-unit dust rolled forward) |
| `effective_price` | `usdc_in / woc_bought` — realized USDC/$WOC |
| `source` | `'marketplace'` \| `'copper_fee'` (#469) |
| `cumulative_woc_burned` | Running total across all sources |
| `executed_at` | Timestamp |

Both signatures are independently verifiable on any Solana explorer. The public page surfaces total USDC routed to burns, total `$WOC` burned, % of supply burned, and a per-batch table linking out. The ledger is presented **factually only** — raw amounts and tx links, **no editorializing** (no "scarcer = more valuable") for the securities reasons in §8.2. This trust-but-verify artifact is shared with PR #469 (§2.3).

### 3.5 Failure & edge handling

| Condition | Behavior |
|---|---|
| **Swap fails (slippage ceiling / thin liquidity)** | Reverts via `minOut`. **Hold** USDC in the vault; retry next cadence. After `MAX_SWAP_RETRIES = 3` consecutive failures, escalate: widen the TWAP window (smaller chunks), then alert ops. **Never** disable the ceiling to force a fill. |
| **$WOC price spike mid-batch** | Covered by slippage protection — a spike past tolerance just fails the swap and we hold. Fewer `$WOC` per USDC on a real spike, never an MEV'd fill. We do not chase with a wider ceiling. |
| **Sub-floor pool / dust** | A pool below `MIN_BATCH_USDC = $25` waits — even past the 6 h cadence — and rolls forward until it clears the fee-aware floor (prevents value-destructive tiny swaps). Sub-unit `$WOC` dust from a swap rolls into the next batch's `woc_burned`. |
| **Refunds / chargebacks** | **There are none on the recommended on-chain design.** USDC transfers are final and the creator's 70% is paid irreversibly at point of sale; see §3.6 and §4. Policy is **all sales final**; any discretionary remedy is a *new forward payment* from platform funds, never a chain reversal, and the already-executed burn is never unwound. |
| **Partial fill** | Jupiter swaps are all-or-nothing against `minOut`; if routing splits internally, `woc_bought` reflects the aggregate out-amount. |

### 3.6 Reconciling settlement with the chosen custody topology

*(This subsection resolves a contradiction flagged in adversarial review.)* Earlier drafts proposed a 24 h `SETTLEMENT_HOLD` that gated USDC from entering the burn pool until a refund window cleared. **That is incompatible with the recommended custody model (§4, Option C)**, where the buyer signs a single atomic transaction that lands the 30% in the burn-vault and the 70% in the creator's wallet *at point of sale* — both legs are on-chain and irreversible immediately. There is no mechanism to withhold the buyer's funds pending settlement, and no refund primitive at all (the creator is paid directly).

We therefore **drop the settlement-hold / clawback model** and adopt:

- **All sales final, disclosed before purchase** (§8.6). USDC is irreversible; the creator is paid irreversibly at point of sale.
- The 24 h "hold" survives only as an optional **execution-cadence** input to the batcher (how long burn-vault USDC may sit before a buy-burn fires), **not** as a refund gate. Burns still run on a cadence/threshold; the funds are already settled on-chain the instant the sale tx finalizes.

(If the user instead chooses **Option A** — 100% to a server escrow first — then a settlement hold and discretionary refunds become possible, at the cost of custodying the creator share. That tradeoff is decision **D-CUSTODY** in §12.)

### 3.7 Key numeric defaults (all tunable — confirm in §12)

| Parameter | Default | Note |
|---|---:|---|
| `SPLIT_CREATOR_BPS` | `7000` (70%) | Creator share of gross USDC. |
| `SPLIT_BURN_BPS` | `3000` (30%) | `gross - creator` (dust → burn). |
| `MAX_SLIPPAGE_BPS` | `100` (1.0%) | Hard `minOut` ceiling; never relaxed to force a fill. |
| `BATCH_THRESHOLD_USDC` | `$250` | Trigger buy-burn at this pool size. |
| `BATCH_CADENCE` | `6 h` | Time trigger if threshold not reached and pool ≥ floor. |
| `MIN_BATCH_USDC` | `$25` | Fee-aware floor; pool below this never swaps regardless of elapsed time. |
| `TWAP_SPLIT_ABOVE_USDC` | `$1,000` | Above this, split into chunks. |
| `TWAP_CHUNK_USDC` | `$250` | Max per child swap. |
| `TWAP_CHUNK_INTERVAL` | `~2 min` | Spacing between child swaps. |
| `MAX_SWAP_RETRIES` | `3` | Consecutive failures before widening + ops alert. |
| `MIN_PRICE_USD` | `$1.00` | **UX/spam floor** (not a swap-economics floor — batching handles small per-sale shares; see §3.3b). |
| `USDC_MINT` | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | 6 decimals. |
| `WOC_MINT` | `3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth` | From `.env.local` (`VITE_WOC_MINT`). |
| `DEX_AGGREGATOR` | Jupiter | USDC→$WOC routing. |

---

## 4. On-chain architecture: payment, 70/30 split, buy-and-burn

This section specifies how a buyer's USDC payment is split 70/30, how the creator is paid, and how the 30% becomes burned `$WOC` — mapped onto existing repo seams, with three custody options and a recommendation that **the user must confirm before any build** (§12, D-CUSTODY).

### 4.1 The custody boundary (the decision that shapes everything)

USDC moves through one of three topologies. The choice is fundamentally **regulatory + trust-surface**, not technical.

#### Option A — Treasury-routed keeper (simplest, custodial)

```
buyer ──100% USDC──▶ marketplace treasury ATA
                          │  (server verifies finalized transfer like Billing.verifyPayment:
                          │   recipient==treasury, amount>=price, memo==quoteId, tx_sig UNIQUE)
                          ▼
                   backend keeper (deferred):
                     ├─ 70% USDC ──▶ creator wallet
                     └─ 30% USDC ──▶ Jupiter swap → $WOC → SPL burn
```

- **Pro:** trivial reuse of the existing single-recipient verify; enables a true settlement hold + discretionary refunds (§3.6).
- **Con:** the treasury **custodies the creator's funds in transit** — the strongest money-transmission fact pattern (§8.3). Rejected for the non-custodial ethos unless the user explicitly chooses refundability over non-custody.

#### Option B — On-chain atomic split program (Anchor, trustless, expensive)

A purpose-built Anchor program receives the payment and, in one transaction, routes 70% to the creator and 30% to a burn vault (optionally CPI-swapping + burning atomically).

- **Pro:** fully trustless; the protocol never custodies the creator share; the split is code-enforced.
- **Con:** highest build cost; a Rust/Anchor program we don't otherwise have; a mandatory **audit** before touching mainnet USDC; fragile CPI-into-Jupiter atomic swaps (compute limits, account bloat, in-tx sandwich exposure). Disproportionate at launch. **Hold as a v2 north star.**

#### Option C — RECOMMENDED: buyer-signed atomic split + deferred batched burn

```
                ┌──────────────── ONE buyer-signed tx (atomic) ────────────────┐
buyer wallet ───┤ ix: USDC 70% ───────────────▶ creator's CURRENT verified wallet ATA │
 (Reown)        │ ix: USDC 30% ───────────────▶ burn-vault ATA (server-owned)         │
                │ ix: memo == quoteId                                                  │
                └───────────────────────────────────────────────────────────────────┘
                                       │  (both legs settle or neither)
                                       ▼
                     server verifies BOTH legs (server/marketplace.ts)
                       finalized · exact amounts · dest owner+mint+program · payer==buyer · memo==quoteId · replay guard
                                       │  grants cosmetic entitlement to the PAYER's account
                                       ▼
                ┌──────── deferred, OFF the hot path (keeper-only signer) ────────┐
                │  periodic keeper drains burn-vault:                              │
                │   write burn_batches row (status=swapping) BEFORE signing        │
                │   Jupiter quote(USDC→$WOC) + minOut slippage guard → swap → burn │
                └──────────────────────────────────────────────────────────────────┘
```

**Why this fits the repo:**

- **Creator share is never custodied.** The 70% lands directly in the creator's verified wallet in the same atomic tx — eliminating Option A's custody of creator funds. *(Legal note: this MINIMIZES, does not eliminate, money-transmission exposure — see §8.3.)*
- **The only custodial surface is the burn vault**, holding only the 30% already destined for destruction. Blast radius of a vault compromise is bounded to funds we were about to burn — never creator or buyer money.
- **DEX + burn stay off the hot path** — batched, slippage-capped, MEV-resistant; purchase confirmation is a single verify.
- **No Anchor program, no audit on the critical path.** The split tx is a plain multi-instruction transaction (two SPL `transferChecked` + a memo).

Everything below specifies **Option C**.

### 4.2 Quote issuance — extend `billing.ts` `Quote`

The current `Quote` (`server/billing.ts`) is single-recipient. Add split fields. The quote is the server's authority on split math, **and the server persists `quoteId → {skinId, buyerAccountId, exact leg amounts}`** so verification can bind the on-chain tx to this exact quote.

```ts
// server/billing.ts — extend
export type EntitlementKind = 'agent_player' | 'familiar' | 'creator_skin';

export interface SplitLeg {
  recipientOwner: string;  // destination ACCOUNT/AUTHORITY address (creator wallet | burn-vault authority)
  ataDest: string;         // resolved USDC ATA at recipientOwner (legacy SPL Token program)
  amount: bigint;          // EXACT base units (USDC, 6 decimals) — bigint, not number
}

export interface Quote {
  quoteId: string;
  kind: EntitlementKind;
  buyerAccountId: number;       // NEW — quote is bound to one buyer account
  mint: string;                 // USDC mint — REQUIRED for creator_skin (no SOL path)
  memo: string;                 // == quoteId
  expiresAt: number;            // short (≈5 min)
  split?: {
    skinId: string;             // opaque creator-skin id (registry key)
    priceUsdcBaseUnits: bigint; // == creatorLeg.amount + burnLeg.amount
    creatorLeg: SplitLeg;       // 70% → creator's CURRENT verified wallet
    burnLeg: SplitLeg;          // 30% → burn-vault
  };
}
```

- Split math (all `bigint`): `creator = price * 70n / 100n`; `burn = price - creator`.
- `creatorLeg` resolves from the creator's **linked, verified** wallet (`account_wallets`, §7; challenge/verify via `SolanaClient.verifySignedMessage`). A creator without a verified wallet **and** a valid legacy-SPL USDC ATA cannot list — fail quote issuance (so the buyer tx never creates a third party's ATA; §4.5).
- `burnLeg.ataDest` is the burn-vault's fixed USDC ATA.
- `expiresAt` short to bound price/route staleness.

### 4.3 Buyer payment-tx construction (human buyer, Reown wallet)

Human buyers connect via **Reown/WalletConnect** (`VITE_REOWN_PROJECT_ID`) — distinct from the agent-only custodial provisioning (`bridge/src/wallet/provision.ts`). The tx is assembled from the quote and signed by the buyer's own key (non-custodial). One transaction, in order:

1. `transferChecked(USDC, buyerAta → creatorLeg.ataDest, creatorLeg.amount, 6)`.
2. `transferChecked(USDC, buyerAta → burnLeg.ataDest, burnLeg.amount, 6)`.
3. `MemoProgram` instruction with `memo == quoteId`.

The buyer tx **never creates a third party's ATA** — both destination ATAs are listing/onboarding preconditions (§4.5). Atomicity is the non-custody guarantee: both transfers commit or the whole tx fails. Build logic extends the existing `payAndVerify` stub (`bridge/src/payment/flow.ts`) from a single transfer to this 2-leg + memo shape.

### 4.4 Server verification — bind payer, exact amounts, account state

New module `server/marketplace.ts` owns split verification, composing `Billing`. It rejects unless **all** hold:

- Transaction is **finalized**.
- **Payer binding:** the tx fee-payer / source-token-account owner **== the buyer account's linked+verified wallet**, and the **calling account == the quote's `buyerAccountId`**. *(Closes the grant-theft hole: memo+tx_sig are public, so without payer binding the first caller to POST a valid signature would steal the entitlement.)*
- **Exact creator leg:** a USDC `transferChecked` to `creatorLeg.ataDest` of **exactly** `creatorLeg.amount`, where that destination token account's **on-chain owner == the listing's CURRENT verified creator wallet** (not a stale quote-time value), its **mint == USDC**, and its **token program == legacy SPL Token (Tokenkeg)** — reject Token-2022.
- **Exact burn leg:** a USDC `transferChecked` to `burnLeg.ataDest` of **exactly** `burnLeg.amount`, owner == burn-vault authority, mint == USDC, program == Tokenkeg.
- **No extra USDC debit:** assert **no USDC debit from `buyerAta` beyond the two quoted legs** (scoped narrowly so wallet/route-built ancillary instructions on *other* mints are fine).
- `memo == quoteId`; and the verified tx's legs match the persisted `quoteId → {skinId, buyerAccount, amounts}` record (reject quote-substitution).
- `tx_sig` not previously consumed (replay guard via `onchain_payments` UNIQUE; reuse `recordPayment`'s returns-null-on-dup contract).

*(Adversarial fixes folded in: exact `==` amounts — not `>=` — keep reconciliation exact and prevent silent over-payment into the vault; destination is validated by on-chain **owner + mint + token program**, not address alone, because an ATA address can match while owner/mint/program differ.)*

Extend `SolanaClient` with a **read-only** multi-leg reader (and keep amounts `bigint`):

```ts
// server/solana.ts — extend (READ/VERIFY ONLY; no signing authority here)
export interface ConfirmedSplitPayment {
  signature: string;
  finalized: boolean;
  feePayer: string;
  memo: string | null;
  legs: { fromAtaOwner: string; toAta: string; toAtaOwner: string; mint: string; tokenProgram: string; amount: bigint }[];
}
export interface SolanaClient {
  // existing: getConfirmedTransfer, getTokenBalance (→ bigint), verifySignedMessage
  getConfirmedSplitPayment(signature: string): Promise<ConfirmedSplitPayment | null>;
}
```

### 4.5 Entitlement / ownership grant

On successful verification:

1. `store.recordPayment(...)` (UNIQUE on `tx_sig`) — atomic replay guard; null return ⇒ already consumed ⇒ return the already-granted entitlement (idempotent).
2. Grant cosmetic ownership of `skinId` to the **payer's account** (account-level `AccountCosmetics`, §7).
3. The buyer may then `changeSkin(...)`. **Sim purity preserved:** the id is an opaque string carried through the existing skin path (§5); ownership is enforced server-side *before* `sim.setPlayerSkin`, mirroring the mech-ownership gate at `server/game.ts:1119`.

The 30% USDC now sits in the burn-vault ATA awaiting the keeper — not yet `$WOC`, not yet burned.

### 4.6 The keeper: Jupiter swap + SPL burn (deferred, batched, durable)

A periodic backend job drains the burn vault. **Crash safety is intent-logged, not balance-inferred** *(adversarial fix: SPL burn is irreversible; inferring recovery from vault balance can double-swap a lost-confirmation swap or burn `$WOC` that wasn't bought by this flow):*

1. **Read balance:** `getTokenBalance(burnVault, USDC)` (`bigint`).
2. **Write intent BEFORE signing:** insert a `burn_batches` row `status='swapping'` with the exact input USDC amount + an idempotency reference (a durable nonce / pre-derived sig).
3. **Quote:** Jupiter `/quote` USDC → `$WOC` for the batch. Liquidity worry is the `$WOC` side only.
4. **Slippage guard:** compute `minOut` from `MAX_SLIPPAGE_BPS`; if quoted impact exceeds the ceiling, **skip this cycle** (and TWAP-split large batches, §3.3c).
5. **Swap:** signed by the **burn-vault keypair**; confirm finalized; transition `swapping → swapped(woc_bought, buy_tx_sig)`.
6. **Burn:** `burnChecked($WOC, recorded woc_bought, decimals)` from the vault's `$WOC` ATA; transition `swapped → burning → burned(burn_tx_sig)`.
7. **Restart recovery:** resolve in-flight batches by **querying the chain for the recorded swap sig** (never by vault balance). Burn **only the exact recorded `woc_bought`** of a batch in `state='swapped'`. A durable-nonce / pre-signed-sig lookup ensures a lost confirmation cannot double-swap the same USDC, and we never burn `$WOC` that isn't tied to a recorded batch.

**Signing keys & seam separation** *(adversarial fix: keep `SolanaClient` read-only):* `jupiterSwap` and `burnTokens` require the burn-vault **signing** key, so they live behind a **separate keeper-only seam** — a `BurnKeeper` interface owned by `server/marketplace.ts` that is the **sole holder of the burn-vault keypair** and is **never injected into the quote/verify path**. This preserves the "only the keeper touches the vault key / bounded blast radius" property; if `jupiterSwap`/`burnTokens` lived on `SolanaClient`, every holder (including verify/quote) would transitively hold swap+burn capability.

```ts
// server/marketplace.ts — keeper-only signer seam (NOT on SolanaClient)
export interface BurnKeeper {
  jupiterSwap(a: { inMint: string; outMint: string; inAmount: bigint; maxSlippageBps: bigint }): Promise<{ signature: string; outAmount: bigint }>;
  burnTokens(a: { mint: string; ownerAta: string; amount: bigint }): Promise<{ signature: string }>;
}
```

The burn-vault keypair lives in server-side KMS / the encrypted `SecretVault` (`bridge/src/wallet/provision.ts`) — never a user key, never client-side.

### 4.7 Dependencies to add (and the stub to implement)

Keep the dependency set tiny, but this feature needs real web3:

- `@solana/web3.js` — `Connection`, tx construction/confirmation. **Required.**
- `@solana/spl-token` — `transferChecked`, `getAssociatedTokenAddress`, `burnChecked`, account/program introspection. **Required.**
- Jupiter — `@jup-ag/api` **or** raw REST via `fetch` (dependency-set tradeoff; see §12). **Required for the keeper.**
- ed25519 verify for `verifySignedMessage` (human/creator wallet linking) — `tweetnacl` or `@solana/web3.js` primitives.
- `createSolanaClient(rpcUrl)` (`server/solana.ts`, currently throws `TODO(eliza)`) **must be implemented** against Helius mainnet (`VITE_SOLANA_RPC_URL`).

All stay in `server/` + `bridge/`. **Zero** new imports in `src/sim/`.

### 4.8 Seam map

| Concern | Seam | Change |
|---|---|---|
| RPC, confirm split tx (read), token balance, sig verify | `server/solana.ts` | Add **read-only** `getConfirmedSplitPayment`; implement `createSolanaClient`; keep amounts `bigint`. |
| Quote with split legs, entitlement contract | `server/billing.ts` | Extend `Quote`/`EntitlementKind`; persist `quoteId→{skin,buyer,amounts}`; reuse `recordPayment`. |
| Split verification, ownership grant, keeper orchestration, **burn-vault signer** | `server/marketplace.ts` (new) | 2-leg verify + `BurnKeeper`; composes `Billing`; sole holder of the vault key. |
| Build 2-leg buyer tx; POST verify | `bridge/src/payment/flow.ts` | Extend `payAndVerify` to a 2-leg + memo tx. |
| Burn-vault key custody | KMS / `bridge/src/wallet/provision.ts` `SecretVault` | Store burn-vault keypair (server-only). |
| Human buyer wallet connect | Reown (`VITE_REOWN_PROJECT_ID`) | Wire connect UX (client). |
| Carry opaque skinId through play | `src/world_api.ts:287` → `src/sim/sim.ts:1039` (+ new field) | Opaque id only; ownership checked at `server/game.ts:1119` before `setPlayerSkin`. |
| Persistence | `server/db.ts` (+ new tables, §7) | SQL stays in `db.ts`/`*_db.ts`. |

### 4.9 Security model

- **Replay / double-spend:** `onchain_payments` UNIQUE `(chain, tx_sig)`; `recordPayment` returns null on dup → idempotent grant.
- **Grant theft:** entitlement is bound to the **payer's verified wallet + quote's buyer account** (§4.4), not to whoever POSTs a public signature first.
- **Fake-mint / wrong-token / Token-2022:** each leg asserts `mint == USDC` **and** `tokenProgram == Tokenkeg` **and** destination **owner**; a look-alike token, SOL, `$WOC` itself, or a Token-2022 account is rejected.
- **Partial / over-payment:** exact `==` per leg; reconciliation stays exact (Σ verified 30% legs == vault inflow).
- **Front-run / sandwich:** swaps deferred, batched, infrequent, `minOut`-capped; skip-and-retry on excess impact.
- **Key-compromise blast radius:** only the burn-vault key is custodial and holds only burn-bound 30% USDC + transient `$WOC`; it cannot reach creator earnings (paid atomically) or buyer funds.
- **RPC trust (Helius):** require **finalized**; decode and verify instructions ourselves (don't trust a convenience field); optionally cross-check critical burns against a second RPC.
- **Idempotent keeper / reconciliation:** durable intent row before signing (§4.6); a periodic job asserts Σ(verified 30% legs) − Σ(USDC swapped) == vault USDC balance, and Σ(`$WOC` bought) == Σ(`$WOC` burned) within rounding. Drift alerts.

---

## 5. Game & engine integration: opaque id, dynamic registry, ownership, cosmetic-only

This section specifies how a purchased skin becomes pixels on other players' screens without the sim, the snapshot wire, or the cosmetic-only rule bending. Its contract with §4 is one boolean the server can answer: *does account A own creator-skin S?*

### 5.1 The realistic unit of a creator skin

A skin here is a **texture identity** layered onto an existing hand-authored body, not a model.

- **Form A — class texture-atlas skin (the v1 unit).** One `2048×2048` sRGB PNG repainting a class body material's `.map`, matching that class's UV layout — exactly what `SKINS['player_rogue'] = [null, '.../rogue/alt_a.png', …]` already ships (`manifest.ts:~199`). Optional matching `2048×2048` emissive PNG (`SKIN_EMISSIVE`), applied to `.emissiveMap` **only on the high graphics tier** (low tier is `MeshLambertMaterial`, which ignores emissive). **No normal/metallic/roughness/AO maps** exist anywhere; a creator submitting them submits dead bytes.
- **Form B — KayKit-rigged GLB body + chroma atlases (a later phase).** A full alternate body GLB rigged to the shared KayKit skeleton plus color-variant atlases, mirroring the Combat Mech (`catalog:'mech'`, `MECH_CHROMAS`, `src/sim/content/skins.ts`). Strictly higher risk (arbitrary geometry, broken skin weights, draw-call blowups, malicious glTF extensions, retarget validation). **Deferred** behind its own geometry-validation pipeline.

**v1 ships Form A only** (§12, D-FORM). Same cost/risk as a skin we already ship — only the *source* (CDN vs compiled-in) changes.

**Authoring constraints (enforced at submission, §6):** exactly `2048×2048`, sRGB, 8-bit PNG, no embedded-profile weirdness; UVs fixed by the target class template (no custom UVs in v1); optional emissive same dims/layout (dropped on low tier); a hard byte ceiling (proposed 4 MB/PNG post-optimization); re-encoded server-side to canonical bytes so an approved asset is byte-identical for everyone.

### 5.2 The sim-purity problem and its resolution (NET-NEW work, not a no-op)

**The problem.** Today appearance is a bounded integer: `Entity.skin: number` + `Entity.skinCatalog` (`src/sim/types.ts:907`), where `skin` indexes a statically compiled array and `setPlayerSkin` clamps it (`maxSkin = catalog==='mech' ? MECH_CHROMAS.length-1 : 7`, `src/sim/sim.ts:1042-1043`). Creator skins are dynamic, unbounded, DB-backed — there is **no compile-time array to index, and no string id path anywhere today**. Resolving an id requires a registry lookup + CDN fetch; if any of that enters `src/sim/`, the sim gains a network/DB dependency and stops being deterministic and Node-pure — a hard-invariant violation.

**The resolution: introduce a NET-NEW opaque-id carrier the sim transports but never interprets.** This is a real, invariant-sensitive change — a new field, a new wire field, new (de)serialize code, and an explicit determinism decision — *not* an extension of the existing integer `setPlayerSkin`.

Add one nullable field **distinct from the integer `skin`**, on both `Entity` and `PlayerMeta` (`src/sim/types.ts:907`, beside `skin`/`skinCatalog`):

```ts
cosmeticSkinId: string | null; // opaque creator-skin id; sim NEVER resolves/validates/parses it.
                               // null = use the integer skin/skinCatalog fallback. Bounded length (see rules).
```

Rules the sim obeys (and nothing more):

- **Opaque string.** The sim does not parse it, check a registry, load anything, or branch on its contents — exactly as meaningful to the sim as `name`: a label that rides along. **Bounded length** (e.g. ≤ 64 chars; a UUID fits) so the wire/record stays cheap; length is validated server-side, never by the sim.
- **`setPlayerSkin` gains an optional `cosmeticSkinId` arg** (`src/sim/sim.ts:1039`). When set (non-empty) it stores the id on `meta`+`entity`; when null it clears it. It **still** sets `skin`/`skinCatalog` so there is always a deterministic **fallback identity** if the id can't be resolved client-side. The existing numeric clamp is unchanged and governs only the fallback. **It never touches stats** (§5.4).
- **Determinism is preserved by verbatim copy.** Storing a caller-provided string is a pure assignment — no `Rng`, no clock, no I/O, **no branching on the string's value**. The same command stream produces the same `cosmeticSkinId` on server, offline browser sim, and headless RL (which simply never resolves it to pixels — correct, it doesn't render).

**The full thread (who validates, who resolves):**

```
        CLIENT (renderer)            SERVER (authoritative; owns money + ownership)        OTHER CLIENTS
        ─────────────────            ────────────────────────────────────────────        ─────────────
 equip  changeSkin(skin,cat,        'change_skin' cmd ──► game.ts:1119 dispatch
        cosmeticSkinId)                 │  ownership: does this account own cosmeticSkinId?
 world_api.ts:287  ──cmd──►             │     ├─ owned+approved ─► sim.setPlayerSkin(pid, fallbackSkin, cat, id)
 online.ts:852 (no clamp; set          │     └─ NOT            ─► reject (no-op) — power can't leak
   p.cosmeticSkinId optimistically)    ▼
                                  sim stores opaque id (pure)
                                        ▼
                                  identityFields(e): NEW `csk` line, gated by hasIdentity  game.ts:201
                                        ▼  (interest-scoped snapshot, ~120yd)
                                  ════════════ wire ════════════════════════════════►  deserialize online.ts:571
                                                                                         e.cosmeticSkinId = w.csk ?? null
                                                                                         → ensureCreatorSkin(w.csk)
                                                                                              ▼
                                                                         render: resolve csk ─► registry (§5.3)
                                                                              ├─ hit  ─► fetch CDN atlas, cache, apply
                                                                              └─ miss ─► fall back to skin/skinCatalog
                                                                              ▼
                                                                         visual.ts:288 setSkin/setCreatorSkin (material .map swap)
```

**Wire/record specifics (all net-new — the draft says so explicitly):**

- **New identity field `csk`.** `identityFields` (`server/game.ts:201`) has **no `csk` line today**; add `if (e.cosmeticSkinId) out.csk = e.cosmeticSkinId;` (sent only when set, like `sk`). **Absent ⇒ unset/unchanged**, matching the existing identity-delta semantics.
- **`csk` rides only identity/full records, gated by `hasIdentity`** (`src/net/online.ts:566`) — exactly as `sk`/`cat` do. Equipping a creator skin therefore forces an identity-record resend. Deserialize (`src/net/online.ts:571`) gains a **net-new** `e.cosmeticSkinId = w.csk ?? null;` then triggers `ensureCreatorSkin(w.csk)`.
- **Client optimistic set (`src/net/online.ts:852`) must NOT clamp** for creator skins and must set `p.cosmeticSkinId` (the current client `changeSkin` clamps `skin` to 0–7 and writes `p.skin`/`p.skinCatalog`); otherwise local appearance diverges from the server-authoritative state. The client must not invent ownership — the server remains authoritative.

### 5.3 Dynamic, DB-backed registry + CDN

**Storage (immutable, content-addressed).** On approval (§6) each asset is re-encoded canonically, SHA-256 hashed, and uploaded under a content-addressed key, served via CDN at an **immutable** URL (`.../skins/<sha256>.png`, `Cache-Control: immutable, max-age=31536000`). Content-addressing gives: (1) the URL never changes once approved; (2) any byte change is a new URL (no cache-busting); (3) the hash is the integrity check. The DB registry row is the only mutable layer (status may flip approved→delisted); the bytes never mutate.

**Registry discovery (client).** The client doesn't know creator-skin URLs at deploy:

```
GET /api/skins/registry?since=<etag>  →  { skins: [ { id, class, bodyUrl, emissiveUrl|null, sha256, version, status:'approved' } … ], etag }
```

Fetched once on boot (and lazily on an unknown-id miss), stored in an in-memory `Map<id, RegistryEntry>`, honoring `ETag`/`Cache-Control` (common case 304). The registry is **public cosmetic metadata only** — no ownership, no prices. A non-owner sees the same registry and simply can't *equip* an id they don't own (server rejects), but they must still *render* anyone else's equipped creator skin they encounter. Rendering ≠ ownership.

**Lazy load + cache (extend the existing loader; do not rewrite it).** `src/render/characters/assets.ts` already has the machinery: a **URL-keyed texture cache** (`skinTexByUrl`/`skinEmisTexByUrl` + `loadSkinTexInto(url, map)`, `~:183`) and a **lazy memoized preload** pattern (`mechAssets()`; the boot sweep skips `lazyPreload` keys). Extend, reusing both:

```ts
// src/render/characters/assets.ts — modeled on mechAssets()/skinTexture()
const creatorSkinPromises = new Map<string, Promise<void>>();
export function ensureCreatorSkin(id: string): Promise<void> {       // memoized, idempotent
  const cached = creatorSkinPromises.get(id); if (cached) return cached;
  const entry = creatorRegistry.get(id);
  if (!entry) return Promise.resolve();                              // unknown id → caller falls back
  const jobs = [loadSkinTexInto(entry.bodyUrl, skinTexByUrl)];
  if (entry.emissiveUrl && GFX.tier === 'high') jobs.push(loadSkinTexInto(entry.emissiveUrl, skinEmisTexByUrl));
  const p = Promise.all(jobs).then(() => undefined).catch(() => undefined); // failure → resolved, fallback used
  creatorSkinPromises.set(id, p); return p;
}
export function creatorSkinTexture(id: string): THREE.Texture | null {
  const e = creatorRegistry.get(id); return e ? skinTexByUrl.get(e.bodyUrl) ?? null : null;
}
```

URL-keyed + content-addressed ⇒ skins sharing bytes share one GPU texture and re-equipping is free. While the promise is in flight the entity renders its fallback and is patched on resolve — no stall, no blank body.

### 5.4 Ownership & the structural cosmetic-only guarantee

**Persistence (extend the existing JSONB blob).** `AccountCosmetics` (`accounts.cosmetics` JSONB, normalized via `normalizeAccountCosmetics`, `server/db.ts:~221`) gains owned/authored creator-skin id arrays (schema in §7). The **source of truth for a fulfilled purchase** is the marketplace ledger (`marketplace_sales`, §7); the owned-ids array is the denormalized fast-read projection loaded on login and appended atomically when billing confirms a settled sale. A creator is auto-added to the authored set on approval (so they can wear their own work).

**Server-authoritative equip validation.** The `change_skin` dispatch (`server/game.ts:1119`) gains a creator branch beside the existing `mech`/`class` branches: equip only if the id is owned (or authored) **and** the registry entry is `approved`; otherwise no-op. Mirrors the existing mech-ownership gate. A client equipping an id it doesn't own changes nothing on the server, so it changes nothing for anyone — including its own authoritative appearance.

**Cosmetic-only is guaranteed by STRUCTURE, not by the ownership gate** *(adversarial fix — this is the load-bearing, stronger claim):*

- **The skin fields never appear in `recalcPlayerStats`'s argument list.** Verified: `recalcPlayerStats` is only ever called with `(cls, equipment, talentMods/playerMods)` — at `src/sim/sim.ts:927, 1335, 1354, 2190, 2932, 2951, 3058, 4205` — and **never** reads `skin`, `skinCatalog`, or `cosmeticSkinId`. The only stat inputs are level, gear, talents, buffs.
- `setPlayerSkin` writes **only** `meta.skin`, `meta.skinCatalog`, `meta.cosmeticSkinId` and the entity mirrors (`src/sim/sim.ts:1039`); it has no path to `recalcPlayerStats`. Appearance and stats are disjoint write-sets.
- Therefore pay-to-win is **unrepresentable**, not policed: a creator skin *cannot* touch combat math because the field never enters that math's inputs and the sim can't even resolve what the id *is*. **The ownership check governs WHICH cosmetic you may equip — never whether a cosmetic can affect power.** Leaning on the ownership gate as the power-neutrality guarantee is wrong and undersells the real invariant: if the gate had a bug, the worst case is "you equipped a skin you didn't buy," never a power leak.
- **CI invariant:** add a unit test asserting `recalcPlayerStats` output is invariant under every `setPlayerSkin` call (all `skin`/`catalog`/`cosmeticSkinId` permutations), and promote it to a CI-enforced check citing the verified line numbers above.

### 5.5 Graceful degradation on any non-approved id

An entity can carry a `cosmeticSkinId` pointing at an asset that is missing, delisted, NSFW-rejected, or never approved. Status lives in the registry row; the client only holds `approved` rows; the server only equips `approved` ids. A skin delisted *after* equip: the registry stops advertising it, equips start failing the server gate, and clients that cached the texture fall back to default on their next registry refresh (entry gone → `ensureCreatorSkin` miss → fallback). No forced disconnect, no sim involvement. The game is fully playable with zero creator skins loaded (adblock/region/offline degrade to default bodies).

### 5.6 Performance & safety budget

- **VRAM.** Each approved skin ≈ one `2048²` RGBA texture (~16–21 MB resident), doubled with a high-tier emissive. Hard **resident-skin cap** (proposed 24 distinct ≈ 512 MB high-tier worst case) with **LRU eviction** keyed on "no on-screen entity using this id." Dispose evicted `THREE.Texture`s explicitly — the current URL→texture `Map` is grow-only, so **adding eviction is the one real lifecycle change** to the existing loader (everything else is additive).
- **Crowd cap.** Interest scope ~120 yd; realistic crowd ≈ 30–60 visible. If distinct creator ids in view exceed the cap, render the default fallback for the most distant entities rather than thrash VRAM. Same-id players share one texture (a 40-player capital wearing one viral skin = one texture).
- **Submission-time validation (hard reject).** Exact dims/format/bit-depth/sRGB/byte-ceiling, bounded decode time/memory; re-encode to canonical bytes server-side (never serve uploaded bytes verbatim). KTX2/Basis transcode is a later optimization (~4–6× VRAM cut) once Form A is stable.
- **Hardening.** Decode budgets before decode, `crossOrigin` + strict CDN `Content-Type`, optional client `sha256` verification against the registry. Re-encode + content-address means a malformed file can't reach the CDN through moderation; runtime hardening is defense-in-depth.

### 5.7 Exact file:line hook points

| Concern | File:line | Change |
|---|---|---|
| Appearance field | `src/sim/types.ts:907` | Add `cosmeticSkinId: string \| null` to `Entity` + `PlayerMeta`, distinct from integer `skin`. |
| Sim setter | `src/sim/sim.ts:1039` `setPlayerSkin` | Optional `cosmeticSkinId` arg; store on meta+entity; keep numeric clamp as fallback; **never** touch stats. |
| Sim API | `src/world_api.ts:287` `changeSkin` | Widen: `changeSkin(skin, catalog?, cosmeticSkinId?)`. |
| Offline impl | `src/sim/sim.ts` `changeSkin` (near 1039) | Pass through to `setPlayerSkin` (offline self-grants; ownership only matters online). |
| Client cmd | `src/net/online.ts:852` `changeSkin` | Include `cosmeticSkinId`; optimistic set **without clamp**, set `p.cosmeticSkinId`, no invented ownership. |
| Wire deserialize | `src/net/online.ts:571` (gated by `:566` `hasIdentity`) | Net-new `e.cosmeticSkinId = w.csk ?? null;` then `ensureCreatorSkin(w.csk)`. |
| Identity fields | `server/game.ts:201` `identityFields` | Net-new `if (e.cosmeticSkinId) out.csk = e.cosmeticSkinId;`. |
| Equip validation | `server/game.ts:1119` `change_skin` | Creator branch: owned/authored + `approved` gate before `setPlayerSkin`. |
| Asset loader | `src/render/characters/assets.ts:~183` | `ensureCreatorSkin(id)`/`creatorSkinTexture(id)` reusing `loadSkinTexInto` + URL cache; add LRU eviction + `.dispose()`. |
| Render apply | `src/render/characters/visual.ts:288` `setSkin` | `setCreatorSkin(id)` (or extend `setSkin`) pulling creator textures via the same `applyMaterials` path; fallback to numeric `setSkin` on miss. |
| Ownership persist | `server/db.ts:~221` `AccountCosmetics`/`normalizeAccountCosmetics` | Add owned/authored creator-skin id arrays via `uniqueStrings`. |
| Registry endpoint | `server/game.ts` / route layer (new) | `GET /api/skins/registry` (approved cosmetic metadata + ETag). |

### 5.8 i18n

Every new chrome string (marketplace browse, "skin no longer available", "you don't own this skin", creator dashboard labels) is a `t()` key. Creator-supplied skin **names/descriptions** are free-text UGC — displayed verbatim (escaped), **not** localized, run through the same moderation as the asset (length cap, profanity/NSFW review). English-only PR acceptable; maintainer fills locales at release.

---

## 6. Creator pipeline & moderation

This is the human-facing pipeline turning a hand-authored cosmetic into a live, purchasable skin. Everything lives in `server/` or `src/admin/`; **the sim never participates** — it carries only the opaque id (§5.2).

### 6.1 Creator onboarding & payout-wallet linking

A creator is an ordinary `accounts` row that has completed payout-wallet verification, via the **challenge/verify** flow (no custodial provisioning — that is agents-only):

1. **Request challenge.** `POST /api/creator/link-wallet/challenge` with the candidate Solana address → server generates a single-use nonce (`creator-link:<accountId>:<random>`), stores it with a short TTL (5 min), returns the message.
2. **Sign.** Wallet (Reown, `VITE_REOWN_PROJECT_ID`) ed25519-signs the exact nonce. No tx, no gas.
3. **Verify & record.** `POST /api/creator/link-wallet/verify` with `{address, signatureB58}` → `SolanaClient.verifySignedMessage(...)` → insert `account_wallets(account_id, chain='solana', address, verified_at)`; `UNIQUE(chain,address)` is the anti-collusion guard (one wallet can't back two creator accounts).
4. **Payout binding.** The 70% always pays to the **most-recently-verified** `account_wallets` row for that account, and verification asserts the on-chain leg pays the **current** verified wallet (§4.4 — not a stale quote-time value). Changing the payout wallet requires a fresh challenge/verify, is **audit-logged**, and has a cooldown before new payouts release (proposed 72 h, confirm in §12) to blunt account-takeover theft.

Onboarding gate: a creator must (a) have a verified payout wallet **and a valid legacy-SPL USDC ATA** (so the buyer tx never creates third-party accounts, §4.5), and (b) meet an account-age / activity bar before **Submit skin** unlocks (anti-throwaway; proposed: age ≥ 7 days OR ≥ 1 completed quest via `AccountCosmetics.completedQuestIds`). Confirm in §12.

### 6.2 Skin submission flow

Submission is a new **Creator Studio** client surface. It produces a `creator_skins` row in `draft` plus uploaded bytes.

- **Asset(s).** v1: ONE `2048×2048` sRGB PNG atlas matching a target class's UVs; optional emissive (high tier only). No PBR/normal/metallic maps. (Form B GLB bodies later.)
- **Target.** `skin_catalog` + `target_class`.
- **Metadata.** `name`, `description` (stored raw, rendered only after moderation, escaped — UGC, never a `t()` key), `price_usd_cents`.

**Automated validation (`server/creator_assets.ts`, hard reject on failure):** (1) format & decode safety (PNG; sandboxed/limited decoder with hard pixel+byte budget vs. decompression bombs; strip ancillary chunks); (2) exact `2048×2048`, sRGB; reject animated PNG; (3) file-size cap (proposed ≤ 4 MB atlas / ≤ 2 MB emissive); (4) UV/class-template match (reject paint outside the class islands / empty body — catches wrong-class and troll uploads); (5) re-encode to canonical PNG (defeats steganography/polyglots) + compute perceptual hash (§6.4).

**Preview render.** A headless worker renders the candidate on the target rig at low+high tiers via the existing `CharacterVisual.setSkin()` path and stores 2–3 thumbnails. Moderators and buyers see thumbnails — never the raw upload. Submitting flips `draft → review`.

### 6.3 Moderation / review (NEW — no asset moderation exists today)

Today `server/moderation_db.ts` only handles **player reports** (`player_reports`, `REPORT_REASONS`, surfaced in the admin Moderation tab via `renderModerationQueue`, route `/admin/api/moderation/queue`, `src/admin/main.ts:72`). We **extend** that subsystem, not build a parallel one.

**State machine** (`status` on `creator_skins`):

```
draft ──submit──▶ review ──approve──▶ live ──delist──▶ delisted
                    │                  │
                    └──reject──▶ rejected   └──takedown──▶ removed
```

- `review` — passed automated validation, awaiting a **human approval gate**. **No skin is purchasable before a human approves.**
- `live` — appears in the marketplace and the dynamic registry.
- `rejected` — failed human review with a reason; creator may revise & resubmit.
- `removed` — post-publish takedown (DMCA, late IP, fraud).
- `delisted` — creator-initiated removal from sale (existing buyers keep the skin).

**Admin surface.** A new **"Creator skins"** tab (`admin.html` + `src/admin/main.ts`) with a `renderCreatorReviewQueue` in `src/admin/tables.ts` (mirroring `renderModerationQueue`): preview thumbnails, metadata, perceptual-hash near-dup matches, creator reputation, Approve / Reject(reason) / Request-changes. Logic in a new `server/creator_moderation_db.ts` sibling to `moderation_db.ts`, reusing `pool` + `cleanText`. All `/admin/api/*` routes go through existing admin auth + `apiGet`/`apiPost` (`src/admin/api.ts:57,64`).

**Reviewer rubric (reject for):** IP/copyrighted likeness, trademarks/logos, NSFW, hate symbols, real-person likeness, and **in-game-advantage illusions** (fake health bars, terrain-camo) — reinforcing cosmetic-only. Confirm the written policy text + reviewer roster in §12.

**Takedown (`live → removed`).** The skin is immediately delisted and the registry stops serving its asset (renderer falls back to default — never an error). Buyer handling: by default the **grant is retained** in `AccountCosmetics` so the character isn't visually bricked (asset 404s → silent fallback); for IP/legal removals where continued display is unlawful, the entitlement is marked `revoked` (forced fallback). Refunds are out (all sales final, §3.6/§8.6) — any remedy is a separate platform-funded forward payment, and the burn is never unwound. A removal increments a creator reputation strike (§6.4).

**Audit log.** Every state transition (who/when, reason, note) is appended to `creator_skin_audit` (append-only). The legal/forensic record for takedowns and payout disputes.

### 6.4 Anti-abuse at the pipeline level

- **Stolen art.** Not fully auto-detectable. Mitigations: human review gate, a "report this skin" path funneling into the existing report system (extend `REPORT_REASONS` with `stolen_art`/`ip_violation`), a DMCA takedown route → `removed`, and creator attestation-of-originality on submit (audit-logged).
- **Duplicate / near-duplicate.** Store perceptual hash + exact SHA-256 per row; on submit, Hamming-distance against live/approved hashes; flag near-dups for the reviewer (don't auto-reject — palette swaps are legitimate). Threshold confirm in §12.
- **Creator reputation.** Approvals/rejections/takedown strikes/report counts; low reputation → mandatory review; strike threshold → submission suspension. Confirm thresholds + whether a trusted tier exists.
- **Rate limits.** Per-account submission caps (proposed: ≤ 25 live, ≤ 5 in review, ≤ 10/day) + nonce TTL cap queue-flooding and wallet-link brute force.
- **Wash/self-buy & manufactured burn optics.** A creator self-buying pays 100% and recovers only 70% — losing the 30% + fees, so it's structurally net-negative (no payout to farm). Still monitor buyer==creator and funding-graph linkage; **never leaderboard-rank the burn ledger by volume** (so clout-farming the burn isn't rewarded). Full economic-abuse treatment in §8.8.

### 6.5 Records & surfaces

Per sale: an `onchain_payments` row (the inbound split tx, replay-guarded) and a `marketplace_sales` row (the business-level sale, §7). Surfaces: a **creator earnings dashboard** (lifetime sales, gross, 70% earned, payout history with explorer links, per-skin breakdown — and "$WOC your sales have burned") and the **public burn ledger** (§3.4, shared with PR #469).

---

## 7. Data model (consolidated SQL)

SQL stays in `server/db.ts` / `*_db.ts` (refine against existing conventions; siblings: planned `agent_entitlements`). All on-chain token amounts are stored as `BIGINT` base units (matching `getTokenBalance`'s `bigint`); USDC = 6 decimals, treated as $1.00.

```sql
-- REUSE (planned, eliza RFC): verified wallet links. Creator payout + buyer payer binding both use this.
CREATE TABLE account_wallets (
  account_id  INTEGER NOT NULL REFERENCES accounts(id),
  chain       TEXT NOT NULL DEFAULT 'solana',
  address     TEXT NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chain, address)               -- one wallet cannot back two accounts (anti-collusion)
);

-- REUSE (planned, eliza RFC): inbound on-chain payments; the replay guard.
CREATE TABLE onchain_payments (
  account_id INTEGER NOT NULL REFERENCES accounts(id),  -- the PAYER (entitlement binds here)
  chain      TEXT NOT NULL DEFAULT 'solana',
  tx_sig     TEXT NOT NULL,
  from_addr  TEXT NOT NULL,
  to_addr    TEXT NOT NULL,
  amount     BIGINT NOT NULL,
  mint       TEXT NOT NULL,
  reference  TEXT NOT NULL,             -- == quoteId / memo
  status     TEXT NOT NULL,
  UNIQUE (chain, tx_sig)                -- replay guard
);

-- NEW: dynamic, DB-backed skin registry. The opaque id the sim carries is creator_skins.id (UUID).
CREATE TABLE creator_skins (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_account_id INTEGER NOT NULL REFERENCES accounts(id),
  name               TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  skin_catalog       TEXT NOT NULL,                 -- 'class' | 'mech' (matches Entity.skinCatalog axis)
  target_class       TEXT,                          -- required when skin_catalog='class'
  asset_url          TEXT,                          -- content-addressed CDN URL; null until validated
  emissive_url       TEXT,                          -- optional, high-tier only
  preview_urls       JSONB NOT NULL DEFAULT '[]'::jsonb,
  price_usd_cents    INTEGER NOT NULL,
  status             TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','review','live','rejected','delisted','removed')),
  phash              BYTEA,                          -- perceptual hash (near-dup)
  sha256             BYTEA,                          -- exact-dup guard / integrity
  reject_reason      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX creator_skins_status_idx  ON creator_skins(status);
CREATE INDEX creator_skins_creator_idx ON creator_skins(creator_account_id);

-- NEW: append-only moderation/audit trail.
CREATE TABLE creator_skin_audit (
  id             BIGSERIAL PRIMARY KEY,
  skin_id        UUID NOT NULL REFERENCES creator_skins(id),
  actor_admin_id INTEGER,                            -- null = automated/system
  from_status    TEXT,
  to_status      TEXT NOT NULL,
  reason_code    TEXT,
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- NEW: business-level sale (joins a confirmed inbound split payment to a granted cosmetic).
CREATE TABLE marketplace_sales (
  id               BIGSERIAL PRIMARY KEY,
  skin_id          UUID NOT NULL REFERENCES creator_skins(id),
  buyer_account_id INTEGER NOT NULL REFERENCES accounts(id),
  quote_id         TEXT NOT NULL,                    -- == onchain_payments.reference / memo
  gross_usdc       BIGINT NOT NULL,                  -- base units, USDC
  creator_usdc     BIGINT NOT NULL,                  -- 70%
  burn_usdc        BIGINT NOT NULL,                  -- 30% → burn pool
  pay_tx_sig       TEXT NOT NULL,                    -- buyer atomic split tx
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','settled','refunded')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pay_tx_sig)                                -- one sale per inbound payment (replay guard)
);

-- NEW: burns ledger — shared by marketplace + copper-fee (#469) via `source`. The public proof.
CREATE TABLE burn_batches (
  batch_id     TEXT PRIMARY KEY,
  usdc_in      BIGINT NOT NULL,
  woc_bought   BIGINT NOT NULL DEFAULT 0,
  woc_burned   BIGINT NOT NULL DEFAULT 0,
  buy_tx_sig   TEXT UNIQUE,
  burn_tx_sig  TEXT UNIQUE,
  source       TEXT NOT NULL,                         -- 'marketplace' | 'copper_fee'
  status       TEXT NOT NULL                          -- 'swapping' | 'swapped' | 'burning' | 'burned' | 'failed'
               CHECK (status IN ('swapping','swapped','burning','burned','failed')),
  idem_ref     TEXT NOT NULL UNIQUE,                  -- durable idempotency / nonce (written BEFORE signing)
  executed_at  TIMESTAMPTZ
);
```

**`AccountCosmetics` extension** (`accounts.cosmetics` JSONB, `normalizeAccountCosmetics`, `server/db.ts:~221`):

```ts
interface AccountCosmetics {
  completedQuestIds: string[];
  mechChromaIds: number[];
  ownedCreatorSkinIds: string[];     // NEW — purchased/unlocked (denormalized projection of settled marketplace_sales)
  authoredCreatorSkinIds: string[];  // NEW — auto-owned on approval; for the creator dashboard
}
```

Wire both new arrays through the existing `uniqueStrings` helper (dedup, drop empties). Ownership is granted on `marketplace_sales.status='settled'` via a new `grantCreatorSkin(accountId, skinId)` (sibling to `grantMechChroma`/`grantQuestCosmetic`). The opaque `creator_skins.id` is exactly the string the sim carries through snapshots without resolving (§5.2).

**Endpoints (selected):** creator link-wallet challenge/verify; `POST /api/creator/skins` (+ `/:id/asset`, `/:id/submit`, `/:id/price`); `GET /api/creator/earnings`; public `GET /api/marketplace/skins`, `GET /api/marketplace/burn-ledger`, `GET /api/skins/registry`; buy `POST /api/marketplace/skins/:id/quote`; admin `/admin/api/creator-skins/{queue,:id,:id/approve,:id/reject,:id/takedown}`.

---

## 8. Regulatory, legal & abuse

> **This section is GATING.** Nothing ships until §8.9 is signed off in writing by qualified counsel. Engineering may build behind a feature flag, but the marketplace must not accept a single live USDC payment, route a creator payout, or execute one on-chain buy-and-burn until counsel clears the launch posture. This is a **hard gate.** Tying real USDC revenue to an on-chain token burn moves the project from "in-game economy" (PR #469, Reg-risk Low) into "real-money product touching a tradable SPL token" — a categorically higher-risk regime. This section is written to be honest about the risk, not to argue it away.

### 8.1 Why this is materially higher-risk than PR #469

| Dimension | PR #469 (copper-fee burn) | This marketplace |
|---|---|---|
| Money in | In-game **copper** (no real value) | **USDC** (fiat-pegged, real value) |
| Burn funding | A share of an in-game **sink** | A fixed **30% of real USDC revenue** |
| Counterparty | The sim (no external party paid) | **Creators + buyers** spending/receiving real money |
| Token nexus | Indirect (copper → $WOC conceptual) | **Direct:** buyer dollars → market-buy $WOC → burn |
| Reg-risk | **Low** | **High** — securities, MSB, KYC/AML, tax, consumer, IP all live |

The elevating fact: **real USD-equivalent value flows in, and a fixed fraction is used to reduce the supply of a publicly-traded token.**

### 8.2 Securities / Howey risk (the headline risk)

**Stated plainly.** Under *Howey*, an investment contract exists if there is (1) an investment of money, (2) in a common enterprise, (3) with a reasonable expectation of profit, (4) derived predominantly from others' efforts. A revenue-funded buy-and-burn is exactly what a regulator can point to for (3)/(4): "the team takes marketplace revenue to shrink token supply, designed to push price up; holders expect to profit from the team's continued operation." Calling it a "burn" doesn't dissolve this — mechanically it is a programmatic, revenue-funded supply reduction tied to the team's efforts. **This is the highest-severity exposure in the feature** and the primary reason §8.9 is a gate. It is worsened here by three traits: the burn is *automatic and proportional to sales*, *publicly observable on-chain*, and *operated by the project*.

**Mitigations (necessary, NOT sufficient; none is a legal opinion):**

- **Operate the burn as a deflationary utility sink, never a yield/dividend/buyback-for-holders.** No `$WOC` is distributed; it is destroyed. No pro-rata payment, staking reward, or revenue share.
- **No promise, projection, or marketing of price appreciation.** Hard ToS + product ban: no "deflationary = number go up," no editorializing burn dashboards, no roadmap implying the team will support price. A **raw, factual** ledger (tx sigs, amounts) is fine; *interpretation* of it is not.
- **Do not market `$WOC` as an investment.** It is positioned strictly as cosmetic-access/utility within WoC. The buyer's value proposition is "I get a cosmetic," not "I'm funding a burn."
- **Decouple buyer benefit from the burn.** The buyer receives a fixed deliverable (the skin) regardless of burn outcome — weakening the buyer's "expectation of profit" prong.
- **Counsel sign-off is the hard gate (§8.9, D-1/D-8).** If counsel finds the buy-and-burn materially increases `$WOC`'s securities risk, the **fallback** is to route the 30% to a **non-token destination** (operating/grants treasury or creator-support pool), keeping the marketplace shippable while severing the token nexus.

**Note on the copper-sink analogy.** *(Adversarial fix.)* The copper sink (`MARKET_CUT = 0.05`, `src/sim/sim.ts:207`, destroyed-not-accrued) is useful **only** as an engineering/design-intent reference for *where the fee conceptually goes* — it is **explicitly NOT a legal analogy.** For securities purposes the two are **categorically different** (§8.1: virtual no-value token vs. real USDC shrinking a publicly-traded token); the analogy carries **zero weight** in the Howey analysis.

**Residual risk after mitigation: still HIGH.** Framing reduces but does not eliminate Howey exposure. Counsel's opinion is the actual gate.

### 8.3 Money transmission / MSB risk

**The risk.** Accepting a buyer's funds and forwarding value to a creator can be **money transmission** (FinCEN MSB registration + a patchwork of state MTLs — fatal to launch timing). The trigger is custody/control **and** acceptance/transmission/facilitation — not solely whether funds touch a platform address.

**What the recommended design does — and does not — achieve.** *(Adjusted per adversarial review; earlier drafts drifted into false reassurance.)* In Option C the buyer signs **one tx** sending 70% directly to the creator's wallet (never a platform address) and 30% to a narrowly-scoped burn vault. Because the creator's 70% never enters a platform wallet, the strongest custody trigger (moving the creator's money) is **reduced**. But money-transmission analysis can independently turn on **control/facilitation** — a platform that builds the tx, sets the recipient, and conditions delivery on payment may be a transmitter even in a non-custodial split. And **the 30% burn vault is unambiguously platform custody of buyer funds.** We do **not** claim intent-to-destroy is a recognized safe harbor; "destroy is weaker than forward" is **not** asserted — it is an open question for counsel (§8.9, D-2).

```
                         ┌─────────────────────── SIM BOUNDARY ───────────────────────┐
                         │  src/sim/  — pure, deterministic, ZERO web3/network/$ logic │
                         │  carries only an OPAQUE creator-skin id (never resolves it)  │
                         └──────────────────────────────────────────────────────────────┘
                                              ▲ snapshot carries opaque id (server resolves; sim never does)
   buyer wallet ──┐                           │
                  │  ONE atomic tx            │           server/ + bridge/  (ALL money lives here)
                  ├── 70% USDC ───────────────┼────────────────►  CREATOR WALLET   (platform NEVER custodies)
                  └── 30% USDC ───────────────┼────────────────►  BURN VAULT ─► DEX market-buy $WOC ─► SPL burn
                                               │                   (platform custody — the residual MSB surface)
                       verify-payment (server: finalized · exact amounts · owner/mint/program · payer-bound · memo · replay)
```

**Strongest available structure (recommended target, not merely a fallback):** a **buyer-signed atomic 3-way split where the swap is composed into the buyer's own transaction** — zero vault custody at all. It is the only structure that actually removes platform custody of the 30%, at the cost of more complex client-side tx building. Adopt it if counsel deems even the burn vault problematic (§8.9, D-2). Note the existing rule: human wallets are **non-custodial**; only *agents* get custodial provisioning (`bridge/src/wallet/provision.ts`), and agents are out of scope for buyer/creator roles here.

### 8.4 KYC / AML

- **Creator payout KYC.** Creators receive real funds → the AML pressure point. Require creator onboarding before paid listing; apply **KYC at a payout threshold** (value/depth = counsel decision, D-3); below it, lighter-touch.
- **OFAC screening of BOTH wallets.** Screen the buyer's paying wallet and the creator's receiving wallet against OFAC SDN before a payment is treated as eligible. `onchain_payments(from,to,...)` records both, exactly what screening + audit need. **Day-one, non-negotiable.**
- **Geofencing.** IP + declared-jurisdiction gate at purchase and onboarding. Exclusion list = counsel decision (D-4); default-conservative (**small allow-list**, not a large deny-list).
- **VPN posture (honest).** IP geofencing is evadable; we do not represent it as a compliance control. The realistic stack: IP geofence (friction) + jurisdiction attestation in ToS (evasion = revocable breach) + **wallet-level OFAC screening (the hard control a VPN can't bypass)** + elevated payout KYC.

### 8.5 Tax

- **Creator earnings reporting.** Creators are income-earners; the platform may have information-reporting duties (US 1099-NEC/1099-K or equivalents) or at minimum a duty to surface earnings records — even in a non-custodial split, *facilitation* may make the platform a reporting party (D-5).
- **Record-keeping (immutable, append-only).** Per sale retain: buyer wallet, creator wallet, USD price, USDC amount, 70/30 split, the split tx sig, the swap sig, the burn sig, timestamp, jurisdictions. `onchain_payments` + the new marketplace tables capture this; `UNIQUE(chain,tx_sig)` enforces non-duplication. Retention period with counsel (commonly 5+ years).
- **Disclosure.** ToS makes creators responsible for their own taxes; prices are set/received in USD-equivalent USDC.

### 8.6 Consumer protection & payments

- **Irreversible, all sales final.** USDC transfers can't be reversed; no card chargeback. The refund policy is written for irreversibility (**all sales final**, disclosed prominently *before* purchase). Any discretionary remedy is a *new forward payment* from a designated source — never a reversal — with exactly which cases qualify spelled out (D-6).
- **Burn fires only on settled sales.** Never on pending/unconfirmed. A settled sale later given a discretionary remedy does **not** unwind the burn (you cannot un-burn) — a reason to keep remedies narrow.
- **Point-of-sale disclosures (before the buyer signs):** USD price, payment is USDC on Solana, irreversible/all-sales-final, that 30% funds a `$WOC` buy-and-burn (**factual, not an investment benefit** — §8.2), exactly what they receive (a power-neutral cosmetic), and the IP/takedown caveat.
- **Depeg note.** Price is set in USD and charged in USDC base units 1:1; we treat USDC as $1.00 and document depeg risk (§3.1, §12).

### 8.7 IP & content

UGC is new to WoC (today all skins are hand-authored, compiled in — no upload/moderation/registry path). Classic UGC IP/content risk applies:

- **Infringing art.** Required: a **DMCA notice-and-takedown** process with a registered agent, published address, counter-notice handling, and a **repeat-infringer policy** (deplatforming). Takedown propagates through the dynamic registry: pull the CDN asset, mark the row revoked, renderer stops serving on the next snapshot/load. Because the sim only carries an **opaque id** and never resolves it, takedown is purely a server/registry+CDN operation — the sim never changes (D-7).
- **NSFW / prohibited.** Content policy + **pre-publication moderation** (§6.3). Cosmetic art is uniquely visible — identity fields sync to everyone within ~120 yd, so a bad asset is seen by bystanders, raising the bar above ordinary UGC.
- **Trademark.** Screen logos/brand names in titles/metadata; takedown covers post-publication discovery.
- **Creator warranties & indemnity.** ToS: IP-ownership warranty, license to host/display/sell, infringement indemnity.

### 8.8 On-chain & economic abuse

- **Wash / self-buy.** A creator self-buying pays 100% and recovers only 70% — losing the 30% + fees. **Structurally net-negative; no payout to farm.** Still flag buyer==creator and funding-graph linkage.
- **Manufactured burn optics.** A creator could self-buy to manufacture burn volume for clout, eating the loss as marketing. Reason the burn ledger is **factual and never volume-leaderboard-ranked** (also reinforces §8.2). Monitor anomalous price/volume per creator vs. genuine demand.
- **Sybil creators / collusion.** KYC at payout threshold defeats the economic motive; account-level (not just wallet-level) creator identity; velocity limits on new-creator paid listings; watch reciprocal-purchase clusters and funding graphs (every hop loses 30% + fees).
- **Replay / double-spend.** Structurally handled: `recordPayment` returns null on consumed `txSig`; `onchain_payments` UNIQUE`(chain,tx_sig)`; the burn is keyed to a settled, non-replayed payment (one payment → one burn-eligible 30% leg, one entitlement).
- **DEX slippage / MEV.** USDC side deep; `$WOC` side managed by `minOut` ceiling + batching + TWAP + skip-and-retry (§3.3). A failed/over-slippage swap defers (USDC stays in the vault, never diverted).
- **Power-neutrality (the load-bearing repo invariant).** Enforced **structurally** (§5.4): skin fields never enter `recalcPlayerStats`'s inputs; the sim carries only an opaque id; equip is the same power-neutral path as today. Any proposed creator-skin attribute that could touch power is rejected at design review. A pay-to-win cosmetic would *also* worsen the securities and consumer posture — this invariant does double duty.

### 8.9 Decisions that REQUIRE legal counsel before build (GATING)

Each must be answered in writing by qualified counsel (securities, money-services/AML, tax as noted) **before** the corresponding code path goes live. Until then, build behind a flag with live payments disabled.

| ID | Decision | Who | Default if unresolved |
|---|---|---|---|
| **D-1** | Is the **revenue-funded $WOC buy-and-burn** acceptable, or does it create unacceptable Howey exposure? If unacceptable, adopt the fallback: route 30% to a non-token destination, ship without the token nexus. | Securities counsel | **Do not ship the burn.** Marketplace stays dark until cleared. |
| **D-2** | Is the **non-custodial atomic split** sufficient to avoid MSB/MTL given control/facilitation? Is the **burn vault** acceptable, or must the swap be composed into the buyer's own tx (zero vault custody)? | Money-services / AML counsel | **No platform custody of any funds** — adopt the zero-vault-custody structure. |
| **D-3** | **KYC threshold for creator payouts** (dollar amount + verification depth). | AML counsel | Conservative low threshold / KYC all paid creators. |
| **D-4** | **Geofencing list** for buyers and creators. | Counsel | Small allow-list (a few cleared jurisdictions), not a deny-list. |
| **D-5** | **Tax reporting** obligations (1099/equivalent) + **retention period**. | Tax advisor + counsel | Capture & retain everything; report conservatively. |
| **D-6** | **Refund policy** wording for irreversible USDC; which discretionary cases qualify; IP-takedown handling given burns can't be unwound. | Consumer/payments counsel | All sales final; no discretionary refunds until cleared. |
| **D-7** | **DMCA agent registration**, takedown/counter-notice, repeat-infringer policy, creator IP warranty + indemnity ToS. | IP counsel | No paid UGC listings until DMCA process live. |
| **D-8** | Is **`$WOC` itself** a security independent of this feature, and does the marketplace amplify that? | Securities counsel | Treat as open; do not amplify. |

**Recommended launch posture (subject to the above):** start small and geofenced; ToS-gated (all-sales-final, no-investment language, jurisdiction attestation, IP warranty+indemnity, tax responsibility, content policy); KYC for payouts over a threshold; OFAC-screen both wallets day one; burn presented factually only; non-custodial by default; counsel sign-off (D-1, D-2 minimum) is the hard gate for enabling live payments.

**Bottom line:** the non-custodial split and the cosmetic-only invariant materially reduce MSB and pay-to-win exposure, and factual framing reduces (but does not eliminate) consumer and securities posture. The **buy-and-burn's securities risk (§8.2) is the irreducible high-severity item** and is gated on D-1/D-8 written opinions.

---

## 9. Phased rollout

Each phase has explicit scope, gating, and exit criteria. **No phase ships pay-to-win; no phase moves money through the sim. Live mainnet payments require §8.9 + §12 sign-off.**

**Phase 0 — Spec & scaffolding (this PRD).** Scope: this document; agree the split, the opaque-id-through-sim design (§5.2), the registry/CDN seam, the schema (§7), and UI surfaces. No production money. Exit: PRD approved; all §12 + §8.9 items resolved; hook points confirmed.

**Phase 1 — Opaque-id carrier + wallet link + USDC pay (devnet).** Scope: the **net-new `cosmeticSkinId` carrier** (sim field, `csk` wire, (de)serialize, render path) end-to-end with a single hand-seeded creator skin; Reown connect; buyer pay against **devnet** USDC; server verify; entitlement grant + equip; the CI cosmetic-only invariant test (§5.4). Split is **manual** (100% to a holding account; 70/30 done off-flow by a maintainer). Gating: internal, devnet. Exit: connect → pay devnet USDC → own → equip → seen by others; replay guard verified; reconciliation matches on-chain; the `recalcPlayerStats`-invariant test is green in CI.

**Phase 2 — Atomic split + batched buy-burn keeper (mainnet, curated creators).** Scope: the 70/30 split executes **atomically** at payment time per the chosen custody model (§4, D-CUSTODY); the **buy-burn `BurnKeeper`** batches USDC, market-buys `$WOC` on **Jupiter**, and SPL-burns it with `minOut` slippage controls + durable intent logging (§4.6). Mainnet USDC. **Allow-listed creators only.** Gating: **§8.9 D-1/D-2 signed; §12 confirmed;** keeper runs with the burn-vault key under op-sec review; slippage/circuit-breaker limits in place. Exit: real mainnet purchase → atomic split → creator paid → batched buy-burn within SLA → public ledger reflects it; no stranded payouts over a soak period; slippage under cap.

**Phase 3 — Open submissions + moderation + dynamic registry at scale.** Scope: open Creator Studio applications; the full upload/automated-validation/human-moderation pipeline (§6); the dynamic DB-backed registry + runtime CDN loading at scale (many skins, no redeploy). Gating: moderation SLA + takedown path live; creator ToS (IP attestation, content policy) accepted at apply; D-7 satisfied. Exit: an external creator applies → passes moderation → goes live → earns, with no maintainer code change; a takedown gracefully de-equips affected buyers to default (no sim involvement).

**Phase 4 — GLB cosmetic bodies + secondary sales/royalty (optional, separate go/no-go).** Scope: Form B GLB bodies (the `'mech'`-style class-agnostic path) behind a geometry-validation pipeline; optional secondary market with creator royalty. Both cosmetic-only. Gating: **D-SECONDARY** in §12 (resale adds custody, royalty enforcement, transferability questions). Exit: a GLB body purchasable/equippable/visible; (if pursued) a resale completes with royalty + burn split.

---

## 10. Success metrics

| Metric | Definition | Why it matters |
|---|---|---|
| **GMV** | Total USDC paid (cumulative + weekly run-rate) | Top-line marketplace health |
| **# live skins** | Approved skins available to buy | Catalog depth / creator supply |
| **# active creators** | Creators with ≥1 live skin and ≥1 sale | Supply-side liquidity |
| **Attach rate** | Share of active players owning ≥1 creator skin | Demand breadth |
| **$WOC burned (USDC→burn)** | Cumulative `$WOC` burned via the 30% + burn rate (7/30-day) | The public ledger headline (factual, never editorialized) |
| **Burn efficiency** | Realized `$WOC` burned per $1 of burn budget vs. naive spot (slippage cost) | Validates Phase 2 slippage controls; guards against bleeding value to MEV/thin pools |
| **Buyer conversion** | Funnel: buy-sheet open → wallet connect → pay → verified | Where friction lives |
| **Wallet-link rate** | Connected wallets completing account-linking | Repeat-purchase enabler |
| **Creator payout reliability** | % of sales where the creator's 70% settled, $0 stranded | Supply-side trust; gates Phase 2 exit |

Phase-gated numeric targets are themselves §12 decisions — set them once Phase 1 devnet gives a baseline funnel; do not pre-commit numbers in spec.

---

## 11. Constraints / invariants (non-negotiable)

1. **`src/sim/` stays pure.** Zero DOM/Three/web3/network imports; never imports `render/ui/game/net/server`; runs unchanged in Node + browser; deterministic 20 Hz; randomness only via `Rng`. The new `cosmeticSkinId` is an **opaque, bounded-length string copied verbatim** — never parsed, resolved, validated, or branched on inside the sim.
2. **All money/web3 lives in `server/` + `bridge/`.** The sim never learns money, USDC, `$WOC`, slippage, a DEX, or a marketplace exist.
3. **Cosmetic-only / no pay-to-win** — guaranteed **structurally**: skin fields never appear in `recalcPlayerStats`'s argument list (`src/sim/sim.ts:927,1335,1354,2190,2932,2951,3058,4205`). Enforced by a CI invariant test. Token/USD utility is appearance/access/convenience only, never power.
4. **`SolanaClient` stays read/verify-only.** Signing (swap/burn) lives behind the separate keeper-only `BurnKeeper` seam, sole holder of the burn-vault key, never injected into the verify/quote path.
5. **On-chain verification binds the payer**, asserts **exact** per-leg amounts, and validates each destination by **owner + mint + token program (Tokenkeg; reject Token-2022)** — never address alone.
6. **All on-chain token amounts are `bigint`** at every boundary (quote legs, confirmed legs, split math, reconciliation). USDC treated as $1.00; depeg documented.
7. **Burns are irreversible and run only on settled sales**, with durable intent logged before signing; recovery resolves by recorded swap sig, never by vault balance.
8. **i18n:** every player-visible chrome string is a `t()` key (English-only PRs legal). Creator free-text is escaped UGC, never a `t()` key.
9. **Tiny dependency set** — only the named `@solana/*` + Jupiter deps, justified by clear need.
10. **No live mainnet money** until §12 (engineering/economic) and §8.9 (legal) are signed off.

---

## 12. Decisions needed before build (CONFIRM-GATE)

Sign off each before the corresponding build. Recommendations in **bold**.

- **D-CUSTODY — Custody model.** **Recommend Option C (hybrid: buyer-signed atomic split + deferred batched burn).** A=custodial/simplest (enables refunds, but custodies creator funds); B=Anchor/trustless (needs audit; v2). If counsel (D-2) rejects even the burn vault, move to the **zero-vault-custody** buyer-composed 3-way split (§8.3).
- **D-DEX — Aggregator.** **Recommend Jupiter** (deep USDC side, routes to whatever `$WOC` pool exists). Confirm a routable `$WOC` pool exists at expected volumes; if thin, the slippage guard throttles burns (acceptable).
- **D-DEX-DEP — Jupiter integration.** **Recommend raw REST via `fetch`** first (keeps the dependency set tiny); add `@jup-ag/api` only if ergonomics demand.
- **D-SPLIT — 70/30 on gross USDC.** **Recommend confirm 70/30**, 30% = `gross - creator` with floor-dust to the burn leg, `bigint` math.
- **D-BATCH — Batch policy.** **Recommend `MAX_SLIPPAGE_BPS=100`, `BATCH_THRESHOLD=$250`, `BATCH_CADENCE=6h`, `MIN_BATCH_USDC=$25` (fee floor), TWAP split above $1,000.** Confirm the fee floor so the cadence trigger never burns more in fees than value swapped.
- **D-FORM — v1 skin type.** **Recommend Form A only (class texture-atlas).** Defer Form B GLB bodies to Phase 4 behind geometry validation.
- **D-IDFIELD — Opaque-id field/wire names.** **Recommend `cosmeticSkinId: string|null` on `Entity`/`PlayerMeta`, wire key `csk`, bounded ≤ 64 chars.** Load-bearing for the sim-purity grep — lock the names now.
- **D-FALLBACK — Unresolvable-skin fallback identity.** **Recommend the target class default body (index 0).**
- **D-VRAM — Resident-skin cap + eviction.** **Recommend a 24-distinct cap + LRU eviction** on the (currently grow-only) URL→texture cache — the one real lifecycle change to the loader.
- **D-LAUNCH — Curated vs open launch.** **Recommend curated allow-list for Phases 1–2**, open submissions in Phase 3 only after the moderation SLA + takedown path are live.
- **D-MINPRICE / depeg.** **Recommend `MIN_PRICE_USD=$1.00` as a UX/spam floor** (not swap economics) and **treat USDC as $1.00, document depeg.**
- **D-PR469-NOW — Implement #469's copper-fee burn now or later?** **Recommend later** — ship the marketplace flagship first; both already share the `burn_batches` ledger via `source`, so #469 slots in without rework. (The companion stub `docs/prd/woc/market-fee-woc-burn.md` sits beside this doc in PR #469.)
- **D-LEGAL — Counsel gate.** **Recommend treat §8.9 (D-1…D-8) as a hard blocker for any mainnet money;** D-1 (securities) and D-2 (MSB) are the minimum to enable live payments.
- **D-GEO — Geofencing posture.** **Recommend a small allow-list (default-deny), wallet-level OFAC screening day one**, IP geofence as friction only (pending D-4).
- **D-SECONDARY — Secondary sales/royalty (Phase 4).** **Recommend separate go/no-go** — defer; resale adds custody, royalty enforcement, and transferability questions.

---

## 13. Acceptance criteria per phase

**Phase 1 (devnet):**
- `cosmeticSkinId` exists on `Entity`/`PlayerMeta`, rides the wire as `csk` gated by `hasIdentity`, (de)serializes correctly, and the sim copies it verbatim with no branch on its value.
- A determinism test: replaying an identical command stream (including a `change_skin` with a `cosmeticSkinId`) yields byte-identical sim state across server/offline/headless.
- The CI cosmetic-only invariant test passes: `recalcPlayerStats` output is invariant under every `setPlayerSkin` permutation.
- A buyer can connect (Reown) → pay devnet USDC → server verifies (payer-bound, exact amounts, owner/mint/program) → own → equip → be seen by others within ~120 yd on the next snapshot.
- Replay: re-POSTing the same `tx_sig` is idempotent (no double-grant); a different account cannot claim someone else's payment.
- Unresolvable/missing id renders the class-default fallback with no error.

**Phase 2 (mainnet, curated):**
- §8.9 D-1/D-2 written sign-off on file; §12 confirmed; feature flag flipped only after both.
- An atomic split tx pays the creator's **current** verified wallet exactly 70% and the burn vault exactly 30%; verification rejects stale-wallet, wrong-mint, Token-2022, partial, over-payment, and quote-substitution.
- The `BurnKeeper` batches per policy, executes a Jupiter swap with `minOut`, SPL-burns, and writes a `burn_batches` row with both signatures; intent is logged before signing; a simulated crash between swap and burn recovers by recorded sig (no double-swap).
- Reconciliation: Σ(verified 30% legs) − Σ(USDC swapped) == vault balance; Σ(`$WOC` bought) == Σ(`$WOC` burned) within rounding; drift alerts.
- Public burn ledger renders factual rows linking to explorer; no stranded creator payouts over the soak period.

**Phase 3 (open):**
- An external creator: link wallet → upload → pass automated validation → human approval → live in the registry → earn, with no maintainer code change.
- Automated validation hard-rejects wrong dimensions/format/oversize/decompression-bomb/wrong-class; assets are re-encoded canonically and content-addressed.
- A takedown pulls the CDN asset, marks the row removed/revoked, and gracefully de-equips affected buyers to default on their next registry refresh — no sim change, no disconnect.
- OFAC screening blocks a sanctioned wallet on either side before entitlement.

**Phase 4 (optional):** a Form B GLB body passes geometry validation, is purchasable/equippable/visible; (if pursued) a resale honors royalty + burn split.

---

## 14. Out of scope

Custodial wallets for human players (agents-only, `bridge/src/wallet/provision.ts`); a fiat on-ramp (guidance only); auto-swapping a buyer's other tokens into USDC; an on-chain Anchor split program (Option B, v2 north star); Form B GLB creator bodies and animated/shader skins (Phase 4); secondary sales/royalties and skin transferability (Phase 4, separate go/no-go); per-region pricing; localizing creator free-text; PR #469's copper-fee→$WOC burn implementation itself (shares this ledger via `source` but is a separate sim/server change — see the companion stub `market-fee-woc-burn.md`); marketing/interpretive burn dashboards (banned by §8.2 — factual ledger only).

---

*Provenance: merged from six expert draft sections (tokenomics, on-chain, engine, creator pipeline, legal, product) with all adversarial blocker/major fixes applied — notably the net-new opaque-id carrier (no pre-existing string path in the sim), exact-amount/owner/mint/program/payer-bound verification, the read-only `SolanaClient` vs. keeper-only `BurnKeeper` split, durable intent-logged burn recovery, `bigint` money math, the structural (not gate-based) cosmetic-only guarantee, the all-sales-final reconciliation replacing the settlement-hold model, and the honestly-qualified flywheel and MSB language. Grounded against `world-of-claudecraft` @ `feature/eliza-agents`.*
