import { describe, expect, it } from 'vitest';
import {
  type AccountPortalState,
  accountPortalModel,
  COMPANION_TOKEN_LABEL_MAX,
  companionTokenRows,
  deactivateConfirmReady,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  validateCompanionTokenLabel,
  validateEmailShape,
  validateNewPassword,
  validatePasswordChange,
} from '../src/ui/account_portal';

const base: AccountPortalState = {
  loggedIn: true,
  username: 'Aelwyn',
  email: '',
  createdAt: '2026-01-15T10:00:00.000Z',
  characterCount: 3,
};

describe('accountPortalModel', () => {
  it('exposes all sections in order when logged in', () => {
    const m = accountPortalModel(base);
    expect(m.loggedIn).toBe(true);
    expect(m.sections).toEqual(['settings', 'wallet', 'characters', 'companion', 'logout']);
    expect(m.header.username).toBe('Aelwyn');
  });

  it('shows no sections when logged out', () => {
    const m = accountPortalModel({ ...base, loggedIn: false });
    expect(m.sections).toEqual([]);
  });

  it('surfaces the account-wide character count', () => {
    expect(accountPortalModel(base).header.characterCount).toBe(3);
    expect(accountPortalModel({ ...base, characterCount: 0 }).header.characterCount).toBe(0);
  });

  it('normalizes createdAt and tolerates junk', () => {
    expect(accountPortalModel(base).header.memberSinceIso).toBe('2026-01-15T10:00:00.000Z');
    expect(accountPortalModel({ ...base, createdAt: 'not-a-date' }).header.memberSinceIso).toBe('');
    expect(accountPortalModel({ ...base, createdAt: '' }).header.memberSinceIso).toBe('');
  });
});

describe('validateNewPassword', () => {
  it('rejects an empty current password', () => {
    expect(validateNewPassword('', 'longenough')).toBe('empty-current');
  });
  it('rejects a too-short new password', () => {
    expect(validateNewPassword('oldpass', 'a'.repeat(MIN_PASSWORD_LENGTH - 1))).toBe('too-short');
  });
  it('rejects a too-long new password (matches the server upper bound)', () => {
    expect(validateNewPassword('oldpass', 'a'.repeat(MAX_PASSWORD_LENGTH + 1))).toBe('too-long');
    // Exactly at the bound is accepted.
    expect(validateNewPassword('oldpass', 'a'.repeat(MAX_PASSWORD_LENGTH))).toBeNull();
  });
  it('reports too-short before unchanged when both apply', () => {
    expect(validateNewPassword('ab', 'ab')).toBe('too-short');
  });
  it('rejects an unchanged password', () => {
    expect(validateNewPassword('samesame', 'samesame')).toBe('unchanged');
  });
  it('accepts a valid change', () => {
    expect(validateNewPassword('oldpass', 'brandnew')).toBeNull();
  });
});

describe('validatePasswordChange', () => {
  it('rejects a confirmation mismatch before submit', () => {
    expect(validatePasswordChange('oldpass', 'brandnew', 'brandnew2')).toBe('confirm-mismatch');
  });

  it('accepts a valid confirmed password change', () => {
    expect(validatePasswordChange('oldpass', 'brandnew', 'brandnew')).toBeNull();
  });
});

describe('validateEmailShape', () => {
  it('accepts empty (clears the address)', () => {
    expect(validateEmailShape('')).toBe(true);
    expect(validateEmailShape('   ')).toBe(true);
  });
  it('accepts a plausible address', () => {
    expect(validateEmailShape('player@example.com')).toBe(true);
  });
  it('rejects malformed addresses', () => {
    expect(validateEmailShape('nope')).toBe(false);
    expect(validateEmailShape('a@b')).toBe(false);
    expect(validateEmailShape('a b@c.com')).toBe(false);
  });
  it('rejects an over-long address', () => {
    expect(validateEmailShape(`${'a'.repeat(250)}@example.com`)).toBe(false);
  });
  it('enforces the 254-char boundary exactly', () => {
    const local = (n: number) => `${'a'.repeat(n)}@example.com`; // tail is 12 chars
    expect(validateEmailShape(local(254 - 12))).toBe(true); // length 254 → ok
    expect(validateEmailShape(local(255 - 12))).toBe(false); // length 255 → too long
  });
});

describe('companion tokens', () => {
  it('accepts an empty or in-bound label and rejects an over-long one', () => {
    expect(validateCompanionTokenLabel('')).toBe(true);
    expect(validateCompanionTokenLabel('My phone app')).toBe(true);
    expect(validateCompanionTokenLabel('a'.repeat(COMPANION_TOKEN_LABEL_MAX))).toBe(true);
    expect(validateCompanionTokenLabel('a'.repeat(COMPANION_TOKEN_LABEL_MAX + 1))).toBe(false);
  });

  it('builds a row view with a fallback label and normalized timestamps, never the full secret', () => {
    const rows = companionTokenRows([
      {
        prefix: 'deadbeef',
        label: 'Tracker',
        createdAt: '2026-06-01T00:00:00.000Z',
        expiresAt: '2026-09-01T00:00:00.000Z',
      },
      { prefix: 'cafe1234', label: null, createdAt: 'junk', expiresAt: '2026-09-01T00:00:00.000Z' },
    ]);
    expect(rows[0]).toEqual({
      prefix: 'deadbeef',
      label: 'Tracker',
      createdAtIso: '2026-06-01T00:00:00.000Z',
      expiresAtIso: '2026-09-01T00:00:00.000Z',
    });
    expect(rows[1].label).toBe('Unnamed token');
    expect(rows[1].createdAtIso).toBe(''); // junk normalizes to empty
    // No field carries a 64-hex secret.
    for (const r of rows)
      for (const v of Object.values(r)) expect(String(v)).not.toMatch(/[a-f0-9]{64}/);
  });
});

describe('deactivateConfirmReady', () => {
  it('requires exact username and a non-empty password', () => {
    expect(deactivateConfirmReady('Aelwyn', 'Aelwyn', 'pw')).toBe(true);
    expect(deactivateConfirmReady('Aelwyn', 'aelwyn', 'pw')).toBe(false);
    expect(deactivateConfirmReady('Aelwyn', 'Aelwyn', '')).toBe(false);
    expect(deactivateConfirmReady('Aelwyn', '', 'pw')).toBe(false);
  });
});
