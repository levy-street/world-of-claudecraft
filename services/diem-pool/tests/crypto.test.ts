import { describe, expect, it } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  last4,
  redactSecrets,
  timingSafeEqualStr,
} from '@/lib/crypto';

const KEY = 'a'.repeat(64);
const OTHER_KEY = 'b'.repeat(64);

describe('AES-256-GCM key envelope', () => {
  it('round-trips arbitrary secrets', () => {
    for (const secret of ['vn_key_1234567890abcdef', 'key unicode \u{1F511}', 'x'.repeat(500)]) {
      expect(decryptSecret(encryptSecret(secret, KEY), KEY)).toBe(secret);
    }
  });

  it('produces a fresh IV per encryption (identical plaintexts differ)', () => {
    const a = encryptSecret('same-secret', KEY);
    const b = encryptSecret('same-secret', KEY);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, KEY)).toBe(decryptSecret(b, KEY));
  });

  it('never stores plaintext in the envelope', () => {
    const secret = 'vn_super_secret_key_123456';
    expect(encryptSecret(secret, KEY)).not.toContain(secret);
  });

  it('rejects tampered ciphertext (GCM auth)', () => {
    const envelope = encryptSecret('secret', KEY);
    const parts = envelope.split(':');
    const ct = Buffer.from(parts[2], 'base64');
    ct[0] ^= 0xff;
    parts[2] = ct.toString('base64');
    expect(() => decryptSecret(parts.join(':'), KEY)).toThrow();
  });

  it('rejects the wrong key', () => {
    expect(() => decryptSecret(encryptSecret('secret', KEY), OTHER_KEY)).toThrow();
  });

  it('rejects malformed envelopes and bad keys', () => {
    expect(() => decryptSecret('not-an-envelope', KEY)).toThrow();
    expect(() => encryptSecret('secret', 'short')).toThrow();
  });
});

describe('helpers', () => {
  it('last4 exposes only the tail', () => {
    expect(last4('vn_key_abcd1234')).toBe('1234');
  });

  it('redactSecrets scrubs bearer tokens and known secrets', () => {
    const out = redactSecrets('Authorization: Bearer vn_key_abc123 failed for vn_key_abc123', [
      'vn_key_abc123',
    ]);
    expect(out).not.toContain('vn_key_abc123');
  });

  it('timingSafeEqualStr compares correctly', () => {
    expect(timingSafeEqualStr('secret-token', 'secret-token')).toBe(true);
    expect(timingSafeEqualStr('secret-token', 'secret-tokeX')).toBe(false);
    expect(timingSafeEqualStr('short', 'longer-string')).toBe(false);
  });
});
