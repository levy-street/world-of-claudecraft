// The signup context capture (server/signup_attribution.ts): the pure
// attribution/locale/country/opt-in parsers, and the fire-and-forget capture
// through the injected db seam (no Postgres, no mocks of the pg pool).

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
}));

import {
  captureSignupContext,
  geoCountryHeaderName,
  normalizeLocaleTag,
  parseClientAttribution,
  parseMarketingOptIn,
  parseSignupCountry,
  parseSignupLocale,
  parseSignupProfile,
  type SignupCaptureDb,
} from '../../server/signup_attribution';

function fakeDb() {
  const calls = {
    attribution: [] as unknown[],
    profile: [] as [
      number,
      { locale: string | null; country: string | null; marketingOptIn: boolean },
    ][],
  };
  const db: SignupCaptureDb = {
    insertAttribution: async (row) => {
      calls.attribution.push(row);
    },
    updateSignupProfile: async (id, profile) => {
      calls.profile.push([id, profile]);
    },
  };
  return { calls, db };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('parseClientAttribution', () => {
  it('keeps valid fields and drops garbage', () => {
    const parsed = parseClientAttribution({
      fbclid: 'IwAR123',
      utmSource: 'facebook',
      utmCampaign: 'august_l5',
      utmMedium: 42,
      landingUrl: 'https://worldofclaudecraft.com/?utm_source=facebook',
      referrer: 'javascript:alert(1)',
      visitorId: 'a1b2c3d4e5f6a7b8',
    });
    expect(parsed).toMatchObject({
      fbclid: 'IwAR123',
      utmSource: 'facebook',
      utmCampaign: 'august_l5',
      utmMedium: null,
      landingUrl: 'https://worldofclaudecraft.com/?utm_source=facebook',
      referrer: null,
      visitorId: 'a1b2c3d4e5f6a7b8',
    });
  });

  it('returns null for non-objects and signal-free payloads', () => {
    expect(parseClientAttribution(undefined)).toBeNull();
    expect(parseClientAttribution('utm_source=x')).toBeNull();
    expect(parseClientAttribution([])).toBeNull();
    expect(parseClientAttribution({ utmSource: 42, fbclid: '' })).toBeNull();
  });

  it('caps oversized values and strips control characters', () => {
    const parsed = parseClientAttribution({ fbclid: `ab\x00cd${'x'.repeat(600)}` });
    expect(parsed?.fbclid?.startsWith('abcd')).toBe(true);
    expect(parsed?.fbclid?.length).toBeLessThanOrEqual(512);
  });

  it('rejects malformed visitor ids', () => {
    expect(parseClientAttribution({ visitorId: 'short' })).toBeNull();
    expect(parseClientAttribution({ visitorId: 'has spaces here!' })).toBeNull();
  });
});

describe('locale parsing', () => {
  it('normalizes tags to language plus underscore region', () => {
    expect(normalizeLocaleTag('pt-BR')).toBe('pt_BR');
    expect(normalizeLocaleTag('EN_us')).toBe('en_US');
    expect(normalizeLocaleTag('fr')).toBe('fr');
    expect(normalizeLocaleTag('not a locale')).toBeNull();
    expect(normalizeLocaleTag(42)).toBeNull();
  });

  it('prefers the explicit client tag over Accept-Language', () => {
    expect(parseSignupLocale('es', 'fr-FR,fr;q=0.9')).toBe('es');
    expect(parseSignupLocale(undefined, 'fr-FR,fr;q=0.9')).toBe('fr_FR');
    expect(parseSignupLocale(undefined, undefined)).toBeNull();
  });
});

describe('country parsing', () => {
  it('reads the configured geo header and validates the shape', () => {
    expect(geoCountryHeaderName({} as NodeJS.ProcessEnv)).toBe('cf-ipcountry');
    expect(parseSignupCountry({ 'cf-ipcountry': 'nz' }, {} as NodeJS.ProcessEnv)).toBe('NZ');
    expect(parseSignupCountry({ 'cf-ipcountry': 'NZL' }, {} as NodeJS.ProcessEnv)).toBeNull();
    expect(parseSignupCountry({}, {} as NodeJS.ProcessEnv)).toBeNull();
  });

  it('honors a custom header name and the empty-string disable', () => {
    const env = { GEOIP_COUNTRY_HEADER: 'X-Geo-Country' } as NodeJS.ProcessEnv;
    expect(parseSignupCountry({ 'x-geo-country': 'DE' }, env)).toBe('DE');
    const off = { GEOIP_COUNTRY_HEADER: '' } as NodeJS.ProcessEnv;
    expect(parseSignupCountry({ 'cf-ipcountry': 'DE' }, off)).toBeNull();
  });
});

describe('parseMarketingOptIn', () => {
  it('accepts only boolean true', () => {
    expect(parseMarketingOptIn(true)).toBe(true);
    expect(parseMarketingOptIn('true')).toBe(false);
    expect(parseMarketingOptIn(1)).toBe(false);
    expect(parseMarketingOptIn(undefined)).toBe(false);
  });
});

describe('captureSignupContext', () => {
  const req = (headers: Record<string, string> = {}) => ({ headers });

  it('persists attribution merged with the fbp/fbc cookies', async () => {
    const { calls, db } = fakeDb();
    const body = {
      attribution: { fbclid: 'click1', utmSource: 'facebook', utmCampaign: 'aug' },
    };
    const r = req({ cookie: '_fbp=fb.1.111.222; _fbc=fb.1.111.click1' });
    captureSignupContext(9, r, body, parseSignupProfile(r, body), db);
    await flush();
    expect(calls.attribution).toHaveLength(1);
    expect(calls.attribution[0]).toMatchObject({
      accountId: 9,
      fbclid: 'click1',
      fbp: 'fb.1.111.222',
      fbc: 'fb.1.111.click1',
      utmSource: 'facebook',
      utmCampaign: 'aug',
    });
  });

  it('writes a cookie-only row when the body carries no attribution', async () => {
    const { calls, db } = fakeDb();
    const r = req({ cookie: '_fbp=fb.1.9.9' });
    captureSignupContext(3, r, {}, parseSignupProfile(r, {}), db);
    await flush();
    expect(calls.attribution).toHaveLength(1);
    expect(calls.attribution[0]).toMatchObject({ accountId: 3, fbp: 'fb.1.9.9', fbclid: null });
  });

  it('skips the row entirely with no signal, records the profile in ONE call', async () => {
    const { calls, db } = fakeDb();
    const r = req({ 'accept-language': 'de-DE,de;q=0.8', 'cf-ipcountry': 'DE' });
    const body = { marketingOptIn: true };
    captureSignupContext(4, r, body, parseSignupProfile(r, body), db);
    await flush();
    expect(calls.attribution).toHaveLength(0);
    expect(calls.profile).toEqual([[4, { locale: 'de_DE', country: 'DE', marketingOptIn: true }]]);
  });

  it('skips the profile update entirely when no profile field is present', async () => {
    const { calls, db } = fakeDb();
    const r = req({ cookie: '_fbp=fb.1.9.9' });
    captureSignupContext(6, r, {}, parseSignupProfile(r, {}), db);
    await flush();
    expect(calls.profile).toHaveLength(0);
  });

  it('caps and control-strips oversized cookie values before persisting', async () => {
    const { calls, db } = fakeDb();
    const r = req({ cookie: `_fbp=fb.\x01${'x'.repeat(2000)}; _fbc=fb.1.1.ok` });
    captureSignupContext(7, r, {}, parseSignupProfile(r, {}), db);
    await flush();
    expect(calls.attribution).toHaveLength(1);
    const row = calls.attribution[0] as { fbp: string; fbc: string };
    expect(row.fbp.length).toBeLessThanOrEqual(512);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting the strip is the point
    expect(row.fbp).not.toMatch(/[\x00-\x1f]/);
    expect(row.fbc).toBe('fb.1.1.ok');
  });

  it('never throws when every write rejects', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db: SignupCaptureDb = {
      insertAttribution: async () => {
        throw new Error('down');
      },
      updateSignupProfile: async () => {
        throw new Error('down');
      },
    };
    const r = req({
      cookie: '_fbp=fb.1.1.1',
      'accept-language': 'en',
      'cf-ipcountry': 'US',
    });
    const body = { marketingOptIn: true };
    expect(() => captureSignupContext(5, r, body, parseSignupProfile(r, body), db)).not.toThrow();
    await flush();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
