import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readAutoRefreshPreference,
  writeAutoRefreshPreference,
} from '../../src/admin/auto_refresh_preference';

const KEY = 'claudecraft_admin_test_auto_refresh';

function stubStorage(store: Partial<Storage>): void {
  vi.stubGlobal('localStorage', store as Storage);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('auto-refresh preference', () => {
  it('defaults to on and stores only an explicit opt-out', () => {
    const values = new Map<string, string>();
    stubStorage({
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    });

    expect(readAutoRefreshPreference(KEY)).toBe(true);

    writeAutoRefreshPreference(KEY, false);
    expect(values.get(KEY)).toBe('0');
    expect(readAutoRefreshPreference(KEY)).toBe(false);

    writeAutoRefreshPreference(KEY, true);
    expect(values.get(KEY)).toBe('1');
    expect(readAutoRefreshPreference(KEY)).toBe(true);
  });

  it('keeps polling when storage is unavailable instead of throwing', () => {
    stubStorage({
      getItem: () => {
        throw new Error('storage blocked');
      },
      setItem: () => {
        throw new Error('storage blocked');
      },
    });

    expect(readAutoRefreshPreference(KEY)).toBe(true);
    expect(() => writeAutoRefreshPreference(KEY, false)).not.toThrow();
  });
});
