# Featured-talent multi-currency checkout

Status: draft, flag OFF (`TALENT_PROGRAM_ENABLED=false`). Stacked on the Logol
merchant pipeline (PR #1473). Blocked on dual legal counsel sign-off before any
mainnet sale (a human gate, tracked separately).

## What

A featured creator ("talent") owns one or more prestige COSMETIC wares on the
Logol pipeline. A buyer purchases a ware paying in their CHOICE of currency:
USDC, SOL, or $WOC. Each sale splits 80% to the talent and 20% to the treasury,
recorded server-side per sale.

## Why

The talent program lets celebrities/creators earn from in-game cosmetics they
lend their name to, in the currency the buyer prefers, while the platform takes a
fixed 20% cut. It reuses the on-chain verification and quote-ledger the Logol and
identity-rename $WOC flows already use, so there is one payment path for the whole
commerce surface.

## How

- **Content (data-as-code):** `src/sim/content/talent.ts` holds the wares, each
  carrying a per-currency human price and its owning `talentId`. Cosmetic-only,
  the same non-pay-to-win invariant Logol's wares hold. The sim never reads them.
- **Config:** `server/talent_config.ts` owns the currencies, the 80/20 split bps
  (`TALENT_TREASURY_BPS`, default 2000), the treasury address, the USDC mint, and
  the per-talent payout wallets (`TALENT_WALLETS`, `talentId=pubkey` pairs). All
  server-side; no secrets committed, documented in `.env.example`.
- **Split math:** `server/talent_split.ts`, pure and integer-only, so
  `talentBase + treasuryBase === priceBase` exactly and rounding dust always
  favors the talent.
- **Verification:** `server/talent_payment.ts` (`verifyTalentPayment`) reuses the
  shared `server/solana_tx.ts` primitives (the SAME ones `verifyWocPayment` uses):
  `getFinalizedTx` / `txSucceeded` / `usesToken2022` / `hasMemo`, the token
  balance-delta checks for USDC and $WOC, and the native-SOL lamport-delta checks
  for SOL. It confirms the tx succeeded, is not Token-2022 (for token
  currencies), carries the quote memo, and credited BOTH the talent (80%) and the
  treasury (20%) legs in the chosen currency. No RPC or parsing logic is
  duplicated.
- **Ledger:** the quote reuses the shared `woc_quotes` table (kind=`talent`) via
  `server/logol_db.ts`. The settled sale lands in a new `talent_sales` table
  (`server/talent_db.ts`) whose `tx_sig` UNIQUE constraint is the double-spend
  replay guard; the 80/20 legs are stored per row.
- **Routes:** `server/talent.ts` (`/api/talent/storefront|inventory|quote|confirm`)
  wired into `server/main.ts` next to the Logol routes. Reads take a read token;
  quote/confirm need a full token. Every quote and confirm is refused when the
  flag is off (fail closed).
- **UI strings:** the checkout's player-facing labels are English `t()` keys under
  `hudChrome.talentCheckout.*` (`src/ui/i18n.catalog/hud_chrome.ts`), with the
  M16-required non-Latin fills in the five overlays. Like the Logol PR, this draft
  ships no bespoke client checkout window; the strings exist as `t()` keys for the
  checkout surface, and the currency signing UI is a follow-up.

## Flag and safety

- `TALENT_PROGRAM_ENABLED` defaults false; a ware is only quotable when the flag
  is on AND its talent has a configured payout wallet AND a treasury is set.
- The buyer signs and submits the payment transaction from their own wallet; the
  server never holds keys, never signs, and never moves funds. It only verifies a
  finalized on-chain payment and grants the cosmetic.
- `src/sim` stays pure: nothing here touches the sim.

## Out of scope (this draft)

- The client wallet-signing checkout window (a follow-up, matching the Logol PR
  which also shipped server-side first).
- Talent onboarding/admin surface.
- Live exchange-rate pricing (prices are authored per currency, deterministic).
