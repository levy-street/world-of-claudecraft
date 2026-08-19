import { describe, expect, it } from 'vitest';
import { en, pending, translations } from '../src/ui/i18n.resolved.generated';

const AFFECTED = [
  {
    ability: 'fear',
    key: 'entities.abilities.fear.description',
    stale: /8\s*(?:s|sec|sek|сек|秒|초|detik|giây)/i,
  },
  {
    ability: 'howl_of_terror',
    key: 'entities.abilities.howl_of_terror.description',
    stale: /3\s*(?:s|sec|sek|сек|秒|초|detik|giây)/i,
  },
  {
    ability: 'ossuary_mark',
    key: 'entities.abilities.ossuary_mark.description',
    stale: /12\s*(?:s|sec|sek|сек|秒|초|detik|giây)/i,
  },
] as const;

const NON_LATIN_FILLED = new Set(['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU']);

function description(table: unknown, ability: string): string {
  const rooted = table as {
    entities?: { abilities?: Record<string, { description?: unknown }> };
  };
  const value = rooted.entities?.abilities?.[ability]?.description;
  if (typeof value !== 'string') throw new Error(`missing ${ability} description`);
  return value;
}

describe('warlock crowd-control resolved tooltip translations', () => {
  it('ships the updated control durations and break thresholds in every non-English bundle', () => {
    for (const [locale, table] of Object.entries(translations)) {
      if (locale === 'en' || locale === 'en_CA') continue;

      for (const row of AFFECTED) {
        const text = description(table, row.ability);
        expect(text, `${locale}.${row.key}`).toContain(row.ability === 'ossuary_mark' ? '15' : '5');
        if (row.ability !== 'ossuary_mark')
          expect(text, `${locale}.${row.key}`).toMatch(/(?:8\s*%|%\s*8)/);
        expect(text, `${locale}.${row.key}`).not.toMatch(row.stale);
      }
    }
  });

  it('marks any untranslated stale prose as pending English fallback instead of preserving old overlays', () => {
    for (const [locale, table] of Object.entries(translations)) {
      if (locale === 'en' || locale === 'en_CA' || NON_LATIN_FILLED.has(locale)) continue;

      for (const row of AFFECTED) {
        if (pending[locale]?.includes(row.key)) {
          expect(description(table, row.ability), `${locale}.${row.key}`).toBe(
            description(en, row.ability),
          );
        } else {
          expect(description(table, row.ability), `${locale}.${row.key}`).not.toMatch(row.stale);
        }
      }
    }
  });
});
