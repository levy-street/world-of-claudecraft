// The guild "hide offline" persisted-toggle pure core: the localStorage key plus
// load/save, default SHOW (offline visible). DOM-free, driven over a tiny fake Storage
// (no jsdom), mirroring the party-collapse / haptics-toggle tests.

import { describe, expect, it } from 'vitest';
import {
  GUILD_HIDE_OFFLINE_STORE_KEY,
  loadGuildHideOffline,
  saveGuildHideOffline,
} from '../src/ui/guild_hide_offline';

function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    _map: map,
  };
}
const throwingStorage = {
  getItem: () => {
    throw new Error('unavailable');
  },
  setItem: () => {
    throw new Error('unavailable');
  },
};

describe('guild hide-offline persistence (default show)', () => {
  it('pins the exact localStorage key (a rename would silently drop every stored choice)', () => {
    // A literal pin, not the imported constant: renaming GUILD_HIDE_OFFLINE_STORE_KEY
    // keeps the rest of this suite green (it uses the import) while orphaning every
    // player's persisted preference. Pin the on-disk string.
    expect(GUILD_HIDE_OFFLINE_STORE_KEY).toBe('woc_guild_hide_offline');
  });

  it('defaults to show (false) when the key is unset (never toggled)', () => {
    expect(loadGuildHideOffline(fakeStorage())).toBe(false);
  });

  it('defaults to show when storage is null (SSR / no localStorage)', () => {
    expect(loadGuildHideOffline(null)).toBe(false);
  });

  it('defaults to show when a read throws (storage disabled)', () => {
    expect(loadGuildHideOffline(throwingStorage)).toBe(false);
  });

  it("hides ONLY on the exact stored '1'", () => {
    expect(loadGuildHideOffline(fakeStorage({ [GUILD_HIDE_OFFLINE_STORE_KEY]: '1' }))).toBe(true);
    // Anything else (including a stray value) stays visible, so a corrupt value fails safe.
    expect(loadGuildHideOffline(fakeStorage({ [GUILD_HIDE_OFFLINE_STORE_KEY]: '0' }))).toBe(false);
    expect(loadGuildHideOffline(fakeStorage({ [GUILD_HIDE_OFFLINE_STORE_KEY]: 'yes' }))).toBe(
      false,
    );
  });

  it('round-trips: save(hide) then load reads it back under the shared key', () => {
    const store = fakeStorage();
    saveGuildHideOffline(true, store);
    expect(store._map.get(GUILD_HIDE_OFFLINE_STORE_KEY)).toBe('1');
    expect(loadGuildHideOffline(store)).toBe(true);
    saveGuildHideOffline(false, store);
    expect(store._map.get(GUILD_HIDE_OFFLINE_STORE_KEY)).toBe('0');
    expect(loadGuildHideOffline(store)).toBe(false);
  });

  it('save no-ops (no throw) when storage is unavailable', () => {
    expect(() => saveGuildHideOffline(true, null)).not.toThrow();
    expect(() => saveGuildHideOffline(false, throwingStorage)).not.toThrow();
  });
});
