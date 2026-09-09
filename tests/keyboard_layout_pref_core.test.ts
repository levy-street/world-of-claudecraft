// The persisted keyboard size and legend source behind the keyboard overview's
// switches (src/ui/keyboard_layout_pref_core.ts): load/save over an injected
// storage, with full size / the OS layout for anything unset, unknown or
// unreadable.
import { describe, expect, it } from 'vitest';
import {
  KEYBOARD_LAYOUT_STORE_KEY,
  KEYBOARD_LEGENDS_STORE_KEY,
  loadKeyboardFormFactor,
  loadKeyboardLegendSource,
  saveKeyboardFormFactor,
  saveKeyboardLegendSource,
} from '../src/ui/keyboard_layout_pref_core';

const memory = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    map,
  };
};

describe('keyboard_layout_pref_core', () => {
  it('round-trips every form factor through storage under its own key', () => {
    const store = memory();
    for (const form of ['full', 'tkl', '75', '60'] as const) {
      saveKeyboardFormFactor(form, store);
      expect(store.map.get(KEYBOARD_LAYOUT_STORE_KEY)).toBe(form);
      expect(loadKeyboardFormFactor(store)).toBe(form);
    }
    expect(KEYBOARD_LAYOUT_STORE_KEY).toBe('woc_keyboard_layout');
  });

  it('falls back to full size when unset, unknown, unavailable or throwing', () => {
    expect(loadKeyboardFormFactor(memory())).toBe('full');
    const junk = memory();
    junk.map.set(KEYBOARD_LAYOUT_STORE_KEY, '40');
    expect(loadKeyboardFormFactor(junk)).toBe('full');
    expect(loadKeyboardFormFactor(null)).toBe('full');
    expect(
      loadKeyboardFormFactor({
        getItem: () => {
          throw new Error('denied');
        },
      }),
    ).toBe('full');
    // A throwing write is swallowed, like every other preference helper.
    expect(() =>
      saveKeyboardFormFactor('tkl', {
        setItem: () => {
          throw new Error('denied');
        },
      }),
    ).not.toThrow();
  });

  it('round-trips the legend source and defaults to the OS layout', () => {
    const store = memory();
    expect(loadKeyboardLegendSource(store)).toBe('layout');
    saveKeyboardLegendSource('qwerty', store);
    expect(store.map.get(KEYBOARD_LEGENDS_STORE_KEY)).toBe('qwerty');
    expect(loadKeyboardLegendSource(store)).toBe('qwerty');
    store.map.set(KEYBOARD_LEGENDS_STORE_KEY, 'dvorak');
    expect(loadKeyboardLegendSource(store)).toBe('layout');
    expect(loadKeyboardLegendSource(null)).toBe('layout');
    expect(KEYBOARD_LEGENDS_STORE_KEY).toBe('woc_keyboard_legends');
  });
});
