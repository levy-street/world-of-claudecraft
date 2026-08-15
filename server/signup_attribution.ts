// Signup context capture: the one shared side-effect module BOTH register
// arms (the RouteDef handler in auth_routes.ts and the legacy ladder arm in
// main.ts) call after an account is created, so the dual-edit surface stays a
// single line per arm and the two arms cannot drift.
//
// It persists, best-effort and fire-and-forget (registration must never block
// or fail on analytics):
// - the first-touch attribution row (client-captured fbclid/UTM/landing/
//   referrer/visitor id, merged with the server-read _fbp/_fbc cookies), so
//   paid and organic cohorts can finally be separated;
// - the signup locale (client-sent BCP 47 tag, else Accept-Language);
// - the signup country from a trusted edge geo header (GEOIP_COUNTRY_HEADER,
//   default cf-ipcountry; empty when the edge does not inject one);
// - the marketing email opt-in, only on an explicit boolean true.
//
// Everything above the exports section is pure and unit-tested without IO.

import type { IncomingMessage } from 'node:http';
import { insertAccountAttribution, updateAccountSignupProfile } from './attribution_db';
import { pool } from './db';
import { metaCookieData } from './meta_capi';

/** Length caps for client-supplied attribution values. URLs get the same
 *  2048 cap the CAPI source-url reader uses; identifiers stay short. */
const MAX_URL_LENGTH = 2048;
const MAX_TAG_LENGTH = 256;
const MAX_CLICK_ID_LENGTH = 512;
const VISITOR_ID_RE = /^[a-zA-Z0-9-]{8,64}$/;
const COUNTRY_RE = /^[A-Za-z]{2}$/;
const LOCALE_RE = /^[a-zA-Z]{2,3}(?:[-_][a-zA-Z0-9]{2,8})?$/;

/** The client-parsed attribution payload after validation. */
export interface ClientAttribution {
  fbclid: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  landingUrl: string | null;
  referrer: string | null;
  visitorId: string | null;
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  // Strip control characters, then cap. An empty result reads as absent.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping controls is the point
  const cleaned = value.replace(/[\x00-\x1f\x7f]/g, '').trim();
  if (cleaned.length === 0) return null;
  return cleaned.slice(0, maxLength);
}

function cleanUrl(value: unknown): string | null {
  const text = cleanText(value, MAX_URL_LENGTH);
  if (!text || !/^https?:\/\//i.test(text)) return null;
  return text;
}

/** Validate the register body's attribution object. Unknown shapes and every
 *  non-string field degrade to null; a payload with no surviving signal
 *  returns null so the caller writes no row. */
export function parseClientAttribution(value: unknown): ClientAttribution | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const parsed: ClientAttribution = {
    fbclid: cleanText(raw.fbclid, MAX_CLICK_ID_LENGTH),
    utmSource: cleanText(raw.utmSource, MAX_TAG_LENGTH),
    utmMedium: cleanText(raw.utmMedium, MAX_TAG_LENGTH),
    utmCampaign: cleanText(raw.utmCampaign, MAX_TAG_LENGTH),
    utmContent: cleanText(raw.utmContent, MAX_TAG_LENGTH),
    utmTerm: cleanText(raw.utmTerm, MAX_TAG_LENGTH),
    landingUrl: cleanUrl(raw.landingUrl),
    referrer: cleanUrl(raw.referrer),
    visitorId: null,
  };
  const visitor = cleanText(raw.visitorId, 64);
  if (visitor && VISITOR_ID_RE.test(visitor)) parsed.visitorId = visitor;
  const hasSignal = Object.values(parsed).some((v) => v !== null);
  return hasSignal ? parsed : null;
}

/** Normalize a locale tag to the storage shape: lowercase language, optional
 *  underscore uppercase region (en, pt_BR). Rejects garbage. */
export function normalizeLocaleTag(value: unknown): string | null {
  const text = cleanText(value, 16);
  if (!text || !LOCALE_RE.test(text)) return null;
  const [lang, region] = text.split(/[-_]/);
  const lower = lang.toLowerCase();
  return region ? `${lower}_${region.toUpperCase()}` : lower;
}

/** The signup locale: an explicit client-sent tag wins, else the first
 *  Accept-Language entry. The email templates collapse to the primary
 *  language subtag, so any well-formed tag is safe to store. */
export function parseSignupLocale(
  bodyLocale: unknown,
  acceptLanguage: string | string[] | undefined,
): string | null {
  const explicit = normalizeLocaleTag(bodyLocale);
  if (explicit) return explicit;
  const header = Array.isArray(acceptLanguage) ? acceptLanguage[0] : acceptLanguage;
  if (!header) return null;
  const first = header.split(',')[0]?.split(';')[0]?.trim();
  return normalizeLocaleTag(first);
}

