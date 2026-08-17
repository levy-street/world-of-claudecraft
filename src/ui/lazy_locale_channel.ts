// The lazy per-locale CONTENT-channel loader, extracted on the rule of three
// once the Reliquary channel became the second verbatim copy of the deed
// channel's loader (the catalog loader in i18n.ts shares only the skeleton: it
// has per-dialect chunks, a resolution-revision bump, and a failure-report
// hook, so it deliberately stays its own implementation). A content channel
// resolves its ENGLISH from a sim content table and ships translations as one
// content-hashed chunk per base locale; this factory owns residency,
// per-language in-flight coalescing, the dialect override merge, and the
// shape-tolerant module read. New channel: call the factory with the loaders
// and dialect map, then register the returned `ensure` in
// src/ui/locale_channels.ts so every main.ts site awaits it.
import type { SupportedLanguage } from './i18n';

/** The chunk module shape every content channel ships: the base table plus an
 *  optional per-dialect override layer (es_ES over es, fr_CA over fr_FR). */
export interface LocaleChannelModule<Table> {
  table: Table;
  dialects?: Partial<Record<string, Table>>;
}

export interface LazyLocaleChannel<Table> {
  /** Make the channel's table resident for `lang` (a no-op for en / en_CA,
   *  once resident, and for a locale with no chunk yet). Callers await it
   *  beside ensureLocaleLoaded (bootstrap / picker); every lookup stays
   *  synchronous and falls back to the authored English until it resolves.
   *  Fetches ONLY `lang`'s chunk (a dialect rides its base locale's chunk).
   *  Rejects on a failed chunk fetch and clears the in-flight slot so a retry
   *  can start a fresh import; the caller decides the UI (boot falls back to
   *  English and keeps going, the language picker keeps the active locale and
   *  reports the failure). */
  ensure: (lang: SupportedLanguage) => Promise<void>;
  /** The resident table for `lang`, or undefined until its chunk resolves
   *  (callers fall back to the authored English). */
  get: (lang: SupportedLanguage) => Table | undefined;
}

export function makeLazyLocaleChannel<Table extends object>(cfg: {
  /** Per-base-locale dynamic-import thunks. Indexed at CALL time, never
   *  captured, so a test's vi.spyOn replacement on the record is honored. */
  loaders: Readonly<Partial<Record<string, () => Promise<LocaleChannelModule<Table>>>>>;
  /** Dialect locales riding a base locale's chunk (es_ES over es). */
  dialectBase: Readonly<Partial<Record<SupportedLanguage, string>>>;
}): LazyLocaleChannel<Table> {
  // The assembled table per LANGUAGE (a dialect and its base are tracked
  // separately), each resident once its own chunk resolves.
  const resident: Partial<Record<SupportedLanguage, Table>> = {};
  // One coalesced in-flight promise PER LANGUAGE, cleared on reject so a failed
  // fetch of one locale leaves a retry possible and never blocks another.
  const inflight = new Map<SupportedLanguage, Promise<void>>();

  const ensure = async (lang: SupportedLanguage): Promise<void> => {
    if (lang === 'en' || lang === 'en_CA') return;
    if (resident[lang]) return;
    const existing = inflight.get(lang);
    if (existing) return existing;
    const dialectBase = cfg.dialectBase[lang];
    const base = dialectBase ?? lang;
    const loader = cfg.loaders[base];
    if (!loader) return; // no chunk for this locale yet (release fill): resident no-op
    const task = loader()
      .then((mod) => {
        // Shape-tolerant read (the ensureLocaleLoaded gotcha): a production
        // chunk may expose the module under `default` while raw vitest
        // resolves the SOURCE .ts with named exports only.
        const m = ((mod as { default?: LocaleChannelModule<Table> }).default ??
          mod) as LocaleChannelModule<Table>;
        const override = dialectBase ? m.dialects?.[lang] : undefined;
        resident[lang] = override ? { ...m.table, ...override } : m.table;
        inflight.delete(lang);
      })
      .catch((err) => {
        inflight.delete(lang);
        throw err;
      });
    inflight.set(lang, task);
    return task;
  };

  return { ensure, get: (lang) => resident[lang] };
}
