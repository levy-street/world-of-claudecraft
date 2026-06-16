import { describe, expect, it } from 'vitest';
import bs58 from 'bs58';
import { ed25519 } from '@noble/curves/ed25519';
import { isSolanaAddress, verifySolanaSignature, buildLinkMessage } from '../server/wallet_link';

// A Solana wallet signMessage() is exactly ed25519 over the raw UTF-8 bytes, so
// a @noble/curves keypair is an accurate stand-in for a real wallet here.
function makeWallet(): { priv: Uint8Array; address: string } {
  const priv = ed25519.utils.randomPrivateKey();
  const pub = ed25519.getPublicKey(priv);
  return { priv, address: bs58.encode(pub) };
}

function sign(message: string, priv: Uint8Array): string {
  return bs58.encode(ed25519.sign(new TextEncoder().encode(message), priv));
}

describe('wallet link signature verification', () => {
  const wallet = makeWallet();
  const message = buildLinkMessage({
    domain: 'localhost',
    accountId: 42,
    address: wallet.address,
    nonce: 'abc123def456',
    issuedAt: '2026-06-16T00:00:00.000Z',
  });

  it('accepts a valid signature from the signing wallet', () => {
    expect(verifySolanaSignature(message, sign(message, wallet.priv), wallet.address)).toBe(true);
  });

  it('rejects a tampered message', () => {
    const signature = sign(message, wallet.priv);
    expect(verifySolanaSignature(message + ' ', signature, wallet.address)).toBe(false);
  });

  it('rejects a signature produced by a different wallet', () => {
    const other = makeWallet();
    expect(verifySolanaSignature(message, sign(message, other.priv), wallet.address)).toBe(false);
  });

  it('rejects a valid signature presented under a different address', () => {
    const other = makeWallet();
    expect(verifySolanaSignature(message, sign(message, wallet.priv), other.address)).toBe(false);
  });

  it('rejects garbage / malformed input without throwing', () => {
    expect(verifySolanaSignature(message, 'not-a-signature', wallet.address)).toBe(false);
    expect(verifySolanaSignature(message, bs58.encode(new Uint8Array(10)), wallet.address)).toBe(false);
    expect(verifySolanaSignature(message, sign(message, wallet.priv), 'has0OIlchars')).toBe(false);
  });
});

describe('isSolanaAddress', () => {
  it('accepts a real 32-byte base58 pubkey', () => {
    expect(isSolanaAddress(makeWallet().address)).toBe(true);
  });

  it('rejects non-strings, wrong byte length, and non-base58', () => {
    expect(isSolanaAddress(123)).toBe(false);
    expect(isSolanaAddress('')).toBe(false);
    expect(isSolanaAddress(bs58.encode(new Uint8Array(31)))).toBe(false);
    expect(isSolanaAddress('not valid base58 +/=')).toBe(false);
  });
});

describe('buildLinkMessage', () => {
  it('embeds account, wallet, nonce, and domain so the signed text is unambiguous', () => {
    const m = buildLinkMessage({ domain: 'play.woc', accountId: 7, address: 'WALLET123', nonce: 'N1', issuedAt: 'T' });
    expect(m).toContain('Account: #7');
    expect(m).toContain('Wallet: WALLET123');
    expect(m).toContain('Nonce: N1');
    expect(m).toContain('play.woc');
  });
});