/** The name of the edge header carrying the visitor's country code. Empty
 *  string disables the read (the fail-safe default when no trusted edge is
 *  configured is still cf-ipcountry: a header nobody injects reads absent). */
export function geoCountryHeaderName(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.GEOIP_COUNTRY_HEADER;
  if (raw === undefined) return 'cf-ipcountry';
  return raw.trim().toLowerCase();
}

/** Resolve the signup country from the configured edge geo header. Only a
 *  well-formed ISO 3166-1 alpha-2 code passes; Cloudflare's XX/T1 unknowns
 *  pass the shape check deliberately (they are real observations). */
export function parseSignupCountry(
  headers: IncomingMessage['headers'],
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const name = geoCountryHeaderName(env);
  if (!name) return null;
  const raw = headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !COUNTRY_RE.test(value.trim())) return null;
  return value.trim().toUpperCase();
}

/** Strict opt-in read: only boolean true opts in (never a truthy string). */
export function parseMarketingOptIn(value: unknown): boolean {
  return value === true;
}

/** The synchronous profile parse both register arms run BEFORE the welcome
 *  mail, so the mail itself can carry the right locale and opt-in state. */
export interface SignupProfile {
  locale: string | null;
  marketingOptIn: boolean;
}

export function parseSignupProfile(
  req: Pick<IncomingMessage, 'headers'>,
  body: Record<string, unknown>,
): SignupProfile {
  return {
    locale: parseSignupLocale(body.locale, req.headers['accept-language']),
    marketingOptIn: parseMarketingOptIn(body.marketingOptIn),
  };
}

// ---------------------------------------------------------------------------
// The fire-and-forget capture. Injected db seam so tests drive it without
// Postgres; production callers use the default bundle.
// ---------------------------------------------------------------------------

export interface SignupCaptureDb {
  insertAttribution: (row: Parameters<typeof insertAccountAttribution>[1]) => Promise<void>;
  updateSignupProfile: (
    accountId: number,
    profile: { locale: string | null; country: string | null; marketingOptIn: boolean },
  ) => Promise<void>;
}

const REAL_DB: SignupCaptureDb = {
  insertAttribution: (row) => insertAccountAttribution(pool, row),
  updateSignupProfile: (accountId, profile) => updateAccountSignupProfile(pool, accountId, profile),
};

/**
 * Persist the whole signup context for a freshly created account,
 * best-effort. Never throws and never blocks registration. At most TWO
 * detached statements per signup: the attribution INSERT (only when a signal
 * exists) and ONE combined accounts UPDATE for locale/country/opt-in (only
 * when any of the three is present); registration bursts are exactly when
 * this path runs, so per-signup statement count is kept minimal.
 */
export function captureSignupContext(
  accountId: number,
  req: Pick<IncomingMessage, 'headers'>,
  body: Record<string, unknown>,
  profile: SignupProfile,
  db: SignupCaptureDb = REAL_DB,
): void {
  try {
    const attribution = parseClientAttribution(body.attribution);
    const cookies = metaCookieData(req.headers.cookie);
    // The cookies are the one client-supplied field metaCookieData does not
    // bound; cap and control-strip them like every other stored identifier
    // (fbc embeds the fbclid, so it shares the click-id cap).
    const fbp = cleanText(cookies.fbp, MAX_CLICK_ID_LENGTH);
    const fbc = cleanText(cookies.fbc, MAX_CLICK_ID_LENGTH);
    if (attribution || fbp || fbc) {
      void db
        .insertAttribution({
          accountId,
          fbclid: attribution?.fbclid ?? null,
          fbp,
          fbc,
          utmSource: attribution?.utmSource ?? null,
          utmMedium: attribution?.utmMedium ?? null,
          utmCampaign: attribution?.utmCampaign ?? null,
          utmContent: attribution?.utmContent ?? null,
          utmTerm: attribution?.utmTerm ?? null,
          landingUrl: attribution?.landingUrl ?? null,
          referrer: attribution?.referrer ?? null,
          visitorId: attribution?.visitorId ?? null,
        })
        .catch((err) => console.error('account_attribution write failed:', err));
    }
    const country = parseSignupCountry(req.headers);
    if (profile.locale || country || profile.marketingOptIn) {
      void db
        .updateSignupProfile(accountId, {
          locale: profile.locale,
          country,
          marketingOptIn: profile.marketingOptIn,
        })
        .catch((err) => console.error('signup profile write failed:', err));
    }
  } catch (err) {
    // Analytics capture must never fault the register path.
    console.error('captureSignupContext failed:', err);
  }
}
