import { afterEach, describe, expect, it, vi } from 'vitest';
import { newCustomMap } from '../src/editor/custom_map';
import {
  clearPlaytestRecoveryDraft,
  loadPlaytestRecoveryDraft,
  PLAYTEST_RECOVERY_KEY,
  savePlaytestRecoveryDraft,
} from '../src/editor/playtest';

interface MemSessionStorage {
  data: Map<string, string>;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function memSessionStorage(): MemSessionStorage {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('playtest recovery draft', () => {
  it('round-trips the full editor document through compact session storage', () => {
    const storage = memSessionStorage();
    vi.stubGlobal('sessionStorage', storage);
    const map = newCustomMap('Recovery', 'recover-me', 100);

    expect(savePlaytestRecoveryDraft(map)).toBe(true);
    expect(storage.data.get(PLAYTEST_RECOVERY_KEY)).not.toContain('\n');
    expect(loadPlaytestRecoveryDraft()?.meta.id).toBe('recover-me');
  });

  it('only clears the recovery draft for the matching map id', () => {
    const storage = memSessionStorage();
    vi.stubGlobal('sessionStorage', storage);
    const map = newCustomMap('Recovery', 'recover-me', 100);
    savePlaytestRecoveryDraft(map);

    clearPlaytestRecoveryDraft('other-map');
    expect(loadPlaytestRecoveryDraft()?.meta.id).toBe('recover-me');

    clearPlaytestRecoveryDraft('recover-me');
    expect(loadPlaytestRecoveryDraft()).toBeNull();
  });

  it('reports blocked storage without throwing', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });

    expect(savePlaytestRecoveryDraft(newCustomMap('Blocked', 'blocked', 1))).toBe(false);
    expect(loadPlaytestRecoveryDraft()).toBeNull();
    expect(() => clearPlaytestRecoveryDraft('blocked')).not.toThrow();
  });
});
