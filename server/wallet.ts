// Non-custodial Solana wallet linking.
//
// The chain is the source of truth for wallet ownership; this server only
// *observes* it. To link a wallet to a World of ClaudeCraft account we issue a
// short-lived, single-use challenge message, the player signs it with their
// wallet (Solana = ed25519 over the raw UTF-8 bytes), and we verify the
// signature here. No private keys, seeds, or funds ever touch the server.
import type http from 'node:http';
import { randomBytes } from 'node:crypto';
import { json, readBody } from './http_util';
import { isSolanaAddress, verifySolanaSignature, buildLinkMessage } from './wallet_link';
import { walletLinkRateLimited } from './ratelimit';
import { recordUsageMetric } from './provider_usage';
import {
  createWalletChallenge,
  consumeWalletChallenge,
  pruneWalletChallenges,
  linkWalletToAccount,
  walletForAccount,
  unlinkWallet,
} from './db';

const CHALLENGE_TTL_MINUTES = 10;

function requestDomain(req: http.IncomingMessage): string {
  const host = (req.headers.host ?? '').split(':')[0];
  return host || 'world-of-claudecraft';
}

// POST /api/wallet/link/challenge  { address }  → { nonce, message }
export async function handleWalletChallenge(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  recordUsageMetric('wallet.challenge.request');
  if (walletLinkRateLimited(req, accountId)) {
    recordUsageMetric('wallet.challenge.rate_limited');
    return json(res, 429, { error: 'rate limited' });
  }
  const body = await readBody(req);
  const address = typeof body.address === 'string' ? body.address.trim() : '';
  if (!isSolanaAddress(address)) return json(res, 400, { error: 'invalid Solana wallet address' });

  await pruneWalletChallenges();
  const nonce = randomBytes(16).toString('hex');
  const issuedAt = new Date().toISOString();
  const message = buildLinkMessage({ domain: requestDomain(req), accountId, address, nonce, issuedAt });
  await createWalletChallenge(nonce, accountId, address, message, CHALLENGE_TTL_MINUTES);
  return json(res, 200, { nonce, message });
}

// POST /api/wallet/link  { address, signature, nonce }  → { pubkey, linked }
export async function handleWalletLink(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  recordUsageMetric('wallet.link.request');
  if (walletLinkRateLimited(req, accountId)) {
    recordUsageMetric('wallet.link.rate_limited');
    return json(res, 429, { error: 'rate limited' });
  }
  const body = await readBody(req);
  const address = typeof body.address === 'string' ? body.address.trim() : '';
  const signature = typeof body.signature === 'string' ? body.signature.trim() : '';
  const nonce = typeof body.nonce === 'string' ? body.nonce.trim() : '';
  if (!isSolanaAddress(address) || !signature || !nonce) {
    recordUsageMetric('wallet.link.failure');
    return json(res, 400, { error: 'address, signature, and nonce are required' });
  }

  const challenge = await consumeWalletChallenge(nonce, accountId);
  if (!challenge) {
    recordUsageMetric('wallet.link.failure');
    return json(res, 400, { error: 'challenge expired or already used - request a new one' });
  }
  if (challenge.address !== address) {
    recordUsageMetric('wallet.link.failure');
    return json(res, 400, { error: 'wallet address does not match the challenge' });
  }
  if (!verifySolanaSignature(challenge.message, signature, address)) {
    recordUsageMetric('wallet.link.failure');
    return json(res, 401, { error: 'signature verification failed' });
  }

  const linked = await linkWalletToAccount(accountId, address);
  if (!linked) {
    recordUsageMetric('wallet.link.failure');
    return json(res, 409, { error: 'this wallet is already linked to another account' });
  }
  return json(res, 200, { pubkey: address, linked: true });
}

// GET /api/wallet  → { wallet: { pubkey, linkedAt } | null }
export async function handleWalletGet(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  const row = await walletForAccount(accountId);
  return json(res, 200, { wallet: row ? { pubkey: row.pubkey, linkedAt: row.linked_at } : null });
}

// DELETE /api/wallet/link  → { unlinked: true }
export async function handleWalletUnlink(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  await unlinkWallet(accountId);
  return json(res, 200, { unlinked: true });
}
