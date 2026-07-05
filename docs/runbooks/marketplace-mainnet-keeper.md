# Runbook: bringing the buy-and-burn keeper live on MAINNET

Operator guide for the **first** live activation of the buy-and-burn keeper
(`server/burn_keeper.ts`). The keeper drains the marketplace burn vault, swaps
the accrued USDC for `$WOC` on Jupiter, then SPL-burns the `$WOC` and records
each batch in the public ledger (`GET /api/marketplace/burn-ledger`).

This is the one code path that moves **real money**: the burn-vault signing key
can spend the entire 30% buy-and-burn pool. Follow the order below exactly. The
prime directive is: **no real funds move until the read-only path is proven.**

> Why mainnet-only: Jupiter has no devnet, and the default `USDC_MINT` is the
> *mainnet* USDC address (it does not exist on devnet). The keeper therefore
> cannot run on devnet at all — its swap+burn live path runs only against a
> funded mainnet deployment. (The orchestration state machine is exercised
> headlessly in unit tests via injected fakes; this runbook is for the real I/O.)

---

## 0. How the keeper is wired (read this first)

Ground truth from the code, so you know what each env var actually drives:

- **The keeper is a no-op unless it is configured.** `keeperConfigured()` in
  `server/burn_keeper.ts` requires **both** `MARKETPLACE_BURN_VAULT` (a valid
  Solana address) **and** a non-empty `MARKETPLACE_BURN_VAULT_SECRET`. With
  either unset, `buildBurnKeeper()` returns `null`, the boot block in
  `server/main.ts` skips it, and you will **not** see `buy-and-burn keeper
  enabled` in the logs. Purchases still settle and the 30% still accrues in the
  vault — it just never gets swapped/burned.
- **The secret must match the vault.** `buildProductionDeps()` decodes
  `MARKETPLACE_BURN_VAULT_SECRET` (base58) into a `Keypair` and throws
  `MARKETPLACE_BURN_VAULT_SECRET does not match MARKETPLACE_BURN_VAULT` at boot
  if the derived pubkey != the configured vault. A mismatch crashes the server
  on start — by design.
- **One RPC URL for the whole keeper: `SOLANA_RPC_URL`. It must be mainnet.**
  - The keeper reads AND broadcasts on `SOLANA_RPC_URL` (default
    `https://api.mainnet-beta.solana.com`) — the exact same endpoint
    `server/solana_rpc.ts` uses for purchase-payment verification. Reads:
    confirming a signature at `finalized`, measuring `$WOC` received
    (`parseSplitPayment`), reading `$WOC` mint decimals (`getTokenSupply`), and
    reading the vault USDC balance (`getTokenAccountsByOwner`). Broadcast: the
    `@solana/web3.js` `Connection` that sends the signed swap + burn
    (`sendRawTransaction`) and fetches the burn blockhash. Both resolve to the
    same `SOLANA_RPC_URL`, so a confirm can never look at a different cluster
    than where the swap was sent.
  - **Trap:** if you ever pointed `SOLANA_RPC_URL` at devnet for marketplace
    payment testing, the keeper will not work on mainnet — set it back to a
    mainnet endpoint before enabling the keeper. Jupiter is mainnet-only, so
    there is no devnet keeper. The public default is heavily rate-limited; use a
    dedicated provider endpoint (Helius / QuickNode / Triton) in production.
- **Jupiter** (`JUPITER_API`, default `https://quote-api.jup.ag/v6`) supplies
  the USDC→`$WOC` quote and the prebuilt swap transaction. The quote's
  `slippageBps` (`BURN_MAX_SLIPPAGE_BPS`, default 100 = 1%) is baked by Jupiter
  into the swap's `otherAmountThreshold`, so the on-chain swap **reverts** if it
  would receive less than the slippage floor. Slippage is enforced by the chain,
  not by us trusting the quote.
