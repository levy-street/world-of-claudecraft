import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyThemeMode,
  DEFAULT_THEME_MODE,
  isThemeMode,
  readThemePreference,
  THEME_STORAGE_KEY,
  writeThemePreference,
} from '../../src/admin/theme';

function stubStorage(store: Partial<Storage>): void {
  vi.stubGlobal('localStorage', store as Storage);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('theme preference', () => {
  it('defaults to dark and only persists an explicit choice', () => {
    const values = new Map<string, string>();
    stubStorage({
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    });

    expect(DEFAULT_THEME_MODE).toBe('dark');
    expect(readThemePreference()).toBe('dark');

    writeThemePreference('light');
    expect(values.get(THEME_STORAGE_KEY)).toBe('light');
    expect(readThemePreference()).toBe('light');

    writeThemePreference('dark');
    expect(values.get(THEME_STORAGE_KEY)).toBe('dark');
    expect(readThemePreference()).toBe('dark');
  });

  it('falls back to dark for a corrupt or unknown stored value', () => {
    stubStorage({
      getItem: () => 'sepia',
      setItem: () => undefined,
    });

    expect(readThemePreference()).toBe('dark');
  });

  it('stays on dark when storage is unavailable instead of throwing', () => {
    stubStorage({
      getItem: () => {
        throw new Error('storage blocked');
      },
      setItem: () => {
        throw new Error('storage blocked');
      },
    });

    expect(readThemePreference()).toBe('dark');
    expect(() => writeThemePreference('light')).not.toThrow();
  });

  it('narrows only the two known modes', () => {
    expect(isThemeMode('dark')).toBe(true);
    expect(isThemeMode('light')).toBe(true);
    expect(isThemeMode('sepia')).toBe(false);
    expect(isThemeMode(null)).toBe(false);
    expect(isThemeMode(undefined)).toBe(false);
  });
});

// @vitest-environment jsdom would apply to the whole file, so this suite manages its
// own throwaway <html> element instead of opting the pure tests above into jsdom.
describe('applyThemeMode', () => {
  it('stamps and clears the data-theme attribute on <html>', () => {
    const root = { attrs: new Map<string, string>() };
    const documentElement = {
      setAttribute: (name: string, value: string) => root.attrs.set(name, value),
      removeAttribute: (name: string) => root.attrs.delete(name),
    };
    vi.stubGlobal('document', { documentElement });

    applyThemeMode('light');
    expect(root.attrs.get('data-theme')).toBe('light');

    applyThemeMode('dark');
    expect(root.attrs.has('data-theme')).toBe(false);

    vi.unstubAllGlobals();
  });
});

// admin.html stamps the SAME storage key synchronously (before any module runs) to
// avoid a flash of the dark default for a returning light-mode operator; the two
// literals can only drift if someone edits one side, which this pins.
describe('admin.html theme FOUC guard', () => {
  it('reads the same localStorage key theme.ts writes', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', '..', 'admin.html'), 'utf-8');
    expect(html).toContain(`localStorage.getItem('${THEME_STORAGE_KEY}')`);
  });
});
