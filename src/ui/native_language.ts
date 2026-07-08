import { isSupportedLanguage, type SupportedLanguage, setLanguage } from './i18n';

type LocaleStorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export interface NativeLanguageEnv {
  native: boolean;
  locationSearch?: string;
  storage?: LocaleStorageLike | null;
  languages?: readonly string[] | null;
  language?: string | null;
}

const LOCALE_KEY = 'locale';
const NATIVE_AUTO_LOCALE_KEY = 'woc_native_auto_locale';

const DEFAULT_REGION_BY_LANGUAGE: Readonly<Record<string, SupportedLanguage>> = {
  cs: 'cs_CZ',
  da: 'da_DK',
  de: 'de_DE',
  fr: 'fr_FR',
  id: 'id_ID',
  it: 'it_IT',
  ja: 'ja_JP',
  ko: 'ko_KR',
  nl: 'nl_NL',
  pl: 'pl_PL',
  pt: 'pt_BR',
  ru: 'ru_RU',
  sv: 'sv_SE',
  tr: 'tr_TR',
  vi: 'vi_VN',
  zh: 'zh_CN',
};

function normalizedLocaleCandidates(locale: string): string[] {
  const cleaned = locale.trim().split('.')[0]?.split('@')[0] ?? '';
  if (!cleaned) return [];

  const parts = cleaned
    .replace(/-/g, '_')
    .split('_')
    .map((part) => part.trim())
    .filter(Boolean);
  const language = parts[0]?.toLowerCase();
  if (!language) return [];

  const region = parts.find((part, index) => index > 0 && /^[A-Za-z]{2}$|\d{3}$/.test(part));
  const out: string[] = [];
  if (region) out.push(`${language}_${region.toUpperCase()}`);
  out.push(language);

  const defaultRegion = DEFAULT_REGION_BY_LANGUAGE[language];
  if (defaultRegion) out.push(defaultRegion);

  return out;
}

export function resolveSupportedDeviceLanguage(
  locales: readonly string[],
): SupportedLanguage | null {
  for (const locale of locales) {
    for (const candidate of normalizedLocaleCandidates(locale)) {
      if (isSupportedLanguage(candidate)) return candidate;
    }
  }
  return null;
}

function explicitLanguageSelection(env: NativeLanguageEnv): boolean {
  if (env.locationSearch) {
    const params = new URLSearchParams(env.locationSearch);
    const langParam = params.get('lang');
    if (langParam && isSupportedLanguage(langParam)) return true;
  }

  const saved = storedSupportedLanguage(env.storage, LOCALE_KEY);
  if (!saved) return false;
  return storedSupportedLanguage(env.storage, NATIVE_AUTO_LOCALE_KEY) !== saved;
}

function storedSupportedLanguage(
  storage: LocaleStorageLike | null | undefined,
  key: string,
): SupportedLanguage | null {
  if (!storage || typeof storage.getItem !== 'function') return null;
  try {
    const saved = storage.getItem(key);
    return saved && isSupportedLanguage(saved) ? saved : null;
  } catch {
    return null;
  }
}

function rememberNativeAutoLanguage(
  storage: LocaleStorageLike | null | undefined,
  lang: SupportedLanguage,
): void {
  if (!storage || typeof storage.setItem !== 'function') return;
  try {
    storage.setItem(LOCALE_KEY, lang);
    storage.setItem(NATIVE_AUTO_LOCALE_KEY, lang);
  } catch {
    // Storage may be unavailable in privacy modes; the in-memory language still applies.
  }
}

export function nativeDeviceLocaleList(
  env: Pick<NativeLanguageEnv, 'languages' | 'language'>,
): string[] {
  const out: string[] = [];
  if (Array.isArray(env.languages)) {
    for (const locale of env.languages) {
      if (typeof locale === 'string' && locale.trim()) out.push(locale);
    }
  }
  if (typeof env.language === 'string' && env.language.trim() && !out.includes(env.language)) {
    out.push(env.language);
  }
  return out;
}

export function applyNativeDeviceLanguage(env: NativeLanguageEnv): SupportedLanguage | null {
  if (!env.native || explicitLanguageSelection(env)) return null;
  const selected = resolveSupportedDeviceLanguage(nativeDeviceLocaleList(env));
  if (selected) {
    setLanguage(selected);
    rememberNativeAutoLanguage(env.storage, selected);
    return selected;
  }

  if (storedSupportedLanguage(env.storage, NATIVE_AUTO_LOCALE_KEY)) {
    setLanguage('en');
    rememberNativeAutoLanguage(env.storage, 'en');
    return 'en';
  }

  return null;
}
