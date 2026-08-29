import { describe, expect, it } from 'vitest';
import {
  markSpawnIntroSeen,
  readSpawnIntroSeen,
  spawnIntroSeenKey,
} from '../src/game/spawn_intro_seen';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    map,
  };
}

describe('spawn intro seen marker', () => {
  it('keys per character scope, under the historical prefix', () => {
    expect(spawnIntroSeenKey('char:42')).toBe('woc_spawn_intro_seen:char:42');
    expect(spawnIntroSeenKey('offline:warrior:perfprobe')).toBe(
      'woc_spawn_intro_seen:offline:warrior:perfprobe',
    );
  });

  it('reads unseen until marked, then seen, per scope', () => {
    const storage = memoryStorage();
    expect(readSpawnIntroSeen('char:1', () => storage)).toBe(false);
    markSpawnIntroSeen('char:1', () => storage);
    expect(readSpawnIntroSeen('char:1', () => storage)).toBe(true);
    expect(readSpawnIntroSeen('char:2', () => storage)).toBe(false);
    expect(storage.map.get('woc_spawn_intro_seen:char:1')).toBe('1');
  });

  it('a stored value other than the marker reads as unseen', () => {
    const storage = memoryStorage();
    storage.setItem('woc_spawn_intro_seen:char:1', '0');
    expect(readSpawnIntroSeen('char:1', () => storage)).toBe(false);
  });

  it('a storage whose accessors throw (private-mode WebKit) reads as seen and marks quietly', () => {
    const throwing = () => ({
      getItem: (): string | null => {
        throw new Error('QuotaExceededError');
      },
      setItem: (): void => {
        throw new Error('QuotaExceededError');
      },
    });
    expect(readSpawnIntroSeen('char:1', throwing)).toBe(true);
    expect(() => markSpawnIntroSeen('char:1', throwing)).not.toThrow();
  });

  it('treats unavailable storage as seen, and tolerates a failed mark', () => {
    const broken = () => {
      throw new Error('storage disabled');
    };
    expect(readSpawnIntroSeen('char:1', broken)).toBe(true);
    expect(() => markSpawnIntroSeen('char:1', broken)).not.toThrow();
  });
});
