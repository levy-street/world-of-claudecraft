// The Marketplace terms link resolver (src/ui/terms_link.ts): the consent
// checkbox on both money surfaces links the document it names, and the href
// has to REACH it on every shell. Same-origin on the site, canonical
// everywhere the origin is not the site (the packaged desktop shell's app://,
// the Capacitor shells' capacitor://localhost and http://localhost).
import { describe, expect, it } from 'vitest';
import {
  CANONICAL_PRIVACY_URL,
  CANONICAL_TERMS_URL,
  CANONICAL_WHITEPAPER_URL,
} from '../src/client_origin';
import {
  PRIVACY_PATH,
  privacyUrlFor,
  resolvePrivacyUrl,
  resolveTermsUrl,
  resolveWhitepaperUrl,
  TERMS_PATH,
  termsUrlFor,
  WHITEPAPER_PATH,
  whitepaperUrlFor,
} from '../src/ui/terms_link';

describe('resolveTermsUrl', () => {
  it('links the same-origin page when the site serves the client', () => {
    expect(resolveTermsUrl({ nativeApp: false, origin: 'https://worldofclaudecraft.com' })).toBe(
      TERMS_PATH,
    );
    // A dev deploy or the Vite dev server (STATIC_PAGE_ALIASES serves it).
    expect(resolveTermsUrl({ nativeApp: false, origin: 'http://localhost:5173' })).toBe(TERMS_PATH);
  });

  it('takes the canonical URL on every origin that is not the site', () => {
    // The packaged desktop shell: app:// is denied by the window-open handler.
    expect(resolveTermsUrl({ nativeApp: false, origin: 'app://worldofclaudecraft' })).toBe(
      CANONICAL_TERMS_URL,
    );
    // Capacitor iOS: UIApplication.open of a capacitor:// URL is a no-op.
    expect(resolveTermsUrl({ nativeApp: true, origin: 'capacitor://localhost' })).toBe(
      CANONICAL_TERMS_URL,
    );
    // Capacitor Android: http://localhost IS an http origin, but it is the
    // in-app host, so a same-origin anchor would navigate the game WebView.
    // The native flag has to win over the http test.
    expect(resolveTermsUrl({ nativeApp: true, origin: 'http://localhost' })).toBe(
      CANONICAL_TERMS_URL,
    );
    expect(resolveTermsUrl({ nativeApp: false, origin: '' })).toBe(CANONICAL_TERMS_URL);
  });

  it('the canonical URL is the public terms page, and the path is what the site aliases', () => {
    expect(CANONICAL_TERMS_URL).toBe('https://worldofclaudecraft.com/terms');
    expect(TERMS_PATH).toBe('/terms');
    // The test build is the web client (NATIVE_APP false), so an http origin
    // resolves same-origin through the painter-facing helper too.
    expect(termsUrlFor('http://localhost:3000')).toBe(TERMS_PATH);
    expect(termsUrlFor('app://worldofclaudecraft')).toBe(CANONICAL_TERMS_URL);
  });
});

describe('resolvePrivacyUrl', () => {
  it('links the same-origin page when the site serves the client', () => {
    expect(resolvePrivacyUrl({ nativeApp: false, origin: 'https://worldofclaudecraft.com' })).toBe(
      PRIVACY_PATH,
    );
    expect(resolvePrivacyUrl({ nativeApp: false, origin: 'http://localhost:5173' })).toBe(
      PRIVACY_PATH,
    );
  });

  it('takes the canonical URL on non-site origins', () => {
    expect(resolvePrivacyUrl({ nativeApp: false, origin: 'app://worldofclaudecraft' })).toBe(
      CANONICAL_PRIVACY_URL,
    );
    expect(resolvePrivacyUrl({ nativeApp: true, origin: 'capacitor://localhost' })).toBe(
      CANONICAL_PRIVACY_URL,
    );
    expect(resolvePrivacyUrl({ nativeApp: true, origin: 'http://localhost' })).toBe(
      CANONICAL_PRIVACY_URL,
    );
    expect(resolvePrivacyUrl({ nativeApp: false, origin: '' })).toBe(CANONICAL_PRIVACY_URL);
  });

  it('canonical privacy URL matches the public policy route', () => {
    expect(CANONICAL_PRIVACY_URL).toBe('https://worldofclaudecraft.com/privacy');
    expect(PRIVACY_PATH).toBe('/privacy');
    expect(privacyUrlFor('http://localhost:3000')).toBe(PRIVACY_PATH);
    expect(privacyUrlFor('app://worldofclaudecraft')).toBe(CANONICAL_PRIVACY_URL);
  });
});

describe('resolveWhitepaperUrl', () => {
  it('links the same-origin pdf when the site serves the client', () => {
    expect(
      resolveWhitepaperUrl({ nativeApp: false, origin: 'https://worldofclaudecraft.com' }),
    ).toBe(WHITEPAPER_PATH);
    expect(resolveWhitepaperUrl({ nativeApp: false, origin: 'http://localhost:5173' })).toBe(
      WHITEPAPER_PATH,
    );
  });

  it('takes the canonical URL on non-site origins', () => {
    expect(resolveWhitepaperUrl({ nativeApp: false, origin: 'app://worldofclaudecraft' })).toBe(
      CANONICAL_WHITEPAPER_URL,
    );
    expect(resolveWhitepaperUrl({ nativeApp: true, origin: 'capacitor://localhost' })).toBe(
      CANONICAL_WHITEPAPER_URL,
    );
    expect(resolveWhitepaperUrl({ nativeApp: true, origin: 'http://localhost' })).toBe(
      CANONICAL_WHITEPAPER_URL,
    );
    expect(resolveWhitepaperUrl({ nativeApp: false, origin: '' })).toBe(CANONICAL_WHITEPAPER_URL);
  });

  it('canonical whitepaper URL matches the public hosted pdf asset', () => {
    expect(CANONICAL_WHITEPAPER_URL).toBe(
      'https://worldofclaudecraft.com/World-of-ClaudeCraft-Whitepaper-v1.0.pdf',
    );
    expect(WHITEPAPER_PATH).toBe('/World-of-ClaudeCraft-Whitepaper-v1.0.pdf');
    expect(whitepaperUrlFor('http://localhost:3000')).toBe(WHITEPAPER_PATH);
    expect(whitepaperUrlFor('app://worldofclaudecraft')).toBe(CANONICAL_WHITEPAPER_URL);
  });
});
