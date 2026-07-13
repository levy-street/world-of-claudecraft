import { describe, expect, it } from 'vitest';
import {
  createPrivacyConsentRecord,
  defaultPrivacyChoices,
  effectivePrivacyChoices,
  PRIVACY_CONSENT_COOKIE_NAME,
  PRIVACY_CONSENT_MAX_AGE_SECONDS,
  parsePrivacyConsentCookie,
  serializePrivacyConsentCookie,
} from '../src/privacy_consent_core';

describe('privacy consent core', () => {
  it('uses strict defaults for opt-in and permissive defaults for opt-out and notice', () => {
    expect(defaultPrivacyChoices('opt-in')).toEqual({
      analytics: false,
      marketing: false,
      x: false,
      twitch: false,
    });
    expect(defaultPrivacyChoices('opt-out')).toEqual({
      analytics: true,
      marketing: true,
      x: true,
      twitch: true,
    });
    expect(defaultPrivacyChoices('notice')).toEqual(defaultPrivacyChoices('opt-out'));
  });

  it('round-trips a versioned 180-day cookie', () => {
    const now = 1_800_000_000_000;
    const record = createPrivacyConsentRecord(
      { analytics: true, marketing: false, x: true, twitch: false },
      now,
    );
    const serialized = serializePrivacyConsentCookie(record, { secure: true });

    expect(serialized).toContain(`${PRIVACY_CONSENT_COOKIE_NAME}=`);
    expect(serialized).toContain(`Max-Age=${PRIVACY_CONSENT_MAX_AGE_SECONDS}`);
    expect(serialized).toContain('SameSite=Lax');
    expect(serialized).toContain('Secure');
    expect(parsePrivacyConsentCookie(serialized, now)).toEqual(record);
  });

  it('rejects malformed, stale, future, and old-version records', () => {
    const now = 1_800_000_000_000;
    const cookie = (value: unknown) =>
      `${PRIVACY_CONSENT_COOKIE_NAME}=${encodeURIComponent(JSON.stringify(value))}`;
    const choices = { analytics: true, marketing: true, x: true, twitch: true };

    expect(parsePrivacyConsentCookie(`${PRIVACY_CONSENT_COOKIE_NAME}=not-json`, now)).toBeNull();
    expect(
      parsePrivacyConsentCookie(cookie({ version: 0, updatedAt: now, ...choices }), now),
    ).toBeNull();
    expect(
      parsePrivacyConsentCookie(
        cookie({
          version: 1,
          updatedAt: now - (PRIVACY_CONSENT_MAX_AGE_SECONDS + 1) * 1000,
          ...choices,
        }),
        now,
      ),
    ).toBeNull();
    expect(
      parsePrivacyConsentCookie(cookie({ version: 1, updatedAt: now + 60_001, ...choices }), now),
    ).toBeNull();
  });

  it('makes GPC override stored analytics and marketing choices only', () => {
    const now = 1_800_000_000_000;
    const record = createPrivacyConsentRecord(
      { analytics: true, marketing: true, x: true, twitch: true },
      now,
    );

    expect(effectivePrivacyChoices(record, { regime: 'opt-out', gpc: true }, now)).toEqual({
      analytics: false,
      marketing: false,
      x: true,
      twitch: true,
    });
  });
});
