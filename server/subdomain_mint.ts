// Atomic "burn $WOC, mint a player-owned subdomain" endpoints. Unlike the
// rename flow (where the client serializes its own burn tx), the subdomain
// mint must be built server-side: it combines the player's burn with an SNS
// create instruction only the execution wallet (parent-domain owner) can
// authorize. The server builds and partial-signs the transaction; the player
// signs (fee payer + burn authority) and submits through their wallet, so the
// burn AND the mint land together or not at all.
//
//   GET  /api/subdomain/prices                          -> { mint_subdomain }
//   POST /api/subdomain/quote   { characterId, name }   -> { quoteId, txBase64, ... }
//   POST /api/subdomain/confirm { quoteId, signature }  -> the bound character
//
// Fail-closed: every route 404s unless WOC_SNS_ENABLED is set (mirroring the
// identity routes), and 503s while the execution wallet is unconfigured.
import { randomBytes } from 'node:crypto';
import type http from 'node:http';
import { normalizeCharName, offensiveName } from './auth';
import {
  createWocQuote,
  deleteWocQuote,
  getCharacter,
  getWocQuote,
  pruneWocQuotes,
  recordSubdomainAndBind,
  recordWocPayment,
  walletForAccount,
} from './db';
import { json, readBody } from './http_util';
import { buildSubdomainMintTx, fullSubdomain, SUBDOMAIN_SPACE, slugifyLabel } from './sns';
import { rentForSubdomain, resolveSubdomainOwner, snsReady, subdomainAvailable } from './sns_chain';
import { getLatestBlockhash, largestTokenAccountForOwner } from './solana_tx';
import {
  EXECUTION_WALLET_SECRET,
  splitPrice,
  WOC_DECIMALS,
  WOC_MINT,
  WOC_SNS_ENABLED,
  WOC_TREASURY,
  wocPriceBase,
  wocPriceHuman,
} from './woc_config';
import { verifyWocPayment } from './woc_payment';

const QUOTE_TTL_MINUTES = 15;

function featureDisabled(res: http.ServerResponse): boolean {
  if (WOC_SNS_ENABLED) return false;
  json(res, 404, { error: 'not found' });
  return true;
}

function featureUnready(res: http.ServerResponse): boolean {
  if (snsReady()) return false;
  json(res, 503, { error: 'subdomain minting is unavailable' });
  return true;
}

// GET /api/subdomain/prices. Public: the human-readable $WOC price of a
// subdomain mint. Doubles as the feature probe: a 404 here means the flow is
// off and the client hides its entry points (same contract as
// /api/identity/prices).
export function handleSubdomainPrices(res: http.ServerResponse): void {
  if (featureDisabled(res)) return;
  json(res, 200, { mint_subdomain: wocPriceHuman('mint_subdomain') });
}

