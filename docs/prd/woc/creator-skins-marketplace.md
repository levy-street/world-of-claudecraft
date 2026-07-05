# Creator skins marketplace + buy-and-burn

> **STATUS: IMPLEMENTED on `feature/woc-skins-marketplace`.** Players buy curated
> creator skins for USDC on Solana in a single non-custodial atomic transaction
> split 70% creator / 30% burn vault; the server verifies the finalized on-chain
> payment and grants the cosmetic. A separate, mainnet-only keeper drains the
> burn vault, swaps the accrued USDC for $WOC on Jupiter, and SPL-burns it,
> recording every batch in a public ledger. Skins are cosmetic-only; equip is
> server-authoritative on ownership.
>
> **`file:line` anchors below drift as the tree moves — re-verify against code,
> which is the source of truth (`docs/CLAUDE.md`).**

| | |
|---|---|
| **Tier** | 2 - Real sinks |
| **Ease** | 2/5 |
| **Flywheel** | 5 |
| **Sustainability** | Sink (buy-and-burn) |
| **Reg risk** | Medium |

## What
A buyer purchases a curated creator skin priced in USDC. The client builds one
atomic Solana transaction with **two** SPL `TransferChecked` legs — 70% to the
creator's wallet, 30% to a burn vault — plus a memo carrying the quote id. The
server never touches funds (custody **Option C**: non-custodial atomic split); it
only verifies that a *finalized* on-chain transaction exactly realises a
server-issued quote, then grants the cosmetic to the account. The 30% accrues in
the burn vault; a separate keeper periodically swaps it for $WOC on Jupiter and
burns the $WOC, publishing a factual burn ledger.

The skin itself is carried through the sim as an **opaque** `cosmeticSkinId`
string the sim stores and syncs but never interprets; the renderer resolves it to
a CDN asset via the public registry. Equipping is gated server-side on ownership —
selecting a skin can never grant it.

## Why it's a flywheel
High flywheel: paid cosmetics create a creator economy (70% creator payout draws
content), and the 30% buy-and-burn makes every purchase deflationary for $WOC, a
transparent, on-chain demand sink whose effect anyone can audit in the public
ledger.

## Economic model (fixed 70/30, price-independent)
- Creators set the price; the **split is fixed at 70/30** regardless of price —
  `SPLIT_CREATOR_BPS = 7000n` (`server/marketplace.ts:25`).
- All money math is **bigint USDC base units (6 decimals)**. The creator share
  *floors*; the burn share takes the remainder, so rounding **dust accrues to the
  burn pool** and not a single base unit is lost — `splitAmounts`
  (`server/marketplace.ts:43`).
- Payment is in USDC (`USDC_MINT`, `server/marketplace.ts:22`). The 30% buys $WOC
  off Jupiter and burns it (Phase 2 keeper).

## Custody — Option C (non-custodial atomic split)
The server is **never** in the funds path. The buyer's own wallet is the sole
signing authority and funds both legs in one transaction; the creator and burn
vault are paid directly on-chain. The server's only role is to issue a quote and
verify the resulting finalized transaction. The burn-vault signing key is held
**only** by the keeper (Phase 2), never by the quote/verify path, so a compromise
of the purchase path cannot move funds.

## Phases
- **Phase 1 — purchase / verify / grant (devnet-capable).** The opaque-id carrier,
  the USDC split payment, on-chain verification, the grant, and the
  server-authoritative equip gate. Runs on any cluster the client + server are
  pointed at; default is devnet (`VITE_MARKETPLACE_RPC_URL` / `VITE_MARKETPLACE_CHAIN`,
  `src/net/wallet.ts:399`). Phase 1 ships with a **curated** skin catalog: rows are
  seeded `live` by an operator (`creator_skins`, `server/db.ts:277`); an open
  submission + moderation pipeline is a later phase.
- **Phase 2 — buy-and-burn keeper (mainnet-only).** Drains the burn vault on a
  cadence, swaps USDC→$WOC on Jupiter v6, SPL-burns the $WOC, and records each
  batch. Jupiter is mainnet-only, so the live path runs only on a funded mainnet
  deployment; the orchestration is unit-tested headlessly via injected fakes.

## Requirements

