import { beforeAll, describe, expect, it } from 'vitest';
import {
  cs_CZ,
  da_DK,
  de_DE,
  en,
  en_CA,
  ensureLocaleLoaded,
  es,
  es_ES,
  formatMoney,
  fr_CA,
  fr_FR,
  hasTranslation,
  id_ID,
  it_IT,
  ja_JP,
  ko_KR,
  languageTag,
  nl_NL,
  pl_PL,
  pt_BR,
  ru_RU,
  type SupportedLanguage,
  setLanguage,
  supportedLanguages,
  sv_SE,
  tPlural,
  tr_TR,
  vi_VN,
  zh_CN,
  zh_TW,
} from '../src/ui/i18n';

// Whole-catalog i18n completeness guards that the per-key sample tests in
// localization_coverage.test.ts do not cover: full interpolation-token parity
// across EVERY leaf and locale, per-locale lazy loadability, locale-aware money
// grouping, an English-leak regression bound for the non-Latin locales, and the
// CLDR pluralization subsystem (tPlural + the hudChrome.plurals.* keys).

const TABLES: Record<SupportedLanguage, unknown> = {
  en,
  es,
  es_ES,
  fr_FR,
  fr_CA,
  en_CA,
  it_IT,
  de_DE,
  zh_CN,
  zh_TW,
  ko_KR,
  ja_JP,
  pt_BR,
  ru_RU,
  cs_CZ,
  nl_NL,
  pl_PL,
  id_ID,
  tr_TR,
  sv_SE,
  vi_VN,
  da_DK,
};

function flatten(
  obj: unknown,
  prefix = '',
  out: Record<string, string> = {},
): Record<string, string> {
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object') flatten(v, key, out);
      else if (typeof v === 'string') out[key] = v;
    }
  }
  return out;
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((m) => m[1]).sort();
}

const enFlat = flatten(en);

describe('i18n whole-catalog completeness', () => {
  beforeAll(async () => {
    await Promise.all(supportedLanguages.map((lang) => ensureLocaleLoaded(lang)));
  });

  // H10: every locale must carry the EXACT {placeholder} set of `en` for every
  // leaf - across the whole catalog, not just hud/abilityUi/questUi/itemUi. A drift
  // here breaks interpolate() (a dropped/renamed token renders a literal {brace} or
  // silently omits a value) and the type system cannot see it.
  it('every locale preserves the exact interpolation tokens of en for every leaf', () => {
    const mismatches: string[] = [];
    for (const lang of supportedLanguages) {
      if (lang === 'en') continue;
      const flat = flatten(TABLES[lang]);
      for (const [key, enValue] of Object.entries(enFlat)) {
        const localeValue = flat[key];
        if (typeof localeValue !== 'string') continue;
        const a = placeholders(enValue).join(',');
        const b = placeholders(localeValue).join(',');
        if (a !== b) mismatches.push(`${lang} ${key}: en{${a}} vs {${b}}`);
      }
    }
    expect(mismatches, mismatches.slice(0, 25).join('\n')).toEqual([]);
  });

  // L6: every advertised locale must lazy-load, become resident, and resolve real
  // localized text - not just the 7 that older tests exercise individually.
  it('every supportedLanguage loads and resolves a localized, non-empty sample', async () => {
    for (const lang of supportedLanguages) {
      await ensureLocaleLoaded(lang);
      setLanguage(lang);
      // A key every locale translates; must be present and non-empty.
      expect(hasTranslation('classes.warrior', lang), `${lang} missing classes.warrior`).toBe(true);
      const flat = flatten(TABLES[lang]);
      expect(
        (flat['classes.warrior'] ?? '').length,
        `${lang} empty classes.warrior`,
      ).toBeGreaterThan(0);
      // Intl tag must be well-formed (no underscore RangeError).
      expect(() => new Intl.NumberFormat(languageTag(lang)), `${lang} bad tag`).not.toThrow();
    }
    setLanguage('en');
  });

  // M17: money grouping must follow the active locale (the compact-money path runs
  // each amount through formatNumber). 12,345 gold exercises a thousands separator.
  it('formatMoney groups thousands by the active locale', async () => {
    const bigGold = 12_345 * 10_000; // copper -> 12,345g
    await ensureLocaleLoaded('de_DE');
    setLanguage('en');
    const enMoney = formatMoney(bigGold);
    setLanguage('de_DE');
    const deMoney = formatMoney(bigGold);
    setLanguage('en');
    expect(enMoney).toContain('12,345');
    expect(deMoney).toContain('12.345');
    expect(deMoney).not.toContain('12,345');
  });

  // M16: no untranslated English in the non-Latin locales. A "wordy" en leaf (>=4
  // consecutive lowercase ASCII letters AFTER removing {placeholder} tokens - i.e.
  // real English prose, not an acronym or a token-only template) that is byte-
  // identical in a CJK/Cyrillic locale is an untranslated-English leak. The ONLY
  // leaves that legitimately stay identical are brand / URL strings, kept verbatim
  // in every locale on purpose; everything else must differ. Add a key here only if
  // it is a genuine brand/URL that should never be translated.
  it('non-Latin locales ship no untranslated English (only brand/URL leaves stay identical)', () => {
    const BRAND_ALLOW = new Set([
      'footer.copyright', // "{year} World of ClaudeCraft" - brand
      'footer.githubLink', // repository URL
      'fiesta.bracket', // "Fiesta" event brand
      'serverUnavailable.logoAlt', // "World of ClaudeCraft" logo alt text - brand
      'guide.brand', // "World of ClaudeCraft" - brand (Guide)
      'guide.brandShort', // "ClaudeCraft" - brand (Guide)
      'guide.home.title', // "World of ClaudeCraft" - brand (Guide hero)
      'guide.footer.rights', // "World of ClaudeCraft" - brand (Guide footer)
      'hudChrome.discord.title', // "Discord" - brand
      'hudChrome.discord.open', // "Discord" - brand
      'hudChrome.steam.title', // "Steam" - brand
      'hudChrome.discord.panelTitle', // "World of ClaudeCraft" - brand
      'hudChrome.discord.linkedTitle', // "Discord: {name}" - brand + player name
      'hudChrome.keybinds.discord', // "Discord" - brand (Key Bindings action label)
      'guide.controls.discord', // "Discord" - brand (Guide controls-page action label)
      'desktop.crash.title', // "World of ClaudeCraft" - brand (desktop crash dialog title)
      'auth.emailPlaceholder', // "you@example.com" - RFC 2606 example address, kept verbatim
    ]);
    const wordy = (v: string) => /[a-z]{4,}/.test(v.replace(/\{[^}]*\}/g, ''));
    const nonLatin: SupportedLanguage[] = ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'];
    const leaks: string[] = [];
    for (const lang of nonLatin) {
      const flat = flatten(TABLES[lang]);
      for (const [key, enValue] of Object.entries(enFlat)) {
        if (wordy(enValue) && flat[key] === enValue && !BRAND_ALLOW.has(key)) {
          leaks.push(`${lang} ${key}: "${enValue}"`);
        }
      }
    }
    expect(
      leaks,
      `untranslated English leaked into non-Latin locales:\n${leaks.join('\n')}`,
    ).toEqual([]);
  });
});

