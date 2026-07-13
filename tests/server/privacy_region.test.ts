import type * as http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  marketingAllowedForRequest,
  privacyChoicesForRequest,
  privacyRegimeForCountry,
  privacyRegionForRequest,
  routes,
} from '../../server/privacy_region';
import {
  createPrivacyConsentRecord,
  serializePrivacyConsentCookie,
} from '../../src/privacy_consent_core';
import { FakeRes, fakeCtx, makeReq } from './helpers';

const originalTrustedProxyIps = process.env.TRUSTED_PROXY_IPS;
const originalTrustedEdgeIps = process.env.PRIVACY_TRUSTED_EDGE_IPS;
const originalCountryHeader = process.env.PRIVACY_COUNTRY_HEADER;

function request(headers: Record<string, string> = {}): http.IncomingMessage {
  return makeReq({ headers });
}

afterEach(() => {
  if (originalTrustedProxyIps === undefined) delete process.env.TRUSTED_PROXY_IPS;
  else process.env.TRUSTED_PROXY_IPS = originalTrustedProxyIps;
  if (originalTrustedEdgeIps === undefined) delete process.env.PRIVACY_TRUSTED_EDGE_IPS;
  else process.env.PRIVACY_TRUSTED_EDGE_IPS = originalTrustedEdgeIps;
  if (originalCountryHeader === undefined) delete process.env.PRIVACY_COUNTRY_HEADER;
  else process.env.PRIVACY_COUNTRY_HEADER = originalCountryHeader;
});

describe('privacy region policy', () => {
  it('maps strict, opt-out, and notice countries', () => {
    expect(privacyRegimeForCountry('DE')).toBe('opt-in');
    expect(privacyRegimeForCountry('GB')).toBe('opt-in');
    expect(privacyRegimeForCountry('US')).toBe('opt-out');
    expect(privacyRegimeForCountry('NZ')).toBe('notice');
  });

  it('ignores a country header from an untrusted peer and falls back to opt-in', () => {
    delete process.env.TRUSTED_PROXY_IPS;
    delete process.env.PRIVACY_TRUSTED_EDGE_IPS;

    expect(privacyRegionForRequest(request({ 'cf-ipcountry': 'US' }))).toEqual({
      regime: 'opt-in',
      source: 'fallback',
      gpc: false,
    });
  });

  it('uses only a configured country header from a configured trusted edge', () => {
    process.env.PRIVACY_TRUSTED_EDGE_IPS = '127.0.0.1';
    process.env.PRIVACY_COUNTRY_HEADER = 'x-deploy-country';

    expect(privacyRegionForRequest(request({ 'x-deploy-country': 'US' }))).toEqual({
      regime: 'opt-out',
      source: 'edge',
      gpc: false,
    });
    expect(privacyRegionForRequest(request({ 'cf-ipcountry': 'US' }))).toEqual({
      regime: 'opt-in',
      source: 'fallback',
      gpc: false,
    });
  });

  it('honours GPC over region defaults and an explicit stored choice', () => {
    process.env.PRIVACY_TRUSTED_EDGE_IPS = '127.0.0.1';
    const now = 1_800_000_000_000;
    const consent = serializePrivacyConsentCookie(
      createPrivacyConsentRecord({ analytics: true, marketing: true, x: true, twitch: true }, now),
    );
    const req = request({
      'cf-ipcountry': 'US',
      'sec-gpc': '1',
      cookie: consent,
    });

    expect(privacyChoicesForRequest(req, now)).toEqual({
      analytics: false,
      marketing: false,
      x: true,
      twitch: true,
    });
    expect(marketingAllowedForRequest(req, now)).toBe(false);
  });

  it('permits server-side marketing only after opt-in in a strict region', () => {
    process.env.PRIVACY_TRUSTED_EDGE_IPS = '127.0.0.1';
    const now = 1_800_000_000_000;
    const denied = request({ 'cf-ipcountry': 'FR' });
    const allowed = request({
      'cf-ipcountry': 'FR',
      cookie: serializePrivacyConsentCookie(
        createPrivacyConsentRecord(
          { analytics: false, marketing: true, x: false, twitch: false },
          now,
        ),
      ),
    });

    expect(marketingAllowedForRequest(denied, now)).toBe(false);
    expect(marketingAllowedForRequest(allowed, now)).toBe(true);
  });
});

describe('GET /api/privacy/region', () => {
  it('returns only the coarse regime, source, and GPC decision', async () => {
    process.env.PRIVACY_TRUSTED_EDGE_IPS = '127.0.0.1';
    const route = routes.find((candidate) => candidate.path === '/api/privacy/region');
    if (!route) throw new Error('privacy region route missing');
    const req = request({ 'cf-ipcountry': 'US', 'sec-gpc': '1' });
    const res = new FakeRes();
    const ctx = fakeCtx({ req, res: res as unknown as http.ServerResponse });

    await route.handler(ctx);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ regime: 'opt-out', source: 'edge', gpc: true });
    expect(Object.keys(JSON.parse(res.body)).sort()).toEqual(['gpc', 'regime', 'source']);
    expect(res.headers['cache-control']).toBe('private, no-store');
  });
});
