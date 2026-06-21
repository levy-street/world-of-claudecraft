// $WOC burn-payment verification for identity actions (rename / reserve). Built
// on the asset-agnostic primitives in server/solana_tx.ts. A payment is valid
// when a single finalized transaction, signed by the account's linked wallet:
//   1. succeeded (meta.err === null),
//   2. uses the legacy SPL Token program for $WOC (not Token-2022),
//   3. carries a memo exactly equal to the quoteId (binds tx ⇄ quote ⇄ account),
//   4. reduced the payer's $WOC balance by at least the price, and
//   5. actually burned the required burn-portion (and credited the treasury its
//      split, when a treasury split is configured).
// The handler layer adds the tx_sig replay guard (UNIQUE in woc_payments).
import {
  getFinalizedTx,
  txSucceeded,
  usesToken2022,
  ownerSpentBase,
  ownerCreditedBase,
  burnedBase,
  hasMemo,
} from './solana_tx';
import { WOC_MINT, WOC_TREASURY, splitPrice } from './woc_config';

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,90}$/;

export interface WocPaymentResult {
  ok: boolean;
  reason?: string;
  spentBase: bigint;
  burnedBase: bigint;
}

const fail = (reason: string): WocPaymentResult => ({ ok: false, reason, spentBase: 0n, burnedBase: 0n });

/**
 * Verify that `signature` is a finalized $WOC payment of at least `priceBase`
 * (base units) by `payer`, tagged with `memo`. Returns ok=false with a reason
 * for any failure (including "not finalized yet" — the caller may retry).
 */
export async function verifyWocPayment(
  signature: string,
  payer: string,
  priceBase: bigint,
  memo: string,
): Promise<WocPaymentResult> {
  if (!BASE58.test(signature)) return fail('bad_signature');
  if (priceBase <= 0n) return fail('bad_price');

  const tx = await getFinalizedTx(signature);
  if (!tx) return fail('not_finalized');
  if (!txSucceeded(tx)) return fail('tx_failed');
  if (usesToken2022(tx, WOC_MINT)) return fail('token_2022');
  if (!hasMemo(tx, memo)) return fail('memo_mismatch');

  const spentBase = ownerSpentBase(tx, payer, WOC_MINT);
  if (spentBase < priceBase) return fail('underpaid');

  const burned = burnedBase(tx, WOC_MINT, payer);
  const { burnBase, treasuryBase } = splitPrice(priceBase);
  if (burned < burnBase) return fail('burn_missing');

  if (treasuryBase > 0n && WOC_TREASURY) {
    const credited = ownerCreditedBase(tx, WOC_TREASURY, WOC_MINT);
    if (credited < treasuryBase) return fail('treasury_short');
  }

  return { ok: true, spentBase, burnedBase: burned };
}
