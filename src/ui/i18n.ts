// THE LAZY LOCALE FLIP. The runtime statically imports ONLY English eagerly:
//   - `en`     the eager default + universal synchronous fallback (always resident),
//   - `en_XA`  the dev-only pseudo-locale (referenced solely inside the
//              !import.meta.env.PROD branch in tableFor, so a prod build tree-shakes it),
//   - `pending` feeds the release-gate hard-fail in t(),
//   - `LOCALE_LOADERS` + `SUPPORTED_LANGUAGES` drive lazy per-locale loading.
// The 13 non-en dense slices are NO LONGER static-imported for use - each loads lazily via
// LOCALE_LOADERS[lang]()'s dynamic import() as its own content-hashed chunk, so a
// default-English visitor downloads zero non-en locale bytes. These are imported from the
// SPECIFIC generated modules (en / en_XA / pending / loaders), never the index.ts barrel,
// so the only reference to the barrel below is the dead re-export line - which Rollup
// tree-shakes out of the app chunk.

import type {
  DeepPartial,
  EnTranslations,
  InterpolationValue,
  InterpolationValues,
  Leaves,
  TranslationKey,
} from './i18n.catalog';
import { en } from './i18n.resolved.generated/en';
import { en_XA } from './i18n.resolved.generated/en_XA';
import { LOCALE_LOADERS, SUPPORTED_LANGUAGES } from './i18n.resolved.generated/loaders';
import { pending } from './i18n.resolved.generated/pending';

// Re-export the dense per-locale objects so const-importers of './i18n' keep an unchanged
// surface: the S3 guard (tests/localization_fixes.test.ts) and the SHA harness
// (scripts/i18n_resolved_hash.mjs) read every locale const by name. This is a PURE
// re-export (export-from, NO local binding): the app runtime references none of these names
// through './i18n' - every read-path below (t, translationValue, hasTranslation, tOptional)
// reads the lazy `resident` table instead - so Rollup drops the unused re-export and
// tree-shakes the 13 non-en slices (and the barrel that assembles them) out of the app
// chunk. THAT drop is the payload win of the lazy locale flip. `en` stays in the chunk via the eager
// local import above (the universal English default), not via this line.
export {
  da_DK,
  de_DE,
  en,
  en_CA,
  es,
  es_ES,
  fr_CA,
  fr_FR,
  id_ID,
  it_IT,
  ja_JP,
  ko_KR,
  nl_NL,
  pl_PL,
  pt_BR,
  ru_RU,
  sv_SE,
  tr_TR,
  vi_VN,
  zh_CN,
  zh_TW,
} from './i18n.resolved.generated';
// gameStrings is the post-cap/XP/leaderboard layer, which the table carries under the
// `game` key. Source it from the eager generated dense `en` rather than re-exporting from
// i18n.catalog, so importing './i18n' does not pull the full i18n.catalog base (en + shared content
// layers, ~1 MB) into the client bundle - that module now exists only to feed the
// generator. Same content, same export name.
export const gameStrings = en.game;
export type { DeepPartial, InterpolationValue, InterpolationValues, Leaves, TranslationKey };

// The 21-locale set + its type derive from the generated SUPPORTED_LANGUAGES (the loaders
// surface), NOT `keyof typeof translations`: after the lazy flip the full `translations`
// map is no longer eagerly imported. The two are pinned equal (same 21 codes, same order)
// by tests/i18n_emit_shape.test.ts.
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export const supportedLanguages = [...SUPPORTED_LANGUAGES] as SupportedLanguage[];
// Membership set for isSupportedLanguage / getStoredLanguage now that the `translations`
// map (whose keys were the old membership test) is no longer imported.
const SUPPORTED_SET: ReadonlySet<string> = new Set(SUPPORTED_LANGUAGES);

let currentLanguage: SupportedLanguage = 'en';

