import { describe, it, expect } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex } from '@noble/hashes/utils';
import {
  isEvmAddress, normalizeEvmAddress, toChecksumAddress, buildEvmLinkMessage,
  personalSignDigest, recoverEvmSigner, verifyEvmEoaSignature,
  encodeIsValidSignatureCall, isEip1271Valid, EIP1271_MAGIC_VALUE,
} from '../server/wallet_link_evm';

// A fixed, valid secp256k1 key so the suite is deterministic.
const PRIV = new Uint8Array(32).fill(0); PRIV[31] = 7;
const PUB = secp256k1.getPublicKey(PRIV, false);
const ADDRESS = `0x${bytesToHex(keccak_256(PUB.slice(1)).slice(-20))}`;

/** Produce a real EIP-191 personal_sign signature (0x + r||s||v hex) for `message`. */
function personalSign(message: string, priv = PRIV): string {
  const digest = personalSignDigest(message);
  const sig = secp256k1.sign(digest, priv);
  const v = 27 + sig.recovery;
  return `0x${bytesToHex(sig.toCompactRawBytes())}${v.toString(16).padStart(2, '0')}`;
}

describe('isEvmAddress', () => {
  it('accepts a 0x 20-byte hex address (any case)', () => {
    expect(isEvmAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')).toBe(true);
    expect(isEvmAddress('0x' + 'a'.repeat(40))).toBe(true);
  });
  it('rejects wrong length, missing prefix, non-hex, non-string', () => {
    expect(isEvmAddress('0x' + 'a'.repeat(39))).toBe(false);
    expect(isEvmAddress('5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')).toBe(false);
    expect(isEvmAddress('0x' + 'g'.repeat(40))).toBe(false);
    expect(isEvmAddress(123)).toBe(false);
    expect(isEvmAddress(null)).toBe(false);
  });
});

describe('toChecksumAddress — EIP-55 vectors', () => {
  it('produces the canonical mixed-case for the spec test vectors', () => {
    for (const a of [
      '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
      '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
      '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
      '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
    ]) {
      expect(toChecksumAddress(a.toLowerCase())).toBe(a);
    }
  });
});

describe('buildEvmLinkMessage', () => {
  it('is a SIWE-shaped message binding domain, checksummed address, account, nonce, expiry', () => {
    const msg = buildEvmLinkMessage({
      domain: 'play.example', uri: 'https://play.example', accountId: 42, address: ADDRESS,
      chainId: 1, nonce: 'abc123', issuedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-01T00:10:00.000Z',
    });
    expect(msg.split('\n')[0]).toBe('play.example wants you to sign in with your Ethereum account:');
    expect(msg).toContain(toChecksumAddress(ADDRESS));
    expect(msg).toContain('account #42');
    expect(msg).toContain('Chain ID: 1');
    expect(msg).toContain('Nonce: abc123');
    expect(msg).toContain('Expiration Time: 2026-01-01T00:10:00.000Z');
  });
});

describe('recoverEvmSigner / verifyEvmEoaSignature — real signatures', () => {
  const message = buildEvmLinkMessage({
    domain: 'play.example', uri: 'https://play.example', accountId: 1, address: ADDRESS,
    chainId: 1, nonce: 'n0', issuedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-01T00:10:00.000Z',
  });

  it('recovers the exact signer of a personal_sign signature', () => {
    expect(recoverEvmSigner(message, personalSign(message))).toBe(normalizeEvmAddress(ADDRESS));
  });
  it('verifies a valid EOA signature for the matching address (case-insensitive)', () => {
    expect(verifyEvmEoaSignature(message, personalSign(message), ADDRESS)).toBe(true);
    expect(verifyEvmEoaSignature(message, personalSign(message), toChecksumAddress(ADDRESS))).toBe(true);
  });
  it('rejects a signature over a DIFFERENT message (no fixed-message replay)', () => {
    expect(verifyEvmEoaSignature(message + ' ', personalSign(message), ADDRESS)).toBe(false);
  });
  it('rejects a valid signature claimed for the WRONG address', () => {
    const other = '0x' + '1'.repeat(40);
    expect(verifyEvmEoaSignature(message, personalSign(message), other)).toBe(false);
  });
  it('returns null / false on malformed signatures, never throwing', () => {
    expect(recoverEvmSigner(message, '0xdead')).toBeNull();
    expect(recoverEvmSigner(message, '0x' + 'z'.repeat(130))).toBeNull();
    expect(recoverEvmSigner(message, '0x' + '0'.repeat(130))).toBeNull(); // bad v / zero sig
    expect(verifyEvmEoaSignature(message, '0x' + 'f'.repeat(130), ADDRESS)).toBe(false);
  });
  it('accepts legacy v=0/1 as well as 27/28', () => {
    const digest = personalSignDigest(message);
    const sig = secp256k1.sign(digest, PRIV);
    const legacy = `0x${bytesToHex(sig.toCompactRawBytes())}${sig.recovery.toString(16).padStart(2, '0')}`;
    expect(recoverEvmSigner(message, legacy)).toBe(normalizeEvmAddress(ADDRESS));
  });
});

describe('EIP-1271 helpers', () => {
  it('encodes isValidSignature with the correct selector and ABI layout', () => {
    const digest = personalSignDigest('hello');
    const call = encodeIsValidSignatureCall(digest, '0x' + 'ab'.repeat(65));
    // selector for isValidSignature(bytes32,bytes) is 0x1626ba7e
    expect(call.slice(0, 10)).toBe('0x1626ba7e');
    // head: 32-byte hash, then offset word 0x40
    expect(call.slice(10, 74)).toBe(bytesToHex(digest));
    expect(call.slice(74, 138)).toBe((0x40).toString(16).padStart(64, '0'));
    // length word = 65 bytes
    expect(call.slice(138, 202)).toBe((65).toString(16).padStart(64, '0'));
  });
  it('recognizes the magic return value only', () => {
    expect(isEip1271Valid(EIP1271_MAGIC_VALUE + '0'.repeat(56))).toBe(true);
    expect(isEip1271Valid('0x1626ba7e')).toBe(true);
    expect(isEip1271Valid('0xffffffff' + '0'.repeat(56))).toBe(false);
    expect(isEip1271Valid(null)).toBe(false);
    expect(isEip1271Valid('0x')).toBe(false);
  });
});
