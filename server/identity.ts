// $WOC-paid identity actions (character rename, guild rename, vanity-name
// reservation) over a two-step quote to confirm flow:
//
//   POST /api/identity/quote   { kind, ... }          -> { quoteId, mint, amountBase, memo, ... }
//   GET  /api/identity/paycontext?quoteId=...          -> { blockhash, payerTokenAccount, ... }
//   POST /api/identity/confirm { quoteId, signature }  -> the applied action
//
// The client pays on-chain (burns $WOC, memo = quoteId) between quote and
// confirm; the server independently verifies the finalized burn before applying
// anything. This module owns the flow + validation but NOT the game/social/SQL
// specifics: those are injected as `IdentityActions` by server/main.ts,
// mirroring how SocialService takes a SocialDb. No raw SQL lives here.
//
// Fail-closed: every route 404s unless WOC_IDENTITY_ENABLED is set, so a
// default deploy of this branch changes no behavior.
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
import { getLatestBlockhash, largestTokenAccountForOwner } from './solana_tx';
import {
  splitPrice,
  WOC_BURN_BPS,
  WOC_DECIMALS,
  WOC_IDENTITY_ENABLED,
  WOC_MINT,
  WOC_TREASURY,
  type WocPriceKey,
  wocPriceBase,
  wocPriceHuman,
} from './woc_config';
import { verifyWocPayment } from './woc_payment';

function featureDisabled(res: http.ServerResponse): boolean {
  if (WOC_IDENTITY_ENABLED) return false;
  json(res, 404, { error: 'not found' });
  return true;
}

// GET /api/identity/prices. Public: the human-readable $WOC price of each paid
// action, so the client can show the cost before the player commits to a quote.
// Doubles as the feature probe: a 404 here means the paid flow is off and the
// client hides its entry points.
export function handleIdentityPrices(res: http.ServerResponse): void {
  if (featureDisabled(res)) return;
  json(res, 200, {
    rename_character: wocPriceHuman('rename_character'),
    rename_guild: wocPriceHuman('rename_guild'),
    reserve_name: wocPriceHuman('reserve_name'),
  });
}

export type IdentityKind = 'rename_character' | 'rename_guild' | 'reserve_name';
const KINDS: IdentityKind[] = ['rename_character', 'rename_guild', 'reserve_name'];

const QUOTE_TTL_MINUTES = 15;

// Result of applying a paid action: status + JSON body returned to the client.
export interface ApplyResult {
  status: number;
  body: unknown;
}

// Injected by main.ts. `prepare` validates auth/ownership/name and prices the
// request (no quote issued on failure); `apply` performs the paid action with
// exactly the payload prepare() persisted.
export interface IdentityActions {
  prepare(
    accountId: number,
    kind: IdentityKind,
    body: any,
  ): Promise<
    | { ok: true; priceKey: WocPriceKey; payload: Record<string, unknown> }
    | { ok: false; status: number; error: string }
  >;
  apply(accountId: number, kind: IdentityKind, payload: any): Promise<ApplyResult>;
}

let actions: IdentityActions | null = null;
export function registerIdentityActions(a: IdentityActions): void {
  actions = a;
}

