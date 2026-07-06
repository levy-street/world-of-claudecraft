// $WOC-paid respec + loadout-slot actions (#472) over the SAME two-step
// quote/confirm flow the identity actions use:
//
//   POST /api/respec/quote    { kind, characterId }   -> { quoteId, mint, amountBase, memo, ... }
//   GET  /api/respec/paycontext?quoteId=...           -> { blockhash, payerTokenAccount, ... }
//   POST /api/respec/confirm  { quoteId, signature }  -> the applied action
//
// This module is a thin parallel to server/identity.ts: it REUSES the payment
// layer verbatim (server/woc_payment.ts verifyWocPayment, the woc_quotes /
// woc_payments tables + their db helpers, the woc_config pricing/split), and
// injects the game/state specifics as `RespecActions` (server/respec_actions.ts).
// No crypto/signing/verification is reimplemented here.
//
// Fail-closed: every route 404s unless PAID_RESPEC_ENABLED is set, so a default
// deploy of this branch changes no behavior. This is a SEPARATE flag from
// WOC_IDENTITY_ENABLED, so the feature can ship dark on its own.
import { randomBytes } from 'node:crypto';
import type http from 'node:http';
import {
  createWocQuote,
  deleteWocQuote,
  getWocQuote,
  pruneWocQuotes,
  recordWocPayment,
  walletForAccount,
} from './db';
import { json, readBody } from './http_util';
import { RESPEC_KINDS, type RespecActions, type RespecKind } from './respec_actions';
import { getLatestBlockhash, largestTokenAccountForOwner } from './solana_tx';
import {
  paidRespecEnabled,
  splitPrice,
  WOC_BURN_BPS,
  WOC_DECIMALS,
  WOC_MINT,
  WOC_TREASURY,
  wocPriceBase,
  wocPriceHuman,
} from './woc_config';
import { verifyWocPayment } from './woc_payment';

// The quote `kind` prefix used in the woc_payments `reference` column, so a
// respec payment is never confused with an identity payment in the audit trail.
// (The tx_sig UNIQUE guard is shared and global regardless of prefix: a
// signature used for ANY purpose can never be redeemed again.)
const QUOTE_KIND_PREFIX = 'respec';
const QUOTE_TTL_MINUTES = 15;

function featureDisabled(res: http.ServerResponse): boolean {
  if (paidRespecEnabled()) return false;
  json(res, 404, { error: 'not found' });
  return true;
}

// GET /api/respec/prices. Public: the human-readable $WOC price of each paid
// action + the feature probe (a 404 means the paid flow is off).
export function handleRespecPrices(res: http.ServerResponse): void {
  if (featureDisabled(res)) return;
  json(res, 200, {
    respec: wocPriceHuman('respec'),
    loadout_slot: wocPriceHuman('loadout_slot'),
  });
}

// The stored quote `kind` is namespaced so it can never collide with an identity
// quote id space in the shared woc_quotes table.
function storedKind(kind: RespecKind): string {
  return `${QUOTE_KIND_PREFIX}:${kind}`;
}
function parseStoredKind(stored: string): RespecKind | null {
  if (!stored.startsWith(`${QUOTE_KIND_PREFIX}:`)) return null;
  const k = stored.slice(QUOTE_KIND_PREFIX.length + 1);
  return (RESPEC_KINDS as string[]).includes(k) ? (k as RespecKind) : null;
}

let actions: RespecActions | null = null;
export function registerRespecActions(a: RespecActions): void {
  actions = a;
}

// POST /api/respec/quote
export async function handleRespecQuote(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  if (featureDisabled(res)) return;
  if (!actions) return json(res, 503, { error: 'respec actions unavailable' });
  const wallet = await walletForAccount(accountId);
  if (!wallet) return json(res, 400, { error: 'link a Solana wallet first' });

  const body = await readBody(req);
  const kind = typeof body.kind === 'string' ? (body.kind as RespecKind) : ('' as RespecKind);
  if (!RESPEC_KINDS.includes(kind)) return json(res, 400, { error: 'unknown respec action' });

  const prep = await actions.prepare(accountId, kind, body);
  if (!prep.ok) return json(res, prep.status, { error: prep.error });

  const priceBase = wocPriceBase(prep.priceKey);
  const { burnBase, treasuryBase } = splitPrice(priceBase);
  await pruneWocQuotes();
  const quoteId = randomBytes(16).toString('hex');
  await createWocQuote({
    quoteId,
    accountId,
    kind: storedKind(kind),
    payload: prep.payload,
    priceBase,
    mint: WOC_MINT,
    ttlMinutes: QUOTE_TTL_MINUTES,
  });

  // The memo MUST equal the quoteId: that binds the on-chain payment to this
  // account + action, exactly as the identity flow does.
  return json(res, 200, {
    quoteId,
    memo: quoteId,
    mint: WOC_MINT,
    decimals: WOC_DECIMALS,
    amountBase: priceBase.toString(),
    burnBase: burnBase.toString(),
    treasuryBase: treasuryBase.toString(),
    treasury: WOC_TREASURY,
    burnBps: WOC_BURN_BPS,
    priceWoc: wocPriceHuman(prep.priceKey),
    payer: wallet.pubkey,
    expiresAt: Date.now() + QUOTE_TTL_MINUTES * 60_000,
  });
}

