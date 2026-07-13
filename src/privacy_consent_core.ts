export const PRIVACY_CONSENT_COOKIE_NAME = 'woc_privacy_consent';
export const PRIVACY_CONSENT_VERSION = 1 as const;
export const PRIVACY_CONSENT_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;
export const PRIVACY_CONSENT_MAX_AGE_MS = PRIVACY_CONSENT_MAX_AGE_SECONDS * 1000;

export type PrivacyRegime = 'opt-in' | 'opt-out' | 'notice';
export type PrivacyRegionSource = 'edge' | 'fallback';

export interface PrivacyRegionResponse {
  regime: PrivacyRegime;
  source: PrivacyRegionSource;
  gpc: boolean;
}

export interface PrivacyChoices {
  analytics: boolean;
  marketing: boolean;
  x: boolean;
  twitch: boolean;
}

export type PrivacyCategory = keyof PrivacyChoices;
export interface PrivacyConsentRecord extends PrivacyChoices {
  version: typeof PRIVACY_CONSENT_VERSION;
  updatedAt: number;
}

const DENY_OPTIONAL: Readonly<PrivacyChoices> = Object.freeze({
  analytics: false,
  marketing: false,
  x: false,
  twitch: false,
});

const ALLOW_OPTIONAL: Readonly<PrivacyChoices> = Object.freeze({
  analytics: true,
  marketing: true,
  x: true,
  twitch: true,
});

function firstHeader(value: string | readonly string[] | undefined): string {
  return typeof value === 'string' ? value : (value?.[0] ?? '');
}

function cookieValue(cookieHeader: string, name: string): string | undefined {
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return undefined;
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

export function defaultPrivacyChoices(regime: PrivacyRegime, gpc = false): PrivacyChoices {
  const defaults = regime === 'opt-in' ? DENY_OPTIONAL : ALLOW_OPTIONAL;
  return {
    ...defaults,
    analytics: gpc ? false : defaults.analytics,
    marketing: gpc ? false : defaults.marketing,
  };
}

export function createPrivacyConsentRecord(
  choices: PrivacyChoices,
  now = Date.now(),
): PrivacyConsentRecord {
  return {
    version: PRIVACY_CONSENT_VERSION,
    updatedAt: now,
    analytics: choices.analytics,
    marketing: choices.marketing,
    x: choices.x,
    twitch: choices.twitch,
  };
}

export function parsePrivacyConsentCookie(
  cookieHeader: string | readonly string[] | undefined,
  now = Date.now(),
): PrivacyConsentRecord | null {
  const raw = cookieValue(firstHeader(cookieHeader), PRIVACY_CONSENT_COOKIE_NAME);
  if (!raw) return null;
  try {
    const value = JSON.parse(decodeURIComponent(raw)) as Partial<PrivacyConsentRecord>;
    if (
      value.version !== PRIVACY_CONSENT_VERSION ||
      typeof value.updatedAt !== 'number' ||
      !Number.isFinite(value.updatedAt) ||
      value.updatedAt > now + 60_000 ||
      now - value.updatedAt > PRIVACY_CONSENT_MAX_AGE_MS ||
      !isBoolean(value.analytics) ||
      !isBoolean(value.marketing) ||
      !isBoolean(value.x) ||
      !isBoolean(value.twitch)
    ) {
      return null;
    }
    return {
      version: PRIVACY_CONSENT_VERSION,
      updatedAt: value.updatedAt,
      analytics: value.analytics,
      marketing: value.marketing,
      x: value.x,
      twitch: value.twitch,
    };
  } catch {
    return null;
  }
}

export function effectivePrivacyChoices(
  record: PrivacyConsentRecord | null,
  region: Pick<PrivacyRegionResponse, 'regime' | 'gpc'>,
  now = Date.now(),
): PrivacyChoices {
  const activeRecord =
    record && now - record.updatedAt <= PRIVACY_CONSENT_MAX_AGE_MS ? record : null;
  const choices = activeRecord ?? defaultPrivacyChoices(region.regime, region.gpc);
  return {
    analytics: region.gpc ? false : choices.analytics,
    marketing: region.gpc ? false : choices.marketing,
    x: choices.x,
    twitch: choices.twitch,
  };
}

export function serializePrivacyConsentCookie(
  record: PrivacyConsentRecord,
  options: { secure?: boolean } = {},
): string {
  const value = encodeURIComponent(JSON.stringify(record));
  return [
    `${PRIVACY_CONSENT_COOKIE_NAME}=${value}`,
    'Path=/',
    `Max-Age=${PRIVACY_CONSENT_MAX_AGE_SECONDS}`,
    'SameSite=Lax',
    ...(options.secure ? ['Secure'] : []),
  ].join('; ');
}
