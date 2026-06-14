// Client-side internationalization (i18n).
//
// World of Claudecraft ships English and Simplified Chinese (中文). This module
// owns the *presentation* layer only — the simulation core (src/sim) stays
// canonical English so the authoritative server, the headless RL environment,
// and the deterministic tests are completely unaffected. Translations are an
// overlay the client applies when rendering:
//
//   • UI chrome strings  -> t('some.key', { param })   (ui/en.ts, ui/zh.ts)
//   • game content names -> the accessors in ./content  (content/zh.ts)
//
// Anything without a Chinese translation falls back to English automatically,
// so the game is never broken by a missing key — it just shows English there.

import { EN } from './ui/en';
import { ZH } from './ui/zh';

export type Locale = 'en' | 'zh';
export const LOCALES: Locale[] = ['en', 'zh'];

// Native-language label for each locale, for the language picker.
export const LOCALE_LABEL: Record<Locale, string> = {
  en: 'English',
  zh: '中文',
};

type Dict = Record<string, string>;
const DICTS: Record<Locale, Dict> = { en: EN, zh: ZH };

const STORAGE_KEY = 'woc_lang';

let current: Locale = detectInitial();
const listeners = new Set<(loc: Locale) => void>();

function isLocale(v: unknown): v is Locale {
  return v === 'en' || v === 'zh';
}

// Resolve the startup locale: an explicit saved choice wins; otherwise sniff the
// browser's preferred languages for Chinese; default to English.
function detectInitial(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch { /* localStorage unavailable (private mode / SSR) */ }
  try {
    const langs = [navigator.language, ...(navigator.languages ?? [])];
    if (langs.some((l) => (l ?? '').toLowerCase().startsWith('zh'))) return 'zh';
  } catch { /* no navigator */ }
  return 'en';
}

export function getLocale(): Locale {
  return current;
}

// IETF tag for the <html lang> attribute (affects browser font selection too).
export function htmlLang(loc: Locale = current): string {
  return loc === 'zh' ? 'zh-CN' : 'en';
}

export function setLocale(loc: Locale): void {
  if (!isLocale(loc) || loc === current) return;
  current = loc;
  try { localStorage.setItem(STORAGE_KEY, loc); } catch { /* ignore */ }
  applyHtmlLang();
  localizeDom(document);
  for (const fn of listeners) {
    try { fn(loc); } catch (err) { console.error('i18n listener failed', err); }
  }
}

// Subscribe to locale changes. Returns an unsubscribe function. The HUD and the
// renderer use this to re-paint any text they built imperatively.
export function onLocaleChange(fn: (loc: Locale) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function applyHtmlLang(): void {
  try { document.documentElement.lang = htmlLang(); } catch { /* no document */ }
}

// Translate a key, interpolating {placeholders}. Falls back to the English
// string, then to the raw key, so a missing translation is never fatal.
export function t(key: string, params?: Record<string, string | number>): string {
  let s = DICTS[current][key];
  if (s === undefined) s = EN[key];
  if (s === undefined) s = key;
  if (params) {
    s = s.replace(/\{(\w+)\}/g, (m, name) =>
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : m);
  }
  return s;
}

// Whether a key has an explicit translation in the active locale (used by call
// sites that want to fall back to a richer English-only code path).
export function has(key: string): boolean {
  return DICTS[current][key] !== undefined;
}

// ---------------------------------------------------------------------------
// DOM hydration — static markup opts in with data attributes:
//   <span data-i18n="login.title">Account</span>
//   <input data-i18n-attr="placeholder:login.user.ph" />
//   <div data-i18n-html="controls.hint">…<b>WASD</b>…</div>   (trusted markup)
// localizeDom() rewrites them from the active locale; it's idempotent and is
// re-run on every locale change.
// ---------------------------------------------------------------------------
export function localizeDom(root: ParentNode = document): void {
  applyHtmlLang();

  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n;
    if (key) el.textContent = t(key);
  });

  // data-i18n-html holds author-controlled markup only (never user input).
  root.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach((el) => {
    const key = el.dataset.i18nHtml;
    if (key) el.innerHTML = t(key);
  });

  // "attr:key;attr2:key2" — localize one or more attributes (placeholder/title).
  root.querySelectorAll<HTMLElement>('[data-i18n-attr]').forEach((el) => {
    const spec = el.dataset.i18nAttr;
    if (!spec) return;
    for (const pair of spec.split(';')) {
      const idx = pair.indexOf(':');
      if (idx < 0) continue;
      const attr = pair.slice(0, idx).trim();
      const key = pair.slice(idx + 1).trim();
      if (attr && key) el.setAttribute(attr, t(key));
    }
  });
}
