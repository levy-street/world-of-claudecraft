// The content-channel registry: every lazy per-locale CONTENT channel (deed
// names, reliquary page names, ...) whose table must be resident before a
// language flip repaints, or the fan-out paints the picked locale with the
// previous locale's content strings. main.ts awaits the whole registry at its
// three hook sites (boot, changeLanguage, the start-screen warm), so a NEW
// channel lands here once and every site picks it up; the registry-membership
// pin in tests/language_fanout_registry.test.ts holds the list itself. The
// main catalog loader (i18n.ts ensureLocaleLoaded) is deliberately NOT in
// this list: the start-screen warm gates its reveal on that one alone, so the
// call sites compose it beside this registry.
import { ensureDeedLocalesLoaded } from './deed_i18n';
import type { SupportedLanguage } from './i18n';
import { ensureReliquaryLocalesLoaded } from './reliquary_i18n';

export const CONTENT_LOCALE_CHANNEL_ENSURERS: readonly ((
  lang: SupportedLanguage,
) => Promise<void>)[] = [ensureDeedLocalesLoaded, ensureReliquaryLocalesLoaded];
