import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error - shared zero-dep JS tool (no .d.ts); same pattern as tests/i18n_fill_worklist.test.ts.
import { expandGlossaryTerms, patternToRegExp } from '../scripts/i18n_fill_worklist.mjs';
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
  it('non-Latin player surfaces ship no untranslated English', () => {
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
      'hudChrome.epic.title', // "Epic" - brand
      'hudChrome.discord.panelTitle', // "World of ClaudeCraft" - brand
      'hudChrome.discord.linkedTitle', // "Discord: {name}" - brand + player name
      'hudChrome.keybinds.discord', // "Discord" - brand (Key Bindings action label)
      'hudChrome.claudium.title', // "Claudium" - in-game currency brand
      'hudChrome.claudium.balanceUnit', // "{amount} Claudium" - currency brand
      'hudChrome.claudium.storeCost', // "{amount} Claudium" - currency brand
      'guide.controls.discord', // "Discord" - brand (Guide controls-page action label)
      'guide.glossary.claudiumTerm', // "Claudium" - the same currency brand as hudChrome.claudium.*
      'desktop.crash.title', // "World of ClaudeCraft" - brand (desktop crash dialog title)
      'auth.emailPlaceholder', // "you@example.com" - RFC 2606 example address, kept verbatim
      // The 16 abilityUi.cast.rift_* entries that sat here were a DEAD exemption:
      // every one carries a real fill in all five non-Latin locales, so the guard
      // never exercised them, and while they stayed a future fill regressing one
      // to English would have passed silently. Removed at the Masterwrought Phase
      // 19F review round (ruling qr-19-rift-mechanic-names-translate-or-not,
      // option 1: rift names are translated everywhere, cast ids included).
    ]);
    const wordy = (v: string) => /[a-z]{4,}/.test(v.replace(/\{[^}]*\}/g, ''));
    // The sixteen rift cast ids that left the allow list above are reached by
    // this guard and are wordy, so the removal stays load-bearing: rename or
    // restructure them and this line says so.
    const riftCasts = Object.keys(enFlat).filter((k) => /^abilityUi\.cast\.rift_/.test(k));
    expect(riftCasts.length, 'the rift cast ids are in the main catalog').toBe(16);
    // Fifteen of the sixteen are wordy today ('Void Rift' is not); the floor
    // keeps the guard's reach over them load-bearing without pinning the English.
    expect(
      riftCasts.filter((k) => wordy(enFlat[k])).length,
      'wordy rift cast ids',
    ).toBeGreaterThanOrEqual(12);
    // The command center is enabled only in Vite development builds and cannot reach
    // a player-facing production surface. Keep its contributor-owned catalog
    // English-only, like other developer tooling, while release localization remains
    // strict for every namespace that ships to players.
    const isDevelopmentOnly = (key: string) => key.startsWith('devCommand.');
    const nonLatin: SupportedLanguage[] = ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'];
    const leaks: string[] = [];
    for (const lang of nonLatin) {
      const flat = flatten(TABLES[lang]);
      for (const [key, enValue] of Object.entries(enFlat)) {
        if (
          wordy(enValue) &&
          flat[key] === enValue &&
          !BRAND_ALLOW.has(key) &&
          !isDevelopmentOnly(key)
        ) {
          leaks.push(`${lang} ${key}: "${enValue}"`);
        }
      }
    }
    expect(
      leaks,
      `untranslated English leaked into non-Latin player surfaces:\n${leaks.join('\n')}`,
    ).toEqual([]);
  });

  it('keeps every localized marker accessibility meaning pinned per locale', () => {
    // Two merges wrote this table. This branch re-derived every row on 2026-08-30
    // at the merge of release/v0.41.0 (tip 3e801dc925), where both parents had
    // added marker keys and the merged digest matched neither parent; the release
    // side then re-derived thirteen of the rows at v0.42.0, where it filled the
    // two boss marker labels (mapMarkerLabels.bossEnemy and .bossAggressiveEnemy)
    // in the Latin overlays. Both facts hold in the merged tree: the row SET is
    // this branch's (the extra hud.core.mapMarkerLabels.farmPatch row the release
    // never had), and thirteen of the row VALUES are the release's new fills, so
    // those thirteen digests belong to neither parent.
    // RE-DERIVED over the merged tree on 2026-08-31, at the v0.42.0 sync (ours
    // 2ab5c2f7d0, theirs 22e909839f, base e6b8edb375). Every row below was read
    // out of this assertion's own derivation, run over freshly regenerated
    // resolved tables (`node scripts/i18n_build.mjs`, confirmed idempotent: a
    // second run left every emitted slice byte-identical), never hand-computed
    // and never copied from a parent.
    //
    // WHICH rows moved, and why, derived rather than assumed. The release filled
    // the two boss marker labels (mapMarkerLabels.bossEnemy and
    // .bossAggressiveEnemy) in TWELVE overlays under src/ui/i18n.locales/: de_DE,
    // fr_FR, it_IT, pt_BR, cs_CZ, nl_NL, pl_PL, id_ID, tr_TR, sv_SE, vi_VN,
    // da_DK. fr_CA adds a thirteenth moved digest without an overlay edit of its
    // own: it resolves through fr_FR, so its rows follow that fill. The other
    // seven (es, es_ES, zh_CN, zh_TW, ko_KR, ja_JP, ru_RU) got no boss fill from
    // either parent, so they still read this branch's v0.41.0 values, and their
    // digests below are unchanged from that re-derivation.
    // This branch contributed no marker-row edit at this merge, so the thirteen
    // moved digests are the release's fill measured through THIS branch's row
    // set: they match neither parent's literal.
    //
    // Digests stay PINNED literals, not computed at test time: the whole point of
    // the row is to red on an unintended change to a marker's accessibility
    // meaning, and a digest recomputed from the same table it is compared against
    // would assert nothing. Re-derivation recipe, unchanged: regenerate the
    // resolved tables (`npm run i18n:gen`), run this file, and re-pin each locale
    // from the reported digest, which is sha256 over JSON.stringify of the
    // hud.core.mapMarker rows in table order, exactly as the assertion below
    // computes them.
    const expected = {
      es: '71280fba077d6d0e9fdb251edd2a9c90b22e76e6d72b7f072759529e5cbc7de3',
      es_ES: '71280fba077d6d0e9fdb251edd2a9c90b22e76e6d72b7f072759529e5cbc7de3',
      fr_FR: '7011bb7f227cdec0e53df1c6f22b0e4067f6a4bbf904e16c11ec24baadb85a97',
      fr_CA: '7011bb7f227cdec0e53df1c6f22b0e4067f6a4bbf904e16c11ec24baadb85a97',
      it_IT: '1417bf6d753bfff5a8b221602981143fce47be9b8fbdd666386b17e654796863',
      de_DE: '060fc7fd120253737179daf3258a622caf665200028ad509103588cf79fba6e5',
      zh_CN: '88655d9dcd570ef3031925e758bd28f9480d378e6e074b7c30bc4e1e4fad73bc',
      zh_TW: 'd013561d91c7bd77ee5f7c309bd39e147e4e67a45b4982faf4f9975396ba0865',
      ko_KR: 'd35b9d6cb07a9394455c31e2cf465c74888e2bf86463098d6ce09fbe64d63bb6',
      ja_JP: 'aaad77f83c6acd5bd443c654cf4930f565e31deca0f1e0f8eba460c9686fe065',
      pt_BR: '3f8e5a1774351140940464f317eecb089fe2bef0e4154661dda232a91f18e7ca',
      ru_RU: '869bb35098d22e182aa7c693786f69148769fc6c93228a2b959a9b2b719d6794',
      cs_CZ: '17fd408e52c09a8d06a9f90635afdcd8de2f935622a0582125c89ea810188dcd',
      nl_NL: 'a911f15718c1bf47701e1e01e6b5467b37bbab274359dbcd42ddd85114a19dfa',
      pl_PL: '76217062945651b618324148f8d891e7a84d9ec030efaf02b2b4ac4537ad756a',
      id_ID: '3ea89d7c84cf648f0f2e3076388f635cbccfdb32195b7452fb32386c59010d43',
      tr_TR: '41b00dec2daf97f66c97550735027f0ed98d9fda39cc36a6fd7fde5ac4dee98f',
      sv_SE: '883f417a069dce0068b7c733f0bfd7b3e34d405e4c6440dcc9d6a6f324f194e6',
      vi_VN: 'a6292828742e853efcb1fd7c2ac17f558991316ac90916ebfd162ed11db4fcce',
      da_DK: '9e0db1b8079913f713ba0322593e405b33d002d8044e292ca423f0eea0da7ffa',
    } as const satisfies Partial<Record<SupportedLanguage, string>>;

    for (const [lang, digest] of Object.entries(expected) as Array<
      [keyof typeof expected, string]
    >) {
      const markerRows = Object.entries(flatten(TABLES[lang])).filter(([key]) =>
        key.startsWith('hud.core.mapMarker'),
      );
      // 100 at this merge's shared base (which already carries the release's two)
      // plus this branch's own mapMarkerLabels.farmPatch row. The release side
      // added no marker key at v0.42.0, only VALUES for two it already had, so
      // the count did not move; re-measured at 101 for all twenty locales over
      // the merged tree on 2026-08-31.
      expect(markerRows).toHaveLength(101);
      expect(createHash('sha256').update(JSON.stringify(markerRows)).digest('hex'), lang).toBe(
        digest,
      );
    }
  });

  // Phase 11 glossary decision (scripts/i18n_glossary.json, the reliquaryShelves
  // row): the three shelf names must read the same on both surfaces that name
  // them, the in-game window rail and the wiki Reliquary page, and Professions is
  // additionally locked to the professions window title so one client never calls
  // the same shelf two things. English alignment is trivially true; the drift risk
  // is a translator filling one surface and not the other, so this sweeps EVERY
  // supported locale.
  it('names the three Reliquary shelves identically in the window and the wiki', () => {
    const navProfessions = 'hudChrome.reliquary.navProfessions';
    const professionsTitle = 'hudChrome.professions.title';
    const drift: string[] = [];
    for (const lang of supportedLanguages) {
      const flat = flatten(TABLES[lang]);
      for (const shelf of ['conquerors', 'professions', 'horizons'] as const) {
        const nav = `hudChrome.reliquary.nav${shelf[0].toUpperCase()}${shelf.slice(1)}`;
        const wiki = `guide.reliquaryPage.shelf.${shelf}`;
        // Both keys must EXIST: a renamed key would otherwise compare
        // undefined to undefined and pass.
        if (typeof flat[nav] !== 'string') drift.push(`${lang} missing ${nav}`);
        if (typeof flat[wiki] !== 'string') drift.push(`${lang} missing ${wiki}`);
        if (flat[nav] !== flat[wiki]) {
          drift.push(`${lang} ${shelf}: window "${flat[nav]}" vs wiki "${flat[wiki]}"`);
        }
      }
      // The canonical anchor: the Professions shelf IS the Professions window.
      // The Latin locales are release fill, so their shelf keys still render the
      // English source; the anchor binds for a locale once that fill lands (and
      // the release-tier gate is what forces it to land at all).
      const shelfFilled = lang === 'en' || flat[navProfessions] !== enFlat[navProfessions];
      if (shelfFilled && flat[navProfessions] !== flat[professionsTitle]) {
        drift.push(
          `${lang} professions: shelf "${flat[navProfessions]}" vs window title "${flat[professionsTitle]}"`,
        );
      }
    }
    expect(drift, drift.join('\n')).toEqual([]);

    // Floor: the five non-Latin locales shipped the aligned fill in Phase 11, so
    // the anchor above must actually have bound for each of them. Without this,
    // dropping a shelf fill back to English would make the anchor skip silently.
    for (const lang of ['ja_JP', 'ko_KR', 'ru_RU', 'zh_CN', 'zh_TW'] as SupportedLanguage[]) {
      const flat = flatten(TABLES[lang]);
      expect(flat[navProfessions], `${lang} shelf fill`).not.toBe(enFlat[navProfessions]);
      expect(flat[navProfessions], `${lang} professions anchor`).toBe(flat[professionsTitle]);
    }
  });

  it('names The Reliquary with one term per non-Latin locale on every surface', () => {
    // English legitimately varies the article by surface ('The Reliquary'
    // window title vs the compact 'Reliquary' sheet label), but the five
    // non-Latin locales have no article distinction: one term is the contract
    // (glossary reliquaryName). ko shipped split between the compact CJK
    // cognate and a descriptive long form until the v0.35.0 cycle unified it,
    // which is the drift class this guard now reds on. The two sentence
    // surfaces (the loading tip, the wiki body) must embed the same term.
    const exactKeys = [
      'hudChrome.reliquary.title',
      'hudChrome.mobile.reliquary',
      'hudChrome.reliquary.charCompletionLabel',
      'hudChrome.reliquary.charOpen',
      'guide.nav.reliquary',
      'guide.controls.reliquary',
    ];
    const drift: string[] = [];
    for (const lang of ['ja_JP', 'ko_KR', 'ru_RU', 'zh_CN', 'zh_TW'] as SupportedLanguage[]) {
      const flat = flatten(TABLES[lang]);
      const term = flat['hudChrome.reliquary.title'];
      // Anchor must be a real fill, or every equality below is vacuous.
      expect(typeof term, `${lang} title fill`).toBe('string');
      expect(term, `${lang} title fill is not English`).not.toBe(
        enFlat['hudChrome.reliquary.title'],
      );
      for (const key of exactKeys) {
        if (typeof flat[key] !== 'string') drift.push(`${lang} missing ${key}`);
        else if (flat[key] !== term) drift.push(`${lang} ${key}: "${flat[key]}" vs "${term}"`);
      }
      for (const key of ['loading.tips.reliquary', 'guide.reliquaryPage.intro']) {
        if (typeof flat[key] !== 'string') drift.push(`${lang} missing ${key}`);
        else if (!flat[key].includes(term)) drift.push(`${lang} ${key} does not embed "${term}"`);
      }
    }
    expect(drift, drift.join('\n')).toEqual([]);
  });

  it('every shipped glossary keyPattern resolves to at least one live English key', () => {
    // The glossary is the one mechanism that carries locked terminology into
    // the release-fill worklist batches; a typoed keyPatterns row would
    // silently drop its term from every batch. The worklist suite exercises
    // expandGlossaryTerms against a synthetic object only, so this is the pin
    // over the SHIPPED file.
    const glossary = JSON.parse(
      readFileSync(new URL('../scripts/i18n_glossary.json', import.meta.url), 'utf8'),
    );
    const enKeys = Object.keys(enFlat).sort();
    const categories = Object.keys(glossary.categories ?? {});
    expect(categories.length, 'the glossary category set is empty').toBeGreaterThan(5);
    for (const category of categories) {
      const patterns: string[] = glossary.categories[category].keyPatterns ?? [];
      expect(patterns.length, `${category} has no keyPatterns`).toBeGreaterThan(0);
      for (const pat of patterns) {
        const re = patternToRegExp(pat);
        expect(
          enKeys.some((k) => re.test(k)),
          `glossary ${category} pattern "${pat}" matches no live key`,
        ).toBe(true);
      }
    }
    // The expander end-to-end over the shipped file: every category expands.
    const terms = expandGlossaryTerms(glossary, enKeys);
    for (const category of categories) {
      expect(
        terms.some((t: { category: string }) => t.category === category),
        `glossary ${category} expands to zero terms`,
      ).toBe(true);
    }
  });

  // The loading-tips rotation renders through a bare t(key) with NO values, so a
  // tip that spells out a chord goes stale the moment a player rebinds it (and
  // there is no seam to interpolate the live bind). Sweep the whole en tip set,
  // not just the one tip that used to name Shift+X.
  it('names no keybind chord in any loading tip, in any locale', () => {
    // The rationale is locale-independent: the rotation renders a bare t(key)
    // with no interpolation seam, so a chord spelled out in ANY locale's fill
    // (including a future release fill) goes stale the moment a player
    // rebinds. Sweep every locale table, not just English, and match localized
    // modifier spellings plus the full-width plus sign alongside the Latin set.
    const enTips = Object.entries(enFlat).filter(([key]) => key.startsWith('loading.tips.'));
    expect(enTips.length, 'the loading tips rotation is empty').toBeGreaterThan(5);
    const chord =
      /(Shift|Ctrl|Strg|Alt|Cmd|Meta|Umschalt|シフト|コントロール|시프트|컨트롤|Шифт)\s*[+＋]/;
    expect(chord.test('press Shift+X'), 'the chord guard itself must trip').toBe(true);
    expect(chord.test('press Cmd + B'), 'the spaced macOS form must trip too').toBe(true);
    expect(chord.test('シフト＋X を押す'), 'the CJK full-width form must trip too').toBe(true);
    const named: string[] = [];
    for (const lang of supportedLanguages) {
      const flat = flatten(TABLES[lang]);
      for (const [key, value] of Object.entries(flat)) {
        if (!key.startsWith('loading.tips.')) continue;
        if (chord.test(value)) named.push(`${lang} ${key}`);
      }
    }
    expect(
      named,
      `loading tips must not name a live keybind (no interpolation seam): ${named.join(', ')}`,
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
      'buffsHidden',
      'characterCount',
      // The commission board's crafter's-record counts (Masterwrought phase
      // 14, the quality signal).
      'commissionLegendaries',
      'commissionMasterworks',
      'deedsRetroSummary',
      'finderPartySize',
      'guildMembers',
      'playersMatching',
      'playersOnline',
      'playtimeDays',
      'playtimeHours',
      'playtimeMinutes',
      'reliquaryCellOwnedClearsObtainedAria',
      'reliquaryCellOwnedObtainedAria',
      'reliquaryObtainedTimes',
      'reliquaryRetroSummary',
      'reliquarySearchResults',
      'reliquaryToGo',
      'secondsRemaining',
      'wocMarketSellChoose',
      'wocTradeIneligible',
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

  // The on-join catch-up summaries (hud.ts handleReliquaryUnlocks /
  // handleDeedUnlocks) used to be flat keys with a hardcoded plural, so a
  // single back-credited relic or deed read "1 relics catalogued" / "1 deeds
  // recorded". Both sentences are pinned whole at count 1 and count 5 so a
  // dropped `one` leaf, or a leaf reworded back to the plural noun, fails here.
  it('tPlural renders singular retro catch-up summaries at count 1 (both sibling bases)', () => {
    setLanguage('en');
    expect(tPlural('hudChrome.plurals.reliquaryRetroSummary', 1)).toBe(
      'Your reliquary catches up: 1 relic catalogued.',
    );
    expect(tPlural('hudChrome.plurals.reliquaryRetroSummary', 5)).toBe(
      'Your reliquary catches up: 5 relics catalogued.',
    );
    expect(tPlural('hudChrome.plurals.deedsRetroSummary', 1)).toBe(
      'Your chronicle catches up: 1 deed recorded.',
    );
    expect(tPlural('hudChrome.plurals.deedsRetroSummary', 5)).toBe(
      'Your chronicle catches up: 5 deeds recorded.',
    );
  });
});
