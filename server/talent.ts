// HTTP surface for the featured-talent multi-currency checkout (docs/prd/woc/
// talent-checkout.md). A buyer purchases a talent-owned cosmetic ware paying in
// their CHOICE of USDC, SOL, or $WOC; the sale splits 80/20 (talent/treasury),
// recorded per sale in talent_sales. Reuses the shared on-chain verification
// path (verifyTalentPayment over server/solana_tx.ts, the same primitives the
// Logol / rename $WOC flows use) and the shared woc_quotes quote ledger. No SQL
// here (server/talent_db.ts + server/logol_db.ts own it); routing + auth
// resolution live in server/main.ts. Gated behind TALENT_PROGRAM_ENABLED
// (default OFF, fail closed).
import { randomBytes } from 'node:crypto';
import type http from 'node:http';
import { TALENT_WARES, talentWare } from '../src/sim/content/talent';
import {
  type AccountCosmetics,
  grantAccountTalentWare,
  loadAccountCosmetics,
  walletForAccount,
} from './db';
import { json, readBody } from './http_util';
import { deleteWocQuote, getWocQuote, insertWocQuote } from './logol_db';
import {
  decimalsFor,
  humanToBase,
  isTalentCurrency,
  mintFor,
  TALENT_PROGRAM_ENABLED,
  TALENT_TREASURY,
  type TalentCurrency,
  talentWallet,
} from './talent_config';
import { recordTalentSale } from './talent_db';
import { verifyTalentPayment } from './talent_payment';
import { talentSplit } from './talent_split';

const QUOTE_TTL_MS = 15 * 60 * 1000;
const QUOTE_KIND = 'talent';

function ownedTalentWares(cosmetics: AccountCosmetics): typeof TALENT_WARES {
  const owned = new Set(cosmetics.talentWareIds ?? []);
  return TALENT_WARES.filter((w) => owned.has(w.id));
}

// A talent ware is purchasable only when the feature is on AND the talent has a
// configured payout wallet AND a treasury is configured (both credit legs need a
// target). Fail closed on any missing piece.
function wareIsLive(wareId: string): boolean {
  const ware = talentWare(wareId);
  if (!ware) return false;
  return TALENT_PROGRAM_ENABLED && talentWallet(ware.talentId) !== null && TALENT_TREASURY !== null;
}

/**
 * GET /api/talent/storefront: the enabled flag, the accepted currencies, and the
 * live wares (only those whose talent + treasury wallets are configured), each
 * with its per-currency price. Read-only; safe to call with the feature off (it
 * just returns enabled=false and an empty list).
 */
export async function talentStorefront(
  res: http.ServerResponse,
  _accountId: number,
): Promise<void> {
  const wares = TALENT_WARES.filter((w) => wareIsLive(w.id));
  json(res, 200, {
    enabled: TALENT_PROGRAM_ENABLED,
    currencies: ['usdc', 'sol', 'woc'],
    wares,
  });
}

/** GET /api/talent/inventory: the talent wares this account owns. */
export async function talentInventory(res: http.ServerResponse, accountId: number): Promise<void> {
  const cosmetics = await loadAccountCosmetics(accountId);
  json(res, 200, { wares: ownedTalentWares(cosmetics) });
}

/**
 * POST /api/talent/quote { wareId, currency }: create a single-use quote for a
 * ware in the buyer's chosen currency, carrying the on-chain split targets and
 * the exact 80/20 leg amounts the client must satisfy.
 */