### FR-1 — Opaque cosmeticSkinId carrier (Phase 1)
- `Entity.cosmeticSkinId: string | null` is carried by the sim, stored/synced but
  **never interpreted** — `src/sim/types.ts:120` (`MAX_COSMETIC_SKIN_ID_LEN = 64`),
  `src/sim/types.ts:922`; `src/sim/sim.ts:425`.
- `setPlayerSkin` writes appearance only and never derives stats — a skin can
  never affect power (`src/sim/sim.ts:1065`).
- Renderer resolves the opaque id to an asset via the public registry entry
  `CreatorSkinRegistryEntry` (`src/world_api.ts:274`), fetched from
  `GET /api/skins/registry` (`src/net/online.ts:225`).
- Account ownership lives in `AccountCosmetics.ownedCreatorSkinIds`, normalized in
  the shared seam `normalizeAccountCosmetics` (`src/world_api.ts:249`) so client and
  server can't drift.

### FR-2 — Quote issuance
- `POST /api/marketplace/skins/:id/quote` requires an active bearer account, a
  *live* skin, and a linked Solana wallet (the payer); returns the two split legs
  + memo (`server/main.ts:650`).
- `quotePurchase` pins the destination owners (creator wallet + burn vault) and
  exact leg amounts, persists a short-TTL quote (`QUOTE_TTL_MS = 5 min`), and
  returns it; the memo the client must embed **is** the `quoteId`
  (`server/marketplace.ts:54`). It fails fast on a malformed creator payout wallet.
- The marketplace is **unavailable** unless a real burn-vault address is configured
  — `marketplaceEnabled` (`server/marketplace.ts:30`); both endpoints return 503
  otherwise.

