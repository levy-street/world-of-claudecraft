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
import { SUPPORTED_LANGUAGES as ADMIN_SUPPORTED_LANGUAGES } from '../src/admin/i18n.resolved.generated/loaders';
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
// The ADMIN overlays are a fourth non-English corpus, and until Phase 18 the only
// one this guard never looked at. Operators are users (root CLAUDE.md), so an
// admin overlay is player-facing surface in the sense that matters here: the
// Wyrmcult derivative leak reached six of these files and nothing saw it.
const ADMIN_LOCALES = ADMIN_SUPPORTED_LANGUAGES.filter((l) => !ENGLISH.has(l));

// Derivation canaries: every assertion below ends in toEqual([]), which passes
// on zero comparisons, so a registry change that empties a derived list would
// turn the whole guard into a silent no-op. Pin the floors near the real
// counts (20 overlays, 18 deed chunks today).
it('the derived locale sets cover the shipped registries', () => {
  expect(OVERLAY_LOCALES.length).toBeGreaterThan(15);
  expect(DEED_LOCALES.length).toBeGreaterThan(15);
  expect(ADMIN_LOCALES.length).toBeGreaterThan(15);
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
  // The zh half of that same arm, which the v0.36.0 fix left unarmed. zh has
  // three ways to render a proper noun and only one is uncovered: a raw Latin
  // name is caught by the arms above (the zh overlays keep plenty of them, e.g.
  // Eastbrook), and a DESCRIPTIVE rendering cannot be armed at all because it is
  // ambiguous with the replacement name (zh spells both Gallowmere and its
  // successor Gibbetmere as 绞湖镇, which is why the v0.36.0 fix correctly left
  // both zh rows alone). That leaves the PHONETIC rendering, the exact shape the
  // ja/ko/ru fills minted, and these are its standard simplified and traditional
  // forms. Prospective by nature: no zh row carries one today, and the point is
  // that a future fill cannot introduce one unseen.
  '加洛米尔',
  '盖洛米尔',
  '加洛米爾',
  '蓋洛米爾',
] as const;

// Localized DERIVATIVES: a value that translates a scrubbed coin while keeping
// the coin's own morphemes. The literal denylist above cannot see one, and
// neither can ip_scrub's English-surface scan or the originality_renames literal
// pins, so this class survived every shipped guard on BOTH merge parents: five
// Latin game overlays translated 'Wyrmcult Zealot' as Wyrmkult-Eiferer / Zelote
// du Culte du Wyrm / Culto del Wyrm and six admin overlays did the same to the
// Thornpeak tents POI. All 21 rows were deleted rather than re-translated (the
// English they translated is long gone: the labels now read "Orders from Below",
// "Ritual Phylactery" and "Broodsworn Tents"), so the fill re-makes them against
// live English.
//
// Scoped to Latin script and to morpheme-keeping renderings on purpose. A locale
// that translates the IDEA into its own vocabulary (da_DK "Ormekult", sv_SE
// "Lindormskult", pl_PL "Kult Zmija", zh "龙教") is not carrying the coin, and a
// pattern loose enough to catch those would fire on any legitimate dragon-cult
// phrasing the replacement name earns.
const DERIVATIVES: readonly { coin: string; re: RegExp; note: string }[] = [
  {
    coin: 'Wyrmcult',
    // wyrm/wurm beside a cult stem, either order, across the Romance articles.
    re: /(w[yu]rm[a-zà-ÿ]{0,3}[ -]?(?:k|c)ult|(?:k|c)ult[a-zà-ÿ]{0,3}\s+(?:de[lu]s?\s+|du\s+|do\s+|des\s+)?w[yu]rm)/i,
    note: 'Wyrmkult-Eiferer, Zelote du Culte du Wyrm, Wurmcultus-Tenten',
  },
];

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

  it('admin i18n.locales overlay values', async () => {
    const hits: Hit[] = [];
    let scanned = 0;
    for (const locale of ADMIN_LOCALES) {
      const mod = await import(`../src/admin/i18n.locales/${locale}.ts`);
      const table = mod[locale] as Record<string, string>;
      expect(table, `${locale} admin overlay export`).toBeTruthy();
      scanned += scanValues(`admin.${locale}`, Object.entries(table), hits);
    }
    expect(scanned).toBeGreaterThan(3_000);
    expect(hits, JSON.stringify(hits.slice(0, 10), null, 2)).toEqual([]);
  });
});

