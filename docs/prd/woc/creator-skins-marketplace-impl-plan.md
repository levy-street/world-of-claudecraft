# Implementation Plan — Creator Skins Marketplace

> **Companion to [`creator-skins-marketplace.md`](./creator-skins-marketplace.md)** (the spec) and [`market-fee-woc-burn.md`](./market-fee-woc-burn.md) (the sibling burn mechanic). That PRD is the *what/why*; this doc is the *how/where/when* — the confirmed decisions, the real code foundation, the branch strategy, and a phased build plan with file-level hooks. **No production money ships until the spec's §8.9 (legal) and §12 (CONFIRM-GATE) are signed off.**

| | |
|---|---|
| **Status** | Plan — confirmed direction, ready to build Phase 1 |
| **Created** | 2026-06-19 |
| **Build branch** | `feature/woc-skins-marketplace`, stacked on PR #473 (rebases onto `main` once #473 lands) |
| **Spec** | [`creator-skins-marketplace.md`](./creator-skins-marketplace.md) |

---

## 1. Confirmed decisions

| Decision | Choice |
|---|---|
| **Custody model** | **Option C** — buyer signs one atomic tx: 70% USDC direct to creator (never custodied), 30% to a burn vault; the Jupiter buy + SPL burn run **batched, off the hot path**. |
| **Split** | Fixed **70/30** on gross USDC, price-independent. `creator = gross*70/100`; `burn = gross - creator` (dust → burn). `bigint` throughout. |
| **USDC mint** | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (canonical mainnet USDC, 6 decimals). Overridable via `USDC_MINT` env for devnet. |
| **DEX** | Jupiter (raw REST via `fetch` first; add `@jup-ag/api` only if needed). |
| **v1 skin unit** | Form A only — one `2048²` sRGB PNG class atlas (+ optional emissive, high tier). GLB bodies deferred to Phase 4. |
| **Phase 1 deliverable** | Opaque-id carrier + devnet USDC flow (connect → pay devnet USDC → verify → own → equip → seen by others), + the CI cosmetic-only invariant test. |
| **Base branch** | A new feature branch off `main`, built **with PR #473's wallet layer in mind** (not the `feature/eliza-agents` stubs). |

---

## 2. Foundation correction — build on PR #473, not the eliza stubs

The spec was first grounded against `feature/eliza-agents`, whose web3 was only **stubs** (`server/solana.ts` / `server/billing.ts`, every fn `throw TODO`). The real, production-ready foundation is **PR #473** (`feat(woc): $WOC holder flair → player card`), just **3 commits ahead of `main`** and mergeable. It already ships a **non-custodial wallet layer** the marketplace reuses verbatim:

**Exists (reuse as-is):**
- `server/wallet_link.ts` — `isSolanaAddress(s)`, `verifySolanaSignature(message, sigB58, addrB58)` (ed25519 via `@noble/curves`, never throws), `buildLinkMessage({domain,accountId,address,nonce,issuedAt})`.
- `server/wallet.ts` — challenge/verify HTTP handlers: `POST /api/wallet/link/challenge`, `POST /api/wallet/link`, `GET /api/wallet`, `DELETE /api/wallet/link`. Nonce TTL 10 min.
- `server/db.ts` — tables `wallet_links(account_id PK, pubkey UNIQUE, linked_at)` + `wallet_link_challenges(...)`; functions `createWalletChallenge` / `consumeWalletChallenge` / `pruneWalletChallenges` / `walletForAccount(accountId)` / `accountForWallet(pubkey)` / `linkWalletToAccount` / `unlinkWallet`. Also `AccountCosmetics {completedQuestIds, mechChromaIds}`, `loadAccountCosmetics`, `grantAccountMechChroma`.
- `server/woc_balance.ts` — `fetchWocBalance(pubkey)` and `holderInfoForPubkey(pubkey)` (cached 5 min) via **raw JSON-RPC `getTokenAccountsByOwner`** — note the server deliberately does **not** bundle `@solana/web3.js`. Env: `SOLANA_RPC_URL`, `WOC_MINT`.
- `src/net/wallet.ts` — **Reown AppKit + Solana adapter**, networks already include **`solana` AND `solanaDevnet`**. `initWallet`, `currentWallet`, `onWalletChange`, `openWalletModal`, `signMessageBase58(message)`. Env: `VITE_REOWN_PROJECT_ID`, `VITE_SOLANA_RPC_URL`, `VITE_WOC_MINT`.
- `server/main.ts:542-561` — wallet routes wired behind `bearerActiveAccount` auth.

