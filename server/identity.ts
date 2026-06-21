// $WOC-paid identity actions (character rename, guild rename, vanity-name
// reservation) over a two-step quote → confirm flow:
//
//   POST /api/identity/quote   { kind, ... }      → { quoteId, mint, amountBase, memo, ... }
//   POST /api/identity/confirm { quoteId, signature } → the applied action
//
// The client pays on-chain (burns $WOC, memo = quoteId) between the two calls;
// the server independently verifies the finalized burn before applying anything.
// This module owns the flow + validation but NOT the game/social/SQL specifics:
// those are injected as `IdentityActions` by server/main.ts, mirroring how
// SocialService takes a SocialDb. No raw SQL lives here.
import type http from 'node:http';
import { randomBytes } from 'node:crypto';
import { json, readBody } from './http_util';
import {
  walletForAccount,
  createWocQuote,
  getWocQuote,
  deleteWocQuote,
  pruneWocQuotes,
  recordWocPayment,
} from './db';
import { verifyWocPayment } from './woc_payment';
import {
  WOC_MINT,
  WOC_DECIMALS,
  WOC_BURN_BPS,
  WOC_TREASURY,
  wocPriceBase,
  wocPriceHuman,
  splitPrice,
  type WocPriceKey,
} from './woc_config';

// GET /api/identity/prices — public: the human-readable $WOC price of each paid
// action, so the client can show the cost before the player commits to a quote.
export function handleIdentityPrices(res: http.ServerResponse): void {
  json(res, 200, {
    rename_character: wocPriceHuman('rename_character'),
    rename_guild: wocPriceHuman('rename_guild'),
    reserve_name: wocPriceHuman('reserve_name'),
  });
}

export type IdentityKind = 'rename_character' | 'rename_guild' | 'reserve_name';
const KINDS: IdentityKind[] = ['rename_character', 'rename_guild', 'reserve_name'];

const QUOTE_TTL_MINUTES = 15;

// Result of applying a paid action — status + JSON body returned to the client.
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
  await createWocQuote({ quoteId, accountId, kind, payload: prep.payload, priceBase, mint: WOC_MINT, ttlMinutes: QUOTE_TTL_MINUTES });

  // Everything the client needs to build the burn tx. The memo MUST equal the
  // quoteId — that binds the on-chain payment to this account + action.
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

// POST /api/identity/confirm
export async function handleIdentityConfirm(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  if (!actions) return json(res, 503, { error: 'identity actions unavailable' });
  const wallet = await walletForAccount(accountId);
  if (!wallet) return json(res, 400, { error: 'link a Solana wallet first' });

  const body = await readBody(req);
  const quoteId = typeof body.quoteId === 'string' ? body.quoteId.trim() : '';
  const signature = typeof body.signature === 'string' ? body.signature.trim() : '';
  if (!quoteId || !signature) return json(res, 400, { error: 'quoteId and signature are required' });

  const quote = await getWocQuote(quoteId, accountId);
  if (!quote) return json(res, 400, { error: 'quote expired or already used — request a new one' });

  // Verify the finalized burn BEFORE consuming the quote, so a confirm sent
  // before finalization can be retried without losing the quote (or the burn).
  const priceBase = BigInt(quote.price_base);
  const payment = await verifyWocPayment(signature, wallet.pubkey, priceBase, quoteId);
  if (!payment.ok) {
    const status = payment.reason === 'not_finalized' ? 409 : 400;
    return json(res, status, { error: `payment not verified (${payment.reason})`, reason: payment.reason });
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
