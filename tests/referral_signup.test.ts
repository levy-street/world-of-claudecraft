import { describe, expect, it } from 'vitest';
import {
  captureReferralSlug,
  REFERRAL_SIGNUP_KEY,
  REFERRAL_SIGNUP_TTL_MS,
} from '../src/referral_signup';

const storage = () => {
  const rows = new Map<string, string>();
  return {
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => {
      rows.set(key, value);
    },
    removeItem: (key: string) => {
      rows.delete(key);
    },
  };
};
describe('referral OAuth handoff', () => {
  it('keeps a bounded normalized invite through a redirect without extending its lifetime', () => {
    const tab = storage();
    expect(captureReferralSlug('?ref=AbC-123', () => tab, 100)).toBe('abc-123');
    expect(captureReferralSlug('?code=oauth', () => tab, 200)).toBe('abc-123');
    expect(captureReferralSlug('', () => tab, 100 + REFERRAL_SIGNUP_TTL_MS)).toBe('');
    expect(tab.getItem(REFERRAL_SIGNUP_KEY)).toBeNull();
  });
  it('rejects malformed, future and overlength values, and replaces an earlier link explicitly', () => {
    const tab = storage();
    captureReferralSlug('?ref=first', () => tab, 100);
    expect(captureReferralSlug('?ref=second', () => tab, 101)).toBe('second');
    expect(captureReferralSlug('', () => tab, 100)).toBe('');
    expect(captureReferralSlug(`?ref=${'a'.repeat(65)}`, () => tab, 101)).toBe('');
    tab.setItem(REFERRAL_SIGNUP_KEY, '{broken');
    expect(captureReferralSlug('', () => tab, 102)).toBe('');
  });
  it('supports direct signup even when browser storage is unavailable', () => {
    const denied = () => {
      throw new Error('storage denied');
    };
    expect(captureReferralSlug('?ref=friend', denied)).toBe('friend');
    expect(captureReferralSlug('', denied)).toBe('');
  });
});
