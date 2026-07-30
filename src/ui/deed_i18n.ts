// Deed name / description / title localization (the talent_i18n entity-style
// pattern scoped to the Book of Deeds). The English source of truth is the
// DEEDS content table itself (name/desc on the def, the title string on its
// reward); this module adds the locale plumbing, and the release fill lives
// in per-base-locale chunks (deed_i18n.locales/<locale>.ts, each lazily fetched
// via ensureDeedLocalesLoaded) without touching a single call site. An absent or
// not-yet-resident locale table or field still falls back to the authored
// English (clean English is preferable to a broken guess).

import { DEEDS } from '../sim/content/deeds';
import { getLanguage, isPseudoActive, type SupportedLanguage, t } from './i18n';

export type DeedTranslationField = 'name' | 'desc' | 'title';

/** Per-deed localized fields; any omitted field falls back to English. */
export interface DeedLocaleEntry {
  name?: string;
  desc?: string;
  /** The title-reward display string (only meaningful for title deeds). */
  title?: string;
}

export type DeedLocaleTable = Record<string, DeedLocaleEntry>;

// The release-fill tables (the TALENT_NEW newlocales shape) live in per-base-
// locale chunks (deed_i18n.locales/<locale>.ts) behind DEED_LOCALE_LOADERS,
// mirroring the i18n.ts LOCALE_LOADERS model: the eager renderer bundle (hud.ts,
// render/nameplate_painter.ts) carries zero deed locale bytes for a
// default-English player, and a non-en visitor fetches ONLY their own locale's
// chunk (a de_DE reader never downloads the other seventeen). `residentDeedLocales`
// holds the assembled table per LANGUAGE once that locale's chunk resolves: es_ES
// and fr_CA ride their base locale's chunk (es, fr_FR) with a small delve-
// vocabulary override layered on (the talent_i18n localeText dialect model) under
// the few entries whose vocabulary genuinely diverges; en and en_CA resolve to the
// authored English in localeEntry before this map is consulted, so they never
// fetch a chunk.

/** A per-base-locale deed chunk: its table, plus the co-located override layer
 *  for any dialect that rides it (es carries es_ES, fr_FR carries fr_CA). */
export interface DeedLocaleModule {
  table: DeedLocaleTable;
  dialects?: Record<string, DeedLocaleTable>;
}

type DeedBaseLocale =
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

// The per-locale dynamic-import thunks (the LOCALE_LOADERS shape scoped to the
// Book of Deeds): each base locale is its own content-hashed chunk. Production
// never reassigns the map; tests spy a single locale's thunk (vi.spyOn) to assert
// per-locale fetch counts and simulate a failed chunk fetch. Read at call time in
// ensureDeedLocalesLoaded (never captured) so a spy replacement is honored.
export const DEED_LOCALE_LOADERS: Record<DeedBaseLocale, () => Promise<DeedLocaleModule>> = {
  cs_CZ: () => import('./deed_i18n.locales/cs_CZ'),
  da_DK: () => import('./deed_i18n.locales/da_DK'),
  de_DE: () => import('./deed_i18n.locales/de_DE'),
  es: () => import('./deed_i18n.locales/es'),
  fr_FR: () => import('./deed_i18n.locales/fr_FR'),
  id_ID: () => import('./deed_i18n.locales/id_ID'),
  it_IT: () => import('./deed_i18n.locales/it_IT'),
  ja_JP: () => import('./deed_i18n.locales/ja_JP'),
  ko_KR: () => import('./deed_i18n.locales/ko_KR'),
  nl_NL: () => import('./deed_i18n.locales/nl_NL'),
  pl_PL: () => import('./deed_i18n.locales/pl_PL'),
  pt_BR: () => import('./deed_i18n.locales/pt_BR'),
  ru_RU: () => import('./deed_i18n.locales/ru_RU'),
  sv_SE: () => import('./deed_i18n.locales/sv_SE'),
  tr_TR: () => import('./deed_i18n.locales/tr_TR'),
  vi_VN: () => import('./deed_i18n.locales/vi_VN'),
  zh_CN: () => import('./deed_i18n.locales/zh_CN'),
  zh_TW: () => import('./deed_i18n.locales/zh_TW'),
};

// Dialect locales ride their base locale's chunk (es_ES over es, fr_CA over
// fr_FR); the base chunk co-locates the override layer under `dialects`.
const DEED_DIALECT_BASE: Partial<Record<SupportedLanguage, DeedBaseLocale>> = {
  es_ES: 'es',
  fr_CA: 'fr_FR',
};

