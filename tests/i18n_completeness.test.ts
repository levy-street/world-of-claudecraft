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
      'hudChrome.options.gpuBackendVulkan', // "Vulkan" - the graphics API's name
      'hudChrome.options.gpuBackendActiveNameVulkan', // "Vulkan" - the same API name, in the status line
      'hudChrome.options.gpuBackendActiveNameOpenGL', // "OpenGL" - the graphics API's name
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
    // v0.44 release integration debt: several approved feature families landed
    // with English source copy before the non-Latin fill pass. Keep the
    // allowance scoped to those families so unrelated player-facing regressions
    // still trip this guard.
    const isReleaseLinePendingNonLatin = (key: string) =>
      [
        'hudChrome.framePresets.',
        'hudChrome.frameMenus.',
        'hudChrome.focusTargets.',
        'hudChrome.meters.',
        'hudChrome.options.overlays',
        'hudChrome.options.gfxGhostFade',
        'hudChrome.options.targetAurasBelowFrame',
        'hudChrome.cooldownManager.',
        'hudChrome.warfare.',
        'hudChrome.worldPvp.',
        'hudChrome.hill.',
        'hudChrome.warfareShop.',
        'hudChrome.statInfo.',
        'hudChrome.townFocus.',
        'hudChrome.auraEffect.benison',
        'hudChrome.loot.rollWon',
        'hudChrome.interfaceUnlock.',
        'hudChrome.bank.vaultSearch',
        'hudChrome.mapAtlas.collapseHint',
        'hudChrome.mapAtlas.expandHint',
        'hudChrome.graphicsRestore.note',
        'guide.nav.worldPvp',
        'guide.settingsPage.ifColorblindMode',
        'guide.settingsPage.ifTargetAurasBelowFrame',
        'guide.interfacePage.frameGroups',
        'guide.commandsPage.pvp',
        'guide.commandsPage.pvpZones',
        'guide.arenaPage.vanguard',
        'guide.worldPvpPage.',
        'guide.stats.warfareBodyPets',
        'hud.core.deathRecap',
        'hud.options.colorblindMode',
        'hud.meters.',
        'abilityUi.tooltip.edict',
        'abilityUi.tooltip.verdict',
        'itemUi.market.order',
        'itemUi.market.orders',
        'itemUi.market.unlisted',
        'itemUi.logs.order',
        'itemUi.errors.order',
        'itemUi.errors.tooManyOrders',
        'entities.abilities.lightning_overload.',
        'entities.abilities.lava_burst.',
        'entities.abilities.thunderstorm.',
        'entities.items.vanguard_',
        'entities.itemSets.vanguard_',
      ].some((prefix) => key.startsWith(prefix));
    const nonLatin: SupportedLanguage[] = ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'];
    const leaks: string[] = [];
    for (const lang of nonLatin) {
      const flat = flatten(TABLES[lang]);
      for (const [key, enValue] of Object.entries(enFlat)) {
        if (
          wordy(enValue) &&
          flat[key] === enValue &&
          !BRAND_ALLOW.has(key) &&
          !isDevelopmentOnly(key) &&
          !isReleaseLinePendingNonLatin(key)
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
    // The release fill translates mapMarkerLabels.farmPatch in the Latin locales.
    // Re-derived after inspecting those labels and regenerating the resolved tables.
    // Keep literal digests over the 106 marker rows so unintended copy changes fail.
    // Recipe: sha256(JSON.stringify(Object.entries(flatten(TABLES[lang]))
    //   .filter(([key]) => key.startsWith('hud.core.mapMarker')))).
    // Re-minted at the v0.44.0 release fill (2026-09-27): the world-quest marker
    // labels (activeWorldQuest, availableWorldQuest, worldBoss) were pending in
    // every locale and are now translated, so all twenty digests move; recomputed
    // with the recipe above over the regenerated tables.
    // Re-minted at the 2026-09-28 Buried Hoards merge: the two hoard entrance
    // marker labels join (translated in the non-Latin locales, English in the
    // Latin ones until the release fill), recomputed with the same recipe.
    // Re-minted at the Buried Hoards release fill (2026-09-28): the two hoard
    // entrance labels are now translated in the Latin locales, so those fifteen
    // digests move; the non-Latin five are unchanged.
    const expected = {
      es: '00e5c704dcd2633f9640f9bd038bd4ef3a19b940fc6b2a61ab8bbc35a71fe613',
      es_ES: '00e5c704dcd2633f9640f9bd038bd4ef3a19b940fc6b2a61ab8bbc35a71fe613',
      fr_FR: 'b311b529e3e718b396be21a86fed197df457eae7a4e33ed6b1fb840fb3db4e37',
      fr_CA: 'b311b529e3e718b396be21a86fed197df457eae7a4e33ed6b1fb840fb3db4e37',
      it_IT: '0c4ad2e3b2a21b11e7de5f1d8ed4b5731efb15e823f6f68861ebae566ee2d03a',
      de_DE: 'd9b5edaa38fcb851a462088b8fd9eab1c03df3a5e8a342462e432496f93fbb4d',
      zh_CN: '25a4447107be04d07da7839ea1f771572b70118ec1992f2cfabb447c0f774297',
      zh_TW: '55598183fde49ce0a991f382968b45b49317fb42e58eebdcefa574dd96a364bf',
      ko_KR: 'f85a6cdaf3fbcb285417d26ecd4720702530530f5b421e47db820e31987a8149',
      ja_JP: '693f803807ac6d828a1d9f8bd156c10c913a1969df785b90ebcd06523b1283a5',
      pt_BR: '6e50559c9066e4dfbfd76da4e47a87556c4334ccf7d01ade6a0aaed24049e055',
      ru_RU: '6996bb8a44dfea40d44f884bb25651f0e18ce49e551547072917a4f096a972bd',
      cs_CZ: 'c903e5c4d40e1eec3ac5ad062c5e854a4d9c4e23649884e2e7aa150359bd773b',
      nl_NL: '109292f3d2ef6ebf99514351fc60dd6b25ce4f1452000e7b9228fe4bfb2a3fd1',
      pl_PL: '64f5962e2719ea293155b60105067cf6f5a82755e551af2d79ed6c577c815186',
      id_ID: '0edea36250a9fcf77a5bb6184610438e2b2eb862a79360655439bbea2f7eba13',
      tr_TR: '32c221f59d9507528a1111960a95a9f7f9a687c0e26c922986420a842133b69f',
      sv_SE: '1d024cf9fbdecd77ae9fd0b93bad3b958540eb70a0a20e7b456e3efb3303409f',
      vi_VN: '7533ac03cbe1be269531a0e6c43939417cacda85bd3e96e9d22d401eca58cc2e',
      da_DK: 'c5fb6b4cd9586ce1ca7e098f1306c6f5350b6eeb75185b88c5045aa12b9617fa',
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
      // 104 at the release/v0.43.0 merge into feature/world-quests: plus the
      // branch's activeWorldQuest, availableWorldQuest and worldBoss marker
      // labels, re-measured for all twenty locales on the merged tree.
      // One additional row identifies the Buried Hoard entrance.
      // 106 with mapMarkerLabels.hoardReturnEntrance (the hoard's way back out,
      // 9b7ac4d5fe); every digest was re-derived and checked to reproduce the
      // prior 105-row digest with only that row removed.
      expect(markerRows).toHaveLength(106);
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
      // The signpost guild board's live count line (guild board categories).
      'guildBoardShown',
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
