import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  commitFor,
  DAILY_SEED_BYTES,
  deriveOutcomeUnit,
  generateDailySeed,
  packUnit,
  spinDigest,
  unitFromDigest,
  verifyReveal,
} from '../server/fairness';

describe('generateDailySeed', () => {
  it('returns 32 random bytes that differ between calls', () => {
    const a = generateDailySeed();
    const b = generateDailySeed();
    expect(a.length).toBe(DAILY_SEED_BYTES);
    expect(b.length).toBe(DAILY_SEED_BYTES);
    expect(a.equals(b)).toBe(false);
  });
});

describe('commit / reveal', () => {
  const seed = Buffer.alloc(32, 7);

  it('commit equals sha256(seed) in lowercase hex', () => {
    const expected = createHash('sha256').update(seed).digest('hex');
    expect(commitFor(seed)).toBe(expected);
    expect(commitFor(seed)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verifyReveal accepts the true seed and rejects any tamper', () => {
    const commit = commitFor(seed);
    expect(verifyReveal(commit, seed)).toBe(true);
    expect(verifyReveal(commit.toUpperCase(), seed)).toBe(true); // case-insensitive hex
    const tampered = Buffer.alloc(32, 7);
    tampered[0] = 8;
    expect(verifyReveal(commit, tampered)).toBe(false);
  });

  it('verifyReveal rejects malformed commitments without throwing', () => {
    expect(verifyReveal('', seed)).toBe(false);
    expect(verifyReveal('xyz', seed)).toBe(false);
    expect(verifyReveal('ab'.repeat(31), seed)).toBe(false); // 62 chars
    expect(verifyReveal('g'.repeat(64), seed)).toBe(false); // not hex
  });
});

describe('unitFromDigest known answers', () => {
  it('maps an all-zero digest to 0', () => {
    expect(unitFromDigest(Buffer.alloc(32, 0))).toBe(0);
  });

  it('maps a leading 0x80000000 to exactly 0.5', () => {
    const d = Buffer.alloc(32, 0);
    d[0] = 0x80; // hi = 2^31
    expect(unitFromDigest(d)).toBe(0.5);
  });

  it('maps the maximal 64-bit prefix to just under 1 ((2^53-1)/2^53)', () => {
    const d = Buffer.alloc(32, 0);
    for (let i = 0; i < 8; i++) d[i] = 0xff;
    expect(unitFromDigest(d)).toBe((2 ** 53 - 1) / 2 ** 53);
  });

  it('always lands in [0, 1)', () => {
    for (let i = 0; i < 500; i++) {
      const u = deriveOutcomeUnit(generateDailySeed(), i, 1, `c${i}`);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
  });
});

describe('deriveOutcomeUnit', () => {
  const seed = Buffer.alloc(32, 3);

  it('is deterministic for identical inputs', () => {
    expect(deriveOutcomeUnit(seed, 42, 1, 'abc')).toBe(deriveOutcomeUnit(seed, 42, 1, 'abc'));
  });

  it('changes when any bound field changes (account, nonce, clientSeed, seed)', () => {
    const base = deriveOutcomeUnit(seed, 42, 1, 'abc');
    expect(deriveOutcomeUnit(seed, 43, 1, 'abc')).not.toBe(base);
    expect(deriveOutcomeUnit(seed, 42, 2, 'abc')).not.toBe(base);
    expect(deriveOutcomeUnit(seed, 42, 1, 'abd')).not.toBe(base);
    expect(deriveOutcomeUnit(Buffer.alloc(32, 4), 42, 1, 'abc')).not.toBe(base);
  });

  it('produces a roughly uniform mean over many nonces (sanity, not a proof)', () => {
    let sum = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) sum += deriveOutcomeUnit(seed, 1, i, 'salt');
    const mean = sum / n;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });

  it('domain separation: the spin digest differs from a bare seed hash', () => {
    const bare = createHash('sha256').update(seed).digest();
    expect(spinDigest(seed, 0, 0, '').equals(bare)).toBe(false);
  });
});

describe('packUnit', () => {
  const seed = Buffer.alloc(32, 5);

  it('is deterministic, in [0, 1), and independent per index / txSig / account', () => {
    const base = packUnit(seed, 1, 'burnSig', 0);
    expect(packUnit(seed, 1, 'burnSig', 0)).toBe(base);
    expect(base).toBeGreaterThanOrEqual(0);
    expect(base).toBeLessThan(1);
    expect(packUnit(seed, 1, 'burnSig', 1)).not.toBe(base);
    expect(packUnit(seed, 1, 'otherSig', 0)).not.toBe(base);
    expect(packUnit(seed, 2, 'burnSig', 0)).not.toBe(base);
  });

  it('is domain-separated from a spin unit on the same inputs', () => {
    // pack uses txSig as the bound entropy and "pack" tag; spin uses "spin".
    expect(packUnit(seed, 1, 'shared', 0)).not.toBe(deriveOutcomeUnit(seed, 1, 0, 'shared'));
  });
});
