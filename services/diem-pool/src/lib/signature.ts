import nacl from 'tweetnacl';
import bs58 from 'bs58';

// Solana wallet signature auth. A Solana address is a base58-encoded ed25519
// public key; providers prove wallet ownership by signing a server-issued
// message (containing a one-time nonce) with their wallet key.

export function isValidSolanaAddress(address: string): boolean {
  try {
    return bs58.decode(address).length === 32;
  } catch {
    return false;
  }
}

/** Accepts base58 (Phantom's default) or base64 signature encodings. */
function decodeSignature(signature: string): Uint8Array | null {
  try {
    const b = bs58.decode(signature);
    if (b.length === 64) return b;
  } catch {
    /* fall through to base64 */
  }
  try {
    const b = Buffer.from(signature, 'base64');
    if (b.length === 64) return new Uint8Array(b);
  } catch {
    /* invalid */
  }
  return null;
}

export function verifyWalletSignature(
  wallet: string,
  message: string,
  signature: string,
): boolean {
  if (!isValidSolanaAddress(wallet)) return false;
  const sig = decodeSignature(signature);
  if (!sig) return false;
  const pubkey = bs58.decode(wallet);
  const msgBytes = new TextEncoder().encode(message);
  try {
    return nacl.sign.detached.verify(msgBytes, sig, pubkey);
  } catch {
    return false;
  }
}

/**
 * The exact message a provider signs. Server-built on both issue and verify so
 * the client can't vary it; the nonce makes it single-use. Registration binds
 * the vendor so a signature for one vendor can't register a key for another.
 */
export function buildSignMessage(
  purpose: 'register' | 'revoke',
  wallet: string,
  nonce: string,
  vendor?: string,
): string {
  const lines = ['World of ClaudeCraft DIEM Pool', `Action: ${purpose}`];
  if (vendor) lines.push(`Vendor: ${vendor}`);
  lines.push(`Wallet: ${wallet}`, `Nonce: ${nonce}`);
  return lines.join('\n');
}
