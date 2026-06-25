// Non-custodial Ethereum/EVM wallet linking (DB + HTTP shell), the EVM analog of
// server/wallet.ts. The chain owns wallet control; we only observe it. To link, we
// issue a short-lived single-use EIP-4361 challenge, the player signs it, and we
// verify here. Externally-owned accounts (EOAs) verify with a pure secp256k1
// recovery (server/wallet_link_evm.ts); smart-contract wallets (Gnosis Safe, etc.)
// have no private key, so we fall through to an on-chain EIP-1271 `isValidSignature`
// check via `eth_call`. No keys, seeds, or funds ever touch the server.
import type http from 'node:http';
import { randomBytes } from 'node:crypto';
import { json, readBody } from './http_util';
import {
  isEvmAddress, normalizeEvmAddress, buildEvmLinkMessage, verifyEvmEoaSignature,
  personalSignDigest, encodeIsValidSignatureCall, isEip1271Valid,
} from './wallet_link_evm';
import { ethGetCode, ethCall, ETH_CHAIN_ID } from './eth_rpc';
import { walletLinkRateLimited } from './ratelimit';
import {
  createEvmWalletChallenge,
  consumeEvmWalletChallenge,
  pruneEvmWalletChallenges,
  linkEvmWalletToAccount,
  evmWalletForAccount,
  unlinkEvmWallet,
} from './db';

const CHALLENGE_TTL_MINUTES = 10;

function requestDomain(req: http.IncomingMessage): string {
  const host = (req.headers.host ?? '').split(':')[0];
  return host || 'world-of-claudecraft';
}

function requestUri(req: http.IncomingMessage): string {
  const host = req.headers.host ?? 'world-of-claudecraft';
  return `https://${host}`;
}

// POST /api/wallet/evm/link/challenge  { address }  -> { nonce, message }
export async function handleEvmWalletChallenge(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  if (walletLinkRateLimited(req, accountId)) return json(res, 429, { error: 'rate limited' });
  const body = await readBody(req);
  const raw = typeof body.address === 'string' ? body.address.trim() : '';
  if (!isEvmAddress(raw)) return json(res, 400, { error: 'invalid Ethereum wallet address' });
  const address = normalizeEvmAddress(raw);

  await pruneEvmWalletChallenges();
  const nonce = randomBytes(16).toString('hex');
  const now = Date.now();
  const issuedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + CHALLENGE_TTL_MINUTES * 60_000).toISOString();
  const message = buildEvmLinkMessage({
    domain: requestDomain(req), uri: requestUri(req), accountId, address,
    chainId: ETH_CHAIN_ID, nonce, issuedAt, expiresAt,
  });
  await createEvmWalletChallenge(nonce, accountId, address, message, CHALLENGE_TTL_MINUTES);
  return json(res, 200, { nonce, message });
}

/** Verify an EIP-1271 smart-contract-wallet signature on-chain. Returns false
 *  when the RPC is unavailable, so a smart-wallet link cannot succeed on an
 *  unverifiable read (fail-closed). */
export async function verifyContractSignature(address: string, message: string, signature: string): Promise<boolean> {
  const code = await ethGetCode(address);
  if (!code || code === '0x') return false; // not a contract (or RPC down) -> no 1271 path
  const digest = personalSignDigest(message);
  const result = await ethCall(address, encodeIsValidSignatureCall(digest, signature));
  return isEip1271Valid(result);
}

// POST /api/wallet/evm/link  { address, signature, nonce }  -> { address, linked }
export async function handleEvmWalletLink(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  if (walletLinkRateLimited(req, accountId)) return json(res, 429, { error: 'rate limited' });
  const body = await readBody(req);
  const raw = typeof body.address === 'string' ? body.address.trim() : '';
  const signature = typeof body.signature === 'string' ? body.signature.trim() : '';
  const nonce = typeof body.nonce === 'string' ? body.nonce.trim() : '';
  if (!isEvmAddress(raw) || !signature || !nonce) {
    return json(res, 400, { error: 'address, signature, and nonce are required' });
  }
  const address = normalizeEvmAddress(raw);

  const challenge = await consumeEvmWalletChallenge(nonce, accountId);
  if (!challenge) return json(res, 400, { error: 'challenge expired or already used - request a new one' });
  if (challenge.address !== address) return json(res, 400, { error: 'wallet address does not match the challenge' });

  // EOA recovery first (cheap, no RPC); contract wallets fall through to EIP-1271.
  const ok = verifyEvmEoaSignature(challenge.message, signature, address)
    || await verifyContractSignature(address, challenge.message, signature);
  if (!ok) return json(res, 401, { error: 'signature verification failed' });

  const linked = await linkEvmWalletToAccount(accountId, address, ETH_CHAIN_ID);
  if (!linked) return json(res, 409, { error: 'this wallet is already linked to another account' });
  return json(res, 200, { address, linked: true });
}

// GET /api/wallet/evm  -> { wallet: { address, chainId, linkedAt } | null }
export async function handleEvmWalletGet(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  const row = await evmWalletForAccount(accountId);
  return json(res, 200, { wallet: row ? { address: row.address, chainId: row.chain_id, linkedAt: row.linked_at } : null });
}

// DELETE /api/wallet/evm/link  -> { unlinked: true }
export async function handleEvmWalletUnlink(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  await unlinkEvmWallet(accountId);
  return json(res, 200, { unlinked: true });
}