// The derivative pass. Same corpora, but asking whether a value TRANSLATED a coin
// rather than kept it: the class that survived every shipped guard because none of
// them reads a non-English value for anything but a literal English token.
describe('non-English surfaces carry no localized coin derivative', () => {
  async function overlayEntries(): Promise<[string, [string, unknown][]][]> {
    const out: [string, [string, unknown][]][] = [];
    for (const locale of OVERLAY_LOCALES) {
      const mod = await import(`../src/ui/i18n.locales/${locale}.ts`);
      out.push([locale, Object.entries(mod[locale] as Record<string, string>)]);
    }
    for (const locale of ADMIN_LOCALES) {
      const mod = await import(`../src/admin/i18n.locales/${locale}.ts`);
      out.push([`admin.${locale}`, Object.entries(mod[locale] as Record<string, string>)]);
    }
    for (const locale of DEED_LOCALES) {
      const mod = await import(`../src/ui/deed_i18n.locales/${locale}.ts`);
      out.push([`deed.${locale}`, deedEntries(mod.table as DeedLocaleTable)]);
    }
    return out;
  }

  it('arms a derivative pattern per coin it covers', () => {
    // Non-vacuity for the pattern list itself, and a self-check that each pattern
    // really bites: an inert regex would make the whole pass a silent no-op.
    expect(DERIVATIVES.length).toBeGreaterThan(0);
    for (const d of DERIVATIVES) {
      expect(d.note.length, `${d.coin} needs example derivatives`).toBeGreaterThan(10);
      const examples = d.note.split(', ');
      expect(examples.length, `${d.coin} needs more than one example`).toBeGreaterThan(1);
      for (const ex of examples)
        expect(d.re.test(ex), `${d.coin} pattern must match ${ex}`).toBe(true);
    }
  });

  it('no overlay, admin overlay or deed chunk value translates a scrubbed coin', async () => {
    const hits: Hit[] = [];
    let scanned = 0;
    for (const [locale, entries] of await overlayEntries()) {
      for (const [key, raw] of entries) {
        if (typeof raw !== 'string') continue;
        scanned++;
        for (const d of DERIVATIVES) {
          const m = d.re.exec(raw);
          if (m) hits.push({ locale, key, token: `${d.coin} -> ${m[0]}`, value: raw });
        }
      }
    }
    // Floor near the real corpus (game + admin + deeds), so an import that
    // silently returns nothing cannot pass this on zero comparisons.
    expect(scanned).toBeGreaterThan(20_000);
    expect(hits, JSON.stringify(hits.slice(0, 10), null, 2)).toEqual([]);
  });

  it('the pattern does not fire on a locale that translated the IDEA', () => {
    // The scoping decision, pinned: these are real shipped renderings of the same
    // concept in the locale's own vocabulary, and they are NOT the leak. A future
    // pattern loosened until one of these trips has stopped being a coin guard.
    for (const ok of [
      'Ormekult-Zelot draebt', // da_DK
      'Lindormskultsivrare draept', // sv_SE
      'Zabity zelota Kultu Zmija', // pl_PL
      'Ejdertarikati Bagnazi olduruldu', // tr_TR
      'Fanatik kultu draka zabit', // cs_CZ
      'Da ha Cuong Tin Long Giao', // vi_VN
    ]) {
      for (const d of DERIVATIVES) {
        expect(d.re.test(ok), `${d.coin} pattern must not fire on ${ok}`).toBe(false);
      }
    }
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
