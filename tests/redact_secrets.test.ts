import { describe, expect, it } from 'vitest';
import { redactSecrets } from '../scripts/redact_secrets.mjs';

// Guards the output scrubber ai_review.mjs runs over the agent's final message before
// it is posted as a PUBLIC PR comment. The agent's prompt embeds an attacker-controlled
// fork-PR diff, so credential-shaped output (or the run's actual secrets, passed in as
// extraLiterals) must never survive into the comment. The scrubber is deliberately
// conservative: git shas and ordinary prose must pass through untouched.

const REDACTED = '[redacted]';

// 36 base62 chars, the documented length of a classic prefixed GitHub token body.
const GH_TOKEN_BODY = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';

describe('redactSecrets: credential-shaped substrings', () => {
  it('redacts every classic prefixed GitHub token flavor (ghp_ gho_ ghu_ ghs_ ghr_)', () => {
    for (const prefix of ['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_']) {
      const leaked = `${prefix}${GH_TOKEN_BODY}`;
      const { text, redactedCount } = redactSecrets(`credentials: ${leaked} end`);
      expect(text, prefix).toBe(`credentials: ${REDACTED} end`);
      expect(redactedCount, prefix).toBe(1);
    }
  });

  it('redacts fine-grained github_pat_ tokens', () => {
    const leaked = `github_pat_${'1'.repeat(22)}_${'a'.repeat(59)}`;
    const { text, redactedCount } = redactSecrets(`before ${leaked} after`);
    expect(text).toBe(`before ${REDACTED} after`);
    expect(redactedCount).toBe(1);
  });

  it('redacts OpenAI-style sk- keys, including sk-proj- project keys', () => {
    for (const leaked of [
      'sk-AbCdEfGhIjKlMnOpQrStUvWxYz123456',
      'sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz1234567890abcd',
    ]) {
      const { text, redactedCount } = redactSecrets(`key ${leaked} here`);
      expect(text, leaked).toBe(`key ${REDACTED} here`);
      expect(redactedCount, leaked).toBe(1);
    }
  });

  it('redacts signed JWTs (eyJ header plus two dot-separated base64url segments)', () => {
    const leaked =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
      '.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ' +
      '.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const { text, redactedCount } = redactSecrets(`bearer ${leaked}.`);
    expect(text).toBe(`bearer ${REDACTED}.`);
    expect(redactedCount).toBe(1);
  });

  it('redacts AWS AKIA access key ids', () => {
    const { text, redactedCount } = redactSecrets('aws key AKIAIOSFODNN7EXAMPLE found');
    expect(text).toBe(`aws key ${REDACTED} found`);
    expect(redactedCount).toBe(1);
  });

  it('counts every occurrence, not just the first', () => {
    const leaked = `ghp_${GH_TOKEN_BODY}`;
    const { text, redactedCount } = redactSecrets(`${leaked} and again ${leaked}`);
    expect(text).toBe(`${REDACTED} and again ${REDACTED}`);
    expect(redactedCount).toBe(2);
  });
});

describe('redactSecrets: conservative, legitimate review content survives', () => {
  it('leaves ordinary prose untouched with a zero count', () => {
    const prose = 'The dealDamage helper in src/sim/combat.ts looks correct; nice test coverage.';
    const { text, redactedCount } = redactSecrets(prose);
    expect(text).toBe(prose);
    expect(redactedCount).toBe(0);
  });

  it('leaves full and abbreviated git shas alone (no generic long-hex rule)', () => {
    const prose =
      'Introduced in e3b0c44298fc1c149afbf4c8996fb92427ae41e4 and reverted by 1e1883d6.';
    const { text, redactedCount } = redactSecrets(prose);
    expect(text).toBe(prose);
    expect(redactedCount).toBe(0);
  });

  it('does not treat sk- inside a hyphenated word as a key', () => {
    const prose = 'the task-scheduler-with-a-very-long-name module runs at 20 Hz';
    const { text, redactedCount } = redactSecrets(prose);
    expect(text).toBe(prose);
    expect(redactedCount).toBe(0);
  });

  it('handles empty input', () => {
    expect(redactSecrets('')).toEqual({ text: '', redactedCount: 0 });
  });
});

describe('redactSecrets: extraLiterals', () => {
  it('redacts an exact literal regardless of shape, counting each occurrence', () => {
    const literal = 'plainpassphrase';
    const { text, redactedCount } = redactSecrets(`leaked ${literal} twice: ${literal}`, [literal]);
    expect(text).toBe(`leaked ${REDACTED} twice: ${REDACTED}`);
    expect(redactedCount).toBe(2);
  });

  it('redacts a JSON-blob literal such as a CODEX_AUTH_JSON value', () => {
    const literal = '{"access":"opaque-value-1234","kind":"oauth"}';
    const { text, redactedCount } = redactSecrets(`dump: ${literal}`, [literal]);
    expect(text).toBe(`dump: ${REDACTED}`);
    expect(redactedCount).toBe(1);
  });

  it('ignores literals shorter than 8 characters', () => {
    const prose = 'the word admin appears here';
    const { text, redactedCount } = redactSecrets(prose, ['admin']);
    expect(text).toBe(prose);
    expect(redactedCount).toBe(0);
  });

  it('accepts an empty extras array and an omitted argument', () => {
    const prose = 'nothing secret here';
    expect(redactSecrets(prose, [])).toEqual({ text: prose, redactedCount: 0 });
    expect(redactSecrets(prose)).toEqual({ text: prose, redactedCount: 0 });
  });

  it('skips null and undefined entries defensively', () => {
    const prose = 'still nothing secret here';
    const { text, redactedCount } = redactSecrets(prose, [undefined, null]);
    expect(text).toBe(prose);
    expect(redactedCount).toBe(0);
  });
});
