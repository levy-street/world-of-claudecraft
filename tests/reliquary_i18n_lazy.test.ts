// The reliquary-locale lazy loader seam (the deed_i18n_lazy shape scoped to The
// Reliquary): the page-name tables live in PER-BASE-LOCALE chunks
// (reliquary_i18n.locales/<locale>.ts), so a default-English player downloads
// zero reliquary locale bytes AND a non-en visitor fetches only their own
// locale's chunk (a ja_JP reader never downloads the other four). Every lookup
// (reliquaryPageName/reliquaryPageDesc) stays SYNCHRONOUS: before a locale's
// chunk is resident a non-en read falls back to the authored English (the
// documented absent-table behavior), and ensureReliquaryLocalesLoaded makes that
// locale's table resident behind the same awaits as ensureLocaleLoaded. A failed
// chunk fetch rejects (the caller owns the UI) without crashing, leaving English
// in place, a retry possible, and every OTHER locale still loadable.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../src/ui/i18n';
import {
  ensureReliquaryLocalesLoaded,
  RELIQUARY_LOCALE_LOADERS,
  type ReliquaryLocaleModule,
  reliquaryPageDesc,
  reliquaryPageName,
} from '../src/ui/reliquary_i18n';

// The loader record is Partial (only the shipped locales carry a chunk); the
// Required view is spy-able without widening the production type.
const loaders = RELIQUARY_LOCALE_LOADERS as Required<typeof RELIQUARY_LOCALE_LOADERS>;
type BaseLocale = keyof typeof loaders;