// --- en_XA dev-only pseudo-locale --------------------------------------
//
// en_XA is the generated pseudo-locale (accent-pushed + bracketed `en`, with
// {placeholders} preserved - see scripts/i18n_pseudo.mjs). It is deliberately NOT a
// member of `translations`, so it never appears in supportedLanguages, the language
// picker (populated from supportedLanguages), index.html hreflang, or the release
// gate / registry. It is selectable ONLY via ?lang=en_XA on a NON-RELEASE build, as
// a developer tool: any on-screen text that stays plain ASCII with no brackets is a
// hard-coded literal that never became a t() key. The import.meta.env.PROD guard in
// tableFor() is statically true in a production `vite build`, so Rollup
// dead-code-eliminates the en_XA reference and tree-shakes the pseudo table out of
// the shipped bundle entirely.
const DEV_PSEUDO_LOCALE = 'en_XA';
let pseudoActive = false;

export function isSupportedLanguage(value: string): value is SupportedLanguage {
  return SUPPORTED_SET.has(value);
}

export function languageTag(lang: SupportedLanguage): string {
  return lang.replace('_', '-');
}

function browserStorage(): Storage | null {
  try {
    const storage = globalThis.localStorage;
    return storage && typeof storage === 'object' ? storage : null;
  } catch {
    return null;
  }
}

function getStoredLanguage(): SupportedLanguage | null {
  const storage = browserStorage();
  if (!storage || typeof storage.getItem !== 'function') return null;
  try {
    const saved = storage.getItem('locale');
    return saved && isSupportedLanguage(saved) ? saved : null;
  } catch {
    return null;
  }
}

function setStoredLanguage(lang: SupportedLanguage): void {
  const storage = browserStorage();
  if (!storage || typeof storage.setItem !== 'function') return;
  try {
    storage.setItem('locale', lang);
  } catch {
    // Storage may be disabled or unavailable in test/browser privacy modes.
  }
}

// Initialize language from URL query or localStorage if available (browser environments)
if (typeof window !== 'undefined' && window.location) {
  const params = new URLSearchParams(window.location.search);
  const langParam = params.get('lang');
  if (langParam === DEV_PSEUDO_LOCALE && !isReleaseBuild()) {
    // Dev-only en_XA pseudo-locale: keep currentLanguage = "en" as the base and flip
    // the pseudo flag. en_XA is not a SupportedLanguage and is never persisted, so it
    // cannot leak into supportedLanguages, the picker, or a stored preference. On a
    // release build this branch is skipped, so ?lang=en_XA degrades to the default.
    pseudoActive = true;
  } else if (langParam && isSupportedLanguage(langParam)) {
    currentLanguage = langParam;
  } else {
    currentLanguage = getStoredLanguage() ?? currentLanguage;
  }
} else {
  currentLanguage = getStoredLanguage() ?? currentLanguage;
}

export function getLanguage(): SupportedLanguage {
  return currentLanguage;
}

export function setLanguage(lang: SupportedLanguage): void {
  pseudoActive = false; // selecting a real locale leaves the dev pseudo-locale
  currentLanguage = lang;
  setStoredLanguage(lang);
}

// --- lazy-locale async loader surface (the async locale loader) ----------------------------------
//
// ensureLocaleLoaded is the ONLY async surface in this module. t() and setLanguage stay
// synchronous forever (locked decision: making t() async would force `await` through 600+
// call sites and is a determinism/timing hazard). Callers await ensureLocaleLoaded BEFORE
// setLanguage so the locale's dense table is resident before the next synchronous render.
//
// `resident` holds the dense table for every loaded locale. English is the ONLY locale
// resident at boot (eager static default + universal sync fallback in tableFor); every
// non-en locale is absent until ensureLocaleLoaded(lang) resolves its chunk. There is no
// longer a static boot pre-seed - after the lazy flip the boot language's table is not
// statically available (only `en` is), so the bootstrap await (src/main.ts startGame,
// behind the loading screen) is a REAL per-locale fetch that populates resident before the
// HUD's first localized paint.
const resident: Partial<Record<SupportedLanguage, EnTranslations>> = { en };
// One in-flight load promise per locale so concurrent callers coalesce onto a single
// import instead of racing N of them.
const inflight = new Map<SupportedLanguage, Promise<void>>();

export function isLocaleResident(lang: SupportedLanguage): boolean {
  return lang === 'en' || resident[lang] !== undefined;
}

