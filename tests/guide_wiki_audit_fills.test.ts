// The sibling suite of tests/guide.test.ts for the Phase 20 wiki completeness corrections:
// every machine-authored non-Latin fill those corrections landed is anchored as a whole
// literal (tests/fixtures/guide_wiki_audit_fills.ts), the shape the ruled contract names for a
// fill no reviewer has read, so a fill cannot drift or be re-cut without the anchor moving in
// the same change. The English per-clause derivations live in tests/guide.test.ts under
// 'Guide wiki completeness corrections (Phase 20, 2026-09-03)'.
import { describe, expect, it } from 'vitest';
import { ensureLocaleLoaded, setLanguage, t } from '../src/ui/i18n';
import {
  GUIDE_WIKI_AUDIT_FILL_LOCALES,
  GUIDE_WIKI_AUDIT_FILLS,
} from './fixtures/guide_wiki_audit_fills';

const placeholders = (s: string): string[] => (s.match(/\{[A-Za-z0-9_]+\}/g) ?? []).sort();
const englishOf = (key: string): string => {
  setLanguage('en');
  return t(key as never);
};

describe('Guide wiki completeness audit fills (Phase 20 shape anchors)', () => {
  it('anchors at least the six farming keys and grows only', () => {
    expect(Object.keys(GUIDE_WIKI_AUDIT_FILLS).length).toBeGreaterThanOrEqual(6);
    expect(GUIDE_WIKI_AUDIT_FILL_LOCALES).toEqual(['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU']);
  });

  it('every anchored key is live English in the catalog with real paragraph breaks', () => {
    for (const key of Object.keys(GUIDE_WIKI_AUDIT_FILLS)) {
      const english = englishOf(key);
      expect(english, key).toBeTypeOf('string');
      expect(english, `${key} English carries a literal backslash-n`).not.toMatch(/\\n/);
    }
  });

  it('every machine-authored non-Latin fill renders byte for byte as anchored', async () => {
    for (const locale of GUIDE_WIKI_AUDIT_FILL_LOCALES) {
      await ensureLocaleLoaded(locale);
      setLanguage(locale);
      for (const [key, rows] of Object.entries(GUIDE_WIKI_AUDIT_FILLS)) {
        expect(t(key as never), `${locale} ${key}`).toBe(rows[locale]);
      }
    }
    setLanguage('en');
  });

  it('no anchored fill is the English, carries a literal backslash-n, or breaks placeholder or paragraph parity', () => {
    for (const [key, rows] of Object.entries(GUIDE_WIKI_AUDIT_FILLS)) {
      const english = englishOf(key);
      for (const locale of GUIDE_WIKI_AUDIT_FILL_LOCALES) {
        const fill = rows[locale];
        expect(fill, `${locale} ${key}`).not.toBe(english);
        expect(fill, `${locale} ${key} literal backslash-n`).not.toMatch(/\\n/);
        expect(placeholders(fill), `${locale} ${key} placeholders`).toEqual(placeholders(english));
        expect((fill.match(/\n/g) ?? []).length, `${locale} ${key} paragraph breaks`).toBe(
          (english.match(/\n/g) ?? []).length,
        );
      }
    }
  });
});
