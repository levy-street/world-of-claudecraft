import { describe, expect, it } from 'vitest';
import {
  CHAR_SORT_MODES,
  DEFAULT_CHAR_SORT,
  normalizeCharSortMode,
  sortCharacters,
} from '../src/net/char_sort';
import type { CharacterSummary } from '../src/net/online';

function char(over: Partial<CharacterSummary> & { id: number }): CharacterSummary {
  return {
    id: over.id,
    name: over.name ?? `Char${over.id}`,
    class: over.class ?? 'warrior',
    level: over.level ?? 1,
    skin: over.skin ?? 0,
    online: over.online ?? false,
    forceRename: over.forceRename ?? false,
    lastPlayed: over.lastPlayed,
    playtimeSeconds: over.playtimeSeconds,
  };
}

const ids = (chars: CharacterSummary[]) => chars.map((c) => c.id);

describe('sortCharacters', () => {
  it('defaults to level descending', () => {
    expect(DEFAULT_CHAR_SORT).toBe('level');
    const chars = [
      char({ id: 1, level: 5 }),
      char({ id: 2, level: 20 }),
      char({ id: 3, level: 12 }),
    ];
    expect(ids(sortCharacters(chars, 'level'))).toEqual([2, 3, 1]);
  });

  it('sorts by name ascending (case-insensitive locale compare)', () => {
    const chars = [
      char({ id: 1, name: 'Zara' }),
      char({ id: 2, name: 'aldwin' }),
      char({ id: 3, name: 'Mira' }),
    ];
    expect(ids(sortCharacters(chars, 'name'))).toEqual([2, 3, 1]);
  });

  it('sorts by most recently played, treating never-played as oldest', () => {
    const chars = [
      char({ id: 1, lastPlayed: '2026-06-01T00:00:00.000Z' }),
      char({ id: 2, lastPlayed: null }),
      char({ id: 3, lastPlayed: '2026-06-18T00:00:00.000Z' }),
    ];
    expect(ids(sortCharacters(chars, 'recent'))).toEqual([3, 1, 2]);
  });

  it('sorts by total playtime descending, missing playtime as zero', () => {
    const chars = [
      char({ id: 1, playtimeSeconds: 3600 }),
      char({ id: 2 }),
      char({ id: 3, playtimeSeconds: 7200 }),
    ];
    expect(ids(sortCharacters(chars, 'playtime'))).toEqual([3, 1, 2]);
  });

  it('breaks ties deterministically by name then id', () => {
    const chars = [
      char({ id: 7, level: 10, name: 'Bex' }),
      char({ id: 3, level: 10, name: 'Bex' }),
      char({ id: 5, level: 10, name: 'Ana' }),
    ];
    expect(ids(sortCharacters(chars, 'level'))).toEqual([5, 3, 7]);
  });

  it('does not mutate the input array', () => {
    const chars = [char({ id: 1, level: 5 }), char({ id: 2, level: 20 })];
    const before = ids(chars);
    sortCharacters(chars, 'level');
    expect(ids(chars)).toEqual(before);
  });
});

describe('normalizeCharSortMode', () => {
  it('passes through valid modes', () => {
    for (const mode of CHAR_SORT_MODES) {
      expect(normalizeCharSortMode(mode)).toBe(mode);
    }
  });

  it('falls back to the default for unknown or empty values', () => {
    expect(normalizeCharSortMode(null)).toBe(DEFAULT_CHAR_SORT);
    expect(normalizeCharSortMode(undefined)).toBe(DEFAULT_CHAR_SORT);
    expect(normalizeCharSortMode('bogus')).toBe(DEFAULT_CHAR_SORT);
  });
});