- **Mints.** `USDC_MINT` defaults to mainnet USDC
  `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (6 decimals). `WOC_MINT`
  defaults to `3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth`. `$WOC` decimals are
  read live from chain via `getTokenSupply(WOC_MINT)` — never hardcoded.
- **Cadence.** `BURN_KEEPER_TICK_MS` (default 300000 = 5 min, read in
  `server/main.ts`) is how often `runCycle()` is invoked. The *policy* env
  (`BURN_BATCH_THRESHOLD_USDC`, `BURN_MIN_BATCH_USDC`, `BURN_CADENCE_MS`,
  `BURN_TWAP_SPLIT_ABOVE_USDC`, `BURN_TWAP_CHUNK_USDC`) decides whether a given
  tick actually does anything. All USDC env values are **dollars** (e.g. `250`),
  converted to base units internally.

Batch status progression in `burn_batches` (`server/db.ts`):
`swapping` → `swapped` → `burning` → `burned` (terminal) — or `failed` (terminal).
The public ledger surfaces only `burned` rows.

---

## 1. Prerequisites

Have all of these in hand **before** touching server env:

1. **A dedicated mainnet burn vault keypair.** This is the wallet whose pubkey is
   `MARKETPLACE_BURN_VAULT` and whose base58 secret is
   `MARKETPLACE_BURN_VAULT_SECRET`. Generate it offline; this key is the only
   thing that can move the 30% pool. (See **Safety** below.)
2. **The vault funded for the smoke test:**
   - Its **USDC associated token account (ATA)** holds a few real dollars of
     mainnet USDC (e.g. ~$3–5). The marketplace burn share normally funds this;
     for the very first run you may seed it manually.
   - A little **native SOL** in the vault to pay transaction fees and any ATA
     rent (~0.02 SOL is plenty for a couple of swaps + burns). The keeper signs
     as `feePayer`, so a vault with zero SOL cannot broadcast anything.
3. **The vault secret kept OUT of git.** It lives only in the server's runtime
   secret store / `.env` on the host (which is git-ignored — see
   `CLAUDE.md`: *never commit `.env` or secrets*). Never paste it into a PR,
   a script, a log line, or any code path other than the keeper.
4. **Dedicated mainnet RPC.** A provider endpoint for `SOLANA_RPC_URL` (the
   keeper's one RPC, for both reads and broadcast). Confirm it is mainnet-beta.
5. **A confirmed Jupiter route exists** for `USDC → $WOC` at your size and
   slippage. If `$WOC` liquidity is thin, the keeper's `quote()` returns "no
   route" and the batch simply does not run (USDC stays in the vault, retried
   next cycle — no funds lost). You verify this in Step 1; do not skip it.

---

## 2. Step 1 — PROVE THE READ PATH FIRST (no money moves)

**Goal:** confirm every read the keeper depends on works against mainnet —
without signing or broadcasting anything. Run the read-only preflight:

```bash
# From the repo root, with the REAL mainnet values. The preflight only READS
# (RPC getTokenSupply / getTokenAccountsByOwner + a Jupiter quote GET). It must
# NOT be given the vault secret — pubkey only.
SOLANA_RPC_URL="https://<your-mainnet-rpc>" \
JUPITER_API="https://quote-api.jup.ag/v6" \
USDC_MINT="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" \
WOC_MINT="3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth" \
MARKETPLACE_BURN_VAULT="<your-vault-pubkey>" \
  node scripts/burn-keeper-preflight.mjs
