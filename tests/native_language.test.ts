import { afterEach, describe, expect, it } from 'vitest';
import { getLanguage, setLanguage } from '../src/ui/i18n';
import {
  applyNativeDeviceLanguage,
  nativeDeviceLocaleList,
  resolveSupportedDeviceLanguage,
} from '../src/ui/native_language';

function storageWithLocale(
  locale: string | null,
  nativeAutoLocale: string | null = null,
): Pick<Storage, 'getItem' | 'setItem'> & { values: Map<string, string> } {
  const values = new Map<string, string>();
  if (locale) values.set('locale', locale);
  if (nativeAutoLocale) values.set('woc_native_auto_locale', nativeAutoLocale);
  return {
    values,
    getItem(key: string): string | null {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      values.set(key, value);
    },
  };
}

describe('native device language selection', () => {
  afterEach(() => setLanguage('en'));

  it('uses an exact supported device dialect when available', () => {
    expect(resolveSupportedDeviceLanguage(['fr-CA'])).toBe('fr_CA');
    expect(resolveSupportedDeviceLanguage(['zh-Hant-TW'])).toBe('zh_TW');
    expect(resolveSupportedDeviceLanguage(['en-CA'])).toBe('en_CA');
  });

  it('falls back from device language subtags to an available game locale', () => {
    expect(resolveSupportedDeviceLanguage(['fr-BE'])).toBe('fr_FR');
    expect(resolveSupportedDeviceLanguage(['de'])).toBe('de_DE');
    expect(resolveSupportedDeviceLanguage(['es-MX'])).toBe('es');
    expect(resolveSupportedDeviceLanguage(['en-US'])).toBe('en');
  });

  it('returns null for unsupported device languages so English remains the default', () => {
    setLanguage('en');
    expect(resolveSupportedDeviceLanguage(['ar-SA', 'hi-IN'])).toBeNull();
    expect(
      applyNativeDeviceLanguage({
        native: true,
        storage: storageWithLocale(null),
        languages: ['ar-SA'],
      }),
    ).toBeNull();
    expect(getLanguage()).toBe('en');
  });

  it('does not override an explicit saved language or URL language', () => {
    setLanguage('en');
    expect(
      applyNativeDeviceLanguage({
        native: true,
        storage: storageWithLocale('ja_JP'),
        languages: ['de-DE'],
      }),
    ).toBeNull();
    expect(getLanguage()).toBe('en');

    expect(
      applyNativeDeviceLanguage({
        native: true,
        locationSearch: '?lang=pt_BR',
        storage: storageWithLocale(null),
        languages: ['de-DE'],
      }),
    ).toBeNull();
    expect(getLanguage()).toBe('en');
  });

  it('keeps native auto-selected languages device-driven across launches', () => {
    setLanguage('de_DE');
    const storage = storageWithLocale('de_DE', 'de_DE');
    expect(
      applyNativeDeviceLanguage({
        native: true,
        storage,
        languages: ['vi-VN'],
      }),
    ).toBe('vi_VN');
    expect(getLanguage()).toBe('vi_VN');
    expect(storage.values.get('woc_native_auto_locale')).toBe('vi_VN');
  });

  it('resets an auto-managed saved locale to English when the device language is unavailable', () => {
    setLanguage('de_DE');
    expect(
      applyNativeDeviceLanguage({
        native: true,
        storage: storageWithLocale('de_DE', 'de_DE'),
        languages: ['ar-SA'],
      }),
    ).toBe('en');
    expect(getLanguage()).toBe('en');
  });

  it('applies a supported native device language only in native mode', () => {
    setLanguage('en');
    expect(
      applyNativeDeviceLanguage({
        native: false,
        storage: storageWithLocale(null),
        languages: ['it-IT'],
      }),
    ).toBeNull();
    expect(getLanguage()).toBe('en');

    expect(
      applyNativeDeviceLanguage({
        native: true,
        storage: storageWithLocale(null),
        languages: ['it-IT'],
      }),
    ).toBe('it_IT');
    expect(getLanguage()).toBe('it_IT');
  });

  it('deduplicates navigator.languages with navigator.language preserving priority', () => {
    expect(nativeDeviceLocaleList({ languages: ['pl-PL'], language: 'pl-PL' })).toEqual(['pl-PL']);
    expect(nativeDeviceLocaleList({ languages: ['ar-SA'], language: 'vi-VN' })).toEqual([
      'ar-SA',
      'vi-VN',
    ]);
  });
});
