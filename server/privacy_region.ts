import type * as http from 'node:http';
import {
  effectivePrivacyChoices,
  type PrivacyChoices,
  type PrivacyRegime,
  type PrivacyRegionResponse,
  parsePrivacyConsentCookie,
} from '../src/privacy_consent_core';
import type { Ctx, RouteDef } from './http/types';
import { json } from './http_util';
import { normalizeIp } from './ratelimit';

const DEFAULT_COUNTRY_HEADER = 'cf-ipcountry';
const UNKNOWN_COUNTRY_CODES = new Set(['A1', 'A2', 'O1', 'T1', 'XX', 'ZZ']);

const OPT_IN_COUNTRIES = new Set([
  // European Economic Area.
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DE',
  'DK',
  'EE',
  'ES',
  'FI',
  'FR',
  'GR',
  'HU',
  'IE',
  'IS',
  'IT',
  'LI',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'NO',
  'PL',
  'PT',
  'RO',
  'SE',
  'SI',
  'SK',
  // Additional jurisdictions where strict prior consent is the safe default.
  'BR',
  'CA',
  'CH',
  'GB',
]);

function firstHeader(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function configuredCountryHeader(): string {
  const configured = (process.env.PRIVACY_COUNTRY_HEADER ?? DEFAULT_COUNTRY_HEADER)
    .trim()
    .toLowerCase();
  return /^[a-z0-9-]+$/.test(configured) ? configured : DEFAULT_COUNTRY_HEADER;
}

function configuredTrustedEdgeIps(): Set<string> {
  const configured = process.env.PRIVACY_TRUSTED_EDGE_IPS ?? process.env.TRUSTED_PROXY_IPS ?? '';
  return new Set(
    configured
      .split(',')
      .map((value) => normalizeIp(value.trim()))
      .filter(Boolean),
  );
}

function requestCameFromTrustedEdge(req: http.IncomingMessage): boolean {
  const remote = normalizeIp(String(req.socket?.remoteAddress ?? '').trim());
  return remote.length > 0 && configuredTrustedEdgeIps().has(remote);
}

function edgeCountry(req: http.IncomingMessage): string | null {
  if (!requestCameFromTrustedEdge(req)) return null;
  const raw = firstHeader(req.headers?.[configuredCountryHeader()]).trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(raw) || UNKNOWN_COUNTRY_CODES.has(raw)) return null;
  return raw;
}

export function privacyRegimeForCountry(country: string): PrivacyRegime {
  const normalized = country.trim().toUpperCase();
  if (OPT_IN_COUNTRIES.has(normalized)) return 'opt-in';
  if (normalized === 'US') return 'opt-out';
  return 'notice';
}

export function globalPrivacyControlEnabled(req: http.IncomingMessage): boolean {
  return firstHeader(req.headers?.['sec-gpc']).trim() === '1';
}

export function privacyRegionForRequest(req: http.IncomingMessage): PrivacyRegionResponse {
  const country = edgeCountry(req);
  return {
    regime: country ? privacyRegimeForCountry(country) : 'opt-in',
    source: country ? 'edge' : 'fallback',
    gpc: globalPrivacyControlEnabled(req),
  };
}

export function privacyChoicesForRequest(
  req: http.IncomingMessage,
  now = Date.now(),
): PrivacyChoices {
  const region = privacyRegionForRequest(req);
  const record = parsePrivacyConsentCookie(req.headers?.cookie, now);
  return effectivePrivacyChoices(record, region, now);
}

export function marketingAllowedForRequest(req: http.IncomingMessage, now = Date.now()): boolean {
  return privacyChoicesForRequest(req, now).marketing;
}

export function privacyRegionResponse(req: http.IncomingMessage, res: http.ServerResponse): void {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Sec-GPC');
  json(res, 200, privacyRegionForRequest(req));
}

function regionHandler(ctx: Ctx): void {
  privacyRegionResponse(ctx.req, ctx.res);
}

export const routes: RouteDef[] = [
  {
    method: 'GET',
    path: '/api/privacy/region',
    surface: 'api',
    handler: regionHandler,
  },
];