// POST /api/subdomain/quote
export async function handleSubdomainQuote(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  if (featureDisabled(res) || featureUnready(res)) return;
  const wallet = await walletForAccount(accountId);
  if (!wallet) return json(res, 400, { error: 'link a Solana wallet first' });

  const body = await readBody(req);
  const characterId = Number(body?.characterId);
  if (!Number.isInteger(characterId)) return json(res, 400, { error: 'characterId required' });

  // The label is slugified from the character's display name. Validate both
  // the human name and the resulting on-chain label: a player-owned subdomain
  // can never be reclaimed once minted, so an offensive slug must be blocked
  // before the mint, not moderated after.
  const displayName = normalizeCharName(body?.name);
  if (displayName === null) {
    return json(res, 400, { error: 'invalid character name (2-16 letters)' });
  }
  if (offensiveName(displayName)) {
    return json(res, 400, { error: 'character name is not allowed' });
  }
  const label = slugifyLabel(displayName);
  if (!label) return json(res, 400, { error: 'that name has no valid subdomain form' });
  if (offensiveName(label)) return json(res, 400, { error: 'character name is not allowed' });

  const character = await getCharacter(accountId, characterId);
  if (!character) return json(res, 404, { error: 'character not found' });
  if (character.bound_domain) {
    return json(res, 409, { error: 'this character is already bound to a name' });
  }

  const available = await subdomainAvailable(label);
  if (available === false) return json(res, 409, { error: 'that .sol name is already taken' });
  if (available === null) {
    return json(res, 503, { error: 'could not check subdomain availability, try again' });
  }

  const payerTokenAccount = await largestTokenAccountForOwner(wallet.pubkey, WOC_MINT);
  if (!payerTokenAccount) {
    return json(res, 400, {
      error: 'this wallet holds no $WOC token account',
      reason: 'no_token_account',
    });
  }
  const priceBase = wocPriceBase('mint_subdomain');
  const { burnBase, treasuryBase } = splitPrice(priceBase);
  let treasuryTokenAccount: string | null = null;
  if (treasuryBase > 0n && WOC_TREASURY) {
    treasuryTokenAccount = await largestTokenAccountForOwner(WOC_TREASURY, WOC_MINT);
    if (!treasuryTokenAccount) {
      return json(res, 503, { error: 'treasury is not ready', reason: 'treasury_unavailable' });
    }
  }
  const [blockhash, rentLamports] = await Promise.all([
    getLatestBlockhash(),
    rentForSubdomain(SUBDOMAIN_SPACE),
  ]);
  if (!blockhash || rentLamports === null) {
    return json(res, 503, { error: 'Solana RPC unavailable', reason: 'rpc_unavailable' });
  }

  const quoteId = randomBytes(16).toString('hex');
  const tx = buildSubdomainMintTx({
    payer: wallet.pubkey,
    payerTokenAccount,
    mint: WOC_MINT,
    decimals: WOC_DECIMALS,
    burnBase,
    treasuryTokenAccount,
    treasuryBase,
    memo: quoteId,
    recentBlockhash: blockhash,
    label,
    rentLamports,
    space: SUBDOMAIN_SPACE,
    executionSecret: EXECUTION_WALLET_SECRET,
  });

  await pruneWocQuotes();
  await createWocQuote({
    quoteId,
    accountId,
    kind: 'mint_subdomain',
    payload: { characterId, label, fullDomain: fullSubdomain(label) },
    priceBase,
    mint: WOC_MINT,
    ttlMinutes: QUOTE_TTL_MINUTES,
  });

  return json(res, 200, {
    quoteId,
    txBase64: Buffer.from(tx).toString('base64'),
    label,
    fullDomain: fullSubdomain(label),
    priceWoc: wocPriceHuman('mint_subdomain'),
    payer: wallet.pubkey,
    expiresAt: Date.now() + QUOTE_TTL_MINUTES * 60_000,
  });
}

// POST /api/subdomain/confirm
export async function handleSubdomainConfirm(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  if (featureDisabled(res) || featureUnready(res)) return;
  const wallet = await walletForAccount(accountId);
  if (!wallet) return json(res, 400, { error: 'link a Solana wallet first' });

  const body = await readBody(req);
  const quoteId = typeof body?.quoteId === 'string' ? body.quoteId.trim() : '';
  const signature = typeof body?.signature === 'string' ? body.signature.trim() : '';
  if (!quoteId || !signature) {
    return json(res, 400, { error: 'quoteId and signature are required' });
  }

  const quote = await getWocQuote(quoteId, accountId);
  if (!quote || quote.kind !== 'mint_subdomain') {
    return json(res, 400, { error: 'quote expired or already used, request a new one' });
  }
  const payload = quote.payload as { characterId: number; label: string; fullDomain: string };

  // The $WOC burn must have finalized (memo == quoteId, payer == linked
  // wallet), verified before the quote is consumed so a too-early confirm can
  // be retried.
  const payment = await verifyWocPayment(
    signature,
    wallet.pubkey,
    BigInt(quote.price_base),
    quoteId,
  );
  if (!payment.ok) {
    const status = payment.reason === 'not_finalized' ? 409 : 400;
    return json(res, status, {
      error: `payment not verified (${payment.reason})`,
      reason: payment.reason,
    });
  }
  // ...and the subdomain must now actually be owned by the player on-chain
  // (the create instruction rode the same transaction; an RPC lagging behind
  // finalization reads as retryable).
  const owner = await resolveSubdomainOwner(payload.fullDomain);
  if (owner !== wallet.pubkey) {
    const reason = owner === null ? 'subdomain_not_minted' : 'subdomain_owner_mismatch';
    return json(res, 409, { error: `subdomain ownership not confirmed (${reason})`, reason });
  }

  // Replay guard: a tx_sig settles exactly one action.
  const rec = await recordWocPayment({
    accountId,
    txSig: signature,
    amountBase: payment.spentBase,
    burnedBase: payment.burnedBase,
    mint: quote.mint,
    reference: `mint_subdomain:${quoteId}`,
  });
  if (!rec) return json(res, 409, { error: 'this payment was already used' });

  await recordSubdomainAndBind({
    accountId,
    characterId: payload.characterId,
    label: payload.label,
    fullDomain: payload.fullDomain,
    ownerPubkey: wallet.pubkey,
    txSig: signature,
  });
  await deleteWocQuote(quoteId).catch(() => {});

  return json(res, 200, {
    characterId: payload.characterId,
    fullDomain: payload.fullDomain,
    owner: wallet.pubkey,
  });
}
