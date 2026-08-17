// First-touch acquisition attribution for the marketing/UA funnel.
//
// On first page load we capture the ad-click identifiers the visitor arrived
// with (fbclid, the utm_* tags, the landing URL, document.referrer) and store
// them in localStorage, write-once: the FIRST touch wins, so a visitor who
// browses around (or comes back tomorrow through a bookmark) still signs up
// carrying the campaign that actually acquired them. At registration the
// stored payload (plus the site-presence visitor id, linking the pre-signup
// web session) rides the register call; the server validates and persists it
// (server/signup_attribution.ts).
//
// Shape notes (the device_memory_hint.ts conventions): pure parsers at the
// top, fail-soft storage wrappers at the bottom, exported key constants, and
// no module-load side effects (main.ts calls captureFirstTouch() at boot).

import { visitorId } from './site_presence';

/** localStorage key for the write-once first-touch record. */
export const FIRST_TOUCH_KEY = 'woc_first_touch_v1';

/** Caps mirror the server's (signup_attribution.ts); trimming here keeps the
 *  stored record and the register payload small. */
const MAX_URL_LENGTH = 2048;
const MAX_TAG_LENGTH = 256;
const MAX_CLICK_ID_LENGTH = 512;

export interface FirstTouchAttribution {
  fbclid?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  landingUrl?: string;
  referrer?: string;
}

const clean = (value: string | null | undefined, max: number): string | undefined => {
  if (!value) return undefined;
  const text = value.trim().slice(0, max);
  return text.length > 0 ? text : undefined;
};

const cleanUrl = (value: string | null | undefined): string | undefined => {
  const text = clean(value, MAX_URL_LENGTH);
  return text && /^https?:\/\//i.test(text) ? text : undefined;
};

/** An own-site referrer is navigation, not acquisition: both entries route
 *  through the same origin (the wiki chrome links straight to /play), and a
 *  same-origin hop stored as the write-once first touch would permanently
 *  block a later real ad click from claiming it. */
const isExternalReferrer = (referrer: string | undefined, landingUrl: string): boolean => {
  if (!referrer) return false;
  try {
    return new URL(referrer).origin !== new URL(landingUrl).origin;
  } catch {
    return false;
  }
};

/** Parse the attribution signals out of one page view. Pure; returns null
 *  when the view carries no signal at all (no row is worth storing then). */
export function parseFirstTouch(
  search: string,
  landingUrl: string,
  referrer: string,
): FirstTouchAttribution | null {
  const params = new URLSearchParams(search);
  const externalReferrer = cleanUrl(referrer);
  const touch: FirstTouchAttribution = {
    fbclid: clean(params.get('fbclid'), MAX_CLICK_ID_LENGTH),
    utmSource: clean(params.get('utm_source'), MAX_TAG_LENGTH),
    utmMedium: clean(params.get('utm_medium'), MAX_TAG_LENGTH),
    utmCampaign: clean(params.get('utm_campaign'), MAX_TAG_LENGTH),
    utmContent: clean(params.get('utm_content'), MAX_TAG_LENGTH),
    utmTerm: clean(params.get('utm_term'), MAX_TAG_LENGTH),
    landingUrl: undefined,
    referrer: isExternalReferrer(externalReferrer, landingUrl) ? externalReferrer : undefined,
  };
  const hasCampaignSignal =
    touch.fbclid !== undefined ||
    touch.utmSource !== undefined ||
    touch.utmMedium !== undefined ||
    touch.utmCampaign !== undefined ||
    touch.utmContent !== undefined ||
    touch.utmTerm !== undefined;
  // The landing URL is only interesting alongside a campaign signal or an
  // external referrer; a plain direct visit stores nothing.
  if (!hasCampaignSignal && touch.referrer === undefined) return null;
  touch.landingUrl = cleanUrl(landingUrl);
  return touch;
}

/** Validate a stored record back into shape (storage can hold stale garbage
 *  from older builds; every field re-passes the parser caps). */
export function sanitizeStoredTouch(value: unknown): FirstTouchAttribution | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === 'string' ? clean(v, max) : undefined);
  const touch: FirstTouchAttribution = {
    fbclid: str(raw.fbclid, MAX_CLICK_ID_LENGTH),
    utmSource: str(raw.utmSource, MAX_TAG_LENGTH),
    utmMedium: str(raw.utmMedium, MAX_TAG_LENGTH),
    utmCampaign: str(raw.utmCampaign, MAX_TAG_LENGTH),
    utmContent: str(raw.utmContent, MAX_TAG_LENGTH),
    utmTerm: str(raw.utmTerm, MAX_TAG_LENGTH),
    landingUrl: cleanUrl(typeof raw.landingUrl === 'string' ? raw.landingUrl : undefined),
    referrer: cleanUrl(typeof raw.referrer === 'string' ? raw.referrer : undefined),
  };
  return Object.values(touch).some((v) => v !== undefined) ? touch : null;
}

/** The register-call payload: the first touch (stored if present, else this
 *  page view) plus the site-presence visitor id. Null when there is nothing
 *  to report (the server then writes no attribution row). */
export function registerAttributionPayload(): Record<string, string> | null {
  const touch =
    readStoredFirstTouch() ??
    (typeof location !== 'undefined'
      ? parseFirstTouch(
          location.search,
          location.href,
          typeof document !== 'undefined' ? document.referrer : '',
        )
      : null);
  const payload: Record<string, string> = {};
  if (touch) {
    for (const [key, value] of Object.entries(touch)) {
      if (typeof value === 'string') payload[key] = value;
    }
  }
  const visitor = safeVisitorId();
  if (visitor) payload.visitorId = visitor;
  return Object.keys(payload).length > 0 ? payload : null;
}

/** Capture this page view as the first touch if none is stored yet.
 *  Write-once; a later visit with different tags never overwrites. Call once
 *  at boot, before any register flow can run. */
export function captureFirstTouch(): void {
  if (typeof location === 'undefined') return;
  if (readStoredFirstTouch() !== null) return;
  const touch = parseFirstTouch(
    location.search,
    location.href,
    typeof document !== 'undefined' ? document.referrer : '',
  );
  if (!touch) return;
  writeStoredFirstTouch(touch);
}

// ---------------------------------------------------------------------------
// Fail-soft storage wrappers (private browsing or a full quota must never
// break boot or signup; attribution is best-effort by definition).
// ---------------------------------------------------------------------------

export function readStoredFirstTouch(): FirstTouchAttribution | null {
  try {
    const raw = localStorage.getItem(FIRST_TOUCH_KEY);
    if (!raw) return null;
    return sanitizeStoredTouch(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeStoredFirstTouch(touch: FirstTouchAttribution): void {
  try {
    const compact: Record<string, string> = {};
    for (const [key, value] of Object.entries(touch)) {
      if (typeof value === 'string') compact[key] = value;
    }
    localStorage.setItem(FIRST_TOUCH_KEY, JSON.stringify(compact));
  } catch {
    // Storage unavailable: the live-parse fallback in
    // registerAttributionPayload still covers a same-page signup.
  }
}

function safeVisitorId(): string | null {
  try {
    return visitorId();
  } catch {
    return null;
  }
}
