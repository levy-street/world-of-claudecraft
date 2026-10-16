// server/resume_token.ts: the same-client reconnect proof (mint, intake
// screening, constant-time match). The planJoin arm it feeds is pinned in
// tests/linkdead.test.ts.
import { describe, expect, it } from 'vitest';
import { mintResumeToken, presentedResumeToken, resumeTokenMatches } from '../server/resume_token';

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

describe('mintResumeToken', () => {
  it('mints 32 random bytes as 43 base64url characters', () => {
    const token = mintResumeToken();
    expect(token).toMatch(TOKEN_SHAPE);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });

  it('never repeats across mints', () => {
    const seen = new Set(Array.from({ length: 200 }, () => mintResumeToken()));
    expect(seen.size).toBe(200);
  });
});

describe('presentedResumeToken', () => {
  it('accepts a well-formed token verbatim', () => {
    const token = mintResumeToken();
    expect(presentedResumeToken(token)).toBe(token);
  });

  it('reads anything else as no token presented', () => {
    const token = mintResumeToken();
    for (const raw of [
      undefined,
      null,
      42,
      true,
      {},
      [token],
      '',
      token.slice(1),
      `${token}A`,
      `${token.slice(1)}=`,
      `${token.slice(1)}+`,
      ` ${token.slice(1)}`,
    ]) {
      expect(presentedResumeToken(raw)).toBeNull();
    }
  });
});

describe('resumeTokenMatches', () => {
  it('matches only the identical token', () => {
    const held = mintResumeToken();
    expect(resumeTokenMatches(held, held)).toBe(true);
    expect(resumeTokenMatches(held, `${held}`)).toBe(true);
    expect(resumeTokenMatches(held, mintResumeToken())).toBe(false);
    // One character off at either end.
    const flip = (c: string) => (c === 'A' ? 'B' : 'A');
    expect(resumeTokenMatches(held, `${flip(held[0])}${held.slice(1)}`)).toBe(false);
    expect(resumeTokenMatches(held, `${held.slice(0, -1)}${flip(held.at(-1) ?? '')}`)).toBe(false);
  });

  it('never matches an absent, empty, or wrong-length presentation', () => {
    const held = mintResumeToken();
    expect(resumeTokenMatches(held, null)).toBe(false);
    expect(resumeTokenMatches(held, undefined)).toBe(false);
    expect(resumeTokenMatches(held, '')).toBe(false);
    expect(resumeTokenMatches(held, held.slice(1))).toBe(false);
    expect(resumeTokenMatches(held, `${held}A`)).toBe(false);
  });

  it('refuses, never throws, on a same-character-count value of a different byte length', () => {
    const held = mintResumeToken();
    const wide = `${held.slice(0, -1)}é`; // 43 characters, 44 UTF-8 bytes
    expect(wide).toHaveLength(held.length);
    expect(() => resumeTokenMatches(held, wide)).not.toThrow();
    expect(resumeTokenMatches(held, wide)).toBe(false);
  });

  it('never matches when the session holds no token yet', () => {
    expect(resumeTokenMatches('', '')).toBe(false);
    expect(resumeTokenMatches('', mintResumeToken())).toBe(false);
  });
});
