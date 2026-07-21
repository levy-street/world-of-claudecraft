import { describe, expect, it } from 'vitest';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {
  buildSignMessage,
  isValidSolanaAddress,
  verifyWalletSignature,
} from '@/lib/signature';

function makeWallet() {
  const kp = nacl.sign.keyPair();
  return { wallet: bs58.encode(kp.publicKey), secretKey: kp.secretKey };
}

function sign(message: string, secretKey: Uint8Array): Uint8Array {
  return nacl.sign.detached(new TextEncoder().encode(message), secretKey);
}

describe('wallet signature verification', () => {
  it('accepts a valid signature in base58 and base64 encodings', () => {
    const { wallet, secretKey } = makeWallet();
    const message = buildSignMessage('register', wallet, 'nonce123456789abcdef');
    const sig = sign(message, secretKey);
    expect(verifyWalletSignature(wallet, message, bs58.encode(sig))).toBe(true);
    expect(verifyWalletSignature(wallet, message, Buffer.from(sig).toString('base64'))).toBe(true);
  });

  it('rejects a signature from a different wallet', () => {
    const alice = makeWallet();
    const mallory = makeWallet();
    const message = buildSignMessage('register', alice.wallet, 'nonce123456789abcdef');
    const sig = sign(message, mallory.secretKey);
    expect(verifyWalletSignature(alice.wallet, message, bs58.encode(sig))).toBe(false);
  });

  it('rejects a signature over a different message (nonce swap)', () => {
    const { wallet, secretKey } = makeWallet();
    const sig = sign(buildSignMessage('register', wallet, 'nonce-A-0123456789'), secretKey);
    const otherMessage = buildSignMessage('register', wallet, 'nonce-B-0123456789');
    expect(verifyWalletSignature(wallet, otherMessage, bs58.encode(sig))).toBe(false);
  });

  it('rejects purpose confusion (register signature used for revoke)', () => {
    const { wallet, secretKey } = makeWallet();
    const nonce = 'nonce123456789abcdef';
    const sig = sign(buildSignMessage('register', wallet, nonce), secretKey);
    expect(verifyWalletSignature(wallet, buildSignMessage('revoke', wallet, nonce), bs58.encode(sig))).toBe(false);
  });

  it('binds the vendor: an openai register signature cannot register anthropic', () => {
    const { wallet, secretKey } = makeWallet();
    const nonce = 'nonce123456789abcdef';
    const sig = sign(buildSignMessage('register', wallet, nonce, 'openai'), secretKey);
    expect(
      verifyWalletSignature(wallet, buildSignMessage('register', wallet, nonce, 'anthropic'), bs58.encode(sig)),
    ).toBe(false);
    expect(
      verifyWalletSignature(wallet, buildSignMessage('register', wallet, nonce, 'openai'), bs58.encode(sig)),
    ).toBe(true);
  });

  it('includes the vendor line only when a vendor is given', () => {
    expect(buildSignMessage('register', 'W', 'N', 'openai')).toContain('Vendor: openai');
    expect(buildSignMessage('revoke', 'W', 'N')).not.toContain('Vendor:');
  });

  it('rejects garbage wallets and signatures without throwing', () => {
    const { wallet } = makeWallet();
    expect(verifyWalletSignature('not-a-wallet', 'msg', 'sig')).toBe(false);
    expect(verifyWalletSignature(wallet, 'msg', 'too-short')).toBe(false);
  });

  it('validates Solana address shape', () => {
    expect(isValidSolanaAddress(makeWallet().wallet)).toBe(true);
    expect(isValidSolanaAddress('0xdeadbeef')).toBe(false);
    expect(isValidSolanaAddress('')).toBe(false);
  });
});
