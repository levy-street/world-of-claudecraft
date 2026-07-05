# PR 1 — `$WOC` Rename + Vanity Names

> **Status:** DRAFT / implementation plan. Implements roadmap stub #470. Stacked on #473 (wallet-link). Flag-gated; no behavior change on `main` by default.

## Summary
Charge `$WOC` (real on-chain **burn**) for character/guild renames and reserved vanity names — the faithful #470: a pure token **sink**, cosmetic, no pay-to-win, Low reg risk.

This PR also lands the **shared `$WOC` payment layer** reused by the rest of the stack (PR 2 SNS subdomains, PR 3 marketplace).

## Foundation
Builds on **#473** (absorbed the closed #465 wallet-link): non-custodial wallet linking (`server/wallet.ts`, `wallet_link.ts`), `$WOC` balance reads (`server/woc_balance.ts`, `src/net/wallet.ts`), Reown client. #473 has **no** payment/burn verification or server-side tx signing — those are here.

## Shared payment layer (reused by PR 2 / PR 3)
- **Deps:** `@solana/spl-token` (SPL `burnChecked`), `naughty-words` (LDNOOBW global word list). `@solana/web3.js` already added by #473.
- **Config/env:** `WOC_TREASURY` (optional), `WOC_BURN_BPS` (default `10000` = 100% burn), `WOC_DECIMALS` (default read from mint), prices `WOC_PRICE_RENAME_CHARACTER` / `_RENAME_GUILD` / `_RESERVE`. Reuses `WOC_MINT` / `SOLANA_RPC_URL`.
- **DB** (idempotent DDL in `SCHEMA`, run by `ensureSchema()` under the existing advisory lock): `woc_payments` — replay guard + audit (`tx_sig TEXT UNIQUE NOT NULL`, `account_id`, `amount_base`, `mint`, `reference`, `created_at`). New `db.ts` fns: `recordWocPayment()` (null on UNIQUE conflict), `getCharacterById()`.
- **`server/woc_payment.ts`** (new): `verifyBurnTx(signature, {payer, minBurnBase, mint, memo})` — `getTransaction(sig,{commitment:'finalized'})`, assert finalized + `burnChecked`(+optional treasury transfer) on `WOC_MINT` by `payer` ≥ price + `memo == quoteId`. Raw RPC, mirrors `woc_balance.ts`.
- **`server/identity.ts`** (new): `POST /api/identity/quote` + `/confirm`. Quote validates name (reuse `normalizeCharName` + `offensiveName`), checks availability, computes price, builds the unsigned burn tx (memo = quoteId), persists the quote with a TTL. Confirm runs `verifyBurnTx` → `recordWocPayment` (replay guard) → applies the action. Idempotent on replay. Wired next to the `/api/wallet/*` routes.
- **Client:** extend the Reown provider seam in `src/net/wallet.ts` (today only `signMessage`) to expose `signTransaction`; add `signAndSubmitIdentityTx(txBase64)` → deserialize → sign → `sendRawTransaction` → confirm finalized → return signature. `src/sim/` never imports it.

## Features
1. **Paid character rename — free remediation stays free.** In the rename endpoint (`server/main.ts:397`): if `character.force_rename` is set ⇒ existing **free** path (mod-required rename, unchanged). Otherwise a voluntary rename ⇒ the paid `/api/identity/*` flow. Reuses `renameCharacter()` (`db.ts:508`); adds `getCharacterById` to branch on the flag.
2. **Guild rename (new — does not exist today).** `guildRename(actor, newName)` on `SocialService` (`server/social.ts`), leader-only (reuse the `guildMembership().rank === 'leader'` guard), → new `renameGuild(guildId, newName)` in `server/social_db.ts` (`UPDATE guilds`; `23505` ⇒ name_taken) → broadcast + `pushGuild`. Dispatch `case 'guild_rename'` in `server/game.ts`.
3. **Vanity name reservation.** `name_reservations` table (`realm, name UNIQUE, account_id, kind, expires_at, status`). Pay `$WOC` to hold a name you're not yet using; anti-squat rules: per-account cap, TTL/expiry, must pass `offensiveName`. Enforced at create/rename time.
4. **Name hardening (`server/auth.ts`).** `offensiveName()` already runs `obscenity` + confusable normalization + env banlists; merge the **LDNOOBW** multilingual list into `bannedUsernameTerms()`. One hardened gate for all names.
5. **Client UI.** Rename entry on character-select (price, wallet-link prompt, errors); Guild-panel "Rename" for leaders; optional "reserve name".

## Tests (Vitest)
`tests/woc_payment.test.ts` (valid / underpay / wrong-mint / bad-memo / unfinalized + replay double-spend); `tests/identity_server.test.ts` (quote/confirm happy + `force_rename`-stays-free); guild rename in `tests/social_system.test.ts` (FakeDb pattern); name filter (LDNOOBW + leetspeak).

## Verification
`npx vitest run` green; `tsc` / `npm run build` clean. Flags off ⇒ `main` behavior unchanged; #473 + existing rename tests still pass. Devnet e2e (mirror `scripts/wallet_e2e.mjs`): link wallet → quote rename → sign → confirm → assert `$WOC` burned + name updated + replay rejected; guild rename leader-only.

## Risks
Pure burn sink, Low reg risk. Tx-size: a rename burn is a single instruction, well within the 1232-byte limit. `src/sim/` purity preserved (`git grep` guard: no `wallet`/`web3`/`woc_payment` import under `src/sim/`).