// Soft failure hook for a locale chunk that failed to load (a real risk once the lazy locale flip
// makes this a network fetch). Dev-channel only - an English console.warn, never player
// text (the caller renders settings.languageLoadFailed via t()). A production telemetry
// sink can be wired here later; it is intentionally silent on a release build today.
function reportLocaleLoadFailure(lang: SupportedLanguage, err: unknown): void {
  if (!isReleaseBuild()) {
    console.warn(`i18n: failed to load locale "${lang}"`, err);
  }
}

export async function ensureLocaleLoaded(lang: SupportedLanguage): Promise<void> {
  if (lang === 'en' || isLocaleResident(lang)) return; // English-instant / already loaded
  const existing = inflight.get(lang);
  if (existing) return existing; // coalesce onto the in-flight import
  const loader = LOCALE_LOADERS[lang as keyof typeof LOCALE_LOADERS];
  if (!loader) return; // no chunk for this code (en / unknown): treat as a resident no-op
  const task = loader()
    .then((mod) => {
      // Shape-tolerant read: a Vite production chunk exposes the locale as the module
      // default OR the named export, but under raw vitest (node, no DOM) import('./es')
      // resolves the SOURCE .ts with NAMED exports only, so mod.default is undefined -
      // fall back to the export keyed by the locale code.
      resident[lang] =
        (mod as { default?: EnTranslations }).default ??
        (mod as Record<string, EnTranslations>)[lang];
      inflight.delete(lang);
    })
    .catch((err) => {
      inflight.delete(lang); // clear so a retry can start a fresh import
      reportLocaleLoadFailure(lang, err);
      throw err; // the caller decides the UI (the picker shows settings.languageLoadFailed)
    });
  inflight.set(lang, task);
  return task;
}

// --- runtime prefetch (the stored-locale modulepreload, mechanism 1) -------------------------------------
//
// Start the current (stored / ?lang) locale's chunk fetch as EARLY as possible - the
// moment this module evaluates - so the network request is already in flight before the
// bootstrap await (src/main.ts startGame) reaches it. This complements the
// parser-discoverable <link rel="modulepreload"> injected from index.html (mechanism 2):
// the link makes the request high-priority and discoverable before main.ts parses; this
// prefetch guarantees the dynamic import() is issued as soon as the i18n module runs. Both
// target the SAME content-hashed chunk and dedupe to a single network fetch (the inflight
// map coalesces app-side; the browser module map coalesces the request). Fire-and-forget:
// the real await at startGame / the picker still gates first paint and owns the failure UI
// (settings.languageLoadFailed) - the swallowed rejection here only prevents an early
// failed fetch from surfacing as an unhandled rejection (the awaited caller re-runs
// ensureLocaleLoaded, which cleared inflight on reject, so a retry restarts a fresh
// import). English and an already-resident locale are no-ops; never speculative (only the
// one active locale, never the other 12).
export function prefetchLocale(lang: SupportedLanguage = currentLanguage): void {
  if (lang === 'en' || isLocaleResident(lang)) return;
  void ensureLocaleLoaded(lang).catch(() => {
    // Swallowed: the awaited bootstrap/picker call re-runs the load and surfaces the error.
  });
}

// Auto-fire on module evaluation in a browser so a stored / ?lang non-en visitor's chunk
// is in flight immediately (i18n.ts is among the earliest modules the main chunk pulls in).
// No-op for English (the default - preserves the zero-non-en-bytes guarantee for an English
// visitor), for an unresolved locale, and outside a browser (vitest/node has no window); it
// never throws.
if (typeof window !== 'undefined') {
  prefetchLocale();
}

function interpolate(template: string, values?: InterpolationValues): string {
  if (!values) return template;
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name: string) => {
    const value = values[name];
    return value === undefined ? match : String(value);
  });
}