```

The preflight must report **PASS** on every check. It verifies, at minimum:

- `MARKETPLACE_BURN_VAULT` is a valid Solana address.
- `SOLANA_RPC_URL` is reachable and reports mainnet-beta
  (e.g. `getGenesisHash` matches mainnet) — **not** devnet/testnet.
- `getTokenSupply(WOC_MINT)` returns a numeric `decimals` (the keeper reads
  `$WOC` decimals live; this must succeed or `signBurn` throws).
- The vault's USDC ATA exists and its balance is readable via
  `getTokenAccountsByOwner(vault, { mint: USDC_MINT })`, and the ATA address
  derives correctly (owner, `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`,
  mint → `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL`).
- **A Jupiter route exists**: `GET {JUPITER_API}/quote?inputMint=<USDC>&outputMint=<WOC>&amount=<base units>&slippageBps=100&swapMode=ExactIn`
  returns JSON with a non-empty `routePlan` and an `outAmount`. No
  `routePlan` / no `outAmount` ⇒ **no route ⇒ do not proceed** (the keeper would
  be a no-op and you would be debugging in production).
- The vault holds some native SOL for fees.

Do not advance to Step 2 until the preflight is all-PASS, **especially** the
Jupiter-route check. If the route check fails, the live keeper cannot swap; fix
liquidity/size/slippage first.

---

## 3. Step 2 — SMALL FORCED BATCH (one tiny real burn)

**Goal:** force exactly **one** small, single-chunk batch to run end-to-end with
real funds, fast enough to observe in minutes.

Sizing for the smoke test:

- Fund the vault USDC ATA with a small known amount — e.g. **$3**.
- Set the **floor** and **threshold** below that amount so the batch fires
  immediately on the next tick.
- Set **TWAP split above** the amount so the pool is **not** chunked (one swap,
  one burn — easiest to follow on the explorer).
- Set a **short tick** so you do not wait the production cadence.

Exact env block for the server process (mainnet, smoke-test values):

```bash
# --- identity / network (mainnet, real) ---
export MARKETPLACE_BURN_VAULT="<your-vault-pubkey>"
export MARKETPLACE_BURN_VAULT_SECRET="<base58-secret-of-that-vault>"   # NEVER commit
export USDC_MINT="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
export WOC_MINT="3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth"
export SOLANA_RPC_URL="https://<your-mainnet-rpc>"   # the keeper's one RPC: reads (confirm / wocReceived / decimals / balance) + broadcast
export JUPITER_API="https://quote-api.jup.ag/v6"

# --- policy: force exactly one small, un-chunked batch ---
export BURN_BATCH_THRESHOLD_USDC=1    # pool >= $1 runs immediately (vault has ~$3)
export BURN_MIN_BATCH_USDC=1          # fee-aware floor below the funded amount
export BURN_TWAP_SPLIT_ABOVE_USDC=100000  # far above $3 -> never chunk (single swap+burn)
export BURN_TWAP_CHUNK_USDC=250       # unused at this size, kept sane
export BURN_MAX_SLIPPAGE_BPS=100      # 1.00% hard slippage ceiling (chain-enforced)
export BURN_CADENCE_MS=60000          # 1 min; threshold above will trigger first anyway
export BURN_KEEPER_TICK_MS=30000      # tick every 30s so the batch fires quickly
```

Notes:

- With the vault holding ~$3 and `BURN_BATCH_THRESHOLD_USDC=1`, `shouldRunBatch`
  fires on the first tick (pool ≥ threshold), regardless of cadence.
- `BURN_TWAP_SPLIT_ABOVE_USDC=100000` guarantees `planTwapChunks` returns a
  single chunk, so you get exactly one buy tx and one burn tx to inspect.
- The keeper serializes: if a prior in-flight batch exists it is recovered
  **before** any new work, so you will never get two concurrent batches against
  the vault. For a clean first run, start with an empty `burn_batches` table (or
  at least no open `swapping`/`swapped`/`burning` rows).

Start (or restart) the server with this env applied, e.g. `npm run server`.

---

## 4. Step 3 — OBSERVE

1. **Boot log.** On start, confirm the keeper came up:

   ```
   buy-and-burn keeper enabled
   ```

   If you do **not** see this line, the keeper is unconfigured (vault and/or
   secret missing) — recheck Step 2. If the server **crashes** at boot with
   `MARKETPLACE_BURN_VAULT_SECRET does not match MARKETPLACE_BURN_VAULT`, the
   secret is for the wrong wallet.

2. **Watch for cycle errors.** A failing cycle logs:

   ```
   burn keeper cycle failed: <error>
   ```

   (e.g. RPC timeouts, Jupiter 5xx). Transient errors are safe — the next tick
   retries; the USDC stays in the vault.

3. **Poll the public ledger.** Only `burned` (terminal) batches appear here, so
   the *final* evidence of success is a new batch in this response:

   ```bash
   curl -s "http://localhost:8787/api/marketplace/burn-ledger?limit=10" | jq
   ```

   Expected once the batch completes (all amounts are base-unit strings):

   ```json
   {
     "cumulativeWocBurned": "…",
     "cumulativeUsdcIn": "…",
     "batches": [
       {
         "batchId": "…",
         "source": "marketplace",
         "usdcIn": "3000000",
         "wocBought": "…",
         "wocBurned": "…",
         "buyTxSig": "…",
         "burnTxSig": "…",
         "executedAt": "…"
       }
     ]
   }
   ```

4. **Watch the status progression.** The ledger endpoint only shows `burned`
   rows, so to watch the intermediate states (`swapping` → `swapped` →
   `burning` → `burned`) during the ~tens of seconds the batch is in flight,
   query the table directly:

   ```bash
   psql "$DATABASE_URL" -c \
     "SELECT batch_id, status, usdc_in, woc_bought, woc_burned, buy_tx_sig, burn_tx_sig, fail_reason, created_at, executed_at
        FROM burn_batches ORDER BY created_at DESC LIMIT 5;"
   ```

   You should see one row transition:
   - `swapping` — swap signed, `buy_tx_sig` recorded, broadcast in flight.
   - `swapped` — swap confirmed `finalized`; `woc_bought` = `$WOC` measured from
     the confirmed tx's delta to the vault.
   - `burning` — burn signed, `burn_tx_sig` recorded, broadcast in flight.
   - `burned` — burn confirmed; `woc_burned` set, `executed_at` stamped. **Done.**

5. **Verify on the explorer.** Open both signatures from the ledger row
   (mainnet — no `?cluster` suffix):

   - Buy: `https://explorer.solana.com/tx/<buyTxSig>` — confirm a USDC→`$WOC`
     swap routed through Jupiter, with `$WOC` arriving at the vault owner.
   - Burn: `https://explorer.solana.com/tx/<burnTxSig>` — confirm an SPL
     `BurnChecked` on `WOC_MINT` reducing supply by `woc_burned`, authorized by
     the vault.

   Cross-check: `wocBought` in the ledger should equal the `$WOC` received in
   the buy tx, and `wocBurned` should equal the amount burned in the burn tx.