describe('i18n CLDR pluralization', () => {
  const CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;

  beforeAll(async () => {
    await Promise.all(supportedLanguages.map((lang) => ensureLocaleLoaded(lang)));
  });

  // The plural bases declared in the catalog (under hudChrome.plurals).
  const enPlurals = (en as { hudChrome: { plurals: Record<string, Record<string, string>> } })
    .hudChrome.plurals;
  const bases = Object.keys(enPlurals);

  it('declares the expected plural bases with all four CLDR categories in en', () => {
    expect(bases.sort()).toEqual([
      'characterCount',
      'guildMembers',
      'playersMatching',
      'playersOnline',
      'secondsRemaining',
    ]);
    for (const base of bases) {
      for (const cat of ['one', 'few', 'many', 'other']) {
        expect(typeof enPlurals[base][cat], `en plurals.${base}.${cat}`).toBe('string');
      }
    }
  });

  it('every locale supplies a non-empty leaf for each CLDR category its plural rules can select', () => {
    const missing: string[] = [];
    for (const lang of supportedLanguages) {
      const need = new Intl.PluralRules(languageTag(lang)).resolvedOptions().pluralCategories;
      const flat = flatten(TABLES[lang]);
      for (const base of bases) {
        for (const cat of need) {
          if (!CATEGORIES.includes(cat as (typeof CATEGORIES)[number])) continue;
          const v = flat[`hudChrome.plurals.${base}.${cat}`];
          if (typeof v !== 'string' || v.length === 0) missing.push(`${lang} ${base}.${cat}`);
        }
      }
    }
    expect(missing, missing.join('\n')).toEqual([]);
  });

  it('tPlural selects the correct Russian 1 / 2-4 / 5+ forms', async () => {
    await ensureLocaleLoaded('ru_RU');
    setLanguage('ru_RU');
    // персонаж (1) / персонажа (2-4) / персонажей (5+)
    expect(tPlural('hudChrome.plurals.characterCount', 1)).toBe('1 персонаж');
    expect(tPlural('hudChrome.plurals.characterCount', 3)).toBe('3 персонажа');
    expect(tPlural('hudChrome.plurals.characterCount', 5)).toBe('5 персонажей');
    expect(tPlural('hudChrome.plurals.characterCount', 22)).toBe('22 персонажа'); // few
    expect(tPlural('hudChrome.plurals.characterCount', 25)).toBe('25 персонажей'); // many
    setLanguage('en');
  });

  it('tPlural selects one/other for English and is count-substituted', async () => {
    setLanguage('en');
    expect(tPlural('hudChrome.plurals.characterCount', 1)).toBe('1 character');
    expect(tPlural('hudChrome.plurals.characterCount', 7)).toBe('7 characters');
  });
});
