// Non-English surfaces of the phase 03 IP scrub. tests/ip_scrub.test.ts scans
// sim content plus the resolved ENGLISH table, and tests/originality_renames.test.ts
// pins English literals, so neither can see a scrubbed coin surviving inside a
// TRANSLATED value or a value filed under the wrong locale. Both escapes shipped
// during phase 03 QA: four Latin overlay rows still carried 'Wyrmcult' verbatim
// (id_ID x3, nl_NL's fused 'Wyrmcultus'), and the zh_TW/ja_JP sim matcher rows
// for aura.frostbite held each other's rendering (kana in a Chinese block).
// This guard closes both classes over the importable non-English value sets:
// the i18n.locales overlays, the deed_i18n.locales chunks, and sim_i18n's DICT
// plus its EXTRA tables. talent_i18n's in-file dictionaries are not exported
// per locale and stay covered by the release-fill obligation review instead.
import { describe, expect, it } from 'vitest';
import { DEED_LOCALE_LOADERS, type DeedLocaleTable } from '../src/ui/deed_i18n';
import { SUPPORTED_LANGUAGES } from '../src/ui/i18n.resolved.generated/loaders';
import { ARENA_EXTRA, BG_EXTRA, DICT, ITEM_EXTRA, QUEST_EXTRA } from '../src/ui/sim_i18n';

// Both locale sets DERIVE from the live registries (the generated loaders and
// the deed loader table), never a hand-kept list: a new locale joins the scan
// the day it ships, instead of quietly staying outside it.
const ENGLISH = new Set(['en', 'en_CA', 'en_XA']);
const OVERLAY_LOCALES = SUPPORTED_LANGUAGES.filter((l) => !ENGLISH.has(l));
const DEED_LOCALES = Object.keys(DEED_LOCALE_LOADERS).filter((l) => !ENGLISH.has(l));

// The scrubbed coins a translated value must never carry verbatim (substring,
// case-sensitive, so fused loanwords like 'Wyrmcultus' still hit). Single
// generic words the audit KEPT (Sergeant, Highwatch, ...) are deliberately
// absent; this list is the coined-token subset of the ip_scrub arming lists.
const OLD_COINS = [
  'Wyrmcult',
  'Gallowmere',
  'Eldergleam',
  'Gloomshade',
  'Frostmane',
  'Terrorspark',
  'Winterbite',
  'Wrathwing',
  'Flickerstep',
  'Hellsteel',
  'Smokestep',
  'Spellbreak',
  'Spiritmend',
  'Sanctum Sprint',
  'Knight-Lieutenant',
  'Spellsteal',
  'Harvest Sprite',
  'Hellfire Ring',
  'Hellfire Citadel',
  'Crusader Strike',
  'Heroic Leap',
  'Holy Nova',
  'Icy Veins',
  'Victory Rush',
  'Wyvern Sting',
  'Glacial Spike',
  'Frozen Orb',
  'Storm Bolt',
  'Nightkin Stargazer',
  'Cryptbloom',
  'Mistforged',
] as const;

// Values a coin legitimately appears in: native vocabulary that only spells
// like a coin. Each entry names the locale, a key substring, and the token it
// excuses, so a new leak elsewhere still fails.
const KEEPS: readonly { locale: string; keyIncludes: string; token: string }[] = [];

type Hit = { locale: string; key: string; token: string; value: string };

function scanValues(locale: string, entries: Iterable<[string, unknown]>, hits: Hit[]): void {
  for (const [key, raw] of entries) {
    if (typeof raw !== 'string') continue;
    for (const token of OLD_COINS) {
      if (!raw.includes(token)) continue;
      const kept = KEEPS.some(
        (k) => k.locale === locale && key.includes(k.keyIncludes) && k.token === token,
      );
      if (!kept) hits.push({ locale, key, token, value: raw });
    }
  }
}

function deedEntries(table: DeedLocaleTable): [string, unknown][] {
  const out: [string, unknown][] = [];
  for (const [deedId, row] of Object.entries(table)) {
    for (const [field, value] of Object.entries(row as Record<string, unknown>)) {
      out.push([`${deedId}.${field}`, value]);
    }
  }
  return out;
}

