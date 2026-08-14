// First-touch attribution capture (src/attribution.ts): the pure parsers,
// the write-once localStorage record, and the register payload assembly
// (including the site-presence visitor id merge). localStorage is the
// Map-backed stub from local_storage_json.test.ts; location/document are
// stubbed per test.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  captureFirstTouch,
  FIRST_TOUCH_KEY,
  parseFirstTouch,
  readStoredFirstTouch,
  registerAttributionPayload,
  sanitizeStoredTouch,
} from '../src/attribution';

function installStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
  return store;
}

function installPage(search: string, href: string, referrer = ''): void {
  (globalThis as { location?: unknown }).location = { search, href };
  (globalThis as { document?: unknown }).document = { referrer };
}

beforeEach(() => {
  installStorage();
  installPage('', 'https://worldofclaudecraft.com/');
});

afterEach(() => {
  delete (globalThis as { location?: unknown }).location;
  delete (globalThis as { document?: unknown }).document;
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('parseFirstTouch', () => {
  it('captures fbclid, utm tags, landing url, and an external referrer', () => {
    const touch = parseFirstTouch(
      '?fbclid=IwAR1&utm_source=facebook&utm_campaign=aug_l5',
      'https://worldofclaudecraft.com/?fbclid=IwAR1',
      'https://l.facebook.com/',
    );
    expect(touch).toMatchObject({
      fbclid: 'IwAR1',
      utmSource: 'facebook',
      utmCampaign: 'aug_l5',
      landingUrl: 'https://worldofclaudecraft.com/?fbclid=IwAR1',
      referrer: 'https://l.facebook.com/',
    });
  });

  it('returns null for a direct visit with no signal', () => {
    expect(parseFirstTouch('', 'https://worldofclaudecraft.com/', '')).toBeNull();
  });

  it('treats a bare external referrer as a signal worth keeping', () => {
    const touch = parseFirstTouch('', 'https://worldofclaudecraft.com/', 'https://reddit.com/');
    expect(touch?.referrer).toBe('https://reddit.com/');
  });

  it('ignores a same-origin referrer (navigation, not acquisition)', () => {
    // The wiki chrome links straight to /play; an own-site hop must never
    // claim the write-once first touch and block a later real ad click.
    const touch = parseFirstTouch(
      '',
      'https://worldofclaudecraft.com/play',
      'https://worldofclaudecraft.com/wiki',
    );
    expect(touch).toBeNull();
    const withCampaign = parseFirstTouch(
      '?utm_source=facebook',
      'https://worldofclaudecraft.com/play',
      'https://worldofclaudecraft.com/wiki',
    );
    expect(withCampaign?.utmSource).toBe('facebook');
    expect(withCampaign?.referrer).toBeUndefined();
  });
});

describe('sanitizeStoredTouch', () => {
  it('rejects garbage shapes and re-caps stored values', () => {
    expect(sanitizeStoredTouch(null)).toBeNull();
    expect(sanitizeStoredTouch('x')).toBeNull();
    expect(sanitizeStoredTouch({ fbclid: 42 })).toBeNull();
    const long = sanitizeStoredTouch({ utmSource: 'x'.repeat(999) });
    expect(long?.utmSource?.length).toBe(256);
  });
});

describe('captureFirstTouch (write-once)', () => {
  it('stores the first touch and never overwrites it', () => {
    installPage(
      '?utm_source=facebook&utm_campaign=first',
      'https://worldofclaudecraft.com/?utm_source=facebook&utm_campaign=first',
    );
    captureFirstTouch();
    expect(readStoredFirstTouch()?.utmCampaign).toBe('first');

    installPage(
      '?utm_source=tiktok&utm_campaign=second',
      'https://worldofclaudecraft.com/?utm_source=tiktok&utm_campaign=second',
    );
    captureFirstTouch();
    expect(readStoredFirstTouch()?.utmCampaign).toBe('first');
  });

  it('stores nothing for a signal-free visit', () => {
    captureFirstTouch();
    expect(readStoredFirstTouch()).toBeNull();
  });

  it('survives an unavailable localStorage', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    installPage('?utm_source=facebook', 'https://worldofclaudecraft.com/?utm_source=facebook');
    expect(() => captureFirstTouch()).not.toThrow();
  });
});

describe('registerAttributionPayload', () => {
  it('merges the stored touch with the visitor id', () => {
    installPage('?utm_source=facebook', 'https://worldofclaudecraft.com/?utm_source=facebook');
    captureFirstTouch();
    const payload = registerAttributionPayload();
    expect(payload?.utmSource).toBe('facebook');
    // The site-presence visitor id is minted on demand (36 hex chars).
    expect(payload?.visitorId).toMatch(/^[0-9a-f]{36}$/);
  });

  it('falls back to a live parse when nothing is stored', () => {
    installPage('?fbclid=live1', 'https://worldofclaudecraft.com/?fbclid=live1');
    const payload = registerAttributionPayload();
    expect(payload?.fbclid).toBe('live1');
  });

  it('still reports the visitor id alone on a signal-free signup', () => {
    const payload = registerAttributionPayload();
    expect(payload?.fbclid).toBeUndefined();
    expect(payload?.visitorId).toMatch(/^[0-9a-f]{36}$/);
  });
});

describe('stored record round trip', () => {
  it('reads back exactly what capture wrote', () => {
    installPage(
      '?fbclid=abc&utm_medium=paid',
      'https://worldofclaudecraft.com/?fbclid=abc&utm_medium=paid',
      'https://www.facebook.com/',
    );
    captureFirstTouch();
    const raw = (
      globalThis as { localStorage: { getItem(k: string): string | null } }
    ).localStorage.getItem(FIRST_TOUCH_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string)).toMatchObject({ fbclid: 'abc', utmMedium: 'paid' });
  });
});