describe('lazy reliquary locales: per-locale chunks, synchronous lookups around ensureReliquaryLocalesLoaded', () => {
  it('falls back to English pre-load, rejects a failed chunk softly, and a retry lands Japanese', async () => {
    try {
      setLanguage('ja_JP');

      // Pre-load: the ja_JP chunk is not resident, so the lookup renders the
      // authored English synchronously; it never blocks and never throws.
      expect(reliquaryPageName('conquerors_hollow_crypt')).toBe('The Hollow Crypt');

      // Simulate a 404 / network failure on the chunk: the await rejects (the
      // caller owns the UI), English persists, and the cleared in-flight promise
      // leaves a retry possible.
      const failSpy = vi.spyOn(loaders, 'ja_JP').mockRejectedValueOnce(new Error('simulated 404'));
      await expect(ensureReliquaryLocalesLoaded('ja_JP')).rejects.toThrow(/simulated 404/);
      failSpy.mockRestore();
      expect(reliquaryPageName('conquerors_hollow_crypt')).toBe('The Hollow Crypt');

      // Retry: two concurrent loads coalesce onto ONE import (spy-through, the real
      // chunk still resolves), then the Japanese fill resolves synchronously.
      const loadSpy = vi.spyOn(loaders, 'ja_JP');
      try {
        await Promise.all([
          ensureReliquaryLocalesLoaded('ja_JP'),
          ensureReliquaryLocalesLoaded('ja_JP'),
        ]);
        expect(loadSpy).toHaveBeenCalledTimes(1);
      } finally {
        loadSpy.mockRestore();
      }
      expect(reliquaryPageName('conquerors_hollow_crypt')).toBe('虚ろの墓所');
      // A second row from the same chunk: the whole table went resident, not one
      // lucky entry.
      expect(reliquaryPageName('horizons_titles')).toBe('称号');
      // Page DESCS landed with the release fill, so the same resident table
      // now answers the desc field too (before the fill this row proved the
      // per-FIELD English fallback instead). The absent-table fallback, the
      // other half of that contract, is pinned by the no-chunk case below.
      expect(reliquaryPageDesc('horizons_titles')).toBe(
        '功績の書で獲得した称号。装飾のみで、強さもドロップ率も救済も一切与えません。',
      );
    } finally {
      // Restore the default language even when an assertion above throws,
      // so one failure cannot cascade into every later case in this file.
      setLanguage('en');
    }
  });

  it('fetches ONLY the requested locale chunk (ru_RU), never another locale thunk', async () => {
    try {
      const keys = Object.keys(loaders) as BaseLocale[];
      const spies = new Map(keys.map((k) => [k, vi.spyOn(loaders, k)]));
      try {
        await ensureReliquaryLocalesLoaded('ru_RU');
        expect(spies.get('ru_RU')).toHaveBeenCalledTimes(1);
        for (const [k, spy] of spies) {
          if (k !== 'ru_RU') expect(spy, `${k} thunk`).not.toHaveBeenCalled();
        }
      } finally {
        for (const spy of spies.values()) spy.mockRestore();
      }
      setLanguage('ru_RU');
      expect(reliquaryPageName('conquerors_hollow_crypt')).toBe('Пустая крипта');
    } finally {
      // Restore the default language even when an assertion above throws,
      // so one failure cannot cascade into every later case in this file.
      setLanguage('en');
    }
  });

  it('merges a dialect override over its base chunk (the es_ES / es escape hatch)', async () => {
    // No dialect layer ships yet (all five chunks are base locales), so this
    // branch is unreachable with real data and would rot unnoticed until the
    // release fill first needs it. Drive it with a synthetic chunk installed on
    // the loader record, mirroring the es_ES/es case that deed_i18n_lazy can
    // exercise against shipped data.
    const record = RELIQUARY_LOCALE_LOADERS as Record<string, () => Promise<ReliquaryLocaleModule>>;
    record.es = async () => ({
      table: {
        conquerors_hollow_crypt: { name: 'BASE crypt', desc: 'BASE crypt desc' },
        horizons_titles: { name: 'BASE titles' },
      },
      dialects: {
        es_ES: { conquerors_hollow_crypt: { name: 'DIALECT crypt' } },
      },
    });
    try {
      await ensureReliquaryLocalesLoaded('es_ES');
      setLanguage('es_ES');
      // The dialect's own entry wins over the base entry it names...
      expect(reliquaryPageName('conquerors_hollow_crypt')).toBe('DIALECT crypt');
      // ...and every entry it does not restate inherits the base byte-identically.
      expect(reliquaryPageName('horizons_titles')).toBe('BASE titles');
      // The merge is per PAGE ID (one shallow spread), so an override entry
      // replaces its base entry WHOLE: the base desc of an overridden page is not
      // inherited and falls back to the authored English.
      expect(reliquaryPageDesc('conquerors_hollow_crypt')).toBe(
        'Signature spoils claimed from Morthen and the Hollow Crypt.',
      );
      // A field neither layer carries falls back to the authored English too.
      expect(reliquaryPageDesc('horizons_titles')).toBe(
        'Titles earned from the Book of Deeds. Cosmetic only: never power, drop rate, or pity.',
      );
    } finally {
      setLanguage('en');
      // Residency is keyed by LANGUAGE, not by loader: deleting the loader does
      // not evict the synthetic es_ES table, which stays resident for the rest
      // of this file. Later arms deliberately use other locales; a future test
      // expecting es_ES to fall back to English must reset residency first.
      delete record.es;
    }
  });

  it('is an instant no-op for en / en_CA and for an already-resident locale', async () => {
    const keys = Object.keys(loaders) as BaseLocale[];
    const spies = keys.map((k) => vi.spyOn(loaders, k));
    try {
      await expect(ensureReliquaryLocalesLoaded('en')).resolves.toBeUndefined();
      await expect(ensureReliquaryLocalesLoaded('en_CA')).resolves.toBeUndefined();
      // ru_RU is resident from the earlier test: never re-fetches any chunk.
      await ensureReliquaryLocalesLoaded('ru_RU');
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('a rejected fetch for one locale leaves a DIFFERENT locale still loadable', async () => {
    try {
      // zh_CN and ko_KR are both fresh. A failed zh_CN fetch must not poison
      // ko_KR or block a zh_CN retry.
      const zhFail = vi.spyOn(loaders, 'zh_CN').mockRejectedValueOnce(new Error('simulated 404'));
      await expect(ensureReliquaryLocalesLoaded('zh_CN')).rejects.toThrow(/simulated 404/);
      zhFail.mockRestore();

      // A different locale still loads and renders its own fill.
      await ensureReliquaryLocalesLoaded('ko_KR');
      setLanguage('ko_KR');
      expect(reliquaryPageName('conquerors_hollow_crypt')).toBe('텅 빈 묘실');

      // zh_CN still renders English (its chunk never became resident).
      setLanguage('zh_CN');
      expect(reliquaryPageName('conquerors_hollow_crypt')).toBe('The Hollow Crypt');

      // The retry lands zh_CN: the cleared in-flight slot allowed a fresh import.
      await ensureReliquaryLocalesLoaded('zh_CN');
      expect(reliquaryPageName('conquerors_hollow_crypt')).toBe('空洞墓穴');
    } finally {
      // Restore the default language even when an assertion above throws,
      // so one failure cannot cascade into every later case in this file.
      setLanguage('en');
    }
  });

  it('coalesces two concurrent loads of one locale onto a single import', async () => {
    try {
      // zh_TW is fresh: two concurrent calls must resolve one shared import.
      const twSpy = vi.spyOn(loaders, 'zh_TW');
      try {
        await Promise.all([
          ensureReliquaryLocalesLoaded('zh_TW'),
          ensureReliquaryLocalesLoaded('zh_TW'),
        ]);
        expect(twSpy).toHaveBeenCalledTimes(1);
      } finally {
        twSpy.mockRestore();
      }
      setLanguage('zh_TW');
      // A set page, so the assertion cannot pass against the zh_CN table.
      expect(reliquaryPageName('conquerors_set_deathlord')).toBe('塚陵領主戰鬥護甲');
    } finally {
      // Restore the default language even when an assertion above throws,
      // so one failure cannot cascade into every later case in this file.
      setLanguage('en');
    }
  });

  it('a locale with no chunk resolves as a no-op and keeps rendering English', async () => {
    // Every base locale ships a chunk since the release fill, so the record row
    // is removed for the duration here rather than naming a locale that happens
    // to be unfilled: the contract under test is the record being PARTIAL (a
    // newly added base locale lands here before its fill), not any one locale's
    // fill state. The resident-table cache is keyed per locale and de_DE is
    // never loaded in this file, so nothing else has to be torn down.
    const saved = loaders.de_DE;
    delete (loaders as Partial<typeof loaders>).de_DE;
    try {
      const spies = (Object.keys(loaders) as BaseLocale[]).map((k) => vi.spyOn(loaders, k));
      try {
        await expect(ensureReliquaryLocalesLoaded('de_DE')).resolves.toBeUndefined();
        for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      } finally {
        for (const spy of spies) spy.mockRestore();
      }
      setLanguage('de_DE');
      expect(reliquaryPageName('conquerors_hollow_crypt')).toBe('The Hollow Crypt');
      // The absent-table fallback is per FIELD, not just per name.
      expect(reliquaryPageDesc('conquerors_hollow_crypt')).toBe(
        'Signature spoils claimed from Morthen and the Hollow Crypt.',
      );
    } finally {
      loaders.de_DE = saved;
      // Restore the default language even when an assertion above throws,
      // so one failure cannot cascade into every later case in this file.
      setLanguage('en');
    }
  });

  it('reliquary_i18n.ts carries no static VALUE import of a per-locale chunk (the eager-bundle regression guard)', () => {
    const src = readFileSync(new URL('../src/ui/reliquary_i18n.ts', import.meta.url), 'utf8');
    // Only a type-only import (erased at build) or the dynamic import() thunks in
    // RELIQUARY_LOCALE_LOADERS may reference a per-locale chunk; a static value
    // import would pull that locale's table back into the eager renderer bundle
    // via hud.ts and reliquary_window.ts.
    expect(src).not.toMatch(
      /(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+'\.\/reliquary_i18n\.locales\//,
    );
    expect(src).toContain("import('./reliquary_i18n.locales/");
  });
});
