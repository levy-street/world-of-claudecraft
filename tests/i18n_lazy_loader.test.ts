// The i18n Lazy Locales async loader seam (the async locale loader surface, made load-bearing by the lazy locale flip).
//
// ensureLocaleLoaded is the ONLY async surface in src/ui/i18n.ts; t() and setLanguage stay
// SYNCHRONOUS forever. After the lazy locale flip the non-en locales
// are no longer statically resident, so the await is now REAL: t() falls back to English for
// a not-yet-loaded locale (synchronous, never throws), and renders the localized table
// synchronously once ensureLocaleLoaded has made it resident. A failed chunk fetch rejects
// (the caller - bootstrap / picker - catches it) without crashing, leaving English in place
// and a retry possible.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  de_DE,
  en,
  ensureLocaleLoaded,
  es,
  fr_FR,
  isLocaleResident,
  prefetchLocale,
  setLanguage,
  t,
} from '../src/ui/i18n';
import { LOCALE_LOADERS } from '../src/ui/i18n.resolved.generated/loaders';

describe('lazy-locale loader: t() stays synchronous around ensureLocaleLoaded', () => {
  afterEach(() => setLanguage('en'));

  it('falls back to English before the await, renders the locale synchronously after', async () => {
    // Non-vacuous floor: the locale genuinely differs from English, so the English-fallback
    // and the post-await localized read are distinguishable (not a trivially-passing equality).
    expect(de_DE.nav.play).not.toBe(en.nav.play);
    expect(isLocaleResident('de_DE')).toBe(false);

    setLanguage('de_DE');

    // Pre-await: the de_DE chunk is not resident yet, so t() returns the synchronous English
    // fallback - it never blocks and never throws (the lazy flip's R-class guarantee).
    const before = t('nav.play');
    expect(typeof before).toBe('string');
    expect(before).toBe(en.nav.play);

    await ensureLocaleLoaded('de_DE');
    expect(isLocaleResident('de_DE')).toBe(true);

    // Post-await: still synchronous, now resolved against the resident German table.
    const after = t('nav.play');
    expect(typeof after).toBe('string');
    expect(after).toBe(de_DE.nav.play);
  });

  it('rejects a failed locale chunk softly: t() stays English, no crash, retry possible', async () => {
    // Keep the active language English so a failed background load never disturbs the UI.
    setLanguage('en');
    // Non-vacuous floor: es genuinely differs from English, so the English-fallback assertion
    // below (t("nav.play") === en.nav.play) proves the fallback fired - not a coincidental
    // equality that would also pass if es.nav.play happened to equal en.nav.play.
    expect(es.nav.play).not.toBe(en.nav.play);
    expect(isLocaleResident('es')).toBe(false);

    // Simulate a 404 / network failure on the es chunk. ensureLocaleLoaded rejects (so the
    // picker/bootstrap can react - the picker renders settings.languageLoadFailed), but the
    // app does not crash and es stays non-resident.
    const failSpy = vi
      .spyOn(LOCALE_LOADERS, 'es')
      .mockRejectedValueOnce(new Error('simulated 404'));
    await expect(ensureLocaleLoaded('es')).rejects.toThrow(/simulated 404/);
    failSpy.mockRestore();
    expect(isLocaleResident('es')).toBe(false);

    // A synchronous read against the failed locale falls back to English - never throws.
    setLanguage('es');
    expect(t('nav.play')).toBe(en.nav.play);
    setLanguage('en');

    // The failed load cleared `inflight`, so a subsequent real load can still succeed.
    await ensureLocaleLoaded('es');
    expect(isLocaleResident('es')).toBe(true);
  });

  it('treats English as always resident and instant', async () => {
    expect(isLocaleResident('en')).toBe(true);
    await expect(ensureLocaleLoaded('en')).resolves.toBeUndefined();
  });

  it('coalesces two concurrent loads of the same locale onto one import', async () => {
    // Precondition: fr_FR is not yet resident, so we exercise the real load path (the
    // inflight branch) rather than the resident short-circuit. If a reordering ever made
    // it resident first, this fails loudly instead of silently vacuating the proof below.
    expect(isLocaleResident('fr_FR')).toBe(false);

    // ensureLocaleLoaded is async, so each call returns a fresh wrapper promise - outer
    // promise identity (p1 === p2) can NEVER hold and would not prove coalescing. The real
    // proof is that the underlying loader thunk runs exactly ONCE for two concurrent calls:
    // the first call sets `inflight` synchronously (no await before inflight.set), so the
    // second call short-circuits onto it. Spy-through (the real import still resolves, so
    // fr_FR becomes resident); delete the inflight.get short-circuit and this count becomes 2.
    const loadSpy = vi.spyOn(LOCALE_LOADERS, 'fr_FR');
    try {
      await Promise.all([ensureLocaleLoaded('fr_FR'), ensureLocaleLoaded('fr_FR')]);
      expect(loadSpy).toHaveBeenCalledTimes(1);
    } finally {
      loadSpy.mockRestore();
    }
    expect(isLocaleResident('fr_FR')).toBe(true);

    // Once resident, t() renders that locale synchronously.
    setLanguage('fr_FR');
    expect(t('nav.play')).toBe(fr_FR.nav.play);
  });

  it('loading a locale does not change the active language (load is decoupled from select)', async () => {
    // ensureLocaleLoaded only makes a locale's table resident; SELECTING it is setLanguage's
    // job. A real fresh load (ja_JP) while still on en must NOT change what t() renders -
    // this pins the separation that lets the bootstrap await the load behind the loading
    // screen without prematurely switching the language (t() stays driven
    // by setLanguage, never by a load).
    setLanguage('en');
    expect(isLocaleResident('ja_JP')).toBe(false);
    await ensureLocaleLoaded('ja_JP');
    expect(isLocaleResident('ja_JP')).toBe(true);
    expect(t('nav.play')).toBe(en.nav.play);
  });

  it('renders the 3 new language-load status keys via t() (en)', () => {
    setLanguage('en');
    expect(t('settings.languageLoading')).toBe(en.settings.languageLoading);
    expect(t('settings.languageLoadFailed')).toBe(en.settings.languageLoadFailed);
    expect(t('settings.languageLoadUnavailable')).toBe(en.settings.languageLoadUnavailable);
  });
});

