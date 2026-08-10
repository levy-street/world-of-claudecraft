// Reliquary page name / description localization (the deed_i18n entity-style
// pattern scoped to The Reliquary). The English source of truth is the
// RELIQUARY_PAGES content table itself (name/desc on the page def); this module
// adds the locale plumbing, and the fill lives in per-base-locale chunks
// (reliquary_i18n.locales/<locale>.ts, each lazily fetched via
// ensureReliquaryLocalesLoaded) without touching a single call site. An absent
// or not-yet-resident locale table or field still falls back to the authored
// English (clean English is preferable to a broken guess).
//
// Coverage today: the five non-Latin locale tables (ja_JP, ko_KR, ru_RU,
// zh_CN, zh_TW) ship page NAMES now, because a Latin-script reader can at least
// parse an English proper noun while a CJK/Cyrillic reader cannot. The Latin
// locales, and every page desc, are release fill (the Phase 22 worklist); until
// then they render the authored English through the fallback above.

import { RELIQUARY_PAGES, RELIQUARY_PAGES_BY_ID } from '../sim/content/reliquary';
import { getLanguage, type SupportedLanguage, t } from './i18n';
import { maybePseudoString, pseudoLocaleString } from './i18n_pseudo_port';
import { makeLazyLocaleChannel } from './lazy_locale_channel';

export type ReliquaryTranslationField = 'name' | 'desc';

/** Per-page localized fields; any omitted field falls back to English. */
export interface ReliquaryLocaleEntry {
  name?: string;
  desc?: string;
}

export type ReliquaryLocaleTable = Record<string, ReliquaryLocaleEntry>;

// The fill tables live in per-base-locale chunks
// (reliquary_i18n.locales/<locale>.ts) behind RELIQUARY_LOCALE_LOADERS,
// mirroring the deed_i18n model: the eager renderer bundle (hud.ts, the
// Reliquary window) carries zero reliquary locale bytes for a default-English
// player, and a non-en visitor fetches ONLY their own locale's chunk.
// `residentReliquaryLocales` holds the assembled table per LANGUAGE once that
// locale's chunk resolves; en and en_CA resolve to the authored English in
// localeEntry before this map is consulted, so they never fetch a chunk.

/** A per-base-locale reliquary chunk: its table, plus the co-located override
 *  layer for any dialect that rides it (es carries es_ES, fr_FR carries fr_CA).
 *  No dialect layer ships yet; the escape hatch mirrors deed_i18n so a release
 *  fill that needs one does not have to reshape the module. */
export interface ReliquaryLocaleModule {
  table: ReliquaryLocaleTable;
  dialects?: Record<string, ReliquaryLocaleTable>;
}

type ReliquaryBaseLocale =
  | 'cs_CZ'
  | 'da_DK'
  | 'de_DE'
  | 'es'
  | 'fr_FR'
  | 'id_ID'
  | 'it_IT'
  | 'ja_JP'
  | 'ko_KR'
  | 'nl_NL'
  | 'pl_PL'
  | 'pt_BR'
  | 'ru_RU'
  | 'sv_SE'
  | 'tr_TR'
  | 'vi_VN'
  | 'zh_CN'
  | 'zh_TW';

// The per-locale dynamic-import thunks (the DEED_LOCALE_LOADERS shape scoped to
// The Reliquary): each shipped base locale is its own content-hashed chunk. The
// record is PARTIAL because only the five non-Latin locales are filled today; a
// base locale with no chunk resolves to a resident no-op and keeps rendering the
// authored English, so the release fill adds a file plus one row here and
// nothing else. Production never reassigns the map; tests spy a single locale's
// thunk (vi.spyOn) to assert per-locale fetch counts and simulate a failed chunk
// fetch. Read at call time in ensureReliquaryLocalesLoaded (never captured) so a
// spy replacement is honored.
export const RELIQUARY_LOCALE_LOADERS: Partial<
  Record<ReliquaryBaseLocale, () => Promise<ReliquaryLocaleModule>>
> = {
  es: () => import('./reliquary_i18n.locales/es'),
  fr_FR: () => import('./reliquary_i18n.locales/fr_FR'),
  it_IT: () => import('./reliquary_i18n.locales/it_IT'),
  de_DE: () => import('./reliquary_i18n.locales/de_DE'),
  pt_BR: () => import('./reliquary_i18n.locales/pt_BR'),
  cs_CZ: () => import('./reliquary_i18n.locales/cs_CZ'),
  nl_NL: () => import('./reliquary_i18n.locales/nl_NL'),
  pl_PL: () => import('./reliquary_i18n.locales/pl_PL'),
  id_ID: () => import('./reliquary_i18n.locales/id_ID'),
  tr_TR: () => import('./reliquary_i18n.locales/tr_TR'),
  sv_SE: () => import('./reliquary_i18n.locales/sv_SE'),
  vi_VN: () => import('./reliquary_i18n.locales/vi_VN'),
  da_DK: () => import('./reliquary_i18n.locales/da_DK'),
  ja_JP: () => import('./reliquary_i18n.locales/ja_JP'),
  ko_KR: () => import('./reliquary_i18n.locales/ko_KR'),
  ru_RU: () => import('./reliquary_i18n.locales/ru_RU'),
  zh_CN: () => import('./reliquary_i18n.locales/zh_CN'),
  zh_TW: () => import('./reliquary_i18n.locales/zh_TW'),
};