### FR-3 — Client split-payment transaction
- `buildSplitPaymentTransaction` builds **exactly** 2 `TransferChecked` legs
  (creator + burn) funded from the buyer's ATA, plus a memo binding the quote id —
  pure/deterministic, the exact shape the server verifier checks
  (`src/net/wallet.ts:462`). Recipient ATAs are not created by the buyer tx (an
  onboarding precondition, mirrored by the verifier's exactly-two-recipients rule).
- `signAndSendSplitPayment` signs+sends via the Wallet Standard feature and waits
  for **finalized** before returning the signature (`src/net/wallet.ts:479`).
- Payment RPC + chain are a dedicated cluster pair (`MARKET_RPC` / `MARKET_CHAIN`,
  `src/net/wallet.ts:399`); the mainnet $WOC-balance RPC is deliberately **not** a
  fallback so a misconfigured build can't mix clusters.

### FR-4 — On-chain verification (PURE validator + I/O)
- `parseSplitPayment` is a **pure**, mint-generic reducer of a `getTransaction`
  jsonParsed response into per-owner USDC deltas, memo, fee payer, and a
  Token-2022 flag (`server/solana_rpc.ts:83`). `fetchFinalizedTransaction` reads at
  `finalized` commitment (`server/solana_rpc.ts:131`). Both resolve against the
  single `SOLANA_RPC_URL` (`server/solana_rpc.ts:15`).
- `validateSplitPayment` is the pure security heart — every check is a **hard
  equality**, no "≥ price" slack (`server/marketplace.ts:93`):
  - tx must have succeeded; **Token-2022 rejected** outright (transfer hooks/fees
    break "sent == received");
  - fee payer must equal the buyer's linked wallet (`wrong_payer`);
  - memo must equal the quote id (`memo_mismatch`);
  - the three parties must be **distinct** (`owners_not_distinct`);
  - creator delta `==` `creatorUsdc`, burn delta `==` `burnUsdc`, buyer delta
    `==` `-(creator+burn)` (exact amounts, no over/short);
  - **no third party may receive** USDC (`extra_recipient`).
- `verifyPurchase` wraps the I/O around the pure validator: load quote, check TTL
  + buyer, fetch finalized tx, parse, validate, then redeem
  (`server/marketplace.ts:127`).

### FR-5 — Grant, replay guard, idempotency
- `POST /api/marketplace/buy` verifies and, on success, refreshes live in-memory
  cosmetics so an online buyer can equip without reconnecting
  (`server/main.ts:672`; `game.applyCreatorSkinGrant`, `server/game.ts:640`).
- `redeemPurchase` does it all in **one transaction**: insert `onchain_payments`
  with the signature as PRIMARY KEY (the **replay guard** — `ON CONFLICT DO NOTHING`
  → `false` on replay), record `marketplace_sales`, append the skin id to the
  account's `ownedCreatorSkinIds` under a row lock, and delete the quote
  (`server/db.ts:1339`). A replayed signature returns `already_redeemed` rather than
  double-granting; a mid-way failure rolls back so a paid buyer is never stranded
  with a consumed signature and no cosmetic.

### FR-6 — Server-authoritative equip gate
- The `change_skin` creator branch resolves the requested `csk` to `null` unless
  it is a bounded id (`≤ MAX_COSMETIC_SKIN_ID_LEN`) the account **actually owns**;
  a forged, unowned, or oversized id is dropped (`server/game.ts:1180`). Equipping
  can never grant a cosmetic, only select an owned one.

### FR-7 — Buy-and-burn keeper (Phase 2, mainnet-only)
- **Policy** (`server/burn_policy.ts`, defaults at `:17`): `$250` threshold / `$25`
  fee-aware floor / `6h` cadence / TWAP split above `$1000` into `$250` chunks /
  `1.00%` (100 bps) max slippage. `shouldRunBatch` triggers on threshold **or**
  cadence but **never** below the floor (`burn_policy.ts:32`); `planTwapChunks`
  conserves the total exactly (`burn_policy.ts:44`). Each knob is env-overridable
  via `envPolicy` (`server/burn_keeper.ts:37`).
- **Dependency-injected state machine.** `BurnKeeper` orchestrates over an injected
  `BurnExecutor` / `BurnStore` (`server/burn_keeper.ts:93`), fully unit-tested with
  fakes; `buildProductionDeps` is the thin real wiring — **Jupiter v6 REST +
  `@solana/web3.js` signing + raw RPC** — and the **only** code that touches the
  burn-vault key (`server/burn_keeper.ts:228`).
- **State machine:** `swapping → swapped → burning → burned | failed`
  (`burn_batches.status`, `server/db.ts:340`). Durable intent (`batch_id` +
  pre-signed `buy_tx_sig`) is written **before** broadcast (`createBurnBatch`,
  `server/db.ts:1418`; target-less `ON CONFLICT DO NOTHING` arbitrates both the PK
  and the `buy_tx_sig` UNIQUE).
- **Crash recovery by recorded signature.** `recover` resolves in-flight batches by
  re-confirming their recorded buy/burn signature — **never** by re-reading the
  vault balance, which could double-swap a lost-confirmation swap
  (`server/burn_keeper.ts:156`). A `swapping`/`burning` batch past `STALE_MS`
  (10 min) is treated as never-landed. `$WOC` received is measured from the swap tx
  (restart-safe), then exactly that is burned (`completeSwapped`, `:138`).
- **Single-batch serialization.** A cycle finishes recovering any open batch before
  starting new work, so two batches never run against the same vault pool
  (`runCycle`, `server/burn_keeper.ts:107`).
- **Chain-enforced slippage.** The `maxSlippageBps` cap rides into Jupiter's
  `otherAmountThreshold` and is enforced on-chain (the swap reverts), not by
  trusting the quoted out-amount (`quote` / `signSwap`, `server/burn_keeper.ts:242`).
- **Burn** is SPL `BurnChecked` (tag 15) from the vault's $WOC ATA
  (`burnCheckedIx`, `server/burn_keeper.ts:190`).
- **Gating.** `keeperConfigured` requires a valid burn vault **and** its signing
  secret (`server/burn_keeper.ts:60`); absent the secret, purchases still settle
  (the 30% accrues) but nothing is swapped/burned. `buildProductionDeps` asserts the
  secret's pubkey equals `MARKETPLACE_BURN_VAULT` (`:230`).
- **Boot.** `buildBurnKeeper` (`:313`) returns null unless configured; `main.ts`
  ticks it on boot (recovers-then-runs) and every `KEEPER_TICK_MS` (5 min default,
  `BURN_KEEPER_TICK_MS`) (`server/main.ts:731`). Reads **and** broadcasts use the
  single `SOLANA_RPC_URL` — there is no separate burn RPC.

### FR-8 — Public burn ledger (transparency surface)
- `GET /api/marketplace/burn-ledger` returns completed burns + cumulative
  `wocBurned` / `usdcIn` totals; **no editorializing** — raw amounts +
  explorer-verifiable tx signatures only (`server/main.ts:637`; `burnLedger`,
  `server/db.ts:1471`; client `Api.burnLedger`, `src/net/online.ts:242`).

## Data model
`creator_skins`, `marketplace_quotes`, `onchain_payments` (the per-signature
replay guard), `marketplace_sales`, and `burn_batches` — all defined in `SCHEMA`
(`server/db.ts:277`–`:355`). `marketplace_sales.pay_tx_sig` is UNIQUE and
references `onchain_payments(tx_sig)`. Ownership is persisted in
`accounts.cosmetics` JSONB (`ownedCreatorSkinIds`).

## Acceptance criteria
- A short, over, wrong-mint, wrong-recipient, forged-memo, wrong-payer, or
  Token-2022 payment is **rejected** by `validateSplitPayment` (each maps to a
  distinct `SplitVerifyReason`). Only an exact 70/30 split paid by the buyer's
  linked wallet with the matching memo returns `ok`.
- Replaying a settled signature returns `already_redeemed`; the skin is granted at
  most once and the account's `ownedCreatorSkinIds` is idempotent.
- Equipping an unowned/forged/oversized `cosmeticSkinId` resolves to `null`; the
  built-in skin still applies. Stats are unchanged by any skin.
- With no burn vault configured, quote/buy return 503; with a vault but no keeper
  secret, purchases settle and the 30% accrues but no burn occurs.
- A keeper crash mid-swap or mid-burn recovers by re-confirming the recorded
  signature on the next cycle, never double-swapping; a stale unconfirmed tx is
  failed (swap) or re-issued (burn).
- TWAP chunks of a drained pool sum exactly to the pool; slippage past the cap
  reverts the swap on-chain.
- The burn ledger exposes only factual amounts + tx signatures.

## Constraints (non-negotiable)
- **Cosmetic-only / no pay-to-win** — a skin is appearance only; `recalcPlayerStats`
  never reads skin fields.
- **Non-custodial** — the chain owns assets; the server only verifies. `src/sim/`
  stays pure and deterministic and never interprets `cosmeticSkinId`.
- **Server-authoritative equip** — ownership is the only gate.

## Security properties
- Server-authoritative equip (ownership allow-list, bounded id).
- On-chain **hard-equality** verification on a finalized tx; Token-2022 rejected.
- Per-signature **replay guard** (`onchain_payments` PK) with atomic redeem.
- The keeper is the **sole** holder of the burn-vault key; it is never injected
  into the quote/verify path. Reads and broadcasts share one RPC URL so a confirm
  can't look at a different cluster than the one a swap was sent on.

## Operator runbooks
- Phase 1 manual purchase + render verification on devnet:
  `docs/runbooks/marketplace-devnet-buy.md`.
- First mainnet activation of the buy-and-burn keeper:
  `docs/runbooks/marketplace-mainnet-keeper.md`.
- Environment: the marketplace + keeper block in `.env.example` (`USDC_MINT`,
  `MARKETPLACE_BURN_VAULT`, `MARKETPLACE_BURN_VAULT_SECRET`, `JUPITER_API`, the
  `BURN_*` policy knobs, `VITE_MARKETPLACE_RPC_URL` / `VITE_MARKETPLACE_CHAIN`).
  The keeper reads and broadcasts on `SOLANA_RPC_URL`; there is **no** separate
  burn RPC.

## Open questions
- When does the curated Phase 1 catalog open to a self-serve creator submission +
  moderation pipeline?
- Final burn policy values (threshold / floor / cadence / slippage) for the live
  mainnet launch?
- Should the burn ledger surface in-flight (`swapping`/`burning`) batches, or only
  completed burns as it does today?

## Out of scope
Open creator submission/moderation, secondary resale/transfer of owned skins,
refunds/chargebacks, multi-token pricing, and any gameplay-stat effect remain out
of scope for this feature.
