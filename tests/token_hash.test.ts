import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { hashToken, newToken } from '../server/auth';

describe('hashToken (session tokens hashed at rest)', () => {
  it('returns the SHA-256 hex digest of the token', () => {
    expect(hashToken('hello')).toBe(createHash('sha256').update('hello').digest('hex'));
  });

  it('is deterministic, so a lookup-by-hash matches the stored hash', () => {
    const token = newToken();
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it('produces a 64-char hex digest regardless of input length', () => {
    for (const t of ['', 'x', newToken(), 'a'.repeat(500)]) {
      expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('maps distinct tokens to distinct hashes', () => {
    const a = newToken();
    const b = newToken();
    expect(a).not.toBe(b);
    expect(hashToken(a)).not.toBe(hashToken(b));
    expect(hashToken('token-a')).not.toBe(hashToken('token-b'));
  });

  it('never returns the raw token (a leaked table holds only digests)', () => {
    const token = newToken();
    expect(hashToken(token)).not.toBe(token);
  });
});