If the batch lands as `failed` instead, see Recovery below — the USDC is still
in the vault and is **not** lost.

---

## 5. Step 4 — RESTORE PRODUCTION CADENCE

Once the smoke-test batch is verified `burned` on-chain, restore the production
policy env and restart the server. Production defaults (from `.env.example` /
`DEFAULT_BURN_POLICY` in `server/burn_policy.ts`):

```bash
export BURN_BATCH_THRESHOLD_USDC=250     # run as soon as the pool reaches $250
export BURN_MIN_BATCH_USDC=25            # fee-aware floor: never swap below $25
export BURN_CADENCE_MS=21600000          # 6h cadence once the pool clears the floor
export BURN_TWAP_SPLIT_ABOVE_USDC=1000   # split pools above $1000 into chunks
export BURN_TWAP_CHUNK_USDC=250          # max $250 per child swap (price-impact control)
export BURN_MAX_SLIPPAGE_BPS=100         # 1.00% hard slippage ceiling
export BURN_KEEPER_TICK_MS=300000        # tick every 5 min (policy gates real work)
```

Keep the mainnet `MARKETPLACE_BURN_VAULT` / `MARKETPLACE_BURN_VAULT_SECRET` /
mint / RPC / Jupiter env exactly as in Step 2. Adjust the thresholds to your
real economics — but **never lower the floor below what a swap+burn costs in
fees**, or a batch could spend more in fees than it burns. Confirm the boot log
still shows `buy-and-burn keeper enabled` after the restart.

---

## 6. Recovery & failure notes

The keeper is built to be crash-safe and to never lose vault funds. The
mechanisms (all in `server/burn_keeper.ts` + `server/db.ts`):

- **Durable intent before broadcast.** In `swapAndBurn`, the keeper signs the
  swap, then calls `createBurnBatch` to write a `burn_batches` row with the
  pre-signed `buy_tx_sig` and `status='swapping'` **before** `swap.send()`. So a
  crash *after* broadcast but *before* confirmation leaves a durable record of
  the in-flight swap, keyed by its signature. Likewise `markBatchBurning` records
  the burn `burn_tx_sig` **before** the burn is broadcast.