export async function talentQuote(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  if (!TALENT_PROGRAM_ENABLED) return json(res, 404, { error: 'talent_disabled' });
  let body: { wareId?: unknown; currency?: unknown };
  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, { error: 'bad_json' });
  }
  const wareId = typeof body.wareId === 'string' ? body.wareId : '';
  if (!isTalentCurrency(body.currency)) return json(res, 400, { error: 'bad_currency' });
  const currency: TalentCurrency = body.currency;
  const ware = talentWare(wareId);
  if (!ware) return json(res, 400, { error: 'unknown_ware' });
  if (!wareIsLive(wareId)) return json(res, 409, { error: 'ware_unavailable' });

  const talent = talentWallet(ware.talentId);
  const treasury = TALENT_TREASURY;
  if (!talent || !treasury) return json(res, 409, { error: 'ware_unavailable' });

  const cosmetics = await loadAccountCosmetics(accountId);
  if ((cosmetics.talentWareIds ?? []).includes(wareId)) {
    return json(res, 409, { error: 'already_owned' });
  }
  const wallet = await walletForAccount(accountId);
  if (!wallet) return json(res, 400, { error: 'no_wallet' });

  const priceBase = humanToBase(ware.price[currency], currency);
  if (priceBase <= 0n) return json(res, 409, { error: 'ware_unavailable' });
  const { talentBase, treasuryBase } = talentSplit(priceBase);
  const mint = mintFor(currency);
  const quoteId = randomBytes(24).toString('hex');
  const expiresAt = Date.now() + QUOTE_TTL_MS;
  // The quote stores everything confirm needs to re-derive the on-chain check
  // WITHOUT re-reading the catalog, so a price re-tune never mismatches an
  // in-flight purchase. `mint` is stored on the shared quote row; the rest rides
  // the JSONB payload. Native SOL has no mint, so a sentinel goes in the column.
  await insertWocQuote(
    quoteId,
    accountId,
    QUOTE_KIND,
    {
      wareId,
      talentId: ware.talentId,
      currency,
      talent,
      treasury,
      talentBase: talentBase.toString(),
      treasuryBase: treasuryBase.toString(),
    },
    priceBase,
    mint ?? 'native-sol',
    expiresAt,
  );

  json(res, 200, {
    quoteId,
    memo: quoteId,
    currency,
    mint,
    decimals: decimalsFor(currency),
    amountBase: priceBase.toString(),
    talentBase: talentBase.toString(),
    treasuryBase: treasuryBase.toString(),
    talent,
    treasury,
    priceHuman: ware.price[currency],
    wareId,
    payer: wallet.pubkey,
    expiresAt,
  });
}

/**
 * POST /api/talent/confirm { quoteId, signature }: verify the on-chain payment,
 * record the sale with its 80/20 split, and grant the ware.
 *
 * Like the Logol confirm, this does NOT re-check the enabled flag or
 * already_owned: by confirm time the buyer has already paid on-chain against a
 * server-issued quote, and refusing would strand real funds. The exploit surface
 * stays closed regardless: the tx_sig UNIQUE guard blocks replaying a payment and
 * grantAccountTalentWare is idempotent.
 */
export async function talentConfirm(
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

  const p = quote.payload;
  const wareId = typeof p.wareId === 'string' ? p.wareId : '';
  const talentId = typeof p.talentId === 'string' ? p.talentId : '';
  const currency = isTalentCurrency(p.currency) ? p.currency : null;
  const talent = typeof p.talent === 'string' ? p.talent : '';
  const treasury = typeof p.treasury === 'string' ? p.treasury : '';
  const talentBase = typeof p.talentBase === 'string' ? BigInt(p.talentBase) : 0n;
  const treasuryBase = typeof p.treasuryBase === 'string' ? BigInt(p.treasuryBase) : 0n;
  if (!talentWare(wareId) || !currency || !talent || !treasury) {
    return json(res, 400, { error: 'bad_quote' });
  }

  const wallet = await walletForAccount(accountId);
  if (!wallet) return json(res, 400, { error: 'no_wallet' });

  const result = await verifyTalentPayment({
    signature,
    payer: wallet.pubkey,
    talent,
    treasury,
    currency,
    priceBase: quote.priceBase,
    talentBase,
    treasuryBase,
    memo: quoteId,
  });
  if (!result.ok) {
    const status = result.reason === 'not_finalized' ? 409 : 400;
    return json(res, status, { error: result.reason ?? 'payment_invalid' });
  }

  const recorded = await recordTalentSale({
    accountId,
    txSig: signature,
    wareId,
    talentId,
    currency,
    amountBase: quote.priceBase,
    talentBase,
    treasuryBase,
  });
  if (!recorded) return json(res, 409, { error: 'already_settled' });

  await grantAccountTalentWare(accountId, wareId);
  await deleteWocQuote(quoteId);
  const cosmetics = await loadAccountCosmetics(accountId);
  json(res, 200, { ok: true, wareId, wares: ownedTalentWares(cosmetics) });
}
