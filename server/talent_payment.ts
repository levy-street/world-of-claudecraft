// Multi-currency payment verification for the featured-talent checkout
// (docs/prd/woc/talent-checkout.md). Built on the SAME asset-agnostic on-chain
// primitives that server/woc_payment.ts (verifyWocPayment) uses, so there is one
// verification path for the whole commerce surface, never a hand-rolled second
// one: getFinalizedTx / txSucceeded / usesToken2022 / hasMemo, the token
// balance-delta checks (ownerCreditedBase / ownerSpentBase) for USDC and $WOC,
// and the native-SOL lamport-delta checks (lamportsCreditedTo / lamportsSpentBy)
// for SOL.
//
// A talent payment is valid when a single finalized transaction, signed by the
// account's linked wallet:
//   1. succeeded (meta.err === null),
//   2. for a token currency, is NOT held under Token-2022 (transfer-hook / fee
//      look-alikes must never be accepted),
//   3. carries a memo exactly equal to the quoteId (binds tx to quote to
//      account, and is what makes a payment single-use with the tx_sig guard),
//   4. credited the TALENT at least its 80% leg, and
//   5. credited the TREASURY at least its 20% leg,
//      both in the buyer's chosen currency.
// The two-leg credit check is the anti-forgery core: a crafted client tx cannot
// fabricate a real balance increase at an address it did not fund. The handler
// layer adds the tx_sig replay guard (UNIQUE in talent_sales).
import {
  getFinalizedTx,
  hasMemo,
  lamportsCreditedTo,
  lamportsSpentBy,
  ownerCreditedBase,
  ownerSpentBase,
  txSucceeded,
  usesToken2022,
} from './solana_tx';
import { mintFor, type TalentCurrency } from './talent_config';

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,90}$/;

export interface TalentPaymentResult {
  ok: boolean;
  reason?: string;
  // Total the payer spent in the currency's base units (for the sale record).
  spentBase: bigint;
  // The credited legs actually observed on-chain (>= the required amounts).
  talentCreditedBase: bigint;
  treasuryCreditedBase: bigint;
}

const fail = (reason: string): TalentPaymentResult => ({
  ok: false,
  reason,
  spentBase: 0n,
  talentCreditedBase: 0n,
  treasuryCreditedBase: 0n,
});

export interface TalentPaymentCheck {
  signature: string;
  payer: string; // the buyer's linked wallet pubkey
  talent: string; // the talent's payout wallet pubkey
  treasury: string; // the platform treasury pubkey
  currency: TalentCurrency;
  priceBase: bigint;
  talentBase: bigint; // required talent leg (80%)
  treasuryBase: bigint; // required treasury leg (20%)
  memo: string; // the quoteId
}

/**
 * Verify a finalized talent-checkout payment. Returns ok=false with a reason for
 * any failure (including "not_finalized", which the caller may retry). Reuses
 * the shared solana_tx primitives; no RPC or parsing logic is duplicated here.
 */
export async function verifyTalentPayment(check: TalentPaymentCheck): Promise<TalentPaymentResult> {
  const {
    signature,
    payer,
    talent,
    treasury,
    currency,
    priceBase,
    talentBase,
    treasuryBase,
    memo,
  } = check;
  if (!BASE58.test(signature)) return fail('bad_signature');
  if (!BASE58.test(talent) || !BASE58.test(treasury)) return fail('bad_recipient');
  if (priceBase <= 0n) return fail('bad_price');
  if (talentBase + treasuryBase !== priceBase) return fail('bad_split');
  // A self-pay would let the buyer recover their own credit leg; reject it.
  if (payer === talent || payer === treasury) return fail('self_payment');

  const tx = await getFinalizedTx(signature);
  if (!tx) return fail('not_finalized');
  if (!txSucceeded(tx)) return fail('tx_failed');
  // The memo binds the tx to this quote for EVERY currency (a SOL transfer can
  // carry an spl-memo instruction too); it is what makes a payment single-use.
  if (!hasMemo(tx, memo)) return fail('memo_mismatch');

  if (currency === 'sol') {
    const talentCredited = lamportsCreditedTo(tx, talent);
    const treasuryCredited = lamportsCreditedTo(tx, treasury);
    if (talentCredited < talentBase) return fail('talent_short');
    if (treasuryCredited < treasuryBase) return fail('treasury_short');
    const spent = lamportsSpentBy(tx, payer);
    if (spent < priceBase) return fail('underpaid');
    return {
      ok: true,
      spentBase: spent,
      talentCreditedBase: talentCredited,
      treasuryCreditedBase: treasuryCredited,
    };
  }

  const mint = mintFor(currency);
  if (!mint) return fail('bad_currency');
  if (usesToken2022(tx, mint)) return fail('token_2022');

  const talentCredited = ownerCreditedBase(tx, talent, mint);
  const treasuryCredited = ownerCreditedBase(tx, treasury, mint);
  if (talentCredited < talentBase) return fail('talent_short');
  if (treasuryCredited < treasuryBase) return fail('treasury_short');
  const spent = ownerSpentBase(tx, payer, mint);
  if (spent < priceBase) return fail('underpaid');

  return {
    ok: true,
    spentBase: spent,
    talentCreditedBase: talentCredited,
    treasuryCreditedBase: treasuryCredited,
  };
}
