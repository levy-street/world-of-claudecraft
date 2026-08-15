// The shared localStorage feature-detect (src/ui/safe_local_storage.ts) that every
// persisted-toggle pure core imports instead of duplicating its own copy
// (guild_hide_offline.ts, party_collapse.ts). This is the one pure core the purity
// guard (tests/architecture.test.ts) allowlists for the value-position
// `typeof localStorage` idiom; this suite proves the function itself behaves
// correctly under Node, where `localStorage` is not a global at all.

import { describe, expect, it } from 'vitest';
import { safeLocalStorage } from '../src/ui/safe_local_storage';

describe('safeLocalStorage (the shared feature-detect)', () => {
  it('returns null under Node, where localStorage is not a global (no throw)', () => {
    // This test file itself runs in plain Node (no jsdom), so this exercises the
    // exact "unavailable" branch every caller relies on: no ReferenceError, just null.
    expect(safeLocalStorage()).toBeNull();
  });

  it('returns the real localStorage when the global exists and is reachable', () => {
    const fake = { getItem: () => null, setItem: () => undefined } as unknown as Storage;
    (globalThis as { localStorage?: Storage }).localStorage = fake;
    try {
      expect(safeLocalStorage()).toBe(fake);
    } finally {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  });

  it('returns null (never throws) when reading the global itself throws', () => {
    // Some locked-down environments throw on the `localStorage` reference itself
    // (not just on getItem/setItem), which is exactly what the try/catch guards.
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('access denied');
      },
    });
    try {
      expect(() => safeLocalStorage()).not.toThrow();
      expect(safeLocalStorage()).toBeNull();
    } finally {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  });
});
