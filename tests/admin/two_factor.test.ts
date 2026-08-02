import { describe, expect, it } from 'vitest';
import { classifyAdminAuthCode } from '../../src/admin/two_factor';

// Pure classification for the admin login second-factor field. Runs in the default
// Node environment (no jsdom needed).
describe('classifyAdminAuthCode', () => {
  it('classifies a bare 6-digit code as a live TOTP code', () => {
    expect(classifyAdminAuthCode('123456')).toEqual({ code: '123456', recoveryCode: '' });
  });

  it('strips internal whitespace from a grouped 6-digit code', () => {
    expect(classifyAdminAuthCode('123 456')).toEqual({ code: '123456', recoveryCode: '' });
  });

  it('trims surrounding whitespace before classifying', () => {
    expect(classifyAdminAuthCode('  123456  ')).toEqual({ code: '123456', recoveryCode: '' });
  });

  it('routes anything that is not exactly 6 digits as a recovery code', () => {
    expect(classifyAdminAuthCode('ABCD-EFGH')).toEqual({ code: '', recoveryCode: 'ABCD-EFGH' });
    expect(classifyAdminAuthCode('12345')).toEqual({ code: '', recoveryCode: '12345' });
    expect(classifyAdminAuthCode('1234567')).toEqual({ code: '', recoveryCode: '1234567' });
  });

  it('routes an empty input as an empty recovery code', () => {
    expect(classifyAdminAuthCode('')).toEqual({ code: '', recoveryCode: '' });
    expect(classifyAdminAuthCode('   ')).toEqual({ code: '', recoveryCode: '' });
  });
});
