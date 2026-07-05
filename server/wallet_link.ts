// Pure (IO-free) helpers for non-custodial Solana wallet linking: address
// validation, the challenge-message format, and ed25519 signature verification.
// Kept separate from server/wallet.ts (which does DB + HTTP) so it can be unit
// tested without a database.

import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';

// Base58 alphabet (Bitcoin/Solana). Testing the charset first guarantees the
// decode below never throws.
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

// bs58.decode is O(n^2) in the input length. The longest input we ever
// legitimately decode is a 64-byte ed25519 signature (~88 base58 chars), so a
// generous 128-char cap keeps a hostile caller from pinning the loop with a huge
// string while leaving every real address/signature comfortably under it.
const MAX_BASE58_LEN = 128;

export function decodeBase58(s: string): Uint8Array | null {
  if (s.length > MAX_BASE58_LEN) return null;
  if (!BASE58.test(s)) return null;
  return bs58.decode(s);
}

/** A Solana address is a 32-byte ed25519 public key, base58-encoded. */
export function isSolanaAddress(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const bytes = decodeBase58(s);
  return bytes !== null && bytes.length === 32;
}

/**
 * Verify that `signatureB58` is a valid ed25519 signature of `message` by the
 * wallet `addressB58`. The verify call is wrapped because the inputs are
 * attacker-controlled and `@noble/curves` throws on malformed points — a forged
 * or garbage signature must read as `false`, never crash the request.
 */
export function verifySolanaSignature(
  message: string,
  signatureB58: string,
  addressB58: string,
): boolean {
  const sig = decodeBase58(signatureB58);
  const pub = decodeBase58(addressB58);
  if (sig === null || pub === null || sig.length !== 64 || pub.length !== 32) return false;
  const msg = new TextEncoder().encode(message);
  try {
    return ed25519.verify(sig, msg, pub);
  } catch {
    return false;
  }
}

/** The exact human-readable text the wallet is asked to sign. */
export function buildLinkMessage(opts: {
  domain: string;
  accountId: number;
  address: string;
  nonce: string;
  issuedAt: string;
}): string {
  return [
    `${opts.domain} wants you to link this Solana wallet to your World of ClaudeCraft account.`,
    '',
    `Account: #${opts.accountId}`,
    `Wallet: ${opts.address}`,
    `Nonce: ${opts.nonce}`,
    `Issued At: ${opts.issuedAt}`,
    '',
    'Signing is free, proves you control this wallet, and authorizes no transaction.',
  ].join('\n');
}