**Consequences for the spec (corrections to §4/§6):**
- **Creator/buyer wallet onboarding is already built** — reuse `walletForAccount()` + the challenge/`verifySolanaSignature` flow. The spec's "build challenge/verify" is mostly done.
- **Server verifies on-chain via raw JSON-RPC `getTransaction`**, mirroring `woc_balance.ts` — do **not** pull `@solana/web3.js` into the server bundle (spec §4.7 over-assumed it).
- **Client can sign *messages* but not *transactions* yet.** `src/net/wallet.ts` needs a new `signAndSendTransaction()` (or `signTransaction`) for the USDC split tx — the one real client gap.
- **$WOC mint** for the buy-and-burn = `WOC_MINT` (`3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth`), already configured.

**Still to add (the marketplace itself):** on-chain split-tx verification (raw `getTransaction`), client tx signing, `USDC_MINT` env, the burn keeper (Jupiter swap + SPL burn), tables `creator_skins`/`marketplace_sales`/`burn_batches`, the opaque-id carrier + dynamic skin registry + render path, and the admin moderation queue.

---

## 3. Branch strategy

- Build on **`feature/woc-skins-marketplace`**, cut from PR #473's tip so the wallet layer is present to compile against.
- The **opaque-id carrier + registry + cosmetic-only test** are pure-`main` work (compile on either base); the **payment layer** depends on #473.
- When #473 merges to `main`, rebase the marketplace branch onto `main` — trivial (no overlap beyond the shared wallet files it only *reads*).
- The spec/plan docs live on **PR #469** (this PR); the code lives on its own branch/PR.

---

## 4. Phased plan

Phases 2–4 are summarized in the spec (§9). Phase 1 is decomposed below into independently-shippable, verifiable slices. **Nothing here touches mainnet money** — Phase 1 is devnet + pure-engine only.

### Phase 1a — Opaque-id carrier (pure engine, fully unit-testable) ← start here
Mirror PR #473's `holderTier` precedent exactly: a cosmetic identity field the **sim carries but never reads or branches on**, synced in identity fields.

| File | Edit |
|---|---|
| `src/sim/types.ts:907` | Add `cosmeticSkinId: string \| null` to `Entity` (beside `skin`/`skinCatalog`/`holderTier`). |
| `src/sim/sim.ts:415` | Add `cosmeticSkinId: string \| null` to `PlayerMeta`. |
| `src/sim/sim.ts:851` / `:1028` | Init from `opts?.state?.cosmeticSkinId ?? null`; serialize `cosmeticSkinId: meta.cosmeticSkinId ?? null` (free persistence via the existing state JSONB). |
| `src/sim/sim.ts:1039` `setPlayerSkin` | 4th param `cosmeticSkinId: string \| null = null`; store on `meta` + entity. Default `null` ⇒ selecting a numeric class/mech skin clears any creator overlay. **Never touches stats.** |
| `src/sim/sim.ts:1052` `changeSkin` | Pass the id through. |
| `src/sim/entity.ts:28`, `src/net/online.ts:328` | Init `cosmeticSkinId: null` at the two `Entity` construction sites. |
| `src/world_api.ts:287` | Widen `changeSkin(skin, catalog?, cosmeticSkinId?)`. |
| `server/game.ts:207` `identityFields` | `if (e.cosmeticSkinId) out.csk = e.cosmeticSkinId;` (mirrors `out.ht`). |
| `src/net/online.ts:632` deserialize | `e.cosmeticSkinId = w.csk ?? null;` |
| `tests/` | (1) determinism: a `change_skin` carrying a `cosmeticSkinId` replays byte-identically across hosts; (2) **cosmetic-only CI invariant**: `recalcPlayerStats` output is invariant under every `setPlayerSkin` permutation; (3) wire round-trip: `csk` serializes/deserializes and survives a state save/load. |