// The assembled deed table per LANGUAGE (es and es_ES tracked separately), each
// resident once its own chunk resolves. Absent until then: a non-en read falls
// back to the authored English (the documented absent-table behavior).
const residentDeedLocales: Partial<Record<SupportedLanguage, DeedLocaleTable>> = {};
// One coalesced in-flight promise PER LANGUAGE, cleared on reject so a failed
// fetch of one locale leaves a retry possible and never blocks another locale.
const inflightDeedLocales = new Map<SupportedLanguage, Promise<void>>();

/** Make the deed locale table resident for `lang` (a no-op for en / en_CA and
 *  once resident). Callers await it beside ensureLocaleLoaded (bootstrap /
 *  picker); every lookup in this module stays synchronous and falls back to the
 *  authored English until it resolves. Fetches ONLY `lang`'s chunk (a dialect
 *  rides its base locale's chunk). Rejects on a failed chunk fetch (the caller
 *  owns the UI, English keeps rendering) and clears the in-flight slot so a
 *  retry can start a fresh import. */
export async function ensureDeedLocalesLoaded(lang: SupportedLanguage): Promise<void> {
  if (lang === 'en' || lang === 'en_CA') return;
  if (residentDeedLocales[lang]) return;
  const existing = inflightDeedLocales.get(lang);
  if (existing) return existing;
  const dialectBase = DEED_DIALECT_BASE[lang];
  const base = dialectBase ?? (lang as DeedBaseLocale);
  const loader = DEED_LOCALE_LOADERS[base];
  if (!loader) return; // no chunk for this code (unknown): resident no-op
  const task = loader()
    .then((mod) => {
      // Shape-tolerant read (the ensureLocaleLoaded gotcha): a production chunk
      // may expose the module under `default` while raw vitest resolves the
      // SOURCE .ts with named exports only.
      const m = (mod as { default?: DeedLocaleModule }).default ?? mod;
      const override = dialectBase ? m.dialects?.[lang] : undefined;
      residentDeedLocales[lang] = override ? { ...m.table, ...override } : m.table;
      inflightDeedLocales.delete(lang);
    })
    .catch((err) => {
      inflightDeedLocales.delete(lang);
      throw err;
    });
  inflightDeedLocales.set(lang, task);
  return task;
}

// --- en_XA dev pseudo-locale port ---------------------------------------------
//
// Deed English resolves from the sim content table, OUTSIDE the i18n catalog
// (localeEntry returns undefined for 'en'), so the tableFor pseudo swap never
// reaches it: under ?lang=en_XA a deed would render plain English inside
// pseudolocalized chrome, hiding the very literals the pseudo-locale exists to
// expose. maybePseudo folds it through a faithful port of the generator's
// transform (scripts/i18n_pseudo.mjs) so the accent-push+bracket form matches
// the committed en_XA table byte for byte (pinned in tests). The whole path sits
// behind the `!import.meta.env.PROD` gate below, so a release build statically
// drops the port and its map.

// 1:1 accent-push map for the 52 ASCII letters (copied from
// scripts/i18n_pseudo.mjs; the two must stay identical, guarded by the drift pin
// in the deed pseudo test).
const PSEUDO_ACCENT_MAP: Record<string, string> = {
  a: 'á',
  b: 'ƀ',
  c: 'ç',
  d: 'ð',
  e: 'é',
  f: 'ƒ',
  g: 'ĝ',
  h: 'ĥ',
  i: 'í',
  j: 'ĵ',
  k: 'ķ',
  l: 'ļ',
  m: 'ɱ',
  n: 'ñ',
  o: 'ó',
  p: 'þ',
  q: 'ɋ',
  r: 'ŕ',
  s: 'š',
  t: 'ţ',
  u: 'ú',
  v: 'ʋ',
  w: 'ŵ',
  x: 'ẋ',
  y: 'ý',
  z: 'ž',
  A: 'Á',
  B: 'Ɓ',
  C: 'Ç',
  D: 'Ð',
  E: 'É',
  F: 'Ƒ',
  G: 'Ĝ',
  H: 'Ĥ',
  I: 'Í',
  J: 'Ĵ',
  K: 'Ķ',
  L: 'Ļ',
  M: 'Ɱ',
  N: 'Ñ',
  O: 'Ó',
  P: 'Þ',
  Q: 'Ɋ',
  R: 'Ŕ',
  S: 'Š',
  T: 'Ţ',
  U: 'Ú',
  V: 'Ʋ',
  W: 'Ŵ',
  X: 'Ẋ',
  Y: 'Ý',
  Z: 'Ž',
};

function pseudoAccentPush(text: string): string {
  let out = '';
  for (const ch of text) out += PSEUDO_ACCENT_MAP[ch] ?? ch;
  return out;
}

