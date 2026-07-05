// HTTP surface for the roaming merchant Logol's $WOC cosmetic shop (docs/prd/
// woc/logol-merchant.md). Reuses the shared on-chain payment core
// (verifyWocPayment) and the woc_quotes/woc_payments ledger. The shop is gated:
// a quote is refused unless the caller finished the "Seen and Unseen" quest
// chain (account-level completedQuestIds). Purchases are cosmetic-only and
// account-bound (grantAccountLogolWare). No SQL here (server/logol_db.ts owns
// it); routing + auth resolution live in server/main.ts.
import { randomBytes } from 'node:crypto';
import type http from 'node:http';
import {
  LOGOL_UNLOCK_QUEST_ID,
  LOGOL_WARES,
  logolShopUnlocked,
  logolWare,
} from '../src/sim/content/logol';
import {
  type AccountCosmetics,
  grantAccountLogolWare,
  loadAccountCosmetics,
  walletForAccount,
} from './db';
import { json, readBody } from './http_util';
import { deleteWocQuote, getWocQuote, insertWocQuote, recordWocPayment } from './logol_db';
import {
  LOGOL_ENABLED,
  splitPrice,
  WOC_DECIMALS,
  WOC_MINT,
  WOC_TREASURY,
  wocPriceLogolBase,
  wocPriceLogolHuman,
} from './woc_config';
import { verifyWocPayment } from './woc_payment';

const QUOTE_TTL_MS = 15 * 60 * 1000;
const QUOTE_KIND = 'logol';

function ownedWares(cosmetics: AccountCosmetics): typeof LOGOL_WARES {
  const owned = new Set(cosmetics.logolWareIds ?? []);
  return LOGOL_WARES.filter((w) => owned.has(w.id));
}

/** GET /api/logol/info: availability, the catalog, and this account's unlock. */
export async function logolInfo(res: http.ServerResponse, accountId: number): Promise<void> {
  const cosmetics = await loadAccountCosmetics(accountId);
  json(res, 200, {
    enabled: LOGOL_ENABLED,
    unlocked: logolShopUnlocked(cosmetics.completedQuestIds),
    unlockQuestId: LOGOL_UNLOCK_QUEST_ID,
    mint: WOC_MINT,
    decimals: WOC_DECIMALS,
    priceWoc: wocPriceLogolHuman(),
    wares: LOGOL_WARES,
  });
}

/** GET /api/logol/inventory: the wares this account owns. */
export async function logolInventory(res: http.ServerResponse, accountId: number): Promise<void> {
  const cosmetics = await loadAccountCosmetics(accountId);
  json(res, 200, { wares: ownedWares(cosmetics) });
}

/** POST /api/logol/quote { wareId }: create a single-use burn quote for a ware. */
export async function logolQuote(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  if (!LOGOL_ENABLED) return json(res, 404, { error: 'logol_disabled' });
  let body: { wareId?: unknown };
  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, { error: 'bad_json' });
  }
  const wareId = typeof body.wareId === 'string' ? body.wareId : '';
  const ware = logolWare(wareId);
  if (!ware) return json(res, 400, { error: 'unknown_ware' });

  const cosmetics = await loadAccountCosmetics(accountId);
  if (!logolShopUnlocked(cosmetics.completedQuestIds)) {
    return json(res, 403, { error: 'shop_locked' });
  }
  const wallet = await walletForAccount(accountId);
  if (!wallet) return json(res, 400, { error: 'no_wallet' });

  const priceBase = wocPriceLogolBase();
  const quoteId = randomBytes(24).toString('hex');
  const expiresAt = Date.now() + QUOTE_TTL_MS;
  await insertWocQuote(quoteId, accountId, QUOTE_KIND, { wareId }, priceBase, WOC_MINT, expiresAt);

  const { burnBase, treasuryBase } = splitPrice(priceBase);
  json(res, 200, {
    quoteId,
    memo: quoteId,
    mint: WOC_MINT,
    decimals: WOC_DECIMALS,
    amountBase: priceBase.toString(),
    burnBase: burnBase.toString(),
    treasuryBase: treasuryBase.toString(),
    treasury: WOC_TREASURY,
    priceWoc: wocPriceLogolHuman(),
    wareId,
    payer: wallet.pubkey,
    expiresAt,
  });
}

/** POST /api/logol/confirm { quoteId, signature }: settle a quote and grant. */
export async function logolConfirm(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  let body: { quoteId?: unknown; signature?: unknown };
  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, { error: 'bad_json' });
  }
  const quoteId = typeof body.quoteId === 'string' ? body.quoteId : '';
  const signature = typeof body.signature === 'string' ? body.signature : '';
  if (!quoteId || !signature) return json(res, 400, { error: 'bad_request' });

  const quote = await getWocQuote(quoteId, accountId);
  if (!quote || quote.kind !== QUOTE_KIND) return json(res, 404, { error: 'quote_not_found' });
  if (quote.expiresAt <= Date.now()) {
    await deleteWocQuote(quoteId);
    return json(res, 400, { error: 'quote_expired' });
  }
  const wareId = typeof quote.payload.wareId === 'string' ? quote.payload.wareId : '';
  if (!logolWare(wareId)) return json(res, 400, { error: 'unknown_ware' });

  const wallet = await walletForAccount(accountId);
  if (!wallet) return json(res, 400, { error: 'no_wallet' });

  const result = await verifyWocPayment(signature, wallet.pubkey, quote.priceBase, quoteId);
  if (!result.ok) {
    // 'not_finalized' is retryable (the tx may not be finalized yet); the rest
    // mean the client must re-quote and re-burn.
    const status = result.reason === 'not_finalized' ? 409 : 400;
    return json(res, status, { error: result.reason ?? 'payment_invalid' });
  }

  const recorded = await recordWocPayment(
    accountId,
    signature,
    result.spentBase,
    result.burnedBase,
    quote.mint,
    `${QUOTE_KIND}:${quoteId}`,
  );
  if (!recorded) return json(res, 409, { error: 'already_settled' });

  await grantAccountLogolWare(accountId, wareId);
  await deleteWocQuote(quoteId);
  const cosmetics = await loadAccountCosmetics(accountId);
  json(res, 200, { ok: true, wareId, wares: ownedWares(cosmetics) });
}
