import { describe, expect, it } from 'vitest';
import {
  apiOriginKey,
  evaluateUpdateOffer,
  isProductionApiOrigin,
  PRODUCTION_API_ORIGIN,
  updateChannelForOrigin,
} from '../electron/update_guard.cjs';

// The prod/dev update-track split (desktop auto-update). One origin rule is
// shared by the build (scripts/electron-builder-config.mjs decides which feed
// files a build emits) and the runtime (electron/desktop_config.cjs decides
// which feed a build reads; electron/updater.cjs refuses cross-origin
// artifacts), so these pins protect both sides at once.

describe('PRODUCTION_API_ORIGIN', () => {
  it('is the production site', () => {
    expect(PRODUCTION_API_ORIGIN).toBe('https://worldofclaudecraft.com');
  });
});

describe('apiOriginKey', () => {
  it('normalizes equivalent spellings to one origin', () => {
    expect(apiOriginKey('https://worldofclaudecraft.com')).toBe('https://worldofclaudecraft.com');
    expect(apiOriginKey('https://worldofclaudecraft.com/')).toBe('https://worldofclaudecraft.com');
    expect(apiOriginKey('HTTPS://WorldOfClaudeCraft.COM')).toBe('https://worldofclaudecraft.com');
    expect(apiOriginKey('http://localhost:8787')).toBe('http://localhost:8787');
  });

  it('returns null for garbage, empty, non-string, and non-http values', () => {
    expect(apiOriginKey('')).toBeNull();
    expect(apiOriginKey('worldofclaudecraft.com')).toBeNull();
    expect(apiOriginKey('not a url')).toBeNull();
    expect(apiOriginKey(42)).toBeNull();
    expect(apiOriginKey(undefined)).toBeNull();
    expect(apiOriginKey('ftp://worldofclaudecraft.com')).toBeNull();
  });
});

describe('isProductionApiOrigin', () => {
  it('accepts only the production origin (slash and case tolerant)', () => {
    expect(isProductionApiOrigin('https://worldofclaudecraft.com')).toBe(true);
    expect(isProductionApiOrigin('https://worldofclaudecraft.com/')).toBe(true);
  });

  it('rejects dev, staging, localhost, http, subdomains, and garbage', () => {
    expect(isProductionApiOrigin('https://dev.worldofclaudecraft.com')).toBe(false);
    expect(isProductionApiOrigin('http://worldofclaudecraft.com')).toBe(false);
    expect(isProductionApiOrigin('http://localhost:8787')).toBe(false);
    expect(isProductionApiOrigin('https://worldofclaudecraft.com.evil.example')).toBe(false);
    expect(isProductionApiOrigin('')).toBe(false);
    expect(isProductionApiOrigin(undefined)).toBe(false);
  });
});

describe('updateChannelForOrigin (the track split)', () => {
  it('production origin publishes and reads the latest channel', () => {
    expect(updateChannelForOrigin('https://worldofclaudecraft.com')).toBe('latest');
    expect(updateChannelForOrigin('https://worldofclaudecraft.com/')).toBe('latest');
  });

  it('every non-production origin fails safe onto the dev channel', () => {
    expect(updateChannelForOrigin('https://dev.worldofclaudecraft.com')).toBe('dev');
    expect(updateChannelForOrigin('http://localhost:8787')).toBe('dev');
    expect(updateChannelForOrigin('')).toBe('dev');
    expect(updateChannelForOrigin('garbage')).toBe('dev');
    expect(updateChannelForOrigin(undefined)).toBe('dev');
  });
});

describe('evaluateUpdateOffer (the runtime cross-track refusal)', () => {
  const own = 'https://worldofclaudecraft.com';

  it('accepts an offer stamped with the same origin, slash tolerant', () => {
    expect(
      evaluateUpdateOffer({ apiOrigin: own, info: { version: '0.23.0', wocApiOrigin: own } }),
    ).toEqual({ ok: true, stamped: true });
    expect(
      evaluateUpdateOffer({
        apiOrigin: own,
        info: { wocApiOrigin: 'https://worldofclaudecraft.com/' },
      }),
    ).toEqual({ ok: true, stamped: true });
  });

  it('accepts a pre-split feed file with no stamp (back compat), flagged unstamped', () => {
    expect(evaluateUpdateOffer({ apiOrigin: own, info: { version: '0.23.0' } })).toEqual({
      ok: true,
      stamped: false,
    });
    expect(evaluateUpdateOffer({ apiOrigin: own, info: { wocApiOrigin: '' } })).toEqual({
      ok: true,
      stamped: false,
    });
    // A valueless `wocApiOrigin:` yml line parses to null; same back-compat arm.
    expect(evaluateUpdateOffer({ apiOrigin: own, info: { wocApiOrigin: null } })).toEqual({
      ok: true,
      stamped: false,
    });
    expect(evaluateUpdateOffer({ apiOrigin: own })).toEqual({ ok: true, stamped: false });
  });

  it('refuses an offer baked for another backend (the issue 1537 flip)', () => {
    const verdict = evaluateUpdateOffer({
      apiOrigin: own,
      info: { version: '0.23.0', wocApiOrigin: 'https://dev.worldofclaudecraft.com' },
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.offeredOrigin).toBe('https://dev.worldofclaudecraft.com');
    expect(verdict.expectedOrigin).toBe(own);
  });

  it('refuses a localhost smoke-test artifact offered to a production install', () => {
    expect(
      evaluateUpdateOffer({ apiOrigin: own, info: { wocApiOrigin: 'http://localhost:8787' } }).ok,
    ).toBe(false);
  });

  it('refuses rather than guesses when either side is unverifiable', () => {
    // Present-but-garbage stamp: suspicious artifact, never install it.
    expect(evaluateUpdateOffer({ apiOrigin: own, info: { wocApiOrigin: 'garbage' } }).ok).toBe(
      false,
    );
    const numeric = evaluateUpdateOffer({ apiOrigin: own, info: { wocApiOrigin: 42 } });
    expect(numeric.ok).toBe(false);
    expect(numeric.offeredOrigin).toBe('42');
    // Own origin unverifiable: cannot prove the offer matches, so refuse.
    expect(evaluateUpdateOffer({ apiOrigin: 'garbage', info: { wocApiOrigin: own } }).ok).toBe(
      false,
    );
  });

  it('a dev install accepts its own dev-track artifact', () => {
    expect(
      evaluateUpdateOffer({
        apiOrigin: 'https://dev.worldofclaudecraft.com',
        info: { wocApiOrigin: 'https://dev.worldofclaudecraft.com' },
      }),
    ).toEqual({ ok: true, stamped: true });
  });
});
