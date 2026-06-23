// Pure test for the referral share-link builder (#475). The panel's DOM + the
// copy flow are exercised in the browser; this pins the URL shape players hand
// out (a character name, or the affiliate code as a fallback).

import { describe, expect, it } from 'vitest';
import { referralLink } from '../src/ui/realm_affiliate';

describe('referralLink', () => {
  it('builds the /?ref= share link from the page origin and handle', () => {
    expect(referralLink('https://woc.example', 'Thrall')).toBe('https://woc.example/?ref=Thrall');
  });

  it('URL-encodes a character name with a space', () => {
    expect(referralLink('https://x', 'Sir Test')).toBe('https://x/?ref=Sir%20Test');
  });

  it('handles an apostrophe in the name', () => {
    expect(referralLink('https://x', "O'Brien")).toBe("https://x/?ref=O'Brien");
  });

  it('falls back to an affiliate code handle untouched', () => {
    expect(referralLink('https://x', 'aZ09-_xY')).toBe('https://x/?ref=aZ09-_xY');
  });
});