// POST /api/identity/quote
export async function handleIdentityQuote(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  if (featureDisabled(res)) return;
  if (!actions) return json(res, 503, { error: 'identity actions unavailable' });
  const wallet = await walletForAccount(accountId);
  if (!wallet) return json(res, 400, { error: 'link a Solana wallet first' });

  const body = await readBody(req);
  const kind = typeof body.kind === 'string' ? (body.kind as IdentityKind) : ('' as IdentityKind);
  if (!KINDS.includes(kind)) return json(res, 400, { error: 'unknown identity action' });

  const prep = await actions.prepare(accountId, kind, body);
  if (!prep.ok) return json(res, prep.status, { error: prep.error });

  const priceBase = wocPriceBase(prep.priceKey);
  const { burnBase, treasuryBase } = splitPrice(priceBase);
  await pruneWocQuotes();
  const quoteId = randomBytes(16).toString('hex');
  await createWocQuote({
    quoteId,
    accountId,
    kind,
    payload: prep.payload,
    priceBase,
    mint: WOC_MINT,
    ttlMinutes: QUOTE_TTL_MINUTES,
  });

  // Everything the client needs to build the burn tx (except the volatile
  // pay-context below). The memo MUST equal the quoteId: that binds the
  // on-chain payment to this account + action.
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

// GET /api/identity/paycontext?quoteId=...
// The volatile on-chain inputs the client needs right before building the burn
// tx: a fresh finalized blockhash plus the payer's (and treasury's) $WOC token
// accounts. Served by us so the Solana RPC endpoint, and any API key embedded
// in it, stays server-side (mirrors server/woc_balance.ts).
export async function handleIdentityPayContext(
  res: http.ServerResponse,
  accountId: number,
  rawUrl: string,
): Promise<void> {
  if (featureDisabled(res)) return;
  const wallet = await walletForAccount(accountId);
  if (!wallet) return json(res, 400, { error: 'link a Solana wallet first' });
  const quoteId = new URL(rawUrl, 'http://localhost').searchParams.get('quoteId') ?? '';
  const quote = quoteId ? await getWocQuote(quoteId, accountId) : null;
  if (!quote) {
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
      // Deploy misconfiguration (treasury split set but no treasury token
      // account exists). Fail the payment cleanly rather than burning into a
      // tx the server would refuse to verify.
      return json(res, 503, { error: 'treasury is not ready', reason: 'treasury_unavailable' });
    }
  }
  const blockhash = await getLatestBlockhash();
  if (!blockhash)
    return json(res, 503, { error: 'Solana RPC unavailable', reason: 'rpc_unavailable' });
  return json(res, 200, { blockhash, payerTokenAccount, treasuryTokenAccount });
}

// POST /api/identity/confirm
export async function handleIdentityConfirm(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  if (featureDisabled(res)) return;
  if (!actions) return json(res, 503, { error: 'identity actions unavailable' });
  const wallet = await walletForAccount(accountId);
  if (!wallet) return json(res, 400, { error: 'link a Solana wallet first' });

  const body = await readBody(req);
  const quoteId = typeof body.quoteId === 'string' ? body.quoteId.trim() : '';
  const signature = typeof body.signature === 'string' ? body.signature.trim() : '';
  if (!quoteId || !signature) {
    return json(res, 400, { error: 'quoteId and signature are required' });
  }

  const quote = await getWocQuote(quoteId, accountId);
  if (!quote) {
    return json(res, 400, { error: 'quote expired or already used, request a new one' });
  }

  // Verify the finalized burn BEFORE consuming the quote, so a confirm sent
  // before finalization can be retried without losing the quote (or the burn).
  const priceBase = BigInt(quote.price_base);
  const payment = await verifyWocPayment(signature, wallet.pubkey, priceBase, quoteId);
  if (!payment.ok) {
    const status = payment.reason === 'not_finalized' ? 409 : 400;
    return json(res, status, {
      error: `payment not verified (${payment.reason})`,
      reason: payment.reason,
    });
  }

  // Replay guard: a tx_sig settles exactly one action. A racing/duplicate
  // confirm with the same signature loses here and never double-applies.
  const rec = await recordWocPayment({
    accountId,
    txSig: signature,
    amountBase: payment.spentBase,
    burnedBase: payment.burnedBase,
    mint: quote.mint,
    reference: `${quote.kind}:${quoteId}`,
  });
  if (!rec) return json(res, 409, { error: 'this payment was already used' });

  const result = await actions.apply(accountId, quote.kind as IdentityKind, quote.payload);
  // The payment is recorded and the action applied; retire the quote so it can't
  // be paid against again. (Failure to delete is non-fatal: it expires anyway.)
  await deleteWocQuote(quoteId).catch(() => {});
  return json(res, result.status, result.body);
}