// Dialect locales ride their base locale's chunk (es_ES over es, fr_CA over
// fr_FR); the base chunk co-locates the override layer under `dialects`.
const RELIQUARY_DIALECT_BASE: Partial<Record<SupportedLanguage, ReliquaryBaseLocale>> = {
  es_ES: 'es',
  fr_CA: 'fr_FR',
};

// Residency, per-language in-flight coalescing, the dialect override merge,
// and the shape-tolerant chunk read all live in the shared content-channel
// factory (lazy_locale_channel.ts, the one copy the deed channel uses too).
const reliquaryChannel = makeLazyLocaleChannel<ReliquaryLocaleTable>({
  loaders: RELIQUARY_LOCALE_LOADERS,
  dialectBase: RELIQUARY_DIALECT_BASE,
});

/** Make the reliquary locale table resident for `lang`; see
 *  LazyLocaleChannel.ensure for the full contract (no-op for en / en_CA, once
 *  resident, and for a locale with no chunk; rejects on a failed fetch with
 *  the in-flight slot cleared so a retry can start fresh, and the caller
 *  decides the UI: boot falls back to English and keeps going, the language
 *  picker keeps the active locale and reports the failure). */
export const ensureReliquaryLocalesLoaded: (lang: SupportedLanguage) => Promise<void> =
  reliquaryChannel.ensure;

// --- en_XA dev pseudo-locale port ---------------------------------------------
//
// Reliquary page English resolves from the sim content table, OUTSIDE the i18n
// catalog (localeEntry returns undefined for 'en'), so the tableFor pseudo swap
// never reaches it: under ?lang=en_XA a page name would render plain English
// inside pseudolocalized chrome, hiding the very literals the pseudo-locale
// exists to expose. maybePseudoString folds it through the SHARED port of the
// generator's transform (i18n_pseudo_port.ts), the one copy the deed channel
// folds through too, held byte-identical to the committed en_XA table by the
// total drift pin in tests/i18n_pseudo_port.test.ts. The port's own
// `!import.meta.env.PROD` gate keeps its map and transform statically dead in a
// release build.

/** The shared en_XA port under the Reliquary channel's name; exported only for
 *  the drift pins that compare it to the generated en_XA table. */
export const pseudoReliquaryString = pseudoLocaleString;

function localeEntry(pageId: string): ReliquaryLocaleEntry | undefined {
  const lang = getLanguage();
  if (lang === 'en' || lang === 'en_CA') return undefined;
  return reliquaryChannel.get(lang)?.[pageId];
}

// RELIQUARY_PAGES_BY_ID is a plain object, so a bare index with a prototype
// key ('__proto__', 'constructor') resolves truthy and would break the raw-id
// fallback contract below for a hostile or drifted wire id.
function pageDef(pageId: string): (typeof RELIQUARY_PAGES_BY_ID)[string] | undefined {
  return Object.hasOwn(RELIQUARY_PAGES_BY_ID, pageId) ? RELIQUARY_PAGES_BY_ID[pageId] : undefined;
}

/** Localized page name; the raw page id for a catalog-unknown id (content
 *  drift), which is what every render site wants for an id it cannot place. */
export function reliquaryPageName(pageId: string): string {
  const def = pageDef(pageId);
  if (!def) return pageId;
  return maybePseudoString(localeEntry(pageId)?.name ?? def.name);
}

/** Localized page description; '' for a catalog-unknown id or a page that
 *  authors no blurb (callers hide the surface entirely). */
export function reliquaryPageDesc(pageId: string): string {
  const def = pageDef(pageId);
  if (!def) return '';
  return maybePseudoString(localeEntry(pageId)?.desc ?? def.desc ?? '');
}

/** The guild-chat news template for another player's first-ever page
 *  Illumination (Phase 18) with the page slot filled by a caller-owned
 *  string: the HUD passes its splice sentinel (DEED_NAME_TOKEN) so the page
 *  name lands as a clickable jump node;
 *  reliquaryIlluminationBroadcastLine below passes the resolved name for a
 *  plain-text line. One template render, so the two forms cannot drift (the
 *  deed_i18n deedBroadcastRendered pattern). */
export function reliquaryIlluminationBroadcastRendered(
  characterName: string,
  pageSlot: string,
): string {
  return t('hudChrome.reliquary.illuminationBroadcastLine', {
    name: characterName,
    page: pageSlot,
  });
}

/** The guild-chat news line for another player's first-ever page
 *  Illumination, composed client-side from the id-based wire event (the
 *  server never sends page English). Pure and Node-testable so the one HUD
 *  switch arm stays a thin log call; a catalog-unknown page id (mixed-version
 *  drift) degrades to the raw id through reliquaryPageName's fallback. */
export function reliquaryIlluminationBroadcastLine(characterName: string, pageId: string): string {
  return reliquaryIlluminationBroadcastRendered(characterName, reliquaryPageName(pageId));
}

export interface ReliquaryTranslationManifestEntry {
  id: string;
  field: ReliquaryTranslationField;
  source: string;
}

/** Every (page, field) pair the fill must cover, with its English source (the
 *  deedTranslationManifest shape for coverage tooling). A page with no authored
 *  desc contributes only its name row. */
export function reliquaryTranslationManifest(): ReliquaryTranslationManifestEntry[] {
  const entries: ReliquaryTranslationManifestEntry[] = [];
  for (const def of RELIQUARY_PAGES) {
    entries.push({ id: def.id, field: 'name', source: def.name });
    if (def.desc !== undefined) {
      entries.push({ id: def.id, field: 'desc', source: def.desc });
    }
  }
  return entries;
}