**Verifiable by me:** ✅ entirely (`npx vitest`, `npm run build`).

### Phase 1b — Dynamic registry + render path
DB-backed `creator_skins` registry → `GET /api/skins/registry` (approved metadata only, ETag) → client in-memory `Map<id, entry>` → extend `src/render/characters/assets.ts` with `ensureCreatorSkin(id)` (reuse `loadSkinTexInto` + URL cache, lazy like `mechAssets()`, add LRU eviction) → `src/render/characters/visual.ts:288` applies it; **falls back to the numeric skin on any miss**.
**Verifiable by me:** ⚠️ compiles + unit-tests the registry; visual application needs a browser (`scripts/*.mjs` E2E).

### Phase 1c — Server marketplace + ownership gate (devnet)
New `server/marketplace.ts`: extend the quote (split legs, `buyerAccountId`), verify the buyer's atomic split tx via **raw `getTransaction`** (finalized · exact per-leg amounts · destination owner+mint+token-program (Tokenkeg, reject Token-2022) · payer-bound to the linked wallet · memo == quoteId · `tx_sig` replay guard) → grant ownership in `AccountCosmetics.ownedCreatorSkinIds` → equip gate in `server/game.ts:1168` `change_skin` (owned/authored + `approved` only, mirroring the mech-ownership gate). Tables `creator_skins`/`marketplace_sales`. **Split done manually off-flow in Phase 1** (no live keeper yet).
**Verifiable by me:** ✅ verification logic with mocked RPC fixtures; ⚠️ live devnet round-trip needs your env (below).

### Phase 1d — Client tx build/sign + buy UI (devnet)
Add `signAndSendTransaction()` to `src/net/wallet.ts`; build the 2-leg + memo USDC tx from the quote; buy sheet showing the transparent "$7 creator / $3 buy-&-burn $WOC" breakdown; equip via the existing skin-select overlay.
**Verifiable by me:** ⚠️ needs a Reown project id + a funded devnet wallet + devnet USDC (your env).

**Phase 2+** (atomic split on mainnet, the batched `BurnKeeper`, open submissions + moderation, GLB bodies) — per spec §9, gated on legal §8.9.

---

## 5. What I'll need from you for the live (devnet) slices

- **`VITE_REOWN_PROJECT_ID`** — a Reown/WalletConnect project id (or confirm the one in `.env.local` is usable for devnet).
- **Devnet RPC + USDC mint** — a devnet `SOLANA_RPC_URL` and the devnet `USDC_MINT` to test against (mainnet USDC has no devnet supply).
- **A funded devnet buyer wallet** + a devnet creator payout wallet, for an end-to-end purchase.
- **Burn-vault keypair** policy — where the (server-only, KMS/SecretVault) burn-vault key lives; not needed until the keeper (Phase 2), but decide custody now.

Until then I can complete **1a fully** and the **1b/1c logic with mocked RPC**, all green in CI, with no chain access.

---

## 6. Verification strategy

Every slice anchors on a runnable check, never "looks done":
- `npx vitest run tests/<file>` per slice; full `npm test` before each commit.
- `npm run build` (game + admin entries) stays green.
- The **cosmetic-only invariant test** (1a) is the load-bearing guard: skins can never reach `recalcPlayerStats`.
- A fresh subagent reviews each diff for correctness/requirement gaps before it's called done.
- Live devnet slices verified via `scripts/*.mjs` browser E2E once env is provided.

---

*Provenance: confirmed direction after mapping the real foundation — PR #473's non-custodial wallet layer (not the `feature/eliza-agents` stubs). Custody Option C, 70/30, Form A, Phase 1 = opaque-id carrier + devnet USDC, build branch stacked on #473.*