- **Idempotent open.** `createBurnBatch` uses a target-less
  `ON CONFLICT DO NOTHING`, so the unique `buy_tx_sig` (and the `batch_id` PK)
  both arbitrate: a re-signed/duplicated swap returns `false` (rowCount 0) and
  the keeper backs off — recovery owns that signature.
- **Recovery by recorded signature, never by balance.** `recover()` re-checks
  each open batch by its stored signature (`confirm(buyTxSig)` /
  `confirm(burnTxSig)`) — it **never** re-reads the vault balance, which could
  double-swap a swap whose confirmation was merely lost. `runCycle()` calls
  `recover()` first whenever any open batch exists, and only then considers new
  work — so the keeper **recovers-then-runs at boot** (the boot `tick()` in
  `server/main.ts` resolves any crash mid-batch before starting anything new),
  and again on the **next tick** while a batch is in flight.
  - `swapping` + confirmed → continue to measure `$WOC` and burn.
  - `swapping` + failed → `markBatchFailed('swap reverted (slippage / route)')`.
  - `swapped` → (re-)issue the burn.
  - `burning` + confirmed → `markBatchBurned`.
  - `burning` + failed/stale → re-issue the burn.
- **10-minute stale-fail.** A `swapping`/`burning` batch whose signature still
  will not confirm after **`STALE_MS = 10 min`** (well past any blockhash
  validity window) is treated as never-landed: a stale `swapping` batch is
  marked `failed` (`'swap never landed (stale)'`); a stale `burning` batch is
  re-issued. This stops the keeper wedging forever on a lost transaction.
- **A `failed` batch loses no funds.** When a batch ends `failed`, the USDC was
  never swapped (or the swap reverted on-chain), so it remains in the vault and
  is picked up by the **next cycle**. Failure is safe; it just means that
  amount waits for a retry. Inspect `fail_reason` to understand why
  (`'swap reverted (slippage / route)'`, `'swap confirmed but no $WOC received'`,
  `'swap never landed (stale)'`).
- **Single batch at a time.** Because `runCycle()` returns early if any open
  batch exists, only one batch is ever in flight against the vault. TWAP chunks
  within a triggered cycle are processed **sequentially** (each chunk a full
  swap→burn micro-batch); if a chunk yields no route / unconfirmed / failed, the
  loop breaks and the remaining USDC waits for the next cycle.

What to do if a real batch is stuck:

1. Check the open rows: `SELECT batch_id, status, fail_reason, buy_tx_sig, burn_tx_sig, created_at FROM burn_batches WHERE status IN ('swapping','swapped','burning');`
2. Look up the recorded signature on the explorer to see whether it landed.
3. If it is genuinely lost, wait for the 10-min stale-fail — the keeper will
   self-heal on the next tick (re-issue burn, or fail the swap and retry the
   USDC next cycle). Do **not** hand-edit `burn_batches` rows on a live keeper;
   manual state can defeat the signature-based recovery.

---

## 7. Safety (non-negotiable)

- **The vault secret is the only key that can move the 30% pool.** Treat it like
  a production private key. It belongs **only** in the keeper's runtime env
  (`MARKETPLACE_BURN_VAULT_SECRET`), read **only** by `buildProductionDeps()` in
  `server/burn_keeper.ts`.
- **Never put the secret on any other code path.** It is deliberately absent
  from the quote/verify path (`server/marketplace.ts`) so a compromise there
  cannot move funds. Do not import it elsewhere, log it, or pass it to a script.
- **Never commit it to git.** Keep it out of `.env` files that are tracked, out
  of PRs, out of the preflight invocation (Step 1 uses the pubkey only).
- **The keeper is a no-op without it.** With the secret unset, purchases still
  settle and the 30% accrues safely in the vault; nothing is swapped or burned.
  Enabling the keeper is exactly the act of giving the server this key — so do
  it only when you have completed Steps 1–3.
