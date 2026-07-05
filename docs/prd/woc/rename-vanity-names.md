# $WOC Rename + Vanity Names (re-cut for release/v0.22.0)

> **Status:** IMPLEMENTED behind `WOC_IDENTITY_ENABLED` (default OFF; a default
> deploy changes no behavior). Re-cut of PR #734 on top of the shipped wallet
> link (#473, now Wallet Standard) and the shipped moderation rename flow.

## Summary

Charge $WOC (a real on-chain **burn**) for character renames, guild renames,
and reserved vanity names: a pure token sink, cosmetic only, no pay-to-win.
Also lands the shared $WOC payment layer (quote/confirm + burn verification)
that later paid features reuse.

## Foundation reused from the release tree

- Wallet link: `server/wallet.ts` + `wallet_link.ts` + `walletForAccount()`
  (from #473); the client is Wallet Standard (`src/net/wallet.ts`), no Reown.
- Balance reads: `server/woc_balance.ts` (raw JSON-RPC, server-side key).
- Free moderation rename: the `force_rename` flow in `server/main.ts` +
  `renameCharacter()` (force_rename-gated UPDATE) stays exactly as shipped.

## Payment layer

- `server/woc_config.ts`: mint / RPC / decimals / burn-treasury split / prices,
  plus the `WOC_IDENTITY_ENABLED` master switch (fail-closed).
- `server/solana_tx.ts`: raw JSON-RPC finalized-tx reads + composable checks
  (balance deltas, burn parsing, memo, Token-2022 guard) and the pay-context
  reads (latest blockhash, token-account lookup). No @solana/web3.js.
- `server/woc_payment.ts`: `verifyWocPayment(sig, payer, priceBase, memo)`.
- DB (`server/db.ts` SCHEMA): `woc_payments` (tx_sig UNIQUE replay guard),
  `woc_quotes` (single-use, TTL), `name_reservations` (realm-scoped,
  case-insensitive active-unique, 90-day TTL, 10 per account).
- Flow (`server/identity.ts`): `POST /api/identity/quote` (validate + price +
  persist quote; memo = quoteId binds tx to account+action), `GET
  /api/identity/paycontext` (blockhash + token accounts, so the RPC key stays
  server-side), `POST /api/identity/confirm` (verify finalized burn, record
  payment, apply). Confirm before finalization returns 409 `not_finalized` and
  is retryable without losing the quote.

## Features

1. **Paid character rename.** Voluntary renames go through the paid flow;
   the moderator-required rename stays free (a force_rename character is
   refused by the paid flow, and the free endpoint 402-hints to the paid flow
   for un-flagged characters when the feature is on). Paid renames reuse the
   market/mail rekey the free path performs. `renameCharacterVoluntary()` is
   gated on `force_rename = FALSE`, the mirror of the free UPDATE.
2. **Guild rename** (`SocialService.renameGuildAsLeader`): leader-only, offline
   capable, broadcast + guild panel refresh; localized via `server_i18n.ts`.
3. **Vanity name reservation.** Pay to hold a character name; enforced on paid
   renames, the free rename path, and character creation (reserver-only).
4. **Name hardening** (`server/auth.ts`): LDNOOBW multilingual list layered on
   obscenity, with a Scunthorpe allowlist; one gate for every player name.

## Client (character rename UI only)

Character-select rename button (visible when the feature is on and the wallet
UI is enabled), inline editor driving quote -> burn -> confirm with progress
strings. Payment is Wallet Standard `solana:signAndSendTransaction`; the tx
(burnChecked + optional transferChecked + memo) is serialized by the dependency
free builder `src/net/woc_tx.ts`. Guild rename + reservations are API-complete
but have no client UI yet (deliberate, matching the original PR).

## Verification

`tests/woc_payment.test.ts`, `tests/identity_actions.test.ts`,
`tests/name_filter.test.ts`, `tests/social_system.test.ts` (guild rename),
`tests/woc_tx.test.ts` (tx serialization). Flag off = release behavior
unchanged. The server never holds keys or funds; the sim stays string-free and
never imports any of this.