// GET /api/respec/paycontext?quoteId=...
export async function handleRespecPayContext(
  res: http.ServerResponse,
  accountId: number,
  rawUrl: string,
): Promise<void> {
  if (featureDisabled(res)) return;
  const wallet = await walletForAccount(accountId);
  if (!wallet) return json(res, 400, { error: 'link a Solana wallet first' });
  const quoteId = new URL(rawUrl, 'http://localhost').searchParams.get('quoteId') ?? '';
  const quote = quoteId ? await getWocQuote(quoteId, accountId) : null;
  if (!quote || !parseStoredKind(quote.kind)) {
    return json(res, 400, { error: 'quote expired or already used, request a new one' });
  }

  const payerTokenAccount = await largestTokenAccountForOwner(wallet.pubkey, quote.mint);
  if (!payerTokenAccount) {
    return json(res, 400, {
      error: 'this wallet holds no $WOC token account',
      reason: 'no_token_account',
    });
  }
  let treasuryTokenAccount: string | null = null;
  const { treasuryBase } = splitPrice(BigInt(quote.price_base));
  if (treasuryBase > 0n && WOC_TREASURY) {
    treasuryTokenAccount = await largestTokenAccountForOwner(WOC_TREASURY, quote.mint);
    if (!treasuryTokenAccount) {
      return json(res, 503, { error: 'treasury is not ready', reason: 'treasury_unavailable' });
    }
  }
  const blockhash = await getLatestBlockhash();
  if (!blockhash)
    return json(res, 503, { error: 'Solana RPC unavailable', reason: 'rpc_unavailable' });
  return json(res, 200, { blockhash, payerTokenAccount, treasuryTokenAccount });
}

// POST /api/respec/confirm
export async function handleRespecConfirm(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  if (featureDisabled(res)) return;
  if (!actions) return json(res, 503, { error: 'respec actions unavailable' });
  const wallet = await walletForAccount(accountId);
  if (!wallet) return json(res, 400, { error: 'link a Solana wallet first' });

  const body = await readBody(req);
  const quoteId = typeof body.quoteId === 'string' ? body.quoteId.trim() : '';
  const signature = typeof body.signature === 'string' ? body.signature.trim() : '';
  if (!quoteId || !signature) {
    return json(res, 400, { error: 'quoteId and signature are required' });
  }

  const quote = await getWocQuote(quoteId, accountId);
  const kind = quote ? parseStoredKind(quote.kind) : null;
  if (!quote || !kind) {
    return json(res, 400, { error: 'quote expired or already used, request a new one' });
  }

  // Verify the finalized burn BEFORE consuming the quote (reuses the identity
  // flow's exact verifier), so a confirm sent before finalization can be retried
  // without losing the quote (or the burn). The memo is the quoteId.
  const priceBase = BigInt(quote.price_base);
  const payment = await verifyWocPayment(signature, wallet.pubkey, priceBase, quoteId);
  if (!payment.ok) {
    const status = payment.reason === 'not_finalized' ? 409 : 400;
    return json(res, status, {
      error: `payment not verified (${payment.reason})`,
      reason: payment.reason,
    });
  }

  // Replay guard: the shared woc_payments tx_sig UNIQUE settles a signature to
  // exactly one action, for ANY purpose. A racing/duplicate confirm (or a
  // signature already used for an identity action) loses here and never applies.
  const rec = await recordWocPayment({
    accountId,
    txSig: signature,
    amountBase: payment.spentBase,
    burnedBase: payment.burnedBase,
    mint: quote.mint,
    reference: `${quote.kind}:${quoteId}`,
  });
  if (!rec) return json(res, 409, { error: 'this payment was already used' });

  const result = await actions.apply(accountId, kind, quote.payload);
  await deleteWocQuote(quoteId).catch(() => {});
  return json(res, result.status, result.body);
}