describe('non-English surfaces carry no scrubbed coin', () => {
  it('i18n.locales overlay values', async () => {
    const hits: Hit[] = [];
    for (const locale of OVERLAY_LOCALES) {
      const mod = await import(`../src/ui/i18n.locales/${locale}.ts`);
      const table = mod[locale] as Record<string, string>;
      expect(table, `${locale} overlay export`).toBeTruthy();
      scanValues(locale, Object.entries(table), hits);
    }
    expect(hits, JSON.stringify(hits.slice(0, 10), null, 2)).toEqual([]);
  });

  it('deed_i18n.locales values', async () => {
    const hits: Hit[] = [];
    for (const locale of DEED_LOCALES) {
      const mod = await import(`../src/ui/deed_i18n.locales/${locale}.ts`);
      const table = mod.table as DeedLocaleTable;
      expect(table, `${locale} deed locale export`).toBeTruthy();
      scanValues(locale, deedEntries(table), hits);
    }
    expect(hits, JSON.stringify(hits.slice(0, 10), null, 2)).toEqual([]);
  });

  it('sim_i18n DICT and EXTRA table values', () => {
    const hits: Hit[] = [];
    for (const [lang, table] of Object.entries(DICT)) {
      if (lang === 'en' || lang === 'en_CA' || lang === 'en_XA') continue;
      scanValues(`DICT.${lang}`, Object.entries(table), hits);
    }
    for (const [name, extra] of Object.entries({
      ARENA_EXTRA,
      BG_EXTRA,
      QUEST_EXTRA,
      ITEM_EXTRA,
    })) {
      for (const [lang, table] of Object.entries(extra)) {
        if (lang === 'en' || lang === 'en_CA' || lang === 'en_XA') continue;
        scanValues(`${name}.${lang}`, Object.entries(table), hits);
      }
    }
    expect(hits, JSON.stringify(hits.slice(0, 10), null, 2)).toEqual([]);
  });
});

// A value filed under the wrong locale is invisible to every count-based gate
// (the row is present and translated), so pin script sanity per non-Latin
// locale: kana is Japanese-only, hangul is Korean-only, and the Cyrillic
// locale carries no CJK at all. Han characters are shared by zh and ja and are
// asserted absent only where no legitimate value can carry them.
const KANA = /[぀-ヿ]/;
const HANGUL = /[ᄀ-ᇿ가-힯]/;
const HAN = /[一-鿿]/;

const SCRIPT_RULES: readonly { locale: string; banned: RegExp; name: string }[] = [
  { locale: 'zh_CN', banned: KANA, name: 'kana' },
  { locale: 'zh_CN', banned: HANGUL, name: 'hangul' },
  { locale: 'zh_TW', banned: KANA, name: 'kana' },
  { locale: 'zh_TW', banned: HANGUL, name: 'hangul' },
  { locale: 'ja_JP', banned: HANGUL, name: 'hangul' },
  { locale: 'ko_KR', banned: KANA, name: 'kana' },
  { locale: 'ru_RU', banned: KANA, name: 'kana' },
  { locale: 'ru_RU', banned: HANGUL, name: 'hangul' },
  { locale: 'ru_RU', banned: HAN, name: 'han' },
] as const;

describe('non-Latin locale values stay in their own script', () => {
  it('i18n.locales overlays and deed chunks', async () => {
    const hits: Hit[] = [];
    for (const rule of SCRIPT_RULES) {
      const overlay = await import(`../src/ui/i18n.locales/${rule.locale}.ts`);
      const table = overlay[rule.locale] as Record<string, string>;
      for (const [key, value] of Object.entries(table)) {
        if (rule.banned.test(value)) {
          hits.push({ locale: rule.locale, key, token: rule.name, value });
        }
      }
      const deed = await import(`../src/ui/deed_i18n.locales/${rule.locale}.ts`);
      const deedTable = deed.table as DeedLocaleTable;
      for (const [key, value] of deedEntries(deedTable)) {
        if (typeof value === 'string' && rule.banned.test(value)) {
          hits.push({ locale: `deed.${rule.locale}`, key, token: rule.name, value });
        }
      }
    }
    expect(hits, JSON.stringify(hits.slice(0, 10), null, 2)).toEqual([]);
  });

  it('sim_i18n DICT and EXTRA tables', () => {
    const hits: Hit[] = [];
    const tables: [string, Record<string, Record<string, string>>][] = [
      ['DICT', DICT as unknown as Record<string, Record<string, string>>],
      ['ARENA_EXTRA', ARENA_EXTRA as unknown as Record<string, Record<string, string>>],
      ['BG_EXTRA', BG_EXTRA as unknown as Record<string, Record<string, string>>],
      ['QUEST_EXTRA', QUEST_EXTRA as unknown as Record<string, Record<string, string>>],
      ['ITEM_EXTRA', ITEM_EXTRA as unknown as Record<string, Record<string, string>>],
    ];
    for (const rule of SCRIPT_RULES) {
      for (const [name, byLang] of tables) {
        const table = byLang[rule.locale];
        if (!table) continue;
        for (const [key, value] of Object.entries(table)) {
          if (typeof value === 'string' && rule.banned.test(value)) {
            hits.push({ locale: `${name}.${rule.locale}`, key, token: rule.name, value });
          }
        }
      }
    }
    expect(hits, JSON.stringify(hits.slice(0, 10), null, 2)).toEqual([]);
  });
});
