// Atomic "burn $WOC → mint a player-owned subdomain" flow (PR #735). Unlike the
// rename flow (where the client builds its own burn), the subdomain mint must be
// built server-side: it combines the player's $WOC burn with createSubdomain +
// transferSubdomain instructions that only the execution wallet can authorize.
// The server builds the transaction, partial-signs it with the execution wallet,
// and returns it; the player signs (fee payer + burn authority) and submits, so
// either the burn AND the mint land together, or neither does.
//
//   POST /api/subdomain/quote   { characterId, name } → { quoteId, txBase64, ... }
//   POST /api/subdomain/confirm { quoteId, signature } → the bound character
import type http from 'node:http';
import { randomBytes } from 'node:crypto';
import { Transaction, TransactionInstruction, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, createBurnCheckedInstruction, createTransferCheckedInstruction, createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';
import { json, readBody } from './http_util';
import { normalizeCharName, offensiveName } from './auth';
import {
  walletForAccount,
  getCharacter,
  createWocQuote,
  getWocQuote,
  deleteWocQuote,
  pruneWocQuotes,
  recordWocPayment,
  recordSubdomainAndBind,
} from './db';
import { verifyWocPayment } from './woc_payment';
import {
  slugifyLabel,
  fullSubdomain,
  subdomainAvailable,
  resolveSubdomainOwner,
  buildIssueSubdomainIxs,
  executionWallet,
  snsConnection,
  snsReady,
} from './sns';
import { WOC_MINT, WOC_DECIMALS, WOC_TREASURY, wocPriceBase, wocPriceHuman, splitPrice } from './woc_config';

const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const QUOTE_TTL_MINUTES = 15;

// POST /api/subdomain/quote
export async function handleSubdomainQuote(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  if (!snsReady()) return json(res, 503, { error: 'subdomain minting is not enabled' });
  const wallet = await walletForAccount(accountId);
  if (!wallet) return json(res, 400, { error: 'link a Solana wallet first' });

  const body = await readBody(req);
  const characterId = Number(body.characterId);
  if (!Number.isInteger(characterId)) return json(res, 400, { error: 'characterId required' });

  // The label is slugified from the character's chosen display name; validate the
  // human name and the resulting on-chain label, since a player-owned subdomain
  // can never be reclaimed once minted.
  const displayName = normalizeCharName(body.name);
  if (displayName === null) return json(res, 400, { error: 'invalid name (2-16 letters)' });
  if (offensiveName(displayName)) return json(res, 400, { error: 'name is not allowed' });
  const label = slugifyLabel(displayName);
  if (!label) return json(res, 400, { error: 'that name has no valid subdomain form' });
  if (offensiveName(label)) return json(res, 400, { error: 'name is not allowed' });

  const character = await getCharacter(accountId, characterId);
  if (!character) return json(res, 404, { error: 'character not found' });

  const available = await subdomainAvailable(label);
  if (available === false) return json(res, 409, { error: `${fullSubdomain(label)} is already taken` });
  if (available === null) return json(res, 503, { error: 'could not check subdomain availability — try again' });

  const player = new PublicKey(wallet.pubkey);
  const priceBase = wocPriceBase('sns_subdomain');
  const { burnBase, treasuryBase } = splitPrice(priceBase);
  const mint = new PublicKey(WOC_MINT);
  const playerAta = getAssociatedTokenAddressSync(mint, player);

  const quoteId = randomBytes(16).toString('hex');
  const ixs: TransactionInstruction[] = [];
  if (burnBase > 0n) ixs.push(createBurnCheckedInstruction(playerAta, mint, player, burnBase, WOC_DECIMALS));
  if (treasuryBase > 0n && WOC_TREASURY) {
    const treasury = new PublicKey(WOC_TREASURY);
    const treasuryAta = getAssociatedTokenAddressSync(mint, treasury);
    ixs.push(createAssociatedTokenAccountIdempotentInstruction(player, treasuryAta, treasury, mint));
    ixs.push(createTransferCheckedInstruction(playerAta, mint, treasuryAta, player, treasuryBase, WOC_DECIMALS));
  }
  ixs.push(new TransactionInstruction({ programId: MEMO_PROGRAM_ID, keys: [], data: Buffer.from(quoteId, 'utf8') }));
  ixs.push(...(await buildIssueSubdomainIxs(label, player)));

  const connection = snsConnection();
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
  const tx = new Transaction({ feePayer: player, blockhash, lastValidBlockHeight });
  tx.add(...ixs);
  // Authorize the createSubdomain/transferSubdomain instructions; the player adds
  // the remaining signature (fee payer + burn authority) in their wallet.
  tx.partialSign(executionWallet());
  const txBase64 = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');

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
    txBase64,
    label,
    fullDomain: fullSubdomain(label),
    priceWoc: wocPriceHuman('sns_subdomain'),
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
  if (!snsReady()) return json(res, 503, { error: 'subdomain minting is not enabled' });
  const wallet = await walletForAccount(accountId);
  if (!wallet) return json(res, 400, { error: 'link a Solana wallet first' });

  const body = await readBody(req);
  const quoteId = typeof body.quoteId === 'string' ? body.quoteId.trim() : '';
  const signature = typeof body.signature === 'string' ? body.signature.trim() : '';
  if (!quoteId || !signature) return json(res, 400, { error: 'quoteId and signature are required' });

  const quote = await getWocQuote(quoteId, accountId);
  if (!quote || quote.kind !== 'mint_subdomain') return json(res, 400, { error: 'quote expired or already used — request a new one' });
  const payload = quote.payload as { characterId: number; label: string; fullDomain: string };

  // Verify the $WOC burn finalized (memo == quoteId, payer == linked wallet).
  const payment = await verifyWocPayment(signature, wallet.pubkey, BigInt(quote.price_base), quoteId);
  if (!payment.ok) {
    const status = payment.reason === 'not_finalized' ? 409 : 400;
    return json(res, status, { error: `payment not verified (${payment.reason})`, reason: payment.reason });
  }
  // ...and the subdomain is now actually owned by the player on-chain.
  const owner = await resolveSubdomainOwner(payload.fullDomain);
  if (owner !== wallet.pubkey) {
    const reason = owner === null ? 'subdomain_not_minted' : 'subdomain_owner_mismatch';
    return json(res, 409, { error: `subdomain ownership not confirmed (${reason})`, reason });
  }

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

  return json(res, 200, { characterId: payload.characterId, fullDomain: payload.fullDomain, owner: wallet.pubkey });
}
