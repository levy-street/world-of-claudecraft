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
// The script check is one-directional by construction: kana in a Chinese value
// is detectable, but a ja_JP value holding a pure-Han Chinese rendering is not
// (Han is shared and no rule can demand kana), so the ja half of a swap is
// caught only when the zh half trips.
import { describe, expect, it } from 'vitest';
import { DEED_LOCALE_LOADERS, type DeedLocaleTable } from '../src/ui/deed_i18n';
import { SUPPORTED_LANGUAGES } from '../src/ui/i18n.resolved.generated/loaders';
import {
  ARENA_EXTRA,
  BG_EXTRA,
  DICT,
  ITEM_EXTRA,
  QUEST_EXTRA,
  RAID_EXTRA,
} from '../src/ui/sim_i18n';

// Both locale sets DERIVE from the live registries (the generated loaders and
// the deed loader table), never a hand-kept list: a new locale joins the scan
// the day it ships, instead of quietly staying outside it. en_XA sits in the
// exclusion set defensively for the day the pseudo-locale joins a registry.
const ENGLISH = new Set(['en', 'en_CA', 'en_XA']);
const OVERLAY_LOCALES = SUPPORTED_LANGUAGES.filter((l) => !ENGLISH.has(l));
const DEED_LOCALES = Object.keys(DEED_LOCALE_LOADERS).filter((l) => !ENGLISH.has(l));

// Derivation canaries: every assertion below ends in toEqual([]), which passes
// on zero comparisons, so a registry change that empties a derived list would
// turn the whole guard into a silent no-op. Pin the floors near the real
// counts (20 overlays, 18 deed chunks today).
it('the derived locale sets cover the shipped registries', () => {
  expect(OVERLAY_LOCALES.length).toBeGreaterThan(15);
  expect(DEED_LOCALES.length).toBeGreaterThan(15);
});

// The scrubbed coins a translated value must never carry verbatim (substring,
// case-sensitive, so fused loanwords like 'Wyrmcultus' still hit). This is the
// PHASE 03 coined-token arm set (single generic words the audit KEPT, e.g.
// Sergeant and Highwatch, are deliberately absent); the earlier rename
// tracks' coins stay with ip_scrub's own English-surface scan. The RULES
// regex sources in sim_i18n (the deliberate deploy-window aliases, e.g. the
// Varric line) are code, not DICT values, so arming 'Varric' here cannot
// self-trip.
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
  'Holy Shock',
  'Swiftmend',
  'Nightkin',
  'Varric',
  'Okku',
  'Moonwell',
  'Cryptbloom',
  'Mistforged',
  // Transliterated coins: the Latin arms above cannot see a translator-minted
  // rendering of an old coin. The v0.36.0 wiki-refresh fills reintroduced
  // Gallowmere through fresh ja/ko/ru transliterations that no Latin substring
  // hits (found by release-merge audit, not by this guard); arm the renderings
  // themselves so a future release fill cannot bring them back. The ru arm is
  // the stem, so inflected forms still hit.
  'ガロウミア',
  '갈로미어',
  'Гэллоумир',
] as const;

// Values a coin legitimately appears in: native vocabulary that only spells
// like a coin. Each entry names the locale, a key substring, and the token it
// excuses, so a new leak elsewhere still fails. Currently EMPTY: no shipped
// value needs an excuse, and a future entry must argue its way in.
const KEEPS: readonly { locale: string; keyIncludes: string; token: string }[] = [];

type Hit = { locale: string; key: string; token: string; value: string };

function scanValues(locale: string, entries: Iterable<[string, unknown]>, hits: Hit[]): number {
  let scanned = 0;
  for (const [key, raw] of entries) {
    if (typeof raw !== 'string') continue;
    scanned++;
    for (const token of OLD_COINS) {
      if (!raw.includes(token)) continue;
      const kept = KEEPS.some(
        (k) => k.locale === locale && key.includes(k.keyIncludes) && k.token === token,
      );
      if (!kept) hits.push({ locale, key, token, value: raw });
    }
  }
  return scanned;
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
    let scanned = 0;
    for (const locale of OVERLAY_LOCALES) {
      const mod = await import(`../src/ui/i18n.locales/${locale}.ts`);
      const table = mod[locale] as Record<string, string>;
      expect(table, `${locale} overlay export`).toBeTruthy();
      scanned += scanValues(locale, Object.entries(table), hits);
    }
    // No-op canary: a sparse overlay still carries thousands of rows.
    expect(scanned).toBeGreaterThan(10_000);
    expect(hits, JSON.stringify(hits.slice(0, 10), null, 2)).toEqual([]);
  });

  it('deed_i18n.locales values', async () => {
    const hits: Hit[] = [];
    let scanned = 0;
    for (const locale of DEED_LOCALES) {
      const mod = await import(`../src/ui/deed_i18n.locales/${locale}.ts`);
      const table = mod.table as DeedLocaleTable;
      expect(table, `${locale} deed locale export`).toBeTruthy();
      scanned += scanValues(locale, deedEntries(table), hits);
    }
    expect(scanned).toBeGreaterThan(5_000);
    expect(hits, JSON.stringify(hits.slice(0, 10), null, 2)).toEqual([]);
  });

  it('sim_i18n DICT and EXTRA table values', () => {
    const hits: Hit[] = [];
    let scanned = 0;
    for (const [lang, table] of Object.entries(DICT)) {
      if (ENGLISH.has(lang)) continue;
      scanned += scanValues(`DICT.${lang}`, Object.entries(table), hits);
    }
    for (const [name, extra] of Object.entries({
      ARENA_EXTRA,
      BG_EXTRA,
      QUEST_EXTRA,
      ITEM_EXTRA,
      RAID_EXTRA,
    })) {
      for (const [lang, table] of Object.entries(extra)) {
        if (ENGLISH.has(lang)) continue;
        scanned += scanValues(`${name}.${lang}`, Object.entries(table), hits);
      }
    }
    expect(scanned).toBeGreaterThan(5_000);
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

const NON_LATIN = new Set(['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU']);
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
  // The reverse case: a CJK value pasted into a Latin-script locale. Derived
  // from the live overlay set so a new Latin locale is covered on arrival.
  ...OVERLAY_LOCALES.filter((l) => !NON_LATIN.has(l)).flatMap((locale) => [
    { locale, banned: KANA, name: 'kana' },
    { locale, banned: HANGUL, name: 'hangul' },
    { locale, banned: HAN, name: 'han' },
  ]),
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
      // Variant locales (es_ES, fr_CA) resolve deeds through their base
      // chunk, so only the locales the deed loader table names have a file.
      if (DEED_LOCALES.includes(rule.locale)) {
        const deed = await import(`../src/ui/deed_i18n.locales/${rule.locale}.ts`);
        const deedTable = deed.table as DeedLocaleTable;
        for (const [key, value] of deedEntries(deedTable)) {
          if (typeof value === 'string' && rule.banned.test(value)) {
            hits.push({ locale: `deed.${rule.locale}`, key, token: rule.name, value });
          }
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
      ['RAID_EXTRA', RAID_EXTRA as unknown as Record<string, Record<string, string>>],
    ];
    for (const rule of SCRIPT_RULES) {
      for (const [name, byLang] of tables) {
        const table = byLang[rule.locale];
        // A missing per-language table is a scan hole, never a skip: the
        // frostbite-swap arm lives exactly here, so a silently absent locale
        // key would neuter the rule that catches it.
        expect(table, `${name} has no ${rule.locale} table`).toBeTruthy();
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