describe('prefetchLocale (stored-locale modulepreload runtime prefetch)', () => {
  afterEach(() => setLanguage('en'));

  it('fires the loader exactly once for a non-en, non-resident locale', async () => {
    setLanguage('en');
    expect(isLocaleResident('ko_KR')).toBe(false);
    const spy = vi.spyOn(LOCALE_LOADERS, 'ko_KR');
    try {
      // ensureLocaleLoaded sets inflight (and invokes the thunk) synchronously, so a single
      // fire-and-forget prefetch issues exactly one import; the await coalesces onto it.
      prefetchLocale('ko_KR');
      expect(spy).toHaveBeenCalledTimes(1);
      await ensureLocaleLoaded('ko_KR');
    } finally {
      spy.mockRestore();
    }
    expect(isLocaleResident('ko_KR')).toBe(true);
  });

  it('is a no-op for English (preserves the zero-non-en-bytes guarantee)', () => {
    setLanguage('en');
    // English has no LOCALE_LOADERS entry; prefetchLocale must return early without firing.
    expect(() => prefetchLocale('en')).not.toThrow();
    expect(isLocaleResident('en')).toBe(true);
  });

  it('is a no-op for an already-resident locale (never re-fetches)', async () => {
    await ensureLocaleLoaded('de_DE');
    expect(isLocaleResident('de_DE')).toBe(true);
    const spy = vi.spyOn(LOCALE_LOADERS, 'de_DE');
    try {
      prefetchLocale('de_DE');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('swallows a rejected prefetch (no unhandled rejection; a retry still succeeds)', async () => {
    setLanguage('en');
    expect(isLocaleResident('it_IT')).toBe(false);
    const failSpy = vi
      .spyOn(LOCALE_LOADERS, 'it_IT')
      .mockRejectedValueOnce(new Error('simulated 404'));
    // prefetchLocale returns void and swallows the rejection; if it did not, the rejected
    // microtask would surface as an unhandledRejection and fail the run.
    prefetchLocale('it_IT');
    await new Promise((r) => setTimeout(r, 0));
    failSpy.mockRestore();
    expect(isLocaleResident('it_IT')).toBe(false);
    // The failed load cleared inflight, so a fresh real load still succeeds.
    await ensureLocaleLoaded('it_IT');
    expect(isLocaleResident('it_IT')).toBe(true);
  });
});
