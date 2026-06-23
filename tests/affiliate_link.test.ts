// Pure test for the affiliate share-link builder (#475). The panel's DOM + the
// copy flow are exercised in the browser; this pins the URL shape salespeople
// hand out, which a screenshot cannot prove.

import { describe, expect, it } from 'vitest';
import { affiliateLink } from '../src/ui/realm_affiliate';

describe('affiliateLink', () => {
  it('builds the /?aff= share link from the page origin and code', () => {
    expect(affiliateLink('https://woc.example', 'AbC123_-')).toBe('https://woc.example/?aff=AbC123_-');
  });

  it('leaves a base64url code (A-Za-z0-9-_) untouched', () => {
    const code = 'aZ09-_xY';
    expect(affiliateLink('https://x', code)).toBe(`https://x/?aff=${code}`);
  });

  it('URL-encodes a stray non-url-safe character defensively', () => {
    expect(affiliateLink('https://x', 'a b')).toBe('https://x/?aff=a%20b');
  });
});
