import { describe, expect, it } from 'vitest';
import { t } from '../src/ui/i18n';
import {
  classifyAuthCode,
  formatRecoveryCodesFile,
  formatSecretGroups,
  isCompleteTotpCode,
  normalizeAuthCodeInput,
} from '../src/ui/two_factor_setup';

describe('formatSecretGroups', () => {
  it('groups a base32 secret in fours, uppercased', () => {
    expect(formatSecretGroups('gezdgnbvgy3tqojq')).toBe('GEZD GNBV GY3T QOJQ');
  });
  it('handles a trailing partial group', () => {
    expect(formatSecretGroups('ABCDE')).toBe('ABCD E');
  });
});

describe('normalizeAuthCodeInput', () => {
  it('strips non-digits and caps a numeric code at 6', () => {
    expect(normalizeAuthCodeInput('123 456')).toBe('123456');
    expect(normalizeAuthCodeInput('1234567')).toBe('123456');
  });
  it('preserves a recovery code (contains a dash)', () => {
    expect(normalizeAuthCodeInput('  4f8a-3b1c ')).toBe('4f8a-3b1c');
  });
});

describe('isCompleteTotpCode', () => {
  it('is true only for exactly 6 digits', () => {
    expect(isCompleteTotpCode('123456')).toBe(true);
    expect(isCompleteTotpCode('12345')).toBe(false);
    expect(isCompleteTotpCode('1234567')).toBe(false);
    expect(isCompleteTotpCode('12 34 56')).toBe(true);
    expect(isCompleteTotpCode('abcdef')).toBe(false);
  });
});

describe('classifyAuthCode', () => {
  it('routes a 6-digit code to `code`', () => {
    expect(classifyAuthCode('123456')).toEqual({ code: '123456', recoveryCode: '' });
  });
  it('routes anything else to `recoveryCode`', () => {
    expect(classifyAuthCode('4f8a-3b1c')).toEqual({ code: '', recoveryCode: '4f8a-3b1c' });
    expect(classifyAuthCode('12345')).toEqual({ code: '', recoveryCode: '12345' });
  });
});

describe('formatRecoveryCodesFile', () => {
  it('lists numbered codes with a header naming the account', () => {
    const blob = formatRecoveryCodesFile(['aaaa-bbbb', 'cccc-dddd'], 'Aelwyn');
    expect(blob).toContain('Account: Aelwyn');
    expect(blob).toContain('01. aaaa-bbbb');
    expect(blob).toContain('02. cccc-dddd');
  });

  it('builds the header, account line, and hint/warn prose from t(), not raw literals', () => {
    const blob = formatRecoveryCodesFile(['aaaa-bbbb'], 'Aelwyn');
    const lines = blob.split('\n');
    // Pinned to the literal expected English (the default `en` locale in tests) so
    // swapping the Hint/Warn keys, or resolving the wrong key on the header line,
    // fails this test even though both strings would still be present in the blob.
    expect(lines[0]).toBe('World of ClaudeCraft recovery codes');
    expect(lines[1]).toBe('Account: Aelwyn');
    expect(lines[2]).toBe('');
    expect(lines[3]).toBe(
      'Each code can be used once if you lose access to your authenticator app.',
    );
    expect(lines[4]).toBe('Keep this file somewhere safe and private.');
    expect(lines[5]).toBe('');
    expect(lines[6]).toBe('01. aaaa-bbbb');
    // Independently confirm the lines are t()-resolved (not decoupled literals that
    // happen to match), so a future catalog wording change still updates this pin.
    expect(lines[0]).toBe(
      t('hudChrome.account.recoveryCodesFileHeader', { brand: 'World of ClaudeCraft' }),
    );
    expect(lines[3]).toBe(t('hudChrome.account.recoveryCodesFileHint'));
    expect(lines[4]).toBe(t('hudChrome.account.recoveryCodesFileWarn'));
  });
});
