// @vitest-environment happy-dom
// detectOsKeyboardLayout (src/ui/keyboard_map.ts): the layout converter's
// default target, read once per session from navigator.keyboard.getLayoutMap
// (Chromium) and matched against the listed layouts; null wherever the browser
// cannot say (no API, a rejected read, a layout that is not listed).
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/game/audio', () => ({ audio: { click: () => {} } }));

import { KEYBOARD_LAYOUTS } from '../src/ui/keyboard_layout_convert_core';

/** A layout map as Chromium reports it: lowercase characters per code. */
function osMap(id: string): Map<string, string> {
  const spec = KEYBOARD_LAYOUTS.find((l) => l.id === id);
  if (!spec) throw new Error(id);
  return new Map([...spec.chars, ['Digit1', '1']]);
}

async function detectWith(keyboard: unknown) {
  vi.resetModules();
  vi.stubGlobal('navigator', keyboard === undefined ? {} : { keyboard });
  const { detectOsKeyboardLayout } = await import('../src/ui/keyboard_map');
  return detectOsKeyboardLayout();
}

// Each case re-imports the keyboard overview module fresh (vi.resetModules), a
// few seconds apiece, so the cases carry a roomier timeout than the default.
const FRESH_IMPORT_TIMEOUT_MS = 60_000;

describe('detectOsKeyboardLayout', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it(
    'names the listed layout the OS reports',
    async () => {
      expect(await detectWith({ getLayoutMap: () => Promise.resolve(osMap('azerty-fr')) })).toBe(
        'azerty-fr',
      );
      expect(await detectWith({ getLayoutMap: () => Promise.resolve(osMap('colemak')) })).toBe(
        'colemak',
      );
    },
    FRESH_IMPORT_TIMEOUT_MS,
  );

  it(
    'is null without the API, on a rejected read, or for a layout it does not list',
    async () => {
      expect(await detectWith(undefined)).toBe(null);
      expect(await detectWith({ getLayoutMap: () => Promise.reject(new Error('denied')) })).toBe(
        null,
      );
      const cyrillic = new Map([...osMap('qwerty-us')].map(([code]) => [code, 'ж']));
      expect(await detectWith({ getLayoutMap: () => Promise.resolve(cyrillic) })).toBe(null);
    },
    FRESH_IMPORT_TIMEOUT_MS,
  );
});
