import { describe, expect, it } from 'vitest';
import {
  STAT_DEFENSE,
  STAT_GRID,
  STAT_OFFENSE,
  STAT_PANELS,
  STAT_TILES,
} from '../src/ui/char_stats_view';

// The showcase character sheet splits the 16 character-sheet stats into three
// groups: five primary TILES plus an Offense and a Defense panel. This core owns
// the partition; the painter (char_window.ts) only lays it out. The one invariant
// that must never drift: the three groups repartition STAT_GRID EXACTLY, so no
// stat is dropped, duplicated, or silently invented as the grid changes.

describe('char_stats_view: the tiles/offense/defense partition of STAT_GRID', () => {
  it('the three groups union to exactly the STAT_GRID set, with no duplicates', () => {
    const union = [...STAT_TILES, ...STAT_OFFENSE, ...STAT_DEFENSE];
    // No id appears in more than one group (union length == unique count).
    expect(new Set(union).size).toBe(union.length);
    // The partition covers exactly STAT_GRID: same membership both directions.
    expect(new Set(union)).toEqual(new Set(STAT_GRID));
    // And it is a true repartition (same cardinality as the canonical grid).
    expect(union.length).toBe(STAT_GRID.length);
    expect(STAT_GRID.length).toBe(16);
  });

  it('pins the five primary tiles in order (str, agi, sta, int, spi)', () => {
    expect(STAT_TILES).toEqual(['str', 'agi', 'sta', 'int', 'spi']);
  });

  it('pins the Offense group and its heading key', () => {
    expect(STAT_OFFENSE).toEqual([
      'attackPower',
      'dps',
      'critChance',
      'spellPower',
      'critRating',
      'hasteRating',
      'hitRating',
    ]);
  });

  it('pins the Defense group and its heading key', () => {
    expect(STAT_DEFENSE).toEqual(['armor', 'dodge', 'parry', 'warfare']);
  });

  it('exposes three ordered panels: an untitled tiles group, then Offense, then Defense', () => {
    expect(STAT_PANELS.map((p) => p.kind)).toEqual(['tiles', 'stats', 'stats']);
    expect(STAT_PANELS.map((p) => p.titleKey)).toEqual([
      null,
      'hudChrome.charSheet.offense',
      'hudChrome.charSheet.defense',
    ]);
    // The panels' stat lists ARE the same arrays the partition test pins.
    expect(STAT_PANELS[0].stats).toBe(STAT_TILES);
    expect(STAT_PANELS[1].stats).toBe(STAT_OFFENSE);
    expect(STAT_PANELS[2].stats).toBe(STAT_DEFENSE);
  });
});
