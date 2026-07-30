// The deed-locale lazy loader seam (the i18n_lazy_loader shape scoped to the
// Book of Deeds): the release-fill deed tables live in PER-BASE-LOCALE chunks
// (deed_i18n.locales/<locale>.ts), so a default-English player downloads zero
// deed locale bytes AND a non-en visitor fetches only their own locale's chunk
// (a de_DE reader never downloads the other seventeen). Every lookup
// (deedName/deedDesc/deedTitleText) stays SYNCHRONOUS: before a locale's chunk
// is resident a non-en read falls back to the authored English (the documented
// absent-table behavior), and ensureDeedLocalesLoaded makes that locale's table
// resident behind the same awaits as ensureLocaleLoaded. A failed chunk fetch
// rejects (the caller owns the UI) without crashing, leaving English in place, a
// retry possible, and every OTHER locale still loadable.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEED_LOCALE_LOADERS,
  deedDesc,
  deedName,
  deedTitleText,
  ensureDeedLocalesLoaded,
} from '../src/ui/deed_i18n';
import { type SupportedLanguage, setLanguage } from '../src/ui/i18n';

type BaseLocale = keyof typeof DEED_LOCALE_LOADERS;

describe('lazy deed locales: per-locale chunks, synchronous lookups around ensureDeedLocalesLoaded', () => {
  afterEach(() => setLanguage('en'));

  it('falls back to English pre-load, rejects a failed chunk softly, and a retry lands Czech', async () => {
    setLanguage('cs_CZ');

    // Pre-load: the cs_CZ deed chunk is not resident, so the lookup renders the
    // authored English synchronously; it never blocks and never throws.
    expect(deedName('prog_first_steps')).toBe('First Steps');

    // Simulate a 404 / network failure on the chunk: the await rejects (the
    // caller owns the UI), English persists, and the cleared in-flight promise
    // leaves a retry possible.
    const failSpy = vi
      .spyOn(DEED_LOCALE_LOADERS, 'cs_CZ')
      .mockRejectedValueOnce(new Error('simulated 404'));
    await expect(ensureDeedLocalesLoaded('cs_CZ')).rejects.toThrow(/simulated 404/);
    failSpy.mockRestore();
    expect(deedName('prog_first_steps')).toBe('First Steps');

    // Retry: two concurrent loads coalesce onto ONE import (spy-through, the real
    // chunk still resolves), then the Czech release-fill values (pinned literals
    // from the cs_CZ chunk) resolve synchronously.
    const loadSpy = vi.spyOn(DEED_LOCALE_LOADERS, 'cs_CZ');
    try {
      await Promise.all([ensureDeedLocalesLoaded('cs_CZ'), ensureDeedLocalesLoaded('cs_CZ')]);
      expect(loadSpy).toHaveBeenCalledTimes(1);
    } finally {
      loadSpy.mockRestore();
    }
    expect(deedName('prog_first_steps')).toBe('První kroky');
    expect(deedDesc('prog_first_steps')).toBe(
      'Dosáhni úrovně 2 a udělej první krok na dlouhé cestě.',
    );
  });

  it('es_ES rides the es base chunk with a delve-vocabulary override; es keeps the base term', async () => {
    // The dialect fetches its BASE locale's chunk (es), never a chunk of its own.
    const esSpy = vi.spyOn(DEED_LOCALE_LOADERS, 'es');
    try {
      await ensureDeedLocalesLoaded('es_ES');
      expect(esSpy).toHaveBeenCalledTimes(1);
    } finally {
      esSpy.mockRestore();
    }
    setLanguage('es_ES');
    // The override layer applied: the dialect's own delve noun (the shipped
    // delveUi vocabulary) proves the es_ES layer merged over the es base table.
    expect(deedDesc('dlv_clears_50')).toContain('Profundidades');
    // A non-overridden entry inherits the base table byte-identically (the
    // talent_i18n localeText dialect model).
    const dialectName = deedName('prog_first_steps');

    // The es base rides its own chunk and keeps the base delve term.
    await ensureDeedLocalesLoaded('es');
    setLanguage('es');
    expect(deedName('prog_first_steps')).toBe(dialectName);
    expect(deedDesc('dlv_clears_50')).not.toContain('Profundidades');
    expect(deedDesc('dlv_clears_50')).toContain('expediciones');
  });

  it('fetches ONLY the requested locale chunk (de_DE), never another locale thunk', async () => {
    const keys = Object.keys(DEED_LOCALE_LOADERS) as BaseLocale[];
    const spies = new Map(keys.map((k) => [k, vi.spyOn(DEED_LOCALE_LOADERS, k)]));
    try {
      await ensureDeedLocalesLoaded('de_DE');
      expect(spies.get('de_DE')).toHaveBeenCalledTimes(1);
      for (const [k, spy] of spies) {
        if (k !== 'de_DE') expect(spy, `${k} thunk`).not.toHaveBeenCalled();
      }
    } finally {
      for (const spy of spies.values()) spy.mockRestore();
    }
    setLanguage('de_DE');
    expect(deedName('prog_first_steps')).toBe('Erste Schritte');
  });

  it('is an instant no-op for en / en_CA and for an already-resident locale', async () => {
    const keys = Object.keys(DEED_LOCALE_LOADERS) as BaseLocale[];
    const spies = keys.map((k) => vi.spyOn(DEED_LOCALE_LOADERS, k));
    try {
      await expect(ensureDeedLocalesLoaded('en')).resolves.toBeUndefined();
      await expect(ensureDeedLocalesLoaded('en_CA')).resolves.toBeUndefined();
      // de_DE is resident from the earlier test: never re-fetches any chunk.
      await ensureDeedLocalesLoaded('de_DE');
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('a rejected fetch for one locale leaves a DIFFERENT locale still loadable', async () => {
    // pt_BR and ru_RU are both fresh (untouched by the earlier tests). A failed
    // pt_BR fetch must not poison ru_RU or block a pt_BR retry.
    const ptFail = vi
      .spyOn(DEED_LOCALE_LOADERS, 'pt_BR')
      .mockRejectedValueOnce(new Error('simulated 404'));
    await expect(ensureDeedLocalesLoaded('pt_BR')).rejects.toThrow(/simulated 404/);
    ptFail.mockRestore();

    // A different locale still loads and renders its own fill.
    await ensureDeedLocalesLoaded('ru_RU');
    setLanguage('ru_RU');
    expect(deedName('prog_first_steps')).toBe('Первые шаги');

    // pt_BR still renders English (its chunk never became resident).
    setLanguage('pt_BR');
    expect(deedName('prog_first_steps')).toBe('First Steps');

    // The retry lands pt_BR: the cleared in-flight slot allowed a fresh import.
    await ensureDeedLocalesLoaded('pt_BR');
    expect(deedName('prog_first_steps')).toBe('Primeiros Passos');
  });

  it('coalesces two concurrent loads of one locale onto a single import', async () => {
    // ja_JP is fresh: two concurrent calls must resolve one shared import.
    const jaSpy = vi.spyOn(DEED_LOCALE_LOADERS, 'ja_JP');
    try {
      await Promise.all([ensureDeedLocalesLoaded('ja_JP'), ensureDeedLocalesLoaded('ja_JP')]);
      expect(jaSpy).toHaveBeenCalledTimes(1);
    } finally {
      jaSpy.mockRestore();
    }
    setLanguage('ja_JP');
    expect(deedName('prog_first_steps')).toBe('はじめの一歩');
  });

  it('resolves known deed strings byte-identically to the pre-split fill (data-integrity pin)', async () => {
    await Promise.all([
      ensureDeedLocalesLoaded('de_DE'),
      ensureDeedLocalesLoaded('zh_CN'),
      ensureDeedLocalesLoaded('ru_RU'),
    ]);
    // Literals captured from the former single deed_i18n.newlocales chunk BEFORE
    // the split: the per-locale chunks must resolve these exact strings.
    const pins: Record<
      string,
      {
        names: Record<string, string>;
        descs: Record<string, string>;
        titles: Record<string, string>;
      }
    > = {
      de_DE: {
        names: { prog_first_steps: 'Erste Schritte', dlv_clears_50: 'Fünfzig Faden tief' },
        descs: {
          prog_first_steps: 'Erreiche Stufe 2 und mache den ersten Schritt auf einem langen Weg.',
          dlv_clears_50: 'Schließe 50 Tiefgangsläufe ab.',
        },
        titles: { prog_veteran: 'Veteran' },
      },
      zh_CN: {
        names: { prog_first_steps: '千里之行', dlv_clears_50: '五十英寻' },
        descs: {
          prog_first_steps: '达到2级，在漫漫长路上迈出你的第一步。',
          dlv_clears_50: '完成 50 次探秘。',
        },
        titles: { prog_veteran: '老兵' },
      },
      ru_RU: {
        names: { prog_first_steps: 'Первые шаги', dlv_clears_50: 'Пятьдесят саженей' },
        descs: {
          prog_first_steps: 'Достигните 2-го уровня и сделайте первый шаг на долгом пути.',
          dlv_clears_50: 'Завершите 50 вылазок.',
        },
        titles: { prog_veteran: 'Ветеран' },
      },
    };
    for (const [lang, pin] of Object.entries(pins)) {
      setLanguage(lang as SupportedLanguage);
      for (const [id, name] of Object.entries(pin.names)) {
        expect(deedName(id), `${lang}.${id}.name`).toBe(name);
      }
      for (const [id, desc] of Object.entries(pin.descs)) {
        expect(deedDesc(id), `${lang}.${id}.desc`).toBe(desc);
      }
      for (const [id, title] of Object.entries(pin.titles)) {
        expect(deedTitleText(id), `${lang}.${id}.title`).toBe(title);
      }
    }
  });

  it('deed_i18n.ts carries no static VALUE import of a per-locale deed chunk (the eager-bundle regression guard)', () => {
    const src = readFileSync(new URL('../src/ui/deed_i18n.ts', import.meta.url), 'utf8');
    // Only a type-only import (erased at build) or the dynamic import() thunks in
    // DEED_LOCALE_LOADERS may reference a per-locale chunk; a static value import
    // would pull that locale's table back into the eager renderer bundle via
    // hud.ts and render/nameplate_painter.ts.
    expect(src).not.toMatch(
      /(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+'\.\/deed_i18n\.locales\//,
    );
    expect(src).toContain("import('./deed_i18n.locales/");
  });
});
