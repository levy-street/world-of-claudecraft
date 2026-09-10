// The shared guild board category vocabulary (src/sim/guild_board_category.ts):
// the closed category table, the query-value parse at the trust boundary, the
// per-entry match rule, and the filter every host applies to a ranked list
// (realm ranks kept, the unfiltered path allocation-free).

import { describe, expect, it } from 'vitest';
import {
  filterGuildBoardEntries,
  GUILD_BOARD_CATEGORIES,
  GUILD_BOARD_CATEGORY_PARAM,
  guildMatchesCategory,
  parseGuildBoardCategory,
} from '../src/sim/guild_board_category';

describe('guild board categories', () => {
  it('pins the closed vocabulary and the wire query key', () => {
    expect(GUILD_BOARD_CATEGORIES).toEqual(['newPlayerFriendly']);
    expect(GUILD_BOARD_CATEGORY_PARAM).toBe('category');
  });

  it('parses only a known category from an untrusted query value', () => {
    expect(parseGuildBoardCategory('newPlayerFriendly')).toBe('newPlayerFriendly');
    expect(parseGuildBoardCategory('pvp')).toBeNull();
    expect(parseGuildBoardCategory('')).toBeNull();
    expect(parseGuildBoardCategory(undefined)).toBeNull();
    expect(parseGuildBoardCategory(null)).toBeNull();
    expect(parseGuildBoardCategory(['newPlayerFriendly'])).toBeNull();
    expect(parseGuildBoardCategory(7)).toBeNull();
  });

  it('matches an entry by its opt-in flag; a null category matches every entry', () => {
    expect(guildMatchesCategory({ newPlayerFriendly: true }, 'newPlayerFriendly')).toBe(true);
    expect(guildMatchesCategory({ newPlayerFriendly: false }, 'newPlayerFriendly')).toBe(false);
    expect(guildMatchesCategory({}, 'newPlayerFriendly')).toBe(false);
    expect(guildMatchesCategory({}, null)).toBe(true);
    expect(guildMatchesCategory({ newPlayerFriendly: false }, null)).toBe(true);
  });

  it('reads the flag of the category it is asked about, never another category', () => {
    // The vocabulary has one row today, so the second category is minted past
    // the type: a category the table does not know must match NOTHING, never
    // fall through to the first flag (the trap a hardcoded matcher shipped).
    const unknown = 'pvp' as unknown as 'newPlayerFriendly';
    expect(guildMatchesCategory({ newPlayerFriendly: true }, unknown)).toBe(false);
    expect(filterGuildBoardEntries([{ newPlayerFriendly: true }], unknown)).toEqual([]);
  });

  it('filters a ranked list without renumbering, and returns the input itself unfiltered', () => {
    const entries = [
      { rank: 1, name: 'A' },
      { rank: 2, name: 'B', newPlayerFriendly: true },
      { rank: 3, name: 'C', newPlayerFriendly: false },
      { rank: 4, name: 'D', newPlayerFriendly: true },
    ];
    const filtered = filterGuildBoardEntries(entries, 'newPlayerFriendly');
    expect(filtered.map((e) => e.rank)).toEqual([2, 4]);
    expect(filterGuildBoardEntries(entries, null)).toBe(entries);
    // Immutable: the input list is untouched.
    expect(entries).toHaveLength(4);
  });
});