// --- release detection + the t() miss / pending policy -----------------
//
// A non-release build (dev / pre-release / vitest) MAY render English for a key the
// active locale has not translated yet (a registry-`pending` key): the dense table
// carries that English fill, so it renders with no special-casing. A RELEASE build
// must NEVER do that - the release CI gate asserts the pending set is empty, and
// t() additionally hard-fails on any pending key as a never-fires backstop, so
// English can never be silently shipped to a translated player. CONSEQUENCE: a
// non-release build that still carries pending keys MUST NOT be deployed.
//
// Release detection: Vite statically replaces `import.meta.env.PROD` (true for
// `vite build`, false for the dev server and vitest). Tests and the release build
// step can force release semantics with the `I18N_RELEASE=1` env var. Read lazily,
// on the cold (miss / pending) path only, so a test can flip it and the hot hit
// path pays nothing.
function isReleaseBuild(): boolean {
  try {
    if (typeof process !== 'undefined' && process.env && process.env.I18N_RELEASE === '1')
      return true;
  } catch {
    // No `process` (browser runtime) - fall through to the build-time flag.
  }
  try {
    return (import.meta as { env?: { PROD?: boolean } }).env?.PROD === true;
  } catch {
    return false;
  }
}

// Keys each locale has NOT translated (the resolved table English-fills them).
// Empty while overlays stay dense; populated once a locale goes sparse. Built once
// from the generated `pending` lists. PENDING_TOTAL lets the hot path skip the
// per-key membership test entirely when nothing is pending (the common case).
const PENDING_SETS: Partial<Record<SupportedLanguage, ReadonlySet<string>>> = {};
let PENDING_TOTAL = 0;
for (const [lang, keys] of Object.entries(pending)) {
  PENDING_SETS[lang as SupportedLanguage] = new Set(keys);
  PENDING_TOTAL += keys.length;
}

// A key absent from the dense table is absent from `en` itself, so it is untracked
// by the registry (the PR gate - tsc for t() keys, s3_registered for matcher emits -
// rejects an unregistered key). Throw in dev/test so a typo'd or never-registered
// key surfaces immediately; on an (already-gated) release build, degrade to the raw
// key rather than crash a player's client mid-render.
function onUntrackedKey(key: string): string {
  if (!isReleaseBuild()) {
    throw new Error(`i18n: untracked key "${key}" is not in the translation table or registry`);
  }
  return key;
}

// The dense table the current-language read paths resolve against. The en_XA pseudo table
// only when the dev pseudo-locale is active AND the requested locale is the current one (so
// an explicit read of some other locale is unaffected); en_XA is referenced solely inside
// the !import.meta.env.PROD branch, so a production build tree-shakes it away.
function tableFor(lang: SupportedLanguage): EnTranslations {
  if (!import.meta.env.PROD && pseudoActive && lang === currentLanguage) {
    return en_XA;
  }
  // resident holds English (always) + every locale ensureLocaleLoaded has resolved.
  // resident.en is the universal English fallback for a locale not yet loaded (or one whose
  // chunk failed to fetch): the synchronous read never blocks and never throws. Callers that
  // need the localized table await ensureLocaleLoaded(lang) first (bootstrap / picker).
  return resident[lang] ?? resident.en!;
}

export function t(key: TranslationKey, values?: InterpolationValues): string {
  const parts = key.split('.');
  let current: unknown = tableFor(currentLanguage);
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return onUntrackedKey(key);
    }
  }
  if (typeof current !== 'string') return onUntrackedKey(key);
  if (PENDING_TOTAL > 0 && PENDING_SETS[currentLanguage]?.has(key) && isReleaseBuild()) {
    throw new Error(
      `i18n: key "${key}" is untranslated (pending) for locale "${currentLanguage}" on a release build; English must never ship to a translated player`,
    );
  }
  return interpolate(current, values);
}

function translationValue(key: string, lang: SupportedLanguage): string | null {
  const parts = key.split('.');
  let current: unknown = tableFor(lang);
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return null;
    }
  }
  return typeof current === 'string' ? current : null;
}

export function hasTranslation(key: string, lang: SupportedLanguage = currentLanguage): boolean {
  return translationValue(key, lang) !== null;
}

export function tOptional(
  key: string,
  values?: InterpolationValues,
  lang: SupportedLanguage = currentLanguage,
): string | null {
  const value = translationValue(key, lang);
  return value === null ? null : interpolate(value, values);
}

