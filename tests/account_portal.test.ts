import { describe, it, expect } from 'vitest';
import {
  accountPortalModel,
  validateNewPassword,
  validatePasswordChange,
  validateEmailShape,
  deactivateConfirmReady,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  type AccountPortalState,
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
    expect(m.sections).toEqual(['settings', 'wallet', 'characters', 'logout']);
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

describe('deactivateConfirmReady', () => {
  it('requires exact username and a non-empty password', () => {
    expect(deactivateConfirmReady('Aelwyn', 'Aelwyn', 'pw')).toBe(true);
    expect(deactivateConfirmReady('Aelwyn', 'aelwyn', 'pw')).toBe(false);
    expect(deactivateConfirmReady('Aelwyn', 'Aelwyn', '')).toBe(false);
    expect(deactivateConfirmReady('Aelwyn', '', 'pw')).toBe(false);
  });
});