/** Accent-push the literal text of `s`, preserving every {token} exactly, then
 *  bracket the whole leaf. A faithful port of scripts/i18n_pseudo.mjs's
 *  pseudoString; exported only for the drift pin that compares it to the
 *  generated en_XA table. */
export function pseudoDeedString(s: string): string {
  const transformed = s
    .split(/(\{[^}]*\})/g)
    .map((part) => (part.startsWith('{') && part.endsWith('}') ? part : pseudoAccentPush(part)))
    .join('');
  return `[${transformed}]`;
}

// Fold a resolved deed English string under the dev pseudo-locale, else return it
// untouched. The `!import.meta.env.PROD` prefix makes the whole branch statically
// dead in a release build, so the port above tree-shakes away.
function maybePseudo(s: string): string {
  return !import.meta.env.PROD && isPseudoActive() ? pseudoDeedString(s) : s;
}

function localeEntry(id: string): DeedLocaleEntry | undefined {
  const lang = getLanguage();
  if (lang === 'en' || lang === 'en_CA') return undefined;
  return residentDeedLocales[lang]?.[id];
}

/** Localized deed name; the raw id for a catalog-unknown id (content drift). */
export function deedName(id: string): string {
  const def = DEEDS[id];
  if (!def) return id;
  return maybePseudo(localeEntry(id)?.name ?? def.name);
}

/** Localized deed description; '' for a catalog-unknown id. */
export function deedDesc(id: string): string {
  const def = DEEDS[id];
  if (!def) return '';
  return maybePseudo(localeEntry(id)?.desc ?? def.desc);
}

/** The localized display title for a title-reward deed; '' when the deed is
 *  unknown or carries no title reward (callers hide the surface entirely). */
export function deedTitleText(id: string): string {
  const def = DEEDS[id];
  if (!def || def.reward?.kind !== 'title') return '';
  return maybePseudo(localeEntry(id)?.title ?? def.reward.text);
}

/** The guild-chat news line for another player's marquee unlock, composed
 *  client-side from the id-based wire event (the server never sends deed
 *  English). Pure and Node-testable so the one HUD switch arm stays a thin
 *  log call. */
export function deedBroadcastLine(characterName: string, deedId: string): string {
  return t('hudChrome.deeds.broadcastLine', { name: characterName, deed: deedName(deedId) });
}

/** A player name decorated with their selected title through the
 *  hudChrome.deeds.titledName pattern (the locale owns bracket text AND
 *  placement). The bare name comes back for a null/absent/stale id or a
 *  non-title reward, so every consumer degrades to today's rendering. */
export function titledDisplayName(name: string, titleId: string | null | undefined): string {
  const title = titleId ? deedTitleText(titleId) : '';
  if (!title) return name;
  return t('hudChrome.deeds.titledName', { name, title });
}

/** The titledName pattern split around the name for surfaces that render the
 *  name and its title decoration in SEPARATE nodes (the target frame's
 *  differently-styled spans): `pre` is everything the locale places before
 *  the name, `post` everything after. Both '' when untitled/stale. A locale
 *  pattern that omits {name} entirely degrades to the whole rendered
 *  decoration after the name. */
export interface TitledNameDecoration {
  pre: string;
  post: string;
}

const UNTITLED_DECORATION: TitledNameDecoration = { pre: '', post: '' };

export function titledNameDecoration(titleId: string | null | undefined): TitledNameDecoration {
  const title = titleId ? deedTitleText(titleId) : '';
  if (!title) return UNTITLED_DECORATION;
  // A sentinel no locale pattern or title text can contain, so the split
  // around the interpolated name is exact even when the title has spaces.
  const NAME_TOKEN = '\u0000';
  const rendered = t('hudChrome.deeds.titledName', { name: NAME_TOKEN, title });
  const at = rendered.indexOf(NAME_TOKEN);
  if (at < 0) return { pre: '', post: ` ${rendered}` };
  return { pre: rendered.slice(0, at), post: rendered.slice(at + NAME_TOKEN.length) };
}

export interface DeedTranslationManifestEntry {
  id: string;
  field: DeedTranslationField;
  source: string;
}

/** Every (deed, field) pair the release fill must cover, with its English
 *  source (the talentTranslationManifest shape for coverage tooling). */
export function deedTranslationManifest(): DeedTranslationManifestEntry[] {
  const entries: DeedTranslationManifestEntry[] = [];
  for (const def of Object.values(DEEDS)) {
    entries.push({ id: def.id, field: 'name', source: def.name });
    entries.push({ id: def.id, field: 'desc', source: def.desc });
    if (def.reward?.kind === 'title') {
      entries.push({ id: def.id, field: 'title', source: def.reward.text });
    }
  }
  return entries;
}
