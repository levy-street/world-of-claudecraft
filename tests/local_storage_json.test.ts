import { beforeEach, describe, expect, it } from 'vitest';
import { parseStoredJson } from '../src/game/local_storage_json';

// minimal localStorage stub (the test env is plain node, no DOM); mirrors the
// pattern in tests/keybinds.test.ts / tests/settings.test.ts / tests/gamepad.test.ts,
// the three call sites this shared helper was pulled out of.
function installStorage(): void {
  const map = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
  };
}

beforeEach(() => installStorage());

describe('parseStoredJson', () => {
  it('returns null for a missing key', () => {
    expect(parseStoredJson('nope')).toBeNull();
  });

  it('returns null for corrupt (unparseable) JSON, never throws', () => {
    localStorage.setItem('bad', '{not valid json');
    expect(() => parseStoredJson('bad')).not.toThrow();
    expect(parseStoredJson('bad')).toBeNull();
  });

  it('parses a valid JSON object', () => {
    localStorage.setItem('obj', JSON.stringify({ a: 1, b: 'two' }));
    expect(parseStoredJson('obj')).toEqual({ a: 1, b: 'two' });
  });

  it('parses a valid JSON array (the caller decides whether that counts)', () => {
    localStorage.setItem('arr', JSON.stringify([1, 2, 3]));
    expect(parseStoredJson('arr')).toEqual([1, 2, 3]);
  });

  it('returns null when localStorage itself is unavailable', () => {
    delete (globalThis as any).localStorage;
    expect(() => parseStoredJson('anything')).not.toThrow();
    expect(parseStoredJson('anything')).toBeNull();
  });
});