// --- CLDR cardinal pluralization -------------------------------------------
//
// Plural-aware lookup for count-bearing strings. Keys follow the convention
// `<base>.one | .few | .many | .other`; tPlural selects the active locale's
// cardinal category for `count` via Intl.PluralRules and resolves the matching
// leaf, falling back to `<base>.other` when the locale never produces that
// category (English/German/Romance only select one/other; CJK only other) or the
// specific leaf is absent. `count` is auto-supplied as {count}. This is what lets
// a 3-form Slavic locale like Russian render the correct 1 / 2-4 / 5+ wording
// instead of a wrong binary one/other split. One Intl.PluralRules is cached per
// language tag; selection happens off the hot path (only at count-string renders).
const pluralRulesCache = new Map<string, Intl.PluralRules>();
function pluralRulesFor(lang: SupportedLanguage): Intl.PluralRules {
  const tag = languageTag(lang);
  let rules = pluralRulesCache.get(tag);
  if (!rules) {
    rules = new Intl.PluralRules(tag);
    pluralRulesCache.set(tag, rules);
  }
  return rules;
}

export function tPlural(base: string, count: number, values?: InterpolationValues): string {
  const category = pluralRulesFor(currentLanguage).select(count); // zero|one|two|few|many|other
  const merged: InterpolationValues = { count, ...(values ?? {}) };
  const candidate = `${base}.${category}`;
  const key = (hasTranslation(candidate) ? candidate : `${base}.other`) as TranslationKey;
  return t(key, merged);
}

// Constructing an Intl.NumberFormat parses locale data and is one of the costlier JS
// ops; the HUD calls formatNumber on per-frame paths (aura stack counts, cast-bar
// timers, the action bar). One formatter is cached per (language tag, options) so a
// repeat format reuses it instead of rebuilding (mirrors pluralRulesCache). The key
// folds the options by value, not identity, so two call sites passing equal options
// share one formatter; a BCP-47 tag never contains '{', so tag + the options JSON is an
// unambiguous key. NumberFormat instances are immutable, so sharing is safe.
const numberFormatCache = new Map<string, Intl.NumberFormat>();
function numberFormatFor(tag: string, options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = options ? `${tag}${JSON.stringify(options)}` : tag;
  let fmt = numberFormatCache.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(tag, options);
    numberFormatCache.set(key, fmt);
  }
  return fmt;
}

export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions,
  lang: SupportedLanguage = currentLanguage,
): string {
  return numberFormatFor(languageTag(lang), options).format(value);
}

export function formatDateTime(
  value: Date | number,
  options?: Intl.DateTimeFormatOptions,
  lang: SupportedLanguage = currentLanguage,
): string {
  return new Intl.DateTimeFormat(languageTag(lang), options).format(value);
}

export interface MoneyParts {
  gold: number;
  silver: number;
  copper: number;
}

export type MoneyDisplayStyle = 'compact' | 'long';

export function moneyParts(copper: number): MoneyParts {
  const safeCopper = Number.isFinite(copper) ? Math.max(0, Math.floor(copper)) : 0;
  return {
    gold: Math.floor(safeCopper / 10000),
    silver: Math.floor((safeCopper % 10000) / 100),
    copper: safeCopper % 100,
  };
}

export function formatMoney(copper: number, style: MoneyDisplayStyle = 'compact'): string {
  const parts = moneyParts(copper);
  const unitKeys =
    style === 'compact'
      ? ({
          gold: 'itemUi.money.goldShort',
          silver: 'itemUi.money.silverShort',
          copper: 'itemUi.money.copperShort',
        } satisfies Record<keyof MoneyParts, TranslationKey>)
      : ({
          gold: 'itemUi.money.gold',
          silver: 'itemUi.money.silver',
          copper: 'itemUi.money.copper',
        } satisfies Record<keyof MoneyParts, TranslationKey>);
  const rows: { value: number; unit: TranslationKey }[] = [];
  if (parts.gold > 0) rows.push({ value: parts.gold, unit: unitKeys.gold });
  if (parts.silver > 0 || parts.gold > 0) rows.push({ value: parts.silver, unit: unitKeys.silver });
  if (parts.copper > 0 || rows.length === 0)
    rows.push({ value: parts.copper, unit: unitKeys.copper });
  return rows
    .map(({ value, unit }) => {
      const amount = formatNumber(value, { maximumFractionDigits: 0 });
      return style === 'compact' ? `${amount}${t(unit)}` : `${amount} ${t(unit)}`;
    })
    .join(' ');
}
